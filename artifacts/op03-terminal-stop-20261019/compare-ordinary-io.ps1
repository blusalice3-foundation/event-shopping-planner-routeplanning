param(
  [Parameter(Mandatory = $true)][string]$ReportPath,
  [string]$OutputPath = 'D:\esp-op03-evidence\ordinary-io-summary.json',
  [string]$BaselinePath = 'D:\esp-op03-final\artifacts\user-operation-remediation-20261019\ordinary-io-baseline.json'
)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'

function Read-Utf8Json([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path))
  $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
  if ($text.Contains([char]0xfffd)) { throw "U+FFFD in JSON: $Path" }
  return ConvertFrom-Json -InputObject $text.TrimStart([char]0xfeff) -Depth 100
}
function Find-OrdinaryAttachments([object[]]$Suites) {
  foreach ($suite in $Suites) {
    foreach ($spec in $suite.specs) {
      foreach ($test in $spec.tests) {
        foreach ($result in $test.results) {
          if ($result.status -ne 'passed') { continue }
          foreach ($attachment in $result.attachments) {
            if ($attachment.name -eq 'ordinary-persistence-io') {
              [pscustomobject]@{ Attachment = $attachment; File = $spec.file; Title = $spec.title; TestStatus = $test.status; Retry = $result.retry }
            }
          }
        }
      }
    }
    if ($suite.suites) { Find-OrdinaryAttachments $suite.suites }
  }
}
function Rpc-Key($Row) {
  return (@($Row.workerRoundTripsByMethod.PSObject.Properties | Sort-Object Name | ForEach-Object { $_.Name + '=' + $_.Value }) -join '|')
}
function Store-Key($Row) {
  return (@($Row.transactionStores | ForEach-Object { (@($_) | Sort-Object) -join ',' } | Sort-Object) -join '|')
}
function Mutation-Counts($Row) {
  $counts = [ordered]@{}
  $Row.mutations | Group-Object { $_.store + '.' + $_.method } | Sort-Object Name | ForEach-Object { $counts[$_.Name] = $_.Count }
  return $counts
}

$report = Read-Utf8Json $ReportPath
$baseline = Read-Utf8Json $BaselinePath
$found = @(Find-OrdinaryAttachments $report.suites)
if ($found.Count -ne 1) { throw "Expected exactly one passed ordinary I/O attachment; found $($found.Count)." }
$entry = $found[0]
if ($entry.Attachment.body) {
  $bytes = [Convert]::FromBase64String($entry.Attachment.body)
  $currentText = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
  $current = ConvertFrom-Json -InputObject $currentText -Depth 100
} elseif ($entry.Attachment.path) {
  $attachmentPath = $entry.Attachment.path
  if (-not [IO.Path]::IsPathRooted($attachmentPath)) { $attachmentPath = Join-Path (Split-Path -Parent $ReportPath) $attachmentPath }
  $current = Read-Utf8Json $attachmentPath
} else { throw 'Ordinary I/O attachment has neither a body nor a path.' }

$expectedMutations = '{"eventLists.delete":2,"eventLists.put":2,"syncQueue.delete":1,"syncQueue.put":4}'
$operations = foreach ($operation in @('purchase', 'planned-quantity', 'memo')) {
  $now = @($current.observations | Where-Object operation -eq $operation)
  $before = @($baseline.observations | Where-Object operation -eq $operation)
  if ($now.Count -ne 1 -or $before.Count -ne 1) { throw "Expected one sample per report for $operation." }
  $now = $now[0]
  $before = $before[0]
  $counts = Mutation-Counts $now
  $countsJson = ConvertTo-Json -InputObject $counts -Compress
  $same = [ordered]@{
    workerRoundTripsByMethod = ((Rpc-Key $now) -eq (Rpc-Key $before))
    physicalCommittedTransactions = ($now.physicalCommittedTransactions -eq $before.physicalCommittedTransactions)
    committedObjectStoreMutationRequests = ($now.committedObjectStoreMutationRequests -eq $before.committedObjectStoreMutationRequests)
    transactionStores = ((Store-Key $now) -eq (Store-Key $before))
    mutations = ($countsJson -eq (ConvertTo-Json -InputObject (Mutation-Counts $before) -Compress))
  }
  $exactExpectedIo = (Rpc-Key $now) -eq 'items=1' -and $now.physicalCommittedTransactions -eq 1 -and $now.committedObjectStoreMutationRequests -eq 9 -and @($now.transactionStores).Count -eq 1 -and @($now.transactionStores[0]).Count -eq 12 -and $countsJson -eq $expectedMutations
  [pscustomobject][ordered]@{
    operation = $operation
    sampleCount = 1
    unchangedPhysicalBoundary = -not (@($same.Values) -contains $false)
    expectedOneRpcOneRwNineMutationsTwelveStores = $exactExpectedIo
    fieldsEqualToHistoricalBaseline = $same
    workerRoundTripsByMethod = $now.workerRoundTripsByMethod
    physicalCommittedTransactions = $now.physicalCommittedTransactions
    committedObjectStoreMutationRequests = $now.committedObjectStoreMutationRequests
    transactionStoreCount = @($now.transactionStores[0]).Count
    transactionStores = $now.transactionStores
    mutationBreakdown = $counts
    historicalResponseMs = $before.responseMs
    currentResponseMs = $now.responseMs
    historicalSaveRpcReplyMs = $before.saveCompletionMs
    currentSaveRpcReplyMs = $now.saveCompletionMs
    passed = $exactExpectedIo -and -not (@($same.Values) -contains $false)
  }
}
$sampleSetValid = @($current.observations).Count -eq 3 -and @($baseline.observations).Count -eq 3
$passed = $sampleSetValid -and $entry.TestStatus -eq 'expected' -and -not (@($operations.passed) -contains $false)
$summary = [ordered]@{
  kind = 'ordinary-persistence-io-comparison'
  report = [ordered]@{ path = (Resolve-Path -LiteralPath $ReportPath).Path; sha256 = (Get-FileHash -LiteralPath $ReportPath -Algorithm SHA256).Hash.ToLowerInvariant(); startTime = $report.stats.startTime; suiteStats = $report.stats }
  historicalBaseline = [ordered]@{ path = (Resolve-Path -LiteralPath $BaselinePath).Path; sha256 = (Get-FileHash -LiteralPath $BaselinePath -Algorithm SHA256).Hash.ToLowerInvariant(); label = $baseline.label }
  currentLabel = $current.label
  fixture = $current.fixture
  browserTest = [ordered]@{ file = $entry.File; title = $entry.Title; status = $entry.TestStatus; retry = $entry.Retry; unaffectedItemsAssertionPassed = $entry.TestStatus -eq 'expected' }
  notes = 'Historical baseline is preserved and separately identified. One sample per operation verifies physical I/O only; response and save completion are separate observations, not performance acceptance. The existing passed browser test asserts unrelated items unchanged.'
  operations = @($operations)
  passed = $passed
}
$json = (ConvertTo-Json -InputObject $summary -Depth 100).Replace("`r`n", "`n") + "`n"
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json, [Text.UTF8Encoding]::new($false))
$reloaded = Read-Utf8Json $OutputPath
if ($reloaded.operations.Count -ne 3 -or $reloaded.passed -ne $passed) { throw 'Written summary verification failed.' }
Write-Output ("Ordinary I/O: {0}; samples={1}; output={2}" -f $(if ($passed) { 'PASS' } else { 'FAIL' }), $operations.Count, $OutputPath)
if (-not $passed) { throw 'Ordinary I/O comparison failed; see summary.' }
