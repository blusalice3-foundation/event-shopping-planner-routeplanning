[CmdletBinding()]
param(
  [string]$ShoppingPath = (Join-Path $PSScriptRoot 'shopping-performance.json'),
  [string]$DragPath = (Join-Path $PSScriptRoot 'drag-performance.json'),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'independent-performance-summary.json'),
  [string]$BaselineShoppingPath,
  [string]$BaselineDragPath
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
function Read-Json([string]$Path) {
  $fullPath = (Resolve-Path -LiteralPath $Path).Path
  $bytes = [IO.File]::ReadAllBytes($fullPath)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
  # Strict decoding verifies the encoding before any JSON value is consumed.
  $value = $utf8.GetString($bytes)
  if ($value.Contains([char]0xfffd)) { throw "Replacement character in $fullPath" }
  $inputFiles.Add([ordered]@{
    Path = $fullPath
    Sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Encoding = 'UTF-8, strict decoding passed'
    Bom = $hasBom
    Crlf = [regex]::Matches($value, ([string][char]13 + [char]10)).Count
    LoneLf = [regex]::Matches($value, '(?<!\r)\n').Count
  })
  return $value.TrimStart([char]0xfeff) | ConvertFrom-Json -AsHashtable -Depth 100
}
function Entries($Suites) {
  foreach ($suite in $Suites) {
    if ($suite.Contains('specs')) {
      foreach ($spec in $suite.specs) {
        foreach ($test in $spec.tests) {
          foreach ($result in $test.results) {
            [pscustomobject]@{ Title = $spec.title; Test = $test; Result = $result }
          }
        }
      }
    }
    if ($suite.Contains('suites')) { Entries $suite.suites }
  }
}
function Payload($Entry, [string]$Name, [string]$ReportPath) {
  $attachments = @($Entry.Result.attachments | Where-Object { $_.name -eq $Name })
  if ($attachments.Count -ne 1) { throw "Expected one $Name attachment: $($Entry.Title)" }
  $attachment = $attachments[0]
  if ($attachment.Contains('body')) {
    $raw = $utf8.GetString([Convert]::FromBase64String($attachment.body))
    if ($raw.Contains([char]0xfffd)) { throw "Replacement character in $Name" }
    return $raw | ConvertFrom-Json -AsHashtable -Depth 100
  }
  if ($attachment.Contains('path')) {
    $attachmentPath = [string]$attachment.path
    if (-not [IO.Path]::IsPathRooted($attachmentPath)) {
      $attachmentPath = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ReportPath))) $attachmentPath
    }
    return Read-Json $attachmentPath
  }
  throw "No raw body or path for $Name"
}
function Stats($Samples, [string]$Label) {
  $values = @($Samples)
  if ($values.Count -eq 0) { throw "No raw samples: $Label" }
  $numbers = [Collections.Generic.List[double]]::new()
  foreach ($sample in $values) {
    if ($sample -isnot [ValueType] -or $sample -is [bool]) { throw "Non-numeric raw sample: $Label" }
    $number = [double]$sample
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt 0) { throw "Invalid raw sample: $Label" }
    $numbers.Add($number)
  }
  $sorted = @($numbers | Sort-Object)
  $n = $sorted.Count
  $lower = $sorted[[int][Math]::Floor(($n - 1) / 2)]
  $upper = $sorted[[int][Math]::Floor($n / 2)]
  return [ordered]@{
    N = $n
    MedianMs = ($lower + $upper) / 2
    NearestRankMedianMs = $sorted[[int][Math]::Ceiling($n * 0.5) - 1]
    P95Ms = $sorted[[int][Math]::Ceiling($n * 0.95) - 1]
    MinimumMs = $sorted[0]
    MaximumMs = $sorted[-1]
    Samples = $numbers.ToArray()
  }
}
function Check-Coverage($Actual, $Expected, [string]$Label) {
  foreach ($key in $Expected) { if ($Actual -notcontains $key) { $coverageFailures.Add("Missing $Label/$key") } }
  foreach ($key in $Actual) { if ($Expected -notcontains $key) { $coverageFailures.Add("Unexpected $Label/$key") } }
}
function Row([string]$Kind, [string]$Profile, [int]$Count, [string]$Operation, $Samples) {
  $stats = Stats $Samples "$Kind/$Profile/$Operation"
  return [ordered]@{
    Kind = $Kind; Profile = $Profile; Count = $Count; Operation = $Operation
    Stats = $stats
    Pass = $stats.N -ge 20 -and $stats.MedianMs -le 55 -and $stats.P95Ms -le 100
  }
}
function Check-Embedded($Row, $Embedded) {
  if ([Math]::Abs($Row.Stats.NearestRankMedianMs - [double]$Embedded.medianMs) -gt 0.000001 -or
      [Math]::Abs($Row.Stats.P95Ms - [double]$Embedded.p95Ms) -gt 0.000001) {
    $embeddedSummaryFailures.Add("$($Row.Kind)/$($Row.Profile)/$($Row.Operation)")
  }
}
function Report-Status($Report, [string]$Label, [int]$ExpectedCount) {
  $entries = @(Entries $Report.suites)
  $failed = @($entries | Where-Object { $_.Result.status -ne 'passed' -or $_.Result.retry -ne 0 })
  $configuredRetries = @($Report.config.projects | Where-Object { $_.retries -ne 0 })
  $passed = $entries.Count -eq $ExpectedCount -and $failed.Count -eq 0 -and
    $Report.stats.unexpected -eq 0 -and $Report.stats.flaky -eq 0 -and $Report.stats.skipped -eq 0 -and
    @($Report.errors).Count -eq 0 -and $Report.config.workers -eq 1 -and $configuredRetries.Count -eq 0
  if (-not $passed) { $evidenceFailures.Add("Report status or execution settings failed: $Label") }
  return [ordered]@{
    Entries = $entries.Count; Expected = $ExpectedCount; Workers = $Report.config.workers
    RetriesConfigured = @($Report.config.projects | ForEach-Object { $_.retries })
    FailedOrRetried = @($failed | ForEach-Object { [ordered]@{ Title = $_.Title; Status = $_.Result.status; Retry = $_.Result.retry } })
    Stats = $Report.stats; Errors = $Report.errors; Pass = $passed
  }
}
function Gate($Rows, [int]$ExpectedCount) {
  $values = @($Rows)
  $failed = @($values | Where-Object { -not $_.Pass })
  return [ordered]@{
    Categories = $values.Count; ExpectedCategories = $ExpectedCount
    MinimumN = $(if ($values.Count) { ($values | ForEach-Object { $_.Stats.N } | Measure-Object -Minimum).Minimum } else { $null })
    MaximumMedianMs = $(if ($values.Count) { ($values | ForEach-Object { $_.Stats.MedianMs } | Measure-Object -Maximum).Maximum } else { $null })
    MaximumP95Ms = $(if ($values.Count) { ($values | ForEach-Object { $_.Stats.P95Ms } | Measure-Object -Maximum).Maximum } else { $null })
    Failures = $failed
    Pass = $values.Count -eq $ExpectedCount -and $failed.Count -eq 0
  }
}

