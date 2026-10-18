#requires -Version 7.0
[CmdletBinding()]
param(
  [string]$ArtifactRoot = 'D:/event-shopping-planner-routeplanning-1.9.6.7/artifacts/item-update-confirmation',
  [string]$ShoppingBeforeRoot = 'D:/ciur-1018/shop-before',
  [string]$ShoppingAfterRoot = 'D:/ciur-1018/shop-after',
  [switch]$IncludeUpdate,
  [string]$UpdateBeforeRoot = 'D:/ciur-1018/update-before',
  [string]$UpdateAfterRoot = 'D:/ciur-1018/update-after',
  [string]$UpdateBeforeReport = 'D:/ciur-1018/update-before-report.json',
  [string]$UpdateAfterReport = 'D:/ciur-1018/update-after-report.json',
  [string]$BeforeCheckout = 'D:/ciub-1018',
  [string]$AfterCheckout = 'D:/ciuc-1018'
)

[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding           = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BaselineCommit = 'f15552dd999c6c1aab55a6b0ab9c2056bd0fa4ec'
$MeasurementCommit = 'cb2b22b974a50a0e3cbaae979bfad8789533493c'
$FinalValidationCommit = '1d840d6f3aa3c0949ca7eadf1b16b5e9cbc375b4'
$Operations = @('execute', 'executeRecord', 'focus', 'record', 'next', 'back')
$UpdateTimingNames = @(
  'controlledFetchWaitMs', 'responseTextToConfirmationDomMs',
  'responseTextToConfirmationPaintMs', 'checkboxReactionMs',
  'saveDurabilityMs', 'saveScreenPaintMs'
)
$DiagnosticSections = @('diagnostic', 'executionDiagnostic', 'executionRecordDiagnostic')
$RawAttachmentBytes = @{}
$Layouts = @('pc', 'smartphone')
$InvariantCulture = [Globalization.CultureInfo]::InvariantCulture

function Assert-Condition([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-AbsoluteDirectory([string]$Path, [bool]$MustExist) {
  Assert-Condition ([IO.Path]::IsPathRooted($Path)) "Absolute directory required: $Path"
  $full = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  Assert-Condition ($full.Length -gt ([IO.Path]::GetPathRoot($full)).TrimEnd('\', '/').Length) "A drive root is not an allowed target: $Path"
  if ($MustExist) { Assert-Condition (Test-Path -LiteralPath $full -PathType Container) "Directory missing: $full" }
  return $full
}

function Test-Within([string]$Root, [string]$Path) {
  $prefix = $Root.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  return $Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparseAncestor([string]$Path) {
  $cursor = $Path
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      Assert-Condition (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) "Refusing an output path through a reparse point: $cursor"
    }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
}

function Get-ArtifactTarget([string]$RelativePath) {
  Assert-Condition (-not [IO.Path]::IsPathRooted($RelativePath)) "Relative artifact name required: $RelativePath"
  $target = [IO.Path]::GetFullPath((Join-Path $script:ArtifactRoot $RelativePath))
  Assert-Condition (Test-Within $script:ArtifactRoot $target) "Artifact target escaped its root: $target"
  Assert-NoReparseAncestor $target
  return $target
}

function Ensure-Parent([string]$Target) {
  Assert-Condition (Test-Within $script:ArtifactRoot $Target) "Unsafe output: $Target"
  Assert-NoReparseAncestor $Target
  $parent = [IO.Path]::GetDirectoryName($Target)
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Assert-NoReparseAncestor $parent
}

function Convert-EvidenceJsonBytes([byte[]]$Bytes, [string]$Context) {
  $text = [Text.UTF8Encoding]::new($false, $true).GetString($Bytes)
  if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 239 -and $Bytes[1] -eq 187 -and $Bytes[2] -eq 191) { $text = $text.Substring(1) }
  Assert-Condition (-not $text.Contains([string][char]0xfffd)) "U+FFFD in evidence: $Context"
  $value = ConvertFrom-Json -InputObject $text -AsHashtable -Depth 100
  Assert-Condition ($value -is [Collections.IDictionary]) "Expected a JSON object: $Context"
  return $value
}

function Read-EvidenceJson([string]$Path) {
  return Convert-EvidenceJsonBytes ([IO.File]::ReadAllBytes($Path)) $Path
}

function Get-BytesSha256([byte[]]$Bytes) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return -join ($algorithm.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) }
  finally { $algorithm.Dispose() }
}

function Assert-Keys($Map, [string[]]$Required, [string]$Context) {
  Assert-Condition ($Map -is [Collections.IDictionary]) "Expected object at $Context"
  foreach ($name in $Required) { Assert-Condition ($Map.Contains($name)) "Missing $Context.$name" }
}

function Get-Number($Value, [string]$Context) {
  $numeric = $Value -is [byte] -or $Value -is [sbyte] -or $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int32] -or $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64] -or $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]
  Assert-Condition $numeric "Expected a JSON number at $Context"
  $number = [double]$Value
  Assert-Condition (-not [double]::IsNaN($number) -and -not [double]::IsInfinity($number) -and $number -ge 0) "Invalid duration/count at $Context"
  return $number
}

