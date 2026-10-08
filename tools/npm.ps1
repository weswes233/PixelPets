param([Parameter(ValueFromRemainingArguments=$true)][string[]]$NpmArguments)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js 24 or newer is required.' }
$npmCli = Join-Path $projectRoot 'runtime\npm\package\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli)) { throw 'Run tools/bootstrap_npm.py first, or use your installed npm.' }
& $nodeCommand.Source $npmCli @NpmArguments
exit $LASTEXITCODE
