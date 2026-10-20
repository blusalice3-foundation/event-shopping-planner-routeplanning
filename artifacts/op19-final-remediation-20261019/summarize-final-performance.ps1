[CmdletBinding()]
param(
  [string]$ShoppingPath = (Join-Path $PSScriptRoot 'shopping-performance.json'),
  [string]$DragPath = (Join-Path $PSScriptRoot 'drag-performance.json'),
  [string]$ShoppingBaselinePath = 'D:\event-shopping-planner-routeplanning-1.9.6.7\artifacts\op19-followup\shopping-performance-report.json',
  [string]$DragBaselinePath = (Join-Path $PSScriptRoot 'drag-baseline.json'),
  [string]$SourceCheckPath = (Join-Path $PSScriptRoot 'baseline-source-check.json'),
  [string]$OutputDirectory = $PSScriptRoot
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$summaryMismatches = [Collections.Generic.List[string]]::new()

function Optional($value, [string]$name) {
  if ($null -ne $value -and $null -ne $value.PSObject.Properties[$name]) {
    return ,$value.PSObject.Properties[$name].Value
  }
  return $null
}
function Require-Properties($value, [string[]]$names, [string]$label) {
  if ($null -eq $value) { throw "Missing object: $label" }
  foreach ($name in $names) {
    if ($null -eq $value.PSObject.Properties[$name] -or $null -eq $value.PSObject.Properties[$name].Value) {
      throw "Missing property: $label.$name"
    }
  }
}
function Read-Json([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing input: $path" }
  $raw = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $path).Path, $utf8)
  if ($raw.Contains([char]0xfffd)) { throw "Replacement character in input: $path" }
  return $raw | ConvertFrom-Json
}
function Save-Text([string]$name, [string]$value) {
  $path = Join-Path $OutputDirectory $name
  [IO.File]::WriteAllText($path, $value.Replace("`r`n", "`n").TrimEnd("`r", "`n") + "`n", [Text.UTF8Encoding]::new($false))
  $bytes = [IO.File]::ReadAllBytes($path)
  $check = $utf8.GetString($bytes)
  if (($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) -or $check.Contains("`r") -or $check.Contains([char]0xfffd)) {
    throw "Output encoding verification failed: $path"
  }
}
function Save-Csv([string]$name, $rows) {
  $lines = @($rows | ConvertTo-Csv -NoTypeInformation)
  if ($lines.Count -eq 0) { throw "Empty CSV: $name" }
  Save-Text $name ($lines -join "`n")
}
function Results($suites) {
  foreach ($suite in $suites) {
    foreach ($spec in (Optional $suite 'specs')) {
      foreach ($test in $spec.tests) {
        if (@($test.results).Count -ne 1) { throw "Retry or absent test result: $($spec.title)" }
        $result = $test.results[0]
        if ($result.status -ne 'passed' -or $result.retry -ne 0 -or @($result.errors).Count -ne 0) {
          throw "Incomplete test: $($spec.title)"
        }
        $result
      }
    }
    Results (Optional $suite 'suites')
  }
}
function Report([string]$path, [int]$expected) {
  $value = Read-Json $path
  Require-Properties $value @('stats', 'config', 'suites', 'errors') $path
  if ($value.stats.expected -ne $expected -or $value.stats.skipped -ne 0 -or $value.stats.unexpected -ne 0 -or $value.stats.flaky -ne 0 -or @($value.errors).Count -ne 0) {
    throw "Suite incomplete: $path"
  }
  if ($value.config.workers -ne 1) { throw "Measurement did not use one worker: $path" }
  if (@(Results $value.suites).Count -ne $expected) { throw "Result coverage mismatch: $path" }
  return $value
}
function Attachment($result, [string]$name, [string]$reportPath) {
  $entries = @($result.attachments | Where-Object name -eq $name)
  if ($entries.Count -ne 1) { throw "Missing or duplicate attachment: $name in $reportPath" }
  $entry = $entries[0]
  $body = Optional $entry 'body'
  if ($null -ne $body -and $body -ne '') {
    $text = $utf8.GetString([Convert]::FromBase64String($body))
    if ($text.Contains([char]0xfffd)) { throw "Invalid UTF-8 in attachment: $name" }
    return $text | ConvertFrom-Json
  }
  $path = Optional $entry 'path'
  if ([string]::IsNullOrEmpty($path)) { throw "Empty attachment: $name" }
  if (-not [IO.Path]::IsPathRooted($path)) { $path = Join-Path (Split-Path -Parent $reportPath) $path }
  return Read-Json $path
}
function Metric([string]$build, [string]$kind, [string]$profile, [int]$count, [string]$operation, [string]$stage, [string]$phase, $samples, [bool]$responseGate = $false) {
  $values = @($samples)
  $minimum = if ($responseGate) { 20 } else { 1 }
  if ($values.Count -lt $minimum) { throw "Insufficient samples: $build/$kind/$profile/$stage/$operation/$phase ($($values.Count))" }
  $numbers = [Collections.Generic.List[double]]::new()
  foreach ($sample in $values) {
    if ($null -eq $sample -or $sample -is [string] -or $sample -is [bool]) { throw "Non-numeric sample: $profile/$operation" }
    $number = [double]$sample
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt 0) { throw "Invalid timing sample: $profile/$operation" }
    $numbers.Add($number)
  }
  $sorted = @($numbers | Sort-Object)
  $median = $sorted[[Math]::Ceiling($sorted.Count * 0.5) - 1]
  $p95 = $sorted[[Math]::Ceiling($sorted.Count * 0.95) - 1]
  [pscustomobject]@{
    Build = $build; Kind = $kind; Profile = $profile; Count = $count
    Operation = $operation; Stage = $stage; Phase = $phase; Samples = $sorted.Count
    MedianMs = $median; P95Ms = $p95; MinimumMs = $sorted[0]; MaximumMs = $sorted[-1]
    ResponseGate = $responseGate
    Passed = $(if ($responseGate) { $median -le 55 -and $p95 -le 100 } else { $null })
  }
}
function Compare-Embedded($row, $embedded, [string]$label) {
  Require-Properties $embedded @('medianMs', 'p95Ms') $label
  if ([Math]::Abs($row.MedianMs - [double]$embedded.medianMs) -gt 0.000001 -or [Math]::Abs($row.P95Ms - [double]$embedded.p95Ms) -gt 0.000001) {
    $summaryMismatches.Add($label)
  }
}
function Assert-Keys($actual, $expected, [string]$label) {
  if (@($actual).Count -ne @($expected).Count -or @(Compare-Object @($actual | Sort-Object) @($expected | Sort-Object)).Count -ne 0) {
    throw "Coverage mismatch: $label"
  }
}
function Shopping($report, [string]$path, [string]$build) {
  $profiles = @{}
  $rows = [Collections.Generic.List[object]]::new()
  $diagnostics = [Collections.Generic.List[object]]::new()
  foreach ($result in (Results $report.suites)) {
    $data = Attachment $result 'shopping-operation-timings' $path
    Require-Properties $data @('count', 'concentrated', 'mapVisible', 'layout', 'timings', 'summary', 'errors') 'shopping attachment'
    if (@($data.errors).Count -ne 0) { throw 'Browser error in shopping measurement' }
    $profile = "$($data.count)-$($data.concentrated)-$($data.mapVisible)-$($data.layout)".ToLowerInvariant()
    if ($profiles.ContainsKey($profile)) { throw "Duplicate shopping profile: $profile" }
    $profiles[$profile] = $data
    Assert-Keys $data.timings.PSObject.Properties.Name @('execute', 'executeRecord', 'focus', 'record', 'next', 'back') "shopping operations/$profile"
    foreach ($property in $data.timings.PSObject.Properties) {
      $row = Metric $build 'shopping-response' $profile $data.count $property.Name 'operation' 'response' $property.Value $true
      Compare-Embedded $row $data.summary.($property.Name) "$build/shopping/$profile/$($property.Name)"
      $rows.Add($row)
    }
    foreach ($stage in @('diagnostic', 'executionDiagnostic', 'executionRecordDiagnostic')) {
      Require-Properties $data @($stage) "shopping/$profile"
      Require-Properties $data.($stage) @('samples') "shopping/$profile/$stage"
      $rawSamples = @($data.($stage).samples)
      foreach ($entry in $rawSamples) { Require-Properties $entry @('operation', 'phase', 'durationMs') "shopping/$profile/$stage/sample" }
      foreach ($group in ($rawSamples | Group-Object operation, phase)) {
        $first = $group.Group[0]
        $diagnostics.Add((Metric $build 'shopping-diagnostic' $profile $data.count $first.operation $stage $first.phase @($group.Group.durationMs)))
      }
      if (@($rawSamples | Where-Object phase -eq 'save').Count -eq 0) { throw "Missing save diagnostics: $build/$profile/$stage" }
    }
  }
  $expected = @(foreach ($count in @(150, 500, 1500)) { foreach ($concentrated in @('false', 'true')) { foreach ($mapVisible in @('false', 'true')) { foreach ($layout in @('pc', 'smartphone')) { "$count-$concentrated-$mapVisible-$layout" } } } })
  Assert-Keys $profiles.Keys $expected "$build shopping profiles"
  if ($rows.Count -ne 144) { throw 'Shopping metric coverage mismatch' }
  [pscustomobject]@{ Profiles = $profiles; Rows = @($rows.ToArray()); Diagnostics = @($diagnostics.ToArray()) }
}
function Drag($report, [string]$path, [string]$build) {
  $profiles = @{}
  $rows = [Collections.Generic.List[object]]::new()
  $lifecycle = [Collections.Generic.List[object]]::new()
  $saves = [Collections.Generic.List[object]]::new()
  $localityRows = [Collections.Generic.List[object]]::new()
  foreach ($result in (Results $report.suites)) {
    $data = Attachment $result 'shopping-drag-response' $path
    Require-Properties $data @('fixture', 'input', 'grouped', 'records', 'locality', 'pointerIO', 'start', 'end', 'saveCompletionMs') 'drag attachment'
    $count = $data.fixture.count
    $profile = "$count-$($data.input)-$($data.grouped)".ToLowerInvariant()
    if ($profiles.ContainsKey($profile)) { throw "Duplicate drag profile: $profile" }
    $profiles[$profile] = $data
    $scenarios = @('same-boundary', 'boundary-switch', 'multiple-merges', 'mixed', 'offscreen-merge', 'auto-scroll')
    if (-not $data.grouped) { $scenarios += 'rejected' }
    Assert-Keys $data.records.PSObject.Properties.Name ($scenarios + 'drop') "drag operations/$profile"
    Assert-Keys $data.locality.PSObject.Properties.Name $scenarios "drag locality/$profile"
    foreach ($property in $data.records.PSObject.Properties) {
      Require-Properties $property.Value @('samples', 'medianMs', 'p95Ms') "drag record/$profile/$($property.Name)"
      $row = Metric $build 'drag-response' $profile $count $property.Name 'operation' 'response' $property.Value.samples $true
      Compare-Embedded $row $property.Value "$build/drag/$profile/$($property.Name)"
      $rows.Add($row)
    }
    if (@($data.start).Count -lt 20 -or @($data.end).Count -lt 20) { throw "Missing drag lifecycle samples: $profile" }
    foreach ($field in @('totalMs', 'fallbackMs', 'intentionalLongPressMs', 'postClonePaintMs')) {
      foreach ($entry in $data.start) { Require-Properties $entry @($field) "drag start/$profile" }
      $lifecycle.Add((Metric $build 'drag-lifecycle' $profile $count "start-$field" 'lifecycle' 'response' @($data.start | ForEach-Object { $_.($field) })))
    }
    $lifecycle.Add((Metric $build 'drag-lifecycle' $profile $count 'end' 'lifecycle' 'response' $data.end))
    if (@($data.saveCompletionMs).Count -lt 20) { throw "Missing drag save samples: $profile" }
    $saves.Add((Metric $build 'drag-save' $profile $count 'drop' 'operation' 'save' $data.saveCompletionMs))
    Require-Properties $data.pointerIO @('delta') "drag pointerIO/$profile"
    Require-Properties $data.pointerIO.delta @('mutationRequests', 'completedReadwriteTransactions') "drag pointerIO.delta/$profile"
    $phaseRequests = @($data.pointerIO.delta.mutationRequests).Count
    $phaseTransactions = @($data.pointerIO.delta.completedReadwriteTransactions).Count
    foreach ($scenario in $scenarios) {
      $probe = $data.locality.($scenario)
      Require-Properties $probe @('counts', 'mounts', 'mountedBefore', 'known', 'io') "drag locality/$profile/$scenario"
      if (@($probe.known | Where-Object { $_.StartsWith('item:') }).Count -eq 0 -or @($probe.mountedBefore).Count -eq 0) { throw "Inactive card probe: $profile/$scenario" }
      if ($data.grouped -and @($probe.known | Where-Object { $_.StartsWith('group:') }).Count -eq 0) { throw "Inactive group probe: $profile/$scenario" }
      Require-Properties $probe.io @('delta') "drag locality IO/$profile/$scenario"
      Require-Properties $probe.io.delta @('mutationRequests', 'completedReadwriteTransactions') "drag locality IO delta/$profile/$scenario"
      $updates = 0; $remounts = 0; $newMounts = 0
      foreach ($entry in $probe.counts.PSObject.Properties) {
        if ([double]$entry.Value -lt 0) { throw 'Negative render count' }
        $updates += [int]$entry.Value
      }
      foreach ($entry in $probe.mounts.PSObject.Properties) {
        if ([double]$entry.Value -lt 0) { throw 'Negative mount count' }
        if ($probe.mountedBefore -contains $entry.Name) { $remounts += [int]$entry.Value } else { $newMounts += [int]$entry.Value }
      }
      $requests = @($probe.io.delta.mutationRequests).Count
      $transactions = @($probe.io.delta.completedReadwriteTransactions).Count
      $unexpectedNewMounts = if ($scenario -eq 'auto-scroll') { 0 } else { $newMounts }
      $localityRows.Add([pscustomobject]@{
        Build = $build; Profile = $profile; Scenario = $scenario
        PointerPhaseMutationRequests = $phaseRequests; PointerPhaseReadwriteTransactions = $phaseTransactions
        ScenarioMutationRequests = $requests; ScenarioReadwriteTransactions = $transactions
        UnrelatedUpdates = $updates; PreviouslyMountedRemounts = $remounts
        AutoScrollNewMounts = $(if ($scenario -eq 'auto-scroll') { $newMounts } else { 0 })
        UnexpectedNewMounts = $unexpectedNewMounts
        Passed = ($phaseRequests -eq 0 -and $phaseTransactions -eq 0 -and $requests -eq 0 -and $transactions -eq 0 -and $updates -eq 0 -and $remounts -eq 0 -and $unexpectedNewMounts -eq 0)
      })
    }
  }
  $expected = @(foreach ($count in @(150, 500)) { foreach ($inputMode in @('native', 'touch')) { foreach ($grouped in @('false', 'true')) { "$count-$inputMode-$grouped" } } })
  Assert-Keys $profiles.Keys $expected "$build drag profiles"
  if ($rows.Count -ne 60 -or $localityRows.Count -ne 52) { throw 'Drag metric/locality coverage mismatch' }
  [pscustomobject]@{ Profiles = $profiles; Rows = @($rows.ToArray()); Lifecycle = @($lifecycle.ToArray()); Saves = @($saves.ToArray()); Locality = @($localityRows.ToArray()) }
}
function Metric-Key($row) { "$($row.Kind)|$($row.Profile)|$($row.Stage)|$($row.Operation)|$($row.Phase)" }
function Pairs($current, $baseline, [bool]$required) {
  $index = @{}
  foreach ($row in $baseline) {
    $key = Metric-Key $row
    if ($index.ContainsKey($key)) { throw "Duplicate baseline metric: $key" }
    $index[$key] = $row
  }
  foreach ($row in $current) {
    $key = Metric-Key $row
    $previous = $index[$key]
    if ($required -and $null -eq $previous) { throw "Missing baseline metric: $key" }
    [pscustomobject]@{
      Kind = $row.Kind; Profile = $row.Profile; Count = $row.Count; Operation = $row.Operation; Stage = $row.Stage; Phase = $row.Phase
      BaselineAvailable = ($null -ne $previous); BaselineSamples = $(if ($previous) { $previous.Samples } else { $null }); FinalSamples = $row.Samples
      BaselineMedianMs = $(if ($previous) { $previous.MedianMs } else { $null }); FinalMedianMs = $row.MedianMs
      MedianDeltaMs = $(if ($previous) { $row.MedianMs - $previous.MedianMs } else { $null })
      BaselineP95Ms = $(if ($previous) { $previous.P95Ms } else { $null }); FinalP95Ms = $row.P95Ms
      P95DeltaMs = $(if ($previous) { $row.P95Ms - $previous.P95Ms } else { $null })
    }
  }
}
function Environment-Pairs([string]$kind, $current, $baseline) {
  foreach ($profile in ($current.Keys | Sort-Object)) {
    foreach ($field in @('browser', 'userAgent')) {
      $finalValue = Optional $current[$profile] $field
      $baselineValue = if ($null -ne $baseline -and $baseline.ContainsKey($profile)) { Optional $baseline[$profile] $field } else { $null }
      $available = -not [string]::IsNullOrEmpty($finalValue) -and -not [string]::IsNullOrEmpty($baselineValue)
      [pscustomobject]@{
        Kind = $kind; Profile = $profile; Field = $field; Baseline = $baselineValue; Final = $finalValue
        Status = $(if ($available) { if ($baselineValue -ceq $finalValue) { 'equal' } else { 'different' } } elseif ([string]::IsNullOrEmpty($baselineValue) -and [string]::IsNullOrEmpty($finalValue)) { 'absent-both' } elseif ([string]::IsNullOrEmpty($baselineValue)) { 'absent-baseline' } else { 'absent-final' })
      }
    }
  }
}
function Report-Info([string]$role, [string]$path, $report) {
  [pscustomobject]@{
    Role = $role; Path = [IO.Path]::GetFullPath($path); Sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    StartTime = $report.stats.startTime; DurationMs = $report.stats.duration; Workers = $report.config.workers
    Projects = @($report.config.projects | ForEach-Object name); Tests = $report.stats.expected
  }
}
function Scope-Summary([string]$scope, $rows) {
  [pscustomobject]@{
    Scope = $scope; Metrics = @($rows).Count; Samples = ($rows | Measure-Object Samples -Sum).Sum
    MinimumSamples = ($rows | Measure-Object Samples -Minimum).Minimum
    MaximumMedianMs = ($rows | Measure-Object MedianMs -Maximum).Maximum
    MaximumP95Ms = ($rows | Measure-Object P95Ms -Maximum).Maximum
    Passed = (@($rows | Where-Object Passed -eq $false).Count -eq 0)
  }
}
# Read every required input before writing any derived artifact.
$shoppingReport = Report $ShoppingPath 24
$dragReport = Report $DragPath 8
$shoppingBaselineReport = Report $ShoppingBaselinePath 24
$dragBaselineReport = if (Test-Path -LiteralPath $DragBaselinePath -PathType Leaf) { Report $DragBaselinePath 8 } else { $null }
$sourceCheck = @(Read-Json $SourceCheckPath)
if ($sourceCheck.Count -ne 28) { throw 'Expected 28 baseline source/test hash checks' }
foreach ($entry in $sourceCheck) {
  Require-Properties $entry @('path', 'expected', 'actual', 'matches') 'baseline source check'
  if ($entry.matches -ne $true -or $entry.expected -cne $entry.actual) { throw "Baseline source mismatch: $($entry.path)" }
}
$shopping = Shopping $shoppingReport $ShoppingPath 'final'
$shoppingBaseline = Shopping $shoppingBaselineReport $ShoppingBaselinePath 'baseline'
$drag = Drag $dragReport $DragPath 'final'
$dragBaseline = if ($null -ne $dragBaselineReport) { Drag $dragBaselineReport $DragBaselinePath 'baseline' } else { $null }
$normalRows = @($shoppingBaseline.Rows) + @($shopping.Rows)
$diagnosticRows = @($shoppingBaseline.Diagnostics) + @($shopping.Diagnostics)
$dragRows = @($drag.Rows); $lifecycleRows = @($drag.Lifecycle); $dragSaveRows = @($drag.Saves); $localityRows = @($drag.Locality)
if ($null -ne $dragBaseline) {
  $dragRows = @($dragBaseline.Rows) + $dragRows
  $lifecycleRows = @($dragBaseline.Lifecycle) + $lifecycleRows
  $dragSaveRows = @($dragBaseline.Saves) + $dragSaveRows
  $localityRows = @($dragBaseline.Locality) + $localityRows
}
$normalPairs = @(Pairs $shopping.Rows $shoppingBaseline.Rows $true)
$diagnosticPairs = @(Pairs $shopping.Diagnostics $shoppingBaseline.Diagnostics $false)
$baselineDragRows = if ($null -ne $dragBaseline) { $dragBaseline.Rows } else { @() }
$baselineLifecycleRows = if ($null -ne $dragBaseline) { $dragBaseline.Lifecycle } else { @() }
$baselineSaveRows = if ($null -ne $dragBaseline) { $dragBaseline.Saves } else { @() }
$dragPairs = @(Pairs $drag.Rows $baselineDragRows ($null -ne $dragBaseline))
$lifecyclePairs = @(Pairs $drag.Lifecycle $baselineLifecycleRows ($null -ne $dragBaseline))
$savePairs = @(Pairs $drag.Saves $baselineSaveRows ($null -ne $dragBaseline))
$baselineDragProfiles = if ($null -ne $dragBaseline) { $dragBaseline.Profiles } else { $null }
$environmentPairs = @(Environment-Pairs 'shopping' $shopping.Profiles $shoppingBaseline.Profiles) + @(Environment-Pairs 'drag' $drag.Profiles $baselineDragProfiles)
$projectComparisons = @([pscustomobject]@{ Kind = 'shopping'; Equal = ((@($shoppingReport.config.projects.name | Sort-Object) -join '|') -ceq (@($shoppingBaselineReport.config.projects.name | Sort-Object) -join '|')) })
if ($null -ne $dragBaselineReport) { $projectComparisons += [pscustomobject]@{ Kind = 'drag'; Equal = ((@($dragReport.config.projects.name | Sort-Object) -join '|') -ceq (@($dragBaselineReport.config.projects.name | Sort-Object) -join '|')) } }
$infos = @((Report-Info 'final-shopping' $ShoppingPath $shoppingReport), (Report-Info 'final-drag' $DragPath $dragReport), (Report-Info 'inherited-baseline-shopping' $ShoppingBaselinePath $shoppingBaselineReport))
if ($null -ne $dragBaselineReport) { $infos += Report-Info 'fresh-baseline-drag' $DragBaselinePath $dragBaselineReport }
$shoppingStart = [DateTimeOffset]::Parse($shoppingReport.stats.startTime)
$shoppingEnd = $shoppingStart.AddMilliseconds($shoppingReport.stats.duration)
$dragStart = [DateTimeOffset]::Parse($dragReport.stats.startTime)
$dragEnd = $dragStart.AddMilliseconds($dragReport.stats.duration)
$serial = $shoppingEnd -le $dragStart -or $dragEnd -le $shoppingStart
$summary = @(
  (Scope-Summary 'Required150500' @($shopping.Rows | Where-Object Count -in 150, 500)),
  (Scope-Summary 'Existing1500' @($shopping.Rows | Where-Object Count -eq 1500)),
  (Scope-Summary 'Drag' $drag.Rows)
)
if ($summary[0].Metrics -ne 96 -or $summary[1].Metrics -ne 48 -or $summary[2].Metrics -ne 60) { throw 'Final response coverage mismatch' }
$failures = @($shopping.Rows | Where-Object Passed -eq $false) + @($drag.Rows | Where-Object Passed -eq $false)
$localityFailures = @($localityRows | Where-Object Passed -eq $false)
$environmentFailures = @($environmentPairs | Where-Object Status -eq 'different')
$projectsPassed = @($projectComparisons | Where-Object Equal -eq $false).Count -eq 0
$passed = $failures.Count -eq 0 -and $localityFailures.Count -eq 0 -and $environmentFailures.Count -eq 0 -and $projectsPassed -and $serial -and $summaryMismatches.Count -eq 0
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) { New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null }
Save-Csv 'shopping-operation-rows.csv' $normalRows
Save-Csv 'shopping-operation-pairs.csv' $normalPairs
Save-Csv 'shopping-diagnostic-rows.csv' $diagnosticRows
Save-Csv 'shopping-diagnostic-pairs.csv' $diagnosticPairs
Save-Csv 'shopping-save-rows.csv' @($diagnosticRows | Where-Object Phase -eq 'save')
Save-Csv 'drag-operation-rows.csv' $dragRows
Save-Csv 'drag-operation-pairs.csv' $dragPairs
Save-Csv 'drag-lifecycle-rows.csv' $lifecycleRows
Save-Csv 'drag-lifecycle-pairs.csv' $lifecyclePairs
Save-Csv 'drag-save-rows.csv' $dragSaveRows
Save-Csv 'drag-save-pairs.csv' $savePairs
Save-Csv 'drag-locality-io.csv' $localityRows
Save-Csv 'performance-environment-pairs.csv' $environmentPairs
$pointerRows = @($drag.Locality | Group-Object Profile | ForEach-Object { $_.Group[0] })
$pointerSummary = [ordered]@{
  FinalProfiles = $pointerRows.Count; FinalScenarios = $drag.Locality.Count
  MutationRequests = ($pointerRows | Measure-Object PointerPhaseMutationRequests -Sum).Sum
  ReadwriteTransactions = ($pointerRows | Measure-Object PointerPhaseReadwriteTransactions -Sum).Sum
  ScenarioMutationRequests = ($drag.Locality | Measure-Object ScenarioMutationRequests -Sum).Sum
  ScenarioReadwriteTransactions = ($drag.Locality | Measure-Object ScenarioReadwriteTransactions -Sum).Sum
  UnrelatedUpdates = ($drag.Locality | Measure-Object UnrelatedUpdates -Sum).Sum
  PreviouslyMountedRemounts = ($drag.Locality | Measure-Object PreviouslyMountedRemounts -Sum).Sum
  AutoScrollNewMounts = ($drag.Locality | Measure-Object AutoScrollNewMounts -Sum).Sum
  UnexpectedNewMounts = ($drag.Locality | Measure-Object UnexpectedNewMounts -Sum).Sum
  LocalityOrIOFailures = $localityFailures.Count
}
$document = [ordered]@{
  Date = '2026-10-19'; Passed = $passed
  Criteria = @{ MinimumSamples = 20; MedianMaxMs = 55; P95MaxMs = 100; QuantileMethod = 'nearest rank: sorted[ceil(n*q)-1], q=0.50/0.95' }
  ResponseSummary = $summary; ResponseBudgetFailures = $failures
  SaveTiming = @{ AppliesResponseBudget = $false; ShoppingMetrics = @($shopping.Diagnostics | Where-Object Phase -eq 'save').Count; DragMetrics = $drag.Saves.Count; Rows = @('shopping-save-rows.csv', 'drag-save-rows.csv'); Pairs = @('shopping-diagnostic-pairs.csv', 'drag-save-pairs.csv') }
  LifecycleTiming = @{ AppliesResponseBudget = $false; Metrics = $drag.Lifecycle.Count; Rows = 'drag-lifecycle-rows.csv'; Pairs = 'drag-lifecycle-pairs.csv'; IntentionalTouchDelayRecordedSeparately = $true }
  PointerAndLocality = $pointerSummary
  Baseline = @{ Shopping = 'Inherited measurements, recomputed from raw samples'; Drag = $(if ($null -ne $dragBaseline) { 'Fresh full response measurement' } else { 'Absent; no replacement baseline supplied' }); SourceCheckPath = $SourceCheckPath; SourceChecks = $sourceCheck.Count; AllSourceChecksMatch = $true; SourceCheckSha256 = (Get-FileHash -LiteralPath $SourceCheckPath -Algorithm SHA256).Hash }
  FinalNormalAndDragReportsDoNotOverlap = $serial
  Environment = @{ ProjectComparisons = $projectComparisons; ComparedFields = @('browser', 'userAgent'); Different = $environmentFailures; AbsentFields = @($environmentPairs | Where-Object { $_.Status -like 'absent-*' }); Details = 'performance-environment-pairs.csv' }
  EmbeddedSummaryMismatches = @($summaryMismatches.ToArray())
  Reports = $infos; SummarizerSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
}
Save-Text 'performance-summary.json' ($document | ConvertTo-Json -Depth 15)
$summary | Format-Table -AutoSize
if (-not $passed) { throw 'Performance evidence failed; inspect performance-summary.json and per-operation/locality CSVs' }