function Measure-Values([object[]]$Values, [string]$Context) {
  Assert-Condition ($Values.Count -gt 0) "No samples at $Context"
  $numbers = @($Values | ForEach-Object { Get-Number $_ $Context } | Sort-Object)
  $count = $numbers.Count
  return [ordered]@{
    sampleCount = $count
    medianMs = $numbers[[Math]::Ceiling($count * 0.5) - 1]
    p95Ms = $numbers[[Math]::Ceiling($count * 0.95) - 1]
    minMs = $numbers[0]
    maxMs = $numbers[$count - 1]
  }
}

function Assert-ReportedSummary($Reported, $Computed, [string]$CountKey, [string]$Context) {
  Assert-Keys $Reported @($CountKey, 'medianMs', 'p95Ms') $Context
  Assert-Condition ((Get-Number $Reported[$CountKey] "$Context.$CountKey") -eq $Computed.sampleCount) "Sample count mismatch at $Context"
  foreach ($metric in @('medianMs', 'p95Ms')) {
    $reportedNumber = Get-Number $Reported[$metric] "$Context.$metric"
    Assert-Condition ([Math]::Abs($reportedNumber - [double]$Computed[$metric]) -le 0.000001) "Reported $metric disagrees with nearest-rank samples at $Context"
  }
}

function Get-SaveDiagnostics($Raw, [string]$Context) {
  $results = [Collections.Generic.List[object]]::new()
  foreach ($section in $script:DiagnosticSections) {
    if (-not $Raw.Contains($section) -or $null -eq $Raw[$section]) { continue }
    $diagnostic = $Raw[$section]
    Assert-Condition ($diagnostic -is [Collections.IDictionary]) "Invalid diagnostic object: $Context.$section"
    if ($diagnostic.Contains('samples')) {
      $saves = @($diagnostic.samples | Where-Object { $_.phase -eq 'save' })
      foreach ($group in @($saves | Group-Object -Property { $_.operation })) {
        $stats = Measure-Values @($group.Group | ForEach-Object { $_.durationMs }) "$Context.$section.$($group.Name):save"
        if ($diagnostic.Contains('summary') -and $diagnostic.summary.Contains("$($group.Name):save")) {
          Assert-ReportedSummary $diagnostic.summary["$($group.Name):save"] $stats 'count' "$Context.$section.summary"
        }
        $results.Add([ordered]@{ section = $section; operation = $group.Name; phase = 'save'; statistics = $stats; source = 'samples' })
      }
    } elseif ($diagnostic.Contains('summary')) {
      foreach ($key in $diagnostic.summary.Keys) {
        if (-not $key.EndsWith(':save', [StringComparison]::Ordinal)) { continue }
        $entry = $diagnostic.summary[$key]
        Assert-Keys $entry @('count', 'medianMs', 'p95Ms') "$Context.$section.summary.$key"
        $results.Add([ordered]@{
          section = $section; operation = $key.Substring(0, $key.Length - 5); phase = 'save'
          statistics = [ordered]@{
            sampleCount = Get-Number $entry.count "$Context.$section.$key.count"
            medianMs = Get-Number $entry.medianMs "$Context.$section.$key.medianMs"
            p95Ms = Get-Number $entry.p95Ms "$Context.$section.$key.p95Ms"
          }
          source = 'reported-summary-only'
        })
      }
    }
  }
  return $results.ToArray()
}

function Get-ShoppingKey([int]$Count, [string]$Layout, [bool]$Concentrated, [bool]$MapVisible) {
  return 'n{0:D4}__{1}__concentrated-{2}__map-{3}' -f $Count, $Layout, [int]$Concentrated, [int]$MapVisible
}

