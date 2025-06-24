// ===================================================================
//     ui_controller.js - Управление интерфейсом
// ===================================================================

import { isFavorite } from './favorites_manager.js';
import { renderFavoritesPanel } from './favorites_manager.js';
import { renderRegularNotificationsPanel, closeRuleEditor } from './notifications_manager.js';

// Экспорт переменных состояния
export let filters = { route: null, direction: null, street: null };
export let isLiveBusViewActive = false;
export let currentRoutePolyline = null;

// Переменные состояния
let darkMode = localStorage.getItem('darkMode') === 'true';
let routePlannerStartMarker = null;
let routePlannerEndMarker = null;

// Переменные для расписания
let currentStop = null, schedules = [], currentStopForSchedulePanel = null;
let scheduleCountdownIntervalId = null, scheduleApiRefreshIntervalId = null;
let _currentPanelApiRouteSchedules = [];

const loadingOverlay = document.getElementById('loading');
const loadingOverlayTextSpan = loadingOverlay?.querySelector('.loading-text');
const loadingAnimationContainer = loadingOverlay?.querySelector('.loading-animation-container');

export function showLoadingOverlay(message) {
    if (loadingOverlay) {
        if (loadingOverlayTextSpan) loadingOverlayTextSpan.textContent = message || 'Loading...';
        if (loadingAnimationContainer && !loadingAnimationContainer.querySelector('.loading-spinner')) {
            loadingAnimationContainer.innerHTML = '<div class="loading-spinner"></div>';
        }
        loadingOverlay.classList.add('visible');
    }
}
export function hideLoadingOverlay() { if (loadingOverlay) loadingOverlay.classList.remove('visible'); }

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
    
    // Получаем переменные из глобального контекста
    const mapTileLayer = window.mapTileLayer;
    const radiusCircle = window.radiusCircle;
    
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

export function updateResetRouteButtonVisibility() {
    const resetButton = document.getElementById('reset-route-button');
    if (resetButton) resetButton.style.display = (filters.route || isLiveBusViewActive) ? 'flex' : 'none';
}

