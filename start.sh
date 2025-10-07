#!/bin/bash

# Winnipeg Transit Vision - Startup Script
# This script ensures the project launches correctly

echo "🚌 Winnipeg Transit Vision - Starting..."
echo "========================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    echo "   Please install Node.js 16 or higher from https://nodejs.org"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "⚠️  Warning: Node.js version is $NODE_VERSION, but 16 or higher is recommended"
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
fi

# Check for .env file and create template if missing
if [ ! -f ".env" ]; then
    echo "📝 No .env file found. Creating template..."
    cat > .env << EOF
# Winnipeg Transit API Configuration
# Get your API key from: https://api.winnipegtransit.com/
PORT=8080
TRANSIT_API_KEY=H_CGXaUefWeHpp0hgndA
EOF
    echo "✅ Created .env template file"
fi

# Start the server
echo ""
echo "🚀 Starting server on port 8080..."
echo "   Access the app at: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop the server"
echo "========================================="
echo ""

npm start
