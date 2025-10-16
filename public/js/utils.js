// ===================================================================
//     utils.js - Вспомогательные утилиты
// ===================================================================
// Мелкие, но важные функции, которые используются в разных
// частях приложения: рандомные сообщения, форматирование времени,
// и другие полезные хелперы.
// ===================================================================

function determineSimulationTimeUTC() {
    // Возвращаем текущее время пользователя (браузера)
    return new Date();
}

// Получить текущее время в таймзоне Winnipeg для API запросов
function getCurrentWinnipegTime() {
    const now = new Date();
    // Конвертируем в строку Winnipeg времени
    const winnipegTimeStr = now.toLocaleString('en-US', { 
        timeZone: 'America/Winnipeg',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    // Парсим строку обратно в Date объект
    // Формат: "MM/DD/YYYY, HH:mm:ss"
    const [datePart, timePart] = winnipegTimeStr.split(', ');
    const [month, day, year] = datePart.split('/');
    const [hour, minute, second] = timePart.split(':');
    
    // Создаем Date в UTC, но со значениями времени Winnipeg
    const winnipegDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    
    return winnipegDate;
}

function gtfsTimeToSeconds(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.split(':');
    if (parts.length !== 3) return null;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
    return hours * 3600 + minutes * 60 + seconds;
}

function getDatetimeForGtfsTime(gtfsTimeSeconds, serviceDateUTC) {
    if (gtfsTimeSeconds === null) return null;
    const serviceDayStart = new Date(serviceDateUTC);
    serviceDayStart.setUTCHours(0, 0, 0, 0);
    return new Date(serviceDayStart.getTime() + gtfsTimeSeconds * 1000);
}

function formatArrivalTime(sStopTimes, nowForFormattingUTC) {
    const scheduledTimeStr = sStopTimes?.scheduled;
    const estimatedTimeStr = sStopTimes?.estimated;
    const effectiveTimeStr = estimatedTimeStr || scheduledTimeStr;
    if (!effectiveTimeStr) return { text: '', css: '', timestamp: Infinity };

    const targetTimeUTC = new Date(effectiveTimeStr);
    const diffSeconds = (targetTimeUTC.getTime() - nowForFormattingUTC.getTime()) / 1000;
    const timestamp = targetTimeUTC.getTime();
    const min = Math.round(diffSeconds / 60);

     if (min < -10) return { text: '', css: '', timestamp: Infinity };
    let cssClass = '', displayText = '';
    if (min <= 1 && min >= -5) { displayText = 'Now'; cssClass = 'now'; }
    else if (min > 1 && min < 60) { displayText = `${min} min`; cssClass = ''; }
    else if (min >= 60) {
        displayText = targetTimeUTC.toLocaleTimeString([], {timeZone: "America/Winnipeg", hour: '2-digit', minute: '2-digit'});
        cssClass = 'scheduled-time';
        
        const nowDateWinnipeg = nowForFormattingUTC.toLocaleDateString("en-CA", {timeZone: "America/Winnipeg"});
        const targetDateWinnipeg = targetTimeUTC.toLocaleDateString("en-CA", {timeZone: "America/Winnipeg"});
        if (targetDateWinnipeg !== nowDateWinnipeg) {
             cssClass += ' future-date';
        }
    } else return { text: '', css: '', timestamp: Infinity };
    
    if (estimatedTimeStr) {
        cssClass += ' live';
    }
    if (min > 1 && min < 5) cssClass += ' critical-soon';
    else if (min >= 5 && min < 10) cssClass += ' soon';
    else if (min >= 10 && min < 20) cssClass += ' approaching';

    return { text: displayText, css: cssClass.trim(), timestamp };
}

// Random loading messages removed for cleaner UI

// Определение направления из имени остановки
function getDirectionFromStopName(stopName) {
    if (!stopName) return null;
    const nameLower = stopName.toLowerCase();
    if (nameLower.includes('northbound') || nameLower.includes('nb')) return 'Northbound';
    if (nameLower.includes('southbound') || nameLower.includes('sb')) return 'Southbound';
    if (nameLower.includes('eastbound') || nameLower.includes('eb')) return 'Eastbound';
    if (nameLower.includes('westbound') || nameLower.includes('wb')) return 'Westbound';
    return null;
}

// Маппинг направления к GTFS direction_id
function mapDirectionToGtfsId(directionName, routeId) {
    if (!directionName) return null;
    const dirLower = directionName.toLowerCase();
    
    // Для большинства маршрутов:
    // 0 = Outbound (обычно North или East)
    // 1 = Inbound (обычно South или West)
    
    if (dirLower.includes('north') || dirLower.includes('east')) return 0;
    if (dirLower.includes('south') || dirLower.includes('west')) return 1;
    
    return null;
}

const noScheduleMessages = [ "Looks like the buses are taking a nap here!", "No upcoming buses... time for a Portage Ave stroll?", "This stop is quiet. Too quiet. Maybe a coffee at Timmies?", "Is the bus playing hide and seek? Or just stuck on Pembina?", "Zilch. Nada. No buses soon, sorry eh.", "Even the Goldeyes have more action right now.", "Did a moose eat the schedule for this stop?", "This stop's as empty as the Jets' trophy case... (kidding, mostly!)", "Perhaps it's time to embrace the 'Winterpeg' walk?" ];
let lastNoScheduleMessageIndex = -1;
function getRandomNoScheduleMessage() { let randomIndex; do { randomIndex = Math.floor(Math.random() * noScheduleMessages.length); } while (randomIndex === lastNoScheduleMessageIndex && noScheduleMessages.length > 1); lastNoScheduleMessageIndex = randomIndex; return noScheduleMessages[randomIndex]; }

function isIOS() {
  return [
    'iPad Simulator', 'iPhone Simulator', 'iPod Simulator', 'iPad', 'iPhone', 'iPod'
  ].includes(navigator.platform)
  || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
}

// -------------------------------------------------------------------
//    Geometry Helpers
// -------------------------------------------------------------------
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

function interpolateOnPolyline(polyline, progress) {
    if (!polyline || polyline.length === 0) return null;
    if (polyline.length === 1) {
        const p = polyline[0];
        return Array.isArray(p) ? { lat: p[0], lng: p[1] } : { lat: p.lat, lng: p.lng };
    }
    const points = polyline.map(p => Array.isArray(p) ? { lat: p[0], lng: p[1] } : p);
    progress = Math.max(0, Math.min(1, progress));
    const segmentLengths = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const len = getDistance(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
        segmentLengths.push(len);
        total += len;
    }
    let dist = total * progress;
    for (let i = 0; i < segmentLengths.length; i++) {
        const segLen = segmentLengths[i];
        if (dist <= segLen) {
            const ratio = segLen === 0 ? 0 : dist / segLen;
            return {
                lat: points[i].lat + (points[i + 1].lat - points[i].lat) * ratio,
                lng: points[i].lng + (points[i + 1].lng - points[i].lng) * ratio
            };
        }
        dist -= segLen;
    }
    return points[points.length - 1];
}

// -------------------------------------------------------------------
//    Local Storage Caching Helpers
// -------------------------------------------------------------------
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 1 day

function saveToCache(key, data) {
    if (!window.localStorage) return;
    const item = { timestamp: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(item));
}

function getFromCache(key) {
    if (!window.localStorage) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
        const item = JSON.parse(raw);
        if (Date.now() - item.timestamp > CACHE_EXPIRY_MS) {
            localStorage.removeItem(key);
            return null;
        }
        return item.data;
    } catch (e) {
        localStorage.removeItem(key);
        return null;
    }
}

// -------------------------------------------------------------------
//    Simple Rate Limiter for API requests
// -------------------------------------------------------------------
const ONE_MINUTE_MS = 60 * 1000;
const MAX_REQUESTS_PER_MINUTE = 30;
let apiRequestTimestamps = [];

function recordApiRequest() {
    apiRequestTimestamps.push(Date.now());
    apiRequestTimestamps = apiRequestTimestamps.filter(ts => Date.now() - ts < ONE_MINUTE_MS);
}

function canMakeApiRequest() {
    apiRequestTimestamps = apiRequestTimestamps.filter(ts => Date.now() - ts < ONE_MINUTE_MS);
    return apiRequestTimestamps.length < MAX_REQUESTS_PER_MINUTE;
}

async function fetchWithRateLimit(url, options) {
    if (!canMakeApiRequest()) {
        return {
            ok: false,
            status: 429,
            json: async () => ({ error: 'Rate limit exceeded' })
        };
    }
    recordApiRequest();
    return fetch(url, options);
}

function fetchWithTimeout(resource, options = {}, timeout = 8000) {
    return Promise.race([
        fetch(resource, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))
    ]);
}

