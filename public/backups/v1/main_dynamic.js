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
let startAddressResults = [];
let endAddressResults = [];
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

const quickPlannerState = {
    origin: null,
    destination: null,
    suggestions: [],
    plans: [],
    activePlanIndex: -1,
    layers: [],
    markers: [],
    suggestionRequestId: 0,
    planRequestId: 0,
    ui: {
        searchCollapsed: false,
        resultsExpanded: false
    }
};

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
const BUS_TARGET_UPDATE_INTERVAL = 1000; // Обновление каждую секунду для очень плавного движения
const NOTIFICATION_CHECK_INTERVAL = 5000;
const DEFAULT_NOTIFICATION_MINUTES_BEFORE = 2;
const RULE_MONITOR_INTERVAL = 1 * 60 * 1000; 
const FETCH_PREVIOUS_STOP_FOR_CLOSEST_BUS = true; 
const MAX_UNDETERMINED_FUTURE_ARRIVAL_MINUTES = 25; 
// (constants defined above)
const MAX_ROUTE_EXPANSIONS = 1000;
const NUMBER_OF_BUSES_TO_SHOW = 2;
const WALK_SPEED_MPS = 1.4;

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
    requestInitialLocationAndSetView(); // Эта функция теперь сама установит стартовый адрес 

    map.on('move', () => {
        if (centerMarker) centerMarker.setLatLng(map.getCenter());
        if (radiusCircle) radiusCircle.setLatLng(map.getCenter());
    });
    map.on('moveend', () => {
         clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => { 
            // Only refresh markers if NOT in search mode
            if (allLocalStops.length > 0 && !filters.route && !isLiveBusViewActive && !document.body.classList.contains('search-results-active')) {
                refreshMarkers(map.getCenter());
                // Подгружаем остановки для новой области если нужно
                loadStopsForCurrentView();
            }
        }, 250);
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

    initQuickPlannerUI();
    
    document.getElementById('direction-filter')?.addEventListener('change', e => { filters.direction = e.target.value || null; if (filters.route && !isLiveBusViewActive) showRouteAndBuses(filters.route); else if (!isLiveBusViewActive) refreshMarkers(map.getCenter()); });
    document.getElementById('street-search')?.addEventListener('input', updateStreetSearch);
    document.getElementById('street-filter')?.addEventListener('change', e => { filters.street = e.target.value || null; if (filters.route && !isLiveBusViewActive) showRouteAndBuses(filters.route); else if (!isLiveBusViewActive) refreshMarkers(map.getCenter()); });
    
    document.getElementById('location-button')?.addEventListener('click', locateUser);
    document.getElementById('theme-toggle')?.addEventListener('click', toggleDarkMode);
    document.getElementById('route-filter')?.addEventListener('change', onSelectRoute);
    document.getElementById('reset-route-button')?.addEventListener('click', handleResetRoute);
    document.getElementById('ios-clear-filter-button')?.addEventListener('click', handleResetRoute);
    
    document.getElementById('add-new-regular-notification-rule')?.addEventListener('click', openRuleEditorForAdd);
    document.getElementById('save-rule-button')?.addEventListener('click', saveRuleFromEditor);
    document.getElementById('cancel-rule-button')?.addEventListener('click', closeRuleEditor);
    document.getElementById('rule-stop-select')?.addEventListener('change', onRuleEditorStopChange);

    document.querySelectorAll('.ios-dock-button[data-panel-target]').forEach(button => {
        button.addEventListener('click', () => togglePanel(button.dataset.panelTarget));
    });

    enableSwipeToClose('schedule-panel', () => closeSchedulePanel());
    enableSwipeToClose('filter-panel', () => closeFilterPanel());
    enableSwipeToClose('favorites-panel', () => closeFavoritesPanel());
    enableSwipeToClose('regular-notifications-panel', () => closeRegularNotificationsPanel());
}

function setSearchPanelCollapsed(collapsed) {
    const card = document.querySelector('.ios-search-card');
    const toggleBtn = document.getElementById('ios-search-collapse');
    quickPlannerState.ui.searchCollapsed = !!collapsed;
    if (card) card.classList.toggle('collapsed', collapsed);
    if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', (!collapsed).toString());
        const icon = toggleBtn.querySelector('i');
        if (icon) icon.className = collapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
    }
    document.body.classList.toggle('search-card-collapsed', collapsed);
}

function toggleSearchPanelCollapsed() {
    setSearchPanelCollapsed(!quickPlannerState.ui.searchCollapsed);
}

function setResultsSheetExpanded(expanded) {
    const sheet = document.getElementById('ios-results-sheet');
    const toggleBtn = document.getElementById('ios-results-toggle');
    quickPlannerState.ui.resultsExpanded = !!expanded;
    if (sheet) {
        sheet.classList.toggle('collapsed', !expanded);
        sheet.classList.toggle('expanded', !!expanded);
    }
    if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', (!!expanded).toString());
        const icon = toggleBtn.querySelector('i');
        if (icon) icon.className = expanded ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
    }
}

function toggleResultsSheet() {
    setResultsSheetExpanded(!quickPlannerState.ui.resultsExpanded);
}

function updateResultsStatus(text) {
    const status = document.getElementById('ios-results-status');
    if (status) status.textContent = text || 'Enter a destination to see routes';
}

function applyInitialQuickPlannerLayout() {
    const collapseMedia = window.matchMedia('(max-height: 780px)');
    const compactMedia = window.matchMedia('(max-height: 730px)');
    const applyLayout = () => {
        setSearchPanelCollapsed(collapseMedia.matches);
        setResultsSheetExpanded(false);
        updateResultsStatus('Enter a destination to see routes');
        document.body.classList.toggle('compact-mode', compactMedia.matches);
        const bottomStack = document.querySelector('.ios-bottom-stack');
        if (bottomStack) {
            bottomStack.classList.toggle('compact-layout', compactMedia.matches);
        }
    };
    collapseMedia.addEventListener?.('change', applyLayout);
    compactMedia.addEventListener?.('change', applyLayout);
    applyLayout();
}

function initQuickPlannerUI() {
    const destinationInput = document.getElementById('ios-destination-input');
    const suggestionsDropdown = document.getElementById('ios-destination-suggestions');
    if (!destinationInput || !suggestionsDropdown) return;

    const goButton = document.getElementById('ios-go-button');
    const clearButton = document.getElementById('ios-clear-destination');

    applyInitialQuickPlannerLayout();
    document.getElementById('ios-search-collapse')?.addEventListener('click', toggleSearchPanelCollapsed);
    document.getElementById('ios-results-toggle')?.addEventListener('click', toggleResultsSheet);

    const debouncedSuggestionLookup = debounce(async (value) => {
        const query = value.trim();
        if (query.length < 3) {
            quickPlannerState.suggestions = [];
            hideQuickSuggestions();
            return;
        }
        const requestId = ++quickPlannerState.suggestionRequestId;
        try {
            const suggestions = await getAddressSuggestions(query, 5);
            if (requestId !== quickPlannerState.suggestionRequestId) return;
            quickPlannerState.suggestions = suggestions;
            renderQuickSuggestions(suggestions);
        } catch (err) {
            console.error('Suggestion lookup failed:', err);
        }
    }, 275);

    destinationInput.addEventListener('input', (e) => {
        const value = e.target.value;
        quickPlannerState.destination = null;
        if (!value.trim()) {
            quickPlannerState.suggestions = [];
            hideQuickSuggestions();
            resetQuickResultsPlaceholder();
            return;
        }
        debouncedSuggestionLookup(value);
    });

    destinationInput.addEventListener('focus', () => {
        if (quickPlannerState.suggestions.length > 0) {
            renderQuickSuggestions(quickPlannerState.suggestions);
        }
    });

    destinationInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            triggerQuickTripSearch();
        }
    });

    goButton?.addEventListener('click', () => triggerQuickTripSearch());

    clearButton?.addEventListener('click', () => {
        destinationInput.value = '';
        quickPlannerState.destination = null;
        quickPlannerState.suggestions = [];
        hideQuickSuggestions();
        closeSearchResults();
    });
    
    document.getElementById('ios-results-close')?.addEventListener('click', closeSearchResults);

    document.addEventListener('click', (event) => {
        if (!suggestionsDropdown.contains(event.target) && event.target !== destinationInput) {
            hideQuickSuggestions();
        }
    });

    document.getElementById('ios-locate-button')?.addEventListener('click', () => locateUser());
    document.getElementById('ios-layers-button')?.addEventListener('click', () => togglePanel('filter-panel'));
    document.getElementById('ios-theme-button')?.addEventListener('click', () => toggleDarkMode());

    resetQuickResultsPlaceholder();
}

