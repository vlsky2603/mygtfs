// ===================================================================
//     main_dynamic.js (v11.4 - FINAL FIX)
// ===================================================================
// Полностью восстановлена функция рендеринга панели расписания.
// Добавлен недостающий блок для создания элементов маршрутов и кнопок.
// ===================================================================

// --- Глобальное Состояние и Переменные ---
const API_BASE = window.location.origin;
let map;
let markerClusterGroup;
let routeStopMarkersLayerGroup;
let simulatedBusesLayerGroup;
let mapTileLayer;

let allLocalStops = [];
let gtfsData = {
    routes: [], trips: [], shapes: {}, stopTimes: [],
    routeToTrips: {}, tripToShape: {}, tripToStops: {}, stopDetails: {}
};

let centerMarker;
let radiusCircle;
let userLocationMarker = null;

let filters = { direction: null, street: null, route: null };
let darkMode = false;
let currentRoutePolyline = null;
let debounceTimeout;
let currentStopForSchedulePanel = null; 
let liveViewOriginStopMarker = null; 

let _currentPanelApiRouteSchedules = [];
let favorites = [];
let scheduledNotifications = [];
let regularNotificationRules = [];
let activeSimulatedBuses = {};

let isLiveBusViewActive = false;
let previousRouteFilterStateBeforeLiveView = null;
let liveViewSpecificShapeId = null;
let liveViewOriginStopData = null; 
let previousStopContextForReturn = null;

let scheduleCountdownIntervalId = null;
let scheduleApiRefreshIntervalId = null;
let smoothAnimationRequestId = null;
let notificationCheckIntervalId = null;
let ruleMonitorIntervalId = null;
let iosInfoShown = localStorage.getItem('iosNotificationInfoShown') === 'true';

// --- Константы ---
const FAVORITES_STORAGE_KEY = 'transitMapFavoritesVlsky';
const REGULAR_NOTIFICATIONS_STORAGE_KEY = 'transitMapRegularNotificationsVlsky';
const DEFAULT_WINNIPEG_CENTER = [49.8955, -97.1384];
const INITIAL_USER_ZOOM = 17;
const DEFAULT_ZOOM_UNCLUSTERED = 17;
const FAVORITE_STOP_ZOOM = 18;
const CLUSTER_DISABLE_ZOOM = 15;
const LIVE_VIEW_ZOOM_PADDING = 0.25;
const FIXED_RADIUS = 400;
const SCHEDULE_COUNTDOWN_INTERVAL = 1000;
const SCHEDULE_API_REFRESH_INTERVAL = 2 * 60 * 1000; 
const BUS_TARGET_UPDATE_INTERVAL = 10000;
const NOTIFICATION_CHECK_INTERVAL = 5000;
const DEFAULT_NOTIFICATION_MINUTES_BEFORE = 2;
const RULE_MONITOR_INTERVAL = 1 * 60 * 1000; 
const FETCH_PREVIOUS_STOP_FOR_CLOSEST_BUS = true; 
const MAX_UNDETERMINED_FUTURE_ARRIVAL_MINUTES = 25; 
const NUMBER_OF_BUSES_TO_SHOW = 2; 

// --- Инициализация ---

