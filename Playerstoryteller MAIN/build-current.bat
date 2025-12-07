@echo off
echo Building Player Storyteller (CURRENT VERSION)...
echo.

REM Set RimWorld path
set "RIMWORLD_DIR=E:\SteamLibrary\steamapps\common\RimWorld"
set "RIMWORLD_MODS=%RIMWORLD_DIR%\Mods"
set "MOD_NAME=RatLab"
set "SOURCE_DIR=Ratlab Mod"

echo RimWorld Path: %RIMWORLD_DIR%
echo Target Mod Path: %RIMWORLD_MODS%\%MOD_NAME%
echo.

REM Check prerequisites
where dotnet >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: dotnet CLI not found.
    exit /b 1
)
where go >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: go CLI not found.
    exit /b 1
)

REM 1. Clean Target Directory (preserving PublishedFileId.txt and Preview.png)
set "PUBLISHED_FILE_BACKUP="
set "PREVIEW_FILE_BACKUP="
if exist "%RIMWORLD_MODS%\%MOD_NAME%\About\PublishedFileId.txt" (
    echo Preserving PublishedFileId.txt...
    copy /Y "%RIMWORLD_MODS%\%MOD_NAME%\About\PublishedFileId.txt" "%TEMP%\PublishedFileId_backup.txt" >nul
    set "PUBLISHED_FILE_BACKUP=1"
)
if exist "%RIMWORLD_MODS%\%MOD_NAME%\About\Preview.png" (
    echo Preserving Preview.png...
    copy /Y "%RIMWORLD_MODS%\%MOD_NAME%\About\Preview.png" "%TEMP%\Preview_backup.png" >nul
    set "PREVIEW_FILE_BACKUP=1"
)
if exist "%RIMWORLD_MODS%\%MOD_NAME%" (
    echo Wiping target directory...
    rmdir /S /Q "%RIMWORLD_MODS%\%MOD_NAME%"
    if exist "%RIMWORLD_MODS%\%MOD_NAME%" (
        echo ERROR: Failed to wipe directory. Is RimWorld running?
        exit /b 1
    )
)
mkdir "%RIMWORLD_MODS%\%MOD_NAME%"

REM 2. Build C# Project
echo Building C# Project...
cd "%SOURCE_DIR%\Source"
dotnet build PlayerStoryteller.csproj /p:Configuration=Release /nologo /verbosity:minimal
if %ERRORLEVEL% NEQ 0 (
    echo C# Build FAILED!
    cd ..\..
    exit /b 1
)
cd ..\..

REM 3. Build Go Sidecar (with Window Capture)
echo Building Go Sidecar with Window Capture...
cd go-sidecar
go build -o sidecar.exe .
if %ERRORLEVEL% NEQ 0 (
    echo Go Build FAILED!
    cd ..
    exit /b 1
)
cd ..

REM 4. Deploy Files
echo Deploying files...

REM About
if exist "%SOURCE_DIR%\About" xcopy /E /I /Y "%SOURCE_DIR%\About" "%RIMWORLD_MODS%\%MOD_NAME%\About" >nul

REM Restore PublishedFileId.txt and Preview.png if they were backed up
if defined PUBLISHED_FILE_BACKUP (
    echo Restoring PublishedFileId.txt...
    copy /Y "%TEMP%\PublishedFileId_backup.txt" "%RIMWORLD_MODS%\%MOD_NAME%\About\PublishedFileId.txt" >nul
    del "%TEMP%\PublishedFileId_backup.txt" >nul 2>nul
)
if defined PREVIEW_FILE_BACKUP (
    echo Restoring Preview.png...
    copy /Y "%TEMP%\Preview_backup.png" "%RIMWORLD_MODS%\%MOD_NAME%\About\Preview.png" >nul
    del "%TEMP%\Preview_backup.png" >nul 2>nul
)

REM Assemblies
if exist "%SOURCE_DIR%\Assemblies" xcopy /E /I /Y "%SOURCE_DIR%\Assemblies" "%RIMWORLD_MODS%\%MOD_NAME%\Assemblies" >nul

REM Defs
if exist "%SOURCE_DIR%\Defs" xcopy /E /I /Y "%SOURCE_DIR%\Defs" "%RIMWORLD_MODS%\%MOD_NAME%\Defs" >nul

REM Textures
if exist "%SOURCE_DIR%\Textures" xcopy /E /I /Y "%SOURCE_DIR%\Textures" "%RIMWORLD_MODS%\%MOD_NAME%\Textures" >nul

REM Sidecar
if not exist "%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar" mkdir "%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar"
copy /Y "go-sidecar\sidecar.exe" "%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar\" >nul
if exist "go-sidecar\ffmpeg.exe" (
    copy /Y "go-sidecar\ffmpeg.exe" "%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar\" >nul
)

REM Unblock Sidecar
powershell -Command "Unblock-File -Path '%RIMWORLD_MODS%\%MOD_NAME%\go-sidecar\sidecar.exe' -ErrorAction SilentlyContinue"

echo.
echo ========================================
echo CURRENT VERSION BUILD SUCCESSFUL!
echo ========================================
echo.
