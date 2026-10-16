[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference='Stop'
$artifactPath = $PSScriptRoot
$report = Get-Content -LiteralPath (Join-Path $artifactPath 'shopping-performance.json') -Encoding utf8 -Raw | ConvertFrom-Json
function Read-PerformanceCases($suite) {
  foreach ($spec in $suite.specs) {
    foreach ($test in $spec.tests) {
      foreach ($result in $test.results) {
        foreach ($attachment in $result.attachments) {
          if ($attachment.name -ne 'shopping-operation-timings') { continue }
          $json = if ($attachment.body) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($attachment.body)) } else { Get-Content -LiteralPath $attachment.path -Encoding utf8 -Raw }
          [pscustomobject]@{title=$spec.title; status=$result.status; timings=($json | ConvertFrom-Json)}
        }
      }
    }
  }
  foreach ($child in $suite.suites) { Read-PerformanceCases $child }
}
$after=@(foreach ($suite in $report.suites) { Read-PerformanceCases $suite })
if ($after.Count -ne 24 -or @($after | Where-Object status -ne 'passed').Count -ne 0 -or $report.stats.unexpected -ne 0 -or $report.stats.flaky -ne 0) { throw 'Performance evidence is not an accepted 24-condition run' }
$after | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath (Join-Path $artifactPath 'performance-samples.json') -Encoding utf8
$root = Split-Path -Parent (Split-Path -Parent $artifactPath)
$beforePath=Join-Path $root 'artifacts/shopping-operation-completion-n1-url-20261016/performance-samples.json'
$before=Get-Content -LiteralPath $beforePath -Encoding utf8 -Raw | ConvertFrom-Json
$comparisons=@(foreach ($entry in $after) {
  $prior=@($before | Where-Object title -eq $entry.title)
  if ($prior.Count -ne 1) { throw "Missing baseline condition: $($entry.title)" }
  $previous=$prior[0]
  $operations=@(foreach ($operation in @('execute','executeRecord','focus','record','next','back')) {
    [pscustomobject]@{operation=$operation;before=$previous.timings.summary.$operation;after=$entry.timings.summary.$operation}
  })
  $saveComparisons=@(foreach($diagnostic in @('diagnostic','executionDiagnostic','executionRecordDiagnostic')) {
    $stats=@{}
    foreach($pair in @(@{name='before';entry=$previous},@{name='after';entry=$entry})) {
      $values=@($pair.entry.timings.$diagnostic.samples | Where-Object phase -eq 'save' | ForEach-Object durationMs | Sort-Object)
      $stats[$pair.name]=@{count=$values.Count;medianMs=if($values.Count){$values[[Math]::Ceiling($values.Count*.5)-1]}else{$null};p95Ms=if($values.Count){$values[[Math]::Ceiling($values.Count*.95)-1]}else{$null}}
    }
    [pscustomobject]@{diagnostic=$diagnostic;before=$stats.before;after=$stats.after}
  })
  [pscustomobject]@{title=$entry.title;count=$entry.timings.count;concentrated=$entry.timings.concentrated;mapVisible=$entry.timings.mapVisible;layout=$entry.timings.layout;operations=$operations;saveDiagnostics=$saveComparisons}
})
$maxima=@(foreach ($operation in @('execute','executeRecord','focus','record','next','back')) {
  $large=@($after | Where-Object {$_.timings.count -eq 1500} | ForEach-Object {$_.timings.summary.$operation})
  if ($large.Count -ne 8 -or ($large | ForEach-Object count | Measure-Object -Minimum).Minimum -lt 20) { throw 'Missing large-case samples' }
  $median=($large.medianMs | Measure-Object -Maximum).Maximum
  $p95=($large.p95Ms | Measure-Object -Maximum).Maximum
  if ($median -gt 50 -or $p95 -gt 100) { throw 'Large-case budget exceeded' }
  [pscustomobject]@{operation=$operation;conditions=$large.Count;minimumSamples=($large | ForEach-Object count | Measure-Object -Minimum).Minimum;maximumMedianMs=$median;maximumP95Ms=$p95}
})
$unit=Get-Content -LiteralPath (Join-Path $artifactPath 'unit-integration-worker.json') -Encoding utf8 -Raw | ConvertFrom-Json
$browser=Get-Content -LiteralPath (Join-Path $artifactPath 'browser-all.json') -Encoding utf8 -Raw | ConvertFrom-Json
$regression=Get-Content -LiteralPath (Join-Path $artifactPath 'regression-before.json') -Encoding utf8 -Raw | ConvertFrom-Json
$identity=Get-Content -LiteralPath (Join-Path $artifactPath 'build-identity.json') -Encoding utf8 -Raw | ConvertFrom-Json
$summary=[ordered]@{
  date='2026-10-16'
  baseHead='255a8a7'
  verifiedSourceSnapshot=$identity.sourceSha
  sourceMatchesWorkspace=$true
  unitIntegrationWorker=@{files=$unit.testResults.Count;tests=$unit.numPassedTests;failed=$unit.numFailedTests}
  originalSourceRegressions=@{tests=$regression.numTotalTests;failed=$regression.numFailedTests}
  api=@{tests=21;failed=0}
  checks=@{releaseBuild='passed';typecheck='passed';dbCompatibility='passed';architecture='passed';testProjectMembership='passed';encoding='passed';lint='passed in clean verification snapshot'}
  browser=$browser.stats
  performance=$report.stats
  baseline=@{path='artifacts/shopping-operation-completion-n1-url-20261016';sourceSnapshot='5c8cc2992e1ce6d11b41ef380b9e71d1a01c280a';matchesPreFixProductionSource=$true;remeasured=$false}
  conditionCount=$after.Count
  largeItemMaxima=$maxima
  comparisons=$comparisons
  proposalUnchangedSha256='68951e4d28ffda3477c0264a3e3536d0c918fad231ee98015340ad4f879841c3'
  userAgentsPreservedSha256='4ab22608cee4ea11e9dab9c4493f9f304b2569457a31195829bd9ce8f688b959'
  limitations=@('Phone width uses desktop Chromium emulation, not a physical phone.','Save diagnostic sample counts are not physical database commit counts.','Existing incorrect historical values cannot be reconstructed from current data alone.')
}
$pairedPath=Join-Path $artifactPath 'paired-performance-comparison.json'
if(Test-Path -LiteralPath $pairedPath){
  $pairedBefore=Get-Content -LiteralPath (Join-Path $artifactPath 'paired-performance-before.json') -Encoding utf8 -Raw | ConvertFrom-Json
  $pairedAfter=Get-Content -LiteralPath (Join-Path $artifactPath 'paired-performance-after.json') -Encoding utf8 -Raw | ConvertFrom-Json
  $paired=Get-Content -LiteralPath $pairedPath -Encoding utf8 -Raw | ConvertFrom-Json
  $summary['pairedPerformance']=[pscustomobject]@{before=$pairedBefore.stats;after=$pairedAfter.stats;comparisons=@($paired | Select-Object title,operations)}
}
$summary | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath (Join-Path $artifactPath 'summary.json') -Encoding utf8
$maxima | Format-Table
