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
$env:SHEET_URL_OBSERVE_ROUTE_COMMITS='1'
$taskFilter='(retry 150 direct following=(false|true)|startup 150 worker B06|update 500 direct mixed switch=true|update 500 worker normal switch=false|update 500 direct normal switch=true)$'
foreach($taskRound in @(1,2)) {
 foreach($taskPhase in @('before','after')) {
  $taskRoot=if($taskPhase -eq 'before'){$taskBefore}else{$taskAfter}
  $env:SHEET_URL_MEASURE_PHASE=$taskPhase
  $taskLog=Join-Path $taskEvidence "engine-recheck-$taskPhase-$taskRound.log"
  Push-Location -LiteralPath $taskRoot
  try {
   Write-Output "START $taskLog $(Get-Date -Format o)"
   node node_modules/vitest/vitest.mjs run --config vitest.sheet-url-measurement.config.ts --reporter=verbose -t $taskFilter 2>&1 | Out-File -LiteralPath $taskLog -Encoding utf8
   $taskExit=$LASTEXITCODE
   Get-Content -LiteralPath $taskLog -Encoding utf8 -Tail 4
   Write-Output "END exit=$taskExit $(Get-Date -Format o)"
   if($taskExit -ne 0){throw "Recheck failed: $taskLog"}
  } finally {Pop-Location}
 }
}
