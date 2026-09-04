@echo off
setlocal EnableDelayedExpansion
title Uninstall KovaaK's stats
cd /d "%~dp0"

echo.
echo   KovaaK's stats - uninstall
echo   ============================================
echo.
echo   This removes the Desktop/Start Menu shortcuts and deletes this
echo   entire folder ^(the app, your local settings, and its run cache^).
echo.
echo   Your actual KovaaK's run history is untouched - it lives in your
echo   FPSAimTrainer\stats folder and this app never modifies it.
echo.

choice /c YN /n /m "   Uninstall KovaaK's stats? [Y/N] "
if errorlevel 2 (
  echo.
  echo   Cancelled. Nothing was removed.
  echo.
  pause
  exit /b 0
)

echo.
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
if exist "%DESKTOP%\KovaaK's stats.lnk" (
  del /q "%DESKTOP%\KovaaK's stats.lnk"
  echo   [OK] Removed Desktop shortcut.
)
if exist "%STARTMENU%\KovaaK's stats.lnk" (
  del /q "%STARTMENU%\KovaaK's stats.lnk"
  echo   [OK] Removed Start Menu entry.
)

echo.
echo   Removing the app folder itself...
echo   ^(this window has to close first - Windows won't let a running
echo   program delete the folder it's running from^)
echo.

rem A batch file can't rmdir the folder it's executing from while it is still
rem running - cmd.exe has it open. Instead, spawn a detached helper that waits
rem a couple seconds for this window to fully close, then deletes the folder
rem from outside it.
set "SELF=%~dp0"
set "SELF=%SELF:~0,-1%"
start "" /min cmd /c "timeout /t 2 /nobreak >nul & rmdir /s /q "%SELF%" 2>nul"

exit /b 0
