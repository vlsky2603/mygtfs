
// main_dynamic.js

const API_BASE = 'http://localhost:8080';
let map;
let markers = new Map();
let allStops = [];
let centerMarker;
let radiusCircle;
let filters = { direction: null, street: null };
const FIXED_RADIUS = 400;
let darkMode = false;

// --- UI и фильтры ---
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
    .addEventListener('click', closeSchedulePanel);
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
  document.getElementById('direction-filter').value = '';
  document.getElementById('street-search').value = '';
  document.getElementById('street-filter').value = '';
  updateActiveFiltersDisplay();
  updateStopsVisibility();
}
function updateActiveFiltersDisplay() {
  const parts = [];
  if (filters.direction) parts.push(filters.direction);
  if (filters.street)    parts.push(filters.street);
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

// --- Темная тема ---
function toggleDarkMode() {
  darkMode = !darkMode;
  localStorage.setItem('darkMode', darkMode);
  document.body.classList.toggle('dark-mode');
  const btn = document.getElementById('theme-toggle');
  btn.innerHTML = darkMode
    ? '<i class="fas fa-sun"></i>'
    : '<i class="fas fa-moon"></i>';
  // перезагрузить плитку
  const url = darkMode
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  L.tileLayer(url, { attribution:'© OpenStreetMap, © CartoDB' }).addTo(map);
}

// --- Геолокация ---
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

// --- Инициализация карты ---
function initMap() {
  darkMode = localStorage.getItem('darkMode') === 'true';
  if (darkMode) document.body.classList.add('dark-mode');

  map = L.map('map', { renderer: L.canvas(), zoomControl: false, tap: false })
    .setView([49.8955, -97.1384], 13);
  L.control.zoom({ position: 'topright' }).addTo(map);

  const tileUrl = darkMode
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  L.tileLayer(tileUrl, { attribution:'© OpenStreetMap, © CartoDB', maxZoom:18 }).addTo(map);

  centerMarker = L.marker(map.getCenter(), {
    icon: L.divIcon({ className:'center-marker', html:'<div class="center-marker-dot"></div>' }),
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
  map.on('moveend', () => updateStops());
  updateStops();
}

// --- Загрузка и отрисовка остановок ---
async function updateStops() {
  const load = document.getElementById('loading');
  load.style.display = 'flex';
  const { lat, lng } = map.getCenter();
  try {
    const res = await fetch(`${API_BASE}/api/stops/nearby?lat=${lat}&lon=${lng}`);
    const json = await res.json();
    allStops = json.stops;
    refreshMarkers();
  } catch (e) {
    console.error(e);
  } finally {
    load.style.display = 'none';
  }
}
function refreshMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers.clear();
  allStops.forEach(stop => {
    const m = createStopMarker(stop);
    markers.set(stop.id, m).addTo(map);
  });
  updateStopsVisibility();
}
function updateStopsVisibility() {
  markers.forEach((m, id) => {
    const stop = allStops.find(s => s.id === id);
    const d = getDistance(stop.latitude, stop.longitude,
                          map.getCenter().lat, map.getCenter().lng);
    if (d <= FIXED_RADIUS &&
        (!filters.direction || stop.direction === filters.direction) &&
        (!filters.street    || stop.streetName === filters.street)) {
      m.addTo(map);
    } else {
      map.removeLayer(m);
    }
  });
}

// --- Маркер остановки ---
function createStopMarker(stop) {
  const html = `<div class="stop-marker"><span>${stop.code || stop.id}</span></div>`;
  const icon = L.divIcon({ html, className:'', iconSize:[30,30] });
  return L.marker([stop.latitude, stop.longitude], { icon })
    .on('click', () => showSchedule(stop));
}

// --- Помощь ---
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1)*Math.PI/180, Δλ = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(Δφ/2)**2 +
            Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// --- Показ расписания ---
async function showSchedule(stop) {
  const panel = document.getElementById('schedule-panel');
  const content = panel.querySelector('.schedule-content');
  panel.classList.add('active');
  document.getElementById('map').classList.add('map-blur');
  content.innerHTML = '<div class="loading-schedule"><div class="spinner"></div><span>Loading...</span></div>';

  try {
    const [liveRes, staticRes] = await Promise.all([
      fetch(`${API_BASE}/api/stops/${stop.id}/schedule`),
      fetch(`${API_BASE}/api/gtfs/schedule/${stop.id}`)
    ]);
    const liveJson   = liveRes.ok   ? await liveRes.json()   : null;
    const staticJson = staticRes.ok ? await staticRes.json() : null;

    let html = `<h3>${stop.name}</h3><div class="route-list">`;
    if (liveJson?.success) {
      liveJson.data['stop-schedule']['route-schedules'].forEach(r => {
        const times = r['scheduled-stops']
          .map(s => s.times.arrival.estimated || s.times.arrival.scheduled)
          .slice(0,3).join(', ');
        const num = r.route.number || r.route.name;
        html += `<div class="route-item"><span class="route-circle">${num}</span>${times}</div>`;
      });
    } else {
      html += '<div class="no-schedule">No live data</div>';
    }
    html += '</div><div class="static-list"><h4>Static GTFS</h4>';
    if (staticJson?.success) {
      const now   = Date.now();
      const upcoming = staticJson.staticSchedule
        .map(r => ({t:new Date(r.arrival_time).getTime(), trip:r.trip_id}))
        .filter(x => x.t>=now).sort((a,b)=>a.t-b.t).slice(0,3);
      upcoming.forEach(u => {
        html += `<div class="route-item">${u.trip} – ${new Date(u.t).toLocaleTimeString()}</div>`;
      });
    } else {
      html += '<div class="no-schedule">No static data</div>';
    }
    html += '</div>';
    content.innerHTML = html;
  } catch (e) {
    console.error(e);
    content.innerHTML = '<div class="error">Error loading schedule</div>';
  }
}

// Закрытие панели
function closeSchedulePanel() {
  document.getElementById('schedule-panel').classList.remove('active');
  document.getElementById('map').classList.remove('map-blur');
}

document.addEventListener('DOMContentLoaded', initMap);
