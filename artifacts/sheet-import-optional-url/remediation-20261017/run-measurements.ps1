param([ValidateSet('engine','shopping','routes','all')][string]$Group='all')
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference='Stop'
$taskAfter='D:\event-shopping-planner-routeplanning-1.9.6.7-remediation'
$taskBefore='D:\event-shopping-planner-routeplanning-1.9.6.7-remediation-baseline'
$taskEvidence=Join-Path $taskAfter 'artifacts\sheet-import-optional-url\remediation-20261017'
$env:SHEET_URL_FIXED_INPUT_DIR=Join-Path $taskEvidence 'fixed-inputs'
$env:SHEET_URL_REUSE_FIXED_INPUTS='1'
$env:SHEET_URL_REQUIRE_STAGES='1'
$env:SHEET_URL_BROWSER_REPEATS='20'
$taskShoppingFilter='local shopping operations: (150|500) items,.*@shopping-performance'
function Invoke-Recorded([string]$taskRoot,[string]$taskLog,[string[]]$taskArguments) {
  Push-Location -LiteralPath $taskRoot
  try {
    Write-Output "START $taskLog $(Get-Date -Format o)"
    & node @taskArguments 2>&1 | Out-File -LiteralPath (Join-Path $taskEvidence $taskLog) -Encoding utf8
    $taskExit=$LASTEXITCODE
    Get-Content -LiteralPath (Join-Path $taskEvidence $taskLog) -Encoding utf8 -Tail 4
    Write-Output "END $taskLog exit=$taskExit $(Get-Date -Format o)"
    if($taskExit -ne 0){throw "Measurement failed: $taskLog ($taskExit)"}
  } finally {Pop-Location}
}
if($Group -in @('engine','all')) {
  $env:SHEET_URL_MEASURE_PHASE='before'
  Invoke-Recorded $taskBefore 'engine-before.log' @('node_modules/vitest/vitest.mjs','run','--config','vitest.sheet-url-measurement.config.ts','--reporter=verbose')
  $env:SHEET_URL_MEASURE_PHASE='after'
  Invoke-Recorded $taskAfter 'engine-after.log' @('node_modules/vitest/vitest.mjs','run','--config','vitest.sheet-url-measurement.config.ts','--reporter=verbose')
}
if($Group -in @('shopping','all')) {
  foreach($taskPhase in @('before','after')) {
    $env:PLAYWRIGHT_BASE_URL=if($taskPhase -eq 'before'){'http://127.0.0.1:4275'}else{'http://127.0.0.1:4173'}
    Invoke-Recorded $taskAfter "shopping-$taskPhase-list.log" @('node_modules/@playwright/test/cli.js','test','tests/browser/responsive-performance.spec.ts','--grep',$taskShoppingFilter,'--list')
    if(-not ((Get-Content -LiteralPath (Join-Path $taskEvidence "shopping-$taskPhase-list.log") -Raw -Encoding utf8) -match 'Total: 16 tests')){throw 'Expected exactly 16 shopping conditions'}
    Invoke-Recorded $taskAfter "shopping-$taskPhase.log" @('node_modules/@playwright/test/cli.js','test','tests/browser/responsive-performance.spec.ts','--grep',$taskShoppingFilter,'--workers=1','--reporter=line','--output',(Join-Path $taskEvidence "shopping-$taskPhase"))
  }
}
if($Group -in @('routes','all')) {
  foreach($taskPhase in @('before','after')) {
    $env:PLAYWRIGHT_BASE_URL=if($taskPhase -eq 'before'){'http://127.0.0.1:4275'}else{'http://127.0.0.1:4173'}
    $env:SHEET_URL_BROWSER_PHASE=$taskPhase
    Invoke-Recorded $taskAfter "routes-$taskPhase.log" @('node_modules/@playwright/test/cli.js','test','tests/browser/sheet-import-optional-url.measurement.spec.ts','--workers=1','--reporter=line','--output',(Join-Path $taskEvidence "routes-$taskPhase"))
  }
}
