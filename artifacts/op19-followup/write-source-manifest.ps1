[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$original = 'D:\event-shopping-planner-routeplanning-1.9.6.7'
$paths = @(@(git diff --name-only --diff-filter=ACM -- src tests docs) + @(git ls-files --others --exclude-standard -- src tests docs)) | Sort-Object -Unique
$files = @(foreach ($path in $paths) {
  $absolute = Join-Path (Get-Location) $path
  $bytes = [IO.File]::ReadAllBytes($absolute)
  $value = [Text.UTF8Encoding]::new($false,$true).GetString($bytes)
  $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
  $replacement = ([regex]::Matches($value,[char]0xfffd)).Count
  if ($bom -or $replacement -or $value.Contains("`r")) { throw "Encoding anomaly: $path" }
  $previous = Join-Path $original $path
  [pscustomobject]@{
    Path=$path; SHA256=(Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash
    OriginalSHA256=if(Test-Path -LiteralPath $previous){(Get-FileHash -LiteralPath $previous -Algorithm SHA256).Hash}else{$null}
    Bytes=$bytes.Length; Encoding='UTF-8'; BOM=$bom; CRLF=0; LF=([regex]::Matches($value,"`n")).Count
    Replacement=$replacement; Questions=([regex]::Matches($value,'\?')).Count
  }
})
$manifest = [ordered]@{ Date='2026-10-19'; BaseCommit=(git rev-parse HEAD); ModifiedBundleSHA256=(Get-FileHash -LiteralPath dist/assets/release-role.js -Algorithm SHA256).Hash; Files=$files }
$json=($manifest|ConvertTo-Json -Depth 20).Replace("`r`n","`n")+"`n"
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'final-source-manifest.json'),$json,[Text.UTF8Encoding]::new($false))
[pscustomobject]@{Files=$files.Count;BundleSHA256=$manifest.ModifiedBundleSHA256;EncodingAnomalies=0}|ConvertTo-Json
