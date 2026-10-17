#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$RunName = 'diagnostic-1',
    [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$OutputName = 'diagnostic-summary-1'
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false, $true)

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Read-Json([string]$Path) {
    $text = $utf8.GetString([IO.File]::ReadAllBytes($Path))
    Assert-Condition (-not $text.Contains([char]0xfffd)) "Replacement character: $Path"
    return ConvertFrom-Json -InputObject $text -AsHashtable -Depth 100
}
function Get-Value($Map, [string]$Key) {
    if ($null -ne $Map -and $Map.Contains($Key)) { return $Map[$Key] }
    return $null
}
function Read-Number($Value, [string]$Context) {
    if ($null -eq $Value) { return $null }
    Assert-Condition ($Value -is [ValueType] -and $Value -isnot [bool] -and $Value -isnot [char]) "Expected numeric value: $Context"
    $number = [double]$Value
    Assert-Condition ([double]::IsFinite($number)) "Non-finite value: $Context"
    return $number
}
function Required-Number($Value, [string]$Context) {
    $number = Read-Number $Value $Context
    Assert-Condition ($null -ne $number) "Missing numeric value: $Context"
    return $number
}
function Add-Metric($Metrics, [string]$Name, $Value) {
    $Metrics[$Name] = Read-Number $Value $Name
}
function Add-Difference($Metrics, [string]$Name, $End, $Start) {
    if ($null -eq $End -or $null -eq $Start) { $Metrics[$Name] = $null; return }
    Add-Metric $Metrics $Name ((Read-Number $End $Name) - (Read-Number $Start $Name))
}
function Event-At($Events, [string]$Kind, [string]$Label, $NotBefore = $null) {
    $eligible = @($Events | Where-Object {
        $_['kind'] -ceq $Kind -and $_['label'] -ceq $Label -and
        ($null -eq $NotBefore -or [double]$_['at'] -ge [double]$NotBefore)
    } | Sort-Object { [double]$_['at'] })
    if ($eligible.Count -eq 0) { return $null }
    return [double]$eligible[0]['at']
}
function Span-BrowserAt($Span, [string]$Side) {
    $boundary = Get-Value $Span ($Side + 'Boundary')
    $browser = Get-Value $boundary 'browser'
    return Read-Number (Get-Value $browser 'epochAt') "span.$Side.browser.epochAt"
}
function Add-Window($Windows, $Spans, [string]$Name, [string]$FirstSpan, [string]$LastSpan) {
    $start = Span-BrowserAt (Get-Value $Spans $FirstSpan) 'before'
    $end = Span-BrowserAt (Get-Value $Spans $LastSpan) 'after'
    Assert-Condition ($null -ne $start -and $null -ne $end -and $end -ge $start) "Invalid browser observation window: $Name"
    $Windows.Add([ordered]@{ name=$Name; startBrowserEpoch=$start; endBrowserEpoch=$end; durationMs=$end-$start; boundaryOnly=$true })
}
function Get-Stats($Values) {
    $numbers = @($Values | Where-Object { $null -ne $_ } | ForEach-Object { Required-Number $_ 'summary metric' } | Sort-Object)
    if ($numbers.Count -eq 0) { return [ordered]@{n=0;median=$null;p95=$null} }
    $n = $numbers.Count
    $median = if ($n % 2) { $numbers[[int][Math]::Floor($n / 2)] } else { ($numbers[$n / 2 - 1] + $numbers[$n / 2]) / 2 }
    return [ordered]@{n=$n;median=$median;p95=$numbers[[Math]::Ceiling(0.95*$n)-1]}
}
function Sum-Values($Values) {
    $total = 0.0
    foreach ($value in $Values) { if ($null -ne $value) { $total += [double]$value } }
    return $total
}
function Union-Duration($Intervals) {
    $sorted = @($Intervals | Sort-Object { $_['start'] }, { $_['end'] })
    if ($sorted.Count -eq 0) { return $null }
    $start = [double]$sorted[0]['start']; $end = [double]$sorted[0]['end']; $sum = 0.0
    foreach ($interval in @($sorted | Select-Object -Skip 1)) {
        if ([double]$interval['start'] -le $end) { $end = [Math]::Max($end, [double]$interval['end']) }
        else { $sum += $end-$start; $start=[double]$interval['start']; $end=[double]$interval['end'] }
    }
    return $sum + $end-$start
}
function Add-TransactionWindow($Metrics, $Details, $Transactions, $Window) {
    $prefix = 'tx.' + $Window['name']
    $start = [double]$Window['startBrowserEpoch']; $end = [double]$Window['endBrowserEpoch']
    Add-Metric $Metrics ($prefix+'.observationWindowMs') ($end-$start)
    $classified = [Collections.Generic.List[object]]::new()
    foreach ($transaction in $Transactions) {
        $txStart = [double]$transaction['startedAt']
        $txEnd = Read-Number (Get-Value $transaction 'finishedAt') 'transaction.finishedAt'
        $position = if ($null -eq $txEnd) { 'unfinished' } elseif ($txEnd -le $start) { 'before-window' } elseif ($txStart -ge $end) { 'after-window' } else { 'overlaps-window' }
        $overlap = if ($null -eq $txEnd) { $null } else { [Math]::Max(0.0, [Math]::Min($txEnd,$end)-[Math]::Max($txStart,$start)) }
        $stores = @($transaction['stores'])
        $classified.Add([ordered]@{
            realm=$transaction['realm']; mode=$transaction['mode']; stores=$stores
            startedAt=$txStart; finishedAt=$txEnd; outcome=(Get-Value $transaction 'outcome')
            injectedAbort=(Get-Value $transaction 'injectedAbort'); position=$position; overlapMs=$overlap
            wholeDurationMs=$(if($null -eq $txEnd){$null}else{$txEnd-$txStart})
            atomicWrite=($transaction['mode'] -ceq 'readwrite' -and $stores -contains 'eventLists' -and $stores -contains 'eventConsistency')
            snapshotRead=($transaction['mode'] -ceq 'readonly' -and $stores -contains 'eventLists' -and $stores -contains 'eventConsistency' -and $stores -contains 'mapData')
            mainEventListsRead=($transaction['realm'] -ceq 'main' -and $transaction['mode'] -ceq 'readonly' -and $stores -contains 'eventLists')
        })
    }
    $overlapping = @($classified | Where-Object { $_['position'] -ceq 'overlaps-window' })
    $beforeAborts = @($classified | Where-Object { $_['position'] -ceq 'before-window' -and $_['outcome'] -ceq 'abort' })
    $afterMainReads = @($classified | Where-Object { $_['position'] -ceq 'after-window' -and $_['mainEventListsRead'] })
    Add-Metric $Metrics ($prefix+'.overlappingCount') $overlapping.Count
    Add-Metric $Metrics ($prefix+'.unfinishedCount') @($classified | Where-Object { $_['position'] -ceq 'unfinished' }).Count
    foreach ($group in @(
        @{name='readonly';items=@($overlapping|Where-Object {$_['mode'] -ceq 'readonly'})},
        @{name='atomicSuccess';items=@($overlapping|Where-Object {$_['atomicWrite'] -and $_['outcome'] -ceq 'complete'})},
        @{name='abort';items=@($overlapping|Where-Object {$_['outcome'] -ceq 'abort'})},
        @{name='snapshotRead';items=@($overlapping|Where-Object {$_['snapshotRead']})},
        @{name='mainEventListsRead';items=@($overlapping|Where-Object {$_['mainEventListsRead']})}
    )) {
        Add-Metric $Metrics ($prefix+'.'+$group.name+'.count') $group.items.Count
        Add-Metric $Metrics ($prefix+'.'+$group.name+'.overlapSumMs') (Sum-Values @($group.items|ForEach-Object {$_['overlapMs']}))
        Add-Metric $Metrics ($prefix+'.'+$group.name+'.wholeDurationSumMs') (Sum-Values @($group.items|ForEach-Object {$_['wholeDurationMs']}))
    }
    $intervals=@($overlapping|ForEach-Object { @{start=[Math]::Max([double]$_['startedAt'],$start);end=[Math]::Min([double]$_['finishedAt'],$end)} })
    Add-Metric $Metrics ($prefix+'.transactionUnionMs') (Union-Duration $intervals)
    Add-Metric $Metrics ($prefix+'.beforeWindowAbortCount') $beforeAborts.Count
    Add-Metric $Metrics ($prefix+'.beforeWindowAbortWholeDurationMs') (Sum-Values @($beforeAborts|ForEach-Object {$_['wholeDurationMs']}))
    Add-Metric $Metrics ($prefix+'.afterWindowMainEventListsReadCount') $afterMainReads.Count
    Add-Metric $Metrics ($prefix+'.afterWindowMainEventListsReadWholeDurationMs') (Sum-Values @($afterMainReads|ForEach-Object {$_['wholeDurationMs']}))
    $Details.Add([ordered]@{window=$Window;transactions=@($classified)})
}

