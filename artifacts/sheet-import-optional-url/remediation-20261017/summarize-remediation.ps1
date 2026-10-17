#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$EvidenceRoot = $PSScriptRoot,
    [ValidateSet('engine', 'shopping', 'routes', 'all')]
    [string]$Group = 'all',
    [string]$ShoppingBeforeDirectory = '',
    [string]$ShoppingAfterDirectory = '',
    [ValidateRange(1, 16)]
    [int]$ExpectedShoppingCases = 16,
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
if (-not (Test-Path -LiteralPath $EvidenceRoot -PathType Container)) { throw "Missing evidence directory: $EvidenceRoot" }
$Group = $Group.ToLowerInvariant()
$selectedFamilies = if ($Group -eq 'all') { @('engine', 'shopping', 'routes') } else { @($Group) }
if (-not $OutputDirectory) {
    $summaryDirectory = if ($Group -eq 'all') { 'independent-summary' } else { 'independent-summary-' + $Group }
    $OutputDirectory = Join-Path $EvidenceRoot $summaryDirectory
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$sourceFiles = [Collections.Generic.List[object]]::new()
$runtimeErrors = [Collections.Generic.List[object]]::new()
$errorEvidence = [Collections.Generic.List[object]]::new()
$violations = [Collections.Generic.List[string]]::new()
$shoppingSaveSamples = [Collections.Generic.List[object]]::new()
$shoppingSaveCoverage = [Collections.Generic.List[object]]::new()
$shoppingSaveGroups = @{ before = @{}; after = @{} }
$shoppingSaveDefinitions = @{}

function Metric-Unit([string]$Name) {
    # Count/request names take priority; Items ends in lowercase ms and is not milliseconds.
    if ($Name -match '(^|\.)putRequests\.' -or $Name -match '(Count|Calls|Attempts|Successes|Aborted|Puts)$') { return 'count' }
    if ($Name -cmatch 'Ms$') { return 'ms' }
    return 'count'
}
function Read-EvidenceJson([string]$Path) {
    $text = $utf8.GetString([IO.File]::ReadAllBytes($Path))
    if ($text.Contains([char]0xfffd)) { throw "U+FFFD in evidence: $Path" }
    return ConvertFrom-Json -InputObject $text -AsHashtable -Depth 100
}
function Register-Source([string]$Path) {
    $file = Get-Item -LiteralPath $Path
    $sourceFiles.Add([ordered]@{ Path = $file.FullName; Bytes = $file.Length; SHA256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash })
}
function Number([object]$Value, [string]$Label) {
    if ($null -eq $Value -or $Value -is [bool] -or $Value -is [string]) { throw "Non-numeric value: $Label" }
    $number = [double]$Value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt 0) { throw "Invalid nonnegative finite number: $Label = $Value" }
    return $number
}
function Add-Metric([hashtable]$Metrics, [string]$Name, [object]$Value) {
    $Metrics[$Name] = Number $Value $Name
}
function Observe-Errors([hashtable]$Sample, [string]$Family, [string]$Group) {
    $fields = @('errors', 'runtimeErrors', 'pageErrors', 'error')
    $observed = @($fields | Where-Object { $Sample.ContainsKey($_) })
    $errorEvidence.Add([ordered]@{ Family = $Family; Group = $Group; Recorded = ($observed.Count -gt 0); Fields = $observed })
    foreach ($field in $observed) {
        foreach ($entry in @($Sample[$field])) {
            if ($null -eq $entry -or "$entry" -eq '') { continue }
            $message = if ($entry -is [string]) { $entry } else { ConvertTo-Json -InputObject $entry -Depth 20 -Compress }
            $runtimeErrors.Add([ordered]@{ Family = $Family; Group = $Group; Field = $field; Message = $message })
        }
    }
}
function Metrics-ForSample([hashtable]$Sample, [string]$Family) {
    $metrics = @{}
    foreach ($entry in $Sample.GetEnumerator()) {
        if ($entry.Key -match 'Ms$' -and $null -ne $entry.Value) { Add-Metric $metrics ('scalar.' + $entry.Key) $entry.Value }
    }
    foreach ($name in @('attempts', 'successes', 'aborted', 'readCalls', 'accepted', 'preparationCommits', 'compatibilityCommits')) {
        if ($Sample.ContainsKey($name)) { Add-Metric $metrics ('counter.' + $name) $Sample[$name] }
    }
    if ($Sample.ContainsKey('stages')) {
        foreach ($stage in $Sample.stages.GetEnumerator()) {
            foreach ($field in @('calls', 'inclusiveMs', 'exclusiveMs')) {
                if (-not $stage.Value.ContainsKey($field)) { throw "Missing stage $($stage.Key).$field" }
                Add-Metric $metrics ('stage.' + $stage.Key + '.' + $field) $stage.Value[$field]
            }
        }
    }
    if ($Sample.ContainsKey('puts')) {
        foreach ($put in $Sample.puts.GetEnumerator()) { Add-Metric $metrics ('putRequests.' + $put.Key) $put.Value }
    }
    if ($Sample.ContainsKey('transactions')) {
        $transactions = @($Sample.transactions)
        Add-Metric $metrics 'transaction.attempts' $transactions.Count
        foreach ($tx in $transactions) {
            $outcome = if ($tx.ContainsKey('outcome')) { $tx.outcome } else { 'pending' }
            if ($outcome -notin @('complete', 'abort', 'pending')) { throw "Unknown transaction outcome: $outcome" }
            $outcomeKey = 'transaction.outcome.' + $outcome
            if (-not $metrics.ContainsKey($outcomeKey)) { $metrics[$outcomeKey] = 0.0 }
            $metrics[$outcomeKey]++
            $hasDuration = $false
            if ($tx.ContainsKey('startMs') -and $tx.ContainsKey('endMs')) {
                $duration = Number ([double]$tx.endMs - [double]$tx.startMs) 'transaction duration'
                $hasDuration = $true
            } elseif ($tx.ContainsKey('durationMs') -and $null -ne $tx.durationMs) {
                $duration = Number $tx.durationMs 'transaction duration'
                $hasDuration = $true
            }
            if ($hasDuration) {
                $durationKey = 'transaction.outcome.' + $outcome + '.durationMs'
                if (-not $metrics.ContainsKey($durationKey)) { $metrics[$durationKey] = 0.0 }
                $metrics[$durationKey] += $duration
            }
            if ($Family -eq 'engine') {
                $reason = 'unattributed'
                if ($Sample.ContainsKey('readSpans')) {
                    $reason = 'compatibility'
                    foreach ($read in @($Sample.readSpans)) {
                        if ($tx.startMs -ge $read.startMs -and $tx.endMs -le $read.endMs) { $reason = 'preparation'; break }
                    }
                }
                $reasonKey = 'transaction.reason.' + $reason + '.' + $outcome
                if (-not $metrics.ContainsKey($reasonKey)) { $metrics[$reasonKey] = 0.0 }
                $metrics[$reasonKey]++
                if ($hasDuration) {
                    $durationKey = $reasonKey + '.durationMs'
                    if (-not $metrics.ContainsKey($durationKey)) { $metrics[$durationKey] = 0.0 }
                    $metrics[$durationKey] += $duration
                }
            } else {
                $modeKey = 'transaction.mode.' + $tx.mode + '.' + $outcome
                if (-not $metrics.ContainsKey($modeKey)) { $metrics[$modeKey] = 0.0 }
                $metrics[$modeKey]++
                foreach ($put in $tx.putRequests.GetEnumerator()) {
                    $putKey = 'putRequests.' + $put.Key
                    if (-not $metrics.ContainsKey($putKey)) { $metrics[$putKey] = 0.0 }
                    $metrics[$putKey] += Number $put.Value $putKey
                }
                $atomic = $tx.mode -eq 'readwrite' -and 'eventLists' -in $tx.stores -and 'eventConsistency' -in $tx.stores
                if ($atomic) {
                    # Only successful commits have a proven write reason. Aborted attempts remain separate.
                    $reason = 'unattributed'
                    if ($outcome -eq 'complete') {
                        $reason = if ($tx.eventListsDataPuts -eq 0) { 'preparation' } else { 'compatibility' }
                        if ($reason -eq 'compatibility' -and $Sample.ContainsKey('preparationInCompatibilityCommit') -and $Sample.preparationInCompatibilityCommit) { $reason = 'compatibility-with-preparation' }
                    }
                    $reasonKey = 'atomic.reason.' + $reason + '.' + $outcome
                    if (-not $metrics.ContainsKey($reasonKey)) { $metrics[$reasonKey] = 0.0 }
                    $metrics[$reasonKey]++
                    if ($hasDuration) {
                        $durationKey = $reasonKey + '.durationMs'
                        if (-not $metrics.ContainsKey($durationKey)) { $metrics[$durationKey] = 0.0 }
                        $metrics[$durationKey] += $duration
                    }
                }
            }
        }
    }
    return $metrics
}
function Add-Sample([hashtable]$Groups, [string]$Group, [hashtable]$Sample, [string]$Family) {
    if (-not $Groups.ContainsKey($Group)) { $Groups[$Group] = [Collections.Generic.List[object]]::new() }
    Observe-Errors $Sample $Family $Group
    $Groups[$Group].Add([ordered]@{ Sample = $Sample; Metrics = (Metrics-ForSample $Sample $Family) })
}
function Expected-EngineGroups {
    foreach ($count in @(150, 500)) {
        foreach ($format in @('google', 'legacy')) {
            foreach ($kind in @('normal', 'mixed', 'excluded')) { "count=$count|mode=direct|key=import-$format-$kind" }
        }
        foreach ($mode in @('direct', 'worker')) {
            foreach ($kind in @('normal', 'mixed', 'excluded')) {
                foreach ($switch in @('false', 'true')) { "count=$count|mode=$mode|key=update-$kind-switch=$switch" }
            }
            foreach ($state in @('B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'undefined')) { "count=$count|mode=$mode|key=startup-$state" }
            foreach ($format in @('json', 'xlsx')) {
                foreach ($blank in @('false', 'true')) { "count=$count|mode=$mode|key=restore-$format-blank=$blank" }
            }
            foreach ($following in @('false', 'true')) { "count=$count|mode=$mode|key=retry-following=$following" }
        }
    }
}
function Expected-RouteGroups {
    foreach ($count in @(150, 500)) {
        foreach ($mode in @('direct', 'worker')) {
            foreach ($route in @('import', 'update', 'switch', 'restore-json', 'restore-xlsx', 'startup-B01', 'startup-B02', 'startup-B03', 'startup-B04', 'startup-B05', 'startup-B06', 'retry')) { "count=$count|mode=$mode|route=$route" }
        }
    }
}
function Expected-ShoppingGroups {
    foreach ($count in @(150, 500)) {
        foreach ($concentrated in @('false', 'true')) {
            foreach ($map in @('false', 'true')) {
                foreach ($layout in @('pc', 'smartphone')) {
                    foreach ($operation in @('execute', 'executeRecord', 'focus', 'record', 'next', 'back')) { "count=$count|concentrated=$concentrated|mapVisible=$map|layout=$layout|operation=$operation" }
                }
            }
        }
    }
}
function Validate-Groups([hashtable]$Groups, [string[]]$Expected, [string]$Family, [string]$Phase, [bool]$CheckIterations) {
    $missing = @($Expected | Where-Object { -not $Groups.ContainsKey($_) })
    $extra = @($Groups.Keys | Where-Object { $_ -notin $Expected })
    if ($missing.Count -or $extra.Count -or $Groups.Count -ne $Expected.Count) { throw "$Family/$Phase group mismatch: expected=$($Expected.Count), actual=$($Groups.Count), missing=$($missing -join ';'), extra=$($extra -join ';')" }
    foreach ($key in $Expected) {
        $samples = $Groups[$key]
        if ($samples.Count -lt 20) { throw "$Family/$Phase/$key has only $($samples.Count) samples" }
        if ($CheckIterations) {
            $seen = [Collections.Generic.HashSet[int]]::new()
            foreach ($entry in $samples) {
                $iteration = Number $entry.Sample.iteration 'iteration'
                if ($iteration -ne [int]$iteration -or -not $seen.Add([int]$iteration)) { throw "Duplicate/invalid iteration in $Family/$Phase/$key" }
            }
        }
    }
}
function Read-Engine([string]$Phase) {
    $path = Join-Path $EvidenceRoot "engine-$Phase.log"
    Register-Source $path
    $groups = @{}
    $completed = $false
    foreach ($line in [IO.File]::ReadLines($path, $utf8)) {
        $plainLine = $line -replace '\x1b\[[0-9;]*m', ''
        if ($plainLine -match '^\s*Tests\s+88 passed\b') { $completed = $true }
        $position = $line.IndexOf('SHEET_URL_SAMPLE ')
        if ($position -lt 0) { continue }
        $json = $line.Substring($position + 'SHEET_URL_SAMPLE '.Length) -replace '\x1b\[[0-9;]*m', ''
        $sample = ConvertFrom-Json -InputObject $json.Trim() -AsHashtable -Depth 100
        if ($sample.phase -ne $Phase) { throw "Wrong engine phase: $($sample.phase), expected $Phase" }
        if ($sample.status -notin @('ok', 'ready')) { throw "Failed engine sample: $($sample.key), $($sample.status), $($sample.error)" }
        if (-not $sample.ContainsKey('stages')) { throw "Missing engine stage evidence: $($sample.key)" }
        $key = "count=$($sample.count)|mode=$($sample.mode)|key=$($sample.key)"
        Add-Sample $groups $key $sample 'engine'
    }
    if (-not $completed) { throw "Engine/$Phase log does not contain the completed 88-test success summary" }
    Validate-Groups $groups @(Expected-EngineGroups) 'engine' $Phase $true
    return $groups
}
function Read-Routes([string]$Phase) {
    $directory = Join-Path $EvidenceRoot "routes-$Phase"
    $groups = @{}
    $files = @(Get-ChildItem -LiteralPath $directory -Filter 'sheet-url-route-timings.json' -Recurse -File)
    if ($files.Count -ne 48) { throw "routes/$Phase expected 48 evidence files, found $($files.Count)" }
    foreach ($file in $files) {
        Register-Source $file.FullName
        foreach ($sample in @(Read-EvidenceJson $file.FullName)) {
            if ($sample.phase -ne $Phase -or $sample.evidenceEligible -isnot [bool] -or $sample.evidenceEligible -ne $true) { throw "Ineligible route sample in $($file.FullName)" }
            if ($sample.ContainsKey('status') -and $sample.status -notin @('ok', 'ready')) { throw "Failed route sample in $($file.FullName)" }
            $key = "count=$($sample.count)|mode=$($sample.mode)|route=$($sample.route)"
            Add-Sample $groups $key $sample 'routes'
        }
    }
    Validate-Groups $groups @(Expected-RouteGroups) 'routes' $Phase $true
    return $groups
}
function Shopping-SaveKey([hashtable]$Context, [string]$Operation, [string]$SavePhase, [string]$Metric) {
    return "$($Context.Condition)|diagnostic=$($Context.Window)|operation=$Operation|savePhase=$SavePhase|metric=$Metric"
}
function Add-ShoppingSaveValue([hashtable]$Context, [string]$Metric, [string]$SourceField, [object]$Value, [object]$Sequence, [string]$Operation, [string]$SavePhase, [string]$Definition) {
    $key = Shopping-SaveKey $Context $Operation $SavePhase $Metric
    if (-not $shoppingSaveGroups[$Context.RunPhase].ContainsKey($key)) { $shoppingSaveGroups[$Context.RunPhase][$key] = [Collections.Generic.List[object]]::new() }
    $shoppingSaveDefinitions[$key] = [ordered]@{ Condition = $Context.Condition; DiagnosticWindow = $Context.Window; Operation = $Operation; SavePhase = $SavePhase; Metric = $Metric; Definition = $Definition }
    $observed = $null -ne $Value
    $duration = if ($observed) { Number $Value $SourceField } else { $null }
    $record = [ordered]@{ RunPhase = $Context.RunPhase; Condition = $Context.Condition; DiagnosticWindow = $Context.Window; Operation = $Operation; SavePhase = $SavePhase; Sequence = $Sequence; Metric = $Metric; DurationMs = $duration; Observed = $observed; SourceFile = $Context.SourceFile; SourceField = $SourceField; Definition = $Definition }
    $shoppingSaveSamples.Add($record)
    if ($observed) { $shoppingSaveGroups[$Context.RunPhase][$key].Add($duration) }
}
function Visit-ShoppingSaveTimes([object]$Value, [hashtable]$Context, [string]$Metric, [string]$SourceField, [bool]$SaveContext, [bool]$MillisecondsField, [object]$Sequence, [string]$Operation, [string]$SavePhase, [string]$Definition) {
    if ($Value -is [Collections.IDictionary]) {
        foreach ($entry in $Value.GetEnumerator()) {
            # Cached summaries and render counts are never timing evidence.
            if ($entry.Key -in @('summary', 'renders')) { continue }
            $childSave = $SaveContext -or $entry.Key -match '(?i)(save|commit|persist|flush)'
            Visit-ShoppingSaveTimes $entry.Value $Context "$Metric.$($entry.Key)" "$SourceField.$($entry.Key)" $childSave ($entry.Key -match 'Ms$') $Sequence $Operation $SavePhase $Definition
        }
    } elseif ($Value -is [array]) {
        for ($index = 0; $index -lt $Value.Length; $index++) {
            Visit-ShoppingSaveTimes $Value[$index] $Context "$Metric[]" "$SourceField[$index]" $SaveContext $MillisecondsField $Sequence $Operation $SavePhase $Definition
        }
    } elseif ($SaveContext -and $MillisecondsField) {
        Add-ShoppingSaveValue $Context $Metric $SourceField $Value $Sequence $Operation $SavePhase $Definition
    }
}
function Collect-ShoppingSaveEvidence([hashtable]$Sample, [string]$Phase, [string]$Condition, [string]$SourceFile) {
    foreach ($window in @('diagnostic', 'executionDiagnostic', 'executionRecordDiagnostic')) {
        $context = @{ RunPhase = $Phase; Condition = $Condition; Window = $window; SourceFile = $SourceFile }
        $definition = 'item-command/save: mutation request dispatch to committed coordinator result callback; includes queue/persistence completion, excludes input/paint; not physical IDB transaction duration'
        $defaultKey = Shopping-SaveKey $context 'item-command' 'save' 'samples.durationMs'
        if (-not $shoppingSaveGroups[$Phase].ContainsKey($defaultKey)) { $shoppingSaveGroups[$Phase][$defaultKey] = [Collections.Generic.List[object]]::new() }
        $shoppingSaveDefinitions[$defaultKey] = [ordered]@{ Condition = $Condition; DiagnosticWindow = $window; Operation = 'item-command'; SavePhase = 'save'; Metric = 'samples.durationMs'; Definition = $definition }
        $startIndex = $shoppingSaveSamples.Count
        $present = $Sample.ContainsKey($window) -and $null -ne $Sample[$window]
        $sampleArrayPresent = $present -and $Sample[$window].ContainsKey('samples')
        $saveRecords = 0
        $retainedSamples = $null
        if ($sampleArrayPresent) {
            $records = @($Sample[$window].samples)
            $retainedSamples = $records.Count
            for ($index = 0; $index -lt $records.Count; $index++) {
                $record = $records[$index]
                if (-not $record.ContainsKey('phase') -or $record.phase -notmatch '^(save|commit|persist|flush)$') { continue }
                $saveRecords++
                $operation = if ($record.ContainsKey('operation')) { [string]$record.operation } else { 'unspecified' }
                $sequence = if ($record.ContainsKey('sequence')) { $record.sequence } else { $null }
                $recordDefinition = if ($operation -eq 'item-command' -and $record.phase -eq 'save') { $definition } else { 'reported save/commit phase duration; caller interval boundaries not independently identified' }
                Visit-ShoppingSaveTimes $record $context 'samples' "$window.samples[$index]" $true $false $sequence $operation ([string]$record.phase) $recordDefinition
            }
        }
        if ($present) {
            # Preserve any separately reported save/commit *Ms scalar/array fields as independent intervals.
            foreach ($entry in $Sample[$window].GetEnumerator()) {
                if ($entry.Key -in @('samples', 'summary', 'renders')) { continue }
                Visit-ShoppingSaveTimes $entry.Value $context ([string]$entry.Key) "$window.$($entry.Key)" ($entry.Key -match '(?i)(save|commit|persist|flush)') ($entry.Key -match 'Ms$') $null 'unspecified' 'reported-save-field' 'reported save/commit *Ms field; interval boundaries not supplied in source diagnostics'
            }
        }
        $observedCount = 0
        for ($index = $startIndex; $index -lt $shoppingSaveSamples.Count; $index++) { if ($shoppingSaveSamples[$index].Observed) { $observedCount++ } }
        $shoppingSaveCoverage.Add([ordered]@{ RunPhase = $Phase; Condition = $Condition; DiagnosticWindow = $window; DiagnosticPresent = $present; SampleArrayPresent = $sampleArrayPresent; RetainedDiagnosticSamples = $retainedSamples; AtRetentionLimit = ($null -ne $retainedSamples -and $retainedSamples -ge 500); SavePhaseRecords = $saveRecords; ObservedSaveValues = $observedCount; Status = $(if ($observedCount) { 'observed' } else { 'unobserved' }); SourceFile = $SourceFile })
    }
}
function Compare-ShoppingSaveGroups {
    $keys = @(@($shoppingSaveGroups.before.Keys) + @($shoppingSaveGroups.after.Keys) | Sort-Object -Unique)
    foreach ($key in $keys) {
        [object[]]$beforeValues = @()
        [object[]]$afterValues = @()
        if ($shoppingSaveGroups.before.ContainsKey($key)) { $beforeValues = $shoppingSaveGroups.before[$key].ToArray() }
        if ($shoppingSaveGroups.after.ContainsKey($key)) { $afterValues = $shoppingSaveGroups.after[$key].ToArray() }
        $before = Statistics $beforeValues $beforeValues.Count
        $after = Statistics $afterValues $afterValues.Count
        $median = Difference $before.Median $after.Median
        $p95 = Difference $before.P95 $after.P95
        $definition = $shoppingSaveDefinitions[$key]
        [pscustomobject][ordered]@{
            Group = $key; Condition = $definition.Condition; DiagnosticWindow = $definition.DiagnosticWindow; Operation = $definition.Operation; SavePhase = $definition.SavePhase; Metric = $definition.Metric; Definition = $definition.Definition
            BeforeObservedSamples = $before.Count; AfterObservedSamples = $after.Count; BeforeStatus = $(if ($before.Count) { 'observed' } else { 'unobserved' }); AfterStatus = $(if ($after.Count) { 'observed' } else { 'unobserved' })
            BeforeMedianMs = $before.Median; AfterMedianMs = $after.Median; MedianDeltaMs = $median.Delta; MedianDeltaPercent = $median.Percent; MedianPercentBasis = $median.Basis
            BeforeP95Ms = $before.P95; AfterP95Ms = $after.P95; P95DeltaMs = $p95.Delta; P95DeltaPercent = $p95.Percent; P95PercentBasis = $p95.Basis
            BeforeMinMs = $before.Min; AfterMinMs = $after.Min; BeforeMaxMs = $before.Max; AfterMaxMs = $after.Max
            BeforeSampleSumMs = $before.SampleSum; AfterSampleSumMs = $after.SampleSum
            ThresholdsApplied = $false
        }
    }
}
function Shopping-Directory([string]$Phase) {
    $override = if ($Phase -eq 'before') { $ShoppingBeforeDirectory } else { $ShoppingAfterDirectory }
    if ($override) { return [IO.Path]::GetFullPath($override) }
    return Join-Path $EvidenceRoot "shopping-$Phase"
}
function Read-Shopping([string]$Phase) {
    $directory = Shopping-Directory $Phase
    $groups = @{}
    $conditions = [Collections.Generic.HashSet[string]]::new()
    $files = @(Get-ChildItem -LiteralPath $directory -Filter 'shopping-operation-timings.json' -Recurse -File)
    if ($files.Count -ne $ExpectedShoppingCases) { throw "shopping/$Phase expected $ExpectedShoppingCases evidence files, found $($files.Count)" }
    foreach ($file in $files) {
        Register-Source $file.FullName
        $sample = Read-EvidenceJson $file.FullName
        if ($sample.count -notin @(150, 500) -or $sample.layout -notin @('pc', 'smartphone') -or $sample.concentrated -isnot [bool] -or $sample.mapVisible -isnot [bool]) { throw "Invalid shopping condition in $($file.FullName)" }
        $concentrated = $sample.concentrated.ToString().ToLowerInvariant()
        $map = $sample.mapVisible.ToString().ToLowerInvariant()
        $condition = "count=$($sample.count)|concentrated=$concentrated|mapVisible=$map|layout=$($sample.layout)"
        if (-not $conditions.Add($condition)) { throw "Duplicate shopping condition: $condition" }
        Observe-Errors $sample 'shopping' $condition
        Collect-ShoppingSaveEvidence $sample $Phase $condition $file.FullName
        if ($sample.timings.Count -ne 6) { throw "shopping/$Phase/$condition must have exactly six operations" }
        foreach ($operation in @('execute', 'executeRecord', 'focus', 'record', 'next', 'back')) {
            if (-not $sample.timings.ContainsKey($operation)) { throw "Missing shopping operation: $operation" }
            $key = "$condition|operation=$operation"
            $groups[$key] = [Collections.Generic.List[object]]::new()
            foreach ($value in @($sample.timings[$operation])) {
                $groups[$key].Add([ordered]@{ Metrics = @{ 'scalar.responseMs' = (Number $value "$key response") } })
            }
        }
    }
    if ($conditions.Count -ne $ExpectedShoppingCases) { throw "shopping/$Phase expected $ExpectedShoppingCases unique conditions, found $($conditions.Count)" }
    $expected = @(Expected-ShoppingGroups)
    if ($ExpectedShoppingCases -lt 16) {
        $expected = @($expected | Where-Object {
            $condition = $_.Substring(0, $_.IndexOf('|operation='))
            $conditions.Contains($condition)
        })
    }
    if ($expected.Count -ne 6 * $ExpectedShoppingCases) { throw "shopping/$Phase selected scope is outside the canonical 16 conditions" }
    Validate-Groups $groups $expected 'shopping' $Phase $false
    return $groups
}
function Statistics([object[]]$Values, [int]$TotalSamples) {
    $sorted = @($Values | Sort-Object)
    if ($sorted.Count -eq 0) { return [pscustomobject][ordered]@{ Count = 0; Missing = $TotalSamples; Median = $null; P95 = $null; Min = $null; Max = $null; SampleSum = $null } }
    $sum = 0.0
    foreach ($value in $sorted) { $sum += $value }
    return [pscustomobject][ordered]@{ Count = $sorted.Count; Missing = $TotalSamples - $sorted.Count; Median = $sorted[[int][Math]::Ceiling(0.5 * $sorted.Count) - 1]; P95 = $sorted[[int][Math]::Ceiling(0.95 * $sorted.Count) - 1]; Min = $sorted[0]; Max = $sorted[-1]; SampleSum = $sum }
}
function Difference([object]$Before, [object]$After) {
    if ($null -eq $Before -or $null -eq $After) { return [ordered]@{ Delta = $null; Percent = $null; Basis = 'missing' } }
    $delta = $After - $Before
    if ($Before -eq 0) { return [ordered]@{ Delta = $delta; Percent = $(if ($After -eq 0) { 0.0 } else { $null }); Basis = 'zero-baseline' } }
    return [ordered]@{ Delta = $delta; Percent = 100.0 * $delta / $Before; Basis = 'nonzero-baseline' }
}
function Compare-Groups([hashtable]$Before, [hashtable]$After, [string]$Family) {
    foreach ($key in @($Before.Keys | Sort-Object)) {
        $left = $Before[$key]
        $right = $After[$key]
        $metrics = @(@($left | ForEach-Object { $_.Metrics.Keys }) + @($right | ForEach-Object { $_.Metrics.Keys }) | Sort-Object -Unique)
        foreach ($metric in $metrics) {
            # Missing stage/counter/transaction/put keys mean zero calls or requests.
            # Missing scalar durations remain unavailable; they are never replaced with 0ms.
            $zeroWhenAbsent = $metric -match '^(stage|counter|transaction|atomic|putRequests)\.'
            $leftValues = @($left | ForEach-Object { if ($_.Metrics.ContainsKey($metric)) { $_.Metrics[$metric] } elseif ($zeroWhenAbsent) { 0.0 } })
            $rightValues = @($right | ForEach-Object { if ($_.Metrics.ContainsKey($metric)) { $_.Metrics[$metric] } elseif ($zeroWhenAbsent) { 0.0 } })
            $beforeStats = Statistics $leftValues $left.Count
            $afterStats = Statistics $rightValues $right.Count
            $medianDiff = Difference $beforeStats.Median $afterStats.Median
            $p95Diff = Difference $beforeStats.P95 $afterStats.P95
            $isMs = (Metric-Unit $metric) -eq 'ms'
            [pscustomobject][ordered]@{
                Family = $Family; Group = $key; Metric = $metric; Unit = $(if ($isMs) { 'ms' } else { 'count' })
                BeforeSamples = $left.Count; AfterSamples = $right.Count; BeforeObserved = $beforeStats.Count; AfterObserved = $afterStats.Count
                BeforeMissing = $beforeStats.Missing; AfterMissing = $afterStats.Missing
                BeforeMedian = $beforeStats.Median; AfterMedian = $afterStats.Median; MedianDelta = $medianDiff.Delta
                MedianDeltaMs = $(if ($isMs) { $medianDiff.Delta } else { $null }); MedianDeltaPercent = $medianDiff.Percent; MedianPercentBasis = $medianDiff.Basis
                BeforeP95 = $beforeStats.P95; AfterP95 = $afterStats.P95; P95Delta = $p95Diff.Delta
                P95DeltaMs = $(if ($isMs) { $p95Diff.Delta } else { $null }); P95DeltaPercent = $p95Diff.Percent; P95PercentBasis = $p95Diff.Basis
                BeforeSampleSum = $beforeStats.SampleSum; AfterSampleSum = $afterStats.SampleSum
            }
        }
    }
}

# Read-only evidence collection. Existing summaries are intentionally ignored.
$datasets = @{}
foreach ($phase in @('before', 'after')) {
    foreach ($family in $selectedFamilies) {
        $datasets["$family-$phase"] = switch ($family) {
            'engine' { Read-Engine $phase }
            'shopping' { Read-Shopping $phase }
            'routes' { Read-Routes $phase }
        }
    }
}
if ('shopping' -in $selectedFamilies) {
    $beforeKeys = @($datasets['shopping-before'].Keys)
    $afterKeys = @($datasets['shopping-after'].Keys)
    if (@($beforeKeys | Where-Object { $_ -notin $afterKeys }).Count -or @($afterKeys | Where-Object { $_ -notin $beforeKeys }).Count) { throw 'Shopping before/after selected conditions differ' }
}
$comparisons = [Collections.Generic.List[object]]::new()
foreach ($family in $selectedFamilies) {
    foreach ($entry in @(Compare-Groups $datasets["$family-before"] $datasets["$family-after"] $family)) { $comparisons.Add($entry) }
}
$shopping = @($comparisons | Where-Object { $_.Family -eq 'shopping' })
$acceptance = @($shopping | ForEach-Object {
    $beforePass = $_.BeforeSamples -ge 20 -and $_.BeforeMedian -le 55.0 -and $_.BeforeP95 -le 100.0
    $afterPass = $_.AfterSamples -ge 20 -and $_.AfterMedian -le 55.0 -and $_.AfterP95 -le 100.0
    if (-not $afterPass) { $violations.Add("Shopping threshold failure: $($_.Group)") }
    [ordered]@{ Group = $_.Group; BeforePass = $beforePass; AfterPass = $afterPass; BeforeMedianMs = $_.BeforeMedian; AfterMedianMs = $_.AfterMedian; BeforeP95Ms = $_.BeforeP95; AfterP95Ms = $_.AfterP95; BeforeSamples = $_.BeforeSamples; AfterSamples = $_.AfterSamples }
})
if ($runtimeErrors.Count -gt 0) { $violations.Add("Recorded runtime errors: $($runtimeErrors.Count)") }
$runtimeEvidenceSummary = @($errorEvidence | Group-Object Family | ForEach-Object {
    [ordered]@{ Family = $_.Name; Observations = $_.Count; WithExplicitErrorFields = @($_.Group | Where-Object Recorded).Count; WithoutExplicitErrorFields = @($_.Group | Where-Object { -not $_.Recorded }).Count }
})
$groupCounts = @{}
$sampleCounts = foreach ($family in $selectedFamilies) {
    $beforeGroups = $datasets["$family-before"]
    $afterGroups = $datasets["$family-after"]
    $groupCounts[$family] = $beforeGroups.Count
    $beforeCounts = @($beforeGroups.Values | ForEach-Object { $_.Count })
    $afterCounts = @($afterGroups.Values | ForEach-Object { $_.Count })
    [ordered]@{
        Family = $family
        BeforeGroups = $beforeGroups.Count
        AfterGroups = $afterGroups.Count
        BeforeSamples = ($beforeCounts | Measure-Object -Sum).Sum
        AfterSamples = ($afterCounts | Measure-Object -Sum).Sum
        BeforeMinimumSamplesPerGroup = ($beforeCounts | Measure-Object -Minimum).Minimum
        AfterMinimumSamplesPerGroup = ($afterCounts | Measure-Object -Minimum).Minimum
    }
}
$saveComparisons = if ('shopping' -in $selectedFamilies) { @(Compare-ShoppingSaveGroups) } else { @() }
$saveEvidence = if ('shopping' -in $selectedFamilies) {
    [ordered]@{
        Definition = 'item-command/save: mutation request dispatch to committed coordinator result callback; not physical transaction-only time'
        TotalRawValues = $shoppingSaveSamples.Count
        ObservedRawValues = @($shoppingSaveSamples | Where-Object Observed).Count
        UnobservedRawValues = @($shoppingSaveSamples | Where-Object { -not $_.Observed }).Count
        DiagnosticCoverage = $shoppingSaveCoverage.ToArray()
        RawSamplesJson = 'shopping-save-samples.json'
        RawSamplesCsv = 'shopping-save-samples.csv'
        ComparisonsJson = 'shopping-save-comparisons.json'
        ComparisonsCsv = 'shopping-save-comparisons.csv'
        Notes = @(
            'Every retained duration value is copied independently from raw diagnostics; cached summaries are ignored.'
            'Each diagnostic snapshot/window, operation label, phase and timing field is a separate group.'
            'Snapshots may overlap; they are not pooled or added to response timings.'
            'executionRecordDiagnostic includes setup/status transitions as well as record actions; item-command cannot be relabelled as one of the six UI operations.'
            'Input/paint phases are excluded. Save callback timing includes queue/persistence completion and is distinct from a physical IDB commit interval.'
            'Diagnostics retain at most 500 samples; absence/truncation is recorded and missing save intervals remain null/unobserved.'
            'Sequence values and full source field paths are preserved; no unsupported response-to-save correspondence is inferred.'
            'The shopping response limits 55ms/100ms and minimum 20 response samples are not applied to save diagnostics.'
        )
    }
} else { $null }
$shoppingScope = if ('shopping' -in $selectedFamilies) {
    $selectedConditions = @($datasets['shopping-before'].Keys | ForEach-Object { $_.Substring(0, $_.IndexOf('|operation=')) } | Sort-Object -Unique)
    $canonicalConditions = @(Expected-ShoppingGroups | ForEach-Object { $_.Substring(0, $_.IndexOf('|operation=')) } | Sort-Object -Unique)
    [ordered]@{
        FullMatrix = ($ExpectedShoppingCases -eq 16)
        ExpectedConditions = $ExpectedShoppingCases
        ExpectedOperationGroups = 6 * $ExpectedShoppingCases
        CanonicalConditions = 16
        CanonicalOperationGroups = 96
        SelectedScope = $selectedConditions
        NotEvaluatedConditions = @($canonicalConditions | Where-Object { $_ -notin $selectedConditions })
        BeforeDirectory = Shopping-Directory 'before'
        AfterDirectory = Shopping-Directory 'after'
        JudgmentAppliesOnlyToSelectedScope = $true
    }
} else { $null }
$summary = [ordered]@{
    CreatedUtc = [DateTime]::UtcNow.ToString('o')
    SelectedGroups = @($selectedFamilies)
    NotEvaluatedGroups = @(@('engine', 'shopping', 'routes') | Where-Object { $_ -notin $selectedFamilies })
    SampleCounts = @($sampleCounts)
    Quantiles = 'nearest rank: ceil(p*n)-1; no averaging of the middle pair'
    SourceFiles = $sourceFiles.ToArray()
    GroupsPerPhase = $groupCounts
    ShoppingThresholds = @{ MedianMs = 55.0; P95Ms = 100.0; MinimumSamples = 20 }
    ShoppingScope = $shoppingScope
    ShoppingSelectedAfterPass = $(if ('shopping' -in $selectedFamilies) { @($acceptance | Where-Object { -not $_.AfterPass }).Count -eq 0 } else { $null })
    ShoppingAllAfterPass = $(if ('shopping' -in $selectedFamilies -and $ExpectedShoppingCases -eq 16) { @($acceptance | Where-Object { -not $_.AfterPass }).Count -eq 0 } else { $null })
    SelectedEvidenceValid = ($violations.Count -eq 0)
    ShoppingAcceptance = $acceptance
    ShoppingSaveCompletion = $saveEvidence
    RuntimeErrorEvidence = $runtimeEvidenceSummary
    RuntimeErrors = $runtimeErrors.ToArray()
    Violations = $violations.ToArray()
    Notes = @(
        'Original logs/JSON remain unchanged and contain raw samples.'
        'Inclusive stages overlap parent/child work; never sum them into elapsed totals.'
        'Exclusive stages, read spans and physical transactions have distinct measurement boundaries.'
        'Store putRequests count requests, including aborted transactions, not committed store counts.'
        'Browser preparation/compatibility reasons classify successful atomic commits only; aborted attempts remain unattributed.'
        'Missing scalar durations are unavailable. Missing stage/counter/request metrics mean zero calls or requests.'
        'Runtime error fields absent from a sample are unrecorded, not evidence of zero errors.'
        'A nonzero result over a zero baseline has no finite percentage difference.'
    )
    Comparisons = $comparisons.ToArray()
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$summary | ConvertTo-Json -Depth 30 | Out-File -LiteralPath (Join-Path $OutputDirectory 'summary.json') -Encoding utf8
foreach ($family in $selectedFamilies) {
    $comparisons | Where-Object { $_.Family -eq $family } | Export-Csv -LiteralPath (Join-Path $OutputDirectory "$family-comparisons.csv") -Encoding utf8 -NoTypeInformation
}
if ('shopping' -in $selectedFamilies) {
    [ordered]@{ Definition = $saveEvidence.Definition; Notes = $saveEvidence.Notes; Records = $shoppingSaveSamples.ToArray() } | ConvertTo-Json -Depth 30 | Out-File -LiteralPath (Join-Path $OutputDirectory 'shopping-save-samples.json') -Encoding utf8
    $shoppingSaveSamples | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'shopping-save-samples.csv') -Encoding utf8 -NoTypeInformation
    ConvertTo-Json -InputObject @($saveComparisons) -Depth 20 | Out-File -LiteralPath (Join-Path $OutputDirectory 'shopping-save-comparisons.json') -Encoding utf8
    $saveComparisons | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'shopping-save-comparisons.csv') -Encoding utf8 -NoTypeInformation
    $shoppingSaveCoverage.ToArray() | ConvertTo-Json -Depth 20 | Out-File -LiteralPath (Join-Path $OutputDirectory 'shopping-save-coverage.json') -Encoding utf8
}
if ('shopping' -in $selectedFamilies) {
    $acceptance | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'shopping-acceptance.csv') -Encoding utf8 -NoTypeInformation
}
Write-Output "Validated selected paired groups: $($selectedFamilies -join ', '); outputs=$OutputDirectory"
if ($violations.Count) { throw ($violations -join [Environment]::NewLine) }
