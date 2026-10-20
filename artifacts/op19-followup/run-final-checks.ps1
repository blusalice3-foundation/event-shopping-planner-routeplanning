[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$log = Join-Path $PSScriptRoot 'quality-final.log'
[IO.File]::WriteAllText($log, '', [Text.UTF8Encoding]::new($false))
foreach ($check in @('typecheck','verify:architecture','verify:test-project-membership','verify:db-compatibility','verify:performance-policy','test:encoding','test:api')) {
  & npm run $check 2>&1 | Tee-Object -FilePath $log -Append -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Failed check: $check" }
}
$tracked = @(git diff --name-only --diff-filter=ACM -- src tests docs)
$new = @(git ls-files --others --exclude-standard -- src tests docs)
$files = @(@($tracked + $new) | Sort-Object -Unique | Where-Object { $_ -match '\.(ts|tsx)$' })
& npx prettier --check @files 2>&1 | Tee-Object -FilePath $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Changed files Prettier failed' }
$source = @($files | Where-Object { $_ -match '\.tsx?$' })
& npx eslint @source --max-warnings 0 2>&1 | Tee-Object -FilePath $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Changed TypeScript ESLint failed' }
git diff --check 2>&1 | Tee-Object -FilePath $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Diff check failed' }
# The new results document is formatted and checked separately after final counts are known.
