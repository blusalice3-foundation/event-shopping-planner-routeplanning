param(
  [string[]]$ChromeReports = @('.tmp-day-completion-chrome-balanced.json'),
  [string[]]$EdgeReports = @('.tmp-day-completion-edge-balanced.json'),
  [string]$BaselineChromeReport = '.tmp-day-completion-backup-baseline-chrome.json',
  [string]$BaselineEdgeReport = '.tmp-day-completion-backup-baseline-edge.json',
  [string]$BaselineIdentity = '.tmp-performance-baseline/dist/release-identity.json',
  [string]$Output = 'docs/performance-day-scoped-completion.samples.json'
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
function Read-Json([string]$Path) {
  $absolute = [IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
  $bytes = [IO.File]::ReadAllBytes($absolute)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { throw "Unexpected BOM: $Path" }
  $content = $strictUtf8.GetString($bytes)
  if ($content.Contains([string][char]0xfffd)) { throw "U+FFFD: $Path" }
  return $content | ConvertFrom-Json
}
function Read-Suite($Suite) {
  foreach ($spec in $Suite.specs) {
    foreach ($test in $spec.tests) {
      foreach ($result in $test.results) {
        if ($result.status -ne 'passed') { throw "Failed browser test: $($spec.title)" }
        foreach ($attachment in $result.attachments) {
          if ($attachment.name -notin @('mode-response-timings', 'backup-comparison-timings', 'visit-response-timings')) { continue }
          $bytes = if ($attachment.body) { [Convert]::FromBase64String($attachment.body) } else { [IO.File]::ReadAllBytes($attachment.path) }
          $content = $strictUtf8.GetString($bytes)
          if ($content.Contains([string][char]0xfffd)) { throw "U+FFFD in attachment: $($attachment.name)" }
          [pscustomobject]@{ kind = $attachment.name; data = ($content | ConvertFrom-Json) }
        }
      }
    }
  }
  foreach ($child in $Suite.suites) { Read-Suite $child }
}
function Read-Samples([string[]]$Paths) {
  foreach ($path in $Paths) { foreach ($suite in (Read-Json $path).suites) { Read-Suite $suite } }
}
function Median($Values) {
  $sorted = @($Values | Sort-Object)
  if (!$sorted.Count) { throw 'Missing samples' }
  if ($sorted.Count % 2) { return [double]$sorted[[Math]::Floor($sorted.Count / 2)] }
  return ([double]$sorted[$sorted.Count / 2 - 1] + [double]$sorted[$sorted.Count / 2]) / 2
}
function P95($Values) {
  $sorted = @($Values | Sort-Object)
  if (!$sorted.Count) { throw 'Missing samples' }
  return [double]$sorted[[Math]::Ceiling($sorted.Count * .95) - 1]
}
$modified = @{
  chrome = @(Read-Samples $ChromeReports)
  msedge = @(Read-Samples $EdgeReports)
}
$baseline = @{
  chrome = @(Read-Samples @($BaselineChromeReport))
  msedge = @(Read-Samples @($BaselineEdgeReport))
}
$currentIdentity = Read-Json 'dist/release-identity.json'
$baselineIdentityValue = Read-Json $BaselineIdentity
foreach ($browser in @('chrome', 'msedge')) {
  foreach ($record in ($modified[$browser] | Where-Object { $_.kind -in @('mode-response-timings', 'backup-comparison-timings') })) {
    if (!$record.data.releaseIdentity -or $record.data.releaseIdentity.roleEntrySha256 -ne $currentIdentity.roleEntrySha256) { throw "Mixed modified artifact: $browser" }
  }
}
foreach ($browser in @('chrome', 'msedge')) {
  foreach ($record in ($baseline[$browser] | Where-Object kind -eq 'backup-comparison-timings')) {
    if (!$record.data.releaseIdentity -or $record.data.releaseIdentity.roleEntrySha256 -ne $baselineIdentityValue.roleEntrySha256) { throw "Mixed baseline artifact: $browser" }
  }
}
$coldRows = @()
$modeRows = @()
$backupRows = @()
foreach ($browser in @('chrome', 'msedge')) {
  $modes = @($modified[$browser] | Where-Object kind -eq 'mode-response-timings' | ForEach-Object { $_.data })
  if ($modes.Count -ne 6) { throw "Expected six mode sessions: $browser" }
  $actualOrder = ($modes | ForEach-Object { "$($_.session):$($_.historicalCount)" }) -join ','
  if ($actualOrder -ne '1:0,1:10000,2:10000,2:0,3:0,3:10000') { throw "Unexpected paired session order: $browser" }
  $visits = @($modified[$browser] | Where-Object kind -eq 'visit-response-timings' | ForEach-Object { $_.data })
  if ($visits.Count -ne 2 -or @($visits | Where-Object decorated).Count -ne 1) { throw "Missing visit fixtures: $browser" }
  foreach ($visit in $visits) {
    if (@($visit.samples | Where-Object operation -eq 'add').Count -ne 5 -or @($visit.samples | Where-Object operation -eq 'remove').Count -ne 5) { throw "Invalid visit sample counts: $browser" }
    foreach ($sample in $visit.samples) {
      if (!$sample.commandMethods.Count -or @($sample.commandMethods | Where-Object { $_ -ne 'day' }).Count) { throw "Non-day visit command: $browser" }
      foreach ($field in @('screenMs', 'savedMs', 'routeMs')) {
        if ($null -eq $sample.$field -or ![double]::IsFinite([double]$sample.$field) -or $sample.$field -lt 0) { throw "Invalid visit timing: $browser, $field" }
      }
    }
  }
  foreach ($record in $modes) {
    if (!$record.headed -or $record.browserChannel -ne $browser -or !$record.browserVersion) { throw "Invalid physical browser binding: $browser" }
    if ($record.measurementOrder -ne "paired-counterbalanced-v1") { throw "Unbalanced measurement order: $browser" }
    if ($record.samples.Count -ne 180) { throw "Expected 180 direction samples per session: $browser" }
    foreach ($group in ($record.samples | Group-Object from, to)) {
      if ($group.Count -ne 30 -or @($group.Group | Where-Object first).Count -ne 1) { throw 'Invalid direction sample count' }
    }
    if (@($record.samples | Group-Object from, to).Count -ne 6) { throw 'Missing direction' }
  }
  $byHistory = @{}
  foreach ($history in @(0, 10000)) {
    $sessions = @($modes | Where-Object historicalCount -eq $history)
    if ((($sessions.session | Sort-Object) -join ',') -ne '1,2,3') { throw "Missing sessions: $browser, $history" }
    $byHistory[$history] = $sessions
  }
  $cold0 = @($byHistory[0].coldExecuteToEditMs)
  $coldHistory = @($byHistory[10000].coldExecuteToEditMs)
  $coldRow = [pscustomobject]@{
    browser = $browser
    countPerHistory = 3
    baselineMedianMs = Median $cold0
    historicalMedianMs = Median $coldHistory
    historicalP95Ms = P95 $coldHistory
    medianIncreaseMs = (Median $coldHistory) - (Median $cold0)
    samplesWithoutHistory = $cold0
    samplesWithHistory = $coldHistory
  }
  $coldRow | Add-Member -NotePropertyName passed -NotePropertyValue ($coldRow.historicalMedianMs -le 200 -and $coldRow.historicalP95Ms -le 300 -and $coldRow.medianIncreaseMs -le 30)
  $coldRows += $coldRow
  foreach ($direction in ($byHistory[0].samples | Group-Object from, to)) {
    $from = $direction.Group[0].from
    $to = $direction.Group[0].to
    $base = @($byHistory[0].samples | Where-Object { $_.from -eq $from -and $_.to -eq $to -and !$_.first } | ForEach-Object durationMs)
    $past = @($byHistory[10000].samples | Where-Object { $_.from -eq $from -and $_.to -eq $to -and !$_.first } | ForEach-Object durationMs)
    $first0 = @($byHistory[0].samples | Where-Object { $_.from -eq $from -and $_.to -eq $to -and $_.first } | ForEach-Object durationMs)
    $firstHistory = @($byHistory[10000].samples | Where-Object { $_.from -eq $from -and $_.to -eq $to -and $_.first } | ForEach-Object durationMs)
    if ($base.Count -ne 87 -or $past.Count -ne 87 -or $first0.Count -ne 3 -or $firstHistory.Count -ne 3) { throw 'Invalid aggregated count' }
    $row = [pscustomobject]@{
      browser = $browser; from = $from; to = $to; countPerHistory = 87
      baselineMedianMs = Median $base
      historicalMedianMs = Median $past
      historicalP95Ms = P95 $past
      medianIncreaseMs = (Median $past) - (Median $base)
      firstCycleMedianWithoutHistoryMs = Median $first0
      firstCycleMedianWithHistoryMs = Median $firstHistory
      firstCycleP95WithHistoryMs = P95 $firstHistory
    }
    $row | Add-Member -NotePropertyName passed -NotePropertyValue ($row.historicalMedianMs -le 200 -and $row.historicalP95Ms -le 300 -and $row.medianIncreaseMs -le 30)
    $modeRows += $row
  }
  foreach ($version in @('baseline', 'modified')) {
    $records = @( $(if ($version -eq 'baseline') { $baseline[$browser] } else { $modified[$browser] }) |
      Where-Object kind -eq 'backup-comparison-timings' | ForEach-Object { $_.data })
    if ((($records.session | Sort-Object) -join ',') -ne '1,2,3') { throw "Missing backup sessions: $browser, $version" }
    foreach ($record in $records) {
      if (!$record.headed -or $record.browserChannel -ne $browser -or !$record.browserVersion -or $record.fixture -ne '500+10000, decorated40000, 1280x900') { throw 'Backup fixture or browser drift' }
    }
    $pure = @($records.samples | Where-Object { !$_.parallel })
    $parallel = @($records.samples | Where-Object parallel)
    if ($pure.Count -ne 3 -or $parallel.Count -ne 3) { throw 'Missing pure/parallel samples' }
    $row = [pscustomobject]@{
      browser = $browser; version = $version; sessions = 3
      pureMaxLongTaskMs = ($pure.longTasks | Measure-Object -Maximum).Maximum ?? 0
      pureMaxFrameGapMs = ($pure.frameGaps | Measure-Object -Maximum).Maximum ?? 0
      pureMedianCompletionMs = Median $pure.completionMs
      parallelMedianInputPaintMs = Median $parallel.inputPaintMs
      parallelMaxInputPaintMs = ($parallel.inputPaintMs | Measure-Object -Maximum).Maximum
      parallelMaxLongTaskMs = ($parallel.longTasks | Measure-Object -Maximum).Maximum ?? 0
      browserVersion = $records[0].browserVersion
    }
    $row | Add-Member -NotePropertyName passed -NotePropertyValue ($version -eq 'baseline' -or ($row.pureMaxLongTaskMs -lt 100 -and $row.parallelMaxInputPaintMs -lt 300))
    $backupRows += $row
  }
}
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$outputData = [ordered]@{
  schemaVersion = 1
  collectedAtUtc = [DateTime]::UtcNow.ToString('o')
  environment = @{ os = $os.Caption; osVersion = $os.Version; cpu = $cpu.Name; logicalProcessors = $cpu.NumberOfLogicalProcessors; memoryGiB = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 1); headed = $true; viewport = @{width=1280;height=900} }
  artifact = @{ modified = $currentIdentity; baseline = $baselineIdentityValue; modifiedSourceDirty = $true; baselineSourceDirty = $false }
  conditions = @{ mode = '500 active items, 40000 sparse cells, historical=0/10000 restored into IDB, six directions x 30 x 3'; backup = '500 active items, 10000 historical items, 40000 decorated cells restored into IDB, pure and concurrent input x 3'; cold = 'first execute-to-edit click after public restore'; completion = 'real click to download event received by runner'; input = 'runner input send time to visible target and two requestAnimationFrame callbacks'; modeMeasurementOrder = 'paired-counterbalanced-v1: 0/10000, 10000/0, 0/10000'; modeApplicationInstrumentation = $false; backupApplicationInstrumentation = $false; visitWorkerMessagesObserved = $true }
  goals = @{ medianMs=200;p95Ms=300;historicalMedianIncreaseMs=30;backupMaxLongTaskMs=100;parallelInputMaxMs=300 }
  summary = @{ cold=$coldRows; modes=$modeRows; backup=$backupRows; passed=@(@($coldRows)+@($modeRows)+@($backupRows) | Where-Object {!$_.passed}).Count -eq 0 }
  raw = @{ modified=$modified;baseline=$baseline }
}
$json = ($outputData | ConvertTo-Json -Depth 100).Replace(([char]13).ToString() + [char]10, [string][char]10) + [char]10
if ($json.Contains([string][char]0xfffd)) { throw 'U+FFFD before save' }
$absoluteOutput = [IO.Path]::GetFullPath((Join-Path $projectRoot $Output))
if (Test-Path -LiteralPath $absoluteOutput) {
  $existingBytes = [IO.File]::ReadAllBytes($absoluteOutput)
  if ($existingBytes.Length -ge 3 -and $existingBytes[0] -eq 239 -and $existingBytes[1] -eq 187 -and $existingBytes[2] -eq 191) { throw "Unexpected output BOM: $Output" }
  $existing = $strictUtf8.GetString($existingBytes)
  if ($existing.Contains([string][char]0xfffd)) { throw "U+FFFD in existing output: $Output" }
  $crlfCount = [regex]::Matches($existing, '\r\n').Count
  $lfCount = [regex]::Matches($existing, '(?<!\r)\n').Count
  if ($crlfCount -and $lfCount) { throw "Mixed output newlines: $Output" }
  if ($crlfCount) { $json = $json.Replace([string][char]10, ([char]13).ToString() + [char]10) }
}
[IO.File]::WriteAllText($absoluteOutput, $json, [Text.UTF8Encoding]::new($false))
$roundTrip = $strictUtf8.GetString([IO.File]::ReadAllBytes($absoluteOutput))
if ($roundTrip -cne $json) { throw 'UTF-8 round-trip failure' }
$coldRows | Format-Table browser,baselineMedianMs,historicalMedianMs,historicalP95Ms,medianIncreaseMs,passed
$modeRows | Format-Table browser,from,to,historicalMedianMs,historicalP95Ms,medianIncreaseMs,passed
$backupRows | Format-Table browser,version,pureMaxLongTaskMs,pureMedianCompletionMs,parallelMaxInputPaintMs,passed
if (!$outputData.summary.passed) { throw 'Performance budget failed; raw samples retained' }
Write-Output "PASS day-scoped performance budgets; saved $Output"