function initMap() {
    darkMode = localStorage.getItem('darkMode') === 'true';
    if (darkMode) document.body.classList.add('dark-mode');

    map = L.map('map', {
        renderer: L.canvas(), zoomControl: false, tap: L.Browser.mobile,
        scrollWheelZoom: 'center', doubleClickZoom: 'center', touchZoom: 'center'
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    const initialTileUrl = darkMode ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    mapTileLayer = L.tileLayer(initialTileUrl, {
        attribution: '© OpenStreetMap, © CartoDB', maxZoom: 19, minZoom:10,
        updateWhenIdle: L.Browser.mobile ? true : false, keepBuffer: L.Browser.mobile ? 4 : 2, fadeAnimation: true
    }).addTo(map);

    const initialMapCenterForMarkers = L.latLng(DEFAULT_WINNIPEG_CENTER[0], DEFAULT_WINNIPEG_CENTER[1]);
    centerMarker = L.marker(initialMapCenterForMarkers, { icon: L.divIcon({ className: 'center-marker', html: `<div class="center-marker-crosshair"></div>` }), interactive: false, keyboard: false, pane: 'markerPane' }).addTo(map);
    const initialRadiusColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#0078ff';
    radiusCircle = L.circle(initialMapCenterForMarkers, { radius: FIXED_RADIUS, color: initialRadiusColor, fillOpacity: 0.05, weight: 1.5, interactive: false }).addTo(map);

    markerClusterGroup = L.markerClusterGroup({ maxClusterRadius: 40, disableClusteringAtZoom: CLUSTER_DISABLE_ZOOM, spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true, chunkedLoading: true }).addTo(map);
    routeStopMarkersLayerGroup = L.layerGroup().addTo(map);
    simulatedBusesLayerGroup = L.layerGroup().addTo(map);

    initUI();
    requestInitialLocationAndSetView(); 

    map.on('move', () => {
        if (centerMarker) centerMarker.setLatLng(map.getCenter());
        if (radiusCircle) radiusCircle.setLatLng(map.getCenter());
    });
    map.on('moveend', () => {
         clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => { if (allLocalStops.length > 0 && !filters.route && !isLiveBusViewActive) refreshMarkers(map.getCenter()); }, 250);
        const circlePath = radiusCircle.getElement();
        if (circlePath) { circlePath.classList.remove('radius-circle-path-settle'); void circlePath.offsetWidth; circlePath.classList.add('radius-circle-path-settle'); }
    });
    setInterval(updateBusTargetPositions, BUS_TARGET_UPDATE_INTERVAL);
    startSmoothBusAnimationLoop();
    createToastContainer();
    if (scheduledNotifications.length > 0 || regularNotificationRules.some(r => r.isEnabled)) {
        if (!notificationCheckIntervalId) {
            notificationCheckIntervalId = setInterval(checkScheduledNotifications, NOTIFICATION_CHECK_INTERVAL);
        }
    }
}

function initUI() {
    document.getElementById('filter-toggle')?.addEventListener('click', () => togglePanel('filter-panel'));
    document.getElementById('close-filters')?.addEventListener('click', () => closeFilterPanel());
    document.getElementById('reset-filters')?.addEventListener('click', resetFilters);
    
    document.getElementById('favorites-toggle')?.addEventListener('click', () => togglePanel('favorites-panel'));
    document.getElementById('close-favorites-panel')?.addEventListener('click', () => closeFavoritesPanel());
    
    document.getElementById('regular-notifications-toggle-button')?.addEventListener('click', () => togglePanel('regular-notifications-panel'));
    document.getElementById('close-regular-notifications-panel')?.addEventListener('click', () => closeRegularNotificationsPanel());

    document.getElementById('route-planner-toggle')?.addEventListener('click', () => togglePanel('route-planner-panel'));
    document.getElementById('close-route-planner')?.addEventListener('click', () => closeRoutePlannerPanel());
    document.getElementById('build-route-button')?.addEventListener('click', buildRouteBetweenStops);
    
    document.getElementById('direction-filter')?.addEventListener('change', e => { filters.direction = e.target.value || null; if (filters.route && !isLiveBusViewActive) showRouteAndBuses(filters.route); else if (!isLiveBusViewActive) refreshMarkers(map.getCenter()); });
    document.getElementById('street-search')?.addEventListener('input', updateStreetSearch);
    document.getElementById('street-filter')?.addEventListener('change', e => { filters.street = e.target.value || null; if (filters.route && !isLiveBusViewActive) showRouteAndBuses(filters.route); else if (!isLiveBusViewActive) refreshMarkers(map.getCenter()); });
    
    document.getElementById('location-button')?.addEventListener('click', locateUser);
    document.getElementById('theme-toggle')?.addEventListener('click', toggleDarkMode);
    document.getElementById('route-filter')?.addEventListener('change', onSelectRoute);
    document.getElementById('reset-route-button')?.addEventListener('click', handleResetRoute);
    
    document.getElementById('add-new-regular-notification-rule')?.addEventListener('click', openRuleEditorForAdd);
    document.getElementById('save-rule-button')?.addEventListener('click', saveRuleFromEditor);
    document.getElementById('cancel-rule-button')?.addEventListener('click', closeRuleEditor);
    document.getElementById('rule-stop-select')?.addEventListener('change', onRuleEditorStopChange);

    enableSwipeToClose('schedule-panel', () => closeSchedulePanel());
    enableSwipeToClose('filter-panel', () => closeFilterPanel());
    enableSwipeToClose('favorites-panel', () => closeFavoritesPanel());
    enableSwipeToClose('regular-notifications-panel', () => closeRegularNotificationsPanel());
<<<<<<< HEAD
=======
    enableSwipeToClose('route-planner-panel', () => closeRoutePlannerPanel());
>>>>>>> e625b55 (Обновления UI и логики GTFS)
}


// --- Главные обработчики событий и координаторы ---

async function requestInitialLocationAndSetView() { 
    showLoadingOverlay('Initializing...');

    function setViewAndLoadData(center, zoom) {
        map.setView(center, zoom);
        if (centerMarker) centerMarker.setLatLng(center);
        if (radiusCircle) radiusCircle.setLatLng(center);
        loadAndProcessGTFS(); 
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userCenter = [position.coords.latitude, position.coords.longitude];
                if (!userLocationMarker) userLocationMarker = L.marker(userCenter, { icon: userLocationIcon, zIndexOffset: 1000, interactive: false }).addTo(map);
                else userLocationMarker.setLatLng(userCenter);
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
    if (!navigator.geolocation) { alert("Geolocation is not supported."); return; }
    showTopProgressBar();
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const userCenter = [position.coords.latitude, position.coords.longitude];
            map.setView(userCenter, INITIAL_USER_ZOOM);
            if (!userLocationMarker) userLocationMarker = L.marker(userCenter, { icon: userLocationIcon, zIndexOffset: 1000, interactive: false }).addTo(map);
            else userLocationMarker.setLatLng(userCenter);
            userLocationMarker.bindPopup("You are here!").openPopup();
            setTimeout(() => { if (userLocationMarker?.getPopup()) userLocationMarker.closePopup(); }, 2500);
            hideTopProgressBar();
        },
        () => { hideTopProgressBar(); alert("Unable to retrieve your location."); },
        { timeout: 10000, maximumAge: 0, enableHighAccuracy: true }
    );
}

