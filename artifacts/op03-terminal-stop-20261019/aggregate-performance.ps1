param(
  [Parameter(Mandatory = $true)][string]$ShoppingReport,
  [Parameter(Mandatory = $true)][string]$DragReport,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$BaselineShoppingReport = 'D:\esp-op03-final\artifacts\op19-final-remediation-20261019\shopping-performance.json',
  [string]$BaselineDragReport = 'D:\esp-op03-final\artifacts\op19-final-remediation-20261019\drag-performance.json'
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false, $true)

function Read-Utf8Json([string]$Path) {
  $text = $utf8.GetString([IO.File]::ReadAllBytes($Path))
  if ($text.Contains([char]0xfffd)) { throw "Replacement character in $Path" }
  return $text.TrimStart([char]0xfeff) | ConvertFrom-Json -AsHashtable -Depth 100
}
function Get-Attachments($Report, [string]$Name) {
  $found = [Collections.Generic.List[object]]::new()
  function Visit-Suite($Suite) {
    if ($Suite.Contains('specs')) {
      foreach ($spec in $Suite.specs) {
        foreach ($test in $spec.tests) {
          foreach ($result in $test.results) {
            if ($result.status -ne 'passed') { continue }
            foreach ($attachment in $result.attachments) {
              if ($attachment.name -ne $Name) { continue }
              if (-not $attachment.Contains('body')) { throw "Attachment body missing: $Name" }
              $decoded = $utf8.GetString([Convert]::FromBase64String($attachment.body))
              $found.Add(($decoded | ConvertFrom-Json -AsHashtable -Depth 100))
            }
          }
        }
      }
    }
    if ($Suite.Contains('suites')) { foreach ($child in $Suite.suites) { Visit-Suite $child } }
  }
  foreach ($suite in $Report.suites) { Visit-Suite $suite }
  return $found.ToArray()
}
function Get-Stats([object[]]$Values) {
  if ($Values.Count -eq 0) { throw 'No raw samples' }
  $sorted = [double[]]@($Values | ForEach-Object {
    if ($_ -isnot [ValueType]) { throw 'Non-numeric sample' }
    $value = [double]$_
    if ([double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt 0) { throw 'Invalid timing sample' }
    $value
  } | Sort-Object)
  return [ordered]@{
    samples = $sorted.Count
    medianMs = $sorted[[int][Math]::Ceiling($sorted.Count * 0.50) - 1]
    p95Ms = $sorted[[int][Math]::Ceiling($sorted.Count * 0.95) - 1]
    maximumMs = $sorted[-1]
  }
}
function Add-Timing($Table, [string]$Key, [object[]]$Values, $Details = @{}) {
  if ($Table.Contains($Key)) { throw "Duplicate timing category: $Key" }
  $row = Get-Stats $Values
  $row['key'] = $Key
  foreach ($name in $Details.Keys) { $row[$name] = $Details[$name] }
  $Table[$Key] = [pscustomobject]$row
}
function Get-ReportStatus($Report, [string]$Path) {
  return [ordered]@{
    path = [IO.Path]::GetFullPath($Path)
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    expected = [int]$Report.stats.expected
    unexpected = [int]$Report.stats.unexpected
    skipped = [int]$Report.stats.skipped
    flaky = [int]$Report.stats.flaky
    errors = @($Report.errors).Count
    pass = ($Report.stats.unexpected -eq 0 -and $Report.stats.skipped -eq 0 -and $Report.stats.flaky -eq 0 -and @($Report.errors).Count -eq 0)
  }
}
function Get-Measurements([string]$ShoppingPath, [string]$DragPath) {
  $shopping = Read-Utf8Json $ShoppingPath
  $drag = Read-Utf8Json $DragPath
  $operations = [ordered]@{}
  $dragOperations = [ordered]@{}
  $saveTimes = [ordered]@{}
  $lifecycle = [ordered]@{}
  $scenarioLifecycle = [ordered]@{}
  $localityRows = [Collections.Generic.List[object]]::new()
  $shoppingConditions = [Collections.Generic.List[string]]::new()
  $dragConditions = [Collections.Generic.List[string]]::new()
  $shoppingErrors = 0
  $pointerRequests = 0
  $pointerWrites = 0
  $controlFailures = 0
  foreach ($attachment in @(Get-Attachments $shopping 'shopping-operation-timings')) {
    $condition = "items=$($attachment.count)|concentrated=$($attachment.concentrated)|map=$($attachment.mapVisible)|layout=$($attachment.layout)"
    $shoppingConditions.Add($condition)
    $shoppingErrors += @($attachment.errors).Count
    $operationNames = @($attachment.timings.Keys | Sort-Object)
    if (($operationNames -join ',') -ne 'back,execute,executeRecord,focus,next,record') { throw "Unexpected operation set: $condition" }
    foreach ($operation in $operationNames) {
      Add-Timing $operations "$condition|$operation" @($attachment.timings[$operation]) @{
        itemCount = [int]$attachment.count
        operation = $operation
        condition = $condition
      }
    }
    foreach ($diagnostic in @('diagnostic', 'executionDiagnostic', 'executionRecordDiagnostic')) {
      $byOperation = [ordered]@{}
      foreach ($sample in $attachment[$diagnostic].samples) {
        if ($sample.phase -ne 'save') { continue }
        if (-not $byOperation.Contains($sample.operation)) { $byOperation[$sample.operation] = [Collections.Generic.List[object]]::new() }
        $byOperation[$sample.operation].Add($sample.durationMs)
      }
      foreach ($operation in $byOperation.Keys) {
        Add-Timing $saveTimes "shopping|$condition|$diagnostic|$operation" @($byOperation[$operation].ToArray()) @{ source = 'diagnostic phase=save'; phase = $diagnostic }
      }
    }
  }
  foreach ($attachment in @(Get-Attachments $drag 'shopping-drag-response')) {
    $condition = "items=$($attachment.fixture.count)|input=$($attachment.input)|grouped=$($attachment.grouped)"
    $dragConditions.Add($condition)
    if (-not $attachment.probeCounting.positiveControl -or -not $attachment.probeCounting.pointer) { $controlFailures++ }
    if (@($attachment.positiveControl.counts.Keys).Count -eq 0) { $controlFailures++ }
    $expectedLocality = @($attachment.records.Keys | Where-Object { $_ -ne 'drop' } | Sort-Object)
    if (($expectedLocality -join ',') -ne (@($attachment.locality.Keys | Sort-Object) -join ',')) { throw "Missing locality evidence: $condition" }
    foreach ($operation in @($attachment.records.Keys | Sort-Object)) {
      Add-Timing $dragOperations "$condition|$operation" @($attachment.records[$operation].samples) @{ condition = $condition; operation = $operation }
    }
    Add-Timing $saveTimes "drag|$condition|drop" @($attachment.saveCompletionMs) @{ source = 'saveCompletionMs; separate from drop response' }
    foreach ($metric in @('totalMs', 'fallbackMs', 'intentionalLongPressMs', 'postClonePaintMs')) {
      Add-Timing $lifecycle "$condition|start.$metric" @($attachment.start | ForEach-Object { $_[$metric] })
    }
    Add-Timing $lifecycle "$condition|end" @($attachment.end)
    foreach ($start in $attachment.scenarioStarts) {
      $scenarioLifecycle["$condition|$($start.name)|start"] = $start.response
    }
    foreach ($end in $attachment.scenarioEnds) {
      $scenarioLifecycle["$condition|$($end.name)|end"] = $end.ms
    }
    $pointerRequests += @($attachment.pointerIO.delta.mutationRequests).Count
    $pointerWrites += @($attachment.pointerIO.delta.completedReadwriteTransactions).Count
    foreach ($scenario in $attachment.locality.Keys) {
      $local = $attachment.locality[$scenario]
      $cardRenders = 0; $groupRenders = 0; $otherRenders = 0; $remounts = 0; $newMounts = 0
      foreach ($key in $local.counts.Keys) {
        if ($key.StartsWith('item:')) { $cardRenders += [int]$local.counts[$key] }
        elseif ($key.StartsWith('group:')) { $groupRenders += [int]$local.counts[$key] }
        else { $otherRenders += [int]$local.counts[$key] }
      }
      foreach ($key in $local.mounts.Keys) {
        if ($local.mountedBefore -contains $key) { $remounts += [int]$local.mounts[$key] }
        else { $newMounts += [int]$local.mounts[$key] }
      }
      if (@($local.known | Where-Object { $_.StartsWith('item:') }).Count -eq 0) { $controlFailures++ }
      $localityRows.Add([pscustomobject][ordered]@{
        key = "$condition|$scenario"
        cardRenderUpdates = $cardRenders
        groupRenderUpdates = $groupRenders
        otherRenderUpdates = $otherRenders
        existingElementRemounts = $remounts
        newlyVisibleMounts = $newMounts
        mutationRequests = @($local.io.delta.mutationRequests).Count
        completedReadwriteTransactions = @($local.io.delta.completedReadwriteTransactions).Count
      })
    }
  }
  if (@($shoppingConditions | Sort-Object -Unique).Count -ne $shoppingConditions.Count) { throw 'Duplicate shopping condition' }
  if (@($dragConditions | Sort-Object -Unique).Count -ne $dragConditions.Count) { throw 'Duplicate drag condition' }
  $required = @($operations.Values | Where-Object { $_.itemCount -in @(150, 500) })
  $existing = @($operations.Values | Where-Object { $_.itemCount -eq 1500 })
  $locality = [ordered]@{
    scenarioCount = $localityRows.Count
    pointerMutationRequests = $pointerRequests
    pointerCompletedReadwriteTransactions = $pointerWrites
    scenarioMutationRequests = [int]($localityRows | Measure-Object -Property mutationRequests -Sum).Sum
    scenarioCompletedReadwriteTransactions = [int]($localityRows | Measure-Object -Property completedReadwriteTransactions -Sum).Sum
    cardRenderUpdates = [int]($localityRows | Measure-Object -Property cardRenderUpdates -Sum).Sum
    groupRenderUpdates = [int]($localityRows | Measure-Object -Property groupRenderUpdates -Sum).Sum
    otherRenderUpdates = [int]($localityRows | Measure-Object -Property otherRenderUpdates -Sum).Sum
    existingElementRemounts = [int]($localityRows | Measure-Object -Property existingElementRemounts -Sum).Sum
    newlyVisibleMounts = [int]($localityRows | Measure-Object -Property newlyVisibleMounts -Sum).Sum
    probeControlFailures = $controlFailures
    scenarios = $localityRows.ToArray()
  }
  $locality['pass'] = ($locality.scenarioCount -eq 52 -and $locality.pointerMutationRequests -eq 0 -and $locality.pointerCompletedReadwriteTransactions -eq 0 -and $locality.scenarioMutationRequests -eq 0 -and $locality.scenarioCompletedReadwriteTransactions -eq 0 -and $locality.cardRenderUpdates -eq 0 -and $locality.groupRenderUpdates -eq 0 -and $locality.otherRenderUpdates -eq 0 -and $locality.existingElementRemounts -eq 0 -and $controlFailures -eq 0)
  return [ordered]@{
    reports = @{ shopping = Get-ReportStatus $shopping $ShoppingPath; drag = Get-ReportStatus $drag $DragPath }
    conditionCounts = @{ shopping = $shoppingConditions.Count; drag = $dragConditions.Count }
    shoppingErrors = $shoppingErrors
    required150500 = Summarize-Gate $required 96
    existing1500 = Summarize-Gate $existing 48
    drag = Summarize-Gate @($dragOperations.Values) 60
    operations = $operations
    dragOperations = $dragOperations
    saveCompletion = $saveTimes
    dragLifecycle = $lifecycle
    scenarioLifecycle = $scenarioLifecycle
    locality = $locality
  }
}
function Summarize-Gate([object[]]$Rows, [int]$Expected) {
  if ($Rows.Count -eq 0) { throw 'No measured categories' }
  $failures = @($Rows | Where-Object { $_.samples -lt 20 -or $_.medianMs -gt 55 -or $_.p95Ms -gt 100 })
  return [ordered]@{
    expectedCategories = $Expected
    categories = $Rows.Count
    minimumSamples = [int]($Rows | Measure-Object -Property samples -Minimum).Minimum
    maximumMedianMs = [double]($Rows | Measure-Object -Property medianMs -Maximum).Maximum
    maximumP95Ms = [double]($Rows | Measure-Object -Property p95Ms -Maximum).Maximum
    failures = $failures
    pass = ($Rows.Count -eq $Expected -and $failures.Count -eq 0)
  }
}
function Compare-Timings($Current, $Baseline) {
  $differences = [Collections.Generic.List[object]]::new()
  $missing = [Collections.Generic.List[string]]::new()
  foreach ($key in $Current.Keys) {
    if (-not $Baseline.Contains($key)) { $missing.Add("baseline:$key"); continue }
    $differences.Add([pscustomobject][ordered]@{
      key = $key
      samples = $Current[$key].samples
      baselineSamples = $Baseline[$key].samples
      medianMs = $Current[$key].medianMs
      baselineMedianMs = $Baseline[$key].medianMs
      medianDeltaMs = $Current[$key].medianMs - $Baseline[$key].medianMs
      p95Ms = $Current[$key].p95Ms
      baselineP95Ms = $Baseline[$key].p95Ms
      p95DeltaMs = $Current[$key].p95Ms - $Baseline[$key].p95Ms
    })
  }
  foreach ($key in $Baseline.Keys) { if (-not $Current.Contains($key)) { $missing.Add("current:$key") } }
  return [ordered]@{
    matchedCategories = $differences.Count
    missingCategories = $missing.ToArray()
    maximumMedianIncreaseMs = if ($differences.Count) { [double]($differences | Measure-Object -Property medianDeltaMs -Maximum).Maximum } else { $null }
    maximumP95IncreaseMs = if ($differences.Count) { [double]($differences | Measure-Object -Property p95DeltaMs -Maximum).Maximum } else { $null }
    rows = $differences.ToArray()
  }
}
$current = Get-Measurements $ShoppingReport $DragReport
$baseline = Get-Measurements $BaselineShoppingReport $BaselineDragReport
$comparisons = [ordered]@{
  shopping = Compare-Timings $current.operations $baseline.operations
  drag = Compare-Timings $current.dragOperations $baseline.dragOperations
  saveCompletion = Compare-Timings $current.saveCompletion $baseline.saveCompletion
  dragLifecycle = Compare-Timings $current.dragLifecycle $baseline.dragLifecycle
}
$matching = @($comparisons.Values | Where-Object { $_.missingCategories.Count -gt 0 }).Count -eq 0
$passed = ($current.required150500.pass -and $current.existing1500.pass -and $current.drag.pass -and $current.locality.pass -and $current.reports.shopping.pass -and $current.reports.drag.pass -and $current.shoppingErrors -eq 0 -and $current.conditionCounts.shopping -eq 24 -and $current.conditionCounts.drag -eq 8 -and $matching)
$summary = [ordered]@{
  utilityPath = $PSCommandPath
  utilitySha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
  method = 'Independent nearest-rank aggregation from decoded attachment raw samples; median=ceil(n*0.5), p95=ceil(n*0.95), 1-based. Stored attachment summaries ignored.'
  thresholds = @{ minimumSamples = 20; medianMs = 55; p95Ms = 100 }
  saveTimePolicy = 'Save completion and drag lifecycle are reported separately and excluded from operation-response gates. Intentional touch long press is retained in lifecycle total and listed separately.'
  overallPass = $passed
  current = $current
  baseline = $baseline
  comparison = $comparisons
}
$json = ($summary | ConvertTo-Json -Depth 100).Replace("`r`n", "`n") + "`n"
[IO.File]::WriteAllText($OutputPath, $json, [Text.UTF8Encoding]::new($false))
$check = [IO.File]::ReadAllBytes($OutputPath)
if ($check.Length -ge 3 -and $check[0] -eq 239 -and $check[1] -eq 187 -and $check[2] -eq 191) { throw 'Unexpected output BOM' }
$null = Read-Utf8Json $OutputPath
[ordered]@{
  output = [IO.Path]::GetFullPath($OutputPath)
  overallPass = $passed
  required150500 = $current.required150500
  existing1500 = $current.existing1500
  drag = $current.drag
  localityPass = $current.locality.pass
  maximumShoppingMedianIncreaseMs = $comparisons.shopping.maximumMedianIncreaseMs
  maximumDragMedianIncreaseMs = $comparisons.drag.maximumMedianIncreaseMs
} | ConvertTo-Json -Depth 8
if (-not $passed) { exit 1 }
