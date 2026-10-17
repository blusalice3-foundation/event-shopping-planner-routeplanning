#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..')),
    [string]$EvidenceRoot = $PSScriptRoot
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
$frozenPath = Join-Path $EvidenceRoot 'browser-full-harness-manifest.json'
$frozen = Get-Content -LiteralPath $frozenPath -Encoding utf8 -Raw | ConvertFrom-Json
$harness = Join-Path $RepositoryRoot 'tests/browser/sheet-import-optional-url.measurement.spec.ts'
$fixedInputs = Join-Path $EvidenceRoot 'fixed-inputs'
if (-not (Test-Path -LiteralPath $fixedInputs -PathType Container)) { throw 'Missing reused fixed input directory' }
$cases = @('retry: 150 direct', 'startup-B05: 150 direct', 'startup-B06: 150 direct', 'switch: 500 direct', 'import: 500 worker', 'update: 500 worker', 'update: 500 direct')
$filter = '\b(?:' + (($cases | ForEach-Object { [regex]::Escape($_) }) -join '|') + ') @sheet-url-routes\b'
foreach ($phase in @('before', 'after')) {
    foreach ($suffix in @('', '.log', '-list.log', '-run.json')) {
        $path = Join-Path $EvidenceRoot "routes-recheck-$phase-1$suffix"
        if (Test-Path -LiteralPath $path) { throw "Existing recheck evidence must not be overwritten: $path" }
    }
}
$settings = [ordered]@{
    SHEET_URL_LEGACY_STARTUP = '0'
    SHEET_URL_BROWSER_REPEATS = '20'
    SHEET_URL_FIXED_INPUT_DIR = $fixedInputs
    SHEET_URL_REUSE_FIXED_INPUTS = '1'
}
$previous = @{}
foreach ($name in @($settings.Keys) + @('PLAYWRIGHT_BASE_URL', 'SHEET_URL_BROWSER_PHASE')) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location -LiteralPath $RepositoryRoot
try {
    foreach ($name in $settings.Keys) { [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process') }
    foreach ($phase in @('before', 'after')) {
        $hash = (Get-FileHash -LiteralPath $harness -Algorithm SHA256).Hash
        if ($hash -ne $frozen.Hash) { throw 'Browser harness differs from frozen main-route harness' }
        $env:PLAYWRIGHT_BASE_URL = if ($phase -eq 'before') { 'http://127.0.0.1:4275' } else { 'http://127.0.0.1:4173' }
        $env:SHEET_URL_BROWSER_PHASE = $phase
        $name = "routes-recheck-$phase-1"
        $output = Join-Path $EvidenceRoot $name
        $log = Join-Path $EvidenceRoot "$name.log"
        $listLog = Join-Path $EvidenceRoot "$name-list.log"
        $manifest = Join-Path $EvidenceRoot "$name-run.json"
        $arguments = @((Join-Path $RepositoryRoot 'node_modules/@playwright/test/cli.js'), 'test', 'tests/browser/sheet-import-optional-url.measurement.spec.ts', '--project=chromium', '--grep', $filter, '--workers=1', '--retries=0')
        $identity = Invoke-RestMethod -Uri ($env:PLAYWRIGHT_BASE_URL + '/release-identity.json') -TimeoutSec 15
        [ordered]@{ StartedUtc = [DateTime]::UtcNow.ToString('o'); Phase = $phase; BaseURL = $env:PLAYWRIGHT_BASE_URL; ServerIdentity = $identity; FrozenHarnessSHA256 = $hash; Harness = $harness; SelectedCases = $cases; Grep = $filter; Workers = 1; Repetitions = 20; LegacyStartup = $false; FixedInputs = $fixedInputs; FixedInputFiles = @(Get-ChildItem -LiteralPath $fixedInputs -File | ForEach-Object { [ordered]@{ Name = $_.Name; SHA256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } }); Arguments = $arguments; Output = $output } | ConvertTo-Json -Depth 20 | Out-File -LiteralPath $manifest -Encoding utf8 -NoClobber
        & node @arguments --list 2>&1 | Out-File -LiteralPath $listLog -Encoding utf8 -NoClobber
        $listExit = $LASTEXITCODE
        $listing = Get-Content -LiteralPath $listLog -Encoding utf8 -Raw
        if ($listExit -ne 0 -or $listing -notmatch 'Total:\s+7 tests\b') { throw "Expected exactly seven selected cases: $listLog" }
        foreach ($case in $cases) { if ($listing -notmatch [regex]::Escape($case + ' @sheet-url-routes')) { throw "Missing selected case: $case" } }
        & node @arguments --reporter=line --output $output 2>&1 | Out-File -LiteralPath $log -Encoding utf8 -NoClobber
        $code = $LASTEXITCODE
        @('', "EXIT_CODE: $code", ('ENDED_UTC: ' + [DateTime]::UtcNow.ToString('o'))) | Out-File -LiteralPath $log -Encoding utf8 -Append
        if ($code -ne 0) { throw "Browser recheck failed ($phase/$code): $log" }
        $files = @(Get-ChildItem -LiteralPath $output -Filter 'sheet-url-route-timings.json' -Recurse -File)
        if ($files.Count -ne 7) { throw "Expected seven raw files: $output" }
        foreach ($file in $files) {
            $samples = @(Get-Content -LiteralPath $file.FullName -Encoding utf8 -Raw | ConvertFrom-Json -AsHashtable -Depth 100)
            if ($samples.Count -ne 20) { throw "Expected 20 samples: $($file.FullName)" }
            foreach ($sample in $samples) {
                $case = "$($sample.route): $($sample.count) $($sample.mode)"
                if ($case -notin $cases -or $sample.phase -ne $phase -or $sample.evidenceEligible -ne $true -or ($sample.ContainsKey('legacyStartup') -and $sample.legacyStartup)) { throw "Unexpected raw recheck sample: $($file.FullName)" }
            }
        }
        Write-Output "Completed ${phase}: seven cases x 20 samples; output=$output"
    }
} finally {
    Pop-Location
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