function Read-ShoppingSet([string]$Root, [string]$Revision) {
  # Exact filename deliberately excludes Playwright's duplicate attachment JSON.
  $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter 'shopping-operation-timings.json')
  Assert-Condition ($files.Count -eq 24) "$Revision must contain exactly 24 explicit shopping JSON files; found $($files.Count)"
  $cases = @{}
  foreach ($file in $files) {
    $raw = Read-EvidenceJson $file.FullName
    Assert-Keys $raw @('count', 'layout', 'concentrated', 'mapVisible', 'timings', 'summary') $file.FullName
    $count = Get-Number $raw.count "$($file.FullName).count"
    Assert-Condition ($count -in @(150, 500, 1500)) "Unexpected shopping size: $count"
    Assert-Condition ($raw.layout -in $script:Layouts) "Unexpected layout: $($raw.layout)"
    Assert-Condition ($raw.concentrated -is [bool] -and $raw.mapVisible -is [bool]) "Profile flags must be booleans: $($file.FullName)"
    if ($raw.Contains('errors')) { Assert-Condition (@($raw.errors).Count -eq 0) "Browser errors in $($file.FullName)" }
    Assert-Keys $raw.timings $script:Operations "$($file.FullName).timings"
    Assert-Keys $raw.summary $script:Operations "$($file.FullName).summary"
    Assert-Condition ($raw.timings.Count -eq 6 -and $raw.summary.Count -eq 6) "Exactly six shopping operations required: $($file.FullName)"
    $key = Get-ShoppingKey ([int]$count) $raw.layout $raw.concentrated $raw.mapVisible
    Assert-Condition (-not $cases.ContainsKey($key)) "Duplicate shopping profile: $Revision/$key"
    $statistics = [ordered]@{}
    foreach ($operation in $script:Operations) {
      $computed = Measure-Values @($raw.timings[$operation]) "$Revision/$key/$operation"
      Assert-ReportedSummary $raw.summary[$operation] $computed 'count' "$Revision/$key/summary/$operation"
      $statistics[$operation] = $computed
    }
    $cases[$key] = [ordered]@{
      profile = [ordered]@{ count = [int]$count; layout = $raw.layout; concentrated = $raw.concentrated; mapVisible = $raw.mapVisible }
      scope = $(if ($count -eq 1500) { 'additional-1500' } else { 'mandatory-150-500' })
      operations = $statistics
      saveCompletion = @(Get-SaveDiagnostics $raw "$Revision/$key")
      sourceFile = $file.FullName
      artifactFile = "shopping/$Revision/$key.json"
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  foreach ($count in @(150, 500, 1500)) {
    foreach ($layout in $script:Layouts) {
      foreach ($concentrated in @($false, $true)) {
        foreach ($mapVisible in @($false, $true)) {
          $expected = Get-ShoppingKey $count $layout $concentrated $mapVisible
          Assert-Condition ($cases.ContainsKey($expected)) "Missing shopping profile: $Revision/$expected"
        }
      }
    }
  }
  return $cases
}

function Get-OperationDelta($Before, $After) {
  return [ordered]@{
    sampleCountDelta = $After.sampleCount - $Before.sampleCount
    medianDeltaMs = [double]$After.medianMs - [double]$Before.medianMs
    p95DeltaMs = [double]$After.p95Ms - [double]$Before.p95Ms
  }
}

function Get-GateSummary([object[]]$Cases, [string]$Scope, [string]$Revision) {
  $selected = @($Cases | Where-Object { $_.scope -eq $Scope })
  $expectedProfiles = if ($Scope -eq 'mandatory-150-500') { 16 } else { 8 }
  Assert-Condition ($selected.Count -eq $expectedProfiles) "Incorrect $Scope profile count: $Revision"
  $rows = [Collections.Generic.List[object]]::new()
  $failures = [Collections.Generic.List[object]]::new()
  foreach ($case in $selected) {
    foreach ($operation in $script:Operations) {
      $stats = $case[$Revision].operations[$operation]
      $row = [ordered]@{ profile = $case.key; operation = $operation; sampleCount = $stats.sampleCount; medianMs = $stats.medianMs; p95Ms = $stats.p95Ms }
      $rows.Add($row)
      if ($stats.sampleCount -lt 20 -or $stats.medianMs -gt 55.0 -or $stats.p95Ms -gt 100.0) { $failures.Add($row) }
    }
  }
  return [ordered]@{
    scope = $Scope; revision = $Revision; profileCount = $selected.Count; operationCaseCount = $rows.Count
    minimumSamples = ($rows | ForEach-Object { $_.sampleCount } | Measure-Object -Minimum).Minimum
    maximumMedianMs = ($rows | ForEach-Object { $_.medianMs } | Measure-Object -Maximum).Maximum
    maximumP95Ms = ($rows | ForEach-Object { $_.p95Ms } | Measure-Object -Maximum).Maximum
    passed = $failures.Count -eq 0; failures = $failures.ToArray()
  }
}

function Get-UpdateKey([int]$Count, [string]$Scenario) { return 'n{0:D4}__{1}' -f $Count, $Scenario }

function Add-ReporterAttachments($Suite, [string]$ReportPath, $Items) {
  if ($Suite.Contains('specs')) {
    foreach ($spec in @($Suite.specs)) {
      Assert-Keys $spec @('title', 'tests') "$ReportPath/spec"
      foreach ($test in @($spec.tests)) {
        Assert-Keys $test @('results') "$ReportPath/test/$($spec.title)"
        foreach ($result in @($test.results)) {
          if (-not $result.Contains('attachments')) { continue }
          foreach ($attachment in @($result.attachments)) {
            if (-not $attachment.Contains('name') -or $attachment.name -ne 'item-update-phase-timings') { continue }
            Assert-Condition ($result.status -eq 'passed') "Update attachment belongs to an unsuccessful result: $ReportPath/$($spec.title)"
            if ($result.Contains('errors')) { Assert-Condition (@($result.errors).Count -eq 0) "Update test result contains errors: $ReportPath/$($spec.title)" }
            $context = "$ReportPath#test=$($spec.title)"
            $sourceFile = $null
            if ($attachment.Contains('body') -and $null -ne $attachment.body) {
              Assert-Condition ($attachment.body -is [string]) "Reporter attachment body must be base64: $context"
              $bytes = [Convert]::FromBase64String($attachment.body)
              $kind = 'playwright-json-body-base64'
            } elseif ($attachment.Contains('path') -and -not [string]::IsNullOrWhiteSpace($attachment.path)) {
              $sourceFile = if ([IO.Path]::IsPathRooted($attachment.path)) {
                [IO.Path]::GetFullPath($attachment.path)
              } else {
                [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetDirectoryName($ReportPath)) $attachment.path))
              }
              Assert-Condition (Test-Path -LiteralPath $sourceFile -PathType Leaf) "Reporter attachment path missing: $sourceFile"
              $bytes = [IO.File]::ReadAllBytes($sourceFile)
              $kind = 'playwright-json-attachment-path'
            } else { throw "Update attachment has neither body nor path: $context" }
            $reportTest = [ordered]@{ title = $spec.title; resultStatus = $result.status }
            foreach ($name in @('projectName', 'projectId')) { if ($test.Contains($name)) { $reportTest[$name] = $test[$name] } }
            foreach ($name in @('retry', 'startTime', 'duration')) { if ($result.Contains($name)) { $reportTest[$name] = $result[$name] } }
            $Items.Add([ordered]@{
              context = $context; bytes = $bytes; sourceFile = $sourceFile
              provenance = [ordered]@{ kind = $kind; reportFile = $ReportPath; attachmentName = $attachment.name; test = $reportTest }
            })
          }
        }
      }
    }
  }
  if ($Suite.Contains('suites')) {
    foreach ($nested in @($Suite.suites)) { Add-ReporterAttachments $nested $ReportPath $Items }
  }
}