export function populateRouteFilter() {
    const routeSelect = document.getElementById('route-filter');
    if (!routeSelect) return;
    while (routeSelect.options.length > 1) routeSelect.remove(1); 
    
    // Получаем gtfsData из глобального контекста
    const gtfsData = window.gtfsData;
    if (!gtfsData || !gtfsData.routes || gtfsData.routes.length === 0) return;
    
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

export function populateStreetFilter() {
    const streetSelect = document.getElementById('street-filter');
    if (!streetSelect) return;
    
    // Получаем allLocalStops из глобального контекста
    const allLocalStops = window.allLocalStops;
    if (!allLocalStops || allLocalStops.length === 0) {
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

export function populateRoutePlannerStops() {
    const startSelect = document.getElementById('route-plan-start');
    const endSelect = document.getElementById('route-plan-end');
    if (!startSelect || !endSelect) return;
    while (startSelect.options.length > 0) startSelect.remove(0);
    while (endSelect.options.length > 0) endSelect.remove(0);
    
    // Получаем allLocalStops из глобального контекста
    const allLocalStops = window.allLocalStops;
    if (!allLocalStops || allLocalStops.length === 0) return;
    
    const fragmentStart = document.createDocumentFragment();
    const fragmentEnd = document.createDocumentFragment();
    allLocalStops.forEach(stop => {
        const optStart = document.createElement('option');
        optStart.value = stop.stop_id;
        optStart.text = `${stop.stop_name} (#${stop.stop_id})`;
        const optEnd = optStart.cloneNode(true);
        fragmentStart.appendChild(optStart);
        fragmentEnd.appendChild(optEnd);
    });
    startSelect.appendChild(fragmentStart);
    endSelect.appendChild(fragmentEnd);
}

function updateStreetSearch(e) {
    const term = e.target.value.toLowerCase();
    const streetSelect = document.getElementById('street-filter');
    if (!streetSelect) return;
    Array.from(streetSelect.options).forEach(opt => { if (opt.value === "") { opt.style.display = 'block'; return; } opt.style.display = opt.text.toLowerCase().includes(term) ? 'block' : 'none'; });
}

function updateBodyPanelOpenClass() {
    if (document.querySelector('.panel.active')) {
        document.body.classList.add('panel-open');
    } else {
        document.body.classList.remove('panel-open');
    }
}

function closePanel(panelId, removeBlur = true) {
    const panel = document.getElementById(panelId);
    if(panel) panel.classList.remove('active');
    updateBodyPanelOpenClass();
}

function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isActive = panel.classList.toggle('active');
    

    
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
    updateBodyPanelOpenClass();
}

function closeFilterPanel(removeBlur = true) { closePanel('filter-panel', removeBlur); }
function closeFavoritesPanel(removeBlur = true) { closePanel('favorites-panel', removeBlur); }
function closeRegularNotificationsPanel(removeBlur = true) { closePanel('regular-notifications-panel', removeBlur); closeRuleEditor(); }
function closeRoutePlannerPanel(removeBlur = true) {
    const map = window.map;
    if (routePlannerStartMarker && map) { map.removeLayer(routePlannerStartMarker); routePlannerStartMarker = null; }
    if (routePlannerEndMarker && map) { map.removeLayer(routePlannerEndMarker); routePlannerEndMarker = null; }
    if (currentRoutePolyline && map) { map.removeLayer(currentRoutePolyline); currentRoutePolyline = null; }
    closePanel('route-planner-panel', removeBlur);
}
function closeSchedulePanel(removeBlur = true) {
    const panel = document.getElementById('schedule-panel');
    if (panel) { panel.classList.remove('active'); panel.style.maxHeight = ''; }
    
    closePanel('schedule-panel', removeBlur);

    _currentPanelApiRouteSchedules = []; 
    // updateLiveActivity(null); // Закомментировано чтобы избежать ошибок
    if (scheduleCountdownIntervalId) clearInterval(scheduleCountdownIntervalId); scheduleCountdownIntervalId = null;
    if (scheduleApiRefreshIntervalId) clearInterval(scheduleApiRefreshIntervalId); scheduleApiRefreshIntervalId = null;
}

function enableSwipeToClose(panelId, closeFn) {
    const panel = document.getElementById(panelId);
    if (!panel || !('ontouchstart' in window)) return;
    let startY = null;
    panel.addEventListener('touchstart', e => { startY = e.touches[0].clientY; });
    panel.addEventListener('touchmove', e => {
        if (startY === null) return;
        const diff = e.touches[0].clientY - startY;
        if (diff > 80) {
            startY = null;
            closeFn();
        }
    });
    panel.addEventListener('touchend', () => { startY = null; });
}

// Функция инициализации UI
export function initUI() {
    // Инициализация темной темы
    if (darkMode) {
        document.body.classList.add('dark-mode');
    }
    
    // Настройка обработчиков событий для фильтров
    const routeFilter = document.getElementById('route-filter');
    if (routeFilter) {
        routeFilter.addEventListener('change', onSelectRoute);
    }
    
    const directionFilter = document.getElementById('direction-filter');
    if (directionFilter) {
        directionFilter.addEventListener('change', (e) => {
            filters.direction = e.target.value || null;
            // Если выбран маршрут, обновить отображение
            if (filters.route && !isLiveBusViewActive) {
                import('./map_drawer.js').then(({ showRouteAndBuses }) => {
                    showRouteAndBuses(filters.route).catch(err => console.error('Failed to show route and buses:', err));
                });
            } else if (!isLiveBusViewActive) {
                import('./map_drawer.js').then(({ refreshMarkers }) => {
                    const map = window.map;
                    if (map) refreshMarkers(map.getCenter());
                });
            }
        });
    }
    
    const streetFilter = document.getElementById('street-filter');
    if (streetFilter) {
        streetFilter.addEventListener('change', (e) => {
            filters.street = e.target.value || null;
            // Если выбран маршрут, обновить отображение
            if (filters.route && !isLiveBusViewActive) {
                import('./map_drawer.js').then(({ showRouteAndBuses }) => {
                    showRouteAndBuses(filters.route).catch(err => console.error('Failed to show route and buses:', err));
                });
            } else if (!isLiveBusViewActive) {
                import('./map_drawer.js').then(({ refreshMarkers }) => {
                    const map = window.map;
                    if (map) refreshMarkers(map.getCenter());
                });
            }
        });
    }
    
    const streetSearch = document.getElementById('street-search');
    if (streetSearch) {
        streetSearch.addEventListener('input', updateStreetSearch);
    }
    
    // Настройка кнопки сброса маршрута
    const resetRouteButton = document.getElementById('reset-route-button');
    if (resetRouteButton) {
        resetRouteButton.addEventListener('click', handleResetRoute);
    }
    
    // Настройка кнопки темы
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleDarkMode);
        themeToggle.innerHTML = darkMode ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    }
    
    // Настройка панелей
    setupPanelEventListeners();
    
    console.log('UI initialized successfully');
}

