// server.js — прокси-сервер для обработки запросов к API Winnipeg Transit и кэширование остановок

const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch').default;
const cors = require('cors');
const NodeCache = require('node-cache');
const { CronJob } = require('cron');

const app = express();
const port = 8080;
const API_KEY = 'H_CGXaUefWeHpp0hgndA';

const cache = new NodeCache({
    stdTTL: 0,
    checkperiod: 600
});

const DATA_PATH = path.join(__dirname, 'stops.json');

let stopsData = { lastUpdated: null, stops: [] };
loadData();

function loadData() {
    try {
        if (!fs.existsSync(DATA_PATH)) {
            fs.writeFileSync(DATA_PATH, JSON.stringify({ lastUpdated: null, stops: [] }));
            console.log('Created new stops.json file');
        }

        if (fs.existsSync(DATA_PATH)) {
            const rawData = fs.readFileSync(DATA_PATH);
            stopsData = JSON.parse(rawData);
            if (!stopsData.stops || !Array.isArray(stopsData.stops)) {
                console.error('stops.json has invalid format: "stops" array missing or not an array');
                stopsData = { lastUpdated: new Date().toISOString(), stops: [] };
            } else {
                stopsData.lastUpdated = stopsData.lastUpdated || new Date().toISOString();
                console.log(`Data loaded from stops.json, ${stopsData.stops.length} stops, last updated: ${stopsData.lastUpdated}`);
            }
        }
    } catch (e) {
        console.error('Error loading stops.json:', e.message);
    }
}

function saveData(data) {
    try {
        const toSave = {
            lastUpdated: new Date().toISOString(),
            stops: data
        };
        fs.writeFileSync(DATA_PATH, JSON.stringify(toSave, null, 2));
        stopsData = toSave;
        console.log(`Stops data saved to stops.json, ${stopsData.stops.length} stops`);
    } catch (e) {
        console.error('Error saving stops.json:', e.message);
    }
}

function isUpdatedToday() {
    if (!stopsData.lastUpdated) return false;
    const lastUpdated = new Date(stopsData.lastUpdated);
    const today = new Date();
    return lastUpdated.getFullYear() === today.getFullYear() &&
        lastUpdated.getMonth() === today.getMonth() &&
        lastUpdated.getDate() === today.getDate();
}

new CronJob(
    '0 3 * * *',
    updateAllStopsData,
    null,
    true,
    'America/Winnipeg'
);

function generateGrid(centerLat, centerLon, radiusKm, stepKm) {
    const earthRadius = 6371;
    const grid = [];
    const stepDeg = (stepKm / earthRadius) * (180 / Math.PI);

    const latSteps = Math.ceil((radiusKm * 2) / stepKm);
    const lonSteps = Math.ceil((radiusKm * 2) / stepKm);

    for (let i = -latSteps / 2; i <= latSteps / 2; i++) {
        for (let j = -lonSteps / 2; j <= lonSteps / 2; j++) {
            const lat = centerLat + i * stepDeg;
            const lon = centerLon + (j * stepDeg) / Math.cos(centerLat * Math.PI / 180);
            grid.push({ lat, lon });
        }
    }
    return grid;
}

