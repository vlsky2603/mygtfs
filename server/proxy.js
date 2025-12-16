require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch').default;
const cors = require('cors');
const NodeCache = require('node-cache');
const { CronJob } = require('cron');

const app = express();
const port = process.env.PORT || 8080;
// Я удалил жестко закодированный ключ для безопасности, предполагая, что он будет в .env
const API_KEY = process.env.TRANSIT_API_KEY || 'H_CGXaUefWeHpp0hgndA';

// Обслуживание статики - ваша конфигурация верна
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.static(path.join(__dirname, '..')));

app.use(cors());
app.use(express.json());

// Ваша логика кэширования и загрузки данных (без изменений)
const scheduleCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
const DATA_PATH = path.join(__dirname, '..', 'public', 'gtfs', 'stops.json');
let stopsData = { lastUpdated: null, stops: [] };
loadData();

// Ваша логика получения времени (без изменений)
let cachedWinnipegTime = { data: null, lastFetched: 0, fetchInProgress: false, utcOffsetString: "-05:00" };
const TIME_CACHE_DURATION_MS = 15 * 60 * 1000;
const WORLD_TIME_API_URL = "https://worldtimeapi.org/api/timezone/America/Winnipeg";
const MAX_WORLD_TIME_RETRIES = 3;
const WORLD_TIME_RETRY_DELAY_MS = 3000;