async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Winnipeg')}`;
    try {
        const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'mygtfs-app' } }, 8000);
        if (!res.ok) return null;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        }
    } catch (e) {
        console.error('Geocode error:', e);
    }
    return null;
}

async function getAddressSuggestions(query, limit = 5) {
    if (!query || query.length < 3) return [];
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=${limit}&q=${encodeURIComponent(query + ', Winnipeg')}`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'mygtfs-app' } });
        if (!res.ok) return [];
        const data = await res.json();
        if (Array.isArray(data)) {
            return data.map(item => ({
                display: item.display_name,
                lat: parseFloat(item.lat),
                lon: parseFloat(item.lon)
            }));
        }
    } catch (e) {
        console.error('Address suggestion error:', e);
    }
    return [];
}

function findNearestStop(lat, lon) {
    if (!allLocalStops?.length) return null;
    let nearest = null;
    let minDist = Infinity;
    const point = L.latLng(lat, lon);
    allLocalStops.forEach(stop => {
        const dist = point.distanceTo([stop.stop_lat, stop.stop_lon]);
        if (dist < minDist) { minDist = dist; nearest = stop; }
    });
    return nearest;
}

function findNearestStops(lat, lon, count = 1) {
    if (!allLocalStops?.length) return [];
    const point = L.latLng(lat, lon);
    const arr = allLocalStops.map(stop => ({ stop, dist: point.distanceTo([stop.stop_lat, stop.stop_lon]) }));
    arr.sort((a, b) => a.dist - b.dist);
    return arr.slice(0, count).map(a => a.stop);
}

function findNearestStops(lat, lon, count = 1) {
    if (!allLocalStops?.length) return [];
    const point = L.latLng(lat, lon);
    const arr = allLocalStops.map(stop => ({ stop, dist: point.distanceTo([stop.stop_lat, stop.stop_lon]) }));
    arr.sort((a, b) => a.dist - b.dist);
    return arr.slice(0, count).map(a => a.stop);
}