function Get-UpdateInputs([string]$Root, [string]$ReportPath, [string]$Revision) {
  $items = [Collections.Generic.List[object]]::new()
  if (Test-Path -LiteralPath $ReportPath -PathType Leaf) {
    # Playwright JSON reporter embeds testInfo.attach({body}) as a base64 body.
    # Read suites -> specs -> tests -> results -> attachments, including nested suites.
    $report = Read-EvidenceJson $ReportPath
    Assert-Keys $report @('suites', 'errors', 'stats') $ReportPath
    Assert-Condition (@($report.errors).Count -eq 0) "Playwright reporter contains errors: $ReportPath"
    Assert-Keys $report.stats @('expected', 'unexpected', 'flaky', 'skipped') "$ReportPath/stats"
    Assert-Condition ($report.stats.expected -eq 6 -and $report.stats.unexpected -eq 0 -and $report.stats.flaky -eq 0 -and $report.stats.skipped -eq 0) "Reporter must contain six successful, non-flaky update tests: $ReportPath"
    foreach ($suite in @($report.suites)) { Add-ReporterAttachments $suite $ReportPath $items }
    $reportHash = (Get-FileHash -LiteralPath $ReportPath -Algorithm SHA256).Hash.ToLowerInvariant()
    foreach ($item in $items) { $item.provenance.reportSha256 = $reportHash }
  } else {
    Assert-Condition (Test-Path -LiteralPath $Root -PathType Container) "Neither update JSON reporter nor attachment directory exists: $ReportPath / $Root"
    $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter 'item-update-phase-timings*.json' | Where-Object { $_.Directory.Name -eq 'attachments' })
    foreach ($file in $files) {
      $items.Add([ordered]@{
        context = $file.FullName; bytes = [IO.File]::ReadAllBytes($file.FullName); sourceFile = $file.FullName
        provenance = [ordered]@{ kind = 'attachment-file'; attachmentName = 'item-update-phase-timings' }
      })
    }
  }
  Assert-Condition ($items.Count -eq 6) "$Revision must contain exactly six update attachments; found $($items.Count)"
  return $items.ToArray()
}