// Функция сброса фильтров
export function resetFilters() {
    filters.route = null;
    filters.direction = null;
    filters.street = null;
    
    // Сброс значений в селектах
    const routeFilter = document.getElementById('route-filter');
    if (routeFilter) routeFilter.value = '';
    
    const directionFilter = document.getElementById('direction-filter');
    if (directionFilter) directionFilter.value = '';
    
    const streetFilter = document.getElementById('street-filter');
    if (streetFilter) streetFilter.value = '';
    
    const streetSearch = document.getElementById('street-search');
    if (streetSearch) streetSearch.value = '';
    
    // Обновить отображение карты
    import('./map_drawer.js').then(({ refreshMarkers, clearPreviousRouteDrawing }) => {
        clearPreviousRouteDrawing();
        const map = window.map;
        if (map) refreshMarkers(map.getCenter());
    });
    
    updateResetRouteButtonVisibility();
    
    console.log('Filters reset');
}

// Экспорт дополнительных функций
export function updateLiveActivity() {
    // Заглушка для обновления live активности
}

export function buildRouteFromAddresses() {
    // Заглушка для построения маршрута по адресам
}

export function onSelectRoute(e) {
    const routeId = e.target.value || null;
    filters.route = routeId;
    
    if (routeId) {
        import('./map_drawer.js').then(({ showRouteAndBuses, clearPreviousRouteDrawing }) => {
            clearPreviousRouteDrawing();
            showRouteAndBuses(routeId).catch(err => console.error('Failed to show route and buses:', err));
        });
    } else {
        import('./map_drawer.js').then(({ refreshMarkers, clearPreviousRouteDrawing }) => {
            clearPreviousRouteDrawing();
            const map = window.map;
            if (map) refreshMarkers(map.getCenter());
        });
    }
    
    updateResetRouteButtonVisibility();
}

export function handleResetRoute() {
    console.log('Handling route reset');
    
    // Сбросить live view если активен
    if (isLiveBusViewActive) {
        const resetLiveViewFunc = window.resetLiveView;
        if (resetLiveViewFunc) {
            resetLiveViewFunc();
        }
        isLiveBusViewActive = false;
    }
    
    resetFilters();
    
    // Очистить симуляцию автобусов
    const activeSimulatedBuses = window.activeSimulatedBuses;
    if (activeSimulatedBuses) {
        Object.keys(activeSimulatedBuses).forEach(busId => {
            delete activeSimulatedBuses[busId];
        });
    }
    
    import('./map_drawer.js').then(({ clearPreviousRouteDrawing }) => {
        clearPreviousRouteDrawing();
    });
}

