#requires -Version 7.0
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$utf8=[Text.UTF8Encoding]::new($false,$true)
$summaryRoot=Join-Path $PSScriptRoot 'diagnostic-summary-1'
$manifest=ConvertFrom-Json -InputObject ($utf8.GetString([IO.File]::ReadAllBytes((Join-Path $summaryRoot 'manifest.json')))) -AsHashtable -Depth 100
$output=Join-Path $PSScriptRoot 'diagnostic-boundary-supplement-1'
if(Test-Path -LiteralPath $output) {throw 'Supplement output already exists; refusing overwrite'}
function First-At($events,[string]$kind,[string]$label) {
    $found=@($events|Where-Object {$_['kind'] -ceq $kind -and $_['label'] -ceq $label}|Sort-Object {[double]$_['at']})
    if($found.Count -eq 0){return $null}; return [double]$found[0]['at']
}
function Difference($end,$start) {if($null -eq $end -or $null -eq $start){return $null};return [double]$end-[double]$start}
function Stats($values) {
    $sorted=@($values|Where-Object {$null -ne $_}|ForEach-Object {if(-not [double]::IsFinite([double]$_)){throw 'Non-finite value'};[double]$_}|Sort-Object)
    $n=$sorted.Count; if(!$n){return @{n=0;median=$null;p95=$null}}
    $median=if($n%2){$sorted[[int][Math]::Floor($n/2)]}else{($sorted[$n/2-1]+$sorted[$n/2])/2}
    return @{n=$n;median=$median;p95=$sorted[[Math]::Ceiling($n*.95)-1]}
}
$rows=[Collections.Generic.List[object]]::new()
$updateBoundaries=[Collections.Generic.List[object]]::new()
$inputs=[Collections.Generic.List[object]]::new()
$runtimeErrors=0; $missingUpdateClicks=0
foreach($entry in $manifest['sourceFiles']) {
    if(-not $entry['path'].EndsWith('sheet-url-diagnostic-timings.json')){continue}
    $path=$entry['path']; $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if($hash -ne $entry['sha256']){throw "Raw source changed: $path"}
    $samples=@(ConvertFrom-Json -InputObject ($utf8.GetString([IO.File]::ReadAllBytes($path))) -AsHashtable -Depth 100)
    if($samples.Count -ne 20){throw 'Expected 20 samples'}
    $inputs.Add(@{path=$path;sha256=$hash})
    foreach($sample in $samples) {
        $phase=$sample['phase']; $case="$($sample['route']): $($sample['count']) $($sample['mode'])"
        $runtimeErrors+=@($sample['runtimeErrors']).Count
        $events=@($sample['diagnostic']['browserEvents']); $metrics=[ordered]@{}
        foreach($field in @('durationMs','reviewMs','saveMs','failureMs','retryMs')){if($sample.ContainsKey($field)){$metrics['outer.'+$field]=$sample[$field]}}
        $atomic=@($sample['transactions']|Where-Object {$_['mode'] -ceq 'readwrite' -and $_['outcome'] -ceq 'complete' -and @($_['stores']) -contains 'eventLists' -and @($_['stores']) -contains 'eventConsistency'})
        $physical=0.0;foreach($transaction in $atomic){$physical+=[double]$transaction['finishedAt']-[double]$transaction['startedAt']}
        $metrics['atomicSuccessfulWholeDurationMs']=$physical
        $metrics['atomicSuccessfulCount']=$atomic.Count
        $metrics['allAbortCount']=@($sample['transactions']|Where-Object {$_['outcome'] -ceq 'abort'}).Count
        switch($sample['route']) {
            'retry' {
                $click=First-At $events 'click' '保留中の保存を再試行'
                $metrics['browser.retryClickToAlertDomMs']=Difference (First-At $events 'dom' 'retained-save-alert:removed') $click
                $metrics['browser.retryClickToEditorDomMs']=Difference (First-At $events 'dom' 'item-editor:removed') $click
            }
            'startup-B06' {
                $click=First-At $events 'click' '読み込みを再試行'
                $metrics['browser.retryClickToReadyDomMs']=Difference (First-At $events 'dom' 'startup-event-visible') $click
            }
            'update' {
                $span=@($sample['diagnostic']['nodeSpans']|Where-Object {$_['label'] -ceq 'update.request.click'})[0]
                $pre=[double]$span['beforeBoundary']['browser']['epochAt']
                $request=First-At $events 'csv-request' 'fetch-call'
                $text=First-At $events 'csv-response-text' 'complete'
                $dom=First-At $events 'dom' 'review-visible'
                $metrics['node.requestActionMs']=[double]$span['nodeFinishedAt']-[double]$span['nodeStartedAt']
                $metrics['browser.preEvaluateToFetchUpperBoundMs']=Difference $request $pre
                $metrics['browser.csvRequestToTextCompleteMs']=Difference $text $request
                $metrics['browser.csvTextCompleteToReviewDomMs']=Difference $dom $text
                $metrics['browser.confirmClickToReviewHiddenMs']=Difference (First-At $events 'dom' 'review-hidden') (First-At $events 'click' '更新を実行')
                $updateClick=First-At $events 'click' '🔄 アイテム更新'
                if($null -eq $updateClick){$missingUpdateClicks++}
                $updateBoundaries.Add([ordered]@{
                    phase=$phase;iteration=$sample['iteration'];beforeEvaluateBrowserEpoch=$pre;fetchBrowserEpoch=$request
                    browserPreEvaluateToFetchUpperBoundMs=$metrics['browser.preEvaluateToFetchUpperBoundMs']
                    nodeRequestActionMs=$metrics['node.requestActionMs'];nodeBeforeEvaluateRoundTripMs=$span['beforeBoundary']['roundTripMs']
                    nodeAfterEvaluateRoundTripMs=$span['afterBoundary']['roundTripMs'];updateClickEvent=$updateClick
                    nodeBrowserClockConversion=$false
                })
            }
            default {throw "Unexpected route: $case"}
        }
        foreach($metric in $metrics.Keys){$rows.Add([ordered]@{phase=$phase;case=$case;iteration=$sample['iteration'];metric=$metric;value=$metrics[$metric]})}
    }
}
if($inputs.Count -ne 6 -or $runtimeErrors -ne 0 -or $updateBoundaries.Count -ne 40){throw 'Independent schema/runtime/count validation failed'}
$results=[Collections.Generic.List[object]]::new()
foreach($group in ($rows|Group-Object {$_['case']+'|'+$_['metric']})) {
    $first=$group.Group[0];$before=@($group.Group|Where-Object {$_['phase'] -ceq 'before'}|ForEach-Object {$_['value']});$after=@($group.Group|Where-Object {$_['phase'] -ceq 'after'}|ForEach-Object {$_['value']})
    if($before.Count -ne 20 -or $after.Count -ne 20){throw 'Missing phase samples'}
    $b=Stats $before;$a=Stats $after
    $results.Add([ordered]@{case=$first['case'];metric=$first['metric'];beforeN=$b.n;afterN=$a.n;beforeMedian=$b.median;afterMedian=$a.median;medianDelta=(Difference $a.median $b.median);beforeP95=$b.p95;afterP95=$a.p95;p95Delta=(Difference $a.p95 $b.p95)})
}
New-Item -ItemType Directory -Path $output|Out-Null
$results|ForEach-Object {[pscustomobject]$_}|Export-Csv -LiteralPath (Join-Path $output 'independent-recalculation.csv') -Encoding utf8 -NoTypeInformation -NoClobber
$updateBoundaries|ForEach-Object {[pscustomobject]$_}|Export-Csv -LiteralPath (Join-Path $output 'update-browser-boundaries.csv') -Encoding utf8 -NoTypeInformation -NoClobber
$report=[ordered]@{
    schemaVersion=1;createdAt=[DateTimeOffset]::Now.ToString('o');validatedRawFiles=6;validatedSamples=120;runtimeErrors=$runtimeErrors
    missingUpdateClickEvents=$missingUpdateClicks;expectedUpdateClickEventSamples=40;primaryEvidenceReplacement=$false;nodeBrowserClockConversion=$false
    missingMarkerCause='EventListScreen icon and title are separate adjacent spans. textContent is 🔄アイテム更新, while the diagnostic listener compares 🔄 アイテム更新 with a space; accessible-name token separation lets the Playwright locator match.'
    newMetric='browser.preEvaluateToFetchUpperBoundMs: browser fetch-call epoch minus browser pre-action evaluate epoch, including transport/scheduling and handler work; not exact actionability or click-to-request time.'
    quantiles='Median of even n uses the two middle values; p95 is nearest-rank. Independent quantiles are not additive.'
    inputs=@($inputs);results=@($results)
}
$json=($report|ConvertTo-Json -Depth 12).Replace("`r`n","`n")+"`n"
[IO.File]::WriteAllText((Join-Path $output 'independent-recalculation.json'),$json,$utf8)
$results|Where-Object {$_['metric'] -match 'preEvaluateToFetch|node.requestAction|^outer\.|TextCompleteToReview'}|ForEach-Object {[pscustomobject]$_}|ConvertTo-Json -Compress