function setQuickPlannerOrigin(coords, label) {
    if (!coords) return;
    quickPlannerState.origin = { lat: coords[0], lon: coords[1], label: label || 'Your location' };
    const labelEl = document.getElementById('ios-start-label');
    if (labelEl) labelEl.textContent = quickPlannerState.origin.label;
}

function ensureQuickPlannerOrigin() {
    if (quickPlannerState.origin) return quickPlannerState.origin;
    if (userLocationMarker?.getLatLng) {
        const ll = userLocationMarker.getLatLng();
        setQuickPlannerOrigin([ll.lat, ll.lng], 'Your location');
        return quickPlannerState.origin;
    }
    if (map) {
        const center = map.getCenter();
        setQuickPlannerOrigin([center.lat, center.lng], 'Map center');
        return quickPlannerState.origin;
    }
    return null;
}

function closeSearchResults() {
    const sheet = document.getElementById('ios-results-sheet');
    if (sheet) sheet.classList.add('hidden');

    document.body.classList.remove('search-results-active');
    resetQuickResultsPlaceholder();
    setSearchPanelCollapsed(false);
    
    // Clear map route
    if (currentRoutePolyline) {
        map.removeLayer(currentRoutePolyline);
        currentRoutePolyline = null;
    }
    
    // Clear markers
    quickPlannerState.markers.forEach(m => map.removeLayer(m));
    quickPlannerState.markers = [];
    
    clearQuickPlannerLayers();
    
    // Restore radius circle
    if (radiusCircle) {
        radiusCircle.setStyle({ opacity: 1, fillOpacity: 0.05 });
    }
    
    // Restore stops
    refreshMarkers(map.getCenter());
}

function resetQuickResultsPlaceholder(message) {
    const container = document.getElementById('ios-quick-results');
    if (!container) return;
    if (message) container.dataset.placeholder = message;
    container.innerHTML = '';
    container.classList.add('empty');
    updateResultsStatus(message || container.dataset.placeholder || 'Enter a destination to see routes');
    // setResultsSheetExpanded(false); // No longer needed as we use body class
}

function showQuickResultsLoading(message = 'Searching routes...') {
    const sheet = document.getElementById('ios-results-sheet');
    if (sheet) sheet.classList.remove('hidden');

    const container = document.getElementById('ios-quick-results');
    if (!container) return;
    container.classList.remove('empty');
    container.innerHTML = `
        <div class="quick-loading">
            <div class="loading-spinner"></div>
            <span>${message}</span>
        </div>
    `;
    updateResultsStatus(message);
    document.body.classList.add('search-results-active');
}

function showQuickResultsMessage(message) {
    const sheet = document.getElementById('ios-results-sheet');
    if (sheet) sheet.classList.remove('hidden');

    const container = document.getElementById('ios-quick-results');
    if (!container) return;
    container.classList.remove('empty');
    container.innerHTML = `
        <div class="quick-loading">
            <span>${message}</span>
        </div>
    `;
    updateResultsStatus(message);
    document.body.classList.add('search-results-active');
}

function renderQuickSuggestions(suggestions) {
    const dropdown = document.getElementById('ios-destination-suggestions');
    if (!dropdown) return;
    dropdown.innerHTML = '';
    if (!suggestions || suggestions.length === 0) {
        hideQuickSuggestions();
        return;
    }
    suggestions.forEach((sugg) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'autocomplete-item';
        const labelParts = sugg.display.split(',');
        btn.innerHTML = `
            <strong>${labelParts.shift()?.trim() || sugg.display}</strong>
            <span>${labelParts.join(', ').trim()}</span>
        `;
        btn.addEventListener('click', () => applyQuickSuggestion(sugg));
        dropdown.appendChild(btn);
    });
    dropdown.classList.add('active');
}

function hideQuickSuggestions() {
    const dropdown = document.getElementById('ios-destination-suggestions');
    if (!dropdown) return;
    dropdown.classList.remove('active');
    dropdown.innerHTML = '';
}

function applyQuickSuggestion(suggestion) {
    quickPlannerState.destination = suggestion;
    const input = document.getElementById('ios-destination-input');
    if (input) input.value = suggestion.display;
    hideQuickSuggestions();
    triggerQuickTripSearch();
}

async function triggerQuickTripSearch() {
    const destinationInput = document.getElementById('ios-destination-input');
    if (!destinationInput) return;
    const query = destinationInput.value.trim();
    if (!query) {
        resetQuickResultsPlaceholder();
        return;
    }

    const origin = ensureQuickPlannerOrigin();
    if (!origin) {
        showQuickResultsMessage('Waiting for your location...');
        return;
    }

    // Clear other modes to avoid conflicts
    if (filters.route) {
        filters.route = null;
        const routeFilterSelect = document.getElementById('route-filter');
        if (routeFilterSelect) routeFilterSelect.value = '';
        clearPreviousRouteDrawing();
        routeStopMarkersLayerGroup.clearLayers();
    }
    if (isLiveBusViewActive) {
        isLiveBusViewActive = false;
        if (simulatedBusesLayerGroup) simulatedBusesLayerGroup.clearLayers();
        activeSimulatedBuses = {};
    }

    let destination = quickPlannerState.destination;
    if (!destination || destination.display !== query) {
        const suggestionMatch = quickPlannerState.suggestions.find(s => s.display === query);
        if (suggestionMatch) {
            destination = suggestionMatch;
        } else {
            const geocoded = await geocodeAddress(query);
            if (!geocoded) {
                showQuickResultsMessage('Destination not found. Try another place.');
                return;
            }
            destination = { ...geocoded, display: query };
        }
        quickPlannerState.destination = destination;
    }

    showQuickResultsLoading();
    const requestId = ++quickPlannerState.planRequestId;
    try {
        const plans = await fetchTripPlans(origin, destination);
        if (requestId !== quickPlannerState.planRequestId) return;
        quickPlannerState.plans = plans;
        quickPlannerState.activePlanIndex = -1;
        if (!plans.length) {
            showQuickResultsMessage('No transit options right now.');
            return;
        }
        renderQuickPlanCards(plans, destination.display);
        selectQuickPlan(0);
    } catch (error) {
        console.error('Quick planner failed:', error);
        if (requestId === quickPlannerState.planRequestId) {
            showQuickResultsMessage('Could not load route options. Please try again.');
        }
    }
}

