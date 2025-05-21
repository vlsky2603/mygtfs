// main_dynamic.js — адаптирован под показ фейковых live/schedule автобусов и маршрутов

const API_BASE = window.location.origin;
let map;
let markers = new Map();
let allStops = [];
let centerMarker;
let radiusCircle;
let filters = { direction: null, street: null, route: null };
const FIXED_RADIUS = 400;
let darkMode = false;

// Для показа маршрута и автобусов
let routeLine = null;
let busMarkers = [];
let busUpdater = null;
let currentRouteId = null;

function initUI() {
    document.getElementById('filter-toggle')
        .addEventListener('click', toggleFilterPanel);
    document.getElementById('close-filters')
        .addEventListener('click', closeFilterPanel);
    document.getElementById('reset-filters')
        .addEventListener('click', resetFilters);
    document.getElementById('direction-filter')
        .addEventListener('change', e => {
            filters.direction = e.target.value || null;
            updateActiveFiltersDisplay();
            updateStopsVisibility();
        });
    document.getElementById('street-search')
        .addEventListener('input', updateStreetSearch);
    document.getElementById('street-filter')
        .addEventListener('change', e => {
            filters.street = e.target.value || null;
            updateActiveFiltersDisplay();
            updateStopsVisibility();
        });
    document.getElementById('location-button')
        .addEventListener('click', locateUser);
    document.getElementById('theme-toggle')
        .addEventListener('click', toggleDarkMode);
    document.getElementById('close-schedule')
        .addEventListener('click', () => {
            closeSchedulePanel();
            clearRouteAndBuses();
        });

    document.getElementById('route-filter')
        .addEventListener('change', onSelectRoute);

    // Очистить маршрут при смене фильтра
    document.getElementById('route-filter').addEventListener('change', clearRouteAndBuses);
}


function onSelectRoute(e) {
    filters.route = e.target.value || null;
    updateActiveFiltersDisplay();
    if (filters.route) {
        showRouteAndBuses(filters.route);
    } else {
        updateStops();
        clearRouteAndBuses();
    }
}

function toggleFilterPanel() {
    document.getElementById('filter-panel').classList.toggle('active');
    document.getElementById('map').classList.toggle('map-blur');
}

function closeFilterPanel() {
    document.getElementById('filter-panel').classList.remove('active');
    document.getElementById('map').classList.remove('map-blur');
}

function resetFilters() {
    filters.direction = null;
    filters.street = null;
    filters.route = null;
    document.getElementById('direction-filter').value = '';
    document.getElementById('street-search').value = '';
    document.getElementById('street-filter').value = '';
    document.getElementById('route-filter').value = '';
    updateActiveFiltersDisplay();
    updateStops();
    clearRouteAndBuses();
}

function updateActiveFiltersDisplay() {
    const parts = [];
    if (filters.direction) parts.push(filters.direction);
    if (filters.street) parts.push(filters.street);
    if (filters.route) parts.push(document.getElementById('route-filter').selectedOptions[0].innerText.trim());
    const el = document.getElementById('active-filters');
    if (parts.length) {
        el.textContent = parts.join(', ');
        el.style.display = 'inline-block';
    } else {
        el.style.display = 'none';
    }
}

function updateStreetSearch(e) {
    const term = e.target.value.toLowerCase();
    Array.from(document.getElementById('street-filter').options)
        .forEach(opt => {
            opt.style.display = (!opt.value || opt.text.toLowerCase().includes(term))
                ? 'block' : 'none';
        });
}

function toggleDarkMode() {
    darkMode = !darkMode;
    localStorage.setItem('darkMode', darkMode);
    document.body.classList.toggle('dark-mode');
    const btn = document.getElementById('theme-toggle');
    btn.innerHTML = darkMode
        ? '<i class="fas fa-sun"></i>'
        : '<i class="fas fa-moon"></i>';
    const url = darkMode
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    L.tileLayer(url, { attribution: '© OpenStreetMap, © CartoDB', maxZoom: 18 }).addTo(map);
}

