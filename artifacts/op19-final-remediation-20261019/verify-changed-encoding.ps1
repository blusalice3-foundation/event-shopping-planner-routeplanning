[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference='Stop'
$paths=@(git diff --name-only) + @(git ls-files --others --exclude-standard -- tests/browser/modal-late-save-failure.spec.ts)
$rows=@()
foreach($path in $paths){
 $bytes=[IO.File]::ReadAllBytes((Join-Path (Get-Location) $path));$s=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
 $original=Join-Path 'D:\event-shopping-planner-routeplanning-1.9.6.7' $path
 $before='';$beforeBom=$false;$beforeCRLF=0
 if(Test-Path -LiteralPath $original){$beforeBytes=[IO.File]::ReadAllBytes($original);$before=[Text.UTF8Encoding]::new($false,$true).GetString($beforeBytes);$beforeBom=$beforeBytes.Length -ge 3 -and $beforeBytes[0] -eq 239 -and $beforeBytes[1] -eq 187 -and $beforeBytes[2] -eq 191;$beforeCRLF=[regex]::Matches($before,"`r`n").Count}
 $bom=$bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
 $row=[pscustomobject]@{path=$path;sha256=(Get-FileHash -LiteralPath (Join-Path (Get-Location) $path) -Algorithm SHA256).Hash;encoding='strict UTF-8';BOM=$bom;BOMBefore=$beforeBom;CRLF=[regex]::Matches($s,"`r`n").Count;LF=[regex]::Matches($s,'(?<!\r)\n').Count;ReplacementCharacters=[regex]::Matches($s,[string][char]0xfffd).Count;QuestionMarkDelta=([regex]::Matches($s,'\?').Count-[regex]::Matches($before,'\?').Count);RegistrationBefore=[regex]::Matches($before,'ユーザー登録').Count;RegistrationAfter=[regex]::Matches($s,'ユーザー登録').Count;ErrorBefore=[regex]::Matches($before,'エラーが発生しました').Count;ErrorAfter=[regex]::Matches($s,'エラーが発生しました').Count}
 if($row.ReplacementCharacters -or $bom -ne $beforeBom -or $row.CRLF -ne $beforeCRLF -or $row.RegistrationAfter -lt $row.RegistrationBefore -or $row.ErrorAfter -lt $row.ErrorBefore){throw "Encoding anomaly $path"}
 $rows+=$row
}
[IO.File]::WriteAllText('D:\espfix-evidence-261019\encoding.json',($rows|ConvertTo-Json -Depth 4).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText('D:\espfix-evidence-261019\final-source-manifest.json',($rows|Select-Object path,sha256|ConvertTo-Json -Depth 4).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
Write-Output "Encoding verified $($rows.Count) files; U+FFFD=0, BOM and EOL preserved; representative strings preserved"
git diff --check
