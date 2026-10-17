[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference='Stop'
function Get-TaskQuantile($values,$probability){$sorted=@($values | Sort-Object);if(-not $sorted.Count){return $null};return [double]$sorted[[math]::Ceiling($sorted.Count*$probability)-1]}
function Get-TaskMetrics($sample){
 $metrics=@{}
 foreach($entry in $sample.GetEnumerator()){if(($entry.Key -match 'Ms$' -or $entry.Key -in @('attempts','successes','aborted','readCalls')) -and $entry.Value -is [ValueType]){$metrics[$entry.Key]=[double]$entry.Value}}
 foreach($stage in $sample.stages.GetEnumerator()){foreach($field in @('exclusiveMs','inclusiveMs','calls')){$metrics["stage.$($stage.Key).$field"]=[double]$stage.Value[$field]}}
 foreach($put in $sample.puts.GetEnumerator()){$metrics["put.$($put.Key)"]=[double]$put.Value}
 return $metrics
}
$records=@{}
foreach($round in @(1,2)){foreach($phase in @('before','after')){
 $path=Join-Path $PSScriptRoot "engine-recheck-$phase-$round.log"
 $samples=@(Get-Content -LiteralPath $path -Encoding utf8 | Where-Object {$_ -match '^SHEET_URL_SAMPLE '} | ForEach-Object {($_ -replace '^SHEET_URL_SAMPLE ','') | ConvertFrom-Json -AsHashtable -Depth 100})
 if($samples.Count -ne 120){throw "Expected 120 samples in $path"}
 if(@($samples | Where-Object {$_.status -notin @('ready','ok')}).Count){throw 'Non-successful recheck'}
 $groups=@($samples | Group-Object {"$($_.count)|$($_.mode)|$($_.key)"})
 if($groups.Count -ne 6){throw 'Expected six groups'}
 foreach($group in $groups){if($group.Count -ne 20 -or @($group.Group.iteration | Sort-Object -Unique).Count -ne 20){throw 'Invalid sample count/iteration'}}
 $records["$phase-$round"]=$samples
}}
$comparisons=foreach($round in @(1,2)){
 foreach($group in ($records["before-$round"] | Group-Object {"$($_.count)|$($_.mode)|$($_.key)"})){
  $before=@($group.Group | ForEach-Object {Get-TaskMetrics $_})
  $after=@($records["after-$round"] | Where-Object {"$($_.count)|$($_.mode)|$($_.key)" -eq $group.Name} | ForEach-Object {Get-TaskMetrics $_})
  $names=@(@($before | ForEach-Object {$_.Keys})+@($after | ForEach-Object {$_.Keys}) | Sort-Object -Unique)
  foreach($name in $names){
   $beforeValues=@($before | Where-Object {$_.ContainsKey($name)} | ForEach-Object {$_[$name]})
   $afterValues=@($after | Where-Object {$_.ContainsKey($name)} | ForEach-Object {$_[$name]})
   $bm=Get-TaskQuantile $beforeValues .5;$am=Get-TaskQuantile $afterValues .5;$bp=Get-TaskQuantile $beforeValues .95;$ap=Get-TaskQuantile $afterValues .95
   [pscustomobject]@{round=$round;group=$group.Name;metric=$name;beforeSamples=$beforeValues.Count;afterSamples=$afterValues.Count;beforeMedian=$bm;afterMedian=$am;delta=if($null -ne $bm -and $null -ne $am){$am-$bm}else{$null};beforeP95=$bp;afterP95=$ap;p95Delta=if($null -ne $bp -and $null -ne $ap){$ap-$bp}else{$null}}
  }
 }
}
$comparisons | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'engine-recheck-comparisons.json') -Encoding utf8
$comparisons | Export-Csv -LiteralPath (Join-Path $PSScriptRoot 'engine-recheck-comparisons.csv') -Encoding utf8 -NoTypeInformation
$comparisons | Where-Object metric -eq 'durationMs' | Format-Table round,group,beforeMedian,afterMedian,delta,beforeP95,afterP95 -AutoSize
