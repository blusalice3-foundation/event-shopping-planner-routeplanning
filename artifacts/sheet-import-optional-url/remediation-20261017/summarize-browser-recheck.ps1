#requires -Version 7.0
[CmdletBinding()]
param([string]$EvidenceRoot = $PSScriptRoot, [string]$BeforeDirectory = '', [string]$AfterDirectory = '', [string]$OutputDirectory = '')
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
if (-not $BeforeDirectory) { $BeforeDirectory = Join-Path $EvidenceRoot 'routes-recheck-before-1' }
if (-not $AfterDirectory) { $AfterDirectory = Join-Path $EvidenceRoot 'routes-recheck-after-1' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $EvidenceRoot 'independent-summary-browser-recheck1' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) { throw "Refusing to overwrite existing summary: $OutputDirectory" }
$expected = @('count=150|mode=direct|route=retry', 'count=150|mode=direct|route=startup-B05', 'count=150|mode=direct|route=startup-B06', 'count=500|mode=direct|route=switch', 'count=500|mode=worker|route=import', 'count=500|mode=worker|route=update', 'count=500|mode=direct|route=update')
$frozen = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'browser-full-harness-manifest.json') -Encoding utf8 -Raw | ConvertFrom-Json -AsHashtable
$rawSamples = [Collections.Generic.List[object]]::new()
$rawScalars = [Collections.Generic.List[object]]::new()
$rawTransactions = [Collections.Generic.List[object]]::new()
$rawPuts = [Collections.Generic.List[object]]::new()
$rawErrors = [Collections.Generic.List[object]]::new()
$sources = [Collections.Generic.List[object]]::new()
function Metric-Unit([string]$Name) {
    # Count/request names take priority; Items ends in lowercase ms and is not milliseconds.
    if ($Name -match '(^|\.)putRequests\.' -or $Name -match '(Count|Calls|Attempts|Successes|Aborted|Puts)$') { return 'count' }
    if ($Name -cmatch 'Ms$') { return 'ms' }
    return 'count'
}
function Number([object]$Value, [string]$Label) {
    if ($null -eq $Value -or $Value -is [bool] -or $Value -is [string]) { throw "Not numeric: $Label" }
    $number = [double]$Value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt 0) { throw "Invalid duration/count: $Label" }
    return $number
}
function Increment([hashtable]$Values, [string]$Name, [double]$Value) {
    if (-not $Values.ContainsKey($Name)) { $Values[$Name] = 0.0 }
    $Values[$Name] += $Value
}
function Sample-Metrics([hashtable]$Sample, [string]$Phase, [string]$Group, [string]$Source) {
    $metrics = @{}
    $mandatory = @('durationMs', 'reviewMs', 'saveMs', 'csvTextToReviewDomMs', 'csvTextToReviewFrameMs', 'confirmationToScreenDomMs', 'confirmationToScreenFrameMs', 'startupScreenDomMs')
    $names = @($mandatory + @($Sample.Keys | Where-Object { $_ -match 'Ms$' }) | Sort-Object -Unique)
    $startup = $Sample.route.StartsWith('startup-')
    foreach ($name in $names) {
        $present = $Sample.ContainsKey($name)
        $value = if ($present -and $null -ne $Sample[$name]) { Number $Sample[$name] $name } else { $null }
        $setupOnly = $name -eq 'startupScreenDomMs' -and -not $startup
        $prefix = if ($setupOnly) { 'setup.' } else { 'scalar.' }
        $metrics[$prefix + $name] = $value
        $rawScalars.Add([ordered]@{ Phase = $Phase; Group = $Group; Iteration = $Sample.iteration; Field = $name; ValueMs = $value; Observed = ($null -ne $value); PresentInRaw = $present; Role = $(if ($setupOnly) { 'initial-setup-not-route' } else { 'reported-route-interval' }); Source = $Source })
    }
    foreach ($scope in @('all-readwrite', 'item-domain', 'application-atomic')) {
        foreach ($outcome in @('complete', 'abort', 'pending')) { $metrics["transaction.$scope.$outcome.count"] = 0.0 }
        foreach ($outcome in @('complete', 'abort')) { $metrics["transaction.$scope.$outcome.durationMs"] = 0.0 }
    }
    foreach ($field in @('preparationCommits', 'compatibilityCommits')) { if ($Sample.ContainsKey($field)) { $metrics['declared.' + $field] = Number $Sample[$field] $field } }
    for ($index = 0; $index -lt $Sample.transactions.Count; $index++) {
        $tx = $Sample.transactions[$index]
        $outcome = if ($tx.ContainsKey('outcome')) { $tx.outcome } else { 'pending' }
        if ($outcome -notin @('complete', 'abort', 'pending')) { throw "Unknown outcome: $outcome" }
        $duration = if ($tx.ContainsKey('durationMs')) { Number $tx.durationMs 'transaction duration' } else { $null }
        if ($outcome -ne 'pending' -and $null -eq $duration) { throw 'Completed/aborted transaction has no recorded duration' }
        $write = $tx.mode -eq 'readwrite'
        $item = $write -and 'eventLists' -in $tx.stores
        $atomic = $item -and 'eventConsistency' -in $tx.stores
        $reason = 'not-an-atomic-application-commit'
        if ($atomic) {
            if ($startup -and $outcome -eq 'complete') {
                $reason = if ($tx.eventListsDataPuts -eq 0) { 'startup-preparation' } elseif ($Sample.ContainsKey('preparationInCompatibilityCommit') -and $Sample.preparationInCompatibilityCommit) { 'startup-compatibility-with-preparation' } else { 'startup-compatibility' }
            } else {
                # Data-write markers are not proof of an extra URL compatibility save on ordinary routes.
                $reason = if ($tx.eventListsDataPuts -gt 0) { 'data-write-marker-positive-unattributed' } else { 'data-write-marker-zero-unattributed' }
            }
            Increment $metrics ("atomic-marker.$reason.$outcome.count") 1
            if ($null -ne $duration) { Increment $metrics ("atomic-marker.$reason.$outcome.durationMs") $duration }
        }
        foreach ($scope in @('all-readwrite', 'item-domain', 'application-atomic')) {
            $selected = switch ($scope) { 'all-readwrite' { $write }; 'item-domain' { $item }; 'application-atomic' { $atomic } }
            if (-not $selected) { continue }
            Increment $metrics "transaction.$scope.$outcome.count" 1
            if ($null -ne $duration) { Increment $metrics "transaction.$scope.$outcome.durationMs" $duration }
        }
        Increment $metrics ('counter.allTransactions.' + $tx.mode + '.' + $outcome) 1
        $rawTransactions.Add([ordered]@{ Phase = $Phase; Group = $Group; Iteration = $Sample.iteration; TransactionIndex = $index; Realm = $tx.realm; Mode = $tx.mode; Outcome = $outcome; ItemDomain = $item; ApplicationAtomic = $atomic; MarkerClassification = $reason; MarkerIsCauseProof = $false; EventListsDataPuts = $tx.eventListsDataPuts; ScopeReadyPuts = $tx.scopeReadyPuts; StartedAt = $tx.startedAt; FinishedAt = $(if ($tx.ContainsKey('finishedAt')) { $tx.finishedAt } else { $null }); DurationMs = $duration; Stores = ($tx.stores -join '|'); PutRequestsJson = (ConvertTo-Json -InputObject $tx.putRequests -Depth 10 -Compress) })
        foreach ($put in $tx.putRequests.GetEnumerator()) {
            $requests = Number $put.Value 'put requests'
            Increment $metrics ('putRequests.all.' + $put.Key) $requests
            if ($write) { Increment $metrics ('putRequests.readwrite.' + $put.Key) $requests }
            $rawPuts.Add([ordered]@{ Phase = $Phase; Group = $Group; Iteration = $Sample.iteration; TransactionIndex = $index; Outcome = $outcome; Mode = $tx.mode; ApplicationAtomic = $atomic; MarkerClassification = $reason; Store = $put.Key; Requests = $requests })
        }
    }
    return $metrics
}
function Read-Phase([string]$Directory, [string]$Phase) {
    $manifest = Get-Content -LiteralPath (Join-Path $EvidenceRoot "routes-recheck-$Phase-1-run.json") -Encoding utf8 -Raw | ConvertFrom-Json -AsHashtable -Depth 50
    if ($manifest.FrozenHarnessSHA256 -ne $frozen.Hash -or $manifest.Phase -ne $Phase -or $manifest.Repetitions -ne 20 -or $manifest.LegacyStartup) { throw 'Wrong recheck manifest scope/harness' }
    $files = @(Get-ChildItem -LiteralPath $Directory -Filter 'sheet-url-route-timings.json' -Recurse -File)
    if ($files.Count -ne 7) { throw "Expected seven raw files: $Directory" }
    $groups = @{}
    foreach ($file in $files) {
        $text = $utf8.GetString([IO.File]::ReadAllBytes($file.FullName))
        if ($text.Contains([char]0xfffd)) { throw 'U+FFFD in evidence' }
        $samples = @(ConvertFrom-Json -InputObject $text -AsHashtable -Depth 100)
        if ($samples.Count -ne 20) { throw "Expected 20 samples: $($file.FullName)" }
        $sources.Add([ordered]@{ Phase = $Phase; Path = $file.FullName; SHA256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash; Samples = 20 })
        foreach ($sample in $samples) {
            if ($sample.phase -ne $Phase -or $sample.evidenceEligible -isnot [bool] -or -not $sample.evidenceEligible -or ($sample.ContainsKey('legacyStartup') -and $sample.legacyStartup)) { throw 'Wrong phase/eligibility/legacy flag' }
            $group = "count=$($sample.count)|mode=$($sample.mode)|route=$($sample.route)"
            if ($group -notin $expected) { throw "Unexpected selected group: $group" }
            foreach ($kind in @('runtimeErrors', 'consoleErrors')) {
                if (-not $sample.ContainsKey($kind)) { throw "Missing error observations: $kind" }
                foreach ($message in @($sample[$kind])) {
                    if ($kind -eq 'runtimeErrors' -or $sample.route -notin @('retry', 'startup-B06') -or $sample.consoleErrorContext -ne 'storage-failure-injected') { throw "Unexpected $kind in $Phase/$group" }
                    $rawErrors.Add([ordered]@{ Phase = $Phase; Group = $group; Iteration = $sample.iteration; Kind = $kind; Context = $sample.consoleErrorContext; Message = $message })
                }
            }
            if (-not $groups.ContainsKey($group)) { $groups[$group] = [Collections.Generic.List[object]]::new() }
            $groups[$group].Add([ordered]@{ Metrics = (Sample-Metrics $sample $Phase $group $file.FullName); Sample = $sample })
            $rawSamples.Add([ordered]@{ Phase = $Phase; Source = $file.FullName; Sample = $sample })
        }
    }
    if ($groups.Count -ne 7) { throw "Expected seven unique groups: $Phase" }
    foreach ($group in $expected) {
        if (-not $groups.ContainsKey($group) -or $groups[$group].Count -ne 20) { throw "Wrong group count: $Phase/$group" }
        $iterations = @($groups[$group] | ForEach-Object { $i = Number $_.Sample.iteration 'iteration'; if ($i -ne [int]$i) { throw 'Noninteger iteration' }; $i } | Sort-Object -Unique)
        if ($iterations.Count -ne 20 -or $iterations[0] -ne 0 -or $iterations[-1] -ne 19) { throw 'Wrong iteration set' }
    }
    return $groups
}
function Stats([object[]]$Values) {
    $sorted = @($Values | Where-Object { $null -ne $_ } | Sort-Object)
    if (-not $sorted.Count) { return [pscustomobject]@{ N = 0; Median = $null; P95 = $null; Sum = $null } }
    $sum = 0.0
    foreach ($value in $sorted) { $sum += $value }
    return [pscustomobject]@{ N = $sorted.Count; Median = $sorted[[int][math]::Ceiling(.5 * $sorted.Count) - 1]; P95 = $sorted[[int][math]::Ceiling(.95 * $sorted.Count) - 1]; Sum = $sum }
}
function Difference([object]$Before, [object]$After) {
    if ($null -eq $Before -or $null -eq $After) { return [pscustomobject]@{ Delta = $null; Percent = $null } }
    return [pscustomobject]@{ Delta = $After - $Before; Percent = $(if ($Before -eq 0) { if ($After -eq 0) { 0.0 } else { $null } } else { 100 * ($After - $Before) / $Before }) }
}
$before = Read-Phase $BeforeDirectory 'before'
$after = Read-Phase $AfterDirectory 'after'
$comparisons = foreach ($group in $expected) {
    $left = $before[$group]; $right = $after[$group]
    $names = @(@($left | ForEach-Object { $_.Metrics.Keys }) + @($right | ForEach-Object { $_.Metrics.Keys }) | Sort-Object -Unique)
    foreach ($name in $names) {
        $zeroWhenAbsent = $name -match '^(counter|putRequests)\.' -or $name -match '\.count$'
        $l = Stats @($left | ForEach-Object { if ($_.Metrics.ContainsKey($name)) { $_.Metrics[$name] } elseif ($zeroWhenAbsent) { 0.0 } })
        $r = Stats @($right | ForEach-Object { if ($_.Metrics.ContainsKey($name)) { $_.Metrics[$name] } elseif ($zeroWhenAbsent) { 0.0 } })
        $median = Difference $l.Median $r.Median; $p95 = Difference $l.P95 $r.P95
        [pscustomobject][ordered]@{ Group = $group; Metric = $name; Role = $(if ($name -like 'setup.*') { 'initial-setup-not-route' } else { 'reported-interval-or-count' }); Unit = (Metric-Unit $name); BeforeSamples = 20; AfterSamples = 20; BeforeObserved = $l.N; AfterObserved = $r.N; BeforeMedian = $l.Median; AfterMedian = $r.Median; MedianDelta = $median.Delta; MedianDeltaPercent = $median.Percent; BeforeP95 = $l.P95; AfterP95 = $r.P95; P95Delta = $p95.Delta; P95DeltaPercent = $p95.Percent; BeforeSampleSum = $l.Sum; AfterSampleSum = $r.Sum }
    }
}
$notes = @('Selected seven-case recheck only; the other 41 route cases are not evaluated here.', 'Quantiles use nearest rank ceil(p*n)-1, matching the main route comparison.', 'All-readwrite/item-domain/application-atomic scopes overlap and must not be added as independent totals.', 'Transaction duration sums can overlap wall time and one another.', 'On nonstartup routes, eventListsDataPuts markers are retained as unattributed data-write markers, not evidence of an extra URL compatibility save.', 'startupScreenDomMs is initial setup on nonstartup routes and appears under setup.*, never as the main operation duration.', 'Missing scalar/DOM/rAF intervals stay null. No browser paint or transport cause is inferred from unattributed residual time.', 'Expected injected console errors are retained separately; runtime errors or ordinary-route console errors reject evidence.', 'No shopping response threshold is applied to route completion durations.')
$summary = [ordered]@{ CreatedUtc = [DateTime]::UtcNow.ToString('o'); FullRouteMatrix = $false; SelectedScope = $expected; NotEvaluatedRouteCases = 41; Groups = 7; SamplesPerGroupPerPhase = 20; FrozenHarnessSHA256 = $frozen.Hash; Sources = $sources.ToArray(); ExpectedInjectedConsoleErrorRecords = $rawErrors.Count; RuntimeErrors = @(); Notes = $notes; Comparisons = @($comparisons) }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$summary | ConvertTo-Json -Depth 30 | Out-File -LiteralPath (Join-Path $OutputDirectory 'summary.json') -Encoding utf8 -NoClobber
[ordered]@{ Notes = $notes; Records = $rawSamples.ToArray() } | ConvertTo-Json -Depth 100 | Out-File -LiteralPath (Join-Path $OutputDirectory 'raw-samples.json') -Encoding utf8 -NoClobber
$comparisons | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'comparisons.csv') -Encoding utf8 -NoTypeInformation -NoClobber
$rawScalars | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'raw-scalar-intervals.csv') -Encoding utf8 -NoTypeInformation -NoClobber
$rawTransactions | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'raw-transactions.csv') -Encoding utf8 -NoTypeInformation -NoClobber
$rawPuts | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'raw-store-put-requests.csv') -Encoding utf8 -NoTypeInformation -NoClobber
$rawErrors | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'expected-injected-console-errors.csv') -Encoding utf8 -NoTypeInformation -NoClobber
Write-Output "Validated seven paired browser recheck groups x 20; output=$OutputDirectory"
