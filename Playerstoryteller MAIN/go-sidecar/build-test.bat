@echo off
echo Building window capture test...
go build -o test-capture.exe test-capture.go capture.go
if %ERRORLEVEL% EQU 0 (
    echo Build successful! test-capture.exe created.
    echo.
    echo To test, run: test-capture.exe ^<RimWorld PID^>
    echo Example: test-capture.exe 12345
) else (
    echo Build failed!
)
pause
