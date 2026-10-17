#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$EvidenceRoot = $PSScriptRoot,
    [string]$LegacyDirectory = '',
    [string]$CurrentDirectory = '',
    [string]$OutputDirectory = ''
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
if (-not $LegacyDirectory) { $LegacyDirectory = Join-Path $EvidenceRoot 'routes-legacy-corrected-B04' }
if (-not $CurrentDirectory) { $CurrentDirectory = Join-Path $EvidenceRoot 'routes-after' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $EvidenceRoot 'independent-summary-legacy-B04' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) { throw "Existing summary must not be overwritten: $OutputDirectory" }
$expectedLegacy = 'cc475cd1837404440e893694147fee17c46a04d2'
$frozen = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'browser-full-harness-manifest.json') -Encoding utf8 -Raw | ConvertFrom-Json -AsHashtable
$run = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'routes-legacy-corrected-B04-run.json') -Encoding utf8 -Raw | ConvertFrom-Json -AsHashtable -Depth 50
if ($run.ExpectedLegacyCommit -ne $expectedLegacy -or $run.HarnessSHA256 -ne $frozen.Hash) { throw 'Legacy commit/harness manifest does not match the corrected B04 run' }
$rawSamples = [Collections.Generic.List[object]]::new()
$rawScalars = [Collections.Generic.List[object]]::new()
$rawTransactions = [Collections.Generic.List[object]]::new()
$rawPuts = [Collections.Generic.List[object]]::new()
$sources = [Collections.Generic.List[object]]::new()
$expectedGroups = @('count=150|mode=direct', 'count=150|mode=worker', 'count=500|mode=direct', 'count=500|mode=worker')
function Metric-Unit([string]$Name) {
    # Count/request names take priority; Items ends in lowercase ms and is not milliseconds.
    if ($Name -match '(^|\.)putRequests\.' -or $Name -match '(Count|Calls|Attempts|Successes|Aborted|Puts)$') { return 'count' }
    if ($Name -cmatch 'Ms$') { return 'ms' }
    return 'count'
}
function Numeric([object]$Value, [string]$Label) {
    if ($null -eq $Value -or $Value -is [bool] -or $Value -is [string]) { throw "Invalid numeric value: $Label" }
    $number = [double]$Value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt 0) { throw "Invalid duration/count: $Label" }
    return $number
}
function Add-Count([hashtable]$Metrics, [string]$Name, [double]$Value) {
    if (-not $Metrics.ContainsKey($Name)) { $Metrics[$Name] = 0.0 }
    $Metrics[$Name] += $Value
}
function First-Route([string]$Path) {
    # Frozen harness writes indented JSON. Inspect only the first top-level route
    # property when selecting B04 from the 48-case current matrix.
    foreach ($line in [IO.File]::ReadLines($Path, $utf8)) {
        if ($line -match '^\s*"route"\s*:\s*"([^"]+)"\s*,?\s*$') { return $Matches[1] }
    }
    throw "Cannot identify the first route in $Path"
}
function Metrics([hashtable]$Sample, [string]$Dataset, [string]$Group, [string]$Source) {
    $metrics = @{}
    foreach ($entry in $Sample.GetEnumerator()) {
        if ($entry.Key -notmatch 'Ms$') { continue }
        $value = if ($null -ne $entry.Value) { Numeric $entry.Value $entry.Key } else { $null }
        $metrics['scalar.' + $entry.Key] = $value
        $rawScalars.Add([ordered]@{ Dataset = $Dataset; Group = $Group; Iteration = $Sample.iteration; Metric = $entry.Key; ValueMs = $value; Observed = ($null -ne $value); Source = $Source })
    }
    $atomic = @($Sample.transactions | Where-Object { $_.mode -eq 'readwrite' -and 'eventLists' -in $_.stores -and 'eventConsistency' -in $_.stores })
    $complete = @($atomic | Where-Object { $_.outcome -eq 'complete' })
    $abort = @($atomic | Where-Object { $_.outcome -eq 'abort' })
    $preparation = @($complete | Where-Object { $_.eventListsDataPuts -eq 0 })
    $compatibility = @($complete | Where-Object { $_.eventListsDataPuts -gt 0 })
    $legacy = $Dataset -eq 'legacy-before'
    $expectedSuccesses = if ($Sample.mode -eq 'worker') { if ($legacy) { 1 } else { 2 } } else { if ($legacy) { 0 } else { 1 } }
    $expectedPreparation = if ($Sample.mode -eq 'worker') { 1 } else { 0 }
    $expectedCompatibility = if ($legacy) { 0 } else { 1 }
    if ($complete.Count -ne $expectedSuccesses -or $abort.Count -ne 0 -or $atomic.Count -ne $expectedSuccesses) { throw "Unexpected B04 atomic outcomes: $Dataset/$Group/$($Sample.iteration)" }
    if ($preparation.Count -ne $expectedPreparation -or $compatibility.Count -ne $expectedCompatibility) { throw "Unexpected preparation/compatibility split: $Dataset/$Group" }
    if ($Sample.preparationCommits -ne $preparation.Count -or $Sample.compatibilityCommits -ne $compatibility.Count) { throw "Declared commit counts disagree with raw transactions: $Dataset/$Group" }
    $combined = -not $legacy -and $Sample.mode -eq 'direct'
    if ($Sample.preparationInCompatibilityCommit -ne $combined) { throw "Combined preparation policy mismatch: $Dataset/$Group" }
    $metrics['counter.atomicAttempts'] = $atomic.Count
    $metrics['counter.atomicSuccesses'] = $complete.Count
    $metrics['counter.atomicAborted'] = $abort.Count
    $metrics['counter.preparationCommits'] = $preparation.Count
    $metrics['counter.compatibilityCommits'] = $compatibility.Count
    $metrics['counter.verifiedSnapshotReadTransactions'] = @($Sample.verifiedSnapshotReadSpans).Count
    $metrics['counter.allObservedTransactions'] = @($Sample.transactions).Count
    foreach ($reason in @('preparation', 'compatibility', 'compatibility-with-preparation')) {
        $metrics["atomic.$reason.successes"] = 0.0
        $metrics["atomic.$reason.durationMs"] = 0.0
    }
    $preparationMs = 0.0
    $compatibilityMs = 0.0
    for ($index = 0; $index -lt $Sample.transactions.Count; $index++) {
        $tx = $Sample.transactions[$index]
        $isAtomic = $tx.mode -eq 'readwrite' -and 'eventLists' -in $tx.stores -and 'eventConsistency' -in $tx.stores
        $outcome = if ($tx.ContainsKey('outcome')) { $tx.outcome } else { 'pending' }
        $duration = if ($tx.ContainsKey('durationMs')) { Numeric $tx.durationMs 'transaction durationMs' } else { $null }
        $reason = 'not-an-atomic-application-commit'
        if ($isAtomic) {
            if ($tx.realm -ne $(if ($Sample.mode -eq 'worker') { 'worker' } else { 'main' })) { throw 'Atomic transaction came from the wrong realm' }
            $reason = if ($tx.eventListsDataPuts -eq 0) { 'preparation' } elseif ($combined) { 'compatibility-with-preparation' } else { 'compatibility' }
            if ($outcome -ne 'complete' -or $null -eq $duration) { throw 'B04 atomic commit is aborted, pending, or lacks a duration' }
            Add-Count $metrics "atomic.$reason.successes" 1
            Add-Count $metrics "atomic.$reason.durationMs" $duration
            if ($reason -eq 'preparation') { $preparationMs += $duration } else { $compatibilityMs += $duration }
        }
        Add-Count $metrics ('transaction.' + $tx.mode + '.' + $outcome + '.count') 1
        if ($null -ne $duration) { Add-Count $metrics ('transaction.' + $tx.mode + '.' + $outcome + '.durationSumMs') $duration }
        $rawTransactions.Add([ordered]@{ Dataset = $Dataset; Group = $Group; Iteration = $Sample.iteration; TransactionIndex = $index; Realm = $tx.realm; Mode = $tx.mode; Outcome = $outcome; Atomic = $isAtomic; Reason = $reason; StartedAt = $tx.startedAt; FinishedAt = $(if ($tx.ContainsKey('finishedAt')) { $tx.finishedAt } else { $null }); DurationMs = $duration; Stores = ($tx.stores -join '|'); EventListsDataPuts = $tx.eventListsDataPuts; ScopeReadyPuts = $tx.scopeReadyPuts; PutRequestsJson = (ConvertTo-Json -InputObject $tx.putRequests -Compress -Depth 10) })
        foreach ($put in $tx.putRequests.GetEnumerator()) {
            $requests = Numeric $put.Value 'putRequests'
            Add-Count $metrics ('putRequests.all.' + $put.Key) $requests
            if ($isAtomic) { Add-Count $metrics ('putRequests.atomic.' + $put.Key) $requests }
            $rawPuts.Add([ordered]@{ Dataset = $Dataset; Group = $Group; Iteration = $Sample.iteration; TransactionIndex = $index; Atomic = $isAtomic; Reason = $reason; Outcome = $outcome; Store = $put.Key; Requests = $requests })
        }
    }
    if ([math]::Abs($preparationMs - $Sample.preparationCommitMs) -gt 0.000001 -or [math]::Abs($compatibilityMs - $Sample.compatibilityCommitMs) -gt 0.000001) { throw 'Declared commit durations disagree with raw transactions' }
    return $metrics
}
function Read-Dataset([string]$Directory, [string]$Dataset) {
    $files = @(Get-ChildItem -LiteralPath $Directory -Filter 'sheet-url-route-timings.json' -Recurse -File | Where-Object { (First-Route $_.FullName) -eq 'startup-B04' })
    if ($files.Count -ne 4) { throw "Expected four corrected B04 files in $Dataset, found $($files.Count)" }
    $groups = @{}
    foreach ($file in $files) {
        $bytes = [IO.File]::ReadAllBytes($file.FullName)
        $text = $utf8.GetString($bytes)
        if ($text.Contains([char]0xfffd)) { throw "Invalid text in $($file.FullName)" }
        $samples = @(ConvertFrom-Json -InputObject $text -AsHashtable -Depth 100)
        if ($samples.Count -ne 20) { throw "Expected exactly 20 samples: $($file.FullName)" }
        $sources.Add([ordered]@{ Dataset = $Dataset; Path = $file.FullName; SHA256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash; Samples = $samples.Count })
        foreach ($sample in $samples) {
            $legacy = $Dataset -eq 'legacy-before'
            $expectedPhase = if ($legacy) { 'before' } else { 'after' }
            if ($sample.route -ne 'startup-B04' -or $sample.phase -ne $expectedPhase -or $sample.evidenceEligible -isnot [bool] -or -not $sample.evidenceEligible) { throw "Wrong phase/route/eligibility: $($file.FullName)" }
            if ($legacy -and (-not $sample.legacyStartup -or $sample.sourceBaseline -ne 'cc475cd')) { throw 'Legacy baseline label is missing or wrong' }
            if (-not $legacy -and $sample.ContainsKey('legacyStartup') -and $sample.legacyStartup) { throw 'Main after sample is unexpectedly a legacy run' }
            foreach ($name in @('runtimeErrors', 'consoleErrors')) {
                if (-not $sample.ContainsKey($name) -or @($sample[$name]).Count -ne 0) { throw "Missing or nonempty $name in B04 evidence" }
            }
            $group = "count=$($sample.count)|mode=$($sample.mode)"
            if ($group -notin $expectedGroups) { throw "Unexpected B04 group: $group" }
            if (-not $groups.ContainsKey($group)) { $groups[$group] = [Collections.Generic.List[object]]::new() }
            $groups[$group].Add([ordered]@{ Sample = $sample; Metrics = (Metrics $sample $Dataset $group $file.FullName) })
            $rawSamples.Add([ordered]@{ Dataset = $Dataset; Source = $file.FullName; Sample = $sample })
        }
    }
    if ($groups.Count -ne 4) { throw "Expected four unique B04 groups: $Dataset" }
    foreach ($group in $expectedGroups) {
        if (-not $groups.ContainsKey($group) -or $groups[$group].Count -ne 20) { throw "Wrong sample count: $Dataset/$group" }
        $iterations = @($groups[$group] | ForEach-Object { $value = Numeric $_.Sample.iteration 'iteration'; if ($value -ne [int]$value) { throw 'Non-integer iteration' }; $value } | Sort-Object -Unique)
        if ($iterations.Count -ne 20 -or $iterations[0] -ne 0 -or $iterations[-1] -ne 19) { throw "Wrong iteration set: $Dataset/$group" }
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
function Delta([object]$Before, [object]$After) {
    if ($null -eq $Before -or $null -eq $After) { return [pscustomobject]@{ Ms = $null; Percent = $null } }
    return [pscustomobject]@{ Ms = $After - $Before; Percent = $(if ($Before -eq 0) { if ($After -eq 0) { 0.0 } else { $null } } else { 100 * ($After - $Before) / $Before }) }
}
$before = Read-Dataset $LegacyDirectory 'legacy-before'
$after = Read-Dataset $CurrentDirectory 'main-after'
$comparisons = foreach ($group in $expectedGroups) {
    $left = $before[$group]
    $right = $after[$group]
    $names = @(@($left | ForEach-Object { $_.Metrics.Keys }) + @($right | ForEach-Object { $_.Metrics.Keys }) | Sort-Object -Unique)
    foreach ($name in $names) {
        $zeroWhenAbsent = $name -match '^(counter|putRequests)\.' -or $name -match '\.(count|successes)$'
        $leftValues = @($left | ForEach-Object { if ($_.Metrics.ContainsKey($name)) { $_.Metrics[$name] } elseif ($zeroWhenAbsent) { 0.0 } })
        $rightValues = @($right | ForEach-Object { if ($_.Metrics.ContainsKey($name)) { $_.Metrics[$name] } elseif ($zeroWhenAbsent) { 0.0 } })
        $l = Stats $leftValues
        $r = Stats $rightValues
        $median = Delta $l.Median $r.Median
        $p95 = Delta $l.P95 $r.P95
        [pscustomobject][ordered]@{ Group = $group; Metric = $name; Unit = (Metric-Unit $name); LegacySamples = 20; CurrentSamples = 20; LegacyObserved = $l.N; CurrentObserved = $r.N; LegacyMedian = $l.Median; CurrentMedian = $r.Median; MedianDelta = $median.Ms; MedianDeltaPercent = $median.Percent; LegacyP95 = $l.P95; CurrentP95 = $r.P95; P95Delta = $p95.Ms; P95DeltaPercent = $p95.Percent; LegacySampleSum = $l.Sum; CurrentSampleSum = $r.Sum }
    }
}
$notes = @(
    'This is a separate historical cc475cd B04 comparison, not the 48-case b536f76/main remediation comparison.'
    'Expected successful atomic commits per sample: legacy direct=0, worker=1; current direct=1, worker=2. B04 has no injected aborts.'
    'Preparation vs compatibility is classified by eventListsDataPuts on complete atomic transactions.'
    'Current direct combines preparation with the compatibility commit; separate preparationCommitMs=0 does not mean preparation work is free.'
    'Transaction duration sums can overlap each other and scalar/DOM intervals; do not add them to elapsed wall time.'
    'verifiedSnapshotReadSpans count observed readonly transactions, not logical API read calls.'
    'putRequests count observed put calls, not commits or unique persisted rows.'
    'startupScreenDomMs is navigation time origin to the observed event-list DOM. A startup rAF completion time is not instrumented by this frozen harness.'
    'CSV/confirmation rAF fields are retained as null/unobserved for B04; they are not startup paint durations.'
    'No missing scalar interval is replaced with zero. Zero transaction counts/durations can mean no such commit was performed.'
    'The sourceBaseline field is a harness label; server identity and legacy source attribution are recorded separately in the run manifest.'
    'The shopping 55ms/100ms limits are not applied to startup completion time.'
)
$summary = [ordered]@{ CreatedUtc = [DateTime]::UtcNow.ToString('o'); Scope = 'startup-B04 only'; FullRouteMatrix = $false; Groups = 4; SamplesPerGroupPerDataset = 20; LegacyExpectedCommit = $expectedLegacy; LegacyRunManifest = 'routes-legacy-corrected-B04-run.json'; FrozenHarnessSHA256 = $frozen.Hash; Sources = $sources.ToArray(); Quantiles = 'nearest rank ceil(p*n)-1'; Notes = $notes; Comparisons = @($comparisons) }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$summary | ConvertTo-Json -Depth 30 | Out-File -LiteralPath (Join-Path $OutputDirectory 'summary.json') -Encoding utf8 -NoClobber
[ordered]@{ Notes = $notes; Records = $rawSamples.ToArray() } | ConvertTo-Json -Depth 100 | Out-File -LiteralPath (Join-Path $OutputDirectory 'raw-samples.json') -Encoding utf8 -NoClobber
$comparisons | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'comparisons.csv') -Encoding utf8 -NoTypeInformation -NoClobber
$rawScalars | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'raw-scalar-intervals.csv') -Encoding utf8 -NoTypeInformation -NoClobber
$rawTransactions | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'raw-transactions.csv') -Encoding utf8 -NoTypeInformation -NoClobber
$rawPuts | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'raw-store-put-requests.csv') -Encoding utf8 -NoTypeInformation -NoClobber
Write-Output "Validated historical corrected B04: four paired groups x 20; output=$OutputDirectory"