function onSelectRoute(e) {
    if (isLiveBusViewActive) deactivateLiveBusView(false); 
    
    if (currentStopForSchedulePanel && !previousStopContextForReturn) { 
         previousStopContextForReturn = {
            stop_id: currentStopForSchedulePanel.stop_id,
            latlng: L.latLng(currentStopForSchedulePanel.stop_lat, currentStopForSchedulePanel.stop_lon),
            zoom: map.getZoom()
        };
    }

    filters.route = e.target.value || null; 
    clearPreviousRouteDrawing(); 
    routeStopMarkersLayerGroup.clearLayers(); 
    if (simulatedBusesLayerGroup) simulatedBusesLayerGroup.clearLayers(); 
    activeSimulatedBuses = {};
    
    if (filters.route) { 
        markerClusterGroup.clearLayers(); 
        showRouteAndBuses(filters.route); 
    } else { 
        if (radiusCircle) radiusCircle.setStyle({ opacity: 1, fillOpacity: 0.05 });
        if (centerMarker) centerMarker.setOpacity(1);

        if (previousStopContextForReturn) {
            map.setView(previousStopContextForReturn.latlng, previousStopContextForReturn.zoom, { animate: true });
            const originalStopData = allLocalStops.find(s => String(s.stop_id) === String(previousStopContextForReturn.stop_id));
            if (originalStopData) {
                 showSchedulePanel(originalStopData);
            }
        } else {
            refreshMarkers(map.getCenter());
        }
    }
    updateResetRouteButtonVisibility();
}

function handleResetRoute() {
    updateLiveActivity(null);
    if (isLiveBusViewActive) {
        deactivateLiveBusView(true); 
    } else {
        filters.route = null;
         const routeFilterSelect = document.getElementById('route-filter');
        if (routeFilterSelect) routeFilterSelect.value = '';
        clearPreviousRouteDrawing();
        routeStopMarkersLayerGroup.clearLayers();
        if (simulatedBusesLayerGroup) simulatedBusesLayerGroup.clearLayers();
        activeSimulatedBuses = {};

        if (radiusCircle) radiusCircle.setStyle({ opacity: 1, fillOpacity: 0.05 });
        if (centerMarker) centerMarker.setOpacity(1);

        if (previousStopContextForReturn) { 
            map.setView(previousStopContextForReturn.latlng, previousStopContextForReturn.zoom, { animate: true });
            const originalStopData = allLocalStops.find(s => String(s.stop_id) === String(previousStopContextForReturn.stop_id));
            if (originalStopData) {
                showSchedulePanel(originalStopData);
            }
        } else {
            refreshMarkers(map.getCenter()); 
        }
        previousStopContextForReturn = null; 
    }
    updateResetRouteButtonVisibility();
    map.closePopup();
}

