#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..')),
    [string]$BeforeURL = 'http://127.0.0.1:4275',
    [string]$AfterURL = 'http://127.0.0.1:4173',
    [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$RunName = 'diagnostic-1'
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$manifestPath = Join-Path $PSScriptRoot 'diagnostic-manifest.json'
$definition = Get-Content -LiteralPath $manifestPath -Encoding utf8 -Raw | ConvertFrom-Json
$harness = Join-Path $PSScriptRoot 'sheet-import-optional-url.diagnostic.spec.ts'
$config = Join-Path $PSScriptRoot 'playwright.diagnostic.config.ts'
$mainHarness = Join-Path $RepositoryRoot 'tests/browser/sheet-import-optional-url.measurement.spec.ts'
$fixedInputs = Join-Path $PSScriptRoot '../fixed-inputs'
$provenancePath = Join-Path $PSScriptRoot '../build-provenance/manifest.json'
$provenance = Get-Content -LiteralPath $provenancePath -Encoding utf8 -Raw | ConvertFrom-Json
$cases = @('retry: 150 direct', 'startup-B06: 150 direct', 'update: 500 worker')
foreach ($phase in @('after', 'before')) {
    foreach ($suffix in @('', '.log', '-list.log', '-run.json')) {
        $target = Join-Path $PSScriptRoot "$RunName-$phase$suffix"
        if (Test-Path -LiteralPath $target) { throw "Refusing to overwrite existing diagnostic evidence: $target" }
    }
}
$settings = [ordered]@{
    SHEET_URL_LEGACY_STARTUP = '0'
    SHEET_URL_BROWSER_REPEATS = '20'
    SHEET_URL_FIXED_INPUT_DIR = [IO.Path]::GetFullPath($fixedInputs)
    SHEET_URL_REUSE_FIXED_INPUTS = '1'
}
$previous = @{}
foreach ($name in @($settings.Keys) + @('PLAYWRIGHT_BASE_URL', 'SHEET_URL_BROWSER_PHASE')) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
Push-Location -LiteralPath $RepositoryRoot
try {
    foreach ($name in $settings.Keys) { [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process') }
    # Reverse the main measurement order to examine phase/order confounding.
    foreach ($phase in @('after', 'before')) {
        if ((Get-FileHash -LiteralPath $mainHarness -Algorithm SHA256).Hash -ne $definition.mainHarnessSha256) { throw 'Frozen main harness changed' }
        foreach ($file in $definition.frozenFiles) {
            $path = Join-Path $PSScriptRoot $file.path
            if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw "Frozen diagnostic/support file changed: $path" }
        }
        $env:PLAYWRIGHT_BASE_URL = if ($phase -eq 'after') { $AfterURL } else { $BeforeURL }
        $env:SHEET_URL_BROWSER_PHASE = $phase
        $client = [Net.Http.HttpClient]::new()
        try { $identityBytes = $client.GetByteArrayAsync($env:PLAYWRIGHT_BASE_URL + '/release-identity.json').GetAwaiter().GetResult() }
        finally { $client.Dispose() }
        $identitySha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($identityBytes)).ToLowerInvariant()
        $identity = $utf8.GetString($identityBytes) | ConvertFrom-Json
        $expectedBuild = @($provenance.builds | Where-Object { $_.label -eq $phase.ToUpperInvariant() })[0]
        $expectedIdentity = @($expectedBuild.copiedFiles | Where-Object { $_.name -eq 'release-identity.json' })[0]
        if ($identitySha -ne $expectedIdentity.sha256) { throw "Server build identity no longer matches the measured $phase build: $identitySha" }
        $name = "$RunName-$phase"
        $output = Join-Path $PSScriptRoot $name
        $log = Join-Path $PSScriptRoot "$name.log"
        $listLog = Join-Path $PSScriptRoot "$name-list.log"
        $runManifest = Join-Path $PSScriptRoot "$name-run.json"
        $arguments = @((Join-Path $RepositoryRoot 'node_modules/@playwright/test/cli.js'), 'test', '--config', $config, '--project=chromium', '--workers=1', '--retries=0')
        [ordered]@{
            StartedUtc = [DateTime]::UtcNow.ToString('o'); Phase = $phase; PhaseOrder = @('after', 'before'); BaseURL = $env:PLAYWRIGHT_BASE_URL
            DiagnosticOnly = $true; PrimaryEvidenceReplacement = $false; ServerIdentity = $identity; ServerIdentitySHA256 = $identitySha
            MainFrozenHarnessSHA256 = $definition.mainHarnessSha256; DiagnosticHarnessSHA256 = (Get-FileHash -LiteralPath $harness -Algorithm SHA256).Hash
            SelectedCases = $cases; Workers = 1; Repetitions = 20; FixedInputs = $settings.SHEET_URL_FIXED_INPUT_DIR
            BrowserChannel = [Environment]::GetEnvironmentVariable('PERFORMANCE_BROWSER_CHANNEL', 'Process')
            Headed = [Environment]::GetEnvironmentVariable('PERFORMANCE_HEADED', 'Process'); Arguments = $arguments; Output = $output
            Clocks = 'Node monotonic and browser epoch are separate. Each page.evaluate includes enclosing Node send/receive timestamps. No cross-clock subtraction.'
        } | ConvertTo-Json -Depth 15 | Out-File -LiteralPath $runManifest -Encoding utf8 -NoClobber
        & node @arguments --list 2>&1 | Out-File -LiteralPath $listLog -Encoding utf8 -NoClobber
        $listExit = $LASTEXITCODE
        $listing = Get-Content -LiteralPath $listLog -Encoding utf8 -Raw
        if ($listExit -ne 0 -or $listing -notmatch 'Total:\s+3 tests\b') { throw "Expected exactly three diagnostic cases: $listLog" }
        foreach ($case in $cases) { if ($listing -notmatch [regex]::Escape($case + ' @sheet-url-diagnostic')) { throw "Missing case: $case" } }
        & node @arguments --reporter=line --output $output 2>&1 | Out-File -LiteralPath $log -Encoding utf8 -NoClobber
        $code = $LASTEXITCODE
        @('', "EXIT_CODE: $code", ('ENDED_UTC: ' + [DateTime]::UtcNow.ToString('o'))) | Out-File -LiteralPath $log -Encoding utf8 -Append
        if ($code -ne 0) { throw "Diagnostic run failed ($phase/$code): $log" }
        $files = @(Get-ChildItem -LiteralPath $output -File -Recurse -Filter 'sheet-url-diagnostic-timings.json')
        if ($files.Count -ne 3) { throw "Expected three diagnostic raw files: $output" }
        foreach ($file in $files) {
            $samples = @(Get-Content -LiteralPath $file.FullName -Encoding utf8 -Raw | ConvertFrom-Json -AsHashtable -Depth 100)
            if ($samples.Count -ne 20) { throw "Expected exactly 20 diagnostic samples: $($file.FullName)" }
            foreach ($sample in $samples) {
                $case = "$($sample.route): $($sample.count) $($sample.mode)"
                if ($case -notin $cases -or $sample.phase -ne $phase -or $sample.diagnosticOnly -ne $true -or $sample.primaryEvidenceReplacement -ne $false) { throw "Unexpected diagnostic sample: $($file.FullName)" }
            }
        }
        Write-Output "Completed diagnostic ${phase}: three cases x 20 samples; output=$output"
    }
} finally {
    Pop-Location
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