async function updateAllStopsData() {
    const maxRetries = 3;
    const retryDelay = 2000;
    const requestDelay = 1200;
    const rateLimitDelay = 5 * 60 * 1000;
    const grid = generateGrid(49.8955, -97.1384, 10, 1.5);
    const allStops = new Map(stopsData.stops.map(stop => [stop.stop_id, stop]));

    console.log(`Starting stops data update, ${grid.length} grid points...`);

    for (let i = 0; i < grid.length; i++) {
        const { lat, lon } = grid[i];
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Fetching stops for lat=${lat.toFixed(4)}, lon=${lon.toFixed(4)} (point ${i + 1}/${grid.length}, attempt ${attempt}/${maxRetries})...`);

                const url = `https://api.winnipegtransit.com/v3/stops.json?lat=${lat}&lon=${lon}&distance=2000&api-key=${API_KEY}`;
                const response = await fetch(url, {
                    timeout: 10000,
                    headers: { 'User-Agent': 'WinnipegTransitApp/1.0' }
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    if (response.status === 429 || response.status === 500) {
                        console.warn(`Rate limit or server error (${response.status}), pausing for ${rateLimitDelay / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
                        attempt--;
                        continue;
                    }
                    throw new Error(`API error: ${response.status} - ${errorText}`);
                }

                const data = await response.json();
                const stops = data.stops || [];
                stops.forEach(stop => allStops.set(stop.stop_id, stop));
                console.log(`Fetched ${stops.length} stops for point ${i + 1}/${grid.length}, total unique stops: ${allStops.size}`);
                saveData(Array.from(allStops.values()));
                break;

            } catch (error) {
                console.error(`Error fetching stops for point ${i + 1}/${grid.length} (attempt ${attempt}/${maxRetries}):`, error.message);
                if (attempt < maxRetries) {
                    console.log(`Retrying in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    console.error(`Failed to fetch stops for point ${i + 1}/${grid.length}`);
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, requestDelay));
    }

    const stopsArray = Array.from(allStops.values());
    saveData(stopsArray);
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/stops/nearby', (req, res) => {
    try {
        console.log('Received request to /api/stops/nearby');
        let { lat = 49.8955, lon = -97.1384, distance = 500 } = req.query;
        lat = parseFloat(lat);
        lon = parseFloat(lon);

        if (isNaN(lat) || isNaN(lon)) {
            console.error('Invalid lat or lon values');
            return res.status(400).json({
                success: false,
                error: 'Invalid lat or lon values'
            });
        }

        console.log(`Query parameters: lat=${lat}, lon=${lon}, distance=${distance}`);

        if (!stopsData || !stopsData.stops) {
            console.error('No stops data available in stopsData or stopsData.stops is undefined');
            return res.status(500).json({
                success: false,
                error: 'Stops data not available'
            });
        }

        stopsData.stops = stopsData.stops.filter(stop => stop !== undefined);

        const filteredStops = stopsData.stops.filter(stop => {
            const stopLat = parseFloat(stop.stop_lat);
            const stopLon = parseFloat(stop.stop_lon);
            if (isNaN(stopLat) || isNaN(stopLon)) {
                console.warn(`Invalid stopLat or stopLon values for stop ${stop.stop_id}`);
                return false;
            }
            const dist = getDistance(lat, lon, stopLat, stopLon);
            console.log(`Stop: ${stop.stop_id}, Distance: ${dist}`);
            return dist <= distance;
        });

        console.log(`Returning ${filteredStops.length} stops`);
        res.json({
            success: true,
            stops: filteredStops,
            source: 'local',
            lastUpdated: stopsData.lastUpdated
        });

    } catch (error) {
        console.error('Error in /api/stops/nearby:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/stops/:stopId/schedule', async (req, res) => {
    const maxRetries = 3;
    const retryDelay = 2000;
    const stopId = req.params.stopId;
    const scheduleInterval = 90; // интервал в минутах

    try {
        if (!/^[\w_]+$/.test(stopId)) {
            return res.status(400).json({ success: false, error: 'Invalid stop ID format' });
        }

        const cached = cache.get(`schedule_${stopId}`);
        if (cached) {
            console.log(`Returning cached schedule for stop ${stopId}`);
            return res.json(cached);
        }

        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Fetching schedule for stop ${stopId} (attempt ${attempt}/${maxRetries})...`);
                const now = new Date();
                const end = new Date(now.getTime() + scheduleInterval * 60 * 1000);
                const url = `https://api.winnipegtransit.com/v3/stops/${stopId}/schedule.json?api-key=${API_KEY}&start=${now.toISOString()}&end=${end.toISOString()}`;
                const response = await fetch(url, {
                    timeout: 10000,
                    headers: { 'User-Agent': 'WinnipegTransitApp/1.0' }
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API error: ${response.status} - ${errorText}`);
                }
                const data = await response.json();
                const result = { success: true, data };
                cache.set(`schedule_${stopId}`, result, 60);
                return res.json(result);
            } catch (error) {
                lastError = error;
                console.error(`Error fetching schedule for stop ${stopId} (attempt ${attempt}/${maxRetries}):`, error.message);
                if (attempt < maxRetries) {
                    console.log(`Retrying in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }
        }
        throw lastError;
    } catch (error) {
        console.error(`Error in /api/stops/${stopId}/schedule:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

function getDistance(lat1, lon1, lat2, lon2) {
    lat1 = parseFloat(lat1);
    lon1 = parseFloat(lon1);
    lat2 = parseFloat(lat2);
    lon2 = parseFloat(lon2);
    if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
        console.error('Invalid lat or lon values in getDistance');
        return Infinity;
    }
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    if (isUpdatedToday()) {
        console.log('Data already updated today, skipping fetch.');
    } else {
        console.log('Fetching stops data on startup...');
        updateAllStopsData();
    }
});