function buildRouteBetweenStops() {
    const startId = document.getElementById('route-plan-start')?.value;
    const endId = document.getElementById('route-plan-end')?.value;
    const resultEl = document.getElementById('route-plan-result');
    if (!startId || !endId || !resultEl) return;

    if (currentRoutePolyline) { map.removeLayer(currentRoutePolyline); currentRoutePolyline = null; }

    let foundTrip = null;
    for (const tripId in gtfsData.tripToStops) {
        const stops = gtfsData.tripToStops[tripId];
        const startIndex = stops.findIndex(s => String(s.stop_id) === String(startId));
        const endIndex = stops.findIndex(s => String(s.stop_id) === String(endId));
        if (startIndex >= 0 && endIndex > startIndex) { foundTrip = { tripId, startIndex, endIndex }; break; }
    }

    if (!foundTrip) { resultEl.textContent = 'No direct route found.'; return; }
    const trip = gtfsData.trips.find(t => t.trip_id === foundTrip.tripId);
    if (!trip) { resultEl.textContent = 'Trip data missing.'; return; }

    const shapeId = trip.shape_id;
    const shape = gtfsData.shapes[shapeId];
    if (shape) {
        const poly = shape.map(p => [p.lat, p.lon]);
        currentRoutePolyline = L.polyline(poly, { color: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(), weight: 5 }).addTo(map);
        map.fitBounds(currentRoutePolyline.getBounds(), { padding: [50,50] });
    }

    const startStopTime = gtfsData.tripToStops[foundTrip.tripId][foundTrip.startIndex];
    const endStopTime = gtfsData.tripToStops[foundTrip.tripId][foundTrip.endIndex];
    const serviceDate = determineSimulationTimeUTC();
    const startDeparture = getDatetimeForGtfsTime(gtfsTimeToSeconds(startStopTime.departure_time), serviceDate);
    const endArrival = getDatetimeForGtfsTime(gtfsTimeToSeconds(endStopTime.arrival_time), serviceDate);
    resultEl.textContent = `Departs ${startDeparture.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}, arrives ${endArrival.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
}

function resetFilters() {
    if (isLiveBusViewActive) deactivateLiveBusView(true); 
    
    filters.direction = null; filters.street = null;
    
    if (filters.route) { 
        filters.route = null; 
        const routeFilterSelect = document.getElementById('route-filter'); 
        if (routeFilterSelect) routeFilterSelect.value = ''; 
        clearPreviousRouteDrawing(); 
        routeStopMarkersLayerGroup.clearLayers(); 
        
        if (previousStopContextForReturn) { 
            map.setView(previousStopContextForReturn.latlng, previousStopContextForReturn.zoom, { animate: true });
            const originalStopData = allLocalStops.find(s => String(s.stop_id) === String(previousStopContextForReturn.stop_id));
            if (originalStopData) {
                 showSchedulePanel(originalStopData);
            }
        } else {
            refreshMarkers(map.getCenter());
        }
    } else if (previousStopContextForReturn) { 
         map.setView(previousStopContextForReturn.latlng, previousStopContextForReturn.zoom, { animate: true });
         const originalStopData = allLocalStops.find(s => String(s.stop_id) === String(previousStopContextForReturn.stop_id));
         if (originalStopData) {
            if (originalStopData) {
                 showSchedulePanel(originalStopData);
            }
        } else {
            refreshMarkers(map.getCenter());
        }
    } else if (previousStopContextForReturn) { 
         map.setView(previousStopContextForReturn.latlng, previousStopContextForReturn.zoom, { animate: true });
         const originalStopData = allLocalStops.find(s => String(s.stop_id) === String(previousStopContextForReturn.stop_id));
         if (originalStopData) {
            showSchedulePanel(originalStopData);
         }
    } else {
        refreshMarkers(map.getCenter()); 
    }

    ['direction-filter', 'street-search', 'street-filter'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    updateResetRouteButtonVisibility();
    previousStopContextForReturn = null; 
}

// --- Live View / "Кинетический Остров" ---

function updateLiveActivity(scheduleData) {
    const container = document.getElementById('live-activity-container');
    if (!container) return;

    let nextBus = null;
    const now = determineSimulationTimeUTC();

    if (scheduleData && Array.isArray(scheduleData) && scheduleData.length > 0) {
        let allUpcoming = [];
        scheduleData.forEach(route => {
            if (route['scheduled-stops']) {
                route['scheduled-stops'].forEach(stop => {
                    if (stop.cancelled === "true") return;
                    const arrivalTimeStr = stop.times.departure.estimated || stop.times.departure.scheduled;
                    if (arrivalTimeStr) {
                        const arrivalTime = new Date(arrivalTimeStr);
                        if (arrivalTime >= now) {
                            allUpcoming.push({
                                routeNumber: route.route.number,
                                headsign: stop.variant.name || route.route.name,
                                arrivalTime: arrivalTime
                            });
                        }
                    }
                });
            }
        });

        if (allUpcoming.length > 0) {
            allUpcoming.sort((a, b) => a.arrivalTime - b.arrivalTime);
            nextBus = allUpcoming[0];
        }
    }

    if (nextBus) {
        const diffMinutes = Math.round((nextBus.arrivalTime - now) / (1000 * 60));
        let timeText = `${diffMinutes} min`;
        if (diffMinutes < 1) {
            timeText = "Now";
        }

        container.innerHTML = `
            <div class="live-activity-content">
                <span class="live-route-number">${nextBus.routeNumber}</span>
                <div class="live-route-details">
                    <span class="live-route-headsign">${nextBus.headsign}</span>
                    <span class="live-route-status">Arriving in...</span>
                </div>
            </div>
            <span class="live-arrival-time">${timeText}</span>
        `;
    } else {
        container.innerHTML = '';
    }
}

function clearAllMapLayersForLiveView(fullClear = true, originStopToPreserve = null) {
    if (currentRoutePolyline) { map.removeLayer(currentRoutePolyline); currentRoutePolyline = null; }
    
    Object.values(activeSimulatedBuses).forEach(busInfo => {
        if (busInfo.animatedPath) map.removeLayer(busInfo.animatedPath);
    });

    if (fullClear) { 
        routeStopMarkersLayerGroup.clearLayers(); 
        markerClusterGroup.clearLayers(); 
    }
    simulatedBusesLayerGroup.clearLayers(); 
    activeSimulatedBuses = {}; 
    liveViewSpecificShapeId = null;

    if (liveViewOriginStopMarker) {
        map.removeLayer(liveViewOriginStopMarker);
        liveViewOriginStopMarker = null;
    }
    if (originStopToPreserve) { 
        liveViewOriginStopMarker = createStopMarker(originStopToPreserve, true); 
        liveViewOriginStopMarker.addTo(map); 
    }
}

function deactivateLiveBusView(shouldResetContext = true) { 
    isLiveBusViewActive = false; 
    clearAllMapLayersForLiveView(true); 
    liveViewOriginStopData = null; 
    
    filters.route = previousRouteFilterStateBeforeLiveView; 
    previousRouteFilterStateBeforeLiveView = null;
    
    const routeFilterSelect = document.getElementById('route-filter'); 
    if (routeFilterSelect) routeFilterSelect.value = filters.route || '';
    
    if (filters.route) {
        showRouteAndBuses(filters.route); 
    } else {
        if (radiusCircle) radiusCircle.setStyle({ opacity: 1, fillOpacity: 0.05 });
        if (centerMarker) centerMarker.setOpacity(1);

        if (previousStopContextForReturn && shouldResetContext) { 
            map.setView(previousStopContextForReturn.latlng, previousStopContextForReturn.zoom, { animate: true });
            const originalStopData = allLocalStops.find(s => String(s.stop_id) === String(previousStopContextForReturn.stop_id));
            if (originalStopData) { 
                showSchedulePanel(originalStopData); 
            } else {
                 previousStopContextForReturn = null; 
            }
        } else { 
            refreshMarkers(map.getCenter());
        }
    }
    updateResetRouteButtonVisibility();
    if (shouldResetContext) previousStopContextForReturn = null; 
}

// --- Панель Расписания и ее Помощники ---

function updateScheduleCountdown() {
    const schedulePanel = document.getElementById('schedule-panel');
    if (!schedulePanel.classList.contains('active') || !currentStopForSchedulePanel) {
        return;
    }
    const nowForSimUTC = determineSimulationTimeUTC();

    schedulePanel.querySelectorAll('.arrival-time-item').forEach(badge => {
        const scheduledStr = badge.dataset.scheduledTime; 
        const estimatedStr = badge.dataset.estimatedTime; 
        if (!scheduledStr && !estimatedStr) return;
        
        const sStopTimes = { scheduled: scheduledStr || null, estimated: estimatedStr || null };
        const arrivalInfo = formatArrivalTime(sStopTimes, nowForSimUTC);
        
        if (arrivalInfo.text === '') {
            if (badge.parentElement) badge.parentElement.removeChild(badge);
            return;
        }
        
        const currentTextNode = Array.from(badge.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
        const currentText = currentTextNode ? currentTextNode.nodeValue : '';

        if (currentText !== arrivalInfo.text) {
            if(currentTextNode) {
                currentTextNode.nodeValue = arrivalInfo.text;
            } else {
                badge.prepend(document.createTextNode(arrivalInfo.text));
            }
        }

        const newClassString = `arrival-time-item ${arrivalInfo.css} ${badge.classList.contains('primary-arrival') ? 'primary-arrival' : ''}`.trim();
        if (badge.className !== newClassString) {
            badge.className = newClassString;
        }
    });
}

async function refreshScheduleApiData() { 
    const schedulePanel = document.getElementById('schedule-panel');
    if (schedulePanel.classList.contains('active') && currentStopForSchedulePanel) {
        showTopProgressBar();
        await showSchedulePanel(currentStopForSchedulePanel); 
        hideTopProgressBar();
    }
}

// ==========================================================
//     ↓↓↓ ПОЛНАЯ И ИСПРАВЛЕННАЯ ВЕРСИЯ showSchedulePanel ↓↓↓
// ==========================================================
async function showSchedulePanel(stop) {
    currentStopForSchedulePanel = stop; 
    previousStopContextForReturn = null; 
    
    const panel = document.getElementById('schedule-panel');
    if (!panel) return;

    if (scheduleCountdownIntervalId) clearInterval(scheduleCountdownIntervalId);
    if (scheduleApiRefreshIntervalId) clearInterval(scheduleApiRefreshIntervalId);

    const panelHeader = panel.querySelector('.panel-header');
    const schedulePanelTitle = document.getElementById('schedule-panel-title');
    const scheduleItemsContainer = panel.querySelector('.schedule-content');

    if (schedulePanelTitle) {
        const fav = favorites.find(f => String(f.stop_id) === String(stop.stop_id));
        let stopTitleText = fav ? fav.custom_name : (stop.stop_name || `Stop #${stop.stop_id}`);
        const stopNumber = stop.number || stop.stop_code; 
        if (stopNumber && String(stopNumber) !== String(stop.stop_id)) { 
            stopTitleText += ` (#${stopNumber})`;
        }
        schedulePanelTitle.textContent = stopTitleText;
        schedulePanelTitle.title = `${stop.stop_name || `Stop #${stop.stop_id}`} (ID: ${stop.stop_id})`;
    }
    panel.classList.add('active');
    closeFilterPanel(false); closeFavoritesPanel(false); closeRegularNotificationsPanel(false);

    let headerActionsWrapper = panelHeader.querySelector('.header-actions-wrapper');
    if (!headerActionsWrapper) {
        headerActionsWrapper = document.createElement('div');
        headerActionsWrapper.className = 'header-actions-wrapper';
        panelHeader.appendChild(headerActionsWrapper);
    }
    headerActionsWrapper.innerHTML = '';

    let setupReminderButton = document.createElement('button');
    setupReminderButton.className = 'setup-reminder-btn control-button';
    setupReminderButton.innerHTML = '<i class="fas fa-stopwatch"></i>';
    setupReminderButton.title = 'Set up a regular reminder for this stop';
    setupReminderButton.type = 'button';
    setupReminderButton.addEventListener('click', (e) => { e.stopPropagation(); if (currentStopForSchedulePanel) openRuleEditorForStop(currentStopForSchedulePanel); });
    headerActionsWrapper.appendChild(setupReminderButton);

    let favButton = document.createElement('button'); favButton.className = 'favorite-stop-btn control-button'; favButton.type = 'button';
    headerActionsWrapper.appendChild(favButton); updateFavoriteButtonInSchedulePanel();
    favButton.onclick = (e) => { e.stopPropagation(); if (isFavorite(currentStopForSchedulePanel.stop_id)) removeFavorite(currentStopForSchedulePanel.stop_id); else addFavorite(currentStopForSchedulePanel); if (schedulePanelTitle) { const updatedFav = favorites.find(f => String(f.stop_id) === String(stop.stop_id)); let newTitle = updatedFav ? updatedFav.custom_name : (stop.stop_name || `Stop #${stop.stop_id}`); const stopNumberToDisplay = _currentPanelApiRouteSchedules?.[0]?.['stop-schedule']?.stop?.number || stop.number || stop.stop_code; if (stopNumberToDisplay && String(stopNumberToDisplay) !== String(stop.stop_id)) newTitle += ` (#${stopNumberToDisplay})`; schedulePanelTitle.textContent = newTitle; } };

    let refreshButton = document.createElement('button'); refreshButton.className = 'refresh-schedule-btn control-button'; refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i>'; refreshButton.title = 'Refresh schedule'; refreshButton.type = 'button';
    refreshButton.addEventListener('click', (e) => { e.stopPropagation(); refreshScheduleApiData(); });
    headerActionsWrapper.appendChild(refreshButton);

    let closeButton = document.createElement('button'); closeButton.id = 'close-schedule'; closeButton.className = 'control-button'; closeButton.innerHTML = '<i class="fas fa-times"></i>'; closeButton.title = 'Close schedule';
    closeButton.addEventListener('click', () => closeSchedulePanel());
    headerActionsWrapper.appendChild(closeButton);

    panel.style.maxHeight = '360px';
    if(scheduleItemsContainer) scheduleItemsContainer.innerHTML = `<div class="loading-schedule"><div class="schedule-loading-animation-area"><div class="loading-spinner"></div></div><span>Loading schedule...</span></div>`;
    
    showTopProgressBar();
    try {
        const currentSimTimeUTC = determineSimulationTimeUTC();
        const scheduleStartTimeUTC = new Date(currentSimTimeUTC.getTime());
        const scheduleEndTimeUTC = new Date(currentSimTimeUTC.getTime() + 4 * 60 * 60 * 1000); 

        const fetchUrl = `${API_BASE}/api/stops/${stop.stop_id}/schedule?usage=long&start=${scheduleStartTimeUTC.toISOString()}&end=${scheduleEndTimeUTC.toISOString()}`;
        
        const scheduleRes = await fetch(fetchUrl);

        if (!panel.classList.contains('active') || !currentStopForSchedulePanel || String(currentStopForSchedulePanel.stop_id) !== String(stop.stop_id)) {
            panel.style.maxHeight = ''; return; 
        }
        if (!scheduleRes.ok) {
             const errorText = await scheduleRes.text();
             throw new Error(`API Error ${scheduleRes.status}: ${errorText}`);
        }
        
        const scheduleJson = await scheduleRes.json();
        
        _currentPanelApiRouteSchedules = scheduleJson?.data?.['stop-schedule']?.['route-schedules'] || [];
        
        updateLiveActivity(_currentPanelApiRouteSchedules);

        const apiStopData = scheduleJson?.data?.['stop-schedule']?.stop;
        if (schedulePanelTitle && apiStopData) { 
            const fav = favorites.find(f => String(f.stop_id) === String(apiStopData.key));
            let stopTitleText = fav ? fav.custom_name : (apiStopData.name || `Stop #${apiStopData.key}`);
            if (apiStopData.number && String(apiStopData.number) !== String(apiStopData.key)) {
                stopTitleText += ` (#${apiStopData.number})`;
            }
            schedulePanelTitle.textContent = stopTitleText;
            schedulePanelTitle.title = `${apiStopData.name || `Stop #${apiStopData.key}`} (ID: ${apiStopData.key})`;
        }

        if (scheduleItemsContainer) scheduleItemsContainer.innerHTML = '';

        if (_currentPanelApiRouteSchedules.length > 0) {
            let routeSchedulesToDisplay = _currentPanelApiRouteSchedules.map(rs => {
                let earliestTimestamp = Infinity;
                (rs['scheduled-stops'] || []).forEach(sS => {
                    if (sS.cancelled === "true") return; 
                    const arrivalInfo = formatArrivalTime(sS.times?.departure, currentSimTimeUTC);
                    if (arrivalInfo.timestamp < earliestTimestamp) earliestTimestamp = arrivalInfo.timestamp;
                });
                return {...rs, earliestTimestamp};
            }).sort((a,b) => a.earliestTimestamp - b.earliestTimestamp);

            // ==========================================================
            //     ↓↓↓ ВОТ ЭТОТ БЛОК ОТСУТСТВОВАЛ ↓↓↓
            // ==========================================================
            routeSchedulesToDisplay.forEach(routeSchedule => {
                const routeAPIData = routeSchedule.route;
                const scheduledStopsForRoute = routeSchedule['scheduled-stops'] || [];
                let firstUpcomingApiScheduledStop = null;

                const allArrivals = [];
                scheduledStopsForRoute.forEach(sS => {
                    if (sS.cancelled === "true") return;
                    const fmt = formatArrivalTime(sS.times?.departure, currentSimTimeUTC);
                    if (fmt.text) {
                        allArrivals.push({ ...fmt, sStop: sS });
                        if (!firstUpcomingApiScheduledStop && fmt.timestamp !== Infinity && (fmt.text.includes('min') || fmt.text.toLowerCase() === 'now')) {
                            firstUpcomingApiScheduledStop = sS;
                        }
                    }
                });

                if (allArrivals.length > 0) {
                    const routeItemDiv = document.createElement('div');
                    routeItemDiv.className = 'route-item';

                    const routeInfoDiv = document.createElement('div');
                    routeInfoDiv.className = 'route-item-info';
                    
                    const routeGTFSData = gtfsData.routes.find(r => String(r.route_short_name) === String(routeAPIData.number));
                    const routeIdForLink = routeGTFSData ? routeGTFSData.route_id : String(routeAPIData.number);

                    const routeCircleSpan = document.createElement('span');
                    routeCircleSpan.className = 'route-circle pulsate';
                    routeCircleSpan.dataset.routeId = routeIdForLink;
                    routeCircleSpan.textContent = routeAPIData.number || 'N/A';
                    routeCircleSpan.title = `View full route ${routeAPIData.number}`;
                    routeCircleSpan.addEventListener('click', () => { 
                        if (routeIdForLink) { 
                            if (currentStopForSchedulePanel) { 
                                previousStopContextForReturn = { stop_id: currentStopForSchedulePanel.stop_id, latlng: L.latLng(currentStopForSchedulePanel.stop_lat, currentStopForSchedulePanel.stop_lon), zoom: map.getZoom() };
                            }
                            if (isLiveBusViewActive) deactivateLiveBusView(false); 
                            filters.route = routeIdForLink; 
                            const routeFilterSelect = document.getElementById('route-filter'); 
                            if (routeFilterSelect) routeFilterSelect.value = routeIdForLink; 
                            onSelectRoute({target: {value: routeIdForLink}}); 
                            closeSchedulePanel(); 
                        } 
                    });

                    const routeActionsDiv = document.createElement('div');
                    routeActionsDiv.className = 'route-item-actions';
                    
                    const liveViewButton = document.createElement('button');
                    liveViewButton.className = 'live-view-btn control-button';
                    liveViewButton.innerHTML = '<i class="fas fa-satellite-dish"></i> Live';
                    liveViewButton.title = `Show live buses for route ${routeAPIData.number}`;
                    liveViewButton.dataset.routeApiNumber = routeAPIData.number;
                    liveViewButton.addEventListener('click', async (e) => { 
                        e.stopPropagation(); 
                        if (!currentStopForSchedulePanel) {
                            console.error("Live View: Missing currentStopForSchedulePanel");
                            return;
                        }
                        const simTimeForLiveViewUTC = determineSimulationTimeUTC();
                        if (!simTimeForLiveViewUTC) {
                             console.error("Live View: Could not determine simulation time.");
                             return;
                        }
                        
                        liveViewOriginStopData = { ...currentStopForSchedulePanel }; 

                        previousStopContextForReturn = { 
                            stop_id: currentStopForSchedulePanel.stop_id,
                            latlng: L.latLng(currentStopForSchedulePanel.stop_lat, currentStopForSchedulePanel.stop_lon),
                            zoom: map.getZoom()
                        };
                        
                        const apiRouteNumberForLiveView = e.currentTarget.dataset.routeApiNumber; 
                        const specificRouteScheduleForButton = _currentPanelApiRouteSchedules.find(rs => String(rs.route.number) === String(apiRouteNumberForLiveView)); 
                        if (!specificRouteScheduleForButton) {
                             console.error("Live View: Could not find specificRouteScheduleForButton for API route", apiRouteNumberForLiveView);
                             return;
                        }
                        
                        isLiveBusViewActive = true; 
                        previousRouteFilterStateBeforeLiveView = filters.route; 
                        filters.route = null; 
                        const routeFilterSelect = document.getElementById('route-filter'); 
                        if (routeFilterSelect) routeFilterSelect.value = ''; 
                        
                        clearAllMapLayersForLiveView(true, liveViewOriginStopData); 
                        if (radiusCircle) radiusCircle.setStyle({ opacity: 0, fillOpacity: 0 });
                        if (centerMarker) centerMarker.setOpacity(0);


                        closeSchedulePanel(); 
                        if (liveViewOriginStopData) {
                            await simulateAndShowUpcomingBusesForRoute(liveViewOriginStopData, specificRouteScheduleForButton, simTimeForLiveViewUTC.toISOString(), true);
                        } 
                        updateResetRouteButtonVisibility(); 
                    });

                    const notifyButton = document.createElement('button');
                    notifyButton.className = 'notify-btn control-button';
                    if (firstUpcomingApiScheduledStop) {
                        const targetTimeISO = new Date(firstUpcomingApiScheduledStop.times.departure.estimated || firstUpcomingApiScheduledStop.times.departure.scheduled).toISOString();
                        const firstNonNullVariantKey = firstUpcomingApiScheduledStop?.variant?.key || routeSchedule['scheduled-stops'][0]?.variant?.key || 'default';
                        const routeDisplayName = firstUpcomingApiScheduledStop?.variant?.name || routeAPIData.name || `Route ${routeAPIData.number}`;
                        
                        notifyButton.dataset.targetTime = targetTimeISO;
                        const notificationId = `route-${routeAPIData.number}-variant-${firstNonNullVariantKey}-time-${new Date(targetTimeISO).getTime()}`;
                        const existingNotification = scheduledNotifications.find(n => n.id === notificationId && !n.ruleId);
                        
                        if (existingNotification && !existingNotification.triggered) {
                            notifyButton.innerHTML = '<i class="fas fa-bell"></i>';
                            notifyButton.title = `Cancel in-app reminder for ${routeDisplayName}`;
                            notifyButton.classList.add('active-notification');
                        } else {
                            notifyButton.innerHTML = '<i class="far fa-bell"></i>';
                            notifyButton.title = 'Set in-app reminder (toast)';
                        }
                        notifyButton.addEventListener('click', (ev) => { ev.stopPropagation(); scheduleNotification(routeAPIData.number, routeDisplayName, firstNonNullVariantKey, targetTimeISO, DEFAULT_NOTIFICATION_MINUTES_BEFORE, ev.currentTarget ); });
                    } else {
                        notifyButton.innerHTML = '<i class="far fa-bell"></i>';
                        notifyButton.disabled = true;
                        notifyButton.title = 'No upcoming buses to set a reminder for';
                    }
                    
                    routeActionsDiv.appendChild(liveViewButton);
                    routeActionsDiv.appendChild(notifyButton);

                    routeInfoDiv.appendChild(routeCircleSpan);
                    routeInfoDiv.appendChild(routeActionsDiv);
                    routeItemDiv.appendChild(routeInfoDiv);

                    const routeDetailsDiv = document.createElement('div');
                    routeDetailsDiv.className = 'route-item-details';

                    const firstScheduledStop = scheduledStopsForRoute.find(s => s.cancelled !== "true"); 
                    const routeNameSpan = document.createElement('span');
                    routeNameSpan.className = 'route-name-schedule';
                    routeNameSpan.textContent = firstScheduledStop?.variant?.name || routeAPIData.name || `Route ${routeAPIData.number}`;
                    routeDetailsDiv.appendChild(routeNameSpan);

                    const featuresDiv = document.createElement('div');
                    featuresDiv.className = 'bus-features';
                    const firstBusData = firstUpcomingApiScheduledStop?.bus || firstScheduledStop?.bus;
                    if (firstBusData) {
                        if (firstBusData['bike-rack'] === "true") featuresDiv.innerHTML += `<span class="bus-feature-item" title="Bike rack available"><i class="fas fa-bicycle"></i></span>`;
                        if (firstBusData.wifi === "true") featuresDiv.innerHTML += `<span class="bus-feature-item" title="Wi-Fi available"><i class="fas fa-wifi"></i></span>`;
                    }
                    if (featuresDiv.innerHTML) routeDetailsDiv.appendChild(featuresDiv);

                    const routeScheduleGrid = document.createElement('div');
                    routeScheduleGrid.className = 'route-schedule-grid';
                    
                    allArrivals.forEach((arrival, index) => {
                        const isPrimary = index === 0;
                        const arrivalEl = document.createElement('div');
                        arrivalEl.className = `arrival-time-item ${arrival.css} ${isPrimary ? 'primary-arrival' : ''}`.trim();
                        arrivalEl.textContent = arrival.text;
                        arrivalEl.dataset.scheduledTime = arrival.sStop.times?.departure?.scheduled || '';
                        arrivalEl.dataset.estimatedTime = arrival.sStop.times?.departure?.estimated || '';
                        arrivalEl.dataset.originalTimestamp = arrival.timestamp;

                        if (arrival.css.includes('live')) {
                            arrivalEl.innerHTML += '<span class="live-indicator"></span>';
                        }
                        routeScheduleGrid.appendChild(arrivalEl);
                    });
                    
                    routeDetailsDiv.appendChild(routeScheduleGrid);
                    routeItemDiv.appendChild(routeDetailsDiv);

                    scheduleItemsContainer.appendChild(routeItemDiv);
                }
            });
            // ==========================================================
            //     ↑↑↑ КОНЕЦ БЛОКА, КОТОРЫЙ ОТСУТСТВОВАЛ ↑↑↑
            // ==========================================================
            
            if (scheduleItemsContainer.children.length === 0 && scheduleItemsContainer) scheduleItemsContainer.innerHTML = `<div class="no-schedule">${getRandomNoScheduleMessage()} <small>(No displayable services)</small></div>`;
            
            scheduleCountdownIntervalId = setInterval(updateScheduleCountdown, SCHEDULE_COUNTDOWN_INTERVAL);
                        scheduleApiRefreshIntervalId = setInterval(refreshScheduleApiData, SCHEDULE_API_REFRESH_INTERVAL);
        } else {
            if (scheduleItemsContainer) scheduleItemsContainer.innerHTML = `<div class="no-schedule">${getRandomNoScheduleMessage()}${scheduleJson?.message ? ' <small>(' + scheduleJson.message + ')</small>' : ''}</div>`;
            if (simulatedBusesLayerGroup) simulatedBusesLayerGroup.clearLayers(); activeSimulatedBuses = {};
        }
        panel.style.maxHeight = '';
    } catch (e) {
        updateLiveActivity(null);
        console.error(`Error in showSchedulePanel for stop ${stop.stop_id}:`, e);
        if(scheduleItemsContainer) scheduleItemsContainer.innerHTML = `<div class="no-schedule error-message">Oops! Couldn't fetch schedule. <small>(${e.message})</small></div>`;
        panel.style.maxHeight = ''; 
        _currentPanelApiRouteSchedules = [];
    } finally {
        hideTopProgressBar();
    }
}