async function fetchTripPlans(origin, destination) {
    const url = `${API_BASE}/api/trip-plan?fromLat=${origin.lat}&fromLon=${origin.lon}&toLat=${destination.lat}&toLon=${destination.lon}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Trip planner HTTP ${res.status}`);
    }
    const data = await res.json();
    return normalizeTripPlansResponse(data);
}

function normalizeTripPlansResponse(payload) {
    if (!payload) return [];
    if (Array.isArray(payload.plans)) return payload.plans;
    if (Array.isArray(payload['trip-planner']?.plans)) return payload['trip-planner'].plans;
    if (Array.isArray(payload.data?.plans)) return payload.data.plans;
    if (Array.isArray(payload.data?.['trip-planner']?.plans)) return payload.data['trip-planner'].plans;
    return [];
}

function renderQuickPlanCards(plans, destinationLabel) {
    const sheet = document.getElementById('ios-results-sheet');
    if (sheet) sheet.classList.remove('hidden');

    const container = document.getElementById('ios-quick-results');
    if (!container) return;
    container.classList.remove('empty');
    container.innerHTML = '';
    const routeCount = plans.length;
    const label = destinationLabel ? `${routeCount} option${routeCount === 1 ? '' : 's'} to ${destinationLabel}` : `${routeCount} option${routeCount === 1 ? '' : 's'}`;
    updateResultsStatus(label);
    document.body.classList.add('search-results-active');
    
    // Hide radius circle when showing results
    if (radiusCircle) {
        radiusCircle.setStyle({ opacity: 0, fillOpacity: 0 });
    }

    if (!quickPlannerState.ui.searchCollapsed) {
        setSearchPanelCollapsed(true);
    }

    plans.forEach((plan, index) => {
        const rideSegments = (plan.segments || []).filter(seg => seg.type === 'ride');
        const totalMinutes = Math.round(plan?.times?.durations?.total ?? 0);
        const walkMinutes = Math.round(plan?.times?.durations?.walking ?? 0);
        const waitingMinutes = Math.round(plan?.times?.durations?.waiting ?? 0);
        const transfers = Math.max(0, rideSegments.length - 1);
        const departureTime = formatPlanTime(plan?.times?.start);
        const arrivalTime = formatPlanTime(plan?.times?.end);
        const accentColor = rideSegments[0]?.route?.['badge-style']?.['background-color'] || rideSegments[0]?.route?.color || 'var(--ios-accent)';
        const routeBadges = rideSegments.length > 0 ? rideSegments.map(seg => {
            const label = seg.route?.['badge-label'] || seg.route?.number || seg.route?.name || '?';
            const bg = seg.route?.['badge-style']?.['background-color'] || seg.route?.color || 'var(--ios-accent)';
            const fg = seg.route?.['badge-style']?.color || '#fff';
            return `<span class="quick-route-badge" style="background-color:${bg};color:${fg};">${label}</span>`;
        }).join('') : '<span class="quick-route-badge">Walk</span>';

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'quick-route-card';
        card.style.setProperty('--quick-route-color', accentColor);
        if (index === quickPlannerState.activePlanIndex) card.classList.add('selected');

        const transferLabel = transfers === 0 ? 'Direct' : `${transfers} transfer${transfers > 1 ? 's' : ''}`;
        const metaWalk = walkMinutes ? `${walkMinutes} min walk` : 'Low walking';
        const metaWait = waitingMinutes ? `${waitingMinutes} min wait` : 'Minimal wait';

        card.innerHTML = `
            <div class="quick-route-accent"></div>
            <div class="quick-route-content">
                <div class="quick-route-top">
                    <div>
                        <span class="quick-duration">${totalMinutes ? `${totalMinutes} min` : 'Transit'}</span>
                        <span class="quick-time-range">${departureTime && arrivalTime ? `${departureTime} – ${arrivalTime}` : ''}</span>
                    </div>
                    <span class="quick-transfer-pill ${transfers === 0 ? 'direct' : ''}">${transferLabel}</span>
                </div>
                <div class="quick-route-badges">
                    ${routeBadges}
                </div>
                <div class="quick-route-meta-row">
                    <span><i class="fas fa-person-walking"></i>${metaWalk}</span>
                    <span><i class="fas fa-clock"></i>${metaWait}</span>
                </div>
            </div>
            <div class="quick-route-chevron"><i class="fas fa-chevron-right"></i></div>
        `;

        card.addEventListener('click', () => selectQuickPlan(index));

        container.appendChild(card);
    });
}

function formatPlanTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getStopContextFromEndpoint(endpoint) {
    if (!endpoint?.stop?.key) return null;
    return {
        stopId: String(endpoint.stop.key),
        coords: getSegmentEndpointLatLng(endpoint)
    };
}

function findNextStopContext(segments, startIndex) {
    for (let i = startIndex; i < segments.length; i++) {
        const seg = segments[i];
        const fromCtx = getStopContextFromEndpoint(seg.from);
        if (fromCtx) return fromCtx;
        const toCtx = getStopContextFromEndpoint(seg.to);
        if (toCtx) return toCtx;
    }
    return null;
}

function findPreviousStopContext(segments, startIndex) {
    for (let i = startIndex - 1; i >= 0; i--) {
        const seg = segments[i];
        const toCtx = getStopContextFromEndpoint(seg.to);
        if (toCtx) return toCtx;
        const fromCtx = getStopContextFromEndpoint(seg.from);
        if (fromCtx) return fromCtx;
    }
    return null;
}

function buildFallbackLine(startCoords, endCoords) {
    if (startCoords && endCoords) {
        return [startCoords, endCoords];
    }
    return null;
}

function highlightSelectedQuickPlan(index) {
    const cards = document.querySelectorAll('#ios-quick-results .quick-route-card');
    cards.forEach((card, idx) => {
        card.classList.toggle('selected', idx === index);
    });
}

async function selectQuickPlan(index) {
    if (!quickPlannerState.plans[index]) return;
    quickPlannerState.activePlanIndex = index;
    highlightSelectedQuickPlan(index);
    await drawQuickPlanOnMap(quickPlannerState.plans[index]);
}

function clearQuickPlannerLayers() {
    quickPlannerState.layers.forEach(layer => {
        if (map?.hasLayer(layer)) map.removeLayer(layer);
    });
    quickPlannerState.layers = [];
}

function getSegmentEndpointLatLng(endpoint) {
    if (!endpoint) return null;
    const geo = endpoint.stop?.centre?.geographic || endpoint.centre?.geographic || endpoint.origin?.centre?.geographic || endpoint.destination?.centre?.geographic;
    if (geo && geo.latitude && geo.longitude) {
        return [parseFloat(geo.latitude), parseFloat(geo.longitude)];
    }
    if (endpoint.stop?.lat && endpoint.stop?.lon) {
        return [parseFloat(endpoint.stop.lat), parseFloat(endpoint.stop.lon)];
    }
    return null;
}

function getStopCoordsById(stopId) {
    if (!stopId) return null;
    const stop = gtfsData.stopDetails?.[stopId];
    if (stop?.stop_lat && stop?.stop_lon) {
        return [parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)];
    }
    const fallback = allLocalStops.find(s => String(s.stop_id) === String(stopId));
    if (fallback) {
        return [fallback.stop_lat, fallback.stop_lon];
    }
    return null;
}

