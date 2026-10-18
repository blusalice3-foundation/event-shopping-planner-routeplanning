param([string]$Directory='D:\esp-op18\artifacts\user-operation-consistency-20261018')
$ErrorActionPreference='Stop'
$utf8=[Text.UTF8Encoding]::new($false,$true)
$report=[IO.File]::ReadAllText((Join-Path $Directory 'drag-valid-map-500-native-on-cpu-report.json'),$utf8)|ConvertFrom-Json
$script:payload=$null
function Find-Profile($suite){foreach($spec in $suite.specs){foreach($test in $spec.tests){foreach($result in $test.results){foreach($a in $result.attachments){if($a.name -in @('shopping-drag-main-cpu-profile','shopping-drag-response')){$raw=$utf8.GetString([Convert]::FromBase64String($a.body));$file=if($a.name -eq 'shopping-drag-main-cpu-profile'){'drag-valid-map-500-native-on-cpu-profile-raw.json'}else{'drag-valid-map-500-native-on-cpu-response-raw.json'};[IO.File]::WriteAllText((Join-Path $Directory $file),$raw,[Text.UTF8Encoding]::new($false));if($a.name -eq 'shopping-drag-main-cpu-profile'){$script:payload=$raw|ConvertFrom-Json}}}}}};foreach($child in $suite.suites){Find-Profile $child}}
foreach($suite in $report.suites){Find-Profile $suite}
if(-not $payload){throw 'Missing CPU profile attachment'}
$profile=$payload.profile
$intervals=@($payload.intervals)
if($intervals.Count -ne 20){throw 'Expected20 drop windows'}
$nodes=@{};$parents=@{};$self=@{};$inclusive=@{};$stacks=@{}
foreach($node in $profile.nodes){$nodes[[int]$node.id]=$node;foreach($child in $node.children){$parents[[int]$child]=[int]$node.id}}
$cursor=[double]$profile.startTime
$sampleCount=0;$idleUs=0.0;$activeUs=0.0
for($i=0;$i -lt $profile.samples.Count;$i++){
  $next=$cursor+[double]$profile.timeDeltas[$i]
  $overlap=0.0
  foreach($window in $intervals){$overlap+=[math]::Max(0,[math]::Min($next,$window.endUs)-[math]::Max($cursor,$window.startUs))}
  $cursor=$next
  if($overlap -le 0){continue}
  $nodeId=[int]$profile.samples[$i]
  $frame=$nodes[$nodeId].callFrame
  if($frame.functionName -eq '(idle)'){$idleUs+=$overlap;continue}
  $sampleCount++;$activeUs+=$overlap
  $self[$nodeId]=[double]$self[$nodeId]+$overlap
  $chain=[Collections.Generic.List[string]]::new()
  $currentId=$nodeId
  $visited=@{}
  while($nodes.ContainsKey($currentId) -and -not $visited.ContainsKey($currentId)){
    $visited[$currentId]=$true
    $inclusive[$currentId]=[double]$inclusive[$currentId]+$overlap
    $currentFrame=$nodes[$currentId].callFrame
    $chain.Add("$($currentFrame.functionName)@$($currentFrame.lineNumber+1):$($currentFrame.columnNumber+1)")
    if(-not $parents.ContainsKey($currentId)){break}
    $currentId=$parents[$currentId]
  }
  $stackKey=($chain.ToArray()|Select-Object -First 10)-join ' <- '
  $stacks[$stackKey]=[double]$stacks[$stackKey]+$overlap
}
$functions=@(foreach($entry in $nodes.GetEnumerator()){$node=$entry.Value;$nodeId=[int]$node.id;if($self.ContainsKey($nodeId) -or $inclusive.ContainsKey($nodeId)){[pscustomobject]@{id=$nodeId;function=$node.callFrame.functionName;url=$node.callFrame.url;line=$node.callFrame.lineNumber+1;column=$node.callFrame.columnNumber+1;selfMs=[double]$self[$nodeId]/1000;inclusiveMs=[double]$inclusive[$nodeId]/1000}}})
$summary=[pscustomobject]@{diagnosticOnly=$true;windows=$intervals.Count;profileStartUs=$profile.startTime;profileEndUs=$profile.endTime;activeDropSamples=$sampleCount;idleMs=$idleUs/1000;activeMs=$activeUs/1000;activeAveragePerDropMs=$activeUs/20000;selfFunctions=@($functions|Sort-Object selfMs -Descending|Select-Object -First 75);inclusiveFunctions=@($functions|Sort-Object inclusiveMs -Descending|Select-Object -First 75);hotStacks=@($stacks.GetEnumerator()|Sort-Object Value -Descending|Select-Object -First 30|ForEach-Object {[pscustomobject]@{durationMs=$_.Value/1000;stack=$_.Key}});intervals=$intervals}
[IO.File]::WriteAllText((Join-Path $Directory 'drag-valid-map-500-native-on-cpu-summary.json'),($summary|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
$summary|Select-Object windows,activeDropSamples,idleMs,activeMs,activeAveragePerDropMs|Format-List
$summary.selfFunctions|Select-Object -First 18 function,selfMs,inclusiveMs,url,line,column|Format-Table -AutoSize
$summary.inclusiveFunctions|Where-Object {$_.url -like '*assets*'}|Select-Object -First 18 function,selfMs,inclusiveMs,line,column|Format-Table -AutoSize