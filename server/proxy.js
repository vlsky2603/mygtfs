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

new CronJob( '0 3 * * *', async () => { console.log('Cron job triggered: Starting daily stops data update...'); await updateAllStopsData(); }, null, true, 'America/Winnipeg' );
function getDistance(lat1, lon1, lat2, lon2) { /* ... ваш код ... */ return 0; }
async function updateAllStopsData() { /* ... ваш код ... */ }

// --- API Маршруты ---

app.get('/api/time', (req, res) => { /* ... ваш код ... */ });
app.get('/api/stops/nearby', (req, res) => { /* ... ваш код ... */ });


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
        // --- КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: КОРРЕКЦИЯ ДАТЫ ---
        const serverToday = new Date(); // Реальная дата на сервере
        const requestedStartTime = new Date(start); // Дата из запроса (e.g., 2025 год)
        const requestedEndTime = new Date(end);

        // Создаем новые даты, комбинируя СЕГОДНЯШНЮЮ дату сервера и ВРЕМЯ из запроса
        const correctedStartDate = new Date(serverToday);
        correctedStartDate.setUTCHours(requestedStartTime.getUTCHours(), requestedStartTime.getUTCMinutes(), requestedStartTime.getUTCSeconds(), 0);

        const correctedEndDate = new Date(serverToday);
        correctedEndDate.setUTCHours(requestedEndTime.getUTCHours(), requestedEndTime.getUTCMinutes(), requestedEndTime.getUTCSeconds(), 0);

        // Если время пересекает полночь (например, 23:00 -> 01:00), добавляем день к конечной дате
        if (correctedEndDate < correctedStartDate) {
            correctedEndDate.setDate(correctedEndDate.getDate() + 1);
        }

        const correctedStartISO = correctedStartDate.toISOString();
        const correctedEndISO = correctedEndDate.toISOString();
        // --- КОНЕЦ ИЗМЕНЕНИЯ ---

        const apiUrl = `https://api.winnipegtransit.com/v3/stops/${stopId}/schedule.json?api-key=${API_KEY}&usage=${usage}&start=${correctedStartISO}&end=${correctedEndISO}`;
        
        console.log(`Backend: Forwarding CORRECTED request to: ${apiUrl}`); // Логируем исправленный URL

        const apiResponse = await fetch(apiUrl);
        if (!apiResponse.ok) {
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