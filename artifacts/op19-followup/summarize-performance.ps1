[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
function Save-Json($name, $value) {
  $json = ($value | ConvertTo-Json -Depth 40).Replace("`r`n", "`n") + "`n"
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot $name), $json, [Text.UTF8Encoding]::new($false))
}
function Test-Results($suites) {
  foreach ($suite in $suites) {
    foreach ($spec in $suite.specs) { foreach ($test in $spec.tests) { foreach ($result in $test.results) { $result } } }
    Test-Results $suite.suites
  }
}
function Attachment($result, $name) {
  $entry = @($result.attachments | Where-Object name -eq $name)
  if ($entry.Count -ne 1) { throw "Missing or duplicate attachment: $name" }
  if ($entry[0].body) { return [Text.UTF8Encoding]::new($false,$true).GetString([Convert]::FromBase64String($entry[0].body)) | ConvertFrom-Json }
  return Get-Content -LiteralPath $entry[0].path -Raw -Encoding utf8 | ConvertFrom-Json
}
function Metric($profile, $operation, $samples) {
  $sorted = @($samples | Sort-Object)
  if ($sorted.Count -lt 20) { throw "Insufficient samples: $profile $operation" }
  $median = $sorted[[Math]::Ceiling($sorted.Count * 0.5) - 1]
  $p95 = $sorted[[Math]::Ceiling($sorted.Count * 0.95) - 1]
  [pscustomobject]@{ Profile=$profile; Operation=$operation; Samples=$sorted.Count; MedianMs=$median; P95Ms=$p95; Passed=($median -le 55 -and $p95 -le 100) }
}
$shoppingReport = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'shopping-performance-report.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ($shoppingReport.stats.expected -ne 24 -or $shoppingReport.stats.unexpected -ne 0 -or $shoppingReport.stats.skipped -ne 0 -or $shoppingReport.stats.flaky -ne 0) { throw 'Shopping suite incomplete' }
$shoppingRows = @(foreach ($result in (Test-Results $shoppingReport.suites)) {
  $data = Attachment $result 'shopping-operation-timings'
  $profile = "$($data.count)-$($data.concentrated)-$($data.mapVisible)-$($data.layout)"
  foreach ($operation in $data.timings.PSObject.Properties) {
    $row = Metric $profile $operation.Name $operation.Value
    $row | Add-Member Count $data.count
    $row | Add-Member Concentrated $data.concentrated
    $row | Add-Member MapVisible $data.mapVisible
    $row | Add-Member Layout $data.layout
    $row
  }
})
if ($shoppingRows.Count -ne 144) { throw 'Shopping operation coverage mismatch' }
$earlier = Get-Content -LiteralPath (Join-Path $repository 'artifacts/user-operation-remediation-20261019/shopping-performance-comparison.json') -Raw -Encoding utf8 | ConvertFrom-Json
$pairs = @(foreach ($row in $shoppingRows) {
  $previous = @($earlier.Rows | Where-Object { $_.Build -eq 'modified' -and $_.Count -eq $row.Count -and $_.Concentrated -eq $row.Concentrated -and $_.MapVisible -eq $row.MapVisible -and $_.Layout -eq $row.Layout -and $_.Operation -eq $row.Operation })
  if ($previous.Count -ne 1) { throw 'Earlier baseline profile missing' }
  [pscustomobject]@{ Profile=$row.Profile; Operation=$row.Operation; EarlierMedianMs=$previous[0].MedianMs; CurrentMedianMs=$row.MedianMs; MedianDeltaMs=$row.MedianMs-$previous[0].MedianMs; EarlierP95Ms=$previous[0].P95Ms; CurrentP95Ms=$row.P95Ms }
})
$dragReport = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'drag-performance-report.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ($dragReport.stats.expected -ne 8 -or $dragReport.stats.unexpected -ne 0 -or $dragReport.stats.skipped -ne 0 -or $dragReport.stats.flaky -ne 0) { throw 'Drag suite incomplete' }
$earlierDragReport = Get-Content -LiteralPath (Join-Path $repository 'artifacts/user-operation-consistency-20261018/drag-post-a554-final-report.json') -Raw -Encoding utf8 | ConvertFrom-Json
$earlierDrag = @{}
foreach ($result in (Test-Results $earlierDragReport.suites)) {
  $data = Attachment $result 'shopping-drag-response'
  $earlierDrag["$($data.fixture.count)-$($data.input)-$($data.grouped)"] = $data
}
$dragRows = @()
$dragPairs = @()
$dragLifecyclePairs = @()
$pointerRequests = 0; $pointerTransactions = 0; $unrelatedUpdates = 0; $unrelatedRemounts = 0
foreach ($result in (Test-Results $dragReport.suites)) {
  $data = Attachment $result 'shopping-drag-response'
  $profile = "$($data.fixture.count)-$($data.input)-$($data.grouped)"
  foreach ($record in $data.records.PSObject.Properties) {
    $row = Metric $profile $record.Name $record.Value.samples
    $dragRows += $row
    $previous = $earlierDrag[$profile].records.($record.Name)
    if (!$previous) { throw "Missing earlier drag metric: $profile $($record.Name)" }
    $dragPairs += [pscustomobject]@{ Profile=$profile; Operation=$record.Name; EarlierMedianMs=$previous.medianMs; CurrentMedianMs=$row.MedianMs; MedianDeltaMs=$row.MedianMs-$previous.medianMs; EarlierP95Ms=$previous.p95Ms; CurrentP95Ms=$row.P95Ms }
  }
  foreach ($operation in @('start-fallback','end')) {
    $currentValues = if ($operation -eq 'start-fallback') { @($data.start | ForEach-Object fallbackMs) } else { @($data.end) }
    $earlierValues = if ($operation -eq 'start-fallback') { @($earlierDrag[$profile].start | ForEach-Object fallbackMs) } else { @($earlierDrag[$profile].end) }
    $currentMetric = Metric $profile $operation $currentValues
    $earlierMetric = Metric $profile $operation $earlierValues
    # Lifecycle values are comparative; do not apply guide/drop absolute budgets.
    $dragLifecyclePairs += [pscustomobject]@{ Profile=$profile; Operation=$operation; Samples=$currentMetric.Samples; EarlierMedianMs=$earlierMetric.MedianMs; CurrentMedianMs=$currentMetric.MedianMs; MedianDeltaMs=$currentMetric.MedianMs-$earlierMetric.MedianMs; EarlierP95Ms=$earlierMetric.P95Ms; CurrentP95Ms=$currentMetric.P95Ms }
  }
  $pointerRequests += @($data.pointerIO.delta.mutationRequests).Count
  $pointerTransactions += @($data.pointerIO.delta.completedReadwriteTransactions).Count
  foreach ($entry in $data.locality.PSObject.Properties) {
    foreach ($count in $entry.Value.counts.PSObject.Properties) { $unrelatedUpdates += $count.Value }
    foreach ($mount in $entry.Value.mounts.PSObject.Properties) { if ($entry.Value.mountedBefore -contains $mount.Name) { $unrelatedRemounts += $mount.Value } }
  }
}
if ($dragRows.Count -ne 60 -or $pointerRequests -ne 0 -or $pointerTransactions -ne 0 -or $unrelatedUpdates -ne 0 -or $unrelatedRemounts -ne 0) { throw 'Drag coverage/locality/IO mismatch' }
$groups = [ordered]@{ Required150500=@($shoppingRows | Where-Object Count -in 150,500); Existing1500=@($shoppingRows | Where-Object Count -eq 1500); Drag=$dragRows }
$summary = @(foreach ($name in $groups.Keys) {
  $rows = $groups[$name]
  [pscustomobject]@{ Scope=$name; Metrics=$rows.Count; Samples=($rows | Measure-Object Samples -Sum).Sum; MinimumSamples=($rows | Measure-Object Samples -Minimum).Minimum; MaximumMedianMs=($rows | Measure-Object MedianMs -Maximum).Maximum; MaximumP95Ms=($rows | Measure-Object P95Ms -Maximum).Maximum; Passed=(@($rows | Where-Object Passed -eq $false).Count -eq 0) }
})
Save-Json 'performance-summary.json' ([ordered]@{ Date='2026-10-19'; Criteria=@{MinimumSamples=20;MedianMaxMs=55;P95MaxMs=100}; EarlierBaseline='Previously measured f59e07e-equivalent source; 92 hashes verified, not newly measured'; Summary=$summary; PointerMutationRequests=$pointerRequests; PointerReadwriteTransactions=$pointerTransactions; UnrelatedUpdates=$unrelatedUpdates; UnrelatedRemounts=$unrelatedRemounts; ShoppingRows=$shoppingRows; ShoppingPairs=$pairs; DragRows=$dragRows; DragPairs=$dragPairs; DragLifecyclePairs=$dragLifecyclePairs })
$shoppingRows | Export-Csv -LiteralPath (Join-Path $PSScriptRoot 'shopping-rows.csv') -NoTypeInformation -Encoding utf8
$pairs | Export-Csv -LiteralPath (Join-Path $PSScriptRoot 'shopping-pairs.csv') -NoTypeInformation -Encoding utf8
$dragRows | Export-Csv -LiteralPath (Join-Path $PSScriptRoot 'drag-rows.csv') -NoTypeInformation -Encoding utf8
$summary | Format-Table -AutoSize
if (@($summary | Where-Object Passed -eq $false).Count) { throw 'Performance budget exceeded' }