async function getPolylineForRideSegment(segment, startStopId, endStopId, fallbackStartCoords, fallbackEndCoords) {
    const routeNumber = segment.route?.number || segment.route?.name;
    // console.log(`[Polyline] Processing route ${routeNumber}`, { segment, startStopId, endStopId });

    if (!routeNumber) return null;

    const routeEntry = gtfsData.routes.find(r => String(r.route_short_name) === String(routeNumber) || String(r.route_id) === String(segment.route?.key));
    if (!routeEntry) {
        // console.warn(`[Polyline] Route entry not found for ${routeNumber}`);
        return null;
    }
    
    const loaded = await loadRouteTripsAndShapes(routeEntry.route_id);
    if (!loaded) {
        // console.warn(`[Polyline] Failed to load trips/shapes for ${routeEntry.route_id}`);
        return null;
    }
    
    const tripIds = gtfsData.routeToTrips?.[routeEntry.route_id] || [];
    // console.log(`[Polyline] Found ${tripIds.length} trips for ${routeEntry.route_id}`);

    const fromCoords = startStopId ? getStopCoordsById(startStopId) : null;
    const toCoords = endStopId ? getStopCoordsById(endStopId) : null;
    const startPoint = fromCoords || fallbackStartCoords;
    const endPoint = toCoords || fallbackEndCoords;
    
    if (!startPoint || !endPoint) {
        // console.warn('[Polyline] Missing start/end coordinates');
        return null;
    }

    // Try to find shape in local GTFS data
    for (const tripId of tripIds) {
        const stops = gtfsData.tripToStops?.[tripId];
        if (!stops) continue;
        
        // Optimization: Check if this trip actually contains the start and end stops
        // This is expensive if we do it for every trip. 
        // But we need to find a shape that matches.
        
        const shapeId = gtfsData.tripToShape?.[tripId];
        const shapePoints = gtfsData.shapes?.[shapeId];
        
        if (!shapePoints?.length) continue;
        
        // We try to extract segment from the first valid shape we find associated with this route
        // Ideally we should match the exact trip, but we don't know which trip the planner selected exactly without more info.
        // So we try to find a shape that covers the distance.
        
        const segmentPoints = extractShapeSegmentPoints(shapePoints, startPoint, endPoint);
        if (segmentPoints?.length && segmentPoints.length > 2) {
            // console.log(`[Polyline] Found local shape ${shapeId} with ${segmentPoints.length} points`);
            return segmentPoints;
        }
    }

    // Fallback: Try to fetch variant geometry from API if local shape is missing
    if (segment.variant?.key) {
        // console.log(`[Polyline] Fetching variant API for ${segment.variant.key}`);
        try {
            // Use encodeURIComponent to handle special characters in variant key
            const res = await fetch(`/api/variant/${encodeURIComponent(segment.variant.key)}`);
            if (res.ok) {
                const data = await res.json();
                const variant = data.variant;
                let decoded = null;
                
                if (variant && variant.geometry && variant['geometry-encoded']) {
                     decoded = decodePolyline(variant['geometry-encoded']);
                } else if (variant && variant.geometry && variant.geometry['encoded-polyline']) {
                    decoded = decodePolyline(variant.geometry['encoded-polyline']);
                }
                
                if (decoded && decoded.length > 0) {
                    // console.log(`[Polyline] Decoded ${decoded.length} points from API`);
                    const extracted = extractShapeSegmentPoints(decoded.map(pt => ({lat: pt[0], lon: pt[1]})), startPoint, endPoint);
                    if (extracted && extracted.length > 0) return extracted;
                    return decoded; // Return full shape if extraction fails but we have data
                }
            } else {
                console.warn(`[Polyline] API fetch failed: ${res.status}`);
            }
        } catch (e) {
            console.warn('[Polyline] Failed to fetch variant geometry', e);
        }
    } else {
        // console.warn('[Polyline] No variant key available for fallback');
    }

    return null;
}

function decodePolyline(str, precision) {
    var index = 0,
        lat = 0,
        lng = 0,
        coordinates = [],
        shift = 0,
        result = 0,
        byte = null,
        latitude_change,
        longitude_change,
        factor = Math.pow(10, precision || 5);

    while (index < str.length) {
        byte = null;
        shift = 0;
        result = 0;

        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

        shift = result = 0;

        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

        lat += latitude_change;
        lng += longitude_change;

        coordinates.push([lat / factor, lng / factor]);
    }

    return coordinates;
}

function extractShapeSegmentPoints(shapePoints, fromCoords, toCoords) {
    if (!shapePoints?.length || !fromCoords || !toCoords) return null;
    const fromLL = L.latLng(fromCoords[0], fromCoords[1]);
    const toLL = L.latLng(toCoords[0], toCoords[1]);
    let startIdx = 0;
    let endIdx = shapePoints.length - 1;
    let minStartDist = Infinity;
    let minEndDist = Infinity;

    shapePoints.forEach((pt, idx) => {
        const latLng = L.latLng(pt.lat, pt.lon);
        const startDist = fromLL.distanceTo(latLng);
        const endDist = toLL.distanceTo(latLng);
        if (startDist < minStartDist) {
            minStartDist = startDist;
            startIdx = idx;
        }
        if (endDist < minEndDist) {
            minEndDist = endDist;
            endIdx = idx;
        }
    });

    if (startIdx > endIdx) {
        [startIdx, endIdx] = [endIdx, startIdx];
    }

    return shapePoints.slice(startIdx, endIdx + 1).map(pt => [pt.lat, pt.lon]);
}

function getRideSegmentColor(segment) {
    const badgeColor = segment.route?.['badge-style']?.['background-color'];
    if (badgeColor) return badgeColor;
    const rawColor = segment.route?.color;
    if (rawColor) {
        return rawColor.startsWith('#') ? rawColor : `#${rawColor}`;
    }
    return getComputedStyle(document.documentElement).getPropertyValue('--ios-accent').trim();
}

