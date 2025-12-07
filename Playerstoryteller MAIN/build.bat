@echo off
echo Building Player Storyteller mod...
echo.

REM Set RimWorld path to user's location
set "RIMWORLD_DIR=E:\SteamLibrary\steamapps\common\RimWorld"

set RIMWORLD_MODS=%RIMWORLD_DIR%\Mods
set MOD_NAME=RatLab
set SOURCE_DIR=Ratlab mod

echo Found RimWorld at: %RIMWORLD_DIR%

REM Check if dotnet is available
where dotnet >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: dotnet CLI not found
    echo Please install .NET SDK from: https://dotnet.microsoft.com/download
    echo.
    exit /b 1
)

REM Check if go is available
where go >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: go CLI not found
    echo Please install Go from: https://go.dev/dl/
    echo.
    exit /b 1
)

echo Building mod: %MOD_NAME%
echo.

REM Build the C# project
echo Building C# project...
cd "%SOURCE_DIR%\Source"

dotnet build PlayerStoryteller.csproj /p:Configuration=Release /nologo /verbosity:minimal

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================
    echo C# Build FAILED!
    echo Check the errors above
    echo ========================================
    echo.
    cd ..\..
    exit /b 1
)

cd ..\..

REM Build the Go Sidecar (Clean Rewrite with MP4 Parser)
echo.
echo Building Go Sidecar (Clean Rewrite with MP4 Parser)...
cd go-sidecar
go build -o sidecar.exe

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================
    echo Go Build FAILED!
    echo Check the errors above
    echo ========================================
    echo.
    cd ..
    exit /b 1
)
cd ..

echo.
echo ========================================
echo Build successful!
echo DLL created in: %SOURCE_DIR%\Assemblies\
echo Sidecar binary created in: go-sidecar\sidecar.exe
echo ========================================
echo.

REM Copy to RimWorld Mods folder
echo Deploying mod to RimWorld Mods folder...
echo.

REM Create mod directory if it doesn't exist
if not exist "%RIMWORLD_MODS%\%MOD_NAME%" (
    echo Creating mod directory...
    mkdir "%RIMWORLD_MODS%\%MOD_NAME%"
)

REM Try to delete old DLL to avoid file locks
if exist "%RIMWORLD_MODS%\%MOD_NAME%\Assemblies\PlayerStoryteller.dll" (
    echo Deleting old DLL...
    del /F /Q "%RIMWORLD_MODS%\%MOD_NAME%\Assemblies\PlayerStoryteller.dll" 2>nul
    if exist "%RIMWORLD_MODS%\%MOD_NAME%\Assemblies\PlayerStoryteller.dll" (
        echo WARNING: Could not delete old DLL - RimWorld may be running
        echo Please close RimWorld and try again.
        echo.
        exit /b 1
    )
)

REM Copy About folder
echo - Copying About folder...
xcopy /E /I /Y "%SOURCE_DIR%\About" "%RIMWORLD_MODS%\%MOD_NAME%\About" >nul

REM Copy Assemblies folder
echo - Copying Assemblies folder...
xcopy /E /I /Y "%SOURCE_DIR%\Assemblies" "%RIMWORLD_MODS%\%MOD_NAME%\Assemblies" >nul

REM Copy Defs folder if it exists
if exist "%SOURCE_DIR%\Defs" (
    echo - Copying Defs folder...
    xcopy /E /I /Y "%SOURCE_DIR%\Defs" "%RIMWORLD_MODS%\%MOD_NAME%\Defs" >nul
)

REM Copy Textures folder if it exists
if exist "%SOURCE_DIR%\Textures" (
    echo - Copying Textures folder...
    xcopy /E /I /Y "%SOURCE_DIR%\Textures" "%RIMWORLD_MODS%\%MOD_NAME%\Textures" >nul
)

REM Deploy Sidecar (Binary + FFmpeg)
echo - Deploying Sidecar...
if not exist "%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar" mkdir "%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar"

copy /Y "go-sidecar\sidecar.exe" "%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar\" >nul

REM Try to find FFmpeg in multiple locations
set FFMPEG_FOUND=0
if exist "go-sidecar\ffmpeg.exe" (
    copy /Y "go-sidecar\ffmpeg.exe" "%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar\" >nul
    set FFMPEG_FOUND=1
    echo   Found ffmpeg.exe in go-sidecar folder
) else if exist "webrtc-sidecar\ffmpeg.exe" (
    copy /Y "webrtc-sidecar\ffmpeg.exe" "%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar\" >nul
    set FFMPEG_FOUND=1
    echo   Found ffmpeg.exe in webrtc-sidecar folder (deprecated location)
)

if %FFMPEG_FOUND%==0 (
    echo.
    echo WARNING: ffmpeg.exe not found!
    echo Please download FFmpeg from: https://github.com/BtbN/FFmpeg-Builds/releases
    echo Extract ffmpeg.exe to the go-sidecar\ folder
    echo.
)

REM Unblock the executable to prevent SmartScreen/Security warnings
powershell -Command "Unblock-File -Path '%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar\sidecar.exe' -ErrorAction SilentlyContinue"

echo.
echo ========================================
echo SUCCESS!
echo ========================================
echo.

echo Mod deployed to: %RIMWORLD_MODS%\%MOD_NAME%
echo.