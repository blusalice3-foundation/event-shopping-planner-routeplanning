[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference='Stop'
$records=@()
foreach($name in @('test:encoding','typecheck','verify:architecture','verify:test-project-membership','verify:db-compatibility','verify:dependency-usage','test:api')){
 Write-Output "CHECK $name"
 $output = & npm run $name 2>&1
 $code=$LASTEXITCODE
 $output | Out-File -LiteralPath ("D:\espfix-evidence-261019\"+$name.Replace(':','-')+'.log') -Encoding utf8
 $records += [pscustomobject]@{check=$name;exitCode=$code}
 Write-Output "exit=$code"
 if($code -ne 0){$output | Select-Object -Last 30;throw "check failed $name"}
}
$changed=@(git diff --name-only -- '*.ts' '*.tsx') + @(git ls-files --others --exclude-standard -- '*.ts' '*.tsx')
foreach($tool in @('prettier','eslint')){
 if($tool -eq 'prettier'){$output=& npx prettier --check @changed 2>&1}else{$output=& npx eslint --max-warnings 0 @changed 2>&1}
 $code=$LASTEXITCODE
 $output | Out-File -LiteralPath ("D:\espfix-evidence-261019\"+$tool+'.log') -Encoding utf8
 $records += [pscustomobject]@{check=$tool;exitCode=$code}
 Write-Output "$tool exit=$code";if($code -ne 0){$output;throw "$tool failed"}
}
[IO.File]::WriteAllText('D:\espfix-evidence-261019\quality.json',($records|ConvertTo-Json -Depth 5).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
