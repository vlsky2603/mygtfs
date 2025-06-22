// ===================================================================
//     ui_controller.js - Управление интерфейсом
// ===================================================================

const loadingOverlay = document.getElementById('loading');
const loadingOverlayTextSpan = loadingOverlay?.querySelector('.loading-text');
const loadingAnimationContainer = loadingOverlay?.querySelector('.loading-animation-container');

function showLoadingOverlay(message) {
    if (loadingOverlay) {
        if (loadingOverlayTextSpan) loadingOverlayTextSpan.textContent = message || 'Loading...';
        if (loadingAnimationContainer && !loadingAnimationContainer.querySelector('.loading-spinner')) {
            loadingAnimationContainer.innerHTML = '<div class="loading-spinner"></div>';
        }
        loadingOverlay.classList.add('visible');
    }
}
function hideLoadingOverlay() { if (loadingOverlay) loadingOverlay.classList.remove('visible'); }

function showTopProgressBar() {
    const progressBar = document.getElementById('top-progress-bar');
    if (progressBar) progressBar.classList.add('visible');
}
function hideTopProgressBar() {
    const progressBar = document.getElementById('top-progress-bar');
    if (progressBar) progressBar.classList.remove('visible');
}

function createToastContainer() {
    let container = document.getElementById('toast-notifications');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-notifications';
        document.body.appendChild(container);
    }
    return container;
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

function updateFavoriteButtonInSchedulePanel() {
    const favButton = document.querySelector('#schedule-panel .favorite-stop-btn');
    if (favButton && currentStopForSchedulePanel) {
        const isFav = isFavorite(currentStopForSchedulePanel.stop_id);
        favButton.classList.toggle('is-favorite', isFav);
        favButton.innerHTML = isFav ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
        favButton.title = isFav ? "Remove from Favorites" : "Add to Favorites";
    }
}

function updateResetRouteButtonVisibility() {
    const resetButton = document.getElementById('reset-route-button');
    if (resetButton) resetButton.style.display = (filters.route || isLiveBusViewActive) ? 'flex' : 'none';
}

function populateRouteFilter() {
    const routeSelect = document.getElementById('route-filter');
    if (!routeSelect) return;
    while (routeSelect.options.length > 1) routeSelect.remove(1); 
    if (!gtfsData.routes || gtfsData.routes.length === 0) return;
    
    const routesWithData = gtfsData.routes.filter(r => r.route_id && gtfsData.routeToTrips[r.route_id]?.length > 0);
    
    routesWithData.sort((a, b) => {
        const numA = parseInt(a.route_short_name, 10);
        const numB = parseInt(b.route_short_name, 10);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
        return String(a.route_short_name).localeCompare(String(b.route_short_name));
    }).forEach(route => {
        const option = document.createElement('option');
        option.value = route.route_id;
        const shortName = route.route_short_name || 'N/A';
        let longName = route.route_long_name?.trim() || '';
        option.text = shortName + (longName && longName !== shortName ? ` - ${longName}` : '');
        routeSelect.add(option);
    });
}

function populateStreetFilter() {
    const streetSelect = document.getElementById('street-filter');
    if (!streetSelect) return;
    if (allLocalStops.length === 0) {
        streetSelect.innerHTML = '<option value="">-- No Stops Loaded --</option>';
        return;
    }
    while (streetSelect.options.length > 1) streetSelect.remove(1); 
    
    const streets = new Set();
    allLocalStops.forEach(stop => {
        if (!stop.stop_name) return; 
        const nameParts = stop.stop_name.split(/ at | @ /i);
        [nameParts[0], nameParts[1]?.split('(')[0]].forEach(part => {
            if (part) {
                const potentialStreet = part.trim();
                if (potentialStreet && isNaN(potentialStreet) && potentialStreet.length > 2 &&
                    !/^(N|S|E|W|NB|SB|EB|WB|Flag)$/i.test(potentialStreet) && !/^\d/.test(potentialStreet)) {
                    streets.add(potentialStreet.replace(/\b\w/g, l => l.toUpperCase()));
                }
            }
        });
    });
    Array.from(streets).sort().forEach(streetName => {
        const option = document.createElement('option');
        option.value = streetName.toLowerCase();
        option.text = streetName;
        streetSelect.add(option);
    });
}

function updateStreetSearch(e) {
    const term = e.target.value.toLowerCase();
    const streetSelect = document.getElementById('street-filter');
    if (!streetSelect) return;
    Array.from(streetSelect.options).forEach(opt => { if (opt.value === "") { opt.style.display = 'block'; return; } opt.style.display = opt.text.toLowerCase().includes(term) ? 'block' : 'none'; });
}

function closePanel(panelId, removeBlur = true) {
    const panel = document.getElementById(panelId);
    if(panel) panel.classList.remove('active');

    if (removeBlur && !document.getElementById('schedule-panel')?.classList.contains('active') && !document.getElementById('filter-panel')?.classList.contains('active') && !document.getElementById('favorites-panel')?.classList.contains('active') && !document.getElementById('regular-notifications-panel')?.classList.contains('active')) {
        document.getElementById('map')?.classList.remove('map-blur');
    }
}

function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isActive = panel.classList.toggle('active');
    
    document.getElementById('map')?.classList.toggle('map-blur', isActive || document.getElementById('schedule-panel')?.classList.contains('active') || document.getElementById('filter-panel')?.classList.contains('active') || document.getElementById('favorites-panel')?.classList.contains('active') || document.getElementById('regular-notifications-panel')?.classList.contains('active'));
    
    if (isActive) {
        if (panelId !== 'schedule-panel') closeSchedulePanel(false);
        if (panelId !== 'filter-panel') closeFilterPanel(false);
        if (panelId !== 'favorites-panel') closeFavoritesPanel(false);
        if (panelId !== 'regular-notifications-panel') closeRegularNotificationsPanel(false);
        
        if (panelId === 'favorites-panel') renderFavoritesPanel();
        if (panelId === 'regular-notifications-panel') renderRegularNotificationsPanel();
    } else {
        if (panelId === 'regular-notifications-panel') closeRuleEditor();
    }
}

function closeFilterPanel(removeBlur = true) { closePanel('filter-panel', removeBlur); }
function closeFavoritesPanel(removeBlur = true) { closePanel('favorites-panel', removeBlur); }
function closeRegularNotificationsPanel(removeBlur = true) { closePanel('regular-notifications-panel', removeBlur); closeRuleEditor(); }
function closeSchedulePanel(removeBlur = true) {
    const panel = document.getElementById('schedule-panel');
    if (panel) { panel.classList.remove('active'); panel.style.maxHeight = ''; }
    
    closePanel('schedule-panel', removeBlur);

    _currentPanelApiRouteSchedules = []; 
    updateLiveActivity(null);
    if (scheduleCountdownIntervalId) clearInterval(scheduleCountdownIntervalId); scheduleCountdownIntervalId = null;
    if (scheduleApiRefreshIntervalId) clearInterval(scheduleApiRefreshIntervalId); scheduleApiRefreshIntervalId = null;
}