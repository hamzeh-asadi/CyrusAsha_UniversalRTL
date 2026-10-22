@echo off
setlocal
chcp 65001 >nul
title CyrusAsha_UniversalRTL-1.0.0 - Electron Patcher
pushd "%~dp0.."
if errorlevel 1 goto :bad_dir

echo.
echo  ==========================================
echo    CyrusAsha_UniversalRTL-1.0.0 - Electron Patcher
echo  ==========================================
echo.

if not exist "%~dp0..\src\patcher\patch-electron.js" goto :bad_layout

where node >nul 2>nul
if errorlevel 1 goto :no_node

echo  Tip: close the target app completely before patching.
echo.
node "%~dp0..\src\patcher\patch-electron.js" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
popd
pause
exit /b %EXITCODE%

:no_node
echo  Node.js was not found on this computer.
echo.
echo  Option 1 (easiest, no Node.js needed):
echo      use the control panel of the portable build instead
echo      (it can patch and unpatch apps with one click):
echo      release\windows\CyrusAsha_UniversalRTL-*-win-x64.zip
echo.
echo  Option 2: install Node.js LTS from
echo      https://nodejs.org/en/download
echo  then run this file again.
echo.
popd
pause
exit /b 1

:bad_layout
echo  This launcher must stay inside the project folder.
echo  Expected file not found:
echo      %~dp0..\src\patcher\patch-electron.js
echo.
popd
pause
exit /b 1

:bad_dir
echo  Could not open the project folder: %~dp0..
echo.
pause
exit /b 1
