[CmdletBinding()]
param(
  [string]$InitialPath = (Join-Path $PSScriptRoot 'drag-performance.json'),
  [string]$Replication2Path = (Join-Path $PSScriptRoot 'drag-replication-2.json'),
  [string]$Replication3Path = (Join-Path $PSScriptRoot 'drag-replication-3.json'),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'drag-replication-summary.json')
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$evidenceFailures = [Collections.Generic.List[string]]::new()
$inputFiles = [Collections.Generic.List[object]]::new()
$nonTimingFailures = [Collections.Generic.List[object]]::new()
$expectedProfiles = @(foreach ($count in @(150, 500)) { foreach ($inputMethod in @('native', 'touch')) {
  foreach ($grouped in @('false', 'true')) { "$count|$inputMethod|$grouped" }
} })

function Read-Report([string]$Path) {
  $fullPath = (Resolve-Path -LiteralPath $Path).Path
  $bytes = [IO.File]::ReadAllBytes($fullPath)
  $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
  # Strict decoding verifies encoding before JSON values are consumed.
  $raw = $utf8.GetString($bytes)
  if ($raw.Contains([char]0xfffd)) { throw "Replacement character: $fullPath" }
  $inputFiles.Add([ordered]@{
    Path = $fullPath; Sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Encoding = 'UTF-8, strict decoding passed'; Bom = $bom
    Crlf = [regex]::Matches($raw, ([string][char]13 + [char]10)).Count
    LoneLf = [regex]::Matches($raw, '(?<!\r)\n').Count
  })
  return $raw.TrimStart([char]0xfeff) | ConvertFrom-Json -AsHashtable -Depth 100
}
function Entries($Suites) {
  foreach ($suite in $Suites) {
    if ($suite.Contains('specs')) {
      foreach ($spec in $suite.specs) { foreach ($test in $spec.tests) { foreach ($result in $test.results) {
        [pscustomobject]@{ Title = $spec.title; Test = $test; Result = $result }
      } } }
    }
    if ($suite.Contains('suites')) { Entries $suite.suites }
  }
}
function Coverage($Actual, $Expected) {
  $missing = @($Expected | Where-Object { $Actual -notcontains $_ })
  $extra = @($Actual | Where-Object { $Expected -notcontains $_ })
  return [ordered]@{ Expected = @($Expected).Count; Actual = @($Actual).Count; Missing = $missing; Extra = $extra; Pass = $missing.Count -eq 0 -and $extra.Count -eq 0 -and @($Actual).Count -eq @($Expected).Count }
}
function Stats($Samples, [string]$Label) {
  $values = [Collections.Generic.List[double]]::new()
  foreach ($sample in @($Samples)) {
    if ($sample -isnot [ValueType] -or $sample -is [bool]) { throw "Non-numeric sample: $Label" }
    $value = [double]$sample
    if ([double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt 0) { throw "Invalid sample: $Label" }
    $values.Add($value)
  }
  if (-not $values.Count) { throw "No samples: $Label" }
  $sorted = @($values | Sort-Object); $n = $sorted.Count
  $median = ($sorted[[int][Math]::Floor(($n - 1) / 2)] + $sorted[[int][Math]::Floor($n / 2)]) / 2
  $p95 = $sorted[[int][Math]::Ceiling($n * 0.95) - 1]
  return [ordered]@{
    N = $n; MedianMs = $median; P95Ms = $p95
    NearestRankMedianMs = $sorted[[int][Math]::Ceiling($n * 0.5) - 1]
    MinimumMs = $sorted[0]; MaximumMs = $sorted[-1]; Samples = $values.ToArray()
    ThresholdPass = $n -ge 20 -and $median -le 55 -and $p95 -le 100
  }
}
function Gate($Rows, [int]$MinimumSamples) {
  $rowsArray = @($Rows)
  $failures = @($rowsArray | Where-Object { -not $_.Stats.ThresholdPass -or $_.Stats.N -lt $MinimumSamples })
  return [ordered]@{
    Categories = $rowsArray.Count; ExpectedCategories = 60; MinimumN = $(if ($rowsArray.Count) { ($rowsArray | ForEach-Object { $_.Stats.N } | Measure-Object -Minimum).Minimum } else { $null })
    MaximumMedianMs = $(if ($rowsArray.Count) { ($rowsArray | ForEach-Object { $_.Stats.MedianMs } | Measure-Object -Maximum).Maximum } else { $null })
    MaximumP95Ms = $(if ($rowsArray.Count) { ($rowsArray | ForEach-Object { $_.Stats.P95Ms } | Measure-Object -Maximum).Maximum } else { $null })
    Failures = $failures; Pass = $rowsArray.Count -eq 60 -and $failures.Count -eq 0
  }
}
function Canonical($Value) {
  if ($null -eq $Value) { return 'null' }
  if ($Value -is [Collections.IDictionary]) {
    $parts = @(foreach ($key in @($Value.Keys | Sort-Object)) { ($key | ConvertTo-Json -Compress) + ':' + (Canonical $Value[$key]) })
    return '{' + ($parts -join ',') + '}'
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    $parts = @(foreach ($entry in $Value) { Canonical $entry })
    return '[' + ($parts -join ',') + ']'
  }
  return $Value | ConvertTo-Json -Compress -Depth 100
}
function Identity($Data) {
  $before = @($Data.rendererBefore | Sort-Object column | ForEach-Object { [ordered]@{ Column = $_.column; Engine = $_.engine; Strategy = $_.strategy } })
  $after = @($Data.rendererAfter | Sort-Object column | ForEach-Object { [ordered]@{ Column = $_.column; Engine = $_.engine; Strategy = $_.strategy } })
  return [ordered]@{
    Fixture = $Data.fixture; Browser = $Data.browser; UserAgent = $Data.userAgent; Build = $Data.build
    Warmup = $Data.warmup; ProbeCounting = $Data.probeCounting; RendererBefore = $before; RendererAfter = $after
  }
}
function Parse-TimingError($ErrorRecord, $OperationRows) {
  $message = [regex]::Replace([string]$ErrorRecord.message, '\x1b\[[0-?]*[ -/]*[@-~]', '')
  $stack = if ($ErrorRecord.Contains('stack')) { [string]$ErrorRecord.stack } else { $message }
  $opMatch = [regex]::Match($message, '(?m)^Error:\s*(?<operation>[a-z-]+)\s*$')
  $numbers = [regex]::Match($message, '(?s)Expected:\s*<=\s*(?<limit>\d+(?:\.\d+)?)\s+Received:\s*(?<value>\d+(?:\.\d+)?)')
  if (-not $opMatch.Success -or -not $numbers.Success -or -not $message.Contains('expect(received).toBeLessThanOrEqual(expected)')) { return $null }
  $operation = $opMatch.Groups['operation'].Value
  if (-not $OperationRows.ContainsKey($operation)) { return $null }
  $limit = [double]::Parse($numbers.Groups['limit'].Value, [Globalization.CultureInfo]::InvariantCulture)
  $received = [double]::Parse($numbers.Groups['value'].Value, [Globalization.CultureInfo]::InvariantCulture)
  # These are the final two timing assertions in the frozen measured spec.
  $line = if ($limit -eq 55) { 2583 } elseif ($limit -eq 100) { 2584 } else { return $null }
  if ($stack -notmatch ('shopping-cross-column-drag\.spec\.ts:' + $line + ':\d+')) { return $null }
  $stats = $OperationRows[$operation].Stats
  $rawValue = if ($limit -eq 55) { $stats.NearestRankMedianMs } else { $stats.P95Ms }
  if ($received -le $limit -or [Math]::Abs($received - $rawValue) -gt 0.000001) { return $null }
  return [ordered]@{ Operation = $operation; LimitMs = $limit; AssertionValueMs = $received; ArithmeticMedianMs = $stats.MedianMs; P95Ms = $stats.P95Ms; AssertionLine = $line; TimingAssertionOnly = $true; Message = $message }
}
function Analyze-Batch([string]$Name, [string]$Path) {
  $report = Read-Report $Path
  $entries = @(Entries $report.suites)
  $profiles = @{}; $operations = @{}; $identities = @{}
  $locality = [Collections.Generic.List[object]]::new()
  $timingErrors = [Collections.Generic.List[object]]::new()
  $batchFailures = [Collections.Generic.List[string]]::new()
  if ($report.config.workers -ne 1 -or @($report.config.projects | Where-Object { $_.retries -ne 0 }).Count -ne 0) { $batchFailures.Add('Workers must be 1 and retries must be 0') }
  if ($entries.Count -ne 8 -or $report.stats.skipped -ne 0 -or $report.stats.flaky -ne 0) { $batchFailures.Add('Incomplete, skipped or flaky report') }
  foreach ($errorRecord in @($report.errors)) { $nonTimingFailures.Add([ordered]@{ Batch = $Name; Title = 'global report error'; Error = $errorRecord }) }
  foreach ($entry in $entries) {
    if ($entry.Result.retry -ne 0 -or @($entry.Test.results).Count -ne 1) { $batchFailures.Add("Retry or duplicate result: $($entry.Title)") }
    $attachments = @($entry.Result.attachments | Where-Object { $_.name -eq 'shopping-drag-response' })
    if ($attachments.Count -ne 1 -or -not $attachments[0].Contains('body')) {
      $batchFailures.Add("Missing or ambiguous raw attachment: $($entry.Title)")
      $nonTimingFailures.Add([ordered]@{ Batch = $Name; Title = $entry.Title; Error = 'No complete raw shopping-drag-response attachment' })
      continue
    }
    $raw = $utf8.GetString([Convert]::FromBase64String($attachments[0].body))
    if ($raw.Contains([char]0xfffd)) { throw "Replacement character in attachment: $Name/$($entry.Title)" }
    $data = $raw | ConvertFrom-Json -AsHashtable -Depth 100
    $profile = "$($data.fixture.count)|$($data.input)|$($data.grouped)".ToLowerInvariant()
    if ($profiles.ContainsKey($profile)) { throw "Duplicate profile: $Name/$profile" }
    $profiles[$profile] = [ordered]@{ Title = $entry.Title; Status = $entry.Result.status; RendererBefore = $data.rendererBefore; RendererAfter = $data.rendererAfter }
    $identities[$profile] = Identity $data
    $scenarios = @('same-boundary', 'boundary-switch', 'multiple-merges', 'mixed', 'offscreen-merge', 'auto-scroll')
    if (-not $data.grouped) { $scenarios += 'rejected' }
    $opCoverage = Coverage @($data.records.Keys) @($scenarios + 'drop')
    $localCoverage = Coverage @($data.locality.Keys) $scenarios
    if (-not $opCoverage.Pass -or -not $localCoverage.Pass) { $batchFailures.Add("Operation/locality coverage mismatch: $profile") }
    $profileRows = @{}
    foreach ($operation in $data.records.Keys) {
      $record = $data.records[$operation]
      $stats = Stats $record.samples "$Name/$profile/$operation"
      $row = [ordered]@{ Batch = $Name; Profile = $profile; Operation = $operation; Stats = $stats }
      $profileRows[$operation] = $row
      $operations["$profile|$operation"] = $row
      if ($stats.N -ne 20) { $batchFailures.Add("Expected exactly 20 original samples: $profile/$operation, found $($stats.N)") }
      if ([Math]::Abs($stats.NearestRankMedianMs - [double]$record.medianMs) -gt 0.000001 -or [Math]::Abs($stats.P95Ms - [double]$record.p95Ms) -gt 0.000001) { $batchFailures.Add("Embedded summary mismatch: $profile/$operation") }
    }
    if ($data.Contains('diagnosticPerformanceMetrics') -or $data.Contains('dropProbeComparison')) { $batchFailures.Add("Diagnostic instrumentation is not acceptance evidence: $profile") }
    if (@($data.dropDetails | Where-Object { $_.Contains('rpc') -or $_.measuredCommitCallbacks -ne 0 -or $_.probeOverheadMs -ne 0 }).Count -gt 0) { $batchFailures.Add("Diagnostic/drop render probe enabled: $profile") }
    $pointerRequests = @($data.pointerIO.delta.mutationRequests).Count
    $pointerTransactions = @($data.pointerIO.delta.completedReadwriteTransactions).Count
    $positive = $data.probeCounting.positiveControl -and $data.probeCounting.pointer -and -not $data.probeCounting.drop -and @($data.positiveControl.counts.Keys).Count -gt 0
    foreach ($scenario in $data.locality.Keys) {
      $probe = $data.locality[$scenario]
      $updates = 0; $remounts = 0; $newMounts = 0
      foreach ($key in $probe.counts.Keys) { $updates += [int]$probe.counts[$key] }
      foreach ($key in $probe.mounts.Keys) { if ($probe.mountedBefore -contains $key) { $remounts += [int]$probe.mounts[$key] } else { $newMounts += [int]$probe.mounts[$key] } }
      $unexpectedMounts = if ($scenario -eq 'auto-scroll') { 0 } else { $newMounts }
      $requests = @($probe.io.delta.mutationRequests).Count
      $transactions = @($probe.io.delta.completedReadwriteTransactions).Count
      $active = @($probe.known | Where-Object { $_.StartsWith('item:') }).Count -gt 0 -and @($probe.mountedBefore).Count -gt 0
      if ($data.grouped) { $active = $active -and @($probe.known | Where-Object { $_.StartsWith('group:') }).Count -gt 0 }
      $locality.Add([ordered]@{
        Batch = $Name; Profile = $profile; Scenario = $scenario; RenderUpdates = $updates; ExistingRemounts = $remounts
        NewlyVisibleMounts = $newMounts; UnexpectedNewMounts = $unexpectedMounts
        MutationRequests = $requests; CompletedReadwriteTransactions = $transactions
        PointerPhaseMutationRequests = $pointerRequests; PointerPhaseCompletedReadwriteTransactions = $pointerTransactions; PointerSettleMs = $data.pointerIO.settleMs
        ActiveProbe = $active; PositiveControl = $positive
        Pass = $updates -eq 0 -and $remounts -eq 0 -and $unexpectedMounts -eq 0 -and $requests -eq 0 -and $transactions -eq 0 -and $pointerRequests -eq 0 -and $pointerTransactions -eq 0 -and $data.pointerIO.settleMs -ge 500 -and $active -and $positive
      })
    }
    $errors = if ($entry.Result.Contains('errors')) { @($entry.Result.errors) } elseif ($entry.Result.Contains('error')) { @($entry.Result.error) } else { @() }
    if ($entry.Result.status -eq 'failed' -and -not $errors.Count) { $nonTimingFailures.Add([ordered]@{ Batch = $Name; Title = $entry.Title; Error = 'Failed result without identifiable timing error' }) }
    if ($entry.Result.status -notin @('passed', 'failed')) { $nonTimingFailures.Add([ordered]@{ Batch = $Name; Title = $entry.Title; Error = "Result status $($entry.Result.status)" }) }
    foreach ($errorRecord in $errors) {
      $timing = Parse-TimingError $errorRecord $profileRows
      if ($entry.Result.status -eq 'failed' -and $null -ne $timing) { $timingErrors.Add([ordered]@{ Batch = $Name; Profile = $profile; Detail = $timing }) }
      else { $nonTimingFailures.Add([ordered]@{ Batch = $Name; Title = $entry.Title; Error = $errorRecord }) }
    }
  }
  $profileCoverage = Coverage @($profiles.Keys) $expectedProfiles
  if (-not $profileCoverage.Pass) { $batchFailures.Add('Profile coverage mismatch') }
  $gate = Gate @($operations.Values) 20
  $localFailures = @($locality | Where-Object { -not $_.Pass })
  $localPass = $locality.Count -eq 52 -and $localFailures.Count -eq 0
  foreach ($failure in $batchFailures) { $evidenceFailures.Add("$Name/$failure") }
  $batchNonTiming = @($nonTimingFailures | Where-Object { $_.Batch -eq $Name })
  return [ordered]@{
    Name = $Name; Path = [IO.Path]::GetFullPath($Path); ReportStats = $report.stats
    Workers = $report.config.workers; ConfiguredRetries = @($report.config.projects | ForEach-Object { $_.retries })
    ProfileCoverage = $profileCoverage; Profiles = $profiles; Identities = $identities; Operations = $operations
    TimingGate = $gate; TimingAssertionFailures = $timingErrors.ToArray(); NonTimingFailures = $batchNonTiming
    EvidenceFailures = $batchFailures.ToArray()
    Locality = [ordered]@{ Scenarios = $locality.Count; ExpectedScenarios = 52; Pass = $localPass; Failures = $localFailures; Rows = $locality.ToArray() }
    BatchPass = $gate.Pass -and $profileCoverage.Pass -and $localPass -and $batchFailures.Count -eq 0 -and $batchNonTiming.Count -eq 0
  }
}

$batches = @(Analyze-Batch 'initial' $InitialPath; Analyze-Batch 'replication-2' $Replication2Path; Analyze-Batch 'replication-3' $Replication3Path)
if (@($inputFiles.Path | Sort-Object -Unique).Count -ne 3 -or @($inputFiles.Sha256 | Sort-Object -Unique).Count -ne 3) { $evidenceFailures.Add('Three distinct complete measured report files are required') }
$identityRows = [Collections.Generic.List[object]]::new()
foreach ($profile in $expectedProfiles) {
  $available = @($batches | Where-Object { $_.Identities.ContainsKey($profile) })
  $same = $available.Count -eq 3
  $base = if ($same) { Canonical $batches[0].Identities[$profile] } else { '' }
  foreach ($batch in $available) { if ((Canonical $batch.Identities[$profile]) -ne $base) { $same = $false } }
  $identityRows.Add([ordered]@{ Profile = $profile; Match = $same; Metadata = @($available | ForEach-Object { [ordered]@{ Batch = $_.Name; Identity = $_.Identities[$profile] } }) })
}
$pooledRows = [Collections.Generic.List[object]]::new()
foreach ($profile in $expectedProfiles) {
  $grouped = $profile.EndsWith('|true')
  $operationNames = @('same-boundary', 'boundary-switch', 'multiple-merges', 'mixed', 'offscreen-merge', 'auto-scroll', 'drop')
  if (-not $grouped) { $operationNames += 'rejected' }
  foreach ($operation in $operationNames) {
    $key = "$profile|$operation"
    $samples = [Collections.Generic.List[double]]::new()
    $contributions = [Collections.Generic.List[object]]::new()
    foreach ($batch in $batches) {
      if (-not $batch.Operations.ContainsKey($key)) { $evidenceFailures.Add("Missing pooled contribution: $($batch.Name)/$key"); continue }
      $source = $batch.Operations[$key].Stats
      $contributions.Add([ordered]@{ Batch = $batch.Name; N = $source.N; StartIndex = $samples.Count; MedianMs = $source.MedianMs; P95Ms = $source.P95Ms })
      $samples.AddRange([double[]]$source.Samples)
    }
    if ($samples.Count -eq 0) { continue }
    $pooledRows.Add([ordered]@{ Profile = $profile; Operation = $operation; Contributions = $contributions.ToArray(); Stats = Stats $samples.ToArray() "pooled/$key" })
  }
}
$pooledGate = Gate $pooledRows.ToArray() 60
$allIdentitiesMatch = @($identityRows | Where-Object { -not $_.Match }).Count -eq 0
$allLocalityPass = @($batches | Where-Object { -not $_.Locality.Pass }).Count -eq 0
$allCoveragePass = @($batches | Where-Object { -not $_.ProfileCoverage.Pass -or $_.TimingGate.Categories -ne 60 }).Count -eq 0 -and $pooledRows.Count -eq 60 -and @($pooledRows | Where-Object { $_.Stats.N -ne 60 }).Count -eq 0
$acceptance = $pooledGate.Pass -and $allIdentitiesMatch -and $allCoveragePass -and $allLocalityPass -and $nonTimingFailures.Count -eq 0 -and $evidenceFailures.Count -eq 0
function Read-PreservedEvidence([string]$FileName) {
  $evidencePath = Join-Path $PSScriptRoot $FileName
  $bytes = [IO.File]::ReadAllBytes($evidencePath)
  $raw = $utf8.GetString($bytes)
  if ($raw.Contains([char]0xfffd)) { throw "Replacement character in preserved evidence: $FileName" }
  return [ordered]@{
    Path = [IO.Path]::GetFullPath($evidencePath)
    Sha256 = (Get-FileHash -LiteralPath $evidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Encoding = 'UTF-8, strict decoding passed'
    Bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
    Data = $raw.TrimStart([char]0xfeff) | ConvertFrom-Json -AsHashtable -Depth 100
  }
}
$initialSummary = Read-PreservedEvidence 'independent-performance-summary.json'
$sourceManifest = Read-PreservedEvidence 'measured-source-manifest.json'
$plan = Read-PreservedEvidence 'replication-plan.json'
$execution = Read-PreservedEvidence 'replication-execution.json'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$sourceMismatches = [Collections.Generic.List[object]]::new()
foreach ($file in $sourceManifest.Data) {
  $currentPath = [IO.Path]::GetFullPath((Join-Path $repository $file.path))
  if (-not $currentPath.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source manifest path leaves the repository' }
  $hash = if (Test-Path -LiteralPath $currentPath -PathType Leaf) { (Get-FileHash -LiteralPath $currentPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
  if ($hash -ne $file.sha256) { $sourceMismatches.Add([ordered]@{ Path = $file.path; ExpectedSha256 = $file.sha256; ActualSha256 = $hash }) }
}
$sourcePass = @($sourceManifest.Data).Count -gt 0 -and $sourceMismatches.Count -eq 0
$protocolPass = $plan.Data.additionalFullRuns -eq 2 -and $plan.Data.totalBatches -eq 3 -and
  $plan.Data.expectedSamplesPerDragCategory -eq 60 -and $plan.Data.categoriesPerBatch -eq 60 -and $plan.Data.configurationsPerBatch -eq 8 -and
  $plan.Data.thresholds.medianMs -eq 55 -and $plan.Data.thresholds.p95Ms -eq 100 -and $plan.Data.thresholds.minimumSamples -eq 20 -and
  $plan.Data.sourceManifestSha256 -eq $sourceManifest.Sha256 -and $plan.Data.initialDragReportSha256 -eq $inputFiles[0].Sha256
$executionRows = @($execution.Data | Sort-Object round)
$executionPass = $executionRows.Count -eq 2 -and (@($executionRows.round) -join ',') -eq '2,3'
$previousEnd = [DateTimeOffset]::Parse($plan.Data.decidedUtc)
foreach ($run in $executionRows) {
  $start = [DateTimeOffset]::Parse($run.startUtc); $end = [DateTimeOffset]::Parse($run.endUtc)
  if ($run.workers -ne 1 -or $run.retries -ne 0 -or $run.concurrentHeavyTests -ne $false -or $start -lt $previousEnd -or $end -lt $start) { $executionPass = $false }
  $previousEnd = $end
}
if (-not $sourcePass) { $evidenceFailures.Add('Current source differs from the frozen measured source manifest') }
if (-not $protocolPass) { $evidenceFailures.Add('Fixed replication protocol or its initial report/source identity mismatch') }
if (-not $executionPass) { $evidenceFailures.Add('Fixed additional replication execution record mismatch') }
$acceptance = $acceptance -and $sourcePass -and $protocolPass -and $executionPass
$summary = [ordered]@{
  DateJst = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Tokyo Standard Time').ToString('yyyy-MM-dd')
  Policy = 'Additional acceptance evaluation fixed after the initial 20-sample failure: exactly two further full eight-configuration batches, all initial and subsequent samples included. Initial results remain unchanged. Diagnostic trace/CPU profiles are excluded. No retry, trimming, warmup removal or successful-batch selection.'
  Method = 'Arithmetic midpoint median for even N; nearest-rank p95 ceil(N*0.95)-1. Embedded harness medians are independently cross-checked using nearest rank; pooled samples retain initial, replication-2, replication-3 order.'
  Thresholds = [ordered]@{ MinimumN = 20; MedianMs = 55; P95Ms = 100; AdditionalProtocolBatches = 3; SamplesPerBatchPerCategory = 20; PooledNPerCategory = 60 }
  TimingErrorPolicy = 'Only failed <=55 median assertions at frozen spec line 2583 or <=100 p95 assertions at line 2584 are timing-only, and their Received value must match the raw nearest-rank statistic. Every other error, skipped/interrupted result, missing attachment, retry, or instrumentation discrepancy rejects acceptance.'
  ExecutionLimits = 'Source freezing and absence of simultaneous external heavy work require the separate execution log/source manifest; they cannot be independently inferred from reporter JSON. Renderer mount counts are retained as observations; renderer engine/strategy and fixture/browser/build/probe/warmup metadata must match.'
  Inputs = $inputFiles.ToArray()
  PreservedInitialSummary = [ordered]@{ Path = $initialSummary.Path; Sha256 = $initialSummary.Sha256; OriginalOverallPass = $initialSummary.Data.OverallPass; OriginalDragGate = $initialSummary.Data.Gates.Drag }
  SourceValidation = [ordered]@{ ManifestPath = $sourceManifest.Path; ManifestSha256 = $sourceManifest.Sha256; FilesChecked = @($sourceManifest.Data).Count; Mismatches = $sourceMismatches.ToArray(); Pass = $sourcePass; Limitation = 'All files match the pre-measurement manifest at aggregation time; continuous freeze during each batch is additionally attested by the fixed execution protocol.' }
  FixedReplicationProtocol = [ordered]@{ Path = $plan.Path; Sha256 = $plan.Sha256; Data = $plan.Data; Pass = $protocolPass }
  ReplicationExecution = [ordered]@{ Path = $execution.Path; Sha256 = $execution.Sha256; Data = $execution.Data; Pass = $executionPass }
  BatchResults = $batches
  PooledGate = $pooledGate; PooledRows = $pooledRows.ToArray()
  Coverage = [ordered]@{ BatchCount = $batches.Count; ConfigurationsPerBatch = 8; CategoriesPerBatch = 60; PooledCategories = $pooledRows.Count; TotalExpectedSamples = 3600; TotalActualSamples = ($pooledRows | ForEach-Object { $_.Stats.N } | Measure-Object -Sum).Sum; Pass = $allCoveragePass }
  Identity = [ordered]@{ Pass = $allIdentitiesMatch; Rows = $identityRows.ToArray() }
  AllLocalityAndPointerIoPassed = $allLocalityPass
  NonTimingFailureCount = $nonTimingFailures.Count; NonTimingFailures = $nonTimingFailures.ToArray(); EvidenceFailures = $evidenceFailures.ToArray()
  AllBatchesPassed = @($batches | Where-Object { -not $_.BatchPass }).Count -eq 0
  AcceptancePass = $acceptance
}
$fullOutput = [IO.Path]::GetFullPath($OutputPath)
if (@($inputFiles.Path) -contains $fullOutput -or [IO.Path]::GetFileName($fullOutput) -in @('independent-performance-summary.json', 'shopping-performance.json', 'drag-performance.json')) { throw 'Output would overwrite preserved evidence' }
if (Test-Path -LiteralPath $fullOutput) { throw "Output already exists; preserve the prior summary: $fullOutput" }
foreach ($preserved in @($initialSummary, $sourceManifest, $plan, $execution)) {
  if ((Get-FileHash -LiteralPath $preserved.Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $preserved.Sha256) { throw 'Preserved evidence changed during aggregation' }
}
$json = ($summary | ConvertTo-Json -Depth 100).Replace(([string][char]13 + [char]10), [string][char]10) + [char]10
[IO.File]::WriteAllText($fullOutput, $json, [Text.UTF8Encoding]::new($false))
$checkBytes = [IO.File]::ReadAllBytes($fullOutput)
$check = $utf8.GetString($checkBytes)
if (($checkBytes.Length -ge 3 -and $checkBytes[0] -eq 239 -and $checkBytes[1] -eq 187 -and $checkBytes[2] -eq 191) -or $check.Contains([char]0xfffd) -or $check.Contains([char]13)) { throw 'Output encoding validation failed' }
$null = $check | ConvertFrom-Json -AsHashtable -Depth 100
[ordered]@{
  Output = $fullOutput; AcceptancePass = $acceptance; AllBatchesPassed = $summary.AllBatchesPassed
  PooledGate = $pooledGate; CoveragePass = $allCoveragePass; IdentityPass = $allIdentitiesMatch
  LocalityPass = $allLocalityPass; NonTimingFailureCount = $nonTimingFailures.Count; EvidenceFailures = $evidenceFailures.ToArray()
  Batches = @($batches | ForEach-Object { [ordered]@{ Name = $_.Name; BatchPass = $_.BatchPass; TimingGate = $_.TimingGate; TimingAssertionFailures = $_.TimingAssertionFailures.Count; NonTimingFailures = $_.NonTimingFailures.Count } })
} | ConvertTo-Json -Depth 100