// Настройка обработчиков событий для панелей
function setupPanelEventListeners() {
    // Панель фильтров
    const filterToggle = document.getElementById('filter-toggle');
    const filterPanel = document.getElementById('filter-panel');
    const closeFilters = document.getElementById('close-filters');
    if (filterToggle && filterPanel) {
        filterToggle.addEventListener('click', () => togglePanel('filter-panel'));
        enableSwipeToClose('filter-panel', closeFilterPanel);
    }
    if (closeFilters) {
        closeFilters.addEventListener('click', closeFilterPanel);
    }
    
    // Панель избранного
    const favoritesToggle = document.getElementById('favorites-toggle');
    const favoritesPanel = document.getElementById('favorites-panel');
    const closeFavorites = document.getElementById('close-favorites-panel');
    if (favoritesToggle && favoritesPanel) {
        favoritesToggle.addEventListener('click', () => togglePanel('favorites-panel'));
        enableSwipeToClose('favorites-panel', closeFavoritesPanel);
    }
    if (closeFavorites) {
        closeFavorites.addEventListener('click', closeFavoritesPanel);
    }
    
    // Панель уведомлений
    const notificationsToggle = document.getElementById('regular-notifications-toggle-button');
    const notificationsPanel = document.getElementById('regular-notifications-panel');
    const closeNotifications = document.getElementById('close-regular-notifications-panel');
    if (notificationsToggle && notificationsPanel) {
        notificationsToggle.addEventListener('click', () => togglePanel('regular-notifications-panel'));
        enableSwipeToClose('regular-notifications-panel', closeRegularNotificationsPanel);
    }
    if (closeNotifications) {
        closeNotifications.addEventListener('click', closeRegularNotificationsPanel);
    }
    
    // Панель планировщика маршрутов
    const routePlannerToggle = document.getElementById('route-planner-toggle');
    const routePlannerPanel = document.getElementById('route-planner-panel');
    const closeRoutePlanner = document.getElementById('close-route-planner');
    if (routePlannerToggle && routePlannerPanel) {
        routePlannerToggle.addEventListener('click', () => togglePanel('route-planner-panel'));
        enableSwipeToClose('route-planner-panel', closeRoutePlannerPanel);
    }
    if (closeRoutePlanner) {
        closeRoutePlanner.addEventListener('click', closeRoutePlannerPanel);
    }
    
    // Панель расписания
    const schedulePanel = document.getElementById('schedule-panel');
    if (schedulePanel) {
        enableSwipeToClose('schedule-panel', closeSchedulePanel);
        
        // Добавить обработчик для кнопки закрытия расписания если она есть
        const closeSchedule = schedulePanel.querySelector('.close-schedule');
        if (closeSchedule) {
            closeSchedule.addEventListener('click', closeSchedulePanel);
        }
    }
    
    // Кнопка локации
    const locationButton = document.getElementById('location-button');
    if (locationButton) {
        locationButton.addEventListener('click', () => {
            if (window.locateUser) {
                window.locateUser();
            }
        });
    }
}

export async function showSchedulePanel(stop) {
    currentStop = stop;
    currentStopForSchedulePanel = stop;
    
    const panel = document.getElementById('schedule-panel');
    if (!panel) {
        console.error('Schedule panel not found!');
        return;
    }
    
    const container = document.getElementById('schedule-content');
    if (!container) {
        console.error('Schedule content container not found!');
        return;
    }
    
    // Показать панель
    panel.classList.add('active');
    updateBodyPanelOpenClass();
    
    // Показать загрузчик
    container.innerHTML = '<div class="loading-schedule">Loading schedule...</div>';
    
    // Обновить заголовок
    const titleElement = panel.querySelector('h3');
    if (titleElement) {
        titleElement.textContent = stop.stop_name;
    }
    
    try {
        const now = new Date();
        const endTime = new Date(now.getTime() + 4 * 3600000); // +4 часа
        const url = `/api/stops/${stop.stop_id}/schedule?usage=long&start=${now.toISOString()}&end=${endTime.toISOString()}`;
        
        const response = await fetch(url);
        
        if (!response.ok) throw new Error(await response.text());
        
        const data = await response.json();
        schedules = data.data['stop-schedule']['route-schedules'];
        _currentPanelApiRouteSchedules = schedules;
        
        renderSchedule(container, now);
        
        // Запустить обновление счётчика каждую секунду
        if (scheduleCountdownIntervalId) clearInterval(scheduleCountdownIntervalId);
        scheduleCountdownIntervalId = setInterval(() => updateScheduleCountdown(container), 1000);
        
        // Запустить обновление данных каждые 2 минуты
        if (scheduleApiRefreshIntervalId) clearInterval(scheduleApiRefreshIntervalId);
        scheduleApiRefreshIntervalId = setInterval(async () => {
            try {
                const refreshResponse = await fetch(url);
                if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    schedules = refreshData.data['stop-schedule']['route-schedules'];
                    _currentPanelApiRouteSchedules = schedules;
                    renderSchedule(container, new Date());
                }
            } catch (error) {
                console.warn('Failed to refresh schedule:', error);
            }
        }, 120000);
        
    } catch (error) {
        container.innerHTML = '<div class="error">Error loading schedule</div>';
        console.error('Schedule loading error:', error);
    }
    
    updateFavoriteButtonInSchedulePanel();
}

