param([string]$Before='before-3',[string]$After='after-1',[switch]$ShoppingOnly)
$ErrorActionPreference='Stop'
$evidence=$PSScriptRoot
$utf8=[Text.UTF8Encoding]::new($false,$true)
function Read-Json([string]$path) { $utf8.GetString([IO.File]::ReadAllBytes($path)) | ConvertFrom-Json -Depth 100 }
function Write-Json([string]$name,$value) { [IO.File]::WriteAllText((Join-Path $evidence $name),(ConvertTo-Json -InputObject $value -Depth 100),$utf8) }
function Stats($values) {
  $v=@($values|Sort-Object)
  if(!$v.Count){return $null}
  [ordered]@{samples=$v.Count;medianMs=$v[[Math]::Ceiling($v.Count*0.5)-1];p95Ms=$v[[Math]::Ceiling($v.Count*0.95)-1]}
}
function Shopping([string]$directory) {
  $rows=@{}
  foreach($f in Get-ChildItem -LiteralPath (Join-Path $evidence $directory) -Filter shopping-operation-timings.json -Recurse) {
    $j=Read-Json $f.FullName
    foreach($p in $j.timings.PSObject.Properties) {
      $key="$($j.count)|$($j.concentrated)|$($j.mapVisible)|$($j.layout)|$($p.Name)"
      $rows[$key]=[pscustomobject]@{count=$j.count;concentrated=$j.concentrated;mapVisible=$j.mapVisible;layout=$j.layout;operation=$p.Name;stats=(Stats $p.Value);file=$f.FullName}
    }
  }
  return $rows
}
$beforeRows=Shopping $Before
$priorRows=Shopping 'before-2'
$afterRows=Shopping $After
if($beforeRows.Count -ne 96 -or $afterRows.Count -ne 96){throw 'Expected all 96 shopping groups'}
$comparison=@(foreach($key in @($afterRows.Keys|Sort-Object)) {
  $b=$beforeRows[$key];$a=$afterRows[$key];$p=$priorRows[$key]
  $medianDelta=$a.stats.medianMs-$b.stats.medianMs
  $p95Delta=$a.stats.p95Ms-$b.stats.p95Ms
  [pscustomobject][ordered]@{count=$a.count;concentrated=$a.concentrated;mapVisible=$a.mapVisible;layout=$a.layout;operation=$a.operation;beforeSamples=$b.stats.samples;beforeMedianMs=$b.stats.medianMs;beforeP95Ms=$b.stats.p95Ms;afterSamples=$a.stats.samples;afterMedianMs=$a.stats.medianMs;afterP95Ms=$a.stats.p95Ms;medianDeltaMs=$medianDelta;medianDeltaPercent=100*$medianDelta/$b.stats.medianMs;p95DeltaMs=$p95Delta;p95DeltaPercent=100*$p95Delta/$b.stats.p95Ms;priorMedianMs=$p.stats.medianMs;priorP95Ms=$p.stats.p95Ms;baselineMedianVariationMs=[Math]::Abs($b.stats.medianMs-$p.stats.medianMs);baselineP95VariationMs=[Math]::Abs($b.stats.p95Ms-$p.stats.p95Ms);passes=($a.stats.samples -ge 20 -and $a.stats.medianMs -le 55 -and $a.stats.p95Ms -le 100);beforeFile=$b.file;afterFile=$a.file}
})
Write-Json 'shopping-comparison.json' $comparison
$comparison | Export-Csv -LiteralPath (Join-Path $evidence 'shopping-comparison.csv') -NoTypeInformation -Encoding utf8
$saves=@(foreach($dir in @('before-2',$Before,$After)) {
  foreach($f in Get-ChildItem -LiteralPath (Join-Path $evidence $dir) -Filter shopping-operation-timings.json -Recurse){
    $j=Read-Json $f.FullName
    foreach($phase in @('diagnostic','executionDiagnostic','executionRecordDiagnostic')){
      $samples=@($j.$phase.samples | Where-Object phase -eq 'save' | ForEach-Object durationMs)
      if($samples.Count){[pscustomobject]@{run=$dir;count=$j.count;concentrated=$j.concentrated;mapVisible=$j.mapVisible;layout=$j.layout;phase=$phase;stats=(Stats $samples)}}
    }
  }
})
Write-Json 'shopping-save-times.json' $saves
if($ShoppingOnly){ Write-Output "Shopping groups=$($comparison.Count) failed=$(@($comparison|Where-Object {-not $_.passes}).Count)"; return }
function Engine-Samples([string]$phase){
  $log=$utf8.GetString([IO.File]::ReadAllBytes((Join-Path $evidence "routes-$phase-complete.log")))
  $samples=@([regex]::Matches($log,'SHEET_URL_SAMPLE (\{[^\r\n]+\})') | ForEach-Object { $_.Groups[1].Value | ConvertFrom-Json -Depth 40 })
  foreach($suffix in @('update-validated','startup-counted')) {
    $path=Join-Path $evidence "routes-$phase-$suffix.log"
    if(!(Test-Path -LiteralPath $path)){continue}
    $replacement=$utf8.GetString([IO.File]::ReadAllBytes($path))
    $updated=@([regex]::Matches($replacement,'SHEET_URL_SAMPLE (\{[^\r\n]+\})')|ForEach-Object {$_.Groups[1].Value|ConvertFrom-Json -Depth 40})
    $prefix=if($suffix -like 'update-*'){'update-*'}else{'startup-*'}
    $samples=@($samples|Where-Object {$_.key -notlike $prefix})+$updated
  }
  return $samples
}
$engineBefore=Engine-Samples 'before';$engineAfter=Engine-Samples 'after'
if($engineBefore.Count -ne 1760 -or $engineAfter.Count -ne 1760){throw 'Expected 1760 route engine samples in each phase'}
Write-Json 'route-engine-samples-before.json' $engineBefore
Write-Json 'route-engine-samples-after.json' $engineAfter
$engine=@(foreach($g in $engineAfter | Group-Object key,count,mode){
  $a=@($g.Group);$b=@($engineBefore | Where-Object { $_.key -eq $a[0].key -and $_.count -eq $a[0].count -and $_.mode -eq $a[0].mode })
  if($a.Count -lt 20 -or $b.Count -lt 20){throw 'Insufficient engine samples'}
  $metrics=[ordered]@{}
  foreach($metric in @('durationMs','parseMs','reviewMs','saveMs','replanMs','physicalCommitMs','failureMs')){
    if($a[0].PSObject.Properties.Name -contains $metric){$metrics[$metric]=@{before=(Stats @($b|ForEach-Object {$_.$metric}));after=(Stats @($a|ForEach-Object {$_.$metric}))}}
  }
  [pscustomobject]@{key=$a[0].key;count=$a[0].count;mode=$a[0].mode;beforeStatuses=@($b.status|Group-Object|ForEach-Object {@{status=$_.Name;count=$_.Count}});afterStatuses=@($a.status|Group-Object|ForEach-Object {@{status=$_.Name;count=$_.Count}});comparable=(@($b|Where-Object {$_.status -notin @('ok','ready')}).Count -eq 0 -and -not ($a[0].key -eq 'startup-B06' -and $a[0].mode -eq 'direct' -and @($b|Where-Object {$_.aborted -gt 0}).Count -eq 0));metrics=$metrics}
})
Write-Json 'route-engine-comparison.json' $engine
$startup=@($engineBefore+$engineAfter|Where-Object {$_.key -like 'startup-*'})
Write-Json 'startup-physical-commits.json' $startup
$browser=@{}
foreach($phase in @('before','after')){
  $browser[$phase]=@(foreach($f in Get-ChildItem -LiteralPath (Join-Path $evidence "browser-routes-$phase") -Filter sheet-url-route-timings.json -Recurse){ Read-Json $f.FullName })
  if($browser[$phase].Count -ne 640){throw "Expected 640 real-browser samples for $phase; got $($browser[$phase].Count)"}
}
$routes=@(foreach($g in $browser.after|Group-Object route,count,mode){
  $a=@($g.Group);$b=@($browser.before|Where-Object {$_.route -eq $a[0].route -and $_.count -eq $a[0].count -and $_.mode -eq $a[0].mode})
  $metrics=[ordered]@{}
  foreach($metric in @('durationMs','parseMs','reviewMs','saveMs')){
    if($a[0].PSObject.Properties.Name -contains $metric){$metrics[$metric]=@{before=(Stats @($b|ForEach-Object {$_.$metric}));after=(Stats @($a|ForEach-Object {$_.$metric}))}}
  }
  [pscustomobject]@{route=$a[0].route;count=$a[0].count;mode=$a[0].mode;metrics=$metrics}
})
Write-Json 'route-browser-comparison.json' $routes
Write-Output "Shopping groups=$($comparison.Count) failed=$(@($comparison|Where-Object {-not $_.passes}).Count); engine groups=$($engine.Count); browser groups=$($routes.Count)"
