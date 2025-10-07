@echo off
REM Winnipeg Transit Vision - Startup Script for Windows
REM This script ensures the project launches correctly

echo.
echo ======================================
echo Winnipeg Transit Vision - Starting...
echo ======================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed
    echo Please install Node.js 16 or higher from https://nodejs.org
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Check for .env file and create template if missing
if not exist ".env" (
    echo No .env file found. Creating template...
    (
        echo # Winnipeg Transit API Configuration
        echo # Get your API key from: https://api.winnipegtransit.com/
        echo PORT=8080
        echo TRANSIT_API_KEY=H_CGXaUefWeHpp0hgndA
    ) > .env
    echo Created .env template file
)

REM Start the server
echo.
echo Starting server on port 8080...
echo Access the app at: http://localhost:8080
echo.
echo Press Ctrl+C to stop the server
echo ======================================
echo.

npm start
