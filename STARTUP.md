# 🚀 Winnipeg Transit Vision - Startup Guide

## Quick Launch

### Option 1: Using the Startup Script (Recommended)

**On Linux/Mac:**
```bash
./start.sh
```

**On Windows:**
```cmd
start.bat
```

### Option 2: Manual Start

```bash
npm start
```

## Verification

After starting the server, verify it's running correctly:

```bash
./verify.sh
```

Or manually check:
- Open http://localhost:8080 in your browser
- Check health status: http://localhost:8080/api/health

## What You Should See

### Successful Startup Output

```
Server running on http://localhost:8080
Data loaded from stops.json, 5779 stops, last updated: [timestamp]
```

### Health Check Response

Visit http://localhost:8080/api/health to see:

```json
{
    "status": "ok",
    "uptime": 15.877,
    "timestamp": "2025-10-07T20:45:53.359Z",
    "port": 8080,
    "stopsLoaded": 5779,
    "lastUpdated": "2025-06-18T00:09:25.733Z"
}
```

## Features Available After Launch

### 1. Interactive Map 🗺️
- View all transit stops on an interactive map
- Click on any stop to see real-time schedules
- Pan and zoom to explore different areas

### 2. Live Bus Tracking 🚌
- Click "Track" button on any bus schedule
- Watch buses move in real-time on the map
- See accurate arrival predictions

### 3. Search & Filters 🔍
- Search for specific stops
- Filter by route number
- Filter by direction (Northbound, Southbound, etc.)
- Filter by street name

### 4. Favorites ⭐
- Save frequently used stops
- Quick access to favorite stops
- Sync across sessions

### 5. Route Planning 🛤️
- Plan routes between two stops
- See transfer points
- Estimate travel time

### 6. Notifications 🔔
- Set arrival reminders
- Get notified before bus arrives
- Customize notification timing

### 7. Dark Mode 🌓
- Toggle between light and dark themes
- Automatic theme detection
- Persistent preference

## Troubleshooting

### Port Already in Use

If you see `EADDRINUSE` error:

1. Check what's using port 8080:
   ```bash
   lsof -i :8080  # Mac/Linux
   netstat -ano | findstr :8080  # Windows
   ```

2. Either stop that process or change the port:
   ```bash
   PORT=3000 npm start
   ```

### Dependencies Not Installed

If you see module not found errors:

```bash
npm install
```

### Server Not Responding

1. Check if Node.js is installed:
   ```bash
   node --version
   ```

2. Verify you're in the correct directory:
   ```bash
   pwd  # Should show /path/to/mygtfs
   ```

3. Restart the server:
   ```bash
   # Stop: Press Ctrl+C
   # Start: npm start
   ```

### Map Not Loading

- Check browser console (F12) for errors
- Ensure internet connection (map tiles require external resources)
- Try clearing browser cache
- Check if Leaflet CDN is accessible

## API Endpoints Reference

| Endpoint | Method | Description | Example |
|----------|--------|-------------|---------|
| `/api/health` | GET | Server health check | `curl http://localhost:8080/api/health` |
| `/api/time` | GET | Current Winnipeg time | `curl http://localhost:8080/api/time` |
| `/api/stops/:stopId/schedule` | GET | Stop schedule | `curl http://localhost:8080/api/stops/10064/schedule?start=...&end=...` |

## Environment Variables

Create a `.env` file in the root directory:

```env
# Server Port (default: 8080)
PORT=8080

# Winnipeg Transit API Key
# Get your key from: https://api.winnipegtransit.com/
TRANSIT_API_KEY=your_api_key_here
```

## Testing

### Run Unit Tests

Open in browser:
```
http://localhost:8080/tests/tests.html
```

### Run Demo Pages

The project includes several demo/test pages:

- http://localhost:8080/precise-positioning.html - Bus positioning algorithm demo
- http://localhost:8080/final-results.html - Final improvements showcase
- http://localhost:8080/git-success.html - Git integration status
- http://localhost:8080/test-final-improvements.html - Improvement tests

## Performance Notes

- **Initial Load**: First load might take 2-3 seconds while loading GTFS data
- **Bus Simulation**: Up to 95% positioning accuracy with available data
- **Caching**: Schedules are cached for 60 seconds to reduce API calls
- **Map Tiles**: External map tiles may take time to load on slow connections

## Next Steps

1. ✅ Server is running on http://localhost:8080
2. ✅ Open the application in your browser
3. ✅ Click on a stop marker to see schedules
4. ✅ Try the "Track" button to see live bus tracking
5. ✅ Explore filters, favorites, and other features

## Support

For issues or questions:
- Check the main [README.md](README.md)
- Review the [agent.md](public/agent.md) for technical details
- Open an issue on GitHub

---

**Happy tracking! 🚌✨**
