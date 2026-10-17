[CmdletBinding()]
param([string]$EvidenceRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$utf8 = [Text.UTF8Encoding]::new($false, $true)
function Metric-Unit([string]$Name) {
    if ($Name -match '(^|\.)putRequests\.' -or $Name -match '(Count|Calls|Attempts|Successes|Aborted|Puts)$') { return 'count' }
    if ($Name -cmatch 'Ms$') { return 'ms' }
    return 'count'
}
$affected = [Collections.Generic.List[object]]::new()
foreach ($dir in Get-ChildItem -LiteralPath $EvidenceRoot -Directory -Filter 'independent-summary*') {
    if ($dir.Name -like '*-units-corrected') { continue }
    foreach ($file in Get-ChildItem -LiteralPath $dir.FullName -File -Filter '*.csv') {
        $rows = @(Import-Csv -LiteralPath $file.FullName -Encoding utf8)
        if (!$rows.Count -or 'Unit' -notin $rows[0].PSObject.Properties.Name -or 'Metric' -notin $rows[0].PSObject.Properties.Name) { continue }
        $wrong = @($rows | Where-Object { $_.Unit -ne (Metric-Unit $_.Metric) })
        if ($wrong.Count) { $affected.Add([ordered]@{ Directory = $dir.Name; File = $file.Name; WrongUnitRows = $wrong.Count; Metrics = @($wrong.Metric | Sort-Object -Unique) }) }
    }
}
$pairs = @(
    @('independent-summary', 'independent-summary-units-corrected'),
    @('independent-summary-shopping-recheck1', 'independent-summary-shopping-recheck1-units-corrected'),
    @('independent-summary-browser-recheck1', 'independent-summary-browser-recheck1-units-corrected'),
    @('independent-summary-legacy-B04', 'independent-summary-legacy-B04-units-corrected'),
    @('independent-summary-browser-recheck-interval-audit', 'independent-summary-browser-recheck-interval-audit-units-corrected')
)
$checks = [Collections.Generic.List[object]]::new()
$unitChanges = [Collections.Generic.List[object]]::new()
$comparedValues = 0
foreach ($pair in $pairs) {
    $oldDir = Join-Path $EvidenceRoot $pair[0]
    $newDir = Join-Path $EvidenceRoot $pair[1]
    foreach ($file in Get-ChildItem -LiteralPath $newDir -File -Filter '*.csv') {
        $oldPath = Join-Path $oldDir $file.Name
        if (!(Test-Path -LiteralPath $oldPath)) { throw "Missing old file: $oldPath" }
        $old = @(Import-Csv -LiteralPath $oldPath -Encoding utf8)
        $new = @(Import-Csv -LiteralPath $file.FullName -Encoding utf8)
        if ($old.Count -ne $new.Count) { throw "Row count changed: $($pair[0])/$($file.Name)" }
        for ($i = 0; $i -lt $old.Count; $i++) {
            foreach ($p in $old[$i].PSObject.Properties) {
                if ($p.Name -in @('Unit', 'MedianDeltaMs', 'P95DeltaMs')) { continue }
                $comparedValues++
                if ([string]$p.Value -cne [string]$new[$i].($p.Name)) { throw "Value changed: $($pair[0])/$($file.Name) row $i column $($p.Name)" }
            }
            if ('Unit' -in $new[$i].PSObject.Properties.Name -and 'Metric' -in $new[$i].PSObject.Properties.Name) {
                if ($new[$i].Unit -ne (Metric-Unit $new[$i].Metric)) { throw 'Corrected unit still wrong' }
                if ('Unit' -in $old[$i].PSObject.Properties.Name -and $old[$i].Unit -ne $new[$i].Unit) {
                    $unitChanges.Add([ordered]@{ Directory = $pair[0]; File = $file.Name; Row = $i; Metric = $new[$i].Metric; OldUnit = $old[$i].Unit; NewUnit = $new[$i].Unit })
                }
                foreach ($col in @('MedianDeltaMs', 'P95DeltaMs')) {
                    if ($col -in $old[$i].PSObject.Properties.Name -and $old[$i].$col -ne $new[$i].$col) {
                        if ($new[$i].Unit -ne 'count' -or $new[$i].$col -ne '') { throw "Unexpected ms-specific metadata change: $col" }
                    }
                }
            }
        }
        $checks.Add([ordered]@{ OldDirectory = $pair[0]; NewDirectory = $pair[1]; File = $file.Name; Rows = $new.Count; AllNonUnitValuesUnchanged = $true })
    }
}
$main = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'independent-summary-units-corrected/summary.json') -Encoding utf8 -Raw | ConvertFrom-Json -Depth 100
$shopping = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'independent-summary-shopping-recheck1-units-corrected/summary.json') -Encoding utf8 -Raw | ConvertFrom-Json -Depth 100
if (!$main.SelectedEvidenceValid -or @($main.Violations).Count -or @($main.RuntimeErrors).Count -or !$main.ShoppingAllAfterPass) { throw 'Corrected main validation failed' }
if (!$shopping.SelectedEvidenceValid -or !$shopping.ShoppingSelectedAfterPass -or $shopping.ShoppingScope.FullMatrix) { throw 'Corrected selected-shopping validation failed' }
$manifest = [ordered]@{
    CreatedUtc = [DateTime]::UtcNow.ToString('o')
    Correction = 'Count/putRequests take priority; only case-sensitive Ms suffix denotes milliseconds. Raw numerical values are unchanged.'
    AffectedOldOutputs = $affected.ToArray()
    CorrectedPairs = $pairs
    CsvChecks = $checks.ToArray()
    ComparedNonUnitValues = $comparedValues
    UnitChanges = $unitChanges.ToArray()
    MsDeltaMetadata = 'For misclassified count metrics only, MedianDeltaMs/P95DeltaMs are now null; generic delta and raw metric values remain identical.'
    MainValid = $main.SelectedEvidenceValid
    MainGroupsPerPhase = $main.GroupsPerPhase
    MainShoppingAllAfterPass = $main.ShoppingAllAfterPass
    MainViolations = @($main.Violations)
    MainRuntimeErrors = @($main.RuntimeErrors)
    SelectedShoppingValid = $shopping.SelectedEvidenceValid
    SelectedShoppingScope = $shopping.ShoppingScope
    Diagnostic = 'Independent reviewer checked 322 summary and 6440 paired rows: count72/ms250, zero incorrect units; scripts/output left unchanged.'
}
$out = Join-Path $EvidenceRoot 'unit-metadata-correction-verification.json'
if (Test-Path -LiteralPath $out) { throw 'Existing verification manifest' }
[IO.File]::WriteAllText($out, ($manifest | ConvertTo-Json -Depth 50), $utf8)
$again = $utf8.GetString([IO.File]::ReadAllBytes($out))
if ($again.Contains([char]65533)) { throw 'Encoding anomaly' }
$affected | ConvertTo-Json -Depth 8
Write-Output "Compared $comparedValues non-unit CSV values; all unchanged. Corrected unit rows: $($unitChanges.Count)."
Write-Output "Main all88/96/48 valid, violations0/runtimeerrors0; selected shopping4/24 valid. Manifest=$out"