function Read-UpdateSet([string]$Root, [string]$Revision, [string]$ReportPath) {
  $inputs = @(Get-UpdateInputs $Root $ReportPath $Revision)
  $expectedPhase = if ($Revision -eq 'before') { 'baseline' } else { 'current' }
  $cases = @{}
  foreach ($attachmentInput in $inputs) {
    $context = $attachmentInput.context
    $raw = Convert-EvidenceJsonBytes $attachmentInput.bytes $context
    Assert-Keys $raw @('phase', 'count', 'scenario', 'entry', 'samplesPerCondition', 'fetchDelayMs', 'summary', 'samples') $context
    Assert-Condition ($raw.phase -eq $expectedPhase) "Wrong update revision: $($context)"
    Assert-Condition ($raw.count -in @(150, 500) -and $raw.scenario -in @('normal', 'collision-title', 'duplicates')) "Unexpected update profile: $($context)"
    Assert-Condition ($raw.samplesPerCondition -eq 20 -and @($raw.samples).Count -eq 20) "Exactly 20 update samples required: $($context)"
    $key = Get-UpdateKey $raw.count $raw.scenario
    Assert-Condition (-not $cases.ContainsKey($key)) "Duplicate update profile: $Revision/$key"
    $iterations = @($raw.samples | ForEach-Object { $_.iteration } | Sort-Object -Unique)
    Assert-Condition ($iterations.Count -eq 20 -and ($iterations -join ',') -eq ((0..19) -join ',')) "Invalid update sample iterations: $Revision/$key"
    Assert-Keys $raw.summary $script:UpdateTimingNames "$Revision/$key/summary"
    Assert-Condition ($raw.summary.Count -eq 6) "Exactly six update phase summaries required: $Revision/$key"
    $statistics = [ordered]@{}
    foreach ($timing in $script:UpdateTimingNames) {
      $values = @($raw.samples | ForEach-Object {
        Assert-Keys $_.timings $script:UpdateTimingNames "$Revision/$key/sample/$($_.iteration)/timings"
        Assert-Condition ($_.timings.Count -eq 6) "Exactly six update timings required: $Revision/$key"
        $_.timings[$timing]
      })
      $stats = Measure-Values $values "$Revision/$key/$timing"
      Assert-ReportedSummary $raw.summary[$timing] $stats 'sampleCount' "$Revision/$key/summary/$timing"
      $statistics[$timing] = $stats
    }
    $outcomes = [Collections.Generic.List[object]]::new()
    foreach ($sample in $raw.samples) {
      Assert-Keys $sample @('iteration', 'reviewCounts', 'outcome', 'reloadVerified', 'transactions', 'runtimeErrors') "$Revision/$key/sample"
      Assert-Keys $sample.outcome @('initialCount', 'savedCount', 'retainedOriginalIds', 'removedOriginalIds', 'addedIdsCount', 'metadata', 'executeIds', 'sampleItems') "$Revision/$key/outcome"
      Assert-Condition ($sample.reloadVerified -eq $true) "Saved state was not reload-verified: $Revision/$key/$($sample.iteration)"
      Assert-Condition (@($sample.runtimeErrors).Count -eq 0) "Runtime errors in update sample: $Revision/$key/$($sample.iteration)"
      Assert-Condition (@($sample.transactions | Where-Object { $_.outcome -ne 'complete' }).Count -eq 0) "Incomplete transaction in update sample: $Revision/$key/$($sample.iteration)"
      Assert-Condition (@($sample.transactions | Where-Object { $_.eventListWrites -gt 0 -and $_.outcome -eq 'complete' }).Count -ge 1) "Missing durable event-list write: $Revision/$key/$($sample.iteration)"
      if ($Revision -eq 'after') {
        Assert-Condition ($sample.outcome.initialCount -eq $raw.count -and $sample.outcome.savedCount -eq $raw.count -and $sample.outcome.retainedOriginalIds -eq $raw.count -and @($sample.outcome.removedOriginalIds).Count -eq 0 -and $sample.outcome.addedIdsCount -eq 0) "Current update failed ID/count stability: $key/$($sample.iteration)"
      }
      $outcomes.Add([ordered]@{
        iteration = $sample.iteration; reviewCounts = $sample.reviewCounts
        savedOutcome = $sample.outcome; reloadVerified = $sample.reloadVerified
        transactions = $sample.transactions; runtimeErrors = $sample.runtimeErrors
      })
    }
    $environment = [ordered]@{}
    foreach ($name in @('browserVersion', 'browserChannel', 'headed', 'paintObservation', 'saveObservation')) { if ($raw.Contains($name)) { $environment[$name] = $raw[$name] } }
    $cases[$key] = [ordered]@{
      profile = [ordered]@{ count = $raw.count; scenario = $raw.scenario; entry = $raw.entry }
      phase = $raw.phase; samplesPerCondition = 20; fetchDelayMs = $raw.fetchDelayMs
      timings = $statistics; outcomes = $outcomes.ToArray(); environment = $environment
      outcomeSummary = [ordered]@{
        reloadVerifiedCount = 20
        savedCountMinimum = ($raw.samples | ForEach-Object { $_.outcome.savedCount } | Measure-Object -Minimum).Minimum
        savedCountMaximum = ($raw.samples | ForEach-Object { $_.outcome.savedCount } | Measure-Object -Maximum).Maximum
        retainedOriginalIdsMinimum = ($raw.samples | ForEach-Object { $_.outcome.retainedOriginalIds } | Measure-Object -Minimum).Minimum
        addedIdsCountMaximum = ($raw.samples | ForEach-Object { $_.outcome.addedIdsCount } | Measure-Object -Maximum).Maximum
      }
      sourceFile = $attachmentInput.sourceFile; sourceAttachment = $attachmentInput.provenance; artifactFile = "update/$Revision/$key.json"
      sha256 = Get-BytesSha256 $attachmentInput.bytes
    }
    if ($null -eq $attachmentInput.sourceFile) { $script:RawAttachmentBytes["update/$Revision/$key.json"] = $attachmentInput.bytes }
  }
  foreach ($count in @(150, 500)) {
    foreach ($scenario in @('normal', 'collision-title', 'duplicates')) {
      Assert-Condition ($cases.ContainsKey((Get-UpdateKey $count $scenario))) "Missing update scenario: $Revision/$count/$scenario"
    }
  }
  return $cases
}

function Copy-RawEvidence($Case) {
  $target = Get-ArtifactTarget $Case.artifactFile
  Ensure-Parent $target
  if (Test-Path -LiteralPath $target) {
    Assert-Condition (Test-Path -LiteralPath $target -PathType Leaf) "Raw output is not a file: $target"
    $existingHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Condition ($existingHash -eq $Case.sha256) "Refusing to overwrite different raw evidence: $target"
  } else {
    if ($null -ne $Case.sourceFile) {
      Copy-Item -LiteralPath $Case.sourceFile -Destination $target
    } else {
      Assert-Condition ($script:RawAttachmentBytes.ContainsKey($Case.artifactFile)) "Decoded attachment bytes are missing: $($Case.artifactFile)"
      # Raw bytes intentionally bypass text encoding/reformatting to preserve body exactly.
      [IO.File]::WriteAllBytes($target, [byte[]]$script:RawAttachmentBytes[$Case.artifactFile])
    }
  }
  $copiedHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert-Condition ($copiedHash -eq $Case.sha256) "Raw byte copy hash mismatch: $target"
}

function Write-Utf8Artifact([string]$RelativePath, [string]$Text) {
  $target = Get-ArtifactTarget $RelativePath
  Ensure-Parent $target
  $textWithLf = $Text.Replace("`r`n", "`n").TrimEnd("`n") + "`n"
  Set-Content -LiteralPath $target -Value $textWithLf -NoNewline -Encoding utf8
  $bytes = [IO.File]::ReadAllBytes($target)
  Assert-Condition (-not ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)) "Unexpected output BOM: $target"
  $again = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
  Assert-Condition ($again -ceq $textWithLf -and -not $again.Contains([string][char]0xfffd)) "Output encoding/roundtrip mismatch: $target"
}

