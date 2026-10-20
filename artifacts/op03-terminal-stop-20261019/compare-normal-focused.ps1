param(
  [Parameter(Mandatory=$true)][string]$Baseline,
  [Parameter(Mandatory=$true)][string]$Final,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [string]$Historical='D:\esp-op03-final\artifacts\op19-final-remediation-20261019\shopping-performance.json',
  [string]$CurrentFull24='D:\esp-op03-evidence\shopping-performance.json',
  [string]$BaselineSourceRoot='D:\esp-op03-base',
  [string]$CurrentSourceRoot='D:\esp-op03-final'
)
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$utf8=[Text.UTF8Encoding]::new($false,$true)
foreach($path in @($Baseline,$Final,$Historical,$CurrentFull24)){if(-not [IO.File]::Exists($path)){throw "Input missing; no output written: $path"}}
function Read-FocusedJson([string]$Path){
  $text=$utf8.GetString([IO.File]::ReadAllBytes($Path))
  if($text.Contains([char]0xfffd)){throw "Replacement character: $Path"}
  return $text.TrimStart([char]0xfeff)|ConvertFrom-Json -AsHashtable -Depth 100
}
function Get-FocusedHash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Get-FocusedStats([object[]]$Values){
  if(-not $Values.Count){throw 'Empty raw distribution'}
  $sorted=[double[]]@($Values|ForEach-Object{
    if($_-isnot [ValueType]-or $_-is [bool]){throw 'Non-numeric timing'}
    $v=[double]$_;if([double]::IsNaN($v)-or [double]::IsInfinity($v)-or $v-lt 0){throw 'Invalid timing'};$v
  }|Sort-Object)
  $n=$sorted.Count
  return [pscustomobject][ordered]@{samples=$n;minimumMs=$sorted[0];p25Ms=$sorted[[int][Math]::Ceiling($n*.25)-1];medianMs=$sorted[[int][Math]::Ceiling($n*.5)-1];p75Ms=$sorted[[int][Math]::Ceiling($n*.75)-1];p95Ms=$sorted[[int][Math]::Ceiling($n*.95)-1];maximumMs=$sorted[-1];meanMs=($sorted|Measure-Object -Average).Average}
}
function Read-FocusedRun([string]$Path){
  $report=Read-FocusedJson $Path
  $matches=[Collections.Generic.List[object]]::new()
  function Visit-FocusedSuite($Suite){
    if($Suite.Contains('specs')){foreach($spec in $Suite.specs){foreach($test in $spec.tests){foreach($result in $test.results){foreach($attachment in $result.attachments){
      if($attachment.name-ne 'shopping-operation-timings'){continue}
      $data=$utf8.GetString([Convert]::FromBase64String($attachment.body))|ConvertFrom-Json -AsHashtable -Depth 100
      if($data.count-ne 1500-or $data.concentrated-or -not $data.mapVisible-or $data.layout-ne 'pc'){continue}
      $matches.Add(@{spec=$spec;test=$test;result=$result;data=$data})
    }}}}}
    if($Suite.Contains('suites')){foreach($child in $Suite.suites){Visit-FocusedSuite $child}}
  }
  foreach($suite in $report.suites){Visit-FocusedSuite $suite}
  if($matches.Count-ne 1){throw "Expected exactly one matching profile attachment: $Path (found $($matches.Count))"}
  $match=$matches[0];$data=$match.data;$result=$match.result
  $names=@($data.timings.Keys|Sort-Object)
  if(($names-join ',')-ne 'back,execute,executeRecord,focus,next,record'){throw 'Unexpected operation set'}
  $operations=[ordered]@{}
  foreach($name in $names){
    $stats=Get-FocusedStats @($data.timings[$name])
    $operations[$name]=[pscustomobject][ordered]@{operation=$name;stats=$stats;pass=($stats.samples-ge 20-and $stats.medianMs-le 55-and $stats.p95Ms-le 100);rawSamples=@($data.timings[$name])}
  }
  $failures=@($operations.Values|Where-Object{-not $_.pass})
  $phaseDiagnostics=[ordered]@{}
  foreach($diagnostic in @('diagnostic','executionDiagnostic','executionRecordDiagnostic')){
    $phaseRows=[ordered]@{}
    foreach($sample in $data[$diagnostic].samples){
      $key="$($sample.operation):$($sample.phase)"
      if(-not $phaseRows.Contains($key)){$phaseRows[$key]=[Collections.Generic.List[object]]::new()}
      $phaseRows[$key].Add($sample.durationMs)
    }
    foreach($key in $phaseRows.Keys){$phaseDiagnostics["$diagnostic|$key"]=[pscustomobject]@{stats=Get-FocusedStats @($phaseRows[$key].ToArray());note='Diagnostic phases, including save completion, are outside operation-response gates'}}
  }
  $runnerPass=($result.status-eq 'passed'-and $report.stats.unexpected-eq 0-and $report.stats.flaky-eq 0-and $report.stats.skipped-eq 0-and @($report.errors).Count-eq 0)
  return [ordered]@{
    reportPath=[IO.Path]::GetFullPath($Path);reportSha256=Get-FocusedHash $Path
    testTitle=$match.spec.title;status=$result.status;retry=$result.retry
    resultStartedAt=$result.startTime;resultDurationMs=$result.duration;reportStats=$report.stats
    runner=@{projectName=$match.test.projectName;projectId=$match.test.projectId;version=$report.config.version;configuredWorkers=$report.config.workers;metadata=$report.config.metadata;workerIndex=$result.workerIndex;parallelIndex=$result.parallelIndex}
    fixture=@{count=$data.count;concentrated=$data.concentrated;mapVisible=$data.mapVisible;layout=$data.layout;visitedCount=$data.visitedCount}
    browserIdentityLimitation='Shopping operation attachments do not capture userAgent/browser binary version; project and runner metadata are retained. Source driver hashes and fixture flags supplement, but do not replace, run attestation.'
    operations=$operations;phaseDiagnostics=$phaseDiagnostics
    gate=@{categories=$operations.Count;expectedCategories=6;minimumSamples=[int]($operations.Values|ForEach-Object{$_.stats.samples}|Measure-Object -Minimum).Minimum;maximumMedianMs=[double]($operations.Values|ForEach-Object{$_.stats.medianMs}|Measure-Object -Maximum).Maximum;maximumP95Ms=[double]($operations.Values|ForEach-Object{$_.stats.p95Ms}|Measure-Object -Maximum).Maximum;failures=$failures;rawSampleGatePass=($operations.Count-eq 6-and $failures.Count-eq 0);playwrightPass=$runnerPass;pass=($operations.Count-eq 6-and $failures.Count-eq 0-and $runnerPass-and @($data.errors).Count-eq 0)}
    errors=$data.errors
  }
}
function Compare-FocusedRows($Left,$Right){
  $rows=[Collections.Generic.List[object]]::new()
  foreach($key in $Left.Keys){
    if(-not $Right.Contains($key)){throw "Missing paired operation $key"}
    $l=$Left[$key].stats;$r=$Right[$key].stats
    $rows.Add([pscustomobject][ordered]@{operation=$key;left=$l;right=$r;medianDeltaMs=$l.medianMs-$r.medianMs;p95DeltaMs=$l.p95Ms-$r.p95Ms})
  }
  return [ordered]@{categories=$rows.Count;maximumMedianIncreaseMs=[double]($rows|Measure-Object -Property medianDeltaMs -Maximum).Maximum;maximumP95IncreaseMs=[double]($rows|Measure-Object -Property p95DeltaMs -Maximum).Maximum;rows=$rows.ToArray()}
}
$historicalRun=Read-FocusedRun $Historical;$fullRun=Read-FocusedRun $CurrentFull24;$baselineRun=Read-FocusedRun $Baseline;$finalRun=Read-FocusedRun $Final
$sourceFiles=[Collections.Generic.List[object]]::new()
foreach($relative in @('tests/browser/responsive-performance.spec.ts','src/persistence/db/atomicRestoreTransaction.ts','package-lock.json','vite.config.ts')){
  $baselinePath=Join-Path $BaselineSourceRoot $relative;$currentPath=Join-Path $CurrentSourceRoot $relative
  $bh=Get-FocusedHash $baselinePath;$ch=Get-FocusedHash $currentPath
  $sourceFiles.Add([pscustomobject]@{path=$relative;baselineSha256=$bh;currentSha256=$ch;identical=($bh-eq $ch)})
}
$fixtureStrings=@($historicalRun.fixture,$fullRun.fixture,$baselineRun.fixture,$finalRun.fixture)|ForEach-Object{$_|ConvertTo-Json -Compress}
$output=[ordered]@{
  method='All six raw timing arrays retained per matching profile, including all original cold samples. Nearest-rank median ceil(n*0.50), p95 ceil(n*0.95), 1-based; stored summaries ignored.'
  thresholds=@{minimumSamples=20;medianMs=55;p95Ms=100}
  authority='Current full24 report is preserved unchanged as the authoritative full operation run. Focused runs diagnose one historically slower profile; they do not replace full-run evidence.'
  causalLimit='Comparison reports differences only. Identical fixture/driver settings and sequential runs do not prove the cause of a timing change.'
  utility=@{path=$PSCommandPath;sha256=Get-FocusedHash $PSCommandPath}
  fixtureAllFourEqual=(@($fixtureStrings|Sort-Object -Unique).Count-eq 1)
  sourceEvidence=@{note='Source hashes inspected at aggregation time, not independent build attestation';baselineRoot=$BaselineSourceRoot;currentRoot=$CurrentSourceRoot;files=$sourceFiles.ToArray()}
  historical=$historicalRun;currentFull24=$fullRun;freshBaseline=$baselineRun;freshFinal=$finalRun
  comparison=@{currentFullVersusHistorical=Compare-FocusedRows $fullRun.operations $historicalRun.operations;freshFinalVersusFreshBaseline=Compare-FocusedRows $finalRun.operations $baselineRun.operations;freshFinalVersusCurrentFull=Compare-FocusedRows $finalRun.operations $fullRun.operations;freshBaselineVersusHistorical=Compare-FocusedRows $baselineRun.operations $historicalRun.operations}
}
[IO.File]::WriteAllText($OutputPath,(($output|ConvertTo-Json -Depth 100).Replace("`r`n","`n")+"`n"),[Text.UTF8Encoding]::new($false))
$null=Read-FocusedJson $OutputPath
[ordered]@{output=$OutputPath;fixtureAllFourEqual=$output.fixtureAllFourEqual;historical=$historicalRun.gate;currentFull24=$fullRun.gate;freshBaseline=$baselineRun.gate;freshFinal=$finalRun.gate;freshFinalVersusFreshBaseline=$output.comparison.freshFinalVersusFreshBaseline}|ConvertTo-Json -Depth 12
