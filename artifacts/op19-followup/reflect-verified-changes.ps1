[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$originalRoot = [IO.Path]::GetFullPath('D:\event-shopping-planner-routeplanning-1.9.6.7')
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'final-source-manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
$preservation = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'preservation-before.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ((git -C $originalRoot rev-parse HEAD) -ne $manifest.BaseCommit) { throw 'Original HEAD changed' }
git -C $originalRoot diff --quiet HEAD --
if ($LASTEXITCODE -ne 0) { throw 'Original tracked changes appeared; refusing automatic overwrite' }
foreach ($entry in $preservation) {
  if ((Get-FileHash -LiteralPath $entry.Path -Algorithm SHA256).Hash -ne $entry.Hash) { throw "Preserved file changed: $($entry.Path)" }
}
foreach ($entry in $manifest.Files) {
  $from = Join-Path $taskRoot $entry.Path
  $to = [IO.Path]::GetFullPath((Join-Path $originalRoot $entry.Path))
  if (!$to.StartsWith($originalRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Target escapes workspace' }
  if ((Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash -ne $entry.SHA256) { throw "Tested file changed: $($entry.Path)" }
  if ($entry.OriginalSHA256) {
    if ((Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash -ne $entry.OriginalSHA256) { throw "Original source changed: $($entry.Path)" }
  } elseif (Test-Path -LiteralPath $to) { throw "New target already exists: $($entry.Path)" }
}
foreach ($name in @('op19-followup','op04-before')) {
  if (Test-Path -LiteralPath (Join-Path $originalRoot "artifacts/$name")) { throw "Artifact target already exists: $name" }
}
foreach ($entry in $manifest.Files) {
  $to = Join-Path $originalRoot $entry.Path
  [void](New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force)
  Copy-Item -LiteralPath (Join-Path $taskRoot $entry.Path) -Destination $to
}
foreach ($name in @('op19-followup','op04-before')) {
  Copy-Item -LiteralPath (Join-Path $taskRoot "artifacts/$name") -Destination (Join-Path $originalRoot 'artifacts') -Recurse
}
$sourceChecks = @(foreach ($entry in $manifest.Files) {
  $actual = (Get-FileHash -LiteralPath (Join-Path $originalRoot $entry.Path) -Algorithm SHA256).Hash
  [pscustomobject]@{Path=$entry.Path;SHA256=$actual;Match=($actual -eq $entry.SHA256)}
})
$artifactChecks = @(foreach ($name in @('op19-followup','op04-before')) {
  $folder = Join-Path $taskRoot "artifacts/$name"
  foreach ($file in (Get-ChildItem -LiteralPath $folder -File -Recurse -Force)) {
    $relative = [IO.Path]::GetRelativePath($taskRoot,$file.FullName)
    $expected = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    $actual = (Get-FileHash -LiteralPath (Join-Path $originalRoot $relative) -Algorithm SHA256).Hash
    [pscustomobject]@{Path=$relative;Match=($expected -eq $actual)}
  }
})
$preservedChecks = @(foreach ($entry in $preservation) {
  [pscustomobject]@{Path=$entry.Path;Match=((Get-FileHash -LiteralPath $entry.Path -Algorithm SHA256).Hash -eq $entry.Hash)}
})
if (@($sourceChecks+$artifactChecks+$preservedChecks|Where-Object Match -eq $false).Count) { throw 'Post-copy hash mismatch' }
$result=[ordered]@{Date='2026-10-19';SourceFiles=$sourceChecks.Count;ArtifactFiles=$artifactChecks.Count;PreservedFiles=$preservedChecks.Count;Mismatches=0;SourceChecks=$sourceChecks;ArtifactChecks=$artifactChecks;PreservedChecks=$preservedChecks}
$json=($result|ConvertTo-Json -Depth 20).Replace("`r`n","`n")+"`n"
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'copy-verification.json'),$json,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $originalRoot 'artifacts/op19-followup/copy-verification.json'),$json,[Text.UTF8Encoding]::new($false))
[pscustomobject]@{SourceFiles=$sourceChecks.Count;ArtifactFiles=$artifactChecks.Count;PreservedFiles=$preservedChecks.Count;Mismatches=0}|ConvertTo-Json
