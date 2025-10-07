#!/bin/bash

# Winnipeg Transit Vision - Launch Verification Script
# This script verifies that the server is running correctly

echo "🔍 Winnipeg Transit Vision - Launch Verification"
echo "================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Function to test endpoint
test_endpoint() {
    local url=$1
    local description=$2
    
    echo -n "Testing: $description... "
    
    response=$(curl -s -w "%{http_code}" -o /tmp/response.txt "$url" 2>&1)
    http_code="${response: -3}"
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "304" ]; then
        echo -e "${GREEN}✓ PASSED${NC} (HTTP $http_code)"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC} (HTTP $http_code)"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

# Check if server is running
echo "1. Checking if server is accessible..."
if ! curl -s http://localhost:8080 > /dev/null 2>&1; then
    echo -e "${RED}✗ Server is not running on port 8080${NC}"
    echo ""
    echo "Please start the server first:"
    echo "  ./start.sh"
    echo "  or"
    echo "  npm start"
    exit 1
fi
echo -e "${GREEN}✓ Server is running${NC}"
echo ""

# Test endpoints
echo "2. Testing API endpoints..."
test_endpoint "http://localhost:8080/api/health" "Health Check Endpoint"
test_endpoint "http://localhost:8080/api/time" "Time API Endpoint"
test_endpoint "http://localhost:8080/" "Main Application Page"
test_endpoint "http://localhost:8080/styles.css" "Static Assets (CSS)"
test_endpoint "http://localhost:8080/js/gtfs_handler.js" "JavaScript Modules"

echo ""
echo "3. Checking server health..."
health_response=$(curl -s http://localhost:8080/api/health)
if [ $? -eq 0 ]; then
    echo "Server Status:"
    echo "$health_response" | python3 -m json.tool 2>/dev/null || echo "$health_response"
fi

echo ""
echo "================================================="
echo "Verification Summary:"
echo -e "  ${GREEN}Passed: $PASSED${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Server is running correctly.${NC}"
    echo ""
    echo "Access the application at: http://localhost:8080"
    exit 0
else
    echo -e "${YELLOW}⚠ Some checks failed. Please review the output above.${NC}"
    exit 1
fi
