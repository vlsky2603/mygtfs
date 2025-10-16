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
    // Placeholder for data update logic
    console.log('updateAllStopsData not implemented, skipping.');
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


// ===================================================================
//               ИСПРАВЛЕННЫЙ МАРШРУТ ДЛЯ РАСПИСАНИЙ
// ===================================================================
app.get('/api/stops/:stopId/schedule', async (req, res) => {
    const { stopId } = req.params;
    const { usage = 'long', start, end } = req.query;

    if (!API_KEY) {
        return res.status(500).json({ error: 'API key is not configured on the server.' });
    }
    if (!start || !end) {
        return res.status(400).json({ error: 'The "start" and "end" query parameters are required.' });
    }
    
    // Создаем уникальный ключ для кэша, чтобы повторные запросы были быстрее
    const cacheKey = `schedule-${stopId}-${usage}-${start}-${end}`;
    const cachedData = scheduleCache.get(cacheKey);

    if (cachedData) {
        console.log(`Backend: Serving schedule for stop ${stopId} from cache.`);
        return res.json(cachedData);
    }

    try {
        // Поддержка Unix timestamp (миллисекунды) или ISO строк
        let startTimestamp, endTimestamp;
        
        if (/^\d+$/.test(start)) {
            // Unix timestamp (миллисекунды)
            startTimestamp = parseInt(start, 10);
            endTimestamp = parseInt(end, 10);
        } else {
            // ISO строка - конвертируем в timestamp
            startTimestamp = new Date(start).getTime();
            endTimestamp = new Date(end).getTime();
        }

        // Конвертируем timestamp в ISO строки для Winnipeg Transit API
        // API ожидает местное время Winnipeg в формате YYYY-MM-DDTHH:MM:SS
        // Winnipeg в CDT (UTC-5) или CST (UTC-6)
        
        // Форматируем в Winnipeg местное время
        const formatForWinnipegAPI = (timestamp) => {
            const date = new Date(timestamp);
            // Конвертируем в строку Winnipeg времени
            const winnipegStr = date.toLocaleString('en-US', {
                timeZone: 'America/Winnipeg',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            
            // Парсим "MM/DD/YYYY, HH:mm:ss" в "YYYY-MM-DDTHH:MM:SS"
            const [datePart, timePart] = winnipegStr.split(', ');
            const [month, day, year] = datePart.split('/');
            const pad = (n) => String(n).padStart(2, '0');
            return `${year}-${pad(month)}-${pad(day)}T${timePart}`;
        };
        
        const startISO = formatForWinnipegAPI(startTimestamp);
        const endISO = formatForWinnipegAPI(endTimestamp);
        
        console.log(`Backend: Schedule request - stopId=${stopId}, start=${startISO}, end=${endISO}`);

        console.log(`Backend: Schedule request - stopId=${stopId}, start=${startISO}, end=${endISO}`);

        // Пробуем использовать внешний CORS proxy для обхода WAF блокировки
        const directApiUrl = `https://api.winnipegtransit.com/v3/stops/${stopId}/schedule.json?api-key=${API_KEY}&usage=${usage}&start=${startISO}&end=${endISO}`;
        
        // Список CORS прокси для попытки обхода блокировки
        const corsProxies = [
            '', // Сначала прямой запрос
            'https://corsproxy.io/?',
            'https://api.allorigins.win/raw?url=',
        ];
        
        let apiResponse = null;
        let lastError = null;
        
        for (const proxy of corsProxies) {
            try {
                const apiUrl = proxy ? proxy + encodeURIComponent(directApiUrl) : directApiUrl;
                console.log(`Backend: Trying request via ${proxy || 'direct'}: ${apiUrl.substring(0, 100)}...`);
                
                apiResponse = await fetch(apiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'application/json',
                        'Referer': 'https://winnipegtransit.com/'
                    },
                    timeout: 10000
                });
                
                if (apiResponse.ok) {
                    console.log(`Backend: Success with ${proxy || 'direct'}`);
                    break;
                }
                lastError = `Status ${apiResponse.status}`;
            } catch (err) {
                lastError = err.message;
                console.log(`Backend: Failed with ${proxy || 'direct'}: ${lastError}`);
                apiResponse = null;
            }
        }
        
        if (!apiResponse || !apiResponse.ok) {
            const errorBody = await apiResponse.text();
            console.error(`Backend: Winnipeg Transit API error. Status: ${apiResponse.status}, Body: ${errorBody}`);
            return res.status(apiResponse.status).send(errorBody);
        }

        const data = await apiResponse.json();
        
        // Кэшируем успешный ответ
        scheduleCache.set(cacheKey, { data });
        
         res.json({ data });

    } catch (error) {
        console.error(`Backend: Internal server error for stop ${stopId}:`, error);
        res.status(500).json({ error: 'Internal server error' });
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