function Measure-Run([string]$ShoppingPath, [string]$DragPath) {
$inputFiles = [Collections.Generic.List[object]]::new()
$coverageFailures = [Collections.Generic.List[string]]::new()
$evidenceFailures = [Collections.Generic.List[string]]::new()
$embeddedSummaryFailures = [Collections.Generic.List[string]]::new()

$shopping = Read-Json $ShoppingPath
$drag = Read-Json $DragPath
$shoppingStatus = Report-Status $shopping 'shopping' 24
$dragStatus = Report-Status $drag 'drag' 8
$shoppingRows = [Collections.Generic.List[object]]::new()
$dragRows = [Collections.Generic.List[object]]::new()
$saveRows = [Collections.Generic.List[object]]::new()
$lifecycleRows = [Collections.Generic.List[object]]::new()
$localityRows = [Collections.Generic.List[object]]::new()
$renderers = [Collections.Generic.List[object]]::new()
$shoppingProfiles = @{}
$dragProfiles = @{}
foreach ($entry in @(Entries $shopping.suites)) {
  $data = Payload $entry 'shopping-operation-timings' $ShoppingPath
  $profile = "$($data.count)|$($data.concentrated)|$($data.mapVisible)|$($data.layout)".ToLowerInvariant()
  if ($shoppingProfiles.ContainsKey($profile)) { throw "Duplicate shopping profile: $profile" }
  $shoppingProfiles[$profile] = $true
  Check-Coverage @($data.timings.Keys) @('execute', 'executeRecord', 'focus', 'record', 'next', 'back') "shopping operation/$profile"
  if (@($data.errors).Count) { $evidenceFailures.Add("Runtime errors: shopping/$profile") }
  foreach ($operation in $data.timings.Keys) {
    $row = Row 'shopping' $profile ([int]$data.count) $operation $data.timings[$operation]
    Check-Embedded $row $data.summary[$operation]
    $shoppingRows.Add($row)
  }
  foreach ($name in @('diagnostic', 'executionDiagnostic', 'executionRecordDiagnostic')) {
    if (-not $data.Contains($name)) { continue }
    $byOperation = @{}
    foreach ($sample in $data[$name].samples) {
      if ($sample.phase -ne 'save') { continue }
      if (-not $byOperation.ContainsKey($sample.operation)) { $byOperation[$sample.operation] = [Collections.Generic.List[double]]::new() }
      $byOperation[$sample.operation].Add([double]$sample.durationMs)
    }
    foreach ($operation in $byOperation.Keys) {
      $saveRows.Add([ordered]@{ Kind = 'shopping'; Profile = $profile; Source = $name; Operation = $operation; Stats = Stats $byOperation[$operation].ToArray() "shopping save/$profile/$operation" })
    }
  }
}
$expectedShopping = @(foreach ($count in @(150, 500, 1500)) {
  foreach ($concentrated in @('false', 'true')) { foreach ($mapVisible in @('false', 'true')) {
    foreach ($layout in @('pc', 'smartphone')) { "$count|$concentrated|$mapVisible|$layout" }
  } }
})
Check-Coverage @($shoppingProfiles.Keys) $expectedShopping 'shopping profile'
foreach ($entry in @(Entries $drag.suites)) {
  $data = Payload $entry 'shopping-drag-response' $DragPath
  $count = [int]$data.fixture.count
  $profile = "$count|$($data.input)|$($data.grouped)".ToLowerInvariant()
  if ($dragProfiles.ContainsKey($profile)) { throw "Duplicate drag profile: $profile" }
  $dragProfiles[$profile] = $true
  $scenarios = @('same-boundary', 'boundary-switch', 'multiple-merges', 'mixed', 'offscreen-merge', 'auto-scroll')
  if (-not $data.grouped) { $scenarios += 'rejected' }
  Check-Coverage @($data.records.Keys) @($scenarios + 'drop') "drag operation/$profile"
  Check-Coverage @($data.locality.Keys) $scenarios "drag locality/$profile"
  foreach ($operation in $data.records.Keys) {
    $row = Row 'drag' $profile $count $operation $data.records[$operation].samples
    Check-Embedded $row $data.records[$operation]
    $dragRows.Add($row)
  }
  $saveRows.Add([ordered]@{ Kind = 'drag'; Profile = $profile; Source = 'saveCompletionMs'; Operation = 'drop'; Stats = Stats $data.saveCompletionMs "drag save/$profile" })
  foreach ($metric in @('totalMs', 'fallbackMs', 'intentionalLongPressMs', 'postClonePaintMs')) {
    $lifecycleRows.Add([ordered]@{ Profile = $profile; Stage = "start.$metric"; Stats = Stats @($data.start | ForEach-Object { $_[$metric] }) "drag start/$profile/$metric" })
  }
  $lifecycleRows.Add([ordered]@{ Profile = $profile; Stage = 'end'; Stats = Stats $data.end "drag end/$profile" })
  $renderers.Add([ordered]@{ Profile = $profile; Before = $data.rendererBefore; After = $data.rendererAfter; Browser = $data.browser; UserAgent = $data.userAgent; Build = $data.build; Warmup = $data.warmup })
  $pointerRequests = @($data.pointerIO.delta.mutationRequests).Count
  $pointerTransactions = @($data.pointerIO.delta.completedReadwriteTransactions).Count
  $positive = $data.probeCounting.positiveControl -and $data.probeCounting.pointer -and @($data.positiveControl.counts.Keys).Count -gt 0
  foreach ($scenario in $data.locality.Keys) {
    $probe = $data.locality[$scenario]
    $renders = 0; $remounts = 0; $newMounts = 0
    foreach ($key in $probe.counts.Keys) { $renders += [int]$probe.counts[$key] }
    foreach ($key in $probe.mounts.Keys) {
      if ($probe.mountedBefore -contains $key) { $remounts += [int]$probe.mounts[$key] }
      else { $newMounts += [int]$probe.mounts[$key] }
    }
    $activeProbe = @($probe.known | Where-Object { $_.StartsWith('item:') }).Count -gt 0 -and @($probe.mountedBefore).Count -gt 0
    if ($data.grouped) { $activeProbe = $activeProbe -and @($probe.known | Where-Object { $_.StartsWith('group:') }).Count -gt 0 }
    $requests = @($probe.io.delta.mutationRequests).Count
    $transactions = @($probe.io.delta.completedReadwriteTransactions).Count
    $unexpectedNewMounts = if ($scenario -eq 'auto-scroll') { 0 } else { $newMounts }
    $localityRows.Add([ordered]@{
      Profile = $profile; Scenario = $scenario; RenderUpdates = $renders; ExistingRemounts = $remounts
      NewlyVisibleMounts = $newMounts; UnexpectedNewMounts = $unexpectedNewMounts
      MutationRequests = $requests; CompletedReadwriteTransactions = $transactions
      PointerPhaseMutationRequests = $pointerRequests; PointerPhaseCompletedReadwriteTransactions = $pointerTransactions
      PositiveControl = $positive; ActiveProbe = $activeProbe
      Pass = $renders -eq 0 -and $remounts -eq 0 -and $unexpectedNewMounts -eq 0 -and $requests -eq 0 -and
        $transactions -eq 0 -and $pointerRequests -eq 0 -and $pointerTransactions -eq 0 -and $positive -and $activeProbe
    })
  }
}
$expectedDrag = @(foreach ($count in @(150, 500)) { foreach ($inputMethod in @('native', 'touch')) {
  foreach ($grouped in @('false', 'true')) { "$count|$inputMethod|$grouped" }
} })
Check-Coverage @($dragProfiles.Keys) $expectedDrag 'drag profile'
$requiredGate = Gate @($shoppingRows | Where-Object { $_.Count -in @(150, 500) }) 96
$largeGate = Gate @($shoppingRows | Where-Object { $_.Count -eq 1500 }) 48
$dragGate = Gate $dragRows.ToArray() 60
$localityFailures = @($localityRows | Where-Object { -not $_.Pass })
$localityPass = $localityRows.Count -eq 52 -and $localityFailures.Count -eq 0
$overallPass = $requiredGate.Pass -and $largeGate.Pass -and $dragGate.Pass -and $localityPass -and
  $coverageFailures.Count -eq 0 -and $evidenceFailures.Count -eq 0 -and $embeddedSummaryFailures.Count -eq 0
$summary = [ordered]@{
  DateJst = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Tokyo Standard Time').ToString('yyyy-MM-dd')
  Method = 'All original raw attachment samples; median is the arithmetic mean of the central two values for even N, central value for odd N; p95 is nearest rank ceil(N*0.95)-1. Embedded summaries are cross-checked against nearest-rank values separately.'
  Thresholds = [ordered]@{ MinimumN = 20; MedianMs = 55; P95Ms = 100 }
  CompletionPolicy = 'Save completion and drag start/end lifecycle distributions are separate observations, excluded from operation response gates. No sample is removed; intentional touch long press remains in lifecycle.'
  ConcurrencyPolicy = 'Report worker and retry settings are checked. Absence of concurrent external heavy jobs requires execution-log evidence and cannot be inferred from these reports.'
  Inputs = $inputFiles.ToArray()
  Reports = [ordered]@{ Shopping = $shoppingStatus; Drag = $dragStatus }
  Coverage = [ordered]@{ ShoppingProfiles = $shoppingProfiles.Count; DragProfiles = $dragProfiles.Count; ResponseCategories = $shoppingRows.Count + $dragRows.Count; ExpectedResponseCategories = 204; Failures = $coverageFailures.ToArray() }
  Gates = [ordered]@{ Required150500 = $requiredGate; Existing1500 = $largeGate; Drag = $dragGate }
  Locality = [ordered]@{ Scenarios = $localityRows.Count; ExpectedScenarios = 52; Pass = $localityPass; Failures = $localityFailures; Rows = $localityRows.ToArray() }
  ResponseRows = @($shoppingRows.ToArray()) + @($dragRows.ToArray())
  SaveCompletion = $saveRows.ToArray()
  DragLifecycle = $lifecycleRows.ToArray()
  RendererAndEnvironment = $renderers.ToArray()
  EmbeddedNearestRankSummaryMismatches = $embeddedSummaryFailures.ToArray()
  EvidenceFailures = $evidenceFailures.ToArray()
  OverallPass = $overallPass
}
return $summary
}
function Compare-Rows($Current, $Baseline, [string]$Kind) {
  function Key($Value, [string]$Mode) {
    if ($Mode -eq 'response') { return "$($Value.Kind)|$($Value.Profile)|$($Value.Operation)" }
    if ($Mode -eq 'save') { return "$($Value.Kind)|$($Value.Profile)|$($Value.Source)|$($Value.Operation)" }
    return "$($Value.Profile)|$($Value.Stage)"
  }
  $previous = @{}
  foreach ($row in $Baseline) {
    $key = Key $row $Kind
    if ($previous.ContainsKey($key)) { throw "Duplicate baseline comparison key: $key" }
    $previous[$key] = $row
  }
  $seen = @{}
  $pairs = [Collections.Generic.List[object]]::new()
  $missing = [Collections.Generic.List[string]]::new()
  foreach ($row in $Current) {
    $key = Key $row $Kind
    if ($seen.ContainsKey($key)) { throw "Duplicate current comparison key: $key" }
    $seen[$key] = $true
    if (-not $previous.ContainsKey($key)) { $missing.Add("baseline/$key"); continue }
    $old = $previous[$key]
    $pairs.Add([ordered]@{
      Key = $key; CurrentN = $row.Stats.N; BaselineN = $old.Stats.N
      CurrentMedianMs = $row.Stats.MedianMs; BaselineMedianMs = $old.Stats.MedianMs
      MedianDeltaMs = $row.Stats.MedianMs - $old.Stats.MedianMs
      CurrentP95Ms = $row.Stats.P95Ms; BaselineP95Ms = $old.Stats.P95Ms
      P95DeltaMs = $row.Stats.P95Ms - $old.Stats.P95Ms
    })
  }
  foreach ($key in $previous.Keys) { if (-not $seen.ContainsKey($key)) { $missing.Add("current/$key") } }
  return [ordered]@{
    MatchedCategories = $pairs.Count; Missing = $missing.ToArray(); CoverageMatches = $missing.Count -eq 0
    MaximumMedianIncreaseMs = $(if ($pairs.Count) { ($pairs | ForEach-Object { $_.MedianDeltaMs } | Measure-Object -Maximum).Maximum } else { $null })
    MaximumP95IncreaseMs = $(if ($pairs.Count) { ($pairs | ForEach-Object { $_.P95DeltaMs } | Measure-Object -Maximum).Maximum } else { $null })
    Rows = $pairs.ToArray()
  }
}
if ([bool]$BaselineShoppingPath -ne [bool]$BaselineDragPath) { throw 'Supply both baseline report paths or neither' }
$summary = Measure-Run $ShoppingPath $DragPath
if ($BaselineShoppingPath) {
  $baseline = Measure-Run $BaselineShoppingPath $BaselineDragPath
  $summary['Baseline'] = [ordered]@{
    Inputs = $baseline.Inputs; Reports = $baseline.Reports; Gates = $baseline.Gates
    Coverage = $baseline.Coverage; Locality = $baseline.Locality
    RendererAndEnvironment = $baseline.RendererAndEnvironment; OverallPass = $baseline.OverallPass
  }
  $summary['Comparison'] = [ordered]@{
    Policy = 'Current measurements alone determine OverallPass; baseline timing failures are retained. Both runs use the same arithmetic midpoint median. Deltas are descriptive and do not establish causation.'
    Response = Compare-Rows $summary.ResponseRows $baseline.ResponseRows 'response'
    SaveCompletion = Compare-Rows $summary.SaveCompletion $baseline.SaveCompletion 'save'
    DragLifecycle = Compare-Rows $summary.DragLifecycle $baseline.DragLifecycle 'lifecycle'
  }
}
$fullOutput = [IO.Path]::GetFullPath($OutputPath)
if (@($summary.Inputs.Path) -contains $fullOutput -or ($summary.Contains('Baseline') -and @($summary.Baseline.Inputs.Path) -contains $fullOutput)) { throw 'Output path would overwrite an input file' }
$json = ($summary | ConvertTo-Json -Depth 100).Replace(([string][char]13 + [char]10), [string][char]10) + [char]10
[IO.File]::WriteAllText($fullOutput, $json, [Text.UTF8Encoding]::new($false))
$checkBytes = [IO.File]::ReadAllBytes($fullOutput)
$checkText = $utf8.GetString($checkBytes)
if (($checkBytes.Length -ge 3 -and $checkBytes[0] -eq 239 -and $checkBytes[1] -eq 187 -and $checkBytes[2] -eq 191) -or $checkText.Contains([char]0xfffd) -or $checkText.Contains([char]13)) { throw 'Output encoding verification failed' }
$null = $checkText | ConvertFrom-Json -AsHashtable -Depth 100
[ordered]@{
  Output = $fullOutput; OverallPass = $summary.OverallPass; Categories = $summary.Coverage.ResponseCategories
  Required150500 = $summary.Gates.Required150500; Existing1500 = $summary.Gates.Existing1500; Drag = $summary.Gates.Drag
  LocalityPass = $summary.Locality.Pass; CoverageFailures = $summary.Coverage.Failures; EvidenceFailures = $summary.EvidenceFailures
} | ConvertTo-Json -Depth 100