function Get-CheckoutIdentity([string]$Path, [string]$ExpectedCommit) {
  $full = Get-AbsoluteDirectory $Path $true
  $head = (& git -C $full rev-parse HEAD).Trim()
  Assert-Condition ($LASTEXITCODE -eq 0 -and $head -eq $ExpectedCommit) "Unexpected source commit in $full : $head"
  $status = @(& git -C $full status --porcelain)
  Assert-Condition ($LASTEXITCODE -eq 0) "git status failed: $full"
  return [ordered]@{ checkout = $full; commit = $head; hasUncommittedChanges = $status.Count -gt 0; statusPorcelain = $status }
}

function Get-ProductionEquivalence([string]$Checkout) {
  $fromSpec = '{0}:src' -f $script:MeasurementCommit
  $toSpec = '{0}:src' -f $script:FinalValidationCommit
  $fromTree = (& git -C $Checkout rev-parse $fromSpec).Trim()
  Assert-Condition ($LASTEXITCODE -eq 0) "Cannot resolve measured src tree: $fromSpec"
  $toTree = (& git -C $Checkout rev-parse $toSpec).Trim()
  Assert-Condition ($LASTEXITCODE -eq 0) "Cannot resolve final src tree: $toSpec"
  Assert-Condition ($fromTree -eq $toTree) 'Measured and final src trees differ.'
  $excludedFiles = @('README.md', 'tests/browser/item-update-confirmation.performance.spec.ts')
  $nameStatus = @(& git -C $Checkout diff --name-status $script:MeasurementCommit $script:FinalValidationCommit)
  Assert-Condition ($LASTEXITCODE -eq 0) 'Cannot list measured/final snapshot differences.'
  $outsideDiff = @(& git -C $Checkout diff --exit-code $script:MeasurementCommit $script:FinalValidationCommit -- . ':(exclude)README.md' ':(exclude)tests/browser/item-update-confirmation.performance.spec.ts')
  $diffExitCode = $LASTEXITCODE
  Assert-Condition ($diffExitCode -eq 0) 'Snapshots differ outside the README and browser measurement harness.'
  return [ordered]@{
    measuredCommit = $script:MeasurementCommit
    finalValidationCommit = $script:FinalValidationCommit
    measuredSrcTree = $fromTree
    finalSrcTree = $toTree
    srcTreeIdentical = $true
    excludedFiles = $excludedFiles
    nameStatus = $nameStatus
    nonExcludedDiffExitCode = $diffExitCode
    nonExcludedDiffOutput = $outsideDiff
    productionSourceInputsIdentical = $true
    distByteIdentityClaimed = $false
    note = 'Only README and the browser measurement harness are excluded. Repository production inputs are identical; commit/release identity embedding may change built dist bytes.'
    verificationCommands = @(
      "git rev-parse $fromSpec $toSpec",
      "git diff --name-status $($script:MeasurementCommit) $($script:FinalValidationCommit)",
      "git diff --exit-code $($script:MeasurementCommit) $($script:FinalValidationCommit) -- . ':(exclude)README.md' ':(exclude)tests/browser/item-update-confirmation.performance.spec.ts'"
    )
  }
}
function Format-Number([double]$Value) { return $Value.ToString('0.000', $script:InvariantCulture) }
function Format-Stats($Stats) { return 'n={0}; {1}/{2}' -f $Stats.sampleCount, (Format-Number $Stats.medianMs), (Format-Number $Stats.p95Ms) }
function Get-PassText($Stats) { if ($Stats.sampleCount -ge 20 -and $Stats.medianMs -le 55.0 -and $Stats.p95Ms -le 100.0) { return '通過' }; return '未達' }

