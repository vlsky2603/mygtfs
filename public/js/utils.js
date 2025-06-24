// ===================================================================
//     utils.js - Вспомогательные утилиты
// ===================================================================
// Мелкие, но важные функции, которые используются в разных
// частях приложения: рандомные сообщения, форматирование времени,
// и другие полезные хелперы.
// ===================================================================

export function determineSimulationTimeUTC() {
  return new Date();
}

export function gtfsTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  const [h,m,s] = timeStr.split(':').map(x=>parseInt(x,10));
  return h*3600 + m*60 + s;
}

export function getDatetimeForGtfsTime(gtfsTimeSeconds, serviceDateUTC) {
  if (gtfsTimeSeconds == null) return null;
  const day = new Date(serviceDateUTC);
  day.setUTCHours(0,0,0,0);
  return new Date(day.getTime() + gtfsTimeSeconds*1000);
}

export async function getAddressSuggestions(query, limit=5) {
  if (!query||query.length<3) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&q=${encodeURIComponent(query+', Winnipeg')}`;
  try {
    const r = await fetch(url,{headers:{'User-Agent':'mygtfs-app'}});
    if (!r.ok) return [];
    const data = await r.json();
    return data.map(i=>({
      display: i.display_name,
      lat: +i.lat, lon:+i.lon
    }));
  } catch(e){
    console.error('Address suggestion error',e);
    return [];
  }
}

// Random loading messages removed for cleaner UI

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