async function drawQuickPlanOnMap(plan) {
    if (!map) return;
    clearQuickPlannerLayers();
    if (!plan) return;

    const boundsPoints = [];
    const segments = plan.segments || [];
    let lastStopContext = null;

    for (let idx = 0; idx < segments.length; idx++) {
        const segment = segments[idx];

        if (segment.type === 'ride') {
            const startContext = lastStopContext || findPreviousStopContext(segments, idx) || null;
            const endContext = findNextStopContext(segments, idx + 1) || null;
            const ridePolyline = await getPolylineForRideSegment(
                segment,
                startContext?.stopId,
                endContext?.stopId,
                startContext?.coords,
                endContext?.coords
            );
            const fallbackLine = buildFallbackLine(startContext?.coords, endContext?.coords);
            const polyPoints = ridePolyline || fallbackLine;
            if (!polyPoints || polyPoints.length < 2) continue;
            const color = getRideSegmentColor(segment);
            const line = L.polyline(polyPoints, { color, weight: 5, opacity: 0.85 }).addTo(map);
            quickPlannerState.layers.push(line);
            boundsPoints.push(...polyPoints);
            
            // Add markers for ride start/end
            if (polyPoints.length > 0) {
                const startPt = polyPoints[0];
                const endPt = polyPoints[polyPoints.length - 1];
                
                const startMarker = L.circleMarker(startPt, {
                    radius: 5,
                    color: '#ffffff',
                    weight: 2,
                    fillColor: color,
                    fillOpacity: 1
                }).addTo(map);
                
                const endMarker = L.circleMarker(endPt, {
                    radius: 5,
                    color: '#ffffff',
                    weight: 2,
                    fillColor: color,
                    fillOpacity: 1
                }).addTo(map);
                
                quickPlannerState.layers.push(startMarker, endMarker);
            }

            if (endContext) lastStopContext = endContext;
            continue;
        }

        if (segment.type === 'walk') {
            const from = getSegmentEndpointLatLng(segment.from);
            const to = getSegmentEndpointLatLng(segment.to);
            if (from && to) {
                const walkLine = L.polyline([from, to], { color: '#99a1a8', weight: 4, dashArray: '1, 8', opacity: 0.8, lineCap: 'round' }).addTo(map);
                quickPlannerState.layers.push(walkLine);
                boundsPoints.push(from, to);
                
                // Add small dots for walk path
                const walkStart = L.circleMarker(from, { radius: 3, color: 'transparent', fillColor: '#99a1a8', fillOpacity: 0.8 }).addTo(map);
                const walkEnd = L.circleMarker(to, { radius: 3, color: 'transparent', fillColor: '#99a1a8', fillOpacity: 0.8 }).addTo(map);
                quickPlannerState.layers.push(walkStart, walkEnd);
            }
            const arrivalContext = getStopContextFromEndpoint(segment.to) || getStopContextFromEndpoint(segment.from);
            if (arrivalContext) {
                lastStopContext = arrivalContext;
            }
        }
    }

    const origin = quickPlannerState.origin;
    if (origin) {
        const originMarker = L.circleMarker([origin.lat, origin.lon], {
            radius: 6,
            color: '#34c759',
            weight: 3,
            fillColor: '#34c759',
            fillOpacity: 0.8
        }).addTo(map);
        quickPlannerState.layers.push(originMarker);
        boundsPoints.push([origin.lat, origin.lon]);
    }

    if (quickPlannerState.destination) {
        const destMarker = L.circleMarker([quickPlannerState.destination.lat, quickPlannerState.destination.lon], {
            radius: 6,
            color: '#ff3b30',
            weight: 3,
            fillColor: '#ff3b30',
            fillOpacity: 0.8
        }).addTo(map);
        quickPlannerState.layers.push(destMarker);
        boundsPoints.push([quickPlannerState.destination.lat, quickPlannerState.destination.lon]);
    }

    if (boundsPoints.length > 0) {
        const bounds = L.latLngBounds(boundsPoints);
        // Adjust padding to account for the bottom sheet (approx 40-50% of screen height)
        // We add significant bottom padding so the route is drawn in the top visible area
        const bottomPadding = window.innerHeight * 0.45; 
        map.fitBounds(bounds, { 
            paddingTopLeft: [20, 20],
            paddingBottomRight: [20, bottomPadding]
        });
    }
}


// --- Главные обработчики событий и координаторы ---

