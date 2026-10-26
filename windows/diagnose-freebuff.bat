@echo off
setlocal EnableExtensions
title CyrusAsha_UniversalRTL 1.0.0 - Freebuff Diagnostics

echo.
echo  ================================================
echo   Freebuff RTL diagnostics - CyrusAsha_UniversalRTL 1.0.0
echo  ================================================
echo.
echo  First apply the latest patch with Freebuff fully closed.
echo  This launcher waits until you close Freebuff.
echo.

set "APP_EXE=%~1"
if not defined APP_EXE (
  for %%P in (
    "%LOCALAPPDATA%\Programs\Freebuff\Freebuff.exe"
    "%LOCALAPPDATA%\Programs\freebuff-desktop\Freebuff.exe"
    "%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop\Freebuff.exe"
    "%LOCALAPPDATA%\Programs\@codebuff\freebuff-desktop\Freebuff.exe"
    "%LOCALAPPDATA%\Programs\@codebuff\Freebuff.exe"
    "%ProgramFiles%\Freebuff\Freebuff.exe"
    "%ProgramFiles(x86)%\Freebuff\Freebuff.exe"
  ) do (
    if not defined APP_EXE if exist "%%~P" set "APP_EXE=%%~P"
  )
)

if not defined APP_EXE (
  echo  Could not auto-detect Freebuff.
  echo  Paste the full path to Freebuff.exe below. Quotes are optional.
  set /p "APP_EXE=Freebuff.exe path: "
)
set "APP_EXE=%APP_EXE:"=%"
if not exist "%APP_EXE%" (
  echo.
  echo  ERROR: File not found:
  echo  %APP_EXE%
  pause
  exit /b 2
)
for %%I in ("%APP_EXE%") do set "APP_EXE=%%~fI"
for %%I in ("%APP_EXE%") do set "APP_NAME=%%~nxI"

tasklist /FI "IMAGENAME eq %APP_NAME%" 2>nul | find /I "%APP_NAME%" >nul
if not errorlevel 1 (
  echo.
  echo  ERROR: Freebuff is already running. Close every Freebuff window,
  echo         then run this launcher again.
  pause
  exit /b 3
)

set "DIAG_FILE=%TEMP%\CyrusAsha_UniversalRTL-Freebuff-runtime.jsonl"
if exist "%DIAG_FILE%" del /q "%DIAG_FILE%" >nul 2>&1
set "RTL_UNIVERSAL_DIAGNOSTICS=1"
set "RTL_UNIVERSAL_DIAGNOSTICS_PATH=%DIAG_FILE%"

echo.
echo  Launching: %APP_EXE%
echo  Reproduce the RTL issue, then quit Freebuff normally.
echo.
start "" /wait "%APP_EXE%"

echo.
if exist "%DIAG_FILE%" (
  echo  Diagnostic log:
  echo  %DIAG_FILE%
  echo  The log contains runtime status and counts only, not chat text.
  start "" notepad.exe "%DIAG_FILE%"
) else (
  echo  No log was created. The new patch may not be installed or loaded.
)
echo.
pause
