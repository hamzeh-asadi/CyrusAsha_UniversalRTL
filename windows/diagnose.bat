@echo off
setlocal
title CyrusAsha_UniversalRTL-1.0.0 - Diagnostics
chcp 65001 >nul
pushd "%~dp0.." 2>nul

echo.
echo  ==========================================
echo    CyrusAsha_UniversalRTL-1.0.0 - Diagnostics
echo  ==========================================
echo.
echo  Project folder : %CD%
echo  Launcher       : %~f0
echo.

echo  [1] Checking required files
for %%F in (
  "src\gui\server.js"
  "src\patcher\patch-electron.js"
  "src\engine\rtl-engine.js"
  "src\gui\public\index.html"
  "vscode-extension\package.json"
  "release\rtl-universal-*.vsix"
) do (
  if exist "%%~F" (echo      OK      %%~F) else (echo      MISSING %%~F)
)
echo.

echo  [2] Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo      Node.js is NOT installed - use the portable build instead.
) else (
  for /f "delims=" %%V in ('node --version') do echo      Node.js %%V
  echo      Path: 
  where node
)
echo.

echo  [3] Port 4477
netstat -ano | findstr ":4477" >nul 2>nul
if errorlevel 1 (echo      Free) else (echo      IN USE - the panel will pick the next free port)
echo.

echo  [4] How to run
echo      Control panel : windows\start-gui.bat
echo      Patcher       : windows\patch.bat --list
echo.
popd
pause
