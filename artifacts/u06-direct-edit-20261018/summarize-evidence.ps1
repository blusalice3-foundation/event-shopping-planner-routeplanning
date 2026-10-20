param(
    [string]$RepoRoot = (Join-Path $PSScriptRoot '../..'),
    [string]$EvidenceRelativePath = 'artifacts/u06-direct-edit-20261018',
    [ValidateSet('Summary', 'Identity', 'All')][string]$Mode = 'Summary',
    [ValidatePattern('^[a-z0-9-]*$')][string]$SnapshotSuffix = ''
)

# Run Identity after the candidate build, Summary after both isolated measurements,
# and Identity -SnapshotSuffix '-final' to verify source stability afterward.
# Historical evidence is read only. Every output belongs to this evidence folder.
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$RepoRoot = [IO.Path]::GetFullPath($RepoRoot)
$EvidenceRoot = Join-Path $RepoRoot $EvidenceRelativePath
$HistoricalRoot = Join-Path $RepoRoot 'artifacts/priority-user-operation-consistency-20261018'
$Utf8 = [Text.UTF8Encoding]::new($false, $true)
$Issues = [Collections.Generic.List[string]]::new()
$RecordedAt = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'Tokyo Standard Time').ToString('o')
New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null

function Read-Utf8File([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 2 -and (($bytes[0] -eq 255 -and $bytes[1] -eq 254) -or ($bytes[0] -eq 254 -and $bytes[1] -eq 255))) {
        throw "Unexpected UTF-16 BOM: $Path"
    }
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
    $value = $Utf8.GetString($bytes)
    if ($bom) { $value = $value.Substring(1) }
    return [pscustomobject]@{
        text = $value
        encoding = 'UTF-8'
        bom = [bool]$bom
        crlf = [regex]::Matches($value, "`r`n").Count
        lf = [regex]::Matches($value, "(?<!`r)`n").Count
        cr = [regex]::Matches($value, "`r(?!`n)").Count
        replacement = [regex]::Matches($value, [string][char]0xfffd).Count
        questions = [regex]::Matches($value, '\?').Count
    }
}
function Read-Json([string]$Path) { return ((Read-Utf8File $Path).text | ConvertFrom-Json -Depth 100) }
function Write-Json([string]$Name, $Value) {
    $path = Join-Path $EvidenceRoot $Name
    $json = (($Value | ConvertTo-Json -Depth 100).Replace("`r`n", "`n").Replace("`r", "`n")) + "`n"
    [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
    $check = Read-Utf8File $path
    if ($check.bom -or $check.crlf -or $check.cr -or $check.replacement) { throw "Output encoding check failed: $path" }
    $null = $check.text | ConvertFrom-Json -Depth 100
}
function Sha256-File([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function Sha256-Text([string]$Value) { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Utf8.GetBytes($Value))) }
function Add-Issue([string]$Message) { $Issues.Add($Message) }
function Report-Attachments($Report, [string]$ReportName) {
    function Walk-Suite($Suite) {
        if ($null -eq $Suite) { return }
        foreach ($spec in @($Suite.specs)) {
            foreach ($testCase in @($spec.tests)) {
                foreach ($result in @($testCase.results)) {
                    foreach ($attachment in @($result.attachments)) {
                        if ($attachment.contentType -ne 'application/json' -or $attachment.name -notmatch '^(shopping-operation-timings|priority-(operation|relay)-diagnostics-)') { continue }
                        if ($attachment.body) { $payload = $Utf8.GetString([Convert]::FromBase64String($attachment.body)) }
                        elseif ($attachment.path) { $payload = (Read-Utf8File $attachment.path).text }
                        else { throw "Attachment has no body or path: $($attachment.name)" }
                        [pscustomobject]@{ source = $ReportName; title = $spec.title; name = $attachment.name; status = $result.status; data = ($payload | ConvertFrom-Json -Depth 100) }
                    }
                }
            }
        }
        foreach ($child in @($Suite.suites)) { Walk-Suite $child }
    }
    foreach ($suite in @($Report.suites)) { Walk-Suite $suite }
}
function Shopping-Key($Payload) { return "$($Payload.count)|$($Payload.concentrated)|$($Payload.mapVisible)|$($Payload.layout)" }
function Diagnostic-Key($Payload) {
    if ($Payload.PSObject.Properties.Name -contains 'kind') { return "relay|$($Payload.count)|$($Payload.kind)|$([bool]$Payload.roundTrip)" }
    return "dialog|$($Payload.count)"
}
function Summarize-Values($RawValues, [bool]$Warm, [string]$Label) {
    $all = @($RawValues | ForEach-Object { [double]$_ })
    $values = if ($Warm) { @($all | Select-Object -Skip 1 | Sort-Object) } else { @($all | Sort-Object) }
    $finite = @($values | Where-Object { [double]::IsNaN($_) -or [double]::IsInfinity($_) }).Count -eq 0
    if (-not $finite -or $values.Count -eq 0) { Add-Issue "Invalid or absent samples: $Label"; return $null }
    $median = if ($Warm) {
        ($values[[int][math]::Floor(($values.Count - 1) / 2)] + $values[[int][math]::Ceiling(($values.Count - 1) / 2)]) / 2
    } else { $values[[int][math]::Ceiling($values.Count * 0.5) - 1] }
    $p95 = $values[[int][math]::Ceiling($values.Count * 0.95) - 1]
    $pass = $values.Count -ge 20 -and $median -le 55 -and $p95 -le 100
    if (-not $pass) { Add-Issue "Threshold failed: $Label; n=$($values.Count), median=$median, p95=$p95" }
    return [pscustomobject]@{ count = $values.Count; medianMs = $median; p95Ms = $p95; firstMs = $(if ($Warm) { $all[0] } else { $null }); pass = $pass }
}
function Check-AttachedSummary($Computed, $Attached, [string]$Label) {
    if ($null -eq $Computed) { return }
    if ($null -eq $Attached -or $Computed.count -ne $Attached.count -or [math]::Abs($Computed.medianMs - $Attached.medianMs) -gt 0.00000001 -or [math]::Abs($Computed.p95Ms - $Attached.p95Ms) -gt 0.00000001) { Add-Issue "Attached summary differs from raw samples: $Label" }
}
function Check-Report($Report, [int]$Expected, [string]$Label) {
    if ($Report.stats.expected -ne $Expected -or $Report.stats.unexpected -ne 0 -or $Report.stats.flaky -ne 0 -or $Report.stats.skipped -ne 0 -or @($Report.errors).Count -ne 0) { Add-Issue "Browser report has failures, skips, retries, errors, or missing tests: $Label" }
}

if ($Mode -in @('Identity', 'All')) {
    $historicalManifest = @(Read-Json (Join-Path $HistoricalRoot 'encoding-and-source-manifest-final.json'))
    $historicalByPath = @{}
    foreach ($entry in $historicalManifest) { $historicalByPath[$entry.path] = $entry }
    $tracked = @(& git -C $RepoRoot ls-files -- src tests package.json package-lock.json 'tsconfig*.json' vite.config.ts vitest.config.ts playwright.config.ts)
    if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
    $untracked = @(& git -C $RepoRoot ls-files --others --exclude-standard -- src tests)
    $changed = @(& git -C $RepoRoot diff --name-only HEAD -- src tests)
    $changedSet = @{}
    foreach ($path in @($changed) + @($untracked)) { $changedSet[$path] = $true }
    $paths = @(@($tracked) + @($untracked) + @($historicalManifest.path) + @("$EvidenceRelativePath/summarize-evidence.ps1") | Sort-Object -Unique)
    $manifest = @(
        foreach ($path in $paths) {
            $absolute = Join-Path $RepoRoot $path
            if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "Manifest source missing: $path" }
            $metadata = Read-Utf8File $absolute
            $hash = Sha256-File $absolute
            $headQuestions = $null
            $headReplacement = $null
            if ($changedSet.ContainsKey($path) -and $path -in $tracked) {
                $headText = @(& git -C $RepoRoot show "HEAD:$path") -join "`n"
                if ($LASTEXITCODE -eq 0) { $headQuestions = [regex]::Matches($headText, '\?').Count; $headReplacement = [regex]::Matches($headText, [string][char]0xfffd).Count }
            }
            if ($metadata.replacement -gt 0 -and ($null -eq $headReplacement -or $metadata.replacement -gt $headReplacement)) { throw "Replacement character appeared or increased: $path" }
            [pscustomobject]@{
                path = $path; encoding = $metadata.encoding; bom = $metadata.bom; crlf = $metadata.crlf; lf = $metadata.lf; cr = $metadata.cr
                replacement = $metadata.replacement; questions = $metadata.questions
                questionDeltaAgainstHead = $(if ($null -ne $headQuestions) { $metadata.questions - $headQuestions } else { $null })
                sha256 = $hash
                production = $path.StartsWith('src/') -and $path -notmatch '\.(test|spec)\.|/__tests__/'
                historicalHash = $(if ($historicalByPath.ContainsKey($path)) { $historicalByPath[$path].sha256 } else { $null })
                matchesHistoricalHash = $(if ($historicalByPath.ContainsKey($path)) { $hash -eq $historicalByPath[$path].sha256 } else { $null })
                representativeLines = @($metadata.text -split "`r?`n" | Where-Object { $_ -match 'ユーザー登録|エラーが発生しました' } | Select-Object -First 3)
            }
        }
    )
    $manifestName = "encoding-and-source-manifest$SnapshotSuffix.json"
    Write-Json $manifestName $manifest
    $diff = (@(& git -C $RepoRoot diff --no-ext-diff --binary HEAD) -join "`n") + "`n"
    if ($LASTEXITCODE -ne 0) { throw 'git diff failed' }
    $diffName = "tracked-source-diff$SnapshotSuffix.patch"
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot $diffName), $diff, [Text.UTF8Encoding]::new($false))
    $releasePath = Join-Path $RepoRoot 'dist/release-identity.json'
    $release = if (Test-Path -LiteralPath $releasePath) { Read-Json $releasePath } else { $null }
    $identity = [ordered]@{
        recordedAtJst = $RecordedAt; repositoryCommit = (@(& git -C $RepoRoot rev-parse HEAD) -join ''); sourceState = 'local candidate; release approval is outside this record'
        gitStatus = @(& git -C $RepoRoot status --short)
        trackedDiff = $diffName; trackedDiffSha256 = (Sha256-File (Join-Path $EvidenceRoot $diffName)); trackedDiffNormalization = 'git text output joined with LF and one trailing LF'
        sourceManifest = $manifestName; sourceManifestSha256 = (Sha256-File (Join-Path $EvidenceRoot $manifestName)); sourceFiles = $manifest.Count
        productionFiles = @($manifest | Where-Object production).Count; historicalManifest = 'artifacts/priority-user-operation-consistency-20261018/encoding-and-source-manifest-final.json'
        historicalFiles = $historicalManifest.Count; historicalHashMatches = @($manifest | Where-Object { $_.matchesHistoricalHash -eq $true }).Count
        sourceScope = 'all git tracked src/tests plus new src/tests, inherited manifest, project build/test configuration, and this helper'
        indexSha256 = $(if (Test-Path -LiteralPath (Join-Path $RepoRoot 'dist/index.html')) { Sha256-File (Join-Path $RepoRoot 'dist/index.html') } else { $null })
        releaseIdentitySha256 = $(if ($release) { Sha256-File $releasePath } else { $null }); releaseIdentity = $release
        node = (@(& node --version) -join ''); npm = (@(& npm --version) -join '')
        environment = @{ PLAYWRIGHT_BASE_URL = $env:PLAYWRIGHT_BASE_URL; PERFORMANCE_BROWSER_CHANNEL = $env:PERFORMANCE_BROWSER_CHANNEL; PERFORMANCE_HEADED = $env:PERFORMANCE_HEADED; ESP_PRIORITY_PHASE = $env:ESP_PRIORITY_PHASE; CI = $env:CI }
    }
    Write-Json "candidate-source-identity$SnapshotSuffix.json" $identity
    if ($SnapshotSuffix) {
        $initialPath = Join-Path $EvidenceRoot 'encoding-and-source-manifest.json'
        if (Test-Path -LiteralPath $initialPath) {
            $initial = @(Read-Json $initialPath)
            $initialByPath = @{}
            foreach ($entry in $initial) { $initialByPath[$entry.path] = $entry.sha256 }
            $differences = @($manifest | Where-Object { -not $initialByPath.ContainsKey($_.path) -or $initialByPath[$_.path] -ne $_.sha256 } | Select-Object -ExpandProperty path)
            $removed = @($initial.path | Where-Object { $_ -notin $manifest.path })
            Write-Json "source-stability$SnapshotSuffix.json" @{ unchanged = $differences.Count -eq 0 -and $removed.Count -eq 0; changedOrAdded = $differences; removed = $removed; initialManifest = 'encoding-and-source-manifest.json'; finalManifest = $manifestName }
            if ($differences.Count -or $removed.Count) { throw 'Measured source changed between initial and final manifests' }
        }
    }
    Write-Host "Identity recorded: $($manifest.Count) source/config files, $(@($manifest | Where-Object production).Count) production files."
}