# Validate all paths and inputs before creating or changing any artifact.
$ArtifactRoot = Get-AbsoluteDirectory $ArtifactRoot $false
Assert-NoReparseAncestor $ArtifactRoot
$ShoppingBeforeRoot = Get-AbsoluteDirectory $ShoppingBeforeRoot $true
$ShoppingAfterRoot = Get-AbsoluteDirectory $ShoppingAfterRoot $true
$inputRoots = @($ShoppingBeforeRoot, $ShoppingAfterRoot)
if ($IncludeUpdate) {
  Assert-Condition ([IO.Path]::IsPathRooted($UpdateBeforeReport) -and [IO.Path]::IsPathRooted($UpdateAfterReport)) 'Update JSON reporter paths must be absolute.'
  $UpdateBeforeReport = [IO.Path]::GetFullPath($UpdateBeforeReport)
  $UpdateAfterReport = [IO.Path]::GetFullPath($UpdateAfterReport)
  $UpdateBeforeRoot = Get-AbsoluteDirectory $UpdateBeforeRoot (-not (Test-Path -LiteralPath $UpdateBeforeReport -PathType Leaf))
  $UpdateAfterRoot = Get-AbsoluteDirectory $UpdateAfterRoot (-not (Test-Path -LiteralPath $UpdateAfterReport -PathType Leaf))
  $inputRoots += @($UpdateBeforeRoot, $UpdateAfterRoot)
  foreach ($reportFile in @($UpdateBeforeReport, $UpdateAfterReport)) {
    Assert-Condition (-not ($ArtifactRoot -eq $reportFile -or (Test-Within $ArtifactRoot $reportFile))) "Artifact root must not contain an input reporter file: $reportFile"
  }
}
foreach ($inputRoot in $inputRoots) {
  Assert-Condition (-not ($ArtifactRoot -eq $inputRoot -or (Test-Within $ArtifactRoot $inputRoot) -or (Test-Within $inputRoot $ArtifactRoot))) "Artifact root must not overlap an input directory: $inputRoot"
}
$sourceIdentity = [ordered]@{
  before = Get-CheckoutIdentity $BeforeCheckout $BaselineCommit
  after = Get-CheckoutIdentity $AfterCheckout $FinalValidationCommit
  measurements = [ordered]@{
    shopping = [ordered]@{ beforeCommit = $BaselineCommit; afterCommit = $MeasurementCommit }
    sourcePipeline = [ordered]@{ beforeCommit = $BaselineCommit; afterCommit = $MeasurementCommit; artifactFile = 'source-performance.json'; samples = 100; reuseUnmodified = $true }
    updateBrowser = [ordered]@{ beforeCommit = $BaselineCommit; afterCommit = $FinalValidationCommit; included = [bool]$IncludeUpdate }
  }
  finalValidation = [ordered]@{ qualityCommit = $FinalValidationCommit; rollbackCommit = $FinalValidationCommit; buildCommit = $FinalValidationCommit }
  browserHarnessProvenance = [ordered]@{
    baselineProductionCommit = $BaselineCommit
    copiedHarnessPath = 'tests/browser/item-update-confirmation.performance.spec.ts'
    baselineUntrackedMeasurementHarnessPermitted = $true
    checkoutStatusRecordedWithoutCleanRequirement = $true
    sourcePipelineCleanStateEvidence = 'source-performance.json'
    note = 'The browser baseline remains at f15552d and may contain only the copied measurement harness as an untracked file. Its actual git status is recorded above. CPU/source measurements have their own clean-checkout provenance in the unchanged source-performance.json; browser harness setup does not rewrite that earlier evidence.'
  }
  productionEquivalence = Get-ProductionEquivalence $AfterCheckout
}
$before = Read-ShoppingSet $ShoppingBeforeRoot 'before'
$after = Read-ShoppingSet $ShoppingAfterRoot 'after'
$shoppingCases = [Collections.Generic.List[object]]::new()
foreach ($key in @($before.Keys | Sort-Object)) {
  Assert-Condition ($after.ContainsKey($key)) "Before/after profile mismatch: $key"
  $deltas = [ordered]@{}
  foreach ($operation in $Operations) { $deltas[$operation] = Get-OperationDelta $before[$key].operations[$operation] $after[$key].operations[$operation] }
  $shoppingCases.Add([ordered]@{ key = $key; profile = $before[$key].profile; scope = $before[$key].scope; before = $before[$key]; after = $after[$key]; deltas = $deltas })
}
$gates = [Collections.Generic.List[object]]::new()
foreach ($scope in @('mandatory-150-500', 'additional-1500')) {
  foreach ($revision in @('before', 'after')) { $gates.Add((Get-GateSummary $shoppingCases.ToArray() $scope $revision)) }
}
$updates = [ordered]@{ included = [bool]$IncludeUpdate; cases = @(); note = 'Update benchmark not requested; use -IncludeUpdate to require all six conditions in both revisions.' }
if ($IncludeUpdate) {
  $updateBefore = Read-UpdateSet $UpdateBeforeRoot 'before' $UpdateBeforeReport
  $updateAfter = Read-UpdateSet $UpdateAfterRoot 'after' $UpdateAfterReport
  $updateCases = [Collections.Generic.List[object]]::new()
  foreach ($key in @($updateBefore.Keys | Sort-Object)) {
    $old = $updateBefore[$key]; $new = $updateAfter[$key]
    Assert-Condition ($old.profile.entry -eq $new.profile.entry -and $old.fetchDelayMs -eq $new.fetchDelayMs) "Update fixture mismatch: $key"
    $deltas = [ordered]@{}
    foreach ($timing in $UpdateTimingNames) { $deltas[$timing] = Get-OperationDelta $old.timings[$timing] $new.timings[$timing] }
    $updateCases.Add([ordered]@{ key = $key; profile = $old.profile; before = $old; after = $new; deltas = $deltas })
  }
  $updates = [ordered]@{ included = $true; profileCount = 6; samplesPerCondition = 20; latencyGateApplied = $false; cases = $updateCases.ToArray(); note = 'Update phases and durable outcomes are reported separately; the shopping 55/100 ms reaction gates are not applied to network wait or save completion.' }
}
$allShoppingPassed = @($gates | Where-Object { -not $_.passed }).Count -eq 0
$comparison = [ordered]@{
  schemaVersion = 1; generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  sourceIdentity = $sourceIdentity
  policy = [ordered]@{ medianMaximumMs = 55.0; p95MaximumMs = 100.0; minimumSamples = 20; percentile = 'nearest-rank'; saveCompletionGateApplied = $false; historical50msEvidenceModified = $false }
  shopping = [ordered]@{ profileCount = 24; operationCountPerProfile = 6; mandatoryProfiles = 16; additionalProfiles = 8; allPassed = $allShoppingPassed; gates = $gates.ToArray(); cases = $shoppingCases.ToArray() }
  updates = $updates
}
foreach ($case in $shoppingCases) { Copy-RawEvidence $case.before; Copy-RawEvidence $case.after }
if ($IncludeUpdate) { foreach ($case in $updates.cases) { Copy-RawEvidence $case.before; Copy-RawEvidence $case.after } }
Write-Utf8Artifact 'comparison.json' (ConvertTo-Json -InputObject $comparison -Depth 100)

