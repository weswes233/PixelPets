<#
.SYNOPSIS
Build release exports with Godot 4.5.2 and templates for the selected target only.
.DESCRIPTION
Install matching templates through Godot's Manage Export Templates, or place release
templates in PixelPets/runtime. Optional overrides:
  PIXELPETS_GODOT_PATH       Full path to the Godot 4.5.2 executable.
  PIXELPETS_GODOT_TEMPLATES  Directory containing extracted 4.5.2 release templates.
The explicit template directory overrides discovery; otherwise runtime, the standard
Godot 4.5.2.stable template directory, and the old sibling project are searched in order.
No debug template is needed. -ValidateOnly checks the engine and selected template paths
without copying templates, changing presets, importing, or exporting the game.
#>
param([ValidateSet('Web','Windows','All')][string]$Target = 'All', [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$gamePath = Join-Path $projectRoot 'game'
$godotPath = $env:PIXELPETS_GODOT_PATH
if ($godotPath) {
    if (-not (Test-Path -LiteralPath $godotPath -PathType Leaf)) { throw 'PIXELPETS_GODOT_PATH must point to the Godot 4.5.2 executable.' }
    $godotPath = (Resolve-Path -LiteralPath $godotPath).Path
} else {
    $godotCommand = Get-Command Godot_v4.5.2-stable_win64_console.exe -ErrorAction SilentlyContinue
    if (-not $godotCommand) { $godotCommand = Get-Command godot -ErrorAction SilentlyContinue }
    if (-not $godotCommand) { throw 'Godot 4.5.2 is required. Set PIXELPETS_GODOT_PATH to its executable, or add it to PATH.' }
    $godotPath = $godotCommand.Source
}
$engineVersion = (& $godotPath --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $engineVersion -notmatch '^4\.5\.2\.stable(?:\.|$)') {
    throw "Godot 4.5.2.stable is required; selected engine reports '$engineVersion'. Set PIXELPETS_GODOT_PATH to the matching executable."
}
$runtimePath = Join-Path $projectRoot 'runtime'
$legacyTemplates = Join-Path (Split-Path -Parent $projectRoot) 'Oddsprout\runtime'
$templateDirectories = @()
if ($env:PIXELPETS_GODOT_TEMPLATES) {
    if (-not (Test-Path -LiteralPath $env:PIXELPETS_GODOT_TEMPLATES -PathType Container)) {
        throw 'PIXELPETS_GODOT_TEMPLATES must be a directory containing the extracted Godot 4.5.2 templates (not a .tpz archive).'
    }
    $templateDirectories += (Resolve-Path -LiteralPath $env:PIXELPETS_GODOT_TEMPLATES).Path
} else {
    $templateDirectories += $runtimePath
    if ($env:APPDATA) { $templateDirectories += Join-Path $env:APPDATA 'Godot/export_templates/4.5.2.stable' }
    if ($env:XDG_DATA_HOME) { $templateDirectories += Join-Path $env:XDG_DATA_HOME 'godot/export_templates/4.5.2.stable' }
    $profilePath = [Environment]::GetFolderPath('UserProfile')
    if ($profilePath) {
        $templateDirectories += Join-Path $profilePath '.local/share/godot/export_templates/4.5.2.stable'
        $templateDirectories += Join-Path $profilePath 'Library/Application Support/Godot/export_templates/4.5.2.stable'
    }
    $templateDirectories += Join-Path (Split-Path -Parent $godotPath) 'editor_data/export_templates/4.5.2.stable'
    $templateDirectories += $legacyTemplates
}
$requiredTemplates = @()
if ($Target -in @('All','Web')) { $requiredTemplates += 'web_nothreads_release.zip' }
if ($Target -in @('All','Windows')) { $requiredTemplates += 'windows_release_x86_64.exe' }
function Assert-TemplateVersion([string]$TemplateName, [string]$TemplatePath) {
    if ($TemplateName -eq 'windows_release_x86_64.exe') {
        $templateVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($TemplatePath).ProductVersion
        if ($templateVersion -notmatch '^4\.5\.2\.stable(?:\.|$)') {
            throw "Windows release template must be Godot 4.5.2.stable; '$TemplatePath' reports '$templateVersion'."
        }
        return
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($TemplatePath)
    try {
        $wasm = $archive.GetEntry('godot.wasm')
        if (-not $wasm -or $wasm.Length -lt 1000000 -or $wasm.Length -gt 134217728 -or -not $archive.GetEntry('godot.js') -or -not $archive.GetEntry('godot.html')) {
            throw "Invalid Godot Web release archive: $TemplatePath"
        }
        $stream = $wasm.Open()
        $buffer = [IO.MemoryStream]::new()
        try {
            $stream.CopyTo($buffer)
            $bytes = $buffer.ToArray()
            $wasmText = [Text.Encoding]::ASCII.GetString($bytes)
            if ($bytes[0] -ne 0 -or $bytes[1] -ne 97 -or $bytes[2] -ne 115 -or $bytes[3] -ne 109 -or -not $wasmText.Contains('Godot Engine v4.5.2.stable.')) {
                throw "Web release template must contain a Godot 4.5.2.stable Wasm binary: $TemplatePath"
            }
        } finally { $stream.Dispose(); $buffer.Dispose() }
    } finally { $archive.Dispose() }
}
$resolvedTemplates = @{}
foreach ($template in $requiredTemplates) {
    $source = $null
    foreach ($directory in $templateDirectories) {
        $candidate = Join-Path $directory $template
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $source = (Resolve-Path -LiteralPath $candidate).Path; break }
    }
    if (-not $source) {
        throw "Missing release template '$template' for $Target. Install Godot 4.5.2 templates with Manage Export Templates, place it in '$runtimePath', or set PIXELPETS_GODOT_TEMPLATES. Searched: $($templateDirectories -join ', ')"
    }
    if ((Get-Item -LiteralPath $source).Length -lt 1000000) { throw "Invalid or incomplete template: $source" }
    Assert-TemplateVersion $template $source
    $resolvedTemplates[$template] = $source
    Write-Host "Release template: $template <- $source"
}
if ($ValidateOnly) {
    Write-Host "Validated $Target release prerequisites with Godot $engineVersion. No project files changed."
    return
}
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
foreach ($template in $requiredTemplates) {
    $destination = Join-Path $runtimePath $template
    if ([IO.Path]::GetFullPath($resolvedTemplates[$template]) -ne [IO.Path]::GetFullPath($destination)) {
        Copy-Item -LiteralPath $resolvedTemplates[$template] -Destination $destination -Force
    }
}
$presets = @'
[preset.0]
name="Web"
platform="Web"
runnable=true
export_filter="all_resources"
include_filter="*.json,*.txt"
exclude_filter="tests/*"
export_path="../dist/web/index.html"
[preset.0.options]
custom_template/debug=""
custom_template/release="../runtime/web_nothreads_release.zip"
variant/extensions_support=false
variant/thread_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=false
html/canvas_resize_policy=2
html/focus_canvas_on_start=true
html/experimental_virtual_keyboard=true
progressive_web_app/enabled=false

[preset.1]
name="Windows Desktop"
platform="Windows Desktop"
runnable=true
export_filter="all_resources"
include_filter="*.json,*.txt"
exclude_filter="tests/*"
export_path="../dist/windows/PixelPets.exe"
[preset.1.options]
custom_template/debug=""
custom_template/release="../runtime/windows_release_x86_64.exe"
binary_format/embed_pck=true
texture_format/s3tc_bptc=true
codesign/enable=false
application/modify_resources=false
'@
Set-Content -LiteralPath (Join-Path $gamePath 'export_presets.cfg') -Value $presets -Encoding utf8
& node (Join-Path $PSScriptRoot 'build-codex.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Codex generation failed.' }
function Invoke-GodotChecked([string[]]$GodotArguments) {
    $diagnostics = & $godotPath @GodotArguments 2>&1
    $engineExit = $LASTEXITCODE
    $diagnostics | ForEach-Object { Write-Host $_ }
    if ($engineExit -ne 0 -or ($diagnostics | Out-String) -match '(?m)^(SCRIPT ERROR|ERROR):') {
        throw 'Godot reported a build error. The export is not ready to release.'
    }
}
Invoke-GodotChecked -GodotArguments @('--headless', '--path', $gamePath, '--editor', '--import')
if ($Target -in @('All','Web')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'dist\web') | Out-Null
    Invoke-GodotChecked -GodotArguments @('--headless', '--path', $gamePath, '--export-release', 'Web', (Join-Path $projectRoot 'dist\web\index.html'))
    & node (Join-Path $PSScriptRoot 'build-web.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Wallet bundle failed.' }
}
if ($Target -in @('All','Windows')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'dist\windows') | Out-Null
    Invoke-GodotChecked -GodotArguments @('--headless', '--path', $gamePath, '--export-release', 'Windows Desktop', (Join-Path $projectRoot 'dist\windows\PixelPets.exe'))
}
Write-Host 'PixelPets build completed. Run tools/start.ps1 for the local services.'