function locateUser() {
    if (!navigator.geolocation) return;
    const load = document.getElementById('loading');
    load.style.display = 'flex';
    load.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(pos => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 15);
        load.style.display = 'none';
    }, () => {
        load.textContent = 'Access denied';
        setTimeout(() => load.style.display = 'none', 2000);
    }, { enableHighAccuracy: true, timeout: 10000 });
}

function initMap() {
    darkMode = localStorage.getItem('darkMode') === 'true';
    if (darkMode) document.body.classList.add('dark-mode');

    map = L.map('map', { renderer: L.canvas(), zoomControl: false, tap: false })
        .setView([49.8955, -97.1384], 13);
    L.control.zoom({ position: 'topright' }).addTo(map);

    const tileUrl = darkMode
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    L.tileLayer(tileUrl, { attribution: '© OpenStreetMap, © CartoDB', maxZoom: 18 }).addTo(map);

    centerMarker = L.marker(map.getCenter(), {
        icon: L.divIcon({ className: 'center-marker', html: '<div class="center-marker-dot"></div>' }),
        interactive: false
    }).addTo(map);

    radiusCircle = L.circle(map.getCenter(), {
        radius: FIXED_RADIUS,
        color: darkMode ? '#4dabf7' : '#0078ff',
        fillOpacity: 0.1,
        weight: 2
    }).addTo(map);

    initUI();
    map.on('move', () => {
        centerMarker.setLatLng(map.getCenter());
        radiusCircle.setLatLng(map.getCenter());
    });
    map.on('moveend', () => {
        if (!filters.route) updateStops();
    });
    updateStops();
}

async function updateStops() {
    const load = document.getElementById('loading');
    load.style.display = 'flex';
    const { lat, lng } = map.getCenter();
    try {
        const res = await fetch(`${API_BASE}/api/stops/nearby?lat=${lat}&lon=${lng}`);
        if (!res.ok) {
            throw new Error(`Failed to fetch stops: ${res.status} ${res.statusText}`);
        }
        const json = await res.json();
        if (json && json.success) {
            allStops = json.stops;
            refreshMarkers();
        } else {
            console.error("Failed to fetch stops", json);
        }
    } catch (e) {
        console.error(e);
    } finally {
        load.style.display = 'none';
    }
}

function refreshMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers.clear();
    if (allStops && Array.isArray(allStops)) {
        allStops.forEach(stop => {
            const m = createStopMarker(stop);
            m.addTo(map);
            markers.set(stop.stop_id, m);
        });
    } else {
        console.warn("allStops is not an array or is undefined");
    }
    updateStopsVisibility();
}

function updateStopsVisibility() { }

function createStopMarker(stop) {
    const marker = L.marker([stop.stop_lat, stop.stop_lon], {
        icon: L.divIcon({
            className: 'stop-marker',
            html: `<div class="stop-dot"></div>`,
        })
    });
    marker.on('click', () => showSchedulePanel(stop));
    return marker;
}

function formatArrivalTime(isoTime, now = new Date()) {
    if (!isoTime) return { text: '', css: '' };

    const target = new Date(isoTime);
    const now_date = new Date(now);
    let diff = (target - now_date) / 1000;

    if (diff < -60) diff += 24 * 3600;
    const min = Math.round(diff / 60);

    if (min < 0) return { text: '', css: '' };
    if (min < 10) return { text: `${min} min`, css: 'soon' };
    if (min < 60) return { text: `${min} min`, css: '' };

    const hours = String(target.getHours()).padStart(2, '0');
    const minutes = String(target.getMinutes()).padStart(2, '0');
    return { text: `${hours}:${minutes}`, css: '' };
}

function getTimeDiffMinutes(gtfsTime, now) {
    if (!gtfsTime) return 99999;
    const [h, m, s] = gtfsTime.split(':').map(Number);
    let target = new Date(now);
    target.setHours(h, m, s || 0, 0);
    if (h >= 24) target.setHours(h - 24 + 0, m, s || 0, 0);
    let diff = (target - now) / 1000 / 60;
    if (diff < -10) diff += 24 * 60;
    return diff;
}

