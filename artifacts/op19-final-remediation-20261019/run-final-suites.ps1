[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference='Stop'
$records=@()
function Invoke-Suite([string]$name,[string]$url,[string[]]$suiteArgs){
  $env:PLAYWRIGHT_BASE_URL=$url
  $env:PLAYWRIGHT_JSON_OUTPUT_FILE="D:\espfix-evidence-261019\$name.json"
  $began=[DateTime]::UtcNow
  Write-Output "BEGIN $name $($began.ToString('o'))"
  & npx playwright test @suiteArgs '--reporter=line,json' --output "D:/espfix-evidence-261019/$name-results"
  $code=$LASTEXITCODE
  $script:records += [pscustomobject]@{name=$name;beganUtc=$began.ToString('o');endedUtc=[DateTime]::UtcNow.ToString('o');exitCode=$code;url=$url;arguments=$suiteArgs}
  [IO.File]::WriteAllText('D:\espfix-evidence-261019\suite-runs.json',($script:records|ConvertTo-Json -Depth 6).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
  if($code-ne0){throw "Suite failed: $name ($code)"}
  Write-Output "END $name exit=$code"
}
Invoke-Suite 'browser-clean' 'http://127.0.0.1:4182' @('tests/browser/cross-feature-consistency.spec.ts','tests/browser/priority-dialog-interaction.spec.ts','tests/browser/priority-cell-popup-edit.spec.ts','tests/browser/sheet-import-optional-url.spec.ts','tests/browser/retained-viewport.spec.ts','tests/browser/shopping-item-rendering.spec.ts','tests/browser/a11y-flows.spec.ts','tests/browser/shopping-cross-column-drag.spec.ts','tests/browser/persistence-terminal-stop.spec.ts','tests/browser/ordinary-persistence-io.spec.ts','tests/browser/modal-late-save-failure.spec.ts','--grep-invert','@shopping-performance','--workers=2')
# Performance suites are sequential, after all functional/quality processes finish.
Invoke-Suite 'drag-baseline' 'http://127.0.0.1:4180' @('tests/browser/shopping-cross-column-drag.spec.ts','--grep','@shopping-drag-performance','--workers=1')
Invoke-Suite 'shopping-performance' 'http://127.0.0.1:4182' @('tests/browser/responsive-performance.spec.ts','--grep','@shopping-performance','--workers=1')
Invoke-Suite 'drag-performance' 'http://127.0.0.1:4182' @('tests/browser/shopping-cross-column-drag.spec.ts','--grep','@shopping-drag-performance','--workers=1')
