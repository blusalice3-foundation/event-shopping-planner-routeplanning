[CmdletBinding()]
param(
    [string]$EvidenceRoot = $PSScriptRoot,
    [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$inputPath = Join-Path $EvidenceRoot 'independent-summary-browser-recheck1/raw-samples.json'
if (!$OutputDirectory) { $OutputDirectory = Join-Path $EvidenceRoot 'independent-summary-browser-recheck-interval-audit' }
if (Test-Path -LiteralPath $OutputDirectory) { throw "Output already exists: $OutputDirectory" }
$records = ([IO.File]::ReadAllText($inputPath, $utf8) | ConvertFrom-Json -Depth 100).Records
$cases = @('count=150|mode=direct|route=retry', 'count=150|mode=direct|route=startup-B06', 'count=500|mode=worker|route=update')
function Metric-Unit([string]$Name) {
    # Count/request names take priority; Items ends in lowercase ms and is not milliseconds.
    if ($Name -match '(^|\.)putRequests\.' -or $Name -match '(Count|Calls|Attempts|Successes|Aborted|Puts)$') { return 'count' }
    if ($Name -cmatch 'Ms$') { return 'ms' }
    return 'count'
}
function Group-Key($sample) { return "count=$($sample.count)|mode=$($sample.mode)|route=$($sample.route)" }
function Stats($values) {
    $sorted = @($values | Where-Object { $null -ne $_ } | ForEach-Object { [double]$_ } | Sort-Object)
    if (!$sorted.Count) { return [ordered]@{ Observed = 0; Median = $null; P95 = $null; Min = $null; Max = $null } }
    return [ordered]@{ Observed = $sorted.Count; Median = $sorted[[int][math]::Ceiling(.5 * $sorted.Count) - 1]; P95 = $sorted[[int][math]::Ceiling(.95 * $sorted.Count) - 1]; Min = $sorted[0]; Max = $sorted[-1] }
}
function Duration-Sum($transactions) {
    if (!@($transactions).Count) { return $null }
    if (@($transactions | Where-Object { $null -eq $_.durationMs }).Count) { throw 'Unfinished selected transaction' }
    return [double](($transactions | Measure-Object -Property durationMs -Sum).Sum)
}
function Difference($left, $right) {
    if ($null -eq $left -or $null -eq $right) { return $null }
    return [double]$left - [double]$right
}
function Envelope($transactions) {
    if (!@($transactions).Count) { return $null }
    return [double](($transactions | Measure-Object -Property finishedAt -Maximum).Maximum - ($transactions | Measure-Object -Property startedAt -Minimum).Minimum)
}
$samples = [Collections.Generic.List[object]]::new()
foreach ($phase in @('before', 'after')) {
    foreach ($case in $cases) {
        $selected = @($records | Where-Object { $_.Phase -eq $phase -and (Group-Key $_.Sample) -eq $case })
        if ($selected.Count -ne 20 -or @($selected.Sample.iteration | Sort-Object -Unique).Count -ne 20) { throw "Expected 20 unique iterations: $phase $case" }
        foreach ($record in $selected) {
            $s = $record.Sample
            if ($s.evidenceEligible -ne $true -or @($s.runtimeErrors).Count) { throw "Ineligible sample: $phase $case $($s.iteration)" }
            $tx = @($s.transactions)
            $atomic = @($tx | Where-Object { $_.mode -eq 'readwrite' -and 'eventLists' -in $_.stores -and 'eventConsistency' -in $_.stores })
            $success = @($atomic | Where-Object outcome -EQ 'complete')
            $abort = @($atomic | Where-Object outcome -EQ 'abort')
            $putTotals = @{}
            foreach ($t in $tx) {
                foreach ($p in $t.putRequests.PSObject.Properties) {
                    if (!$putTotals.ContainsKey($p.Name)) { $putTotals[$p.Name] = 0 }
                    $putTotals[$p.Name] += [double]$p.Value
                }
            }
            $putSignature = ($putTotals.Keys | Sort-Object | ForEach-Object { "$_=$($putTotals[$_])" }) -join ';'
            $metrics = [ordered]@{ SuccessCount = $success.Count; AbortCount = $abort.Count; SuccessfulAtomicMs = (Duration-Sum $success); AbortedAtomicMs = (Duration-Sum $abort) }
            if ($s.route -eq 'retry') {
                if ($abort.Count -ne 1 -or $success.Count -ne 1) { throw 'Expected one pre-timing abort and one retry commit' }
                $post = @($tx | Where-Object { $_.startedAt -ge $abort[0].finishedAt } | Sort-Object startedAt)
                $read = @($post | Where-Object { $_.mode -eq 'readonly' -and 'eventLists' -in $_.stores })
                if ($post.Count -ne 2 -or $read.Count -ne 1) { throw 'Unexpected retry transaction shape' }
                $metrics.DurationMs = [double]$s.durationMs
                $metrics.PostAbortTransactions = $post.Count
                $metrics.PostAbortReadMs = Duration-Sum $read
                $metrics.PostAbortEnvelopeMs = Envelope $post
                $metrics.ReadEndToWriteStartMs = [double]($success[0].startedAt - $read[0].finishedAt)
                $metrics.WallMinusPostAbortEnvelopeMs = [double]$s.durationMs - $metrics.PostAbortEnvelopeMs
            } elseif ($s.route -eq 'startup-B06') {
                $metrics.DurationMs = [double]$s.durationMs
                $metrics.FailureMs = [double]$s.failureMs
                $metrics.RetryMs = [double]$s.retryMs
                $metrics.SegmentResidualMs = [double]$s.durationMs - [double]$s.failureMs - [double]$s.retryMs
                $metrics.VerifiedReadTransactions = @($s.verifiedSnapshotReadSpans).Count
                $metrics.TransactionsStartingAfterDom = $(if ($null -eq $s.marks.startupScreenDomAt) { $null } else { @($tx | Where-Object { $_.startedAt -gt $s.marks.startupScreenDomAt }).Count })
            } else {
                $worker = @($tx | Where-Object realm -EQ 'worker')
                $read = @($worker | Where-Object { $_.mode -eq 'readonly' -and 'eventLists' -in $_.stores })
                $write = @($success | Where-Object realm -EQ 'worker')
                $verifyRead = @($tx | Where-Object { $_.realm -eq 'main' -and $_.mode -eq 'readonly' -and @($_.stores).Count -eq 1 -and 'eventLists' -in $_.stores })
                if ($read.Count -ne 1 -or $write.Count -ne 1 -or $verifyRead.Count -ne 1) { throw 'Unexpected worker update transaction shape' }
                foreach ($name in @('reviewMs', 'saveMs', 'csvTextToReviewDomMs', 'csvTextToReviewFrameMs', 'confirmationToScreenDomMs', 'confirmationToScreenFrameMs')) {
                    $metrics[$name] = $(if ($null -eq $s.$name) { $null } else { [double]$s.$name })
                }
                $metrics.WorkerReadMs = Duration-Sum $read
                $metrics.WorkerEnvelopeMs = Envelope $worker
                $metrics.ClickToWorkerReadStartMs = Difference $read[0].startedAt $s.marks.confirmationClickedAt
                $metrics.ReadEndToWriteStartMs = [double]($write[0].startedAt - $read[0].finishedAt)
                $metrics.WriteEndToScreenDomMs = Difference $s.marks.screenDomAt $write[0].finishedAt
                $metrics.OutsideSaveVerificationReadMs = Duration-Sum $verifyRead
                $metrics.ReviewMinusCsvDomMs = Difference $s.reviewMs $s.csvTextToReviewDomMs
                $metrics.SaveMinusConfirmationDomMs = Difference $s.saveMs $s.confirmationToScreenDomMs
                $metrics.SaveMinusConfirmationFrameMs = Difference $s.saveMs $s.confirmationToScreenFrameMs
            }
            $samples.Add([ordered]@{ Phase = $phase; Group = $case; Iteration = $s.iteration; Source = $record.Source; PutSignature = $putSignature; Metrics = $metrics })
        }
    }
}
$comparisons = [Collections.Generic.List[object]]::new()
foreach ($case in $cases) {
    $group = @($samples | Where-Object { $_.Group -eq $case })
    $names = @($group | ForEach-Object { $_.Metrics.Keys } | Sort-Object -Unique)
    foreach ($name in $names) {
        $before = Stats @($group | Where-Object Phase -EQ 'before' | ForEach-Object { $_.Metrics[$name] })
        $after = Stats @($group | Where-Object Phase -EQ 'after' | ForEach-Object { $_.Metrics[$name] })
        $comparisons.Add([ordered]@{ Group = $case; Metric = $name; Unit = (Metric-Unit $name); BeforeObserved = $before.Observed; AfterObserved = $after.Observed; BeforeMedian = $before.Median; AfterMedian = $after.Median; MedianDelta = $(if ($null -eq $before.Median -or $null -eq $after.Median) { $null } else { $after.Median - $before.Median }); BeforeP95 = $before.P95; AfterP95 = $after.P95; P95Delta = $(if ($null -eq $before.P95 -or $null -eq $after.P95) { $null } else { $after.P95 - $before.P95 }); BeforeMin = $before.Min; BeforeMax = $before.Max; AfterMin = $after.Min; AfterMax = $after.Max })
    }
}
$outliers = @($samples | Where-Object { $_.Group -eq 'count=500|mode=worker|route=update' } | Sort-Object { [double]$_.Metrics.reviewMs } -Descending | Select-Object -First 6)
$notes = @('This audit selects three cases from the seven-case recheck; it does not rerun or certify the full route matrix.', 'Nearest-rank quantiles: sorted[ceil(p*n)-1]. Marginal medians/deltas are not additive.', 'retry abort is before its durationMs timer. PostAbortEnvelopeMs selects only transactions starting after that abort finished.', 'Worker update main eventLists-only verification read occurs after saveMs capture and before collectProbe; it is outside saveMs.', 'B06 failure/retry are inside durationMs; SegmentResidualMs is calculated separately for each sample.', 'All residuals are arithmetic differences of observed clocks/windows, not identified rendering/network/Playwright causes.', 'Atomic classification requires readwrite plus eventLists and eventConsistency stores; marker reason does not prove URL compatibility work.', 'PutSignature counts observed put requests including aborted attempts; it is not a physical commit count.', 'No cache-hit/miss or CPU-time measurement exists in this raw input.')
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'audit.json'), ([ordered]@{ Input = $inputPath; InputSha256 = (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash; Notes = $notes; Samples = $samples; Comparisons = $comparisons; ReviewOutliers = $outliers } | ConvertTo-Json -Depth 30), $utf8)
$comparisons | ForEach-Object { [pscustomobject]$_ } | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'comparisons.csv') -NoTypeInformation -Encoding utf8
Write-Output "Wrote $($samples.Count) selected samples and $($comparisons.Count) metric comparisons to $OutputDirectory"