if ($Mode -in @('Summary', 'All')) {
    $shoppingReport = Read-Json (Join-Path $EvidenceRoot 'shopping.json')
    $diagnosticReport = Read-Json (Join-Path $EvidenceRoot 'diagnostics.json')
    Check-Report $shoppingReport 24 'shopping.json'
    Check-Report $diagnosticReport 14 'diagnostics.json'
    $shoppingRaw = @(Report-Attachments $shoppingReport 'shopping.json' | Where-Object { $_.name -eq 'shopping-operation-timings' })
    $diagnosticRaw = @(Report-Attachments $diagnosticReport 'diagnostics.json' | Where-Object { $_.name -match '^priority-(operation|relay)-diagnostics-' })
    Write-Json 'shopping-samples.json' $shoppingRaw
    Write-Json 'diagnostics-samples.json' $diagnosticRaw
    $historicalShopping = @(Read-Json (Join-Path $HistoricalRoot 'after-performance-samples.json'))
    $historicalDiagnostic = @(Read-Json (Join-Path $HistoricalRoot 'after-diagnostics-samples.json'))
    $historicalShoppingByKey = @{}
    foreach ($entry in $historicalShopping) { $historicalShoppingByKey[(Shopping-Key $entry)] = $entry }
    $historicalDiagnosticByKey = @{}
    foreach ($entry in $historicalDiagnostic) { $historicalDiagnosticByKey[(Diagnostic-Key $entry.data)] = $entry.data }
    $expectedShopping = @{}
    foreach ($count in @(150, 500, 1500)) { foreach ($concentrated in @($false, $true)) { foreach ($mapVisible in @($false, $true)) { foreach ($layout in @('pc', 'smartphone')) { $expectedShopping["$count|$concentrated|$mapVisible|$layout"] = $true } } } }
    $seenShopping = @{}
    $shoppingGroups = @(
        foreach ($entry in $shoppingRaw) {
            $payload = $entry.data
            $key = Shopping-Key $payload
            if (-not $expectedShopping.ContainsKey($key) -or $seenShopping.ContainsKey($key)) { Add-Issue "Unexpected or duplicate shopping profile: $key" }
            $seenShopping[$key] = $true
            if ($entry.status -ne 'passed' -or @($payload.errors).Count) { Add-Issue "Shopping execution error: $key" }
            foreach ($operation in @('execute', 'executeRecord', 'focus', 'record', 'next', 'back')) {
                $fresh = Summarize-Values $payload.timings.$operation $false "$key|$operation"
                Check-AttachedSummary $fresh $payload.summary.$operation "$key|$operation"
                $historical = $historicalShoppingByKey[$key].summary.$operation
                [pscustomobject]@{ items = $payload.count; concentrated = $payload.concentrated; mapVisible = $payload.mapVisible; layout = $payload.layout; operation = $operation; fresh = $fresh; inherited = $historical; contextualMedianDeltaMs = $(if ($fresh -and $historical) { $fresh.medianMs - $historical.medianMs } else { $null }); contextualP95DeltaMs = $(if ($fresh -and $historical) { $fresh.p95Ms - $historical.p95Ms } else { $null }) }
            }
            if (@($payload.timings.PSObject.Properties).Count -ne 6) { Add-Issue "Unexpected shopping operation count: $key" }
        }
    )
    foreach ($key in $expectedShopping.Keys) { if (-not $seenShopping.ContainsKey($key)) { Add-Issue "Missing shopping profile: $key" } }
    $expectedDiagnostic = @{}
    foreach ($count in @(150, 500)) {
        $expectedDiagnostic["dialog|$count"] = $true
        foreach ($kind in @('map', 'preview', 'waiting')) { foreach ($roundTrip in @($false, $true)) { $expectedDiagnostic["relay|$count|$kind|$roundTrip"] = $true } }
    }
    $dialogOperations = @('radial-open', 'radial-to-limited-input', 'limited-quantity-input', 'limited-confirm-open', 'limited-confirm-return', 'limited-cancel', 'same-screen-confirmation-invalidation', 'radial-to-single-choice', 'single-choice-to-limited', 'single-choice-limited-cancel', 'bulk-limited-open', 'bulk-limited-save-next', 'day-switch-popup-invalidation')
    $seenDiagnostic = @{}
    $diagnosticGroups = @(
        foreach ($entry in $diagnosticRaw) {
            $payload = $entry.data
            $key = Diagnostic-Key $payload
            if (-not $expectedDiagnostic.ContainsKey($key) -or $seenDiagnostic.ContainsKey($key)) { Add-Issue "Unexpected or duplicate diagnostic profile: $key" }
            $seenDiagnostic[$key] = $true
            if ($entry.status -ne 'passed' -or @($payload.errors).Count) { Add-Issue "Diagnostic execution error: $key" }
            $operations = if ($key.StartsWith('dialog|')) { $dialogOperations } else { @('start'; 'dayChange'; if ($payload.kind -eq 'waiting') { 'staleReplyDelivery' }; if ($payload.roundTrip) { 'returnDayChange'; 'retainedDomClickDelivery' }) }
            if (@($payload.timings.PSObject.Properties).Count -ne @($operations).Count) { Add-Issue "Unexpected diagnostic operation count: $key" }
            foreach ($operation in $operations) {
                $fresh = Summarize-Values $payload.timings.$operation $true "$key|$operation"
                Check-AttachedSummary $fresh $payload.summary.$operation "$key|$operation"
                $historical = $historicalDiagnosticByKey[$key].summary.$operation
                [pscustomobject]@{ profile = $key; items = $payload.count; operation = $operation; fresh = $fresh; inherited = $historical; contextualMedianDeltaMs = $(if ($fresh -and $historical) { $fresh.medianMs - $historical.medianMs } else { $null }); contextualP95DeltaMs = $(if ($fresh -and $historical) { $fresh.p95Ms - $historical.p95Ms } else { $null }) }
            }
        }
    )
    foreach ($key in $expectedDiagnostic.Keys) { if (-not $seenDiagnostic.ContainsKey($key)) { Add-Issue "Missing diagnostic profile: $key" } }
    if ($shoppingGroups.Count -ne 144) { Add-Issue "Expected 144 shopping groups, found $($shoppingGroups.Count)" }
    if ($diagnosticGroups.Count -ne 66) { Add-Issue "Expected 66 diagnostic groups, found $($diagnosticGroups.Count)" }
    $comparison = [ordered]@{
        recordedAtJst = $RecordedAt
        evidenceType = 'fresh local candidate measurements; inherited results are separate historical context'
        comparisonPolicy = 'The inherited run is not a newly measured baseline. Deltas are contextual and do not establish causal before/after effects. Historical files and historical 50ms decisions remain unchanged.'
        criteria = @{ minimumSamples = 20; medianLimitMs = 55; p95LimitMs = 100 }
        quantiles = @{ shopping = 'nearest-rank median and p95 over all samples, matching the unchanged harness'; diagnostics = 'first sample reported separately; arithmetic midpoint median and nearest-rank p95 over following warm samples' }
        shopping = @{ profiles = $seenShopping.Count; expectedProfiles = 24; groups = $shoppingGroups.Count; expectedGroups = 144; allPass = @($shoppingGroups | Where-Object { -not $_.fresh -or -not $_.fresh.pass }).Count -eq 0 -and $seenShopping.Count -eq 24; minimumSamples = ($shoppingGroups | ForEach-Object { $_.fresh.count } | Measure-Object -Minimum).Minimum; maximumMedianMs = ($shoppingGroups.fresh.medianMs | Measure-Object -Maximum).Maximum; maximumP95Ms = ($shoppingGroups.fresh.p95Ms | Measure-Object -Maximum).Maximum; report = 'shopping.json'; raw = 'shopping-samples.json'; records = $shoppingGroups }
        diagnostics = @{ profiles = $seenDiagnostic.Count; expectedProfiles = 14; groups = $diagnosticGroups.Count; expectedGroups = 66; allPass = @($diagnosticGroups | Where-Object { -not $_.fresh -or -not $_.fresh.pass }).Count -eq 0 -and $seenDiagnostic.Count -eq 14; minimumWarmSamples = ($diagnosticGroups | ForEach-Object { $_.fresh.count } | Measure-Object -Minimum).Minimum; maximumWarmMedianMs = ($diagnosticGroups.fresh.medianMs | Measure-Object -Maximum).Maximum; maximumWarmP95Ms = ($diagnosticGroups.fresh.p95Ms | Measure-Object -Maximum).Maximum; maximumFirstMs = ($diagnosticGroups.fresh.firstMs | Measure-Object -Maximum).Maximum; report = 'diagnostics.json'; raw = 'diagnostics-samples.json'; records = $diagnosticGroups }
        completionPolicy = 'Save completion, actual Worker compute, and request-to-route-ready timings remain in raw attachments and are excluded from UI response gates.'
        renderingPolicy = 'Rendering counters and per-phase diagnostics remain in raw shopping attachments; the summary adds no instrumentation or application work.'
        allPass = $Issues.Count -eq 0; issues = $Issues.ToArray()
        reportHashes = @{ shoppingSha256 = (Sha256-File (Join-Path $EvidenceRoot 'shopping.json')); diagnosticsSha256 = (Sha256-File (Join-Path $EvidenceRoot 'diagnostics.json')); inheritedShoppingSha256 = (Sha256-File (Join-Path $HistoricalRoot 'after-performance-samples.json')); inheritedDiagnosticsSha256 = (Sha256-File (Join-Path $HistoricalRoot 'after-diagnostics-samples.json')) }
    }
    Write-Json 'performance-comparison.json' $comparison
    Write-Host "Fresh measurements: shopping $($shoppingGroups.Count)/144 groups; diagnostics $($diagnosticGroups.Count)/66 groups; allPass=$($comparison.allPass)."
    if ($Issues.Count) { throw ($Issues -join "`n") }
}