$targetCases = @('retry: 150 direct','startup-B06: 150 direct','update: 500 worker')
$requiredSpans = @{
    'retry: 150 direct'=@('retry.initial-save.click','retry.retained.visible','retry.retry.click','retry.retained.hidden','retry.editor.hidden')
    'startup-B06: 150 direct'=@('startup.reload','startup.failure.visible','startup.retry.click','startup.ready.visible')
    'update: 500 worker'=@('update.request.click','update.review.visible','update.confirm.click','update.review.hidden','update.post-save.validation-read')
}
$definitionPath = Join-Path $PSScriptRoot 'diagnostic-manifest.json'
$definition = Read-Json $definitionPath
$derived = @($definition['frozenFiles'] | Where-Object { $_['path'] -ceq 'sheet-import-optional-url.diagnostic.spec.ts' })
Assert-Condition ($derived.Count -eq 1) 'Missing frozen diagnostic SHA'
$derivedHash = $derived[0]['sha256']
$provenancePath = Join-Path $PSScriptRoot '../build-provenance/manifest.json'
$provenance = Read-Json $provenancePath
$output = Join-Path $PSScriptRoot $OutputName
Assert-Condition (-not (Test-Path -LiteralPath $output)) "Existing summary must not be overwritten: $output"
$sourceFiles = [Collections.Generic.List[object]]::new()
$phaseSamples = @{}
$runManifests = @{}
foreach ($phase in @('after','before')) {
    $runPath = Join-Path $PSScriptRoot "$RunName-$phase-run.json"
    $run = Read-Json $runPath
    $runManifests[$phase] = $run
    Assert-Condition ($run['Phase'] -ceq $phase) "Run phase mismatch: $runPath"
    Assert-Condition (($run['PhaseOrder'] -join ',') -ceq 'after,before') "Unexpected phase order: $runPath"
    Assert-Condition ($run['DiagnosticOnly'] -eq $true -and $run['PrimaryEvidenceReplacement'] -eq $false) 'Diagnostic evidence flags missing'
    Assert-Condition ($run['MainFrozenHarnessSHA256'] -eq $definition['mainHarnessSha256'] -and $run['DiagnosticHarnessSHA256'] -eq $derivedHash) 'Frozen main/diagnostic SHA mismatch'
    Assert-Condition ($run['Repetitions'] -eq 20 -and $run['Workers'] -eq 1) 'Expected 20 samples and one worker'
    Assert-Condition (@($run['SelectedCases']).Count -eq 3 -and (@($run['SelectedCases']|Sort-Object)-join '|') -ceq (($targetCases|Sort-Object)-join '|')) 'Selected targets differ'
    $expectedBuild = @($provenance['builds']|Where-Object { $_['label'] -ceq $phase.ToUpperInvariant() })[0]
    $expectedIdentity = @($expectedBuild['copiedFiles']|Where-Object {$_['name'] -ceq 'release-identity.json'})[0]
    Assert-Condition ($run['ServerIdentitySHA256'] -eq $expectedIdentity['sha256']) "Build identity differs: $phase"
    $sourceFiles.Add([ordered]@{path=$runPath;sha256=(Get-FileHash -LiteralPath $runPath -Algorithm SHA256).Hash})
    $rawRoot = Join-Path $PSScriptRoot "$RunName-$phase"
    $rawFiles = @(Get-ChildItem -LiteralPath $rawRoot -File -Recurse -Filter 'sheet-url-diagnostic-timings.json')
    Assert-Condition ($rawFiles.Count -eq 3) "Expected three raw files: $rawRoot"
    $byCase = @{}
    foreach ($rawFile in $rawFiles) {
        $samples = @(Read-Json $rawFile.FullName)
        Assert-Condition ($samples.Count -eq 20) "Expected 20 samples: $($rawFile.FullName)"
        $sourceFiles.Add([ordered]@{path=$rawFile.FullName;sha256=(Get-FileHash -LiteralPath $rawFile.FullName -Algorithm SHA256).Hash})
        $iterations = [Collections.Generic.HashSet[int]]::new()
        $case = $null
        foreach ($sample in $samples) {
            $currentCase = "$($sample['route']): $($sample['count']) $($sample['mode'])"
            Assert-Condition ($currentCase -cin $targetCases) "Unexpected sample target: $currentCase"
            if ($null -eq $case) { $case=$currentCase } else { Assert-Condition ($case -ceq $currentCase) 'Mixed targets in one raw file' }
            Assert-Condition ($sample['phase'] -ceq $phase -and $sample['evidenceEligible'] -eq $true -and $sample['diagnosticOnly'] -eq $true -and $sample['primaryEvidenceReplacement'] -eq $false) 'Sample evidence/phase mismatch'
            $iteration = Required-Number $sample['iteration'] 'iteration'
            Assert-Condition ($iteration -eq [Math]::Floor($iteration) -and $iteration -ge 0 -and $iteration -lt 20 -and $iterations.Add([int]$iteration)) 'Duplicate/invalid iteration'
            Assert-Condition (@($sample['runtimeErrors']).Count -eq 0) 'Unexpected runtime error'
            if ($sample['route'] -ceq 'update') { Assert-Condition (@($sample['consoleErrors']).Count -eq 0) 'Unexpected normal-update console error' }
            $diagnostic = $sample['diagnostic']
            Assert-Condition ($diagnostic['diagnosticOnly'] -eq $true -and $diagnostic['instrumentationAffectsOuterIntervals'] -eq $true) 'Missing diagnostic clock/instrumentation flags'
            foreach ($event in @($diagnostic['browserEvents'])) { $null=Required-Number $event['at'] 'browser event.at' }
            foreach ($origin in @($diagnostic['browserClockOrigins'])) { $null=Required-Number $origin 'browser time origin' }
            foreach ($transaction in @($sample['transactions'])) {
                $txStart=Required-Number $transaction['startedAt'] 'transaction.startedAt'
                $txEnd=Read-Number (Get-Value $transaction 'finishedAt') 'transaction.finishedAt'
                Assert-Condition ($null -eq $txEnd -or $txEnd -ge $txStart) 'Invalid transaction interval'
                $null=Read-Number (Get-Value $transaction 'durationMs') 'transaction.durationMs'
            }
            $spans=@{}
            foreach ($span in @($diagnostic['nodeSpans'])) {
                $label=$span['label']; Assert-Condition (-not $spans.ContainsKey($label)) "Duplicate Node span: $label"
                $spans[$label]=$span
                $begin=Required-Number $span['nodeStartedAt'] "Node $label start"
                $finish=Required-Number $span['nodeFinishedAt'] "Node $label finish"
                Assert-Condition ($finish -ge $begin) "Invalid Node interval: $label"
                if ($span['kind'] -cin @('action','expect')) {
                    Assert-Condition ($span['succeeded'] -eq $true) "Failed Node span: $label"
                    $null=Required-Number $span['durationMs'] "Node $label duration"
                    foreach ($side in @('before','after')) {
                        $boundary=$span[$side+'Boundary']
                        $sent=Required-Number $boundary['nodeSentAt'] 'evaluate Node send'
                        $received=Required-Number $boundary['nodeReceivedAt'] 'evaluate Node receive'
                        Assert-Condition ($received -ge $sent) 'Invalid evaluate round trip'
                        $null=Required-Number $boundary['roundTripMs'] 'evaluate roundTripMs'
                        $null=Required-Number $boundary['browser']['epochAt'] 'evaluate browser epoch'
                        $null=Required-Number $boundary['browser']['timeOrigin'] 'evaluate browser timeOrigin'
                    }
                }
            }
            foreach ($label in $requiredSpans[$case]) { Assert-Condition ($spans.ContainsKey($label)) "Missing required span: $label" }
            $sample['__spans']=$spans
        }
        Assert-Condition ($iterations.Count -eq 20 -and -not $byCase.ContainsKey($case)) 'Missing/duplicate target file'
        $byCase[$case]=@($samples|Sort-Object { [int]$_['iteration'] })
    }
    Assert-Condition ($byCase.Count -eq 3) 'Missing diagnostic target'
    $phaseSamples[$phase]=$byCase
}
Assert-Condition ($runManifests['after']['DiagnosticHarnessSHA256'] -eq $runManifests['before']['DiagnosticHarnessSHA256']) 'Instrumentation differs between phases'
Assert-Condition ($runManifests['after']['MainFrozenHarnessSHA256'] -eq $runManifests['before']['MainFrozenHarnessSHA256']) 'Main source differs between phases'
Assert-Condition ($runManifests['after']['FixedInputs'] -eq $runManifests['before']['FixedInputs']) 'Fixed input directories differ'
Assert-Condition ($runManifests['after']['BrowserChannel'] -eq $runManifests['before']['BrowserChannel'] -and $runManifests['after']['Headed'] -eq $runManifests['before']['Headed']) 'Browser settings differ'

