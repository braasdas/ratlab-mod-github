@echo off
echo Building Player Storyteller Mod...

cd PlayerStoryteller\Source

if not defined RIMWORLD_DIR (
    echo ERROR: RIMWORLD_DIR environment variable not set
    echo Please set it to your RimWorld installation directory
    echo Example: set RIMWORLD_DIR=C:\Program Files ^(x86^)\Steam\steamapps\common\RimWorld
    pause
    exit /b 1
)

dotnet build

if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)

echo.
echo Build successful!
echo DLL output: PlayerStoryteller\Assemblies\
echo.
pause
