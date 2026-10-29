@echo off
setlocal
cd /d "%~dp0"
rem Cache-ul npm si fisierele temporare stau pe acelasi disc cu proiectul (nu umplem C:).
set "CACHEROOT=%~d0\noexcuse-cache"
if exist "D:\" set "CACHEROOT=D:\noexcuse-cache"
set "npm_config_cache=%CACHEROOT%\npm"
set "TEMP=%CACHEROOT%\tmp"
set "TMP=%CACHEROOT%\tmp"
echo Spatiu liber pe discuri (GB):
powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Free -ne $null} | ForEach-Object { '  ' + $_.Name + ': ' + [math]::Round($_.Free/1GB,1) + ' GB liberi' }"
echo Cache si fisiere temporare: %CACHEROOT%
if not exist "%TEMP%" mkdir "%TEMP%"
echo === NoExcuse: publicare pe Vercel ===
where node >nul 2>nul || (echo Node.js nu este instalat. & pause & exit /b 1)
if not exist "node_modules\.bin\expo.cmd" (
  echo Ruleaza intai START-SITE.cmd o data, ca sa se instaleze dependintele.
  pause
  exit /b 1
)
rem Valori publice ale proiectului Supabase "noexcuse" (secretele stau doar pe server).
set EXPO_PUBLIC_DEMO=0
set EXPO_PUBLIC_SUPABASE_URL=https://ibsrtuyrflvprmjuuoqb.supabase.co
set EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlic3J0dXlyZmx2cHJtanV1b3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNzc3OTYsImV4cCI6MjEwODc1Mzc5Nn0.W-qQ0pGJXTsaM0DZhYkaU_tT6nBEzI894lqW8XYZwdo
echo.
echo [1/2] Construiesc site-ul (1-3 minute)...
if exist dist rd /s /q dist
if exist ".expo\web\cache" rd /s /q ".expo\web\cache"
call node_modules\.bin\expo.cmd export -p web --clear
if not exist "dist\index.html" (
  echo Construirea a esuat. Fa o captura a ferestrei si trimite-o lui Claude.
  pause
  exit /b 1
)
> dist\vercel.json echo {"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}
echo.
echo [2/2] Public pe Vercel. Prima data iti cere sa te loghezi in browser - urmeaza pasii de acolo.
call npx --yes vercel@latest deploy dist --prod --yes
if errorlevel 1 (
  echo.
  echo PUBLICAREA A ESUAT - nu exista link. Fa o captura a ferestrei si trimite-o lui Claude.
  pause
  exit /b 1
)
echo.
echo Gata. Linkul site-ului este cel de la "Production:" / "Aliased:" de mai sus.
echo Trimite-i lui Claude linkul ca sa il adauge in Supabase.
pause