$sampleMetrics=@{}
$transactionDetails=[Collections.Generic.List[object]]::new()
foreach ($phase in @('before','after')) {
    $phaseMetrics=@{}
    foreach ($case in $targetCases) {
        $caseMetrics=[Collections.Generic.List[object]]::new()
        foreach ($sample in $phaseSamples[$phase][$case]) {
            $metrics=[ordered]@{}
            $spans=$sample['__spans']; $events=@($sample['diagnostic']['browserEvents'])
            foreach ($field in @('durationMs','reviewMs','saveMs','failureMs','retryMs')) {
                if ($sample.ContainsKey($field)) { Add-Metric $metrics ('outer.'+$field) (Required-Number $sample[$field] $field) }
            }
            if ($sample['route'] -ceq 'startup-B06') { Add-Metric $metrics 'outer.perSampleTotalMinusFailureMinusRetryMs' ([double]$sample['durationMs']-[double]$sample['failureMs']-[double]$sample['retryMs']) }
            foreach ($label in @($spans.Keys|Sort-Object)) {
                $span=$spans[$label]; $prefix='node.'+$span['kind']+'.'+$label
                Add-Difference $metrics ($prefix+'.durationMs') $span['nodeFinishedAt'] $span['nodeStartedAt']
                if ($span['kind'] -cin @('action','expect')) {
                    foreach ($side in @('before','after')) {
                        $boundary=$span[$side+'Boundary']
                        Add-Metric $metrics ($prefix+'.'+$side+'EvaluateRoundTripMs') $boundary['roundTripMs']
                    }
                    Add-Difference $metrics ($prefix+'.beforeEvaluateReceiveToSpanStartMs') $span['nodeStartedAt'] $span['beforeBoundary']['nodeReceivedAt']
                    Add-Difference $metrics ($prefix+'.spanEndToAfterEvaluateSendMs') $span['afterBoundary']['nodeSentAt'] $span['nodeFinishedAt']
                    Add-Difference $metrics ('browser.boundary.'+$label+'.beforeToAfterMs') (Span-BrowserAt $span 'after') (Span-BrowserAt $span 'before')
                }
            }
            $clickMappings=switch ($sample['route']) {
                'retry' { @(@{span='retry.initial-save.click';text='保存'},@{span='retry.retry.click';text='保留中の保存を再試行'}) }
                'startup-B06' { @(@{span='startup.retry.click';text='読み込みを再試行'}) }
                'update' { @(@{span='update.request.click';text='🔄 アイテム更新'},@{span='update.confirm.click';text='更新を実行'}) }
            }
            foreach ($mapping in @($clickMappings)) {
                $span=$spans[$mapping.span]; $click=Event-At $events 'click' $mapping.text (Span-BrowserAt $span 'before')
                Add-Difference $metrics ('browser.click.'+$mapping.span+'.preEvaluateToClickUpperBoundMs') $click (Span-BrowserAt $span 'before')
                Add-Difference $metrics ('browser.click.'+$mapping.span+'.clickToAfterEvaluateMs') (Span-BrowserAt $span 'after') $click
            }
            $domMappings=switch ($sample['route']) {
                'retry' { @(
                    @{click='保留中の保存を再試行';dom='retained-save-alert:removed';raf='retained-save-alert:removed:next-frame';wait='retry.retained.hidden';key='retry-retained-removed'},
                    @{click='保留中の保存を再試行';dom='item-editor:removed';raf='item-editor:removed:next-frame';wait='retry.editor.hidden';key='retry-editor-removed'}
                ) }
                'startup-B06' { @(
                    @{click='読み込みを再試行';dom='startup-event-visible';raf='startup-event-visible:next-frame';wait='startup.ready.visible';key='startup-ready'},
                    @{click='読み込みを再試行';dom='startup-retry-button:removed';raf='startup-retry-button:removed:next-frame';wait='startup.ready.visible';key='startup-retry-button-removed'}
                ) }
                'update' { @(
                    @{click='🔄 アイテム更新';dom='review-visible';raf='review-visible:next-frame';wait='update.review.visible';key='update-review-visible'},
                    @{click='更新を実行';dom='review-hidden';raf='review-hidden:next-frame';wait='update.review.hidden';key='update-review-hidden'}
                ) }
            }
            foreach ($mapping in @($domMappings)) {
                $click=Event-At $events 'click' $mapping.click
                $dom=Event-At $events 'dom' $mapping.dom $click
                $frame=Event-At $events 'raf' $mapping.raf $dom
                $wait=$spans[$mapping.wait]; $prefix='browser.dom.'+$mapping.key
                Add-Difference $metrics ($prefix+'.clickToDomMs') $dom $click
                Add-Difference $metrics ($prefix+'.clickToNextRafMs') $frame $click
                Add-Difference $metrics ($prefix+'.domToNextRafMs') $frame $dom
                Add-Difference $metrics ($prefix+'.domMinusExpectBeforeBoundarySignedMs') $dom (Span-BrowserAt $wait 'before')
                Add-Difference $metrics ($prefix+'.domToExpectAfterBoundaryUpperBoundMs') (Span-BrowserAt $wait 'after') $dom
            }
            if ($sample['route'] -ceq 'update') {
                $request=Event-At $events 'csv-request' 'fetch-call'
                $headers=Event-At $events 'csv-request' 'response-headers' $request
                $textStart=Event-At $events 'csv-response-text' 'start' $request
                $textEnd=Event-At $events 'csv-response-text' 'complete' $textStart
                $review=Event-At $events 'dom' 'review-visible' $textEnd
                Add-Difference $metrics 'browser.csv.requestToHeadersMs' $headers $request
                Add-Difference $metrics 'browser.csv.requestToTextCompleteMs' $textEnd $request
                Add-Difference $metrics 'browser.csv.responseTextMs' $textEnd $textStart
                Add-Difference $metrics 'browser.csv.textCompleteToReviewDomMs' $review $textEnd
                Add-Difference $metrics 'browser.csv.updateClickToRequestMs' $request (Event-At $events 'click' '🔄 アイテム更新')
            }
            $windows=[Collections.Generic.List[object]]::new()
            switch ($sample['route']) {
                'retry' {
                    Add-Window $windows $spans 'retry-timed' 'retry.retry.click' 'retry.editor.hidden'
                    Add-Window $windows $spans 'retry-failure-setup' 'retry.initial-save.click' 'retry.retained.visible'
                }
                'startup-B06' {
                    Add-Window $windows $spans 'startup-total' 'startup.reload' 'startup.ready.visible'
                    Add-Window $windows $spans 'startup-failure' 'startup.reload' 'startup.failure.visible'
                    Add-Window $windows $spans 'startup-retry' 'startup.retry.click' 'startup.ready.visible'
                }
                'update' {
                    Add-Window $windows $spans 'update-review' 'update.request.click' 'update.review.visible'
                    Add-Window $windows $spans 'update-save' 'update.confirm.click' 'update.review.hidden'
                    Add-Window $windows $spans 'update-post-save-validation' 'update.post-save.validation-read' 'update.post-save.validation-read'
                }
            }
            $details=[Collections.Generic.List[object]]::new()
            foreach ($window in $windows) { Add-TransactionWindow $metrics $details @($sample['transactions']) $window }
            $transactionDetails.Add([ordered]@{phase=$phase;case=$case;iteration=$sample['iteration'];browserObservationWindows=@($details);nodeBrowserClockConversion=$false})
            $caseMetrics.Add([ordered]@{iteration=$sample['iteration'];metrics=$metrics})
        }
        $phaseMetrics[$case]=@($caseMetrics)
    }
    $sampleMetrics[$phase]=$phaseMetrics
}

