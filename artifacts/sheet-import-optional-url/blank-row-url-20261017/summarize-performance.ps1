param([string]$ArtifactRoot)
$ErrorActionPreference = 'Stop'
$strictUtf8 = [Text.UTF8Encoding]::new($false,$true)
function Read-StrictJson([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $text = $strictUtf8.GetString($bytes)
  if ($text.Contains([char]0xFFFD)) { throw "Replacement character in $Path" }
  return ($text | ConvertFrom-Json)
}
function Save-Json([object]$Value,[string]$Path) {
  $Value | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $Path -Encoding utf8
  $savedText = $strictUtf8.GetString([IO.File]::ReadAllBytes($Path))
  if ($savedText.Contains([char]0xFFFD)) { throw "Replacement character after save: $Path" }
}
function Get-StageSummary([string]$Stage,[int]$ExpectedFiles=16) {
  $stageRoot = Join-Path $ArtifactRoot $Stage
  $files = @(Get-ChildItem -LiteralPath $stageRoot -Recurse -File -Filter 'shopping-operation-timings.json')
  if ($files.Count -ne $ExpectedFiles) { throw "Expected $ExpectedFiles raw files in $Stage, found $($files.Count)" }
  $rows = @()
  $saveRows = @()
  $hashes = @()
  $problems = @()
  foreach ($file in $files) {
    $raw = Read-StrictJson $file.FullName
    $relative = $file.FullName.Substring($stageRoot.Length+1).Replace('\','/')
    $hashes += [ordered]@{ path=$relative; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    if (@($raw.errors).Count -ne 0) { $problems += "Browser errors in $relative" }
    if ($raw.visitedCount -ne $raw.count) { $problems += "Visited count mismatch in $relative" }
    foreach ($entry in $raw.timings.PSObject.Properties) {
      $samples = @($entry.Value | Sort-Object)
      $median = $samples[[Math]::Ceiling($samples.Count * 0.5) - 1]
      $p95 = $samples[[Math]::Ceiling($samples.Count * 0.95) - 1]
      $reported = $raw.summary.($entry.Name)
      $match = $reported.count -eq $samples.Count -and $reported.medianMs -eq $median -and $reported.p95Ms -eq $p95
      $pass = $samples.Count -ge 20 -and $median -le 55 -and $p95 -le 100
      $rows += [ordered]@{ key="$($raw.count)|$($raw.concentrated)|$($raw.mapVisible)|$($raw.layout)|$($entry.Name)"; itemCount=$raw.count; concentrated=$raw.concentrated; mapVisible=$raw.mapVisible; layout=$raw.layout; operation=$entry.Name; sampleCount=$samples.Count; medianMs=$median; p95Ms=$p95; pass=$pass; reportedSummaryMatches=$match; source=$relative }
      if (-not $pass -or -not $match) { $problems += "Response failure: $($rows[-1].key)" }
    }
    foreach ($section in @('diagnostic','executionDiagnostic','executionRecordDiagnostic')) {
      $groups = @($raw.$section.samples | Where-Object { $_.phase -eq 'save' } | Group-Object operation)
      foreach ($group in $groups) {
        $samples = @($group.Group.durationMs | Sort-Object)
        $median = $samples[[Math]::Ceiling($samples.Count * 0.5) - 1]
        $p95 = $samples[[Math]::Ceiling($samples.Count * 0.95) - 1]
        $reported = $raw.$section.summary.("$($group.Name):save")
        $match = $reported.count -eq $samples.Count -and $reported.medianMs -eq $median -and $reported.p95Ms -eq $p95
        $saveRows += [ordered]@{ key="$($raw.count)|$($raw.concentrated)|$($raw.mapVisible)|$($raw.layout)|$section|$($group.Name)"; itemCount=$raw.count; concentrated=$raw.concentrated; mapVisible=$raw.mapVisible; layout=$raw.layout; section=$section; operation=$group.Name; sampleCount=$samples.Count; medianMs=$median; p95Ms=$p95; reportedSummaryMatches=$match; source=$relative }
        if (-not $match) { $problems += "Save summary mismatch: $($saveRows[-1].key)" }
      }
    }
  }
  if ($rows.Count -ne ($ExpectedFiles*6) -or @($rows.key | Sort-Object -Unique).Count -ne ($ExpectedFiles*6)) { throw "Expected $($ExpectedFiles*6) unique groups in $Stage" }
  if ($saveRows.Count -ne ($ExpectedFiles*3)) { throw "Expected $($ExpectedFiles*3) save observation groups in $Stage, found $($saveRows.Count)" }
  $summary = [ordered]@{ stage=$Stage; rawFiles=$files.Count; groups=$rows.Count; minimumSamples=($rows.sampleCount | Measure-Object -Minimum).Minimum; maximumMedianMs=($rows.medianMs | Measure-Object -Maximum).Maximum; maximumP95Ms=($rows.p95Ms | Measure-Object -Maximum).Maximum; allPassed=($problems.Count -eq 0); reportedSummariesMatch=(@($rows | Where-Object {-not $_.reportedSummaryMatches}).Count -eq 0); browserErrors=0; problems=$problems; rawHashes=$hashes; rows=$rows }
  Save-Json $summary (Join-Path $stageRoot 'independent-summary.json')
  Save-Json ([ordered]@{ stage=$Stage; groups=$saveRows.Count; unit='ms'; interpretation='Separate asynchronous save completion observations, outside the 55ms/100ms response gate. Diagnostic sections combine operations and may include save completions from earlier actions; counts vary with async scheduling and are not six per-operation save samples.'; reportedSummariesMatch=(@($saveRows | Where-Object {-not $_.reportedSummaryMatches}).Count -eq 0); rows=$saveRows }) (Join-Path $stageRoot 'save-summary.json')
  if ($problems.Count -ne 0) { throw ($problems -join "`n") }
  return [ordered]@{ response=$summary; saves=$saveRows }
}
$before = Get-StageSummary 'before'
$after = Get-StageSummary 'after'
$beforeRows = @{}
foreach ($row in $before.response.rows) { $beforeRows[$row.key] = $row }
$responseDiffs = @()
foreach ($row in $after.response.rows) {
  if (-not $beforeRows.ContainsKey($row.key)) { throw "Missing before response group: $($row.key)" }
  $prior = $beforeRows[$row.key]
  $responseDiffs += [pscustomobject][ordered]@{ key=$row.key; itemCount=$row.itemCount; concentrated=$row.concentrated; mapVisible=$row.mapVisible; layout=$row.layout; operation=$row.operation; beforeSampleCount=$prior.sampleCount; afterSampleCount=$row.sampleCount; beforeMedianMs=$prior.medianMs; afterMedianMs=$row.medianMs; medianDeltaMs=$row.medianMs-$prior.medianMs; beforeP95Ms=$prior.p95Ms; afterP95Ms=$row.p95Ms; p95DeltaMs=$row.p95Ms-$prior.p95Ms; beforePass=$prior.pass; afterPass=$row.pass }
}
$beforeSaves = @{}
foreach ($row in $before.saves) { $beforeSaves[$row.key] = $row }
$saveDiffs = @()
foreach ($row in $after.saves) {
  if (-not $beforeSaves.ContainsKey($row.key)) { throw "Missing before save group: $($row.key)" }
  $prior = $beforeSaves[$row.key]
  $saveDiffs += [pscustomobject][ordered]@{ key=$row.key; itemCount=$row.itemCount; concentrated=$row.concentrated; mapVisible=$row.mapVisible; layout=$row.layout; section=$row.section; operation=$row.operation; beforeSampleCount=$prior.sampleCount; afterSampleCount=$row.sampleCount; beforeMedianMs=$prior.medianMs; afterMedianMs=$row.medianMs; medianDeltaMs=$row.medianMs-$prior.medianMs; beforeP95Ms=$prior.p95Ms; afterP95Ms=$row.p95Ms; p95DeltaMs=$row.p95Ms-$prior.p95Ms }
}
$beforeBuild = Read-StrictJson (Join-Path $ArtifactRoot 'before/build-provenance.json')
$afterBuild = Read-StrictJson (Join-Path $ArtifactRoot 'after/build-provenance.json')
$distMismatches = @()
foreach ($file in $afterBuild.files) {
  $path = Join-Path 'dist' $file.path
  if (-not (Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { $distMismatches += $file.path }
}
if ($distMismatches.Count -ne 0) { throw "dist changed during after measurement: $($distMismatches -join ',')" }
$beforeWorker = @($beforeBuild.files | Where-Object { $_.path -match '(^|/)persistence\.worker-[^/]+\.js$' })
$afterWorker = @($afterBuild.files | Where-Object { $_.path -match '(^|/)persistence\.worker-[^/]+\.js$' })
if ($beforeWorker.Count -ne 1 -or $afterWorker.Count -ne 1) { throw 'Expected one persistence worker per build' }
$workerSame = $beforeWorker[0].sha256 -eq $afterWorker[0].sha256
$comparison = [ordered]@{ unit='ms'; responseGate=[ordered]@{ minimumSamples=20; medianMsAtMost=55; p95MsAtMost=100 }; before=[ordered]@{groups=$before.response.groups; minimumSamples=$before.response.minimumSamples; maximumMedianMs=$before.response.maximumMedianMs; maximumP95Ms=$before.response.maximumP95Ms; allPassed=$before.response.allPassed}; after=[ordered]@{groups=$after.response.groups; minimumSamples=$after.response.minimumSamples; maximumMedianMs=$after.response.maximumMedianMs; maximumP95Ms=$after.response.maximumP95Ms; allPassed=$after.response.allPassed}; maximumPositiveMedianDelta=($responseDiffs | Sort-Object medianDeltaMs -Descending | Select-Object -First 1); maximumPositiveP95Delta=($responseDiffs | Sort-Object p95DeltaMs -Descending | Select-Object -First 1); responseRows=$responseDiffs; saveObservationLimitations='Save completion durations are separate from input response and are not subject to 55ms/100ms. Diagnostic sections combine multiple operations, asynchronous counts may vary, and matching section/profile observations do not establish a causal regression.'; saveGroups=$saveDiffs.Count; maximumSaveMedianDelta=($saveDiffs | Sort-Object medianDeltaMs -Descending | Select-Object -First 1); maximumSaveP95Delta=($saveDiffs | Sort-Object p95DeltaMs -Descending | Select-Object -First 1); saveRows=$saveDiffs; persistenceWorker=[ordered]@{ beforePath=$beforeWorker[0].path; beforeSha256=$beforeWorker[0].sha256; afterPath=$afterWorker[0].path; afterSha256=$afterWorker[0].sha256; identical=$workerSame }; afterDistProvenanceVerified=$true }
Save-Json $comparison (Join-Path $ArtifactRoot 'comparison.json')
[ordered]@{ before=$comparison.before; after=$comparison.after; maximumPositiveMedianDelta=$comparison.maximumPositiveMedianDelta; maximumPositiveP95Delta=$comparison.maximumPositiveP95Delta; maximumSaveMedianDelta=$comparison.maximumSaveMedianDelta; maximumSaveP95Delta=$comparison.maximumSaveP95Delta; persistenceWorker=$comparison.persistenceWorker; afterDistProvenanceVerified=$comparison.afterDistProvenanceVerified } | ConvertTo-Json -Depth 5