$markdown = [Collections.Generic.List[string]]::new()
$markdown.Add('測定比較。反応時間の各欄は n、中央値/95%点（ms）。保存完了時間は反応の合否判定へ含めない。')
$markdown.Add('')
$markdown.Add("修正前: ``$BaselineCommit``。買い物・ソース処理の実装計測: ``$MeasurementCommit``。更新ブラウザ・最終品質・ロールバック・ビルド: ``$FinalValidationCommit``。全条件の生データ・保存結果・診断別の保存完了時間は comparison.json と固定名raw JSONへ保存。")
$markdown.Add('')
$markdown.Add('計測版と最終検証版はsrc treeが一致し、READMEと測定harness以外のgit diff --exit-code終了0を確認。アプリ実装の同一性を示すもので、dist全byte同一を主張しない。source-performance.jsonは静穏時100samplesの記録を変更せず採用。')
$markdown.Add('ブラウザの基準checkoutはf15552dのまま、共通の測定harnessだけを未追跡ファイルとしてコピーしている。実際のgit statusはcomparison.jsonに保存する。CPU/source計測時のclean状態の証跡とは区別する。')
$markdown.Add('')
$markdown.Add('| 範囲 | 版 | 条件数 | 操作条件数 | 最少n | 最大中央値ms | 最大95%点ms | 個別判定 |')
$markdown.Add('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |')
foreach ($gate in $gates) {
  $gateText = if ($gate.passed) { '全操作通過' } else { "未達 $(@($gate.failures).Count)操作" }
  $markdown.Add(('| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} |' -f $gate.scope, $gate.revision, $gate.profileCount, $gate.operationCaseCount, $gate.minimumSamples, (Format-Number $gate.maximumMedianMs), (Format-Number $gate.maximumP95Ms), $gateText))
}
$markdown.Add('')
$markdown.Add('| 条件tuple | 範囲 | 操作 | 修正前 n;中央値/95%点 | 実装 n;中央値/95%点 | 中央値差ms | 95%点差ms | 前/後判定 |')
$markdown.Add('| --- | --- | --- | --- | --- | ---: | ---: | --- |')
foreach ($case in $shoppingCases) {
  foreach ($operation in $Operations) {
    $old = $case.before.operations[$operation]; $new = $case.after.operations[$operation]; $delta = $case.deltas[$operation]
    $markdown.Add(('| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7}/{8} |' -f $case.key, $case.scope, $operation, (Format-Stats $old), (Format-Stats $new), (Format-Number $delta.medianDeltaMs), (Format-Number $delta.p95DeltaMs), (Get-PassText $old), (Get-PassText $new)))
  }
}
$markdown.Add('')
$markdown.Add('保存完了の診断は各条件の saveCompletion に diagnostic / executionDiagnostic / executionRecordDiagnostic を分けて記録。反応時間の55/100ms基準は適用しない。')
$markdown.Add('')
if ($IncludeUpdate) {
  $markdown.Add('| 更新条件 | 入口 | 修正前の6段階（n;中央値/95%点ms） | 実装の6段階（n;中央値/95%点ms） | 保存件数 前→後 | 再読込確認 前/後 |')
  $markdown.Add('| --- | --- | --- | --- | --- | --- |')
  foreach ($case in $updates.cases) {
    $oldCells = @($UpdateTimingNames | ForEach-Object { '{0}: {1}' -f $_, (Format-Stats $case.before.timings[$_]) }) -join '<br>'
    $newCells = @($UpdateTimingNames | ForEach-Object { '{0}: {1}' -f $_, (Format-Stats $case.after.timings[$_]) }) -join '<br>'
    $oldOutcome = $case.before.outcomeSummary; $newOutcome = $case.after.outcomeSummary
    $saved = '{0}〜{1} → {2}〜{3}' -f $oldOutcome.savedCountMinimum, $oldOutcome.savedCountMaximum, $newOutcome.savedCountMinimum, $newOutcome.savedCountMaximum
    $markdown.Add(('| {0} | {1} | {2} | {3} | {4} | {5}/20・{6}/20 |' -f $case.key, $case.profile.entry, $oldCells, $newCells, $saved, $oldOutcome.reloadVerifiedCount, $newOutcome.reloadVerifiedCount))
  }
} else { $markdown.Add('更新6条件の集計は未実施。両版の測定終了後、-IncludeUpdate 付きで再実行する。') }
Write-Utf8Artifact 'performance-tables.md' ($markdown -join "`n")
Write-Host "Evidence written: $ArtifactRoot/comparison.json"
Write-Host "Tables written: $ArtifactRoot/performance-tables.md"
if (-not $allShoppingPassed) { throw 'Shopping reaction gates failed. Individual failures and raw evidence were retained in comparison.json.' }
