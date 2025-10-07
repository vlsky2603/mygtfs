# Winnipeg Transit Vision 🚌

A modern web application for tracking and visualizing Winnipeg Transit routes and schedules in real-time.

## Features

- 🗺️ Interactive map with live bus tracking
- 📍 Real-time bus arrival predictions
- 🎯 Precise bus positioning using GTFS data
- ⭐ Favorite stops management
- 🌓 Dark/Light mode support
- 🔔 Bus arrival notifications
- 🛤️ Route planning

## Quick Start

### Prerequisites

- Node.js 16 or higher
- npm (Node Package Manager)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/vlsky2603/mygtfs.git
cd mygtfs
```

2. Install dependencies:
```bash
npm install
```

3. (Optional) Create a `.env` file for custom configuration:
```env
PORT=8080
TRANSIT_API_KEY=your_api_key_here
```

### Running the Application

Start the server:
```bash
npm start
```

The application will be available at: **http://localhost:8080**

You should see:
```
Server running on http://localhost:8080
```

## Project Structure

```
mygtfs/
├── public/                 # Frontend files
│   ├── js/                # JavaScript modules
│   │   ├── bus_simulator.js    # Bus animation and positioning
│   │   ├── gtfs_handler.js     # GTFS data processing
│   │   ├── ui_controller.js    # UI interactions
│   │   ├── map_drawer.js       # Map rendering
│   │   └── utils.js            # Utility functions
│   ├── gtfs/              # GTFS static data
│   ├── index.html         # Main application page
│   └── styles.css         # Application styles
├── server/                # Backend server
│   ├── proxy.js          # Express server and API proxy
│   └── api/              # API endpoints
├── tests/                # Test files
│   ├── tests.html        # QUnit test runner
│   └── tests.js          # Test specifications
└── package.json          # Project dependencies
```

## API Endpoints

The server provides the following endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/time` | Get current Winnipeg time |
| GET | `/api/stops/:stopId/schedule` | Get schedule for a specific stop |
| GET | `/api/stops/:stopId` | Get stop information |

## Testing

Run the test suite by opening:
```
http://localhost:8080/tests/tests.html
```

## Features & Capabilities

### Bus Simulation
- **Precise Positioning**: Up to 95% accuracy when previous stop data is available
- **Smart Time Zones**: 5 different time ranges (60+, 30-60, 15-30, 5-15, 0-5 minutes)
- **Anti-Clustering**: Unique offsets for each bus to prevent overlapping
- **Long-Range Support**: Handles buses up to 70 minutes away

### Live Tracking
- Real-time bus position updates
- Smooth animations between positions
- Route visualization with polylines
- Interactive bus markers

### User Features
- Save favorite stops
- Set arrival notifications
- Filter by route, direction, or street
- Plan routes between stops

## Development

### Code Style
- 4 spaces indentation
- Use `const` and `let` (no `var`)
- Semicolons required
- Single quotes for strings
- 120 character line limit

### Running in Development
```bash
npm start
```

The server supports hot-reloading for frontend changes.

## Troubleshooting

### Server won't start
- Check if port 8080 is already in use
- Verify Node.js version: `node --version` (should be 16+)
- Reinstall dependencies: `npm install`

### Map not loading
- Check browser console for errors
- Ensure internet connection (for map tiles and external resources)
- Clear browser cache

### API errors
- Verify TRANSIT_API_KEY in `.env` file
- Check server logs for detailed error messages

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Run tests to ensure nothing broke
5. Commit with descriptive messages
6. Push to your fork
7. Create a Pull Request

## License

This project is open source and available for educational purposes.

## Author

Created by [@vlsky2603](https://github.com/vlsky2603)

## Acknowledgments

- Winnipeg Transit for providing the API
- Leaflet.js for map functionality
- GTFS data format specification
