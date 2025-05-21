
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
let routePolylines = []; // To store displayed route polylines
let busMarkers = new Map();
let busUpdateInterval = null;
let activeRouteData = null; // To store data needed for bus updates

// --- Rate Limiting ---
let apiRequestTimestamps = [];
const MAX_REQUESTS_PER_MINUTE = 100; // Max requests per minute
const ONE_MINUTE_MS = 60 * 1000;

function canMakeApiRequest() {
  const now = Date.now();
  // Remove timestamps older than one minute
  apiRequestTimestamps = apiRequestTimestamps.filter(timestamp => now - timestamp < ONE_MINUTE_MS);
  return apiRequestTimestamps.length < MAX_REQUESTS_PER_MINUTE;
}

function recordApiRequest() {
  apiRequestTimestamps.push(Date.now());
}

async function fetchWithRateLimit(url, options) {
  if (!canMakeApiRequest()) {
    console.warn(`Rate limit potentially exceeded for ${url}. Request blocked.`);
    // Return an error-like object or throw an error
    return Promise.resolve({
      ok: false,
      status: 429, // Too Many Requests
      json: () => Promise.resolve({ success: false, error: "Rate limit exceeded" }),
      text: () => Promise.resolve("Rate limit exceeded")
    });
  }
  recordApiRequest();
  return fetch(url, options);
}

// --- Caching ---
const CACHE_EXPIRY_MS = 6 * 60 * 60 * 1000; // 6 hours

function getFromCache(key) {
  const itemStr = localStorage.getItem(key);
  if (!itemStr) return null;
  try {
    const item = JSON.parse(itemStr);
    if (Date.now() - item.timestamp > CACHE_EXPIRY_MS) {
      localStorage.removeItem(key); // Expired
      return null;
    }
    return item.data;
  } catch (error) {
    console.error("Error reading from cache:", error);
    localStorage.removeItem(key); // Corrupted item
    return null;
  }
}

