@echo off
echo Building Player Storyteller mod...
echo.

REM Set paths - CUSTOMIZE THESE FOR YOUR SYSTEM
set RIMWORLD_DIR=E:\SteamLibrary\steamapps\common\RimWorld
set RIMWORLD_MODS=%RIMWORLD_DIR%\Mods
set MOD_NAME=PlayerStoryteller
set SOURCE_DIR=PlayerStoryteller

REM Check if RimWorld directory exists
if not exist "%RIMWORLD_DIR%" (
    echo ERROR: RimWorld directory not found at: %RIMWORLD_DIR%
    echo Please update RIMWORLD_DIR in build.bat to match your RimWorld installation
    echo.
    echo Common locations:
    echo   - E:\SteamLibrary\steamapps\common\RimWorld
    echo   - C:\Program Files ^(x86^)\Steam\steamapps\common\RimWorld
    echo.
    pause
    exit /b 1
)

REM Check if dotnet is available
where dotnet >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: dotnet CLI not found
    echo Please install .NET SDK from: https://dotnet.microsoft.com/download
    echo.
    pause
    exit /b 1
)

echo Found RimWorld at: %RIMWORLD_DIR%
echo Building mod: %MOD_NAME%
echo.

REM Build the project
echo Building C# project...
cd "%SOURCE_DIR%\Source"

REM Set RIMWORLD_DIR environment variable for the build process
set RIMWORLD_DIR=%RIMWORLD_DIR%

dotnet build PlayerStoryteller.csproj /p:Configuration=Release /nologo /verbosity:minimal

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================
    echo Build FAILED!
    echo Check the errors above
    echo ========================================
    echo.
    cd ..\..
    pause
    exit /b 1
)

cd ..\..

echo.
echo ========================================
echo Build successful!
echo DLL created in: %SOURCE_DIR%\Assemblies\
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
        pause
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

echo.
echo ========================================
echo SUCCESS!
echo ========================================
echo.
echo Mod deployed to: %RIMWORLD_MODS%\%MOD_NAME%
echo.
echo Mod folder structure:
echo   %RIMWORLD_MODS%\%MOD_NAME%\
echo   ├── About\
echo   │   └── About.xml
echo   ├── Assemblies\
echo   │   └── PlayerStoryteller.dll
echo   └── Textures\
echo.
echo You can now:
echo 1. Launch RimWorld
echo 2. Enable the Player Storyteller mod in Mod Settings
echo 3. Make sure RIMAPI is loaded BEFORE this mod
echo 4. Start a game and configure server URL in mod settings
echo.
echo Server setup:
echo   cd server
echo   npm install
echo   npm start
echo.
pause