function renderSchedule(container, now) {
    container.innerHTML = '';
    
    if (!schedules || schedules.length === 0) {
        container.innerHTML = '<div class="no-schedule">No upcoming arrivals.</div>';
        return;
    }
    
    const scheduleGrid = document.createElement('div');
    scheduleGrid.className = 'schedule-grid';
    
    schedules.forEach((routeSchedule, index) => {
        const { route, 'scheduled-stops': scheduledStops } = routeSchedule;
        if (!scheduledStops || scheduledStops.length === 0) return;
        
        const card = document.createElement('div');
        card.className = 'schedule-card';
        card.style.animationDelay = `${index * 0.05}s`;
        
        // Primary arrival is always in minutes
        const nextArrival = scheduledStops[0];
        const nextArrivalTime = new Date(nextArrival.times.arrival.estimated || nextArrival.times.arrival.scheduled);
        const minutesUntilNext = Math.max(0, Math.round((nextArrivalTime.getTime() - now.getTime()) / 60000));
        const primaryDisplayTime = minutesUntilNext === 0 ? 'Now' : minutesUntilNext;
        const primaryDisplayUnit = minutesUntilNext === 0 ? null : 'min';
        
        // Secondary arrivals are always in hh:mm format
        const otherTimes = scheduledStops.slice(1, 4).map(stop => {
            const arrivalTime = new Date(stop.times.arrival.estimated || stop.times.arrival.scheduled);
            const hours = String(arrivalTime.getHours()).padStart(2, '0');
            const mins = String(arrivalTime.getMinutes()).padStart(2, '0');
            return `${hours}:${mins}`;
        });
        
        const otherTimesHTML = otherTimes.map(t => `<span class="upcoming-time-badge">${t}</span>`).join('');
        
        let busFeatures = '';
        if (nextArrival.bus) {
            if (nextArrival.bus['bike-rack']) {
                busFeatures += '<i class="fas fa-bicycle" title="Bike Rack"></i>';
            }
            if (nextArrival.bus.wifi) {
                busFeatures += '<i class="fas fa-wifi" title="WiFi Available"></i>';
            }
        }
        
        const primaryTimeHTML = `
            <div class="primary-arrival">
                <span class="time-value">${primaryDisplayTime}</span>
                ${primaryDisplayUnit ? `<span class="time-unit">${primaryDisplayUnit}</span>` : ''}
            </div>
        `;
        
        card.innerHTML = `
            <div class="card-main-info">
                <div class="route-identifier">
                    <span class="route-number-badge">${route.number}</span>
                </div>
                <div class="arrival-details">
                    ${primaryTimeHTML}
                    <div class="route-destination-name">${route.name}</div>
                </div>
                <div class="live-tracking-container">
                    <button class="live-track-btn" onclick="startLiveTracking('${route.number}', '${nextArrival.variant.key}', '${nextArrival.times.departure.estimated || nextArrival.times.departure.scheduled}', ${JSON.stringify(route).replace(/"/g, '&quot;')})" title="Live Bus Tracking">
                        <i class="fas fa-map-marker-alt"></i>
                        <span>Track</span>
                    </button>
                </div>
            </div>
            ${(otherTimes.length > 0 || busFeatures) ? `
            <div class="card-secondary-info">
                <div class="upcoming-times">
                    ${otherTimesHTML}
                </div>
                <div class="bus-features">
                    ${busFeatures}
                </div>
            </div>` : ''}
        `;
        
        scheduleGrid.appendChild(card);
    });
    
    container.appendChild(scheduleGrid);
}

