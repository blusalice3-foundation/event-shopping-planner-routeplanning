param(
  [string]$BaselineReport = (Join-Path $PSScriptRoot 'esp-op19-baseline-io.json'),
  [string]$FinalReport = (Join-Path $PSScriptRoot 'browser-report.json'),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'io-comparison.json')
)

[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false, $true)

function Read-IoAttachment([string]$ReportPath) {
  $resolved = (Resolve-Path -LiteralPath $ReportPath).Path
  $report = [IO.File]::ReadAllText($resolved, $utf8) | ConvertFrom-Json
  function Find-IoAttachments($Suites) {
    foreach ($suite in $Suites) {
      foreach ($spec in $suite.specs) {
        foreach ($test in $spec.tests) {
          foreach ($result in $test.results) {
            foreach ($attachment in $result.attachments) {
              if ($attachment.name -eq 'ordinary-persistence-io') {
                if ($result.status -ne 'passed') {
                  throw "The I/O observation test did not pass: $resolved"
                }
                [pscustomobject]@{ Title = $spec.title; Attachment = $attachment }
              }
            }
          }
        }
      }
      if ($suite.suites) { Find-IoAttachments $suite.suites }
    }
  }
  $matches = @(Find-IoAttachments $report.suites)
  if ($matches.Count -ne 1) {
    throw "Expected exactly one successful I/O attachment in $resolved; found $($matches.Count)"
  }
  $attachment = $matches[0].Attachment
  if ($attachment.body) {
    $json = $utf8.GetString([Convert]::FromBase64String($attachment.body))
  } elseif ($attachment.path) {
    $attachmentPath = $attachment.path
    if (-not [IO.Path]::IsPathRooted($attachmentPath)) {
      $attachmentPath = Join-Path (Split-Path -Parent $resolved) $attachmentPath
    }
    $json = [IO.File]::ReadAllText($attachmentPath, $utf8)
  } else {
    throw "The I/O attachment has neither inline body nor path: $resolved"
  }
  $payload = $json | ConvertFrom-Json
  $operations = @($payload.observations.operation | Sort-Object)
  if (($operations -join ',') -cne 'memo,planned-quantity,purchase') {
    throw "Expected one observation for each ordinary operation in $resolved"
  }
  [pscustomobject]@{
    Path = $resolved
    Sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
    TestTitle = $matches[0].Title
    Payload = $payload
  }
}

function Get-IoStructure($Observation) {
  $roundTrips = [ordered]@{}
  foreach ($property in ($Observation.workerRoundTripsByMethod.PSObject.Properties | Sort-Object Name)) {
    $roundTrips[$property.Name] = $property.Value
  }
  [ordered]@{
    WorkerRoundTripsByMethod = $roundTrips
    PhysicalCommittedTransactions = $Observation.physicalCommittedTransactions
    CommittedObjectStoreMutationRequests = $Observation.committedObjectStoreMutationRequests
    TransactionStores = @(
      foreach ($stores in $Observation.transactionStores) { ,@($stores | Sort-Object) }
    )
    Mutations = @(
      foreach ($mutation in ($Observation.mutations | Sort-Object store, method)) {
        [ordered]@{ Store = $mutation.store; Method = $mutation.method }
      }
    )
  }
}

$baseline = Read-IoAttachment $BaselineReport
$final = Read-IoAttachment $FinalReport
$fixtureMatches = $baseline.Payload.fixture -ceq $final.Payload.fixture
$comparisons = @(
  foreach ($before in $baseline.Payload.observations) {
    $after = @($final.Payload.observations | Where-Object operation -CEQ $before.operation)[0]
    $beforeStructure = Get-IoStructure $before
    $afterStructure = Get-IoStructure $after
    $same = ($beforeStructure | ConvertTo-Json -Depth 10 -Compress) -ceq (
      $afterStructure | ConvertTo-Json -Depth 10 -Compress
    )
    [ordered]@{
      Operation = $before.operation
      StructuralMatch = $same
      Baseline = $beforeStructure
      Final = $afterStructure
      TimingObservationOnly = [ordered]@{
        SamplesPerBuild = 1
        PerformanceAcceptance = $false
        BaselineResponseMs = $before.responseMs
        FinalResponseMs = $after.responseMs
        BaselineSaveCompletionMs = $before.saveCompletionMs
        FinalSaveCompletionMs = $after.saveCompletionMs
      }
    }
  }
)
$passed = $fixtureMatches -and @($comparisons | Where-Object { -not $_.StructuralMatch }).Count -eq 0
$output = [ordered]@{
  Result = $(if ($passed) { 'passed' } else { 'failed' })
  Notes = 'Physical completed readwrite transactions and issued objectStore mutation requests are compared separately from diagnostic events. Single-observation response/save timings are not performance acceptance; memo save includes debounce.'
  Baseline = [ordered]@{ Path = $baseline.Path; Sha256 = $baseline.Sha256; TestTitle = $baseline.TestTitle }
  Final = [ordered]@{ Path = $final.Path; Sha256 = $final.Sha256; TestTitle = $final.TestTitle }
  Fixture = $baseline.Payload.fixture
  FixtureMatches = $fixtureMatches
  Comparisons = $comparisons
}
$encoded = ($output | ConvertTo-Json -Depth 15).Replace("`r`n", "`n") + "`n"
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $encoded, [Text.UTF8Encoding]::new($false))
if (-not $passed) { throw "Ordinary persistence structure differs; inspect $OutputPath" }
Write-Output "Ordinary persistence I/O matches for all three operations: $OutputPath"
