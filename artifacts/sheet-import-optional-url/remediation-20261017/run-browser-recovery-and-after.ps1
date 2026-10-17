[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference='Stop'
$taskEvidence=Join-Path (Get-Location) 'artifacts/sheet-import-optional-url/remediation-20261017'
$env:SHEET_URL_FIXED_INPUT_DIR=Join-Path $taskEvidence 'fixed-inputs'
$env:SHEET_URL_REUSE_FIXED_INPUTS='1'
$env:SHEET_URL_BROWSER_REPEATS='20'
$env:SHEET_URL_LEGACY_STARTUP=''
$env:SHEET_URL_BROWSER_PHASE='before'
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:4275'
$taskRecovery=Join-Path $taskEvidence 'routes-before-B03-recovery'
$taskLog=Join-Path $taskEvidence 'routes-before-B03-recovery.log'
if((Test-Path -LiteralPath $taskRecovery) -or (Test-Path -LiteralPath $taskLog)){throw 'Recovery output already exists'}
Write-Output "START recovery $(Get-Date -Format o)"
& node node_modules/@playwright/test/cli.js test tests/browser/sheet-import-optional-url.measurement.spec.ts --grep 'startup-B03: 500 direct' --workers=1 --retries=0 --reporter=line --output $taskRecovery 2>&1 | Out-File -LiteralPath $taskLog -Encoding utf8 -NoClobber
$taskExit=$LASTEXITCODE
Get-Content -LiteralPath $taskLog -Encoding utf8 -Tail 4
if($taskExit -ne 0){throw 'Recovery failed'}
$taskRaw=@(Get-ChildItem -LiteralPath $taskRecovery -Filter 'sheet-url-route-timings.json' -File -Recurse)
if($taskRaw.Count -ne 1){throw 'Expected one complete recovery raw file'}
$taskSamples=Get-Content -LiteralPath $taskRaw[0].FullName -Encoding utf8 -Raw | ConvertFrom-Json
if(@($taskSamples).Count -ne 20){throw 'Expected 20 recovery samples'}
$taskMerged=Join-Path $taskEvidence 'routes-before/completed-B03-recovery'
if(Test-Path -LiteralPath $taskMerged){throw 'Merged recovery already exists'}
New-Item -ItemType Directory -Path $taskMerged | Out-Null
$taskDestination=Join-Path $taskMerged 'sheet-url-route-timings.json'
Copy-Item -LiteralPath $taskRaw[0].FullName -Destination $taskDestination
$taskHash=(Get-FileHash -LiteralPath $taskRaw[0].FullName -Algorithm SHA256).Hash
if((Get-FileHash -LiteralPath $taskDestination -Algorithm SHA256).Hash -ne $taskHash){throw 'Recovery copy mismatch'}
[ordered]@{Reason='Original run: 47 complete cases; one startup-B03:500:direct case failed in enter() before timed fixture with initial 5000ms ready timeout. Original failure and artifacts retained. Entire affected case retaken with same frozen harness, unchanged waits, 20 samples.';OriginalLog='routes-before.log';RecoveryLog='routes-before-B03-recovery.log';Source=$taskRaw[0].FullName;CopiedForFull48GroupAggregation=$taskDestination;SHA256=$taskHash;Samples=20;RecoveredAt=(Get-Date -Format o)} | ConvertTo-Json -Depth 5 | Out-File -LiteralPath (Join-Path $taskEvidence 'routes-before-recovery-provenance.json') -Encoding utf8 -NoClobber
$env:SHEET_URL_BROWSER_PHASE='after'
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:4173'
$taskAfterOutput=Join-Path $taskEvidence 'routes-after'
$taskAfterLog=Join-Path $taskEvidence 'routes-after.log'
if((Test-Path -LiteralPath $taskAfterOutput) -or (Test-Path -LiteralPath $taskAfterLog)){throw 'After output already exists'}
Write-Output "START after $(Get-Date -Format o)"
& node node_modules/@playwright/test/cli.js test tests/browser/sheet-import-optional-url.measurement.spec.ts --workers=1 --retries=0 --reporter=line --output $taskAfterOutput 2>&1 | Out-File -LiteralPath $taskAfterLog -Encoding utf8 -NoClobber
$taskExit=$LASTEXITCODE
Get-Content -LiteralPath $taskAfterLog -Encoding utf8 -Tail 4
Write-Output "END after exit=$taskExit $(Get-Date -Format o)"
if($taskExit -ne 0){throw 'After routes failed'}