param(
  [Parameter(Mandatory=$true)][string]$Initial,
  [Parameter(Mandatory=$true)][string]$Baseline,
  [Parameter(Mandatory=$true)][string]$Final,
  [Parameter(Mandatory=$true)][string]$OutputPath,
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
foreach($path in @($Initial,$Baseline,$Final)) { if(-not [IO.File]::Exists($path)){throw "Input report missing; no output written: $path"} }
function Read-Json([string]$Path) {
  $text=$utf8.GetString([IO.File]::ReadAllBytes($Path))
  if($text.Contains([char]0xfffd)){throw "Replacement character in $Path"}
  return $text.TrimStart([char]0xfeff)|ConvertFrom-Json -AsHashtable -Depth 100
}
function Hash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Stats([object[]]$Samples){
  if(-not $Samples.Count){throw 'Empty raw timing distribution'}
  $sorted=[double[]]@($Samples|ForEach-Object {
    if($_ -isnot [ValueType] -or $_ -is [bool]){throw 'Non-numeric timing sample'}
    $v=[double]$_
    if([double]::IsNaN($v)-or [double]::IsInfinity($v)-or $v-lt 0){throw 'Invalid timing sample'}
    $v
  }|Sort-Object)
  $n=$sorted.Count;$mean=($sorted|Measure-Object -Average).Average
  return [pscustomobject][ordered]@{
    n=$n;minimumMs=$sorted[0]
    p25Ms=$sorted[[int][Math]::Ceiling($n*.25)-1]
    medianMs=$sorted[[int][Math]::Ceiling($n*.5)-1]
    p75Ms=$sorted[[int][Math]::Ceiling($n*.75)-1]
    p95Ms=$sorted[[int][Math]::Ceiling($n*.95)-1]
    maximumMs=$sorted[-1];meanMs=$mean
    standardDeviationMs=[Math]::Sqrt(((@($sorted|ForEach-Object{[Math]::Pow($_-$mean,2)})|Measure-Object -Sum).Sum)/$n)
  }
}
function Gate($Rows,[int]$Expected){
  $failures=@($Rows|Where-Object{$_.stats.n-lt 20-or $_.stats.medianMs-gt 55-or $_.stats.p95Ms-gt 100})
  return [ordered]@{
    expectedCategories=$Expected;categories=@($Rows).Count
    minimumSamples=[int]($Rows|ForEach-Object{$_.stats.n}|Measure-Object -Minimum).Minimum
    maximumMedianMs=[double]($Rows|ForEach-Object{$_.stats.medianMs}|Measure-Object -Maximum).Maximum
    maximumP95Ms=[double]($Rows|ForEach-Object{$_.stats.p95Ms}|Measure-Object -Maximum).Maximum
    failures=$failures
    pass=(@($Rows).Count-eq $Expected-and $failures.Count-eq 0)
  }
}
function Add-Row($Table,[string]$Key,[object[]]$Samples,$Extra=@{}){
  if($Table.Contains($Key)){throw "Duplicate timing category: $Key"}
  $row=[ordered]@{key=$Key;stats=Stats $Samples}
  foreach($name in $Extra.Keys){$row[$name]=$Extra[$name]}
  $Table[$Key]=[pscustomobject]$row
}
function Decode([string]$Path){
  $json=Read-Json $Path
  $cases=[ordered]@{};$operations=[ordered]@{};$metrics=[ordered]@{}
  $locality=[Collections.Generic.List[object]]::new()
  function Visit($Suite){
    if($Suite.Contains('specs')){foreach($spec in $Suite.specs){foreach($test in $spec.tests){foreach($result in $test.results){foreach($attachment in $result.attachments){
      if($attachment.name-ne 'shopping-drag-response'){continue}
      if(-not $attachment.Contains('body')){throw 'Raw attachment body missing'}
      $data=$utf8.GetString([Convert]::FromBase64String($attachment.body))|ConvertFrom-Json -AsHashtable -Depth 100
      $key="items=$($data.fixture.count)|input=$($data.input)|grouped=$($data.grouped)"
      if($cases.Contains($key)){throw "Duplicate run/retry condition: $key"}
      $case=[ordered]@{key=$key;status=$result.status;retry=$result.retry;durationMs=$result.duration;fixture=$data.fixture;browser=$data.browser;userAgent=$data.userAgent;build=$data.build;warmup=$data.warmup;probeCounting=$data.probeCounting;rendererBefore=$data.rendererBefore;rendererAfter=$data.rendererAfter;raw=$data}
      $cases[$key]=[pscustomobject]$case
      foreach($op in $data.records.Keys){Add-Row $operations "$key|$op" @($data.records[$op].samples) @{condition=$key;operation=$op;testStatus=$result.status}}
      Add-Row $metrics "$key|saveCompletion" @($data.saveCompletionMs) @{phase='save completion; outside operation response gate'}
      Add-Row $metrics "$key|end" @($data.end) @{phase='drag lifecycle; outside operation response gate'}
      foreach($field in @('totalMs','fallbackMs','intentionalLongPressMs','postClonePaintMs')){Add-Row $metrics "$key|start.$field" @($data.start|ForEach-Object{$_[$field]}) @{phase='drag lifecycle; intentional long press retained'}}
      foreach($field in @('dispatchMs','observedMs','paintedMs','probeOverheadMs','commitCallbacks','measuredCommitCallbacks')){Add-Row $metrics "$key|drop.$field" @($data.dropDetails|ForEach-Object{$_[$field]}) @{phase='raw dropDetails diagnostic'}}
      Add-Row $metrics "$key|dispatchToObserved" @($data.dropDetails|ForEach-Object{$_.observedMs-$_.dispatchMs}) @{phase='raw dropDetails diagnostic'}
      Add-Row $metrics "$key|observedToPaint" @($data.dropDetails|ForEach-Object{$_.paintedMs-$_.observedMs}) @{phase='raw dropDetails diagnostic'}
      foreach($scenario in $data.locality.Keys){
        $local=$data.locality[$scenario];$renders=0;$remounts=0;$newMounts=0
        foreach($value in $local.counts.Values){$renders+=[int]$value}
        foreach($mounted in $local.mounts.Keys){if($local.mountedBefore-contains $mounted){$remounts+=[int]$local.mounts[$mounted]}else{$newMounts+=[int]$local.mounts[$mounted]}}
        $locality.Add([pscustomobject][ordered]@{key="$key|$scenario";renderUpdates=$renders;existingRemounts=$remounts;newlyVisibleMounts=$newMounts;mutationRequests=@($local.io.delta.mutationRequests).Count;readwriteTransactions=@($local.io.delta.completedReadwriteTransactions).Count})
      }
    }}}}}
    if($Suite.Contains('suites')){foreach($child in $Suite.suites){Visit $child}}
  }
  foreach($suite in $json.suites){Visit $suite}
  $gate=Gate @($operations.Values) 60
  $allPassed=($json.stats.unexpected-eq 0-and $json.stats.skipped-eq 0-and $json.stats.flaky-eq 0-and @($json.errors).Count-eq 0-and @($cases.Values|Where-Object{$_.status-ne 'passed'}).Count-eq 0)
  $localityFailures=@($locality|Where-Object{$_.renderUpdates-ne 0-or $_.existingRemounts-ne 0-or $_.mutationRequests-ne 0-or $_.readwriteTransactions-ne 0})
  $pointerRequests=0;$pointerWrites=0
  foreach($case in $cases.Values){$pointerRequests+=@($case.raw.pointerIO.delta.mutationRequests).Count;$pointerWrites+=@($case.raw.pointerIO.delta.completedReadwriteTransactions).Count}
  $localityPass=($locality.Count-eq 52-and $localityFailures.Count-eq 0-and $pointerRequests-eq 0-and $pointerWrites-eq 0)
  return [ordered]@{
    reportPath=[IO.Path]::GetFullPath($Path);reportSha256=Hash $Path;playwrightStats=$json.stats
    allAttachmentsIncluded=$true;conditions=$cases.Count;conditionRows=$cases;operations=$operations;metrics=$metrics
    fullRunOperationGate=$gate;playwrightAllPassed=$allPassed
    acceptancePass=($gate.pass-and $allPassed-and $cases.Count-eq 8-and $localityPass)
    locality=@{scenarios=$locality.Count;pointerMutationRequests=$pointerRequests;pointerReadwriteTransactions=$pointerWrites;failures=$localityFailures;pass=$localityPass;rows=$locality.ToArray()}
  }
}
function Compare-TimingRows($Left,$Right){
  $rows=[Collections.Generic.List[object]]::new();$missing=[Collections.Generic.List[string]]::new()
  foreach($key in $Left.Keys){
    if(-not $Right.Contains($key)){$missing.Add("right:$key");continue}
    $l=$Left[$key].stats;$r=$Right[$key].stats
    $rows.Add([pscustomobject][ordered]@{key=$key;left=$l;right=$r;medianDeltaMs=$l.medianMs-$r.medianMs;p95DeltaMs=$l.p95Ms-$r.p95Ms})
  }
  foreach($key in $Right.Keys){if(-not $Left.Contains($key)){$missing.Add("left:$key")}}
  return [ordered]@{matchedCategories=$rows.Count;missing=$missing.ToArray();maximumMedianIncreaseMs=[double]($rows|Measure-Object -Property medianDeltaMs -Maximum).Maximum;maximumP95IncreaseMs=[double]($rows|Measure-Object -Property p95DeltaMs -Maximum).Maximum;rows=$rows.ToArray()}
}
$initialRun=Decode $Initial;$baselineRun=Decode $Baseline;$finalRun=Decode $Final
if($initialRun.conditions-ne 8-or $baselineRun.conditions-ne 8-or $finalRun.conditions-ne 8){throw 'Each report must have all eight complete attachment conditions; no output written'}
$comparisons=[ordered]@{
  initialVersusFreshBaseline=@{operations=Compare-TimingRows $initialRun.operations $baselineRun.operations;metrics=Compare-TimingRows $initialRun.metrics $baselineRun.metrics}
  finalVersusFreshBaseline=@{operations=Compare-TimingRows $finalRun.operations $baselineRun.operations;metrics=Compare-TimingRows $finalRun.metrics $baselineRun.metrics}
  finalVersusInitial=@{operations=Compare-TimingRows $finalRun.operations $initialRun.operations;metrics=Compare-TimingRows $finalRun.metrics $initialRun.metrics}
}
$identity=[Collections.Generic.List[object]]::new()
foreach($key in $initialRun.conditionRows.Keys){
  $i=$initialRun.conditionRows[$key];$b=$baselineRun.conditionRows[$key];$f=$finalRun.conditionRows[$key]
  $identity.Add([pscustomobject][ordered]@{
    condition=$key
    fixturesEqual=(($i.fixture|ConvertTo-Json -Depth 8 -Compress)-eq ($b.fixture|ConvertTo-Json -Depth 8 -Compress)-and ($i.fixture|ConvertTo-Json -Depth 8 -Compress)-eq ($f.fixture|ConvertTo-Json -Depth 8 -Compress))
    browserEqual=($i.browser-eq $b.browser-and $i.browser-eq $f.browser)
    userAgentEqual=($i.userAgent-eq $b.userAgent-and $i.userAgent-eq $f.userAgent)
    rendererBeforeEqual=(($i.rendererBefore|ConvertTo-Json -Depth 8 -Compress)-eq ($b.rendererBefore|ConvertTo-Json -Depth 8 -Compress)-and ($i.rendererBefore|ConvertTo-Json -Depth 8 -Compress)-eq ($f.rendererBefore|ConvertTo-Json -Depth 8 -Compress))
    rendererAfterEqual=(($i.rendererAfter|ConvertTo-Json -Depth 8 -Compress)-eq ($b.rendererAfter|ConvertTo-Json -Depth 8 -Compress)-and ($i.rendererAfter|ConvertTo-Json -Depth 8 -Compress)-eq ($f.rendererAfter|ConvertTo-Json -Depth 8 -Compress))
    warmups=@{initial=$i.warmup;baseline=$b.warmup;final=$f.warmup}
    probeCounting=@{initial=$i.probeCounting;baseline=$b.probeCounting;final=$f.probeCounting}
  })
}
$sensitivity=[ordered]@{}
foreach($key in $initialRun.operations.Keys){
  if(-not $finalRun.operations.Contains($key)){throw "Final operation missing: $key"}
  $op=$initialRun.operations[$key].operation;$condition=$initialRun.operations[$key].condition
  $initialSamples=@($initialRun.conditionRows[$condition].raw.records[$op].samples)
  $finalSamples=@($finalRun.conditionRows[$condition].raw.records[$op].samples)
  Add-Row $sensitivity $key @($initialSamples+$finalSamples) @{initialSamples=$initialSamples;finalSamples=$finalSamples;purpose='Sensitivity diagnostic across both unchanged current-code full runs; never replaces either full-run acceptance gate'}
}
$sourceFiles=[Collections.Generic.List[object]]::new()
foreach($relative in @('tests/browser/shopping-cross-column-drag.spec.ts','src/persistence/db/atomicRestoreTransaction.ts','package-lock.json','vite.config.ts')){
  $bp=Join-Path $BaselineSourceRoot $relative;$cp=Join-Path $CurrentSourceRoot $relative
  $bh=if([IO.File]::Exists($bp)){Hash $bp}else{$null};$ch=if([IO.File]::Exists($cp)){Hash $cp}else{$null}
  $sourceFiles.Add([pscustomobject][ordered]@{path=$relative;baselineSha256=$bh;currentSha256=$ch;identical=($bh-eq $ch)})
}
$externalProvenance=[Collections.Generic.List[object]]::new()
foreach($name in @('product-source-manifest.json','performance-environment.json')){
  $path=Join-Path ([IO.Path]::GetDirectoryName($OutputPath)) $name
  if([IO.File]::Exists($path)){$externalProvenance.Add([pscustomobject]@{path=$path;sha256=Hash $path})}
}
$failedRaw=[Collections.Generic.List[object]]::new()
foreach($case in $initialRun.conditionRows.Values){if($case.status-ne 'passed'){$failedRaw.Add($case)}}
$summary=[ordered]@{
  method='Decode ALL passed and failed raw shopping-drag-response attachment bodies; nearest-rank median ceil(n*0.5), p95 ceil(n*0.95), 1-based; stored summaries ignored.'
  thresholds=@{minimumSamples=20;medianMs=55;p95Ms=100}
  acceptancePolicy='Each complete run assessed independently using all original samples including cold samples; initial failure retained; n40 aggregation is sensitivity only and cannot replace a failed run.'
  causalityPolicy='Temporal before/after comparisons and source/fixture identity do not establish the cause of any timing difference.'
  utility=@{path=$PSCommandPath;sha256=Hash $PSCommandPath}
  sourceEvidence=@{note='File hashes inspected at aggregation time; supplemental evidence, not a claim of independent build/run attestation.';baselineRoot=$BaselineSourceRoot;currentRoot=$CurrentSourceRoot;files=$sourceFiles.ToArray();externalProvenance=$externalProvenance.ToArray()}
  identity=$identity.ToArray()
  initial=$initialRun;freshBaseline=$baselineRun;final=$finalRun
  comparison=$comparisons
  sensitivity=@{acceptanceSubstitute=$false;combinedCurrentRuns=$sensitivity;descriptiveGate=Gate @($sensitivity.Values) 60;initialFailedDecodedAttachments=$failedRaw.ToArray()}
}
$json=($summary|ConvertTo-Json -Depth 100).Replace("`r`n","`n")+"`n"
[IO.File]::WriteAllText($OutputPath,$json,[Text.UTF8Encoding]::new($false))
$null=Read-Json $OutputPath
[ordered]@{output=$OutputPath;initial=$initialRun.fullRunOperationGate;baseline=$baselineRun.fullRunOperationGate;final=$finalRun.fullRunOperationGate;initialAcceptance=$initialRun.acceptancePass;baselineAcceptance=$baselineRun.acceptancePass;finalAcceptance=$finalRun.acceptancePass;finalVersusBaselineMaximumMedianIncreaseMs=$comparisons.finalVersusFreshBaseline.operations.maximumMedianIncreaseMs;finalVersusInitialMaximumMedianIncreaseMs=$comparisons.finalVersusInitial.operations.maximumMedianIncreaseMs;sensitivityAcceptanceSubstitute=$false}|ConvertTo-Json -Depth 8
