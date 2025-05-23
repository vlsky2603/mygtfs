// main_dynamic.js

const API_BASE = window.location.origin;
let map;
let markerClusterGroup; // For general stops
let routeStopMarkersLayerGroup; // For stops of a specific route

let allLocalStops = []; // From stops.txt
let gtfsData = {
    routes: [],
    trips: [],
    shapes: {}, // { shape_id: [{lat, lon, sequence}, ...] }
    stopTimes: [],
    routeToTrips: {},
    tripToShape: {},
    tripToStops: {},
    stopDetails: {}
};

let centerMarker; // Marker for the center of the draggable radius
let radiusCircle;
let userLocationMarker = null; // Marker for the user's actual GPS location

let filters = { direction: null, street: null, route: null };
const FIXED_RADIUS = 400;
let darkMode = false;
let currentRoutePolyline = null;
let debounceTimeout;
let currentStopForSchedulePanel = null;

// --- Favorite Stops Variables ---
let favorites = [];
const FAVORITES_STORAGE_KEY = 'transitMapFavoritesVlsky';

// Constants for map views
const DEFAULT_WINNIPEG_CENTER = [49.8955, -97.1384];
const INITIAL_USER_ZOOM = 17; 
const DEFAULT_ZOOM_UNCLUSTERED = 17; 
const FAVORITE_STOP_ZOOM = 18; 
const CLUSTER_DISABLE_ZOOM = 15; 


// --- Icons ---
const userLocationIcon = L.divIcon({
    className: 'user-location-marker', 
    html: '<div class="user-dot"></div><div class="user-pulse"></div>',
    iconSize: [24, 24], 
    iconAnchor: [12, 12] 
});


const loadingMessages = [ "Warming up the buses...", "Checking Portage & Main for stragglers...", "Navigating the North End maze...", "Counting bison... I mean, stops...", "Avoiding a 'Winnipeg handshake'...", "Finding the Forks, one stop at a time...", "Plotting routes, eh? Almost social-worthy!", "Don't be a snowbird, your data is coming!", "Almost there, buddy guy! Just a sec.", "Friendly Manitoba is loading your transit data!" ];
let lastLoadingMessageIndex = -1;
function getRandomLoadingMessage() { let randomIndex; do { randomIndex = Math.floor(Math.random() * loadingMessages.length); } while (randomIndex === lastLoadingMessageIndex && loadingMessages.length > 1); lastLoadingMessageIndex = randomIndex; return loadingMessages[randomIndex]; }

const scheduleWaitingMessages = [ "Consulting the transit spirits...", "Hold your toques, fetching times!", "Our hamsters are pedaling furiously for your schedule!", "Just a sec, asking the bus nicely if it's on time...", "Is it colder than a Winnipeg winter out there? We'll get your bus times soon!", "Polishing the Peggo card reader... and your schedule!", "Patience, young mosquito! The bus schedule is buzzing in.", "Recalibrating the Slurpee machine... Oh, and schedules.", "Wrangling the data like a true Manitoban cowboy!" ];
let lastScheduleWaitingMessageIndex = -1;
function getRandomScheduleWaitingMessage() { let randomIndex; do { randomIndex = Math.floor(Math.random() * scheduleWaitingMessages.length); } while (randomIndex === lastScheduleWaitingMessageIndex && scheduleWaitingMessages.length > 1); lastScheduleWaitingMessageIndex = randomIndex; return scheduleWaitingMessages[randomIndex]; }

const noScheduleMessages = [ "Looks like the buses are taking a nap here!", "No upcoming buses... time for a Portage Ave stroll?", "This stop is quiet. Too quiet. Maybe a coffee at Timmies?", "Is the bus playing hide and seek? Or just stuck on Pembina?", "Zilch. Nada. No buses soon, sorry eh.", "Even the Goldeyes have more action right now.", "Did a moose eat the schedule for this stop?", "This stop's as empty as the Jets' trophy case... (kidding, mostly!)", "Perhaps it's time to embrace the 'Winterpeg' walk?" ];
let lastNoScheduleMessageIndex = -1;
function getRandomNoScheduleMessage() { let randomIndex; do { randomIndex = Math.floor(Math.random() * noScheduleMessages.length); } while (randomIndex === lastNoScheduleMessageIndex && noScheduleMessages.length > 1); lastNoScheduleMessageIndex = randomIndex; return noScheduleMessages[randomIndex]; }


// --- Loading Overlay Functions ---
const loadingOverlay = document.getElementById('loading');
const loadingOverlayTextSpan = loadingOverlay?.querySelector('.loading-text'); 

function showLoadingOverlay(message) {
    if (loadingOverlay) {
        if (loadingOverlayTextSpan) loadingOverlayTextSpan.textContent = message || getRandomLoadingMessage();
        loadingOverlay.classList.add('visible');
    }
}
function hideLoadingOverlay() {
    if (loadingOverlay) {
        loadingOverlay.classList.remove('visible');
    }
}
// --- End Loading Overlay Functions ---


// --- Favorite Stops Functions ---
function loadFavorites() {
    const storedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (storedFavorites) {
        try {
            favorites = JSON.parse(storedFavorites);
            if (!Array.isArray(favorites)) favorites = [];
        } catch (e) {
            console.error("Error parsing favorites from localStorage:", e);
            favorites = [];
        }
    } else {
        favorites = [];
    }
    renderFavoritesPanel();
}

function saveFavorites() {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    renderFavoritesPanel();
    updateFavoriteButtonInSchedulePanel();
    if (map && (markerClusterGroup.getLayers().length > 0 || routeStopMarkersLayerGroup.getLayers().length > 0)) {
        refreshMarkers(map.getCenter());
         if (filters.route) {
            showRouteAndBuses(filters.route);
        }
    }
}

function isFavorite(stopId) {
    return favorites.some(fav => String(fav.stop_id) === String(stopId));
}

