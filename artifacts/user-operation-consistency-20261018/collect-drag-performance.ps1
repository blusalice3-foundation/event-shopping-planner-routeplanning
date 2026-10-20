param(
  [string]$BaselineReport = 'D:\esp-op18\artifacts\user-operation-consistency-20261018\drag-baseline-final-report.json',
  [string]$PostReport = 'D:\esp-op18\artifacts\user-operation-consistency-20261018\drag-post-a554-final-report.json',
  [string]$OutputDirectory = 'D:\esp-op18\artifacts\user-operation-consistency-20261018\drag-final-evidence'
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false,$true)
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$cases = [Collections.Generic.List[object]]::new()
function Read-Suite($suite, $kind) {
  foreach ($spec in $suite.specs) {
    foreach ($test in $spec.tests) {
      $result = @($test.results)[-1]
      foreach ($attachment in $result.attachments) {
        if ($attachment.name -notin @('shopping-drag-response','shopping-drag-baseline-start-end')) { continue }
        $raw = $utf8.GetString([Convert]::FromBase64String($attachment.body))
        $payload = $raw | ConvertFrom-Json
        $count = if ($null -ne $payload.fixture) { $payload.fixture.count } else { $payload.count }
        $group = if ($payload.grouped) { 'on' } else { 'off' }
        $key = "$count-$($payload.input)-$group"
        $path = Join-Path $OutputDirectory "$kind-$key-raw.json"
        [IO.File]::WriteAllText($path,$raw,[Text.UTF8Encoding]::new($false))
        $cases.Add([pscustomobject]@{ kind=$kind; key=$key; title=$spec.title; status=$result.status; raw=$path; payload=$payload })
      }
    }
  }
  foreach ($child in $suite.suites) { Read-Suite $child $kind }
}
function Stats($values) {
  $sorted = @($values | ForEach-Object { [double]$_ } | Sort-Object)
  if (-not $sorted.Count) { throw 'Missing samples' }
  [pscustomobject]@{ count=$sorted.Count; medianMs=$sorted[[math]::Ceiling($sorted.Count*0.5)-1]; p95Ms=$sorted[[math]::Ceiling($sorted.Count*0.95)-1] }
}
foreach ($entry in @(@{path=$BaselineReport; kind='baseline'},@{path=$PostReport; kind='post'})) {
  $report = [IO.File]::ReadAllText($entry.path,$utf8) | ConvertFrom-Json
  if ($report.stats.unexpected -ne 0 -or $report.stats.expected -ne 8) { throw "Expected8 successful cases in $($entry.path)" }
  foreach ($suite in $report.suites) { Read-Suite $suite $entry.kind }
}
if (@($cases | Where-Object kind -eq 'baseline').Count -ne 8 -or @($cases | Where-Object kind -eq 'post').Count -ne 8) { throw 'Missing8+8 raw attachments' }
$operations = [Collections.Generic.List[object]]::new()
$locality = [Collections.Generic.List[object]]::new()
$lifecycle = [Collections.Generic.List[object]]::new()
foreach ($post in @($cases | Where-Object kind -eq 'post')) {
  $p = $post.payload
  $baseline = @($cases | Where-Object { $_.kind -eq 'baseline' -and $_.key -eq $post.key })
  if ($baseline.Count -ne 1) { throw "Missing baseline match for $($post.key)" }
  $b = $baseline[0].payload
  if ($p.start.Count -ne 20 -or $p.end.Count -ne 20 -or $b.start.Count -ne 20 -or $b.end.Count -ne 20) { throw 'Comparable lifecycle must contain exactly20 independent samples' }
  if ($p.probeCounting.comparableStartEnd -ne $false -or $b.probeCounting.comparableStartEnd -ne $false -or $p.probeCounting.drop -ne $false -or $p.probeCounting.pointer -ne $true) { throw 'Unexpected counter phase configuration' }
  $baseStart = Stats @($b.start | ForEach-Object fallbackMs)
  $postStart = Stats @($p.start | ForEach-Object fallbackMs)
  $baseEnd = Stats $b.end
  $postEnd = Stats $p.end
  $lifecycle.Add([pscustomobject]@{
    condition=$post.key; baselineStart=$baseStart; postStart=$postStart; startMedianDeltaMs=$postStart.medianMs-$baseStart.medianMs;
    baselineEnd=$baseEnd; postEnd=$postEnd; endMedianDeltaMs=$postEnd.medianMs-$baseEnd.medianMs;
    baselineRendererBefore=$b.rendererBefore; baselineRendererDuring=$b.start[0].renderer; baselineRendererAfter=$b.rendererAfter;
    postRendererBefore=$p.rendererBefore; postRendererDuring=$p.start[0].renderer; postRendererAfter=$p.rendererAfter;
    intentionalTouchLongPressMs=if ($p.input -eq 'touch') {200} else {0}
  })
  foreach ($operation in $p.records.PSObject.Properties) {
    $stats = Stats $operation.Value.samples
    $pass = $stats.count -ge 20 -and $stats.medianMs -le 55 -and $stats.p95Ms -le 100
    if (-not $pass) { throw "Response threshold failed: $($post.key)/$($operation.Name)" }
    $operations.Add([pscustomobject]@{ condition=$post.key; operation=$operation.Name; count=$stats.count; medianMs=$stats.medianMs; p95Ms=$stats.p95Ms; pass=$pass })
  }
  if ($p.pointerIO.delta.mutationRequests.Count -ne 0 -or $p.pointerIO.delta.completedReadwriteTransactions.Count -ne 0) { throw 'Pointer physicalI/O detected' }
  if (@($p.dropDetails | Where-Object measuredCommitCallbacks -ne 0).Count) { throw 'Drop counter unexpectedly enabled' }
  foreach ($entry in $p.locality.PSObject.Properties) {
    $phase = $entry.Value
    $updates = @($phase.counts.PSObject.Properties).Count
    $remounts = @($phase.mounts.PSObject.Properties | Where-Object { $phase.mountedBefore -contains $_.Name }).Count
    $newMounts = @($phase.mounts.PSObject.Properties).Count
    if ($updates -ne 0 -or $remounts -ne 0 -or ($entry.Name -ne 'auto-scroll' -and $newMounts -ne 0)) { throw "Unrelated key rendered/remounted: $($post.key)/$($entry.Name)" }
    $scrollSamples = if ($entry.Name -eq 'auto-scroll') { @($phase.guideSamples | Where-Object { $_.scrollAfter -gt $_.scrollBefore }).Count } else {0}
    if ($entry.Name -eq 'auto-scroll' -and $scrollSamples -ne 20) { throw 'Product auto-scroll missing' }
    $locality.Add([pscustomobject]@{condition=$post.key; phase=$entry.Name; existingKeyUpdates=$updates; existingKeyRemounts=$remounts; newViewportMountKeys=$newMounts; actualAutoScrollSamples=$scrollSamples; mutationRequests=$phase.io.delta.mutationRequests.Count; completedReadwriteTransactions=$phase.io.delta.completedReadwriteTransactions.Count})
  }
}
$summary = [pscustomobject]@{
  generatedAtUtc=[DateTime]::UtcNow.ToString('o'); baselineCommit='5bf82a364d5b656cfa1e67c5233cfac0564840cf';
  postBundleSha256='A554A5A960F6D3D82A62B381AF7E1D1EC4634310FFD7A5B55E0AA3E8367517DD';
  specSha256=(Get-FileHash -LiteralPath 'D:\esp-op18\tests\browser\shopping-cross-column-drag.spec.ts' -Algorithm SHA256).Hash;
  baselineSpecSha256=(Get-FileHash -LiteralPath 'D:\esp-base18\tests\browser\shopping-cross-column-drag.spec.ts' -Algorithm SHA256).Hash;
  baselineSpecDifference='Post-exclusive autoScroll hit-point selection and opt-in diagnostic fields differ; fixture, viewport, probe, positive controls and standard comparable20 start/end timed behavior remain identical.';
  earlierAttempts=@('drag-baseline-mapless-control-attempt-report.json','drag-baseline-mapless-control-attempt.log','drag-baseline-empty-map-attempt.log','drag-post-auto-hit-attempt.log','drag-auto-hit-control-report.json','drag-auto-edge-control-report.json');
  interruptedAttemptNote='Empty-map baseline and first post were interrupted after diagnostic failures; JSON reporter did not finalize, while logs and browser error-context/screenshot artifacts remain preserved.';
  conditions=8; operationConditions=$operations.Count; responseSamples=($operations | Measure-Object count -Sum).Sum;
  maxMedianMs=($operations | Measure-Object medianMs -Maximum).Maximum; maxP95Ms=($operations | Measure-Object p95Ms -Maximum).Maximum;
  thresholds=@{medianMs=55; p95Ms=100; minimumSamples=20};
  physicalPointerMutationRequests=0; completedPointerReadwriteTransactions=0;
  lifecycleNote='Exactly20 independent start/end samples per configuration; counting disabled on both builds; touch200ms intentional wait recorded separately; no new absolute lifecycle threshold.';
  baselineCrossColumn='Not functioning at5bf82a3; no baseline guide/drop time substituted.';
  operations=$operations.ToArray(); locality=$locality.ToArray(); lifecycle=$lifecycle.ToArray();
  saveCompletion=@($cases | Where-Object kind -eq 'post' | ForEach-Object { [pscustomobject]@{ condition=$_.key; statistics=(Stats $_.payload.saveCompletionMs) } });
  rawCases=@($cases | Select-Object kind,key,status,raw,@{Name='relativePath';Expression={[IO.Path]::GetFileName($_.raw)}})
}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'drag-performance-summary.json'),($summary | ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
$summary | Select-Object conditions,operationConditions,responseSamples,maxMedianMs,maxP95Ms | Format-List