@echo off
setlocal EnableDelayedExpansion
title Install KovaaK's stats
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem One-time setup. Nothing here is required to RUN the app - start.bat works on
rem its own. This just makes it launchable like a normal program: it finds or
rem installs Python, then puts shortcuts on the Desktop and in the Start Menu.
rem
rem Deliberately not an .exe: this app is a few hundred KB of Python and static
rem HTML with no dependencies, and a packaged installer would be a bigger,
rem more opaque artefact than the thing it installs.
rem ---------------------------------------------------------------------------

echo.
echo   KovaaK's stats - setup
echo   ============================================
echo.

if not exist "server.py" (
  echo   [X] server.py is missing.
  echo       Keep install.bat in the same folder as server.py and the app folder.
  echo.
  pause
  exit /b 1
)

rem --- 1. Python -------------------------------------------------------------
rem Every candidate is actually executed before being accepted. That also
rem filters out the Microsoft Store placeholder python.exe, which exists on a
rem clean Windows install and does nothing but open the Store.
set "PY="
set "VERCHECK=import sys; sys.exit(0 if sys.version_info>=(3,7) else 1)"

py -3 -c "%VERCHECK%" >nul 2>&1 && set "PY=py -3"
if not defined PY python -c "%VERCHECK%" >nul 2>&1 && set "PY=python"

if not defined PY (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*" "%ProgramFiles%\Python3*" "%ProgramFiles(x86)%\Python3*" "C:\Python3*") do (
    if not defined PY if exist "%%D\python.exe" (
      "%%D\python.exe" -c "%VERCHECK%" >nul 2>&1 && set PY="%%D\python.exe"
    )
  )
)

if not defined PY (
  echo   Python 3.7+ was not found on this PC. It is the only requirement -
  echo   there are no packages to install afterwards.
  echo.
  where winget >nul 2>&1
  if errorlevel 1 (
    echo   Install it once from:  https://www.python.org/downloads/
    echo   On the first screen, tick "Add Python to PATH", then run this again.
    echo.
    pause
    exit /b 1
  )
  choice /c YN /n /m "   Install Python now with winget? [Y/N] "
  if errorlevel 2 (
    echo.
    echo   No problem. Install it from https://www.python.org/downloads/
    echo   ^(tick "Add Python to PATH"^) and run this again.
    echo.
    pause
    exit /b 1
  )
  echo.
  echo   Installing Python. This can take a couple of minutes...
  winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
  echo.
  echo   Python installed. Close this window, open a NEW one, and run
  echo   install.bat again so Windows picks up the new PATH.
  echo.
  pause
  exit /b 0
)

echo   [OK] Python found.

rem --- 2. Shortcuts ----------------------------------------------------------
rem Written via PowerShell + WScript.Shell, which is present on every Windows
rem install. A .lnk cannot be created from batch alone.
set "TARGET=%~dp0start.bat"
set "ICONSRC=%SystemRoot%\System32\SHELL32.dll"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"

echo   [..] Creating shortcuts

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in @('%DESKTOP%','%STARTMENU%')) {" ^
  "  if (-not (Test-Path $dir)) { continue }" ^
  "  $lnk = $ws.CreateShortcut((Join-Path $dir \"KovaaK's stats.lnk\"));" ^
  "  $lnk.TargetPath = '%TARGET%';" ^
  "  $lnk.WorkingDirectory = '%~dp0';" ^
  "  $lnk.IconLocation = '%ICONSRC%,13';" ^
  "  $lnk.Description = 'See how your floor moves, not just your ceiling';" ^
  "  $lnk.Save() }" >nul 2>&1

if exist "%DESKTOP%\KovaaK's stats.lnk" (
  echo   [OK] Desktop shortcut created.
) else (
  echo   [!!] Could not create the Desktop shortcut. Not a problem -
  echo        you can start the app any time with start.bat.
)
if exist "%STARTMENU%\KovaaK's stats.lnk" (
  echo   [OK] Start Menu entry created.
)

rem --- 3. Done ---------------------------------------------------------------
echo.
echo   ============================================
echo   Setup complete.
echo.
echo   Start the app from the Desktop shortcut, the Start Menu,
echo   or by running start.bat in this folder.
echo.
echo   On first launch it will ask for your KovaaK's stats folder,
echo   usually:
echo     ...\steamapps\common\FPSAimTrainer\FPSAimTrainer\stats
echo.
echo   Nothing leaves your PC. No account, no uploads, no network calls.
echo.

choice /c YN /n /m "   Start it now? [Y/N] "
if errorlevel 2 goto :done
echo.
start "" "%TARGET%"

:done
echo.
endlocal