// ==========================================================
//     ↓↓↓ ГЛОБАЛЬНЫЙ ОБРАБОТЧИК КЛИКОВ (без изменений) ↓↓↓
// ==========================================================
document.addEventListener('click', function (e) {
    const filterPanel = document.getElementById('filter-panel');
    const schedulePanel = document.getElementById('schedule-panel');
    const favoritesPanel = document.getElementById('favorites-panel');
    const regularNotificationsPanel = document.getElementById('regular-notifications-panel');
    const routePlannerPanel = document.getElementById('route-planner-panel');
    const ruleEditorModal = document.getElementById('rule-editor-modal');

    if (filterPanel?.classList.contains('active') && !filterPanel.contains(e.target) && !e.target.closest('#filter-toggle')) closeFilterPanel();
    
    if (ruleEditorModal?.classList.contains('modal-visible') && !ruleEditorModal.querySelector('.modal-content').contains(e.target) && !e.target.closest('.setup-reminder-btn') && !e.target.closest('#add-new-regular-notification-rule') && !e.target.closest('.edit-rule-btn')) { 
        // Не закрывать редактор правил по клику снаружи
    } else if (schedulePanel?.classList.contains('active') && !schedulePanel.contains(e.target) && !e.target.closest('.stop-marker-wrapper') && !e.target.closest('.favorite-item-info')) {
        closeSchedulePanel();
    }

    if (favoritesPanel?.classList.contains('active') && !favoritesPanel.contains(e.target) && !e.target.closest('#favorites-toggle')) closeFavoritesPanel();

    if (regularNotificationsPanel?.classList.contains('active') && !regularNotificationsPanel.contains(e.target) && !e.target.closest('#regular-notifications-toggle-button') && !ruleEditorModal?.classList.contains('modal-visible')) {
        closeRegularNotificationsPanel();
    }

    if (routePlannerPanel?.classList.contains('active') && !routePlannerPanel.contains(e.target) && !e.target.closest('#route-planner-toggle')) {
        closeRoutePlannerPanel();
    }
});


// --- Запуск приложения ---
window.addEventListener('DOMContentLoaded', () => {
    initMap(); 
    startSmoothBusAnimationLoop(); 
});