function updateScheduleCountdown(container) {
    if (!schedules || schedules.length === 0) return;
    
    const now = new Date();
    const cards = container.querySelectorAll('.schedule-card');
    
    schedules.forEach((routeSchedule, index) => {
        const scheduledStops = routeSchedule['scheduled-stops'];
        if (!scheduledStops || scheduledStops.length === 0 || !cards[index]) return;
        
        const nextArrival = scheduledStops[0];
        const nextArrivalTime = new Date(nextArrival.times.arrival.estimated || nextArrival.times.arrival.scheduled);
        const minutesUntilNext = Math.max(0, Math.round((nextArrivalTime.getTime() - now.getTime()) / 60000));
        const primaryDisplayTime = minutesUntilNext === 0 ? 'Now' : minutesUntilNext;
        
        const timeValueElement = cards[index].querySelector('.time-value');
        const timeUnitElement = cards[index].querySelector('.time-unit');
        
        if (timeValueElement) {
            timeValueElement.textContent = primaryDisplayTime;
        }
        if (timeUnitElement) {
            timeUnitElement.style.display = minutesUntilNext === 0 ? 'none' : 'inline';
        }
    });
}

// Функция для запуска live-отслеживания автобуса
window.startLiveTracking = function(routeNumber, variantKey, departureTime, routeData = null) {
    console.log('=== STARTING LIVE TRACKING ===');
    console.log('Parameters:', { routeNumber, variantKey, departureTime, routeData });
    console.log('Current stop:', currentStopForSchedulePanel);
    console.log('Available schedules:', _currentPanelApiRouteSchedules);
    
    if (!currentStopForSchedulePanel) {
        console.warn('No current stop selected for live tracking');
        return;
    }
    
    // Сохраняем текущую остановку и расписания
    const stopForTracking = { ...currentStopForSchedulePanel };
    const currentSchedules = [...(_currentPanelApiRouteSchedules || [])];
    
    // Закрыть панель расписания
    closeSchedulePanel();
    
    // Найти соответствующий маршрут в schedules
    let routeSchedule = currentSchedules.find(rs => 
        String(rs.route.number) === String(routeNumber)
    );
    
    if (!routeSchedule && routeData) {
        // Создаем объект расписания из переданных данных
        console.log('Creating route schedule from passed route data');
        routeSchedule = {
            route: routeData,
            'scheduled-stops': [] // Пустой массив, но с правильными данными маршрута
        };
    }
    
    if (!routeSchedule) {
        console.warn('Route schedule not found for live tracking. Available routes:', 
            currentSchedules.map(rs => rs.route.number));
        
        // Попробуем найти любой маршрут с подходящим номером
        const fallbackSchedule = currentSchedules.find(rs => 
            rs.route.number && rs.route.number.toString().includes(routeNumber.toString())
        );
        
        if (fallbackSchedule) {
            console.log('Using fallback route schedule:', fallbackSchedule.route.number);
            startSimulation(fallbackSchedule, stopForTracking);
        } else {
            // Создаем временный объект расписания для демонстрации
            console.log('Creating demo route schedule for tracking');
            const demoSchedule = {
                route: { number: routeNumber, name: `Route ${routeNumber}` },
                'scheduled-stops': []
            };
            startSimulation(demoSchedule, stopForTracking);
        }
        return;
    }
    
    console.log('Found matching route schedule:', routeSchedule);
    startSimulation(routeSchedule, stopForTracking);
    
    function startSimulation(schedule, stop) {
        console.log('Starting simulation with schedule:', schedule);
        console.log('Using stop:', stop);
        // Импортировать и вызвать функцию симуляции
        import('./bus_simulator.js').then(module => {
            console.log('Bus simulator module loaded');
            const { simulateAndShowUpcomingBusesForRoute } = module;
            console.log('Calling simulateAndShowUpcomingBusesForRoute...');
            simulateAndShowUpcomingBusesForRoute(
                stop, 
                schedule, 
                new Date().toISOString(), 
                true // isForLiveViewMode
            );
            console.log('Live tracking simulation started!');
        }).catch(error => {
            console.error('Failed to start live tracking:', error);
        });
    }
    
    // Активировать live view режим
    isLiveBusViewActive = true;
    updateResetRouteButtonVisibility();
};