// Подгружает остановки для текущей области карты если они еще не загружены
async function loadStopsForCurrentView() {
    const center = map.getCenter();
    const radius = 1000; // 1 км радиус
    
    // Проверяем загружена ли эта область
    if (SmartCache.isAreaLoaded(center.lat, center.lng, radius)) {
        console.log('Area already loaded from cache');
        return;
    }
    
    console.log(`Loading stops for area: lat=${center.lat}, lon=${center.lng}, radius=${radius}m`);
    
    try {
        const response = await fetch(`/api/stops?lat=${center.lat}&lon=${center.lng}&distance=${radius}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        if (data.stops && data.stops.length > 0) {
            // Конвертируем в формат GTFS и добавляем в кэш
            const gtfsStops = data.stops.map(stop => ({
                stop_id: stop.key.toString(),
                stop_name: stop.name,
                stop_lat: stop.centre.geographic.latitude.toString(),
                stop_lon: stop.centre.geographic.longitude.toString()
            }));
            
            SmartCache.addStops(gtfsStops);
            
            // Обновляем глобальный массив остановок
            const existingIds = new Set(allLocalStops.map(s => s.stop_id));
            gtfsStops.forEach(stop => {
                if (!existingIds.has(stop.stop_id)) {
                    allLocalStops.push(stop);
                }
            });
            
            // Отмечаем область как загруженную
            SmartCache.markAreaLoaded(center.lat, center.lng, radius);
            
            // Обновляем маркеры на карте
            refreshMarkers(center);
            
            console.log(`Added ${gtfsStops.length} new stops to cache`);
        }
    } catch (error) {
        console.error('Failed to load stops for area:', error);
    }
}

async function requestInitialLocationAndSetView() { 
    showLoadingOverlay('Initializing...');

    function setViewAndLoadData(center, zoom) {
        map.setView(center, zoom);
        if (centerMarker) centerMarker.setLatLng(center);
        if (radiusCircle) radiusCircle.setLatLng(center);
        
        // Используем API вместо локальных GTFS файлов
        loadAndProcessFromAPI(); 
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userCenter = [position.coords.latitude, position.coords.longitude];
                if (!userLocationMarker) userLocationMarker = L.marker(userCenter, { icon: userLocationIcon, zIndexOffset: 1000, interactive: false }).addTo(map);
                else userLocationMarker.setLatLng(userCenter);
                setViewAndLoadData(userCenter, INITIAL_USER_ZOOM);
                
                // Устанавливаем местоположение пользователя как стартовый адрес
                updateStartAddressWithLocation(userCenter, 'Your Location');
            },
            () => { 
                showLoadingOverlay('Location denied. Loading default area...'); 
                setViewAndLoadData(DEFAULT_WINNIPEG_CENTER, DEFAULT_ZOOM_UNCLUSTERED); 
                
                // Устанавливаем центр Виннипега как стартовый адрес (запасной вариант)
                updateStartAddressWithLocation(DEFAULT_WINNIPEG_CENTER, 'Winnipeg (center)');
            },
            { timeout: 8000, maximumAge: 60000, enableHighAccuracy: true }
        );
    } else { 
        showLoadingOverlay('Geolocation not supported. Loading default area...'); 
        setViewAndLoadData(DEFAULT_WINNIPEG_CENTER, DEFAULT_ZOOM_UNCLUSTERED); 
        
        // Устанавливаем центр Виннипега как стартовый адрес (запасной вариант)
        updateStartAddressWithLocation(DEFAULT_WINNIPEG_CENTER, 'Winnipeg (center)');
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
            setQuickPlannerOrigin(userCenter, 'Your location');
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
    clearQuickPlannerLayers();
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
    
    // Reset filter UI
    const routeFilterSelect = document.getElementById('route-filter');
    if (routeFilterSelect) routeFilterSelect.value = '';
    
    // Reset internal state
    filters.route = null;
    isLiveBusViewActive = false;
    liveViewSpecificShapeId = null;
    liveViewOriginStopData = null;
    document.body.classList.remove('search-results-active');
    
    // Clear map layers
    clearPreviousRouteDrawing();
    routeStopMarkersLayerGroup.clearLayers();
    if (simulatedBusesLayerGroup) simulatedBusesLayerGroup.clearLayers();
    activeSimulatedBuses = {};
    
    // Restore default map elements
    if (radiusCircle) radiusCircle.setStyle({ opacity: 1, fillOpacity: 0.05 });
    if (centerMarker) centerMarker.setOpacity(1);

    // Restore view
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
    
    updateResetRouteButtonVisibility();
    map.closePopup();
}
function getCoordsFromInput(value, type) {
    const list = type === 'start' ? startAddressResults : endAddressResults;
    const match = list.find(r => r.display === value);
    if (match) return { lat: match.lat, lon: match.lon };
    return null;
}
function setupAddressAutocomplete() {
    const startInput = document.getElementById('route-start-address');
    const endInput = document.getElementById('route-end-address');
    startInput?.addEventListener('input', async e => {
        startAddressResults = await getAddressSuggestions(e.target.value);
        const list = document.getElementById('start-address-suggestions');
        if (list) {
            list.innerHTML = '';
            startAddressResults.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.display;
                list.appendChild(opt);
            });
        }
    });
    endInput?.addEventListener('input', async e => {
        endAddressResults = await getAddressSuggestions(e.target.value);
        const list = document.getElementById('end-address-suggestions');
        if (list) {
            list.innerHTML = '';
            endAddressResults.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.display;
                list.appendChild(opt);
            });
        }
    });
}

function setDefaultStartAddress() {
    // Эта функция будет вызвана после определения местоположения
    // Она установит стартовый адрес в Route Planner
}

function updateStartAddressWithLocation(coords, displayName) {
    try {
        const startInput = document.getElementById('route-start-address');
        if (startInput && !startInput.value) {
            startInput.value = displayName;
            startAddressResults = [{ display: displayName, lat: coords[0], lon: coords[1] }];
        }
    } catch (e) {
        // defensive: ignore if DOM not ready
    }
    setQuickPlannerOrigin(coords, displayName || 'Ваше местоположение');
}
function getCoordsFromInput(value, type) {
    const list = type === 'start' ? startAddressResults : endAddressResults;
    const match = list.find(r => r.display === value);
    if (match) return { lat: match.lat, lon: match.lon };
    return null;
}

function setupAddressAutocomplete() {
    const startInput = document.getElementById('route-start-address');
    const endInput = document.getElementById('route-end-address');
    startInput?.addEventListener('input', async e => {
        startAddressResults = await getAddressSuggestions(e.target.value);
        const list = document.getElementById('start-address-suggestions');
        if (list) {
            list.innerHTML = '';
            startAddressResults.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.display;
                list.appendChild(opt);
            });
        }
    });
    endInput?.addEventListener('input', async e => {
        endAddressResults = await getAddressSuggestions(e.target.value);
        const list = document.getElementById('end-address-suggestions');
        if (list) {
            list.innerHTML = '';
            endAddressResults.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.display;
                list.appendChild(opt);
            });
        }
    });
}
async function buildRouteFromAddresses() {
    const startAddr = document.getElementById('route-start-address')?.value.trim();
    const endAddr = document.getElementById('route-end-address')?.value.trim();
    const resultEl = document.getElementById('route-plan-result');
    const spinner = document.getElementById('route-plan-spinner');
    if (!startAddr || !endAddr || !resultEl) return;
    resultEl.textContent = 'Searching...';

    let startCoord = getCoordsFromInput(startAddr, 'start');
    let endCoord = getCoordsFromInput(endAddr, 'end');
    if (!startCoord) startCoord = await geocodeAddress(startAddr);
    if (!endCoord) endCoord = await geocodeAddress(endAddr);
    if (!startCoord || !endCoord) { resultEl.textContent = 'Address not found.'; return; }

    buildRouteBetweenAddresses(startCoord, endCoord, startAddr, endAddr);
}


function buildRouteBetweenAddresses(startCoord, endCoord, startAddr, endAddr) {
    const resultEl = document.getElementById('route-plan-result');
    const optionsEl = document.getElementById('route-plan-options');
    if (!startId || !endId || !resultEl || !optionsEl) return;

    if (currentRoutePolyline) { map.removeLayer(currentRoutePolyline); currentRoutePolyline = null; }
    optionsEl.innerHTML = '';

    const routeOptions = findRouteOptions(startId, endId);
    if (routeOptions.length === 0) {
        resultEl.textContent = 'No route found.';
        return;
    }

    drawRouteOption(routeOptions[0]);
    const firstLeg = routeOptions[0].legs[0];
    const lastLeg = routeOptions[0].legs[routeOptions[0].legs.length - 1];
    const serviceDate = determineSimulationTimeUTC();
    const dep = getDatetimeForGtfsTime(firstLeg.startTime, serviceDate);
    const arr = getDatetimeForGtfsTime(lastLeg.endTime, serviceDate);
    resultEl.textContent = `Departs ${dep.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}, arrives ${arr.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;

    routeOptions.forEach((opt, idx) => {
        const legFirst = opt.legs[0];
        const legLast = opt.legs[opt.legs.length-1];
        const d = getDatetimeForGtfsTime(legFirst.startTime, serviceDate);
        const a = getDatetimeForGtfsTime(legLast.endTime, serviceDate);
        const item = document.createElement('div');
        item.className = 'route-option-item';
        item.textContent = `${idx===0?'Fastest':'Option '+(idx+1)}: ${opt.transfers} transfers, ${(a - d)/60000|0} min`;
        item.addEventListener('click', () => {
            drawRouteOption(opt);
            resultEl.textContent = `Departs ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}, arrives ${a.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
        });
        optionsEl.appendChild(item);
    });
}

function findRouteOptions(startStopId, endStopId) {
    const serviceDate = determineSimulationTimeUTC();
    const nowSeconds = serviceDate.getUTCHours()*3600 + serviceDate.getUTCMinutes()*60 + serviceDate.getUTCSeconds();
    const options = [];

    for (const tripId in gtfsData.tripToStops) {
        const stops = gtfsData.tripToStops[tripId];
        const startIdx = stops.findIndex(s => String(s.stop_id) === String(startStopId));
        const endIdx = stops.findIndex(s => String(s.stop_id) === String(endStopId));
        if (startIdx >= 0 && endIdx > startIdx) {
            const depSec = gtfsTimeToSeconds(stops[startIdx].departure_time);
            const arrSec = gtfsTimeToSeconds(stops[endIdx].arrival_time);
            if (depSec !== null && arrSec !== null && depSec >= nowSeconds) {
                options.push({
                    transfers: 0,
                    legs: [{tripId, start: startStopId, end: endStopId, startTime: depSec, endTime: arrSec}]
                });
            }
        }
    }

    // one transfer
    for (const tripIdA in gtfsData.tripToStops) {
        const stopsA = gtfsData.tripToStops[tripIdA];
        const startIdx = stopsA.findIndex(s => String(s.stop_id) === String(startStopId));
        if (startIdx < 0) continue;
        for (let i = startIdx + 1; i < Math.min(startIdx + 6, stopsA.length); i++) {
            const transferStop = stopsA[i];
            const depSecA = gtfsTimeToSeconds(stopsA[startIdx].departure_time);
            const arrSecTransfer = gtfsTimeToSeconds(transferStop.arrival_time);
            if (depSecA === null || arrSecTransfer === null || depSecA > nowSeconds || arrSecTransfer <= depSecA) continue;
            for (const tripIdB in gtfsData.tripToStops) {
                const stopsB = gtfsData.tripToStops[tripIdB];
                const transferIdx = stopsB.findIndex(s => String(s.stop_id) === String(transferStop.stop_id));
                const endIdxB = stopsB.findIndex(s => String(s.stop_id) === String(endStopId));
                if (transferIdx >= 0 && endIdxB > transferIdx) {
                    const depSecB = gtfsTimeToSeconds(stopsB[transferIdx].departure_time);
                    const arrSecB = gtfsTimeToSeconds(stopsB[endIdxB].arrival_time);
                    if (depSecB !== null && arrSecB !== null && depSecB >= arrSecTransfer) {
                        options.push({
                            transfers: 1,
                            legs: [
                                {tripId: tripIdA, start: startStopId, end: transferStop.stop_id, startTime: depSecA, endTime: arrSecTransfer},
                                {tripId: tripIdB, start: transferStop.stop_id, end: endStopId, startTime: depSecB, endTime: arrSecB}
                            ]
                        });
                    }
                }
            }
        }
    }

    return options.sort((a,b) => {
        const tA = a.legs[a.legs.length-1].endTime - a.legs[0].startTime;
        const tB = b.legs[b.legs.length-1].endTime - b.legs[0].startTime;
        if (tA !== tB) return tA - tB;
        return a.transfers - b.transfers;
    }).slice(0,3);
}

function drawRouteOption(option) {
    if (currentRoutePolyline) {
        map.removeLayer(currentRoutePolyline);
        currentRoutePolyline = null;
    }
    const polylines = [];
    option.legs.forEach(leg => {
        const trip = gtfsData.trips.find(t => t.trip_id === leg.tripId);
        if (!trip) return;
        const shapeId = trip.shape_id;
        const shape = gtfsData.shapes[shapeId];
        if (!shape) return;
        const poly = shape.map(p => [p.lat, p.lon]);
        polylines.push(poly);
    });
    if (polylines.length > 0) {
        currentRoutePolyline = L.polyline(polylines, { color: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(), weight: 5 }).addTo(map);
        map.fitBounds(currentRoutePolyline.getBounds(), { padding: [50,50] });
    }
}

// Expose globally so initUI can attach handlers before the function definition
window.resetFilters = function resetFilters() {
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
                <span class="live-route-headsign">${nextBus.headsign}</span>
                <span class="live-arrival-time">${timeText}</span>
            </div>
        `;
    } else {
        container.innerHTML = '';
    }
}

function clearAllMapLayersForLiveView(fullClear = true, originStopToPreserve = null) {
    if (currentRoutePolyline) { map.removeLayer(currentRoutePolyline); currentRoutePolyline = null; }
    
    // Удаляем маркеры остановок на маршруте
    if (window.routeStopMarkers && window.routeStopMarkers.length > 0) {
        window.routeStopMarkers.forEach(marker => map.removeLayer(marker));
        window.routeStopMarkers = [];
    }
    
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

// Fallback для старого формата отображения (на случай ошибок)
function renderLegacyAPISchedule(container, routeSchedules, currentTime) {
    console.log('Using legacy API schedule rendering');
    
    const routesToDisplay = routeSchedules.map(rs => {
        let earliestTimestamp = Infinity;
        (rs['scheduled-stops'] || []).forEach(sS => {
            if (sS.cancelled === "true") return;
            const arrivalInfo = formatArrivalTime(sS.times?.departure, currentTime);
            if (arrivalInfo.timestamp < earliestTimestamp) earliestTimestamp = arrivalInfo.timestamp;
        });
        return { ...rs, earliestTimestamp };
    }).sort((a, b) => a.earliestTimestamp - b.earliestTimestamp);
    
    routesToDisplay.forEach(rs => {
        const routeAPIData = rs.route;
        const scheduledStops = rs['scheduled-stops'] || [];
        
        const allArrivals = [];
        scheduledStops.forEach(sS => {
            if (sS.cancelled === "true") return;
            const fmt = formatArrivalTime(sS.times?.departure, currentTime);
            if (fmt.text) {
                allArrivals.push({ ...fmt, sStop: sS });
            }
        });
        
        if (allArrivals.length === 0) return;
        
        const routeDiv = document.createElement('div');
        routeDiv.className = 'route-item';
        routeDiv.innerHTML = `
            <div class="route-item-info">
                <span class="route-circle">${routeAPIData.number}</span>
                <span class="route-name-schedule">${routeAPIData.name || `Route ${routeAPIData.number}`}</span>
            </div>
            <div class="route-schedule-grid">
                ${allArrivals.slice(0, 3).map((arr, idx) => `
                    <div class="arrival-time-item ${arr.css} ${idx === 0 ? 'primary-arrival' : ''}"
                         data-scheduled-time="${arr.sStop.times?.departure?.scheduled || ''}"
                         data-estimated-time="${arr.sStop.times?.departure?.estimated || ''}"
                         data-original-timestamp="${arr.timestamp}">
                        ${arr.text}
                        ${arr.css.includes('live') ? '<span class="live-indicator"></span>' : ''}
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(routeDiv);
    });
}

// ==========================================================
//     GTFS Fallback для расписания
// ==========================================================
function getGTFSScheduleForStop(stopId, referenceTimeUTC) {
    const schedule = [];
    const endTimeUTC = new Date(referenceTimeUTC.getTime() + 4 * 60 * 60 * 1000);
    
    // Находим все stop_times для данной остановки
    const stopTimesForStop = gtfsData.stopTimes.filter(st => String(st.stop_id) === String(stopId));
    
    const routeSchedules = {};
    
    stopTimesForStop.forEach(st => {
        const trip = gtfsData.trips.find(t => t.trip_id === st.trip_id);
        if (!trip) return;
        
        const route = gtfsData.routes.find(r => r.route_id === trip.route_id);
        if (!route) return;
        
        // Конвертируем GTFS время в datetime
        const gtfsSeconds = gtfsTimeToSeconds(st.departure_time);
        if (gtfsSeconds === null) return;
        
        const departureTime = getDatetimeForGtfsTime(gtfsSeconds, referenceTimeUTC);
        if (!departureTime) return;
        
        // Фильтруем по времени
        if (departureTime < referenceTimeUTC || departureTime > endTimeUTC) return;
        
        const routeKey = route.route_short_name || route.route_id;
        
        if (!routeSchedules[routeKey]) {
            routeSchedules[routeKey] = {
                routeNumber: route.route_short_name || route.route_id,
                routeName: trip.trip_headsign || route.route_long_name || `Route ${routeKey}`,
                times: []
            };
        }
        
        const timeStr = departureTime.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false,
            timeZone: 'America/Winnipeg'
        });
        
        routeSchedules[routeKey].times.push(timeStr);
    });
    
    // Преобразуем в массив и сортируем времена
    Object.values(routeSchedules).forEach(rs => {
        rs.times.sort();
        rs.times = rs.times.slice(0, 10); // Максимум 10 времен
        schedule.push(rs);
    });
    
    return schedule;
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
    let lastDisplayedStopNumber = stop.number || stop.stop_code;

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
    if (typeof closeOtherPanels === 'function') closeOtherPanels('schedule-panel');
    if (typeof updateBodyPanelOpenClass === 'function') updateBodyPanelOpenClass();

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
    favButton.onclick = (e) => { e.stopPropagation(); if (isFavorite(currentStopForSchedulePanel.stop_id)) removeFavorite(currentStopForSchedulePanel.stop_id); else addFavorite(currentStopForSchedulePanel); if (schedulePanelTitle) { const updatedFav = favorites.find(f => String(f.stop_id) === String(stop.stop_id)); let newTitle = updatedFav ? updatedFav.custom_name : (stop.stop_name || `Stop #${stop.stop_id}`); if (lastDisplayedStopNumber && String(lastDisplayedStopNumber) !== String(stop.stop_id)) newTitle += ` (#${lastDisplayedStopNumber})`; schedulePanelTitle.textContent = newTitle; } };

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

        // Используем Unix timestamp (целые числа) вместо ISO строк, чтобы обойти WAF
        const startTimestamp = scheduleStartTimeUTC.getTime();
        const endTimestamp = scheduleEndTimeUTC.getTime();
        
        const fetchUrl = `${API_BASE}/api/stops/${stop.stop_id}/schedule?usage=long&start=${startTimestamp}&end=${endTimestamp}`;
        
        const scheduleRes = await fetch(fetchUrl);

        if (!panel.classList.contains('active') || !currentStopForSchedulePanel || String(currentStopForSchedulePanel.stop_id) !== String(stop.stop_id)) {
            panel.style.maxHeight = ''; return; 
        }
        if (!scheduleRes.ok) {
             const errorText = await scheduleRes.text();
             throw new Error(`API Error ${scheduleRes.status}: ${errorText}`);
        }
        
        const scheduleJson = await scheduleRes.json();
        const parsedStopSchedule = extractStopSchedule(scheduleJson);
        
        _currentPanelApiRouteSchedules = parsedStopSchedule?.['route-schedules'] || [];
        
        updateLiveActivity(_currentPanelApiRouteSchedules);

        const apiStopData = parsedStopSchedule?.stop;
        if (schedulePanelTitle && apiStopData) { 
            lastDisplayedStopNumber = apiStopData.number || lastDisplayedStopNumber;
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
            // Используем старый проверенный UI с улучшениями
            let routeSchedulesToDisplay = _currentPanelApiRouteSchedules.map(rs => {
                let earliestTimestamp = Infinity;
                (rs['scheduled-stops'] || []).forEach(sS => {
                    if (sS.cancelled === "true") return; 
                    const arrivalInfo = formatArrivalTime(sS.times?.departure, currentSimTimeUTC);
                    if (arrivalInfo.timestamp < earliestTimestamp) earliestTimestamp = arrivalInfo.timestamp;
                });
                return {...rs, earliestTimestamp};
            }).sort((a,b) => a.earliestTimestamp - b.earliestTimestamp);

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
                    routeCircleSpan.style.cursor = 'pointer';
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
                            // Загружаем trips для маршрута перед симуляцией
                            const routeNumber = specificRouteScheduleForButton?.route?.number;
                            if (routeNumber) {
                                const gtfsRoute = gtfsData.routes.find(r => String(r.route_short_name) === String(routeNumber));
                                if (gtfsRoute) {
                                    await loadRouteTripsAndShapes(gtfsRoute.route_id);
                                }
                            }
                            
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
            
            if (scheduleItemsContainer.children.length === 0 && scheduleItemsContainer) {
                scheduleItemsContainer.innerHTML = `<div class="no-schedule">${getRandomNoScheduleMessage()} <small>(No displayable services)</small></div>`;
            }
            
            scheduleCountdownIntervalId = setInterval(updateScheduleCountdown, SCHEDULE_COUNTDOWN_INTERVAL);
            scheduleApiRefreshIntervalId = setInterval(refreshScheduleApiData, SCHEDULE_API_REFRESH_INTERVAL);
        } else {
            if (scheduleItemsContainer) scheduleItemsContainer.innerHTML = `<div class="no-schedule">${getRandomNoScheduleMessage()}${scheduleJson?.message ? ' <small>' + scheduleJson.message + '</small>' : ''}</div>`;
            if (simulatedBusesLayerGroup) simulatedBusesLayerGroup.clearLayers(); activeSimulatedBuses = {};
        }
        panel.style.maxHeight = '';
    } catch (e) {
        updateLiveActivity(null);
        console.warn(`API schedule unavailable for stop ${stop.stop_id}, falling back to GTFS:`, e.message);
        
        // Fallback на GTFS расписание
        try {
            const gtfsSchedule = getGTFSScheduleForStop(stop.stop_id, currentSimTimeUTC);
            
            if (gtfsSchedule && gtfsSchedule.length > 0 && scheduleItemsContainer) {
                scheduleItemsContainer.innerHTML = '<div style="padding: 8px; background: rgba(255, 193, 7, 0.1); border-radius: 8px; margin-bottom: 8px; font-size: 0.85em; color: var(--warning-color);"><i class="fas fa-info-circle"></i> Showing GTFS schedule (API unavailable)</div>';
                
                gtfsSchedule.forEach(item => {
                    const routeItemDiv = document.createElement('div');
                    routeItemDiv.className = 'route-item';
                    routeItemDiv.innerHTML = `
                        <div class="route-item-info">
                            <span class="route-circle" style="cursor: default;">${item.routeNumber}</span>
                        </div>
                        <div class="route-item-details">
                            <span class="route-name-schedule">${item.routeName}</span>
                            <div class="route-schedule-grid">
                                ${item.times.map(time => `<div class="arrival-time-item gtfs-scheduled">${time}</div>`).join('')}
                            </div>
                        </div>
                    `;
                    scheduleItemsContainer.appendChild(routeItemDiv);
                });
                
                scheduleCountdownIntervalId = setInterval(updateScheduleCountdown, SCHEDULE_COUNTDOWN_INTERVAL);
            } else {
                if(scheduleItemsContainer) scheduleItemsContainer.innerHTML = `<div class="no-schedule error-message">Schedule unavailable. <small>(API error & no GTFS data)</small></div>`;
            }
        } catch (gtfsError) {
            console.error('GTFS fallback also failed:', gtfsError);
            if(scheduleItemsContainer) scheduleItemsContainer.innerHTML = `<div class="no-schedule error-message">Oops! Couldn't fetch schedule. <small>(${e.message})</small></div>`;
        }
        
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
    const ruleEditorModal = document.getElementById('rule-editor-modal');

    // Helper to check if click is on a dock button for a specific panel
    const isDockButtonFor = (panelId) => e.target.closest(`.ios-dock-button[data-panel-target="${panelId}"]`);

    if (filterPanel?.classList.contains('active') && !filterPanel.contains(e.target) && !e.target.closest('#filter-toggle') && !isDockButtonFor('filter-panel')) closeFilterPanel();
    
    if (ruleEditorModal?.classList.contains('modal-visible') && !ruleEditorModal.querySelector('.modal-content').contains(e.target) && !e.target.closest('.setup-reminder-btn') && !e.target.closest('#add-new-regular-notification-rule') && !e.target.closest('.edit-rule-btn')) { 
        // Не закрывать редактор правил по клику снаружи
    } else if (schedulePanel?.classList.contains('active') && !schedulePanel.contains(e.target) && !e.target.closest('.stop-marker-wrapper') && !e.target.closest('.favorite-item-info') && !isDockButtonFor('schedule-panel')) {
        closeSchedulePanel();
    }

    if (favoritesPanel?.classList.contains('active') && !favoritesPanel.contains(e.target) && !e.target.closest('#favorites-toggle') && !isDockButtonFor('favorites-panel')) closeFavoritesPanel();

    if (regularNotificationsPanel?.classList.contains('active') && !regularNotificationsPanel.contains(e.target) && !e.target.closest('#regular-notifications-toggle-button') && !ruleEditorModal?.classList.contains('modal-visible') && !isDockButtonFor('regular-notifications-panel')) {
        closeRegularNotificationsPanel();
    }

});


// --- Запуск приложения ---
window.addEventListener('DOMContentLoaded', () => {
    initMap(); 
    startSmoothBusAnimationLoop(); 
});