function addFavorite(stopData) {
    if (!stopData || !stopData.stop_id) {
        console.error("Invalid stop data for adding favorite.");
        return;
    }
    const stopIdStr = String(stopData.stop_id);
    if (isFavorite(stopIdStr)) return;

    const defaultName = stopData.stop_name || `Stop #${stopIdStr}`;
    const customName = prompt(`Enter a custom name for stop "${defaultName}":`, defaultName);

    const newFavorite = {
        stop_id: stopIdStr,
        custom_name: (customName && customName.trim() !== "") ? customName.trim() : defaultName,
        original_name: defaultName,
        lat: parseFloat(stopData.stop_lat),
        lon: parseFloat(stopData.stop_lon)
    };
    favorites.push(newFavorite);
    saveFavorites(); 
}

function removeFavorite(stopId) {
    const stopIdStr = String(stopId);
    favorites = favorites.filter(fav => fav.stop_id !== stopIdStr);
    saveFavorites(); 
}

function editFavoriteName(stopId) {
    const stopIdStr = String(stopId);
    const favorite = favorites.find(fav => fav.stop_id === stopIdStr);
    if (!favorite) return;

    const newCustomName = prompt(`Enter new name for "${favorite.custom_name}":`, favorite.custom_name);
    if (newCustomName !== null) {
        favorite.custom_name = (newCustomName.trim() !== "") ? newCustomName.trim() : favorite.original_name;
        saveFavorites(); 
    }
}

function renderFavoritesPanel() {
    const container = document.querySelector('#favorites-panel .favorites-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (favorites.length === 0) {
        container.innerHTML = '<p class="no-favorites">You have no favorite stops yet. Add some from the schedule panel!</p>';
        return;
    }

    favorites.forEach(fav => {
        const item = document.createElement('div');
        item.className = 'favorite-item';
        item.dataset.stopId = fav.stop_id;

        item.innerHTML = `
            <div class="favorite-item-info" title="Show schedule for ${fav.custom_name}">
                <span class="favorite-name">${fav.custom_name}</span>
                <span class="favorite-original-name">${fav.original_name} (#${fav.stop_id})</span>
            </div>
            <div class="favorite-item-actions">
                <button class="action-edit-name" title="Edit Name"><i class="fas fa-edit"></i></button>
                <button class="action-remove-favorite" title="Remove Favorite"><i class="fas fa-trash"></i></button>
            </div>
        `;
        
        item.querySelector('.favorite-item-info').addEventListener('click', () => {
            const stopLat = parseFloat(fav.lat);
            const stopLon = parseFloat(fav.lon);

            if (map && !isNaN(stopLat) && !isNaN(stopLon)) {
                map.setView([stopLat, stopLon], FAVORITE_STOP_ZOOM, { animate: true });
            }
            
            setTimeout(() => {
                const stopDetail = allLocalStops.find(s => String(s.stop_id) === String(fav.stop_id));
                if (stopDetail) {
                    showSchedulePanel(stopDetail);
                } else { 
                    showSchedulePanel({
                        stop_id: fav.stop_id,
                        stop_name: fav.original_name,
                        stop_lat: stopLat,
                        stop_lon: stopLon
                    });
                }
            }, 0);

            closeFavoritesPanel(); 
        });

        item.querySelector('.action-edit-name').addEventListener('click', (e) => {
            e.stopPropagation();
            editFavoriteName(fav.stop_id);
        });
        item.querySelector('.action-remove-favorite').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Remove "${fav.custom_name}" from favorites?`)) {
                removeFavorite(fav.stop_id);
            }
        });
        container.appendChild(item);
    });
}
// --- End Favorite Stops Functions ---

function parseCSV(csvText, requiredFields = []) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const result = [];
    const normalizedRequiredFields = requiredFields.map(f => f.toLowerCase());

    if (normalizedRequiredFields.length > 0) {
        for (const reqField of normalizedRequiredFields) {
            if (!headers.includes(reqField)) {
                console.error(`Required field "${reqField}" not found in CSV headers: [${headers.join(', ')}].`);
                return [];
            }
        }
    }

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length === headers.length) {
            const obj = {};
            let validEntry = true;
            for (let j = 0; j < headers.length; j++) {
                const header = headers[j];
                let value = values[j].trim();
                if (['shape_pt_lat', 'shape_pt_lon', 'stop_lat', 'stop_lon'].includes(header)) {
                    value = parseFloat(value);
                    if (isNaN(value)) { validEntry = false; break; }
                } else if (['shape_pt_sequence', 'stop_sequence'].includes(header) || header.includes('count')) {
                    value = parseInt(value, 10);
                    if (isNaN(value)) { validEntry = false; break; }
                }
                obj[header] = value;
            }
            if (validEntry) result.push(obj);
        }
    }
    return result;
}

async function loadAndProcessGTFS() {
    console.log("Starting GTFS data load..."); 
    try { 
        const stopsResponse = await fetch('./stops.txt'); 
        if (!stopsResponse.ok) throw new Error(`stops.txt: ${stopsResponse.status}`); 
        allLocalStops = parseCSV(await stopsResponse.text(), ['stop_id', 'stop_name', 'stop_lat', 'stop_lon']); 
        allLocalStops.forEach(s => gtfsData.stopDetails[s.stop_id] = s); 
        
        const routesResponse = await fetch('./routes.txt'); 
        if (!routesResponse.ok) throw new Error(`routes.txt: ${routesResponse.status}`); 
        gtfsData.routes = parseCSV(await routesResponse.text(), ['route_id', 'route_short_name', 'route_long_name', 'route_desc']); 
        populateRouteFilter(); 
        
        const tripsResponse = await fetch('./trips.txt'); 
        if (!tripsResponse.ok) throw new Error(`trips.txt: ${tripsResponse.status}`); 
        gtfsData.trips = parseCSV(await tripsResponse.text(), ['route_id', 'trip_id', 'shape_id']); 
        gtfsData.trips.forEach(trip => { if (!gtfsData.routeToTrips[trip.route_id]) gtfsData.routeToTrips[trip.route_id] = []; gtfsData.routeToTrips[trip.route_id].push(trip.trip_id); if (trip.shape_id?.trim()) gtfsData.tripToShape[trip.trip_id] = trip.shape_id; }); 
        
        const shapesResponse = await fetch('./shapes.txt'); 
        if (!shapesResponse.ok) throw new Error(`shapes.txt: ${shapesResponse.status}`); 
        const shapesRaw = parseCSV(await shapesResponse.text(), ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence']); 
        shapesRaw.forEach(shapePt => { if (!gtfsData.shapes[shapePt.shape_id]) gtfsData.shapes[shapePt.shape_id] = []; gtfsData.shapes[shapePt.shape_id].push({ lat: shapePt.shape_pt_lat, lon: shapePt.shape_pt_lon, sequence: shapePt.shape_pt_sequence }); }); 
        for (const shapeId in gtfsData.shapes) gtfsData.shapes[shapeId].sort((a, b) => a.sequence - b.sequence); 
        
        const stopTimesResponse = await fetch('./stop_times.txt'); 
        if (!stopTimesResponse.ok) throw new Error(`stop_times.txt: ${stopTimesResponse.status}`); 
        gtfsData.stopTimes = parseCSV(await stopTimesResponse.text(), ['trip_id', 'stop_id', 'stop_sequence']); 
        gtfsData.stopTimes.forEach(st => { if (!gtfsData.tripToStops[st.trip_id]) gtfsData.tripToStops[st.trip_id] = []; gtfsData.tripToStops[st.trip_id].push({ stop_id: st.stop_id, stop_sequence: st.stop_sequence }); }); 
        for (const tripId in gtfsData.tripToStops) gtfsData.tripToStops[tripId].sort((a, b) => a.stop_sequence - b.stop_sequence); 
        
        console.log("GTFS Data fully processed."); 
        
        loadFavorites(); 
        populateStreetFilter(); 
        refreshMarkers(map.getCenter()); 

        hideLoadingOverlay();

    } catch (error) { 
        console.error("GTFS Load/Process Error:", error); 
        showLoadingOverlay(`Error: ${error.message}. Please refresh.`);
    }
}

function populateRouteFilter() {
    const routeSelect = document.getElementById('route-filter'); 
    if (!routeSelect) return; 
    while (routeSelect.options.length > 1) routeSelect.remove(1); 
    const routesWithData = gtfsData.routes.filter(r => gtfsData.routeToTrips[r.route_id]?.length > 0); 
    routesWithData.sort((a, b) => { const numA = parseInt(a.route_short_name, 10); const numB = parseInt(b.route_short_name, 10); if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB; return String(a.route_short_name).localeCompare(String(b.route_short_name)); }).forEach(route => { const option = document.createElement('option'); option.value = route.route_id; const shortName = route.route_short_name || 'N/A'; let longName = route.route_long_name?.trim() || route.route_desc?.trim() || ''; option.text = shortName + (longName && longName !== shortName ? ` - ${longName}` : ''); routeSelect.add(option); });
}

function initUI() {
    document.getElementById('filter-toggle')?.addEventListener('click', toggleFilterPanel);
    document.getElementById('close-filters')?.addEventListener('click', closeFilterPanel);
    document.getElementById('reset-filters')?.addEventListener('click', resetFilters);
    document.getElementById('favorites-toggle')?.addEventListener('click', toggleFavoritesPanel);
    document.getElementById('close-favorites-panel')?.addEventListener('click', closeFavoritesPanel);
    document.getElementById('direction-filter')?.addEventListener('change', e => { filters.direction = e.target.value || null; updateActiveFiltersDisplay(); if (filters.route) showRouteAndBuses(filters.route); else refreshMarkers(map.getCenter()); });
    document.getElementById('street-search')?.addEventListener('input', updateStreetSearch);
    document.getElementById('street-filter')?.addEventListener('change', e => { filters.street = e.target.value || null; updateActiveFiltersDisplay(); if (filters.route) showRouteAndBuses(filters.route); else refreshMarkers(map.getCenter()); });
    document.getElementById('location-button')?.addEventListener('click', locateUser); 
    document.getElementById('theme-toggle')?.addEventListener('click', toggleDarkMode);
    document.getElementById('route-filter')?.addEventListener('change', onSelectRoute);
    const headerControls = document.getElementById('header-controls'); 
    if (headerControls && !document.getElementById('reset-route-button')) { 
        const resetRouteButton = document.createElement('button'); 
        resetRouteButton.id = 'reset-route-button'; 
        resetRouteButton.className = 'control-button'; 
        resetRouteButton.innerHTML = '<i class="fas fa-route"></i><i class="fas fa-times" style="font-size:0.5em;position:absolute;top:8px;right:8px;color:white;background:var(--error-color);border-radius:50%;padding:2px;"></i>'; 
        resetRouteButton.title = 'Clear selected route'; 
        resetRouteButton.style.display = 'none'; 
        resetRouteButton.addEventListener('click', handleResetRoute); 
        const favoritesButton = document.getElementById('favorites-toggle'); 
        if (favoritesButton) { 
            headerControls.insertBefore(resetRouteButton, favoritesButton); 
        } else { 
            const locationButton = document.getElementById('location-button'); 
            if (locationButton) { 
                headerControls.insertBefore(resetRouteButton, locationButton); 
            } else { 
                headerControls.appendChild(resetRouteButton); 
            } 
        } 
    }
}

function handleResetRoute() { 
    filters.route = null; 
    const routeFilterSelect = document.getElementById('route-filter'); 
    if (routeFilterSelect) routeFilterSelect.value = ''; 
    clearPreviousRouteDrawing(); 
    routeStopMarkersLayerGroup.clearLayers(); 
    refreshMarkers(map.getCenter()); 
    updateResetRouteButtonVisibility(); 
    updateActiveFiltersDisplay(); 
    map.closePopup(); 
}
function updateResetRouteButtonVisibility() { 
    const resetButton = document.getElementById('reset-route-button'); 
    if (resetButton) { 
        resetButton.style.display = filters.route ? 'flex' : 'none'; 
    } 
}
function onSelectRoute(e) { 
    filters.route = e.target.value || null; 
    console.log(`Route selected via dropdown: ${filters.route}`); 
    updateActiveFiltersDisplay(); 
    clearPreviousRouteDrawing(); 
    routeStopMarkersLayerGroup.clearLayers(); 
    if (filters.route) { 
        markerClusterGroup.clearLayers(); 
        showRouteAndBuses(filters.route); 
    } else { 
        refreshMarkers(map.getCenter()); 
    } 
    updateResetRouteButtonVisibility(); 
}
function toggleFilterPanel() { 
    const panel = document.getElementById('filter-panel'); 
    const isActive = panel?.classList.toggle('active'); 
    document.getElementById('map')?.classList.toggle('map-blur', isActive || document.getElementById('schedule-panel')?.classList.contains('active') || document.getElementById('favorites-panel')?.classList.contains('active')); 
    if (isActive) { closeSchedulePanel(false); closeFavoritesPanel(false); } 
}
function closeFilterPanel(removeBlur = true) { 
    document.getElementById('filter-panel')?.classList.remove('active'); 
    if (removeBlur && !document.getElementById('schedule-panel')?.classList.contains('active') && !document.getElementById('favorites-panel')?.classList.contains('active')) { 
        document.getElementById('map')?.classList.remove('map-blur'); 
    } 
}
function toggleFavoritesPanel() { 
    const panel = document.getElementById('favorites-panel'); 
    const isActive = panel?.classList.toggle('active'); 
    document.getElementById('map')?.classList.toggle('map-blur', isActive || document.getElementById('schedule-panel')?.classList.contains('active') || document.getElementById('filter-panel')?.classList.contains('active')); 
    if (isActive) { closeSchedulePanel(false); closeFilterPanel(false); renderFavoritesPanel(); } 
}
function closeFavoritesPanel(removeBlur = true) { 
    document.getElementById('favorites-panel')?.classList.remove('active'); 
    if (removeBlur && !document.getElementById('schedule-panel')?.classList.contains('active') && !document.getElementById('filter-panel')?.classList.contains('active')) { 
        document.getElementById('map')?.classList.remove('map-blur'); 
    } 
}
function resetFilters() { 
    filters.direction = null; filters.street = null; filters.route = null; 
    ['direction-filter', 'street-search', 'street-filter', 'route-filter'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); 
    updateActiveFiltersDisplay(); 
    clearPreviousRouteDrawing(); 
    routeStopMarkersLayerGroup.clearLayers(); 
    refreshMarkers(map.getCenter()); 
    updateResetRouteButtonVisibility(); 
}
function updateActiveFiltersDisplay() { /* console.log("Active filters:", filters); */ }
function populateStreetFilter() { 
    const streetSelect = document.getElementById('street-filter'); 
    if (!streetSelect || allLocalStops.length === 0) return; 
    while (streetSelect.options.length > 1) streetSelect.remove(1); 
    const streets = new Set(); 
    allLocalStops.forEach(stop => { if (!stop.stop_name) return; const nameParts = stop.stop_name.split(/ at | @ /i); [nameParts[0], nameParts[1]?.split('(')[0]].forEach(part => { if (part) { const potentialStreet = part.trim(); if (potentialStreet && isNaN(potentialStreet) && potentialStreet.length > 2 && !/^(N|S|E|W|NB|SB|EB|WB|Flag)$/i.test(potentialStreet) && !/^\d/.test(potentialStreet)) { streets.add(potentialStreet.replace(/\b\w/g, l => l.toUpperCase())); } } }); }); 
    Array.from(streets).sort().forEach(streetName => { const option = document.createElement('option'); option.value = streetName.toLowerCase(); option.text = streetName; streetSelect.add(option); }); 
}
function updateStreetSearch(e) { 
    const term = e.target.value.toLowerCase(); 
    const streetSelect = document.getElementById('street-filter'); 
    if (!streetSelect) return; 
    Array.from(streetSelect.options).forEach(opt => { if (opt.value === "") { opt.style.display = 'block'; return; } opt.style.display = opt.text.toLowerCase().includes(term) ? 'block' : 'none'; }); 
}
function toggleDarkMode() { 
    darkMode = !darkMode; 
    localStorage.setItem('darkMode', darkMode); 
    document.body.classList.toggle('dark-mode'); 
    const btn = document.getElementById('theme-toggle'); 
    if (btn) btn.innerHTML = darkMode ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>'; 
    const tileUrl = darkMode ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'; 
    if (mapTileLayer) mapTileLayer.setUrl(tileUrl); 
    const newPrimaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(); 
    if (radiusCircle) radiusCircle.setStyle({ color: newPrimaryColor }); 
    if (currentRoutePolyline) currentRoutePolyline.setStyle({ color: newPrimaryColor }); 
}

function requestInitialLocationAndSetView() {
    showLoadingOverlay('Requesting your location...'); 

    function setViewAndLoadData(center, zoom) {
        map.setView(center, zoom);
        if (centerMarker) centerMarker.setLatLng(center);
        if (radiusCircle) radiusCircle.setLatLng(center);
        loadAndProcessGTFS(); 
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;
                const userCenter = [userLat, userLng];

                if (!userLocationMarker) {
                    userLocationMarker = L.marker(userCenter, { icon: userLocationIcon, zIndexOffset: 1000, interactive: false }).addTo(map);
                } else {
                    userLocationMarker.setLatLng(userCenter);
                }
                showLoadingOverlay(getRandomLoadingMessage()); 
                setViewAndLoadData(userCenter, INITIAL_USER_ZOOM);
            },
            () => { 
                showLoadingOverlay('Location denied. Loading default area...'); 
                setViewAndLoadData(DEFAULT_WINNIPEG_CENTER, DEFAULT_ZOOM_UNCLUSTERED);
            },
            { timeout: 8000, maximumAge: 60000, enableHighAccuracy: true }
        );
    } else { 
        showLoadingOverlay('Geolocation not supported. Loading default area...'); 
        setViewAndLoadData(DEFAULT_WINNIPEG_CENTER, DEFAULT_ZOOM_UNCLUSTERED);
    }
}

function locateUser() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }
    showLoadingOverlay('Finding your current location...');

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            const userCenter = [userLat, userLng];

            map.setView(userCenter, INITIAL_USER_ZOOM); 

            if (!userLocationMarker) {
                userLocationMarker = L.marker(userCenter, { icon: userLocationIcon, zIndexOffset: 1000, interactive: false }).addTo(map);
            } else {
                userLocationMarker.setLatLng(userCenter);
            }
            if (userLocationMarker.getPopup()){
                userLocationMarker.setPopupContent("You are here!").openPopup();
            } else {
                userLocationMarker.bindPopup("You are here!").openPopup();
            }
            setTimeout(() => { if (userLocationMarker && userLocationMarker.getPopup()) userLocationMarker.closePopup(); }, 2500);

            hideLoadingOverlay(); 
        },
        () => {
            hideLoadingOverlay(); 
            alert("Unable to retrieve your location. Please ensure location services are enabled and permissions are granted for this site.");
        },
        { timeout: 10000, maximumAge: 0, enableHighAccuracy: true } 
    );
}


function initMap() {
    darkMode = localStorage.getItem('darkMode') === 'true';
    if (darkMode) document.body.classList.add('dark-mode');

    showLoadingOverlay(getRandomLoadingMessage());

    map = L.map('map', { 
        renderer: L.canvas(), 
        zoomControl: false, 
        tap: L.Browser.mobile,
        scrollWheelZoom: 'center', 
        doubleClickZoom: 'center', 
        touchZoom: 'center'       
    });
    L.control.zoom({ position: 'topright' }).addTo(map); 
    
    const initialTileUrl = darkMode ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    mapTileLayer = L.tileLayer(initialTileUrl, { 
        attribution: '© OpenStreetMap, © CartoDB', 
        maxZoom: 19, 
        minZoom:10,
        updateWhenIdle: L.Browser.mobile ? true : false, 
        keepBuffer: L.Browser.mobile ? 4 : 2, 
        fadeAnimation: true 
    }).addTo(map);

    const initialMapCenterForMarkers = L.latLng(DEFAULT_WINNIPEG_CENTER[0], DEFAULT_WINNIPEG_CENTER[1]);
    
    centerMarker = L.marker(initialMapCenterForMarkers, { 
        icon: L.divIcon({ 
            className: 'center-marker', 
            html: `<div class="center-marker-crosshair"></div>` 
        }), 
        interactive: false,
        keyboard: false, 
        pane: 'markerPane' 
    }).addTo(map);

    const initialRadiusColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#0078ff';
    radiusCircle = L.circle(initialMapCenterForMarkers, { radius: FIXED_RADIUS, color: initialRadiusColor, fillOpacity: 0.05, weight: 1.5, interactive: false }).addTo(map);

    markerClusterGroup = L.markerClusterGroup({
        maxClusterRadius: 40, 
        disableClusteringAtZoom: CLUSTER_DISABLE_ZOOM,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        chunkedLoading: true,
    }).addTo(map);
    routeStopMarkersLayerGroup = L.layerGroup().addTo(map);

    initUI(); 
    requestInitialLocationAndSetView(); 

    map.on('move', () => {
        if (centerMarker) centerMarker.setLatLng(map.getCenter());
        if (radiusCircle) radiusCircle.setLatLng(map.getCenter());
    });
    map.on('moveend', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            if (allLocalStops.length > 0 && !filters.route) {
                refreshMarkers(map.getCenter());
            }
        }, 250);

        const circlePath = radiusCircle.getElement();
        if (circlePath) {
            circlePath.classList.remove('radius-circle-path-settle');
            void circlePath.offsetWidth;
            circlePath.classList.add('radius-circle-path-settle');
        }
    });
}

function clearPreviousRouteDrawing() { 
    if (currentRoutePolyline) { 
        map.removeLayer(currentRoutePolyline); 
        currentRoutePolyline = null; 
    } 
}
function showRouteAndBuses(routeId) { 
    console.log(`Attempting to show route: ${routeId}`); 
    clearPreviousRouteDrawing(); 
    const tripIdsForRoute = gtfsData.routeToTrips[routeId]; 
    if (!tripIdsForRoute || tripIdsForRoute.length === 0) { console.warn(`No trips for route: ${routeId}`); updateResetRouteButtonVisibility(); return; } 
    let representativeTripId = tripIdsForRoute.find(tid => gtfsData.tripToShape[tid]) || tripIdsForRoute[0]; 
    let shapeId = gtfsData.tripToShape[representativeTripId]; 
    console.log(`Using trip ${representativeTripId} (shape: ${shapeId || 'None'}) for route ${routeId}`); 
    const routeColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(); 
    const elementsToFit = []; 
    if (shapeId && gtfsData.shapes[shapeId]) { 
        const shapePoints = gtfsData.shapes[shapeId].map(pt => [pt.lat, pt.lon]); 
        if (shapePoints.length > 1) { 
            currentRoutePolyline = L.polyline(shapePoints, { color: routeColor, weight: 4, opacity: 0.75 }).addTo(map); 
            elementsToFit.push(currentRoutePolyline); 
        } 
    } 
    const stopsOnThisRoute = new Set(); 
    tripIdsForRoute.forEach(tripId => gtfsData.tripToStops[tripId]?.forEach(st => stopsOnThisRoute.add(st.stop_id))); 
    routeStopMarkersLayerGroup.clearLayers(); 
    const routeMarkers = []; 
    stopsOnThisRoute.forEach(stopId => { 
        const stopData = gtfsData.stopDetails[stopId]; 
        if (stopData) { 
            let passesFilters = true; 
            if (filters.direction) { 
                const nameLower = (stopData.stop_name || "").toLowerCase(); 
                const dirLower = filters.direction.toLowerCase(); 
                if (!nameLower.includes(dirLower) && !((dirLower === "northbound" && nameLower.includes("nb")) || (dirLower === "southbound" && nameLower.includes("sb")) || (dirLower === "eastbound" && nameLower.includes("eb")) || (dirLower === "westbound" && nameLower.includes("wb")))) { 
                    passesFilters = false; 
                } 
            } 
            if (passesFilters && filters.street && !(stopData.stop_name || "").toLowerCase().includes(filters.street)) { 
                passesFilters = false; 
            } 
            if (passesFilters) { 
                const marker = createStopMarker(stopData); 
                routeMarkers.push(marker); 
                elementsToFit.push(marker); 
            } 
        } 
    }); 
    if (routeMarkers.length > 0) { 
        routeMarkers.forEach(m => routeStopMarkersLayerGroup.addLayer(m)); 
        console.log(`Added ${routeMarkers.length} stop markers for route ${routeId}`); 
    } 
    if (elementsToFit.length > 0) { 
        const featureGroup = L.featureGroup(elementsToFit); 
        map.fitBounds(featureGroup.getBounds().pad(0.1), {maxZoom: 16}); 
    } else if (currentRoutePolyline) { 
        map.fitBounds(currentRoutePolyline.getBounds().pad(0.1), {maxZoom: 16}); 
    } 
    updateResetRouteButtonVisibility(); 
}

function getStopDirectionClass(stopName) {
    if (!stopName) return '';
    const name = stopName.toUpperCase(); 

    // Check for more specific cardinal directions first (e.g., NE, SW)
    if (name.includes('(NE)') || name.includes('NORTHEAST')) return ' direction-ne';
    if (name.includes('(NW)') || name.includes('NORTHWEST')) return ' direction-nw';
    if (name.includes('(SE)') || name.includes('SOUTHEAST')) return ' direction-se';
    if (name.includes('(SW)') || name.includes('SOUTHWEST')) return ' direction-sw';
    
    // Check for primary cardinal directions
    if (name.includes('(NB)') || name.includes('NORTHBOUND') || name.includes(' N ')) return ' direction-n';
    if (name.includes('(SB)') || name.includes('SOUTHBOUND') || name.includes(' S ')) return ' direction-s';
    if (name.includes('(EB)') || name.includes('EASTBOUND') || name.includes(' E ')) return ' direction-e';
    if (name.includes('(WB)') || name.includes('WESTBOUND') || name.includes(' W ')) return ' direction-w';

    return ''; // No explicit direction found
}

function refreshMarkers(currentMapCenter) { 
    markerClusterGroup.clearLayers(); 
    if (!allLocalStops?.length || filters.route) return; 
    const centerLatLng = L.latLng(currentMapCenter.lat, currentMapCenter.lng); 
    const markersToAdd = []; 
    allLocalStops.forEach(stop => { 
        if (typeof stop.stop_lat !== 'number' || typeof stop.stop_lon !== 'number') return; 
        if (centerLatLng.distanceTo(L.latLng(stop.stop_lat, stop.stop_lon)) <= FIXED_RADIUS) { 
            let passesFilters = true; 
            if (filters.direction) { 
                const nameLower = (stop.stop_name || "").toLowerCase(); 
                const dirLower = filters.direction.toLowerCase(); 
                // More robust check for direction filter
                const directionPatterns = {
                    "northbound": ["northbound", "nb"],
                    "southbound": ["southbound", "sb"],
                    "eastbound": ["eastbound", "eb"],
                    "westbound": ["westbound", "wb"]
                };
                let foundDirection = false;
                if (directionPatterns[dirLower]) {
                    for (const pattern of directionPatterns[dirLower]) {
                        if (nameLower.includes(pattern)) {
                            foundDirection = true;
                            break;
                        }
                    }
                }
                if (!foundDirection) passesFilters = false;
            } 
            if (passesFilters && filters.street && !(stop.stop_name || "").toLowerCase().includes(filters.street)) { 
                passesFilters = false; 
            } 
            if (passesFilters) markersToAdd.push(createStopMarker(stop)); 
        } 
    }); 
    if (markersToAdd.length > 0) markerClusterGroup.addLayers(markersToAdd); 
}

function createStopMarker(stop) {
    const isFav = isFavorite(stop.stop_id);
    const directionClass = getStopDirectionClass(stop.stop_name);
    let markerClassName = 'stop-marker';
    if (isFav) {
        markerClassName += ' favorite-stop-on-map';
    }
    if (directionClass) { 
        markerClassName += directionClass;
    }
    
    // **THIS IS THE LINE TO CHANGE**
    const markerHTML = `<div class="stop-dot"><div class="direction-arrow"></div></div>`; 

    const marker = L.marker([stop.stop_lat, stop.stop_lon], { 
        icon: L.divIcon({ 
            className: markerClassName, 
            html: markerHTML, // Use the corrected HTML structure
            iconSize: [24, 24], 
            iconAnchor: [12, 12] 
        }) 
    });
    marker.on('click', (e) => { L.DomEvent.stopPropagation(e); showSchedulePanel(stop); });
    return marker;
}

function formatArrivalTime(isoTime, now = new Date()) { 
    if (!isoTime) return { text: '', css: '', timestamp: Infinity }; 
    const target = new Date(isoTime); 
    const diffSeconds = (target.getTime() - now.getTime()) / 1000; 
    const timestamp = target.getTime(); 
    const min = Math.round(diffSeconds / 60); 
    if (min < -1 && (target.getDate() !== now.getDate() || target.getMonth() !== now.getMonth() || target.getFullYear() !== now.getFullYear())) { return { text: '', css: '', timestamp: Infinity }; } 
    if (min < -2) { return { text: '', css: '', timestamp: Infinity }; } 
    let cssClass = ''; 
    let displayText = ''; 
    if (min <= 0) { displayText = 'Now'; cssClass = 'now live'; } 
    else if (min < 5) { displayText = `${min} min`; cssClass = 'critical-soon live'; } 
    else if (min < 10) { displayText = `${min} min`; cssClass = 'soon live'; } 
    else if (min < 20) { displayText = `${min} min`; cssClass = 'approaching live'; } 
    else if (min < 60) { displayText = `${min} min`; cssClass = 'live'; } 
    else { displayText = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`; cssClass = 'live'; } 
    if (!displayText && min < -1) { return { text: '', css: '', timestamp: Infinity }; } 
    return { text: displayText, css: cssClass, timestamp }; 
}

function updateFavoriteButtonInSchedulePanel() { 
    const favButton = document.querySelector('#schedule-panel .favorite-stop-btn'); 
    if (favButton && currentStopForSchedulePanel) { 
        const stopIdStr = String(currentStopForSchedulePanel.stop_id); 
        if (isFavorite(stopIdStr)) { 
            favButton.classList.add('is-favorite'); 
            favButton.innerHTML = '<i class="fas fa-star"></i>'; 
            favButton.title = "Remove from Favorites"; 
        } else { 
            favButton.classList.remove('is-favorite'); 
            favButton.innerHTML = '<i class="far fa-star"></i>'; 
            favButton.title = "Add to Favorites"; 
        } 
    } 
}

async function showSchedulePanel(stop) {
    currentStopForSchedulePanel = stop;
    const panel = document.getElementById('schedule-panel');
    if (!panel) return;

    const panelHeader = panel.querySelector('.panel-header');
    const schedulePanelTitle = document.getElementById('schedule-panel-title');
    const scheduleItemsContainer = panel.querySelector('.panel-content .schedule-content');

    if (schedulePanelTitle) {
        const fav = favorites.find(f => String(f.stop_id) === String(stop.stop_id));
        schedulePanelTitle.textContent = fav ? fav.custom_name : (stop.stop_name || `Stop #${stop.stop_id}`);
        schedulePanelTitle.title = stop.stop_name || `Stop #${stop.stop_id}`;
    }

    panel.classList.add('active');
    document.getElementById('map')?.classList.toggle('map-blur', true);
    closeFilterPanel(false); 

    let headerActionsWrapper = panelHeader.querySelector('.header-actions-wrapper');
    if (!headerActionsWrapper) {
        headerActionsWrapper = document.createElement('div');
        headerActionsWrapper.className = 'header-actions-wrapper';
        panelHeader.appendChild(headerActionsWrapper); 
    }
    headerActionsWrapper.innerHTML = ''; 

    let favButton = document.createElement('button');
    favButton.className = 'favorite-stop-btn';
    favButton.type = 'button';
    headerActionsWrapper.appendChild(favButton);
    updateFavoriteButtonInSchedulePanel(); 
    favButton.onclick = (e) => {
        e.stopPropagation();
        if (isFavorite(currentStopForSchedulePanel.stop_id)) {
            removeFavorite(currentStopForSchedulePanel.stop_id);
        } else {
            addFavorite(currentStopForSchedulePanel);
        }
        if (schedulePanelTitle) { 
            const updatedFav = favorites.find(f => String(f.stop_id) === String(stop.stop_id));
            schedulePanelTitle.textContent = updatedFav ? updatedFav.custom_name : (stop.stop_name || `Stop #${stop.stop_id}`);
        }
    };
    
    let refreshButton = document.createElement('button');
    refreshButton.className = 'refresh-schedule-btn';
    refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>';
    refreshButton.title = 'Refresh schedule';
    refreshButton.type = 'button';
    refreshButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentStopForSchedulePanel) showSchedulePanel(currentStopForSchedulePanel);
    });
    headerActionsWrapper.appendChild(refreshButton);

    let closeButton = document.createElement('button');
    closeButton.id = 'close-schedule'; 
    closeButton.innerHTML = '<i class="fas fa-times"></i>';
    closeButton.title = 'Close schedule';
    headerActionsWrapper.appendChild(closeButton);


    panel.style.maxHeight = '360px';

    if(scheduleItemsContainer) {
        scheduleItemsContainer.innerHTML = `
            <div class="loading-schedule">
                <div class="schedule-loading-animation-area">
                    <i class="fas fa-bus animated-transit-icon bus-ltr" style="top: 10px; animation-duration: 5s; animation-delay: 0s;"></i>
                    <i class="fas fa-bus-alt animated-transit-icon bus-rtl" style="top: 40px; animation-duration: 4.5s; animation-delay: 0.3s; font-size: 24px; opacity: 0.6;"></i>
                    <i class="fas fa-bus animated-transit-icon bus-ltr" style="top: 10px; animation-duration: 5.5s; animation-delay: 2.5s; opacity: 0.8;"></i>
                </div>
                <span>${getRandomScheduleWaitingMessage()}</span>
            </div>`;
    }

    setTimeout(async () => {
        if (!panel.classList.contains('active') || !currentStopForSchedulePanel || String(currentStopForSchedulePanel.stop_id) !== String(stop.stop_id)) {
            panel.style.maxHeight = '';
            return;
        }

        try {
            const scheduleRes = await fetch(`${API_BASE}/api/stops/${stop.stop_id}/schedule`);
            if (!scheduleRes.ok) throw new Error(`API Error ${scheduleRes.status}`);
            const scheduleJson = await scheduleRes.json();
            let scheduleHtml = '';

            if (scheduleJson?.success && scheduleJson.data?.['stop-schedule']?.['route-schedules']?.length > 0) {
                let routeSchedules = scheduleJson.data['stop-schedule']['route-schedules']; 
                routeSchedules = routeSchedules.map(rs => { 
                    let earliestTimestamp = Infinity; 
                    (rs['scheduled-stops'] || []).forEach(sStop => { 
                        const arrivalInfo = formatArrivalTime(sStop.times?.departure?.scheduled, new Date()); 
                        if (arrivalInfo.timestamp < earliestTimestamp) earliestTimestamp = arrivalInfo.timestamp; 
                    }); 
                    return {...rs, earliestTimestamp}; 
                }).sort((a,b) => a.earliestTimestamp - b.earliestTimestamp); 
                routeSchedules.forEach(routeSchedule => { 
                    const routeAPIData = routeSchedule.route; 
                    const routeGTFSData = gtfsData.routes.find(r => String(r.route_short_name) === String(routeAPIData.number)); 
                    const routeIdForLink = routeGTFSData ? routeGTFSData.route_id : String(routeAPIData.number); 
                    const scheduledStops = routeSchedule['scheduled-stops']; 
                    let badgesHtml = ''; 
                    const sortedTimesForRoute = (scheduledStops || []) .map(sStop => formatArrivalTime(sStop.times?.departure?.scheduled, new Date())) .filter(fmt => fmt.text) .sort((a,b) => a.timestamp - b.timestamp); 
                    if (sortedTimesForRoute.length > 0) { 
                        sortedTimesForRoute.forEach(fmt => { badgesHtml += `<span class="arrival-badge ${fmt.css}">${fmt.text}</span>`; }); 
                    } 
                    const routeNumberDisplay = routeAPIData.number || 'N/A'; 
                    const pulsateClass = " pulsate"; 
                    if (badgesHtml.length > 0) { 
                        scheduleHtml += `<div class="route-item"> <span class="route-circle${pulsateClass}" data-route-id="${routeIdForLink}">${routeNumberDisplay}</span> <div class="arrival-times">${badgesHtml}</div> </div>`; 
                    } else { 
                        scheduleHtml += `<div class="route-item"> <span class="route-circle${pulsateClass}" data-route-id="${routeIdForLink}">${routeNumberDisplay}</span> <div class="arrival-times"><span style="color:var(--text-color); opacity:0.7; font-size:0.9em;">No upcoming API arrivals</span></div> </div>`; 
                    } 
                });
            } else {
                scheduleHtml += `<div class="no-schedule">${getRandomNoScheduleMessage()}${scheduleJson?.message ? ' <small>(' + scheduleJson.message + ')</small>' : ''}</div>`;
            }
            
            if(scheduleItemsContainer) {
                scheduleItemsContainer.innerHTML = scheduleHtml;
            }
            panel.style.maxHeight = '';

        } catch (e) {
            console.error("Error loading/displaying schedule panel:", e);
            if(scheduleItemsContainer) scheduleItemsContainer.innerHTML = `<div class="no-schedule">Oops! Couldn't fetch schedule. <small>(${e.message})</small></div>`;
            panel.style.maxHeight = '';
        }
    }, 2000 + Math.random() * 1000);
}

function closeSchedulePanel(removeBlur = true) {
    const panel = document.getElementById('schedule-panel');
    if (panel) {
        panel.classList.remove('active');
        panel.style.maxHeight = '';
    }
    if (removeBlur && !document.getElementById('filter-panel')?.classList.contains('active') && !document.getElementById('favorites-panel')?.classList.contains('active')) {
        document.getElementById('map')?.classList.remove('map-blur');
    }
    currentStopForSchedulePanel = null;
}

document.addEventListener('click', function (e) {
    const filterPanel = document.getElementById('filter-panel');
    const schedulePanel = document.getElementById('schedule-panel');
    const favoritesPanel = document.getElementById('favorites-panel');
    const isPanelToggleButton = e.target.closest('#filter-toggle') || e.target.closest('#favorites-toggle') || e.target.closest('.stop-marker');

    if (filterPanel?.classList.contains('active') && !filterPanel.contains(e.target) && !e.target.closest('#filter-toggle')) {
        closeFilterPanel();
    }
    
    if (e.target.closest('#close-schedule')) { 
        closeSchedulePanel();
    } else if (
        schedulePanel?.classList.contains('active') &&
        !schedulePanel.contains(e.target) && 
        !e.target.closest('.stop-marker') &&
        !e.target.closest('.favorite-item-info') 
    ) {
        closeSchedulePanel(); 
    }


    if (favoritesPanel?.classList.contains('active') && !favoritesPanel.contains(e.target) && !e.target.closest('#favorites-toggle')) {
        closeFavoritesPanel();
    }

    if (e.target.classList.contains('route-circle') || e.target.closest('.route-circle')) {
        const routeCircle = e.target.classList.contains('route-circle') ? e.target : e.target.closest('.route-circle');
        const routeIdFromScheduleAttr = routeCircle.dataset.routeId;
        if (routeIdFromScheduleAttr) {
            let targetRouteId = routeIdFromScheduleAttr;
            const matchedRoute = gtfsData.routes.find(r => r.route_id === routeIdFromScheduleAttr || String(r.route_short_name) === String(routeIdFromScheduleAttr));
            if (matchedRoute) targetRouteId = matchedRoute.route_id;
            else console.warn(`No GTFS match for schedule route ${routeIdFromScheduleAttr}.`);

            filters.route = targetRouteId;
            const routeFilterSelect = document.getElementById('route-filter');
            if (routeFilterSelect) routeFilterSelect.value = targetRouteId;
            
            updateActiveFiltersDisplay();
            clearPreviousRouteDrawing();
            routeStopMarkersLayerGroup.clearLayers();
            markerClusterGroup.clearLayers();
            showRouteAndBuses(targetRouteId);
            closeSchedulePanel();
            closeFavoritesPanel();
        }
    }
});

window.addEventListener('DOMContentLoaded', initMap);