// --- Schedule panel: only nearest, show debug for real-time ---
async function showSchedulePanel(stop) {
    const panel = document.getElementById('schedule-panel');
    const content = panel.querySelector('.schedule-content');
    panel.classList.add('active');
    document.getElementById('map').classList.add('map-blur');
    content.innerHTML = '<div class="loading-schedule"><div class="spinner"></div><span>Loading...</span></div>';

    try {
        const staticRes = await fetch(`${API_BASE}/api/stops/${stop.stop_id}/schedule`);
        const staticJson = staticRes.ok ? await staticRes.json() : null;

        console.log('staticJson', staticJson);

        let html = `<h4 style="margin:0 0 16px 0;">${stop.stop_name}</h4>`;

        if (staticJson?.success && staticJson.data?.['stop-schedule']?.['route-schedules']) {
            const routeSchedules = staticJson.data['stop-schedule']['route-schedules'];

            if (routeSchedules.length === 0) {
                html += '<div class="no-schedule">No schedule data available</div>';
            } else {
                routeSchedules.forEach(routeSchedule => {
                    const routeNumber = routeSchedule.route.number;
                    const scheduledStops = routeSchedule['scheduled-stops'];

                    if (scheduledStops && scheduledStops.length > 0) {
                        let badges = [];
                        let now = new Date();

                        scheduledStops.forEach(scheduledStop => {
                            const departureTime = scheduledStop.times.departure.scheduled;
                            let fmt = formatArrivalTime(departureTime, now);
                            badges.push(`<span class="arrival-badge live${fmt.css ? ' ' + fmt.css : ''}">Live · ${fmt.text}</span>`);
                        });

                        html += `
                            <div class="route-item">
                                <span class="route-circle" data-route-id="${routeNumber}">${routeNumber}</span>
                                ${badges.length > 0 ? badges.join('') : '<span style="color:#888;font-size:13px;margin-left:10px;">No upcoming arrivals</span>'}
                            </div>
                        `;
                    } else {
                        html += `<div class="no-schedule">No schedule data available for route ${routeNumber}</div>`;
                    }
                });
            }
        } else {
            html += '<div class="no-schedule">No schedule data available</div>';
        }

        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = '<div class="no-schedule">Failed to load schedule</div>';
    }
}

function closeSchedulePanel() {
    document.getElementById('schedule-panel').classList.remove('active');
    document.getElementById('map').classList.remove('map-blur');
}

// ======== МАРШРУТ + АВТОБУСЫ LIVE/SCHEDULE ===========

function clearRouteAndBuses() {
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }
    busMarkers.forEach(m => map.removeLayer(m));
    busMarkers = [];
    if (busUpdater) {
        clearInterval(busUpdater);
        busUpdater = null;
    }
    currentRouteId = null;
}

function showRouteAndBuses(routeId) {
    clearRouteAndBuses();
    currentRouteId = routeId;
}

async function updateFakeBuses() {
    if (!currentRouteId) return;
    busMarkers.forEach(m => map.removeLayer(m));
    busMarkers = [];
    const redBusIcon = L.icon({
        iconUrl: 'bus-red.svg',
        iconSize: [40, 40],
        iconAnchor: [20, 35],
        popupAnchor: [0, -30]
    });
    const grayBusIcon = L.icon({
        iconUrl: 'bus-gray.svg',
        iconSize: [40, 40],
        iconAnchor: [20, 35],
        popupAnchor: [0, -30]
    });
}

// --- Навешиваем обработчик на кружки маршрутов в расписании ---
document.addEventListener('click', function (e) {
    if (e.target.classList.contains('route-circle')) {
        const routeId = e.target.dataset.routeId || e.target.textContent.trim();
        if (routeId) showRouteAndBuses(routeId);
    }
});

// --- При закрытии schedule-panel удаляем маршрут и автобусы ---
document.getElementById('close-schedule').addEventListener('click', clearRouteAndBuses);

window.addEventListener('DOMContentLoaded', initMap);