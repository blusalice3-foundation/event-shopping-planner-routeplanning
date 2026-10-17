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
$baseName = 'routes-legacy-corrected-B04'
$output = Join-Path $EvidenceRoot $baseName
$log = Join-Path $EvidenceRoot "$baseName.log"
$listLog = Join-Path $EvidenceRoot "$baseName-list.log"
$runManifest = Join-Path $EvidenceRoot "$baseName-run.json"
foreach ($path in @($output, $log, $listLog, $runManifest)) {
    if (Test-Path -LiteralPath $path) { throw "Existing evidence must not be overwritten: $path" }
}
$harness = Join-Path $RepositoryRoot 'tests/browser/sheet-import-optional-url.measurement.spec.ts'
$frozen = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'browser-full-harness-manifest.json') -Encoding utf8 -Raw | ConvertFrom-Json
$harnessHash = (Get-FileHash -LiteralPath $harness -Algorithm SHA256).Hash
if ($harnessHash -ne $frozen.Hash) { throw 'Browser harness differs from frozen main-route measurement harness' }
$fixedInputs = Join-Path $EvidenceRoot 'fixed-inputs'
if (-not (Test-Path -LiteralPath $fixedInputs -PathType Container)) { throw "Missing fixed input directory: $fixedInputs" }
$legacyCommit = (& git -C $RepositoryRoot rev-parse --verify 'cc475cd^{commit}').Trim()
if ($LASTEXITCODE -ne 0 -or $legacyCommit -ne 'cc475cd1837404440e893694147fee17c46a04d2') { throw 'Could not resolve the expected legacy baseline commit' }
$settings = [ordered]@{
    PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:4276'
    SHEET_URL_LEGACY_STARTUP = '1'
    SHEET_URL_BROWSER_REPEATS = '20'
    SHEET_URL_BROWSER_PHASE = 'before'
    SHEET_URL_FIXED_INPUT_DIR = $fixedInputs
    SHEET_URL_REUSE_FIXED_INPUTS = '1'
}
$previous = @{}
foreach ($name in $settings.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
}
$cli = Join-Path $RepositoryRoot 'node_modules/@playwright/test/cli.js'
$arguments = @($cli, 'test', 'tests/browser/sheet-import-optional-url.measurement.spec.ts', '--project=chromium', '--grep', 'startup-B04:', '--workers=1', '--retries=0')
Push-Location -LiteralPath $RepositoryRoot
try {
    # This checks availability and records serving identity. The harness sourceBaseline
    # label is not independent proof of the commit served by an external HTTP process.
    $identity = Invoke-RestMethod -Uri ($settings.PLAYWRIGHT_BASE_URL + '/release-identity.json') -TimeoutSec 15
    [ordered]@{
        StartedUtc = [DateTime]::UtcNow.ToString('o')
        ExpectedLegacyCommit = $legacyCommit
        HarnessPath = $harness
        HarnessSHA256 = $harnessHash
        FrozenManifest = 'browser-full-harness-manifest.json'
        Settings = $settings
        Arguments = $arguments
        OutputDirectory = $output
        ServerIdentity = $identity
        ServerCommitVerifiedFromHttpResponse = $false
        FixedInputs = @(Get-ChildItem -LiteralPath $fixedInputs -File | ForEach-Object { [ordered]@{ Name = $_.Name; SHA256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } })
    } | ConvertTo-Json -Depth 20 | Out-File -LiteralPath $runManifest -Encoding utf8 -NoClobber
    & node @arguments --list 2>&1 | Out-File -LiteralPath $listLog -Encoding utf8 -NoClobber
    $listExit = $LASTEXITCODE
    $listing = Get-Content -LiteralPath $listLog -Encoding utf8 -Raw
    if ($listExit -ne 0 -or $listing -notmatch 'Total:\s+4 tests\b') { throw "Expected exactly four legacy B04 cases; inspect $listLog" }
    & node @arguments --reporter=line --output $output 2>&1 | Out-File -LiteralPath $log -Encoding utf8 -NoClobber
    $exitCode = $LASTEXITCODE
    @('', "EXIT_CODE: $exitCode", ('ENDED_UTC: ' + [DateTime]::UtcNow.ToString('o'))) | Out-File -LiteralPath $log -Encoding utf8 -Append
    if ($exitCode -ne 0) { throw "Legacy B04 measurement failed ($exitCode): $log" }
    $files = @(Get-ChildItem -LiteralPath $output -Filter 'sheet-url-route-timings.json' -Recurse -File)
    if ($files.Count -ne 4) { throw "Expected four raw evidence files; found $($files.Count)" }
    foreach ($file in $files) {
        $samples = @(Get-Content -LiteralPath $file.FullName -Encoding utf8 -Raw | ConvertFrom-Json -AsHashtable -Depth 100)
        if ($samples.Count -ne 20) { throw "Expected 20 raw samples: $($file.FullName)" }
        foreach ($sample in $samples) {
            if ($sample.route -ne 'startup-B04' -or $sample.phase -ne 'before' -or $sample.legacyStartup -ne $true -or $sample.sourceBaseline -ne 'cc475cd' -or $sample.evidenceEligible -ne $true) { throw "Unexpected legacy evidence schema: $($file.FullName)" }
        }
    }
    Write-Output "Completed legacy B04: four cases x 20 samples; raw=$output; log=$log"
} finally {
    Pop-Location
    foreach ($name in $settings.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
