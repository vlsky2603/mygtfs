// server/api/time.js - Модуль для управления и кэширования времени

const fetch = require('node-fetch').default;

const WORLD_TIME_API_URL = "https://worldtimeapi.org/api/timezone/America/Winnipeg";
const TIME_CACHE_DURATION_MS = 15 * 60 * 1000; // Как часто мы сверяемся с внешним миром
const MAX_WORLD_TIME_RETRIES = 3;
const WORLD_TIME_RETRY_DELAY_MS = 3000;

let cachedWinnipegTime = {
    data: null,
    lastFetched: 0,
    fetchInProgress: false,
    utcOffsetString: "-05:00"
};

async function fetchAndUpdateTimeCache(attempt = 1) {
    if (cachedWinnipegTime.fetchInProgress && attempt === 1) return;
    cachedWinnipegTime.fetchInProgress = true;
    console.log(`Backend Time Service: Fetching time... (Attempt ${attempt}/${MAX_WORLD_TIME_RETRIES})`);

    try {
        const response = await fetch(WORLD_TIME_API_URL, { timeout: 8000 });
        if (!response.ok) throw new Error(`WorldTimeAPI request failed: ${response.status}`);
        const data = await response.json();
        if (data.unixtime === undefined || !data.utc_offset) throw new Error("WorldTimeAPI response missing required fields.");
        
        cachedWinnipegTime.data = data;
        cachedWinnipegTime.lastFetched = Date.now(); // Запоминаем время *нашего сервера*, когда мы получили ответ
        cachedWinnipegTime.utcOffsetString = data.utc_offset;
        console.log('Backend Time Service: Successfully updated time cache:', data.datetime);
    } catch (error) {
        console.error(`Backend Time Service: Error updating cache (Attempt ${attempt}):`, error.message);
        if (attempt < MAX_WORLD_TIME_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, WORLD_TIME_RETRY_DELAY_MS));
            await fetchAndUpdateTimeCache(attempt + 1);
        }
    } finally {
        cachedWinnipegTime.fetchInProgress = false;
    }
}

function initializeTimeService() {
    console.log("Backend Time Service: Initializing...");
    fetchAndUpdateTimeCache();
    setInterval(fetchAndUpdateTimeCache, TIME_CACHE_DURATION_MS);
}

// ИЗМЕНЕНО: Обработчик теперь всегда возвращает АКТУАЛЬНОЕ время
function getTimeHandler(req, res) {
    if (!cachedWinnipegTime.data) {
        return res.status(503).json({
            error: "Time service is not ready. Awaiting first sync.",
            unixtime: Math.floor(Date.now() / 1000),
            utc_offset: cachedWinnipegTime.utcOffsetString,
            source: 'error-no-cache'
        });
    }

    // Рассчитываем, сколько времени прошло на СЕРВЕРЕ с последней сверки
    const elapsedSecondsSinceLastFetch = Math.floor((Date.now() - cachedWinnipegTime.lastFetched) / 1000);
    
    // Вычисляем актуальное время
    const currentCorrectUnixtime = cachedWinnipegTime.data.unixtime + elapsedSecondsSinceLastFetch;

    return res.json({
        ...cachedWinnipegTime.data,
        unixtime: currentCorrectUnixtime, // Отправляем клиенту самое свежее время
        source: 'live-calculated'
    });
}

module.exports = {
    initializeTimeService,
    getTimeHandler
};