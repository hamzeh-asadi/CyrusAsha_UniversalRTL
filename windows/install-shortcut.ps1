# CyrusAsha_UniversalRTL-1.0.0 - create a Desktop shortcut for the Control Panel
# Usage (PowerShell):  .\install-shortcut.ps1
# This file is ASCII-only on purpose: Windows PowerShell 5.1 reads
# UTF-8 files without a BOM as ANSI, which breaks non-ASCII text.
param(
  [string]$Name = "CyrusAsha_UniversalRTL-1.0.0",
  [string]$Port = "4477"
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$target = Join-Path $here "start-gui.bat"

if (-not (Test-Path $target)) {
  Write-Error "start-gui.bat not found in: $target"
}

# Icon: convert the extension PNG to ICO (no external modules needed)
$png = Join-Path $root "assets\CyrusAsha_UniversalRTL-logo.png"; if (-not (Test-Path $png)) { $png = Join-Path $root "vscode-extension\media\icon.png" }
$ico = Join-Path $here "icon.ico"
if ((Test-Path $png) -and (-not (Test-Path $ico))) {
  try {
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile($png)
    $bmp = New-Object System.Drawing.Bitmap($img, 256, 256)
    $iconHandle = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
    $stream = [System.IO.File]::Create($ico)
    $icon.Save($stream)
    $stream.Close()
    $img.Dispose()
    $bmp.Dispose()
    Write-Host "Icon created: $ico"
  } catch {
    Write-Host "Could not create the icon (continuing without it)."
  }
}

$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "$Name.lnk"
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $target
$lnk.WorkingDirectory = $root
$lnk.WindowStyle = 7
$lnk.Description = "CyrusAsha_UniversalRTL-1.0.0 - smart RTL for AI agent environments"
if (Test-Path $ico) { $lnk.IconLocation = $ico }
$lnk.Save()

Write-Host ""
Write-Host "Desktop shortcut created: $lnkPath"
Write-Host "Default port: $Port"
Write-Host ""
