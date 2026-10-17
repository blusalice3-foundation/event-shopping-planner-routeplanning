function Read-Source([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes((Join-Path $PWD $Path))
  $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
  $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
  Write-Host ($Path + ': UTF-8; BOM=' + $bom + '; CRLF=' + [regex]::Matches($text,"`r`n").Count + '; LF=' + [regex]::Matches($text,"(?<!`r)`n").Count)
  return $text
}
function Write-Source([string]$Path, [string]$Text) {
  $absolute = Join-Path $PWD $Path
  $bom = $false
  if (Test-Path -LiteralPath $absolute) {
    $bytes = [IO.File]::ReadAllBytes($absolute)
    $old = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
    if ($old.Contains("`r`n") -and [regex]::Matches($old,"(?<!`r)`n").Count -eq 0) { $Text = $Text.Replace("`r`n","`n").Replace("`n","`r`n") }
    elseif (-not $old.Contains("`r`n")) { $Text = $Text.Replace("`r`n","`n") }
  } else { $Text = $Text.Replace("`r`n","`n") }
  if ($Text.Contains([string][char]0xFFFD)) { throw "Replacement character detected: $Path" }
  [IO.File]::WriteAllText($absolute, $Text, [Text.UTF8Encoding]::new($bom))
  $saved = [Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($absolute))
  if ($saved.TrimStart([char]0xFEFF) -cne $Text.TrimStart([char]0xFEFF)) { throw "Readback mismatch: $Path" }
}
function Replace-Source([string]$Path, [string]$Old, [string]$New) {
  $text = Read-Source $Path
  $normalized = $text.Replace("`r`n","`n")
  $Old = $Old.Replace("`r`n","`n")
  $New = $New.Replace("`r`n","`n")
  if (-not $normalized.Contains($Old)) { throw "Replacement target missing: $Path" }
  Write-Source $Path ($normalized.Replace($Old, $New))
}