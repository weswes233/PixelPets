$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$record = Join-Path $projectRoot 'runtime\processes.json'
if (-not (Test-Path -LiteralPath $record)) { Write-Host 'No saved PixelPets processes.'; exit 0 }
$services = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
foreach ($service in $services) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($service.Pid)" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($projectRoot) -and $process.Name -eq 'node.exe') { Stop-Process -Id $service.Pid }
}
Write-Host 'Stopped the recorded PixelPets local services.'