function saveToCache(key, data) {
  const item = {
    timestamp: Date.now(),
    data: data
  };
  try {
    localStorage.setItem(key, JSON.stringify(item));
  } catch (error) {
    console.error("Error saving to cache:", error);
    // Potentially handle quota exceeded error
  }
}


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
  const cacheKey = `cache_nearby_stops_${lat.toFixed(3)}_${lng.toFixed(3)}`; // Rounded key
  
  const cachedStops = getFromCache(cacheKey);
  if (cachedStops) {
    allStops = cachedStops;
    refreshMarkers();
    load.style.display = 'none';
    return;
  }

  try {
    const res = await fetchWithRateLimit(`${API_BASE}/api/stops/nearby?lat=${lat}&lon=${lng}`);
    if (!res.ok) {
        // Handle non-OK responses, e.g., rate limit error object
        console.error(`Failed to fetch nearby stops: ${res.status}`);
        if (res.status === 429) { // Rate limit error from fetchWithRateLimit
             // Optionally show a message to the user
        }
        // Potentially load from a fallback or older cache if available
        return; // Exit if fetch failed significantly
    }
    const json = await res.json();
    if (json.stops) { // Assuming the API returns { stops: [...] }
        allStops = json.stops;
        saveToCache(cacheKey, allStops);
        refreshMarkers();
    } else if (json.error) {
        console.error("Error from nearby stops API:", json.error);
    }

  } catch (e) {
    console.error("Error in updateStops:", e);
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
function clearBusMarkers() {
  if (busUpdateInterval) {
    clearInterval(busUpdateInterval);
    busUpdateInterval = null;
  }
  busMarkers.forEach(marker => map.removeLayer(marker));
  busMarkers.clear();
  activeRouteData = null; // Clear active data
}

// Helper function to interpolate position on a polyline
// polylinePoints: array of L.latLng or [lat, lon] objects, or [lat, lon] arrays
// progress: 0.0 to 1.0
function interpolateOnPolyline(polylinePoints, progress) {
    if (!polylinePoints || polylinePoints.length === 0) return null;

    // Ensure polylinePoints are L.latLng objects for distanceTo
    const points = polylinePoints.map(p => {
        if (Array.isArray(p)) return L.latLng(p[0], p[1]);
        return L.latLng(p); // Assumes p is already {lat: ..., lng: ...} or L.latLng
    });

    if (points.length === 1) return points[0];
    if (progress <= 0) return points[0];
    if (progress >= 1) return points[points.length - 1];

    let totalDistance = 0;
    const segmentDistances = []; // Distance from start to the END of each segment
    for (let i = 0; i < points.length - 1; i++) {
        const dist = points[i].distanceTo(points[i + 1]);
        totalDistance += dist;
        segmentDistances.push(totalDistance);
    }

    if (totalDistance === 0) return points[0]; // All points are the same

    const targetDistance = progress * totalDistance;

    for (let i = 0; i < segmentDistances.length; i++) {
        if (targetDistance <= segmentDistances[i]) {
            const segmentStartPoint = points[i];
            const segmentEndPoint = points[i + 1];
            const distanceIntoSegment = targetDistance - (i > 0 ? segmentDistances[i-1] : 0);
            const currentSegmentLength = segmentDistances[i] - (i > 0 ? segmentDistances[i-1] : 0);

            if (currentSegmentLength === 0) return segmentStartPoint; // Avoid division by zero for this segment

            const segmentProgress = distanceIntoSegment / currentSegmentLength;
            
            const lat = segmentStartPoint.lat + (segmentEndPoint.lat - segmentStartPoint.lat) * segmentProgress;
            const lng = segmentStartPoint.lng + (segmentEndPoint.lng - segmentStartPoint.lng) * segmentProgress;
            return L.latLng(lat, lng);
        }
    }
    // Fallback, should ideally be covered by progress >= 1 check
    return points[points.length - 1];
}

function clearRoutePolylines() {
  routePolylines.forEach(polyline => {
    if (map.hasLayer(polyline)) {
      map.removeLayer(polyline);
    }
  });
  routePolylines = [];
}

async function showSchedule(stop) {
  clearRoutePolylines(); // Clear existing routes first
  clearBusMarkers(); // Clear existing bus markers
  const panel = document.getElementById('schedule-panel');
  const content = panel.querySelector('.schedule-content');
  panel.classList.add('active');
  document.getElementById('map').classList.add('map-blur');
  content.innerHTML = '<div class="loading-schedule"><div class="spinner"></div><span>Loading...</span></div>';

  try {
    // Fetch live schedule (always fresh, rate-limited)
    const liveSchedulePromise = fetchWithRateLimit(`${API_BASE}/api/stops/${stop.id}/schedule`)
        .then(res => res.ok ? res.json() : Promise.resolve(null)); // Or handle error

    // Fetch static schedule (cacheable)
    const staticScheduleKey = `cache_static_schedule_stop_${stop.id}`;
    const cachedStaticSchedule = getFromCache(staticScheduleKey);
    const staticSchedulePromise = cachedStaticSchedule 
        ? Promise.resolve(cachedStaticSchedule)
        : fetchWithRateLimit(`${API_BASE}/api/gtfs/schedule/${stop.id}`)
            .then(async res => {
                if (!res.ok) return null; // Or handle error
                const data = await res.json();
                if (data) saveToCache(staticScheduleKey, data);
                return data;
            });

    // Fetch shapes data (cacheable)
    const shapesKey = `cache_shapes_stop_${stop.id}`;
    const cachedShapes = getFromCache(shapesKey);
    const shapesPromise = cachedShapes
        ? Promise.resolve(cachedShapes)
        : fetchWithRateLimit(`${API_BASE}/api/gtfs/shapes/stop/${stop.id}`)
            .then(async res => {
                if (!res.ok) return null; // Or handle error
                const data = await res.json();
                if (data) saveToCache(shapesKey, data);
                return data;
            });

    const [liveJson, staticJson, shapesJson] = await Promise.all([
        liveSchedulePromise,
        staticSchedulePromise,
        shapesPromise
    ]);

    let html = `<h3>${stop.name}</h3>`;
    let useLiveData = false;
    const ninetyMinutesAgo = Date.now() - (90 * 60 * 1000);

    if (liveJson?.success && liveJson.data['stop-schedule']['route-schedules']?.length > 0) {
      // Check if any estimated time is recent enough
      useLiveData = liveJson.data['stop-schedule']['route-schedules'].some(r => {
        return r['scheduled-stops'].some(s => {
          if (s.times.arrival.estimated) {
            // Assuming estimated time is in a format that can be parsed by Date constructor,
            // or it's a timestamp. GTFS-realtime often uses POSIX timestamps (seconds since epoch).
            // For this example, let's assume it's a string that needs parsing or a direct timestamp.
            // If it's a string like "HH:MM:SS", it needs to be combined with the current date.
            // For simplicity, let's assume it's a full date string or timestamp.
            // If the estimated time is just HH:MM, more complex parsing is needed.
            // Let's assume 'estimated' is a full ISO date string or a Unix timestamp (milliseconds)
            try {
                const estimatedTime = new Date(s.times.arrival.estimated).getTime();
                return estimatedTime >= ninetyMinutesAgo;
            } catch (parseError) {
                // If parsing fails, or it's not a directly usable timestamp
                // A common format is HH:MM:SS. This needs careful handling.
                // For now, if it's not easily parsable to a full date/time, we might skip this check
                // or implement more robust parsing.
                // console.warn("Could not parse estimated time:", s.times.arrival.estimated);
                // Fallback: check if scheduled time is not too old (less robust)
                if (s.times.arrival.scheduled) {
                    const scheduledTime = new Date(s.times.arrival.scheduled).getTime();
                    return scheduledTime >= ninetyMinutesAgo;
                }
                return false;
            }
          }
          return false;
        });
      });
    }

    if (useLiveData) {
      html += '<div class="data-source-indicator">Live Data</div>';
      html += '<div class="route-list">';
      liveJson.data['stop-schedule']['route-schedules'].forEach(r => {
        const routeNum = r.route.number || r.route.name;
        const upcomingLiveStops = r['scheduled-stops']
          .map(s => {
            const estimatedTime = s.times.arrival.estimated ? new Date(s.times.arrival.estimated).getTime() : null;
            const scheduledTime = new Date(s.times.arrival.scheduled).getTime();
            return {
              time: estimatedTime || scheduledTime,
              displayTime: estimatedTime ? new Date(estimatedTime).toLocaleTimeString() : new Date(scheduledTime).toLocaleTimeString(),
              variantName: s.variant?.name || ''
            };
          })
          .filter(s => s.time >= Date.now()) // Filter for upcoming times only
          .sort((a, b) => a.time - b.time)   // Sort by time
          .slice(0, 3); // Show up to 3 upcoming times per route

        if (upcomingLiveStops.length > 0) {
          upcomingLiveStops.forEach(s => {
            html += `<div class="route-item"><span class="route-circle">${routeNum}</span> ${s.variantName} ${s.displayTime}</div>`;
          });
        } else {
          // Optionally, indicate if a specific live route has no upcoming times
          // html += `<div class="route-item"><span class="route-circle">${routeNum}</span> No upcoming live times.</div>`;
        }
      });
      // Add a message if no live routes had any upcoming times at all
      if (html.endsWith('<div class="route-list">')) { // Check if nothing was added to route-list
          html += '<div class="no-schedule">No upcoming live departures.</div>';
      }
      html += '</div>';
    } else if (staticJson?.success && staticJson.staticSchedule?.length > 0) {
      html += '<div class="data-source-indicator">Local Schedule</div>';
      html += '<div class="route-list">'; // Use same class for consistent styling
      const now = Date.now();
      const upcomingStatic = staticJson.staticSchedule
        .map(r => ({
          t: new Date(r.arrival_time).getTime(),
          trip: r.trip_id,
          routeName: r.route_short_name || r.trip_id // Assuming route_short_name is available
        }))
        .filter(x => x.t >= now)
        .sort((a, b) => a.t - b.t)
        .slice(0, 5); // Show a few upcoming static times

      if (upcomingStatic.length > 0) {
        upcomingStatic.forEach(u => {
          html += `<div class="route-item"><span class="route-circle">${u.routeName}</span> ${new Date(u.t).toLocaleTimeString()}</div>`;
        });
      } else {
        html += '<div class="no-schedule">No upcoming departures in local schedule.</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="no-schedule">No schedule data available.</div>';
    }
    content.innerHTML = html;

    // Prepare data for bus simulation and draw route shapes
    activeRouteData = { trips: [] };
    const displayedTripIds = new Set();

    if (shapesJson?.success && shapesJson.shapes) {
        // Create a map of shape_id to points for easy lookup
        const shapeMap = new Map();
        shapesJson.shapes.forEach(sd => {
            // Assuming sd.shape_id and sd.points exist
            // And sd.points are [{lat: y, lon: x}, ...]
            if (sd.shape_id && sd.points) {
                 shapeMap.set(sd.shape_id, sd.points.map(p => [p.lat, p.lon]));
            }
        });

        // Prioritize static data for bus simulation due to trip structure
        if (staticJson?.success && staticJson.staticSchedule?.length > 0) {
            const tripsData = new Map(); // Group stop_times by trip_id
            staticJson.staticSchedule.forEach(sch => {
                if (!tripsData.has(sch.trip_id)) {
                    tripsData.set(sch.trip_id, {
                        trip_id: sch.trip_id,
                        shape_id: sch.shape_id, // Assuming shape_id is in staticSchedule
                        stop_times: [],
                        route_color: sch.route_color || null // Assuming route_color is available
                    });
                }
                tripsData.get(sch.trip_id).stop_times.push({
                    stop_id: sch.stop_id,
                    arrival: new Date(sch.arrival_time).getTime(),
                    departure: new Date(sch.departure_time).getTime(),
                    // stop_sequence: sch.stop_sequence // if available and needed
                });
            });

            tripsData.forEach(trip => {
                // Sort stop_times just in case (should be by stop_sequence or time)
                trip.stop_times.sort((a,b) => a.arrival - b.arrival);
                const polylinePoints = shapeMap.get(trip.shape_id);
                if (polylinePoints && polylinePoints.length > 1) {
                    activeRouteData.trips.push({
                        trip_id: trip.trip_id,
                        polyline: polylinePoints,
                        stop_times: trip.stop_times,
                        route_color: trip.route_color
                    });
                    displayedTripIds.add(trip.trip_id);

                    // Draw polyline for this trip's shape if not already drawn by a generic route display
                    // For simplicity, assuming showSchedule already draws general route lines.
                    // Here we ensure polylines used by active buses are drawn.
                    // To avoid duplicates, this logic might need refinement with how routePolylines is populated.
                    // For now, let's assume routePolylines are handled generically for the stop,
                    // and bus simulation will use specific trip polylines.
                }
            });
        }
        // TODO: Add similar logic for liveJson if it can be adapted for trip-specific data.
        // This is complex because liveJson is route-based, not trip-based.
    }
    
    // Draw the generic route polylines (as before)
    // This part might need to be smarter to avoid drawing a route if all its trips are already drawn above,
    // or ensure colors match, etc. For now, keeping original polyline drawing logic separate.
    if (shapesJson?.success && shapesJson.shapes?.length > 0) {
        shapesJson.shapes.forEach(shapeData => { // This might be redundant if activeRouteData covers all display.
            // This shapeData is the generic one from API, may not be trip specific.
            // Let's assume it contains a general "shape_id" or "route_id" for display.
            const generalShapeId = shapeData.shape_id || shapeData.id; // example properties
            const polylinePointsToDraw = shapeData.points?.map(p => [p.lat, p.lon]);

            if (polylinePointsToDraw && polylinePointsToDraw.length > 1) {
                 // Check if a polyline for this general shape is already part of activeRouteData
                 // to avoid double drawing. This is a simplified check.
                let alreadyDrawnByActiveTrip = false;
                if (generalShapeId) {
                    for(const trip of activeRouteData.trips) {
                        if (trip.shape_id === generalShapeId) { // Assumes trip object has shape_id
                            alreadyDrawnByActiveTrip = true;
                            break;
                        }
                    }
                }

                if (!alreadyDrawnByActiveTrip) {
                    const pColor = shapeData.color || (darkMode ? '#6bbaff' : '#007bff');
                    const polyline = L.polyline(polylinePointsToDraw, {
                        color: pColor, weight: 4, opacity: 0.65
                    }).addTo(map);
                    routePolylines.push(polyline); // Add to general list for clearing
                }
            }
        });
    }


    if (activeRouteData.trips.length > 0) {
        startBusUpdates();
    }

  } catch (e) {
    console.error("Error in showSchedule (schedule/shapes/bus prep):", e);
    content.innerHTML = '<div class="error">Error loading schedule, shapes, or preparing bus data.</div>';
  }
}

function startBusUpdates() {
  if (busUpdateInterval) clearInterval(busUpdateInterval);
  updateBusPositions(); // Initial call
  busUpdateInterval = setInterval(updateBusPositions, 10000); // Update every 10 seconds
}

// --- Bus Position Update Logic ---
function updateBusPositions() {
  if (!activeRouteData || !activeRouteData.trips || activeRouteData.trips.length === 0) {
    // No active trips to simulate, or data not ready
    // Consider clearing any remaining bus markers if any edge case left them
    // busMarkers.forEach(marker => map.removeLayer(marker));
    // busMarkers.clear();
    return;
  }

  const now = Date.now();
  const busIcon = L.icon({ iconUrl: 'bus-red.svg', iconSize: [25, 25], className: 'bus-icon' });
  const currentActiveBuses = new Set(); // Keep track of buses updated in this cycle

  activeRouteData.trips.forEach(trip => {
    if (!trip.polyline || trip.polyline.length < 2 || !trip.stop_times || trip.stop_times.length < 2) {
      return; // Not enough data for this trip
    }

    let prevStop = null;
    let nextStop = null;

    // Find previous and next stop based on current time
    for (let i = 0; i < trip.stop_times.length; i++) {
      const st = trip.stop_times[i];
      if (st.departure <= now) {
        prevStop = st;
      } else if (st.arrival > now) {
        nextStop = st;
        break; 
      }
      // If current time is between arrival and departure of a stop (dwelling)
      if (st.arrival <= now && st.departure > now && !nextStop) {
          prevStop = st; // Bus is at this stop
          nextStop = st; // Treat as at this stop, progress = 0 towards itself effectively
          break;
      }
    }
    
    // Handle edge cases: trip not started, trip ended, or at a stop
    if (!prevStop || !nextStop) { // Trip hasn't started or has already ended for these stops
        // console.log(`Trip ${trip.trip_id}: Not active or ended.`);
        return;
    }

    let progress = 0;
    if (prevStop.stop_id === nextStop.stop_id) { // Bus is dwelling at a stop
        progress = 0; // Position it at the stop itself
        // The polyline point for this stop is needed. This requires stop_coords in activeRouteData or lookup.
        // For now, use prevStop's point on polyline (approximate)
        // This needs shape_dist_traveled or stop coordinates mapped to polyline points.
        // Simplification: find closest polyline point to prevStop. Or if stop_times include coords.
        // For now, if dwelling, we'll just show it at prevStop's segment start.
        // A better way is to find the polyline point corresponding to prevStop.
        // This part is complex without stop_dist_traveled in shapes.txt or stop coordinates.
        // Let's assume for now we try to find the point on polyline closest to stop_id geo coordinates if available.
        // Or if prevStop has coordinates:
        // const busPosition = L.latLng(prevStop.lat, prevStop.lon); // if stop_times had lat/lon
        // For now, this case will effectively show it at start of segment from prevStop if not handled better.
    } else {
        const prevStopTime = prevStop.departure;
        const nextStopTime = nextStop.arrival;
        if (nextStopTime <= prevStopTime) { // Invalid times or very short segment
             progress = 0; // Default to prevStop
        } else {
             progress = (now - prevStopTime) / (nextStopTime - prevStopTime);
        }
    }
    progress = Math.max(0, Math.min(1, progress)); // Clamp progress

    // Interpolate position on the polyline
    // This assumes trip.polyline is for the segment prevStop <-> nextStop.
    // This is a simplification. GTFS shapes are for whole trips.
    // We need to interpolate along the *entire trip polyline* based on overall progress,
    // OR identify sub-segment of polyline for prevStop to nextStop.
    // The current `interpolateOnPolyline` takes overall progress on the given polyline.
    // If trip.polyline is the *full* trip shape, we need to map prev/next stops to distances along this shape.
    // This is where `shape_dist_traveled` from GTFS is essential.
    // Lacking that, a major simplification:
    // Assume prevStop is point 0 and nextStop is point N of trip.polyline for segment interpolation. This is wrong.
    // Correct approach: use `interpolateOnPolyline(trip.polyline, overallTripProgress)`
    // where `overallTripProgress` is calculated based on total trip duration and current time from trip start.
    // OR, if we have `shape_dist_traveled` for each stop in `trip.stop_times` and for polyline points:
    //   1. Get shape_dist_traveled for prevStop (d1) and nextStop (d2).
    //   2. Calculate partial progress: (now - prevStop.departure) / (nextStop.arrival - prevStop.departure)
    //   3. Target distance on shape: d1 + partialProgress * (d2 - d1)
    //   4. Interpolate on trip.polyline to this targetDistance. (interpolateOnPolyline modified to take distance)

    // Using the simpler (but less accurate) progress along the *entire* trip polyline for now.
    // This means `progress` needs to be total trip progress, not segment progress.
    // Re-evaluating `progress` calculation:
    const firstStopDeparture = trip.stop_times[0].departure;
    const lastStopArrival = trip.stop_times[trip.stop_times.length -1].arrival;
    let overallTripProgress = 0;
    if (now < firstStopDeparture) overallTripProgress = 0;
    else if (now > lastStopArrival) overallTripProgress = 1;
    else if (lastStopArrival > firstStopDeparture) { // Avoid division by zero
        overallTripProgress = (now - firstStopDeparture) / (lastStopArrival - firstStopDeparture);
    }
    
    // If bus is dwelling (prevStop === nextStop after logic adjustment)
    if (prevStop && nextStop && prevStop.stop_id === nextStop.stop_id) {
        // Find the point on the polyline that corresponds to prevStop
        // This is hard without shape_dist_traveled or stop coordinates.
        // Simplification: find the index of the stop in stop_times, then take a proportional point on polyline.
        let stopIndex = trip.stop_times.findIndex(st => st.stop_id === prevStop.stop_id);
        if (stopIndex !== -1) {
            overallTripProgress = stopIndex / (trip.stop_times.length -1); // Approximate progress
            overallTripProgress = Math.max(0, Math.min(1, overallTripProgress));
             // If it's the last stop, progress is 1.
            if (stopIndex === trip.stop_times.length -1) overallTripProgress = 1;
        } else {
            // Cannot determine dwelling position accurately, skip or place at start of prevStop's segment
        }
    }


    const busPosition = interpolateOnPolyline(trip.polyline, overallTripProgress);

    if (busPosition) {
      const busId = trip.trip_id; // Unique ID for the bus marker
      currentActiveBuses.add(busId);
      if (busMarkers.has(busId)) {
        busMarkers.get(busId).setLatLng(busPosition);
      } else {
        const marker = L.marker(busPosition, { icon: busIcon, zIndexOffset: 1000 }).addTo(map);
        // marker.bindPopup(`Bus (Trip ID: ${trip.trip_id})`); // Optional: for debugging
        busMarkers.set(busId, marker);
      }
    }
  });

  // Remove markers for buses that are no longer active
  busMarkers.forEach((marker, busId) => {
    if (!currentActiveBuses.has(busId)) {
      map.removeLayer(marker);
      busMarkers.delete(busId);
    }
  });
}


// Закрытие панели
function closeSchedulePanel() {
  document.getElementById('schedule-panel').classList.remove('active');
  document.getElementById('map').classList.remove('map-blur');
  clearRoutePolylines(); // Clear routes when schedule panel is closed
  clearBusMarkers(); // Also clear buses when schedule panel is closed
}

document.addEventListener('DOMContentLoaded', initMap);