$paired=[Collections.Generic.List[object]]::new()
$summary=[Collections.Generic.List[object]]::new()
foreach ($case in $targetCases) {
    $metricNames=@($sampleMetrics['before'][$case]|ForEach-Object {$_.metrics.Keys})+@($sampleMetrics['after'][$case]|ForEach-Object {$_.metrics.Keys})
    foreach ($metric in @($metricNames|Sort-Object -Unique)) {
        $beforeValues=[Collections.Generic.List[object]]::new(); $afterValues=[Collections.Generic.List[object]]::new()
        foreach ($iteration in 0..19) {
            $before=Get-Value $sampleMetrics['before'][$case][$iteration]['metrics'] $metric
            $after=Get-Value $sampleMetrics['after'][$case][$iteration]['metrics'] $metric
            $beforeValues.Add($before); $afterValues.Add($after)
            $delta=if($null -ne $before -and $null -ne $after){[double]$after-[double]$before}else{$null}
            $paired.Add([ordered]@{case=$case;iteration=$iteration;metric=$metric;before=$before;after=$after;afterMinusBefore=$delta;unit=$(if($metric -match 'Count$|\.count$'){'count'}else{'ms'})})
        }
        $beforeStats=Get-Stats @($beforeValues); $afterStats=Get-Stats @($afterValues)
        if ($metric.StartsWith('outer.') -or $metric.StartsWith('node.')) { Assert-Condition ($beforeStats.n -eq 20 -and $afterStats.n -eq 20) "Incomplete required numeric coverage: $case/$metric" }
        $summary.Add([ordered]@{
            case=$case;metric=$metric;unit=$(if($metric -match 'Count$|\.count$'){'count'}else{'ms'})
            beforeN=$beforeStats.n;afterN=$afterStats.n;beforeMissing=20-$beforeStats.n;afterMissing=20-$afterStats.n
            beforeMedian=$beforeStats.median;afterMedian=$afterStats.median
            medianDelta=$(if($null -ne $beforeStats.median -and $null -ne $afterStats.median){$afterStats.median-$beforeStats.median}else{$null})
            beforeP95=$beforeStats.p95;afterP95=$afterStats.p95
            p95Delta=$(if($null -ne $beforeStats.p95 -and $null -ne $afterStats.p95){$afterStats.p95-$beforeStats.p95}else{$null})
        })
    }
}
$limitations=@(
    'Diagnostic-only instrumentation changes outer elapsed times; these results do not replace the frozen 48-case primary evidence or relax its criteria.',
    'Node monotonic spans and browser epoch events remain separate. No Node/browser timestamp subtraction or point clock-skew conversion is performed.',
    'Browser pre-evaluate to click and DOM-to-post-expect boundary are upper bounds including transport and scheduling, not exact Playwright actionability/polling costs.',
    'Transaction windows use browser evaluation boundary observations, not an exact conversion of Node outer start/end. Overlap is descriptive; sums of concurrent transactions are not critical-path time.',
    'Retry failure-setup aborts occur before the timed retry. Update post-save validation reads occur after saveMs. Their separate windows and before/after classifications preserve that distinction.',
    'B06 per-sample total-minus-failure-minus-retry is reported; independent medians/p95 values are not additive.',
    'Missing optional events or unfinished transaction endpoints remain null and numeric coverage is reported. They are never converted to zero latency.',
    'Iteration pairs identify shared case/fixture order only; phases used independent fresh browser contexts and are not simultaneous observations.',
    'One-shot requestAnimationFrame markers are observations of the next frame callback, not proof of physical display presentation.'
)
New-Item -ItemType Directory -Path $output | Out-Null
function Write-NewJson([string]$Name, $Value) {
    $path=Join-Path $output $Name
    Assert-Condition (-not (Test-Path -LiteralPath $path)) "Would overwrite: $path"
    $json=(ConvertTo-Json -InputObject $Value -Depth 100).Replace("`r`n","`n")+"`n"
    [IO.File]::WriteAllText($path,$json,$utf8)
    Assert-Condition ($utf8.GetString([IO.File]::ReadAllBytes($path)) -ceq $json) "JSON readback mismatch: $path"
}
$paired | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $output 'paired-sample-metrics.csv') -NoTypeInformation -Encoding utf8 -NoClobber
$summary | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $output 'summary.csv') -NoTypeInformation -Encoding utf8 -NoClobber
Write-NewJson 'paired-sample-metrics.json' @($paired)
Write-NewJson 'summary.json' @($summary)
Write-NewJson 'transaction-windows.json' @($transactionDetails)
Write-NewJson 'manifest.json' ([ordered]@{
    schemaVersion=1;createdAt=[DateTimeOffset]::Now.ToString('o');runName=$RunName;cases=$targetCases;phaseOrder=@('after','before');samplesPerCasePerPhase=20;rawFiles=6;validatedSamples=120
    diagnosticOnly=$true;primaryEvidenceReplacement=$false;nodeBrowserClockConversion=$false;nearestRankP95=$true;sampleMetrics=$paired.Count;summaryMetrics=$summary.Count
    mainFrozenSha256=$definition['mainHarnessSha256'];diagnosticFrozenSha256=$derivedHash
    summarizerSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash;sourceFiles=@($sourceFiles);limitations=$limitations
})
Write-Output "Validated three targets x two phases x 20 samples; summary=$output"
