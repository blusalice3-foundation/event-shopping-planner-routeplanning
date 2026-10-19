[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location -LiteralPath $repository
$results = @()
foreach ($measurement in @(
  @{ Name = 'shopping'; Spec = 'tests/browser/responsive-performance.spec.ts'; Grep = '@shopping-performance' },
  @{ Name = 'drag'; Spec = 'tests/browser/shopping-cross-column-drag.spec.ts'; Grep = '@shopping-drag-performance' }
)) {
  $name = $measurement.Name
  $jsonPath = Join-Path $PSScriptRoot "$name-performance.json"
  $logPath = Join-Path $PSScriptRoot "$name-performance.log"
  if ((Test-Path -LiteralPath $jsonPath) -or (Test-Path -LiteralPath $logPath)) { throw 'Measurement outputs must be new' }
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = $jsonPath
  $started = [DateTimeOffset]::UtcNow
  & node node_modules/@playwright/test/cli.js test $measurement.Spec --grep $measurement.Grep --workers=1 --retries=0 --reporter=line,json --output="artifacts/op04-focus-remediation-20261019/$name-performance-output" 2>&1 | ForEach-Object {
    $_.ToString() | Add-Content -LiteralPath $logPath -Encoding utf8
  }
  $code = $LASTEXITCODE
  $results += [ordered]@{ Name = $name; StartUtc = $started.ToString('o'); EndUtc = [DateTimeOffset]::UtcNow.ToString('o'); ExitCode = $code; Workers = 1; Retries = 0; ConcurrentHeavyTests = $false }
  $results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'performance-execution.json') -Encoding utf8
  Write-Output "$name exit=$code"
  Get-Content -LiteralPath $logPath -Encoding utf8 | Select-Object -Last 10
}
if (@($results | Where-Object { $_.ExitCode -ne 0 }).Count -gt 0) { exit 1 }