async function fetchAndUpdateTimeCache(attempt = 1) {
    if (cachedWinnipegTime.fetchInProgress && attempt === 1) {
        console.log('Backend: Time cache update already in progress.');
        return;
    }
    cachedWinnipegTime.fetchInProgress = true;
    console.log(`Backend: Attempting to fetch time from worldtimeapi.org (attempt ${attempt}/${MAX_WORLD_TIME_RETRIES})...`);
    try {
        const response = await fetch(WORLD_TIME_API_URL, { timeout: 8000 });
        if (!response.ok) {
            let errorBody = `Status: ${response.status}`;
            try { errorBody = await response.text(); } catch (e) { /* ignore */ }
            throw new Error(`WorldTimeAPI request failed: ${response.status} - ${errorBody}`);
        }
        const data = await response.json();
        if (!data.datetime || data.unixtime === undefined || !data.utc_offset) {
            throw new Error("WorldTimeAPI response missing required fields (datetime, unixtime, utc_offset).");
        }
        cachedWinnipegTime.data = data;
        cachedWinnipegTime.lastFetched = Date.now();
        cachedWinnipegTime.utcOffsetString = data.utc_offset;
        console.log('Backend: Successfully updated time cache from worldtimeapi.org:', data.datetime);
    } catch (error) {
        console.error(`Backend: Error updating time cache (attempt ${attempt}/${MAX_WORLD_TIME_RETRIES}):`, error.message);
        if (attempt < MAX_WORLD_TIME_RETRIES) {
            console.log(`Backend: Retrying time fetch in ${WORLD_TIME_RETRY_DELAY_MS / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, WORLD_TIME_RETRY_DELAY_MS));
            await fetchAndUpdateTimeCache(attempt + 1);
        } else {
            console.error('Backend: Max retries reached for fetching time from worldtimeapi.org.');
        }
    } finally {
        cachedWinnipegTime.fetchInProgress = false;
    }
}

fetchAndUpdateTimeCache();
setInterval(() => fetchAndUpdateTimeCache(), TIME_CACHE_DURATION_MS);

function loadData() {
    try {
        if (!fs.existsSync(DATA_PATH)) {
            fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
            fs.writeFileSync(DATA_PATH, JSON.stringify({ lastUpdated: null, stops: [] }));
            console.log('Created new stops.json file at:', DATA_PATH);
        }
        const rawData = fs.readFileSync(DATA_PATH);
        stopsData = JSON.parse(rawData);
        if (!stopsData.stops || !Array.isArray(stopsData.stops)) {
            console.error('stops.json has invalid format: "stops" array missing or not an array. Initializing with empty stops.');
            stopsData = { lastUpdated: new Date().toISOString(), stops: [] };
            saveData([]);
        } else {
            stopsData.lastUpdated = stopsData.lastUpdated || new Date().toISOString();
            console.log(`Data loaded from stops.json, ${stopsData.stops.length} stops, last updated: ${stopsData.lastUpdated}`);
        }
    } catch (e) {
        console.error('Error loading stops.json:', e.message, ". Initializing with empty stops.");
        stopsData = { lastUpdated: new Date().toISOString(), stops: [] };
        saveData([]);
    }
}

function saveData(dataArray) {
    try {
        const toSave = {
            lastUpdated: new Date().toISOString(),
            stops: dataArray
        };
        fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
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

new CronJob('0 3 * * *', async () => {
    console.log('Cron job triggered: Starting daily stops data update...');
    await updateAllStopsData();
}, null, true, 'America/Winnipeg');

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function updateAllStopsData() {
    if (!API_KEY) {
        console.error('Cannot update stops: API_KEY is missing.');
        return;
    }
    console.log('Starting updateAllStopsData...');
    try {
        // Fetch all stops.
        const apiUrl = `https://api.winnipegtransit.com/v3/stops.json?api-key=${API_KEY}&usage=long`; 
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`API responded with ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.stops) {
            throw new Error('API response missing "stops" array');
        }
        
        const stops = data.stops.map(s => ({
            stop_id: s.key,
            stop_name: s.name,
            stop_lat: parseFloat(s.geographic.latitude),
            stop_lon: parseFloat(s.geographic.longitude),
            stop_code: s.number,
            street_name: s.street?.name || '',
            cross_street_name: s['cross-street']?.name || '',
            direction: s.direction || ''
        }));
        
        saveData(stops);
        console.log(`Successfully updated ${stops.length} stops.`);
        
    } catch (error) {
        console.error('Error updating stops data:', error);
    }
}

// --- API Маршруты ---

app.get('/api/time', (req, res) => {
    if (!cachedWinnipegTime.data) {
        return res.status(503).json({
            error: 'Time service is not ready. Awaiting first sync.',
            unixtime: Math.floor(Date.now() / 1000),
            utc_offset: cachedWinnipegTime.utcOffsetString,
            source: 'error-no-cache'
        });
    }

    const elapsedSeconds = Math.floor((Date.now() - cachedWinnipegTime.lastFetched) / 1000);
    const currentCorrectUnixtime = cachedWinnipegTime.data.unixtime + elapsedSeconds;

    res.json({
        ...cachedWinnipegTime.data,
        unixtime: currentCorrectUnixtime,
        source: 'live-calculated'
    });
});

app.get('/api/stops/nearby', (req, res) => {
    const { lat, lon, radius = 500 } = req.query;
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const radiusNum = parseFloat(radius);
    if (isNaN(latNum) || isNaN(lonNum)) {
        return res.status(400).json({ error: 'lat and lon query parameters are required' });
    }
    const nearby = stopsData.stops.filter(stop => {
        return getDistance(latNum, lonNum, stop.stop_lat, stop.stop_lon) <= radiusNum;
    });
    res.json({ stops: nearby });
});

// ===================================================================
//               НОВЫЕ API ЭНДПОИНТЫ ДЛЯ ДАННЫХ ТРАНЗИТА
// ===================================================================

// Получение всех остановок из Winnipeg Transit API
app.get('/api/stops', async (req, res) => {
    const { distance, lat, lon } = req.query;
    
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key is not configured on the server.' });
    }

    try {
        let apiUrl = `https://api.winnipegtransit.com/v3/stops.json?api-key=${API_KEY}`;
        
        // Если указаны координаты, получаем остановки в радиусе
        if (lat && lon) {
            const dist = distance || 500;
            apiUrl = `https://api.winnipegtransit.com/v3/stops.json?lat=${lat}&lon=${lon}&distance=${dist}&api-key=${API_KEY}`;
        }
        
        const corsProxies = ['', 'https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
        let apiResponse = null;
        
        for (const proxy of corsProxies) {
            try {
                const url = proxy ? proxy + encodeURIComponent(apiUrl) : apiUrl;
                apiResponse = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    },
                    timeout: 15000
                });
                if (apiResponse.ok) break;
            } catch (err) {
                apiResponse = null;
            }
        }
        
        if (!apiResponse || !apiResponse.ok) {
            return res.status(apiResponse?.status || 503).json({ error: 'Failed to fetch stops from API' });
        }
        
        const data = await apiResponse.json();
        res.json(data);
    } catch (error) {
        console.error('Error fetching stops:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получение всех маршрутов
app.get('/api/routes', async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key is not configured on the server.' });
    }

    try {
        const apiUrl = `https://api.winnipegtransit.com/v3/routes.json?api-key=${API_KEY}`;
        const corsProxies = ['', 'https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
        let apiResponse = null;
        
        for (const proxy of corsProxies) {
            try {
                const url = proxy ? proxy + encodeURIComponent(apiUrl) : apiUrl;
                apiResponse = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    },
                    timeout: 15000
                });
                if (apiResponse.ok) break;
            } catch (err) {
                apiResponse = null;
            }
        }
        
        if (!apiResponse || !apiResponse.ok) {
            return res.status(apiResponse?.status || 503).json({ error: 'Failed to fetch routes from API' });
        }
        
        const data = await apiResponse.json();
        res.json(data);
    } catch (error) {
        console.error('Error fetching routes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получение информации о конкретном маршруте с вариантами
app.get('/api/routes/:routeNumber', async (req, res) => {
    const { routeNumber } = req.params;
    
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key is not configured on the server.' });
    }

    try {
        const apiUrl = `https://api.winnipegtransit.com/v3/routes/${routeNumber}.json?api-key=${API_KEY}`;
        const corsProxies = ['', 'https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
        let apiResponse = null;
        
        for (const proxy of corsProxies) {
            try {
                const url = proxy ? proxy + encodeURIComponent(apiUrl) : apiUrl;
                apiResponse = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    },
                    timeout: 15000
                });
                if (apiResponse.ok) break;
            } catch (err) {
                apiResponse = null;
            }
        }
        
        if (!apiResponse || !apiResponse.ok) {
            return res.status(apiResponse?.status || 503).json({ error: 'Failed to fetch route details from API' });
        }
        
        const data = await apiResponse.json();
        res.json(data);
    } catch (error) {
        console.error('Error fetching route details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получение остановок для конкретного маршрута
app.get('/api/routes/:routeNumber/stops', async (req, res) => {
    const { routeNumber } = req.params;
    
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key is not configured on the server.' });
    }

    try {
        const apiUrl = `https://api.winnipegtransit.com/v3/routes/${routeNumber}/stops.json?api-key=${API_KEY}`;
        const corsProxies = ['', 'https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
        let apiResponse = null;
        
        for (const proxy of corsProxies) {
            try {
                const url = proxy ? proxy + encodeURIComponent(apiUrl) : apiUrl;
                apiResponse = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    },
                    timeout: 15000
                });
                if (apiResponse.ok) break;
            } catch (err) {
                apiResponse = null;
            }
        }
        
        if (!apiResponse || !apiResponse.ok) {
            return res.status(apiResponse?.status || 503).json({ error: 'Failed to fetch route stops from API' });
        }
        
        const data = await apiResponse.json();
        res.json(data);
    } catch (error) {
        console.error('Error fetching route stops:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получение геометрии маршрута (варианта)
app.get('/api/variant/:variantKey', async (req, res) => {
    const { variantKey } = req.params;
    if (!API_KEY) return res.status(500).json({ error: 'API key missing' });
    
    const url = `https://api.winnipegtransit.com/v3/variants/${variantKey}.json?api-key=${API_KEY}&usage=short`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(`Error fetching variant ${variantKey}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// ===================================================================
//               ЭНДПОИНТЫ ДЛЯ ГЕОКОДИРОВАНИЯ И ПЛАНИРОВАНИЯ
// ===================================================================

// Геокодирование адресов через Nominatim
app.get('/api/geocode', async (req, res) => {
    const { address } = req.query;
    if (!address) {
        return res.status(400).json({ error: 'Address query parameter is required.' });
    }
    try {
        // Viewbox для Виннипега, чтобы сузить поиск
        const viewbox = '-97.3258,49.9928,-96.9531,49.7657';
        const apiUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&viewbox=${viewbox}&bounded=1`;
        
        const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'WinnipegTransitApp/1.0 (https://github.com/vlsky2603/mygtfs)' }
        });

        if (!response.ok) {
            throw new Error(`Nominatim API request failed with status ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Geocoding error:', error);
        res.status(500).json({ error: 'Internal server error during geocoding.' });
    }
});

// Планировщик маршрутов
app.get('/api/trip-plan', async (req, res) => {
    const { fromLat, fromLon, toLat, toLon } = req.query;
    if (!fromLat || !fromLon || !toLat || !toLon) {
        return res.status(400).json({ error: 'Origin and destination coordinates are required.' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'API key is not configured on the server.' });
    }

    try {
        const directApiUrl = `https://api.winnipegtransit.com/v3/trip-planner.json?api-key=${API_KEY}&origin=geo/${fromLat},${fromLon}&destination=geo/${toLat},${toLon}`;
        
        const corsProxies = ['', 'https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
        let apiResponse = null;
        let lastError = null;

        for (const proxy of corsProxies) {
            try {
                const apiUrl = proxy ? proxy + encodeURIComponent(directApiUrl) : directApiUrl;
                apiResponse = await fetch(apiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    },
                    timeout: 20000
                });
                if (apiResponse.ok) break;
                lastError = `Status ${apiResponse.status}`;
            } catch (err) {
                lastError = err.message;
                apiResponse = null;
            }
        }

        if (!apiResponse || !apiResponse.ok) {
            console.error(`Trip Planner API error: ${lastError}`);
            return res.status(apiResponse?.status || 503).json({ error: 'Failed to fetch trip plan from API.' });
        }

        const data = await apiResponse.json();
        res.json(data);
    } catch (error) {
        console.error('Trip planning error:', error);
        res.status(500).json({ error: 'Internal server error during trip planning.' });
    }
});

// Получение пешеходного маршрута через OSRM
app.get('/api/walking-route', async (req, res) => {
    const { fromLat, fromLon, toLat, toLon } = req.query;
    if (!fromLat || !fromLon || !toLat || !toLon) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }
    
    // OSRM Public API
    const url = `https://router.project-osrm.org/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
    
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'WinnipegTransitApp/1.0' }
        });
        
        if (!response.ok) {
            throw new Error(`OSRM failed with status ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Walking route error:', error);
        res.status(500).json({ error: 'Failed to fetch walking route' });
    }
});

// Получение расписания для конкретной остановки
app.get('/api/stops/:stopId/schedule', async (req, res) => {
    const { stopId } = req.params;
    const { usage = 'short', start, end } = req.query;

    if (!API_KEY) {
        return res.status(500).json({ error: 'API key is not configured on the server.' });
    }
    if (!stopId) {
        return res.status(400).json({ error: 'stopId is required' });
    }

    const parseDate = (value, fallbackDate) => {
        if (!value) return fallbackDate;
        if (!isNaN(Number(value))) {
            const numeric = Number(value);
            const epochMs = numeric > 1e12 ? numeric : numeric * 1000;
            return new Date(epochMs);
        }
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? fallbackDate : parsed;
    };

    const fallbackStart = new Date();
    const startDate = parseDate(start, fallbackStart);
    const fallbackEnd = new Date(startDate.getTime() + 4 * 60 * 60 * 1000);
    const endDate = parseDate(end, fallbackEnd);

    // Use full ISO with timezone so API receives timezone-aware timestamps
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    const cacheKey = `${stopId}-${usage}-${startISO}-${endISO}`;
    const cached = scheduleCache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    const directApiUrl = `https://api.winnipegtransit.com/v3/stops/${stopId}/schedule.json?api-key=${API_KEY}&usage=${usage}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
    const corsProxies = ['', 'https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
    let apiResponse = null;
    let lastError = null;

    for (const proxy of corsProxies) {
        try {
            const url = proxy ? proxy + encodeURIComponent(directApiUrl) : directApiUrl;
            apiResponse = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                },
                timeout: 15000
            });
            if (!apiResponse) { lastError = 'No response'; continue; }
            if (!apiResponse.ok) {
                lastError = `Status ${apiResponse.status}`;
                continue;
            }
            // Quick check: ensure response looks like JSON; otherwise try next proxy
            const contentType = apiResponse.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                // Peek at start of body to check for JSON-like structure
                const peekText = await apiResponse.clone().text();
                if (!peekText.trim().startsWith('{') && !peekText.trim().startsWith('[')) {
                    lastError = 'Non-JSON response from proxy';
                    continue; // try next proxy
                }
            }
            // If we reach here, apiResponse looks ok and likely JSON
            break;
        } catch (err) {
            apiResponse = null;
            lastError = err.message;
        }
    }

    if (!apiResponse || !apiResponse.ok) {
        try {
            const text = apiResponse ? await apiResponse.text() : 'No response body';
            console.error(`Stop schedule API error for ${stopId}: ${lastError} -> ${text}`);
        } catch (e) {
            console.error(`Stop schedule API error for ${stopId}: ${lastError}`);
        }
        // Return 502 to indicate proxy failure but include a hint in body.
        return res.status(apiResponse?.status || 502).json({ error: 'Failed to fetch stop schedule from API.', detail: lastError });
    }

    try {
        const data = await apiResponse.json();
        scheduleCache.set(cacheKey, data);
        res.json(data);
    } catch (error) {
        try {
            const txt = await apiResponse.text();
            console.error('Error parsing stop schedule response (body):', txt);
        } catch (err) {
            console.error('Error parsing stop schedule response: ', error);
        }
        // If parse fails, don't throw 500. Return a 502 with the parse error detail to the client.
        res.status(502).json({ error: 'Failed to parse stop schedule response (invalid JSON).', detail: error.message });
    }
});

// ===================================================================

// "Catch-all" маршрут для SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    if (isUpdatedToday() && stopsData.stops.length > 0) {
        console.log('Stops data already updated today, skipping initial fetch.');
    } else {
        console.log('Stops data is old or missing. Fetching stops data on startup...');
        updateAllStopsData().catch(err => {
            console.error("Error during initial stops data update:", err);
        });
    }
});
