// ===================================================================
//     route_planner.js - Модуль планирования маршрутов
// ===================================================================
// Работа с Winnipeg Transit API для построения маршрутов между точками

/**
 * Состояние планировщика маршрутов
 */
const routePlannerState = {
    currentPlans: null,
    selectedPlanIndex: null,
    originPoint: null,
    destinationPoint: null,
    planPolylines: [],
    planMarkers: [],
    isSelectingOrigin: false,
    isSelectingDestination: false,
    mapClickHandler: null
};

/**
 * Планирует поездку между двумя точками
 * @param {Object} options - Параметры планирования
 * @param {string} options.origin - Точка отправления (geo/lat,lon или адрес или stop/stopId)
 * @param {string} options.destination - Точка назначения
 * @param {string} [options.mode='depart-after'] - Режим: depart-after, depart-before, arrive-before, arrive-after
 * @param {number} [options.time] - Время в миллисекундах (текущее время по умолчанию)
 * @param {number} [options.maxWalkTime=300] - Максимальное время ходьбы в секундах
 * @param {number} [options.maxTransferWait=900] - Максимальное время ожидания пересадки в секундах
 * @returns {Promise<Object>} Результат планирования
 */
async function planTrip(options) {
    const {
        origin,
        destination,
        mode = 'depart-after',
        time = Date.now(),
        maxWalkTime = 300,
        maxTransferWait = 900
    } = options;

    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const params = new URLSearchParams({
        origin,
        destination,
        mode,
        time,
        max_walk_time: maxWalkTime,
        max_transfer_wait: maxTransferWait
    });

    console.log('🚌 Planning trip:', { origin, destination, mode });

    try {
        const response = await fetch(`${API_BASE}/api/trip-planner?${params.toString()}`);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.plans || data.plans.length === 0) {
            throw new Error('No routes found between these points');
        }

        routePlannerState.currentPlans = data.plans;
        routePlannerState.originPoint = origin;
        routePlannerState.destinationPoint = destination;

        console.log(`✓ Found ${data.plans.length} route options`);
        return data;

    } catch (error) {
        console.error('❌ Trip planning failed:', error);
        throw error;
    }
}

/**
 * Преобразует координаты в формат geo/lat,lon
 */
function formatGeoPoint(lat, lon) {
    return `geo/${lat},${lon}`;
}

/**
 * Форматирует время в удобочитаемый формат
 */
function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

/**
 * Форматирует длительность в минуты
 */
function formatDuration(minutes) {
    if (minutes < 1) return '< 1 min';
    if (minutes === 1) return '1 min';
    return `${Math.round(minutes)} min`;
}

/**
 * Получает иконку для типа сегмента
 */
function getSegmentIcon(type) {
    const icons = {
        walk: '🚶',
        ride: '🚌',
        transfer: '🔄'
    };
    return icons[type] || '•';
}

/**
 * Получает цвет для маршрута
 */
function getRouteColor(route) {
    return route?.['badge-style']?.['background-color'] || '#0078ff';
}

/**
 * Отрисовывает план маршрута на карте
 */
function drawPlanOnMap(planIndex) {
    if (!routePlannerState.currentPlans || !map) return;
    
    // Очищаем предыдущие линии и маркеры
    clearPlanFromMap();
    
    const plan = routePlannerState.currentPlans[planIndex];
    if (!plan) return;

    routePlannerState.selectedPlanIndex = planIndex;
    
    const allCoordinates = [];

    // Отрисовываем каждый сегмент
    plan.segments.forEach((segment, idx) => {
        const color = segment.type === 'ride' 
            ? getRouteColor(segment.route)
            : segment.type === 'transfer'
            ? '#ff9800'
            : '#666666';

        const weight = segment.type === 'ride' ? 5 : 3;
        const opacity = segment.type === 'ride' ? 0.8 : 0.6;

        // Получаем координаты границ сегмента
        if (segment.bounds) {
            const { minimum, maximum } = segment.bounds;
            const points = [
                [parseFloat(minimum.lat), parseFloat(minimum.lng)],
                [parseFloat(maximum.lat), parseFloat(maximum.lng)]
            ];
            
            allCoordinates.push(...points);

            // Создаем линию для сегмента
            const polyline = L.polyline(points, {
                color,
                weight,
                opacity,
                dashArray: segment.type === 'walk' ? '5, 10' : null
            }).addTo(map);

            routePlannerState.planPolylines.push(polyline);
        }

        // Добавляем маркеры для остановок
        if (segment.from?.stop) {
            const stop = segment.from.stop;
            const lat = parseFloat(stop.centre.geographic.latitude);
            const lon = parseFloat(stop.centre.geographic.longitude);
            
            const marker = L.circleMarker([lat, lon], {
                radius: 6,
                fillColor: '#fff',
                color: color,
                weight: 2,
                opacity: 1,
                fillOpacity: 1
            }).addTo(map);

            marker.bindPopup(`
                <strong>${stop.name}</strong><br>
                Stop #${stop.key}<br>
                ${segment.type === 'ride' ? `Route: ${segment.route.number}` : ''}
            `);

            routePlannerState.planMarkers.push(marker);
            allCoordinates.push([lat, lon]);
        }

        if (segment.to?.stop) {
            const stop = segment.to.stop;
            const lat = parseFloat(stop.centre.geographic.latitude);
            const lon = parseFloat(stop.centre.geographic.longitude);
            
            const marker = L.circleMarker([lat, lon], {
                radius: 6,
                fillColor: '#fff',
                color: color,
                weight: 2,
                opacity: 1,
                fillOpacity: 1
            }).addTo(map);

            marker.bindPopup(`
                <strong>${stop.name}</strong><br>
                Stop #${stop.key}
            `);

            routePlannerState.planMarkers.push(marker);
            allCoordinates.push([lat, lon]);
        }
    });

    // Центрируем карту на маршруте
    if (allCoordinates.length > 0) {
        const bounds = L.latLngBounds(allCoordinates);
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

/**
 * Очищает отрисованный план с карты
 */
function clearPlanFromMap() {
    routePlannerState.planPolylines.forEach(polyline => {
        if (map.hasLayer(polyline)) {
            map.removeLayer(polyline);
        }
    });
    routePlannerState.planPolylines = [];

    routePlannerState.planMarkers.forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    routePlannerState.planMarkers = [];
}

/**
 * Отрисовывает список планов в UI
 */
function renderPlansUI(plans) {
    const container = document.getElementById('route-plan-result');
    if (!container) return;

    container.innerHTML = '';

    if (!plans || plans.length === 0) {
        container.innerHTML = '<p class="no-results">No routes found</p>';
        return;
    }

    plans.forEach((plan, index) => {
        const planCard = document.createElement('div');
        planCard.className = 'plan-card';
        if (index === routePlannerState.selectedPlanIndex) {
            planCard.classList.add('selected');
        }

        const totalMinutes = plan.times.durations.total;
        const walkMinutes = plan.times.durations.walking;
        const rideMinutes = plan.times.durations.riding;
        const transfers = plan.segments.filter(s => s.type === 'ride').length - 1;

        // Собираем информацию о маршрутах
        const routes = plan.segments
            .filter(s => s.type === 'ride')
            .map(s => s.route);

        planCard.innerHTML = `
            <div class="plan-header">
                <div class="plan-number">Option ${plan.number}</div>
                <div class="plan-time">
                    <strong>${formatDuration(totalMinutes)}</strong>
                    <span class="time-range">${formatTime(plan.times.start)} - ${formatTime(plan.times.end)}</span>
                </div>
            </div>
            <div class="plan-summary">
                <span class="plan-stat">
                    🚶 ${formatDuration(walkMinutes)}
                </span>
                <span class="plan-stat">
                    🚌 ${formatDuration(rideMinutes)}
                </span>
                ${transfers >= 0 ? `<span class="plan-stat">🔄 ${transfers} transfer${transfers !== 1 ? 's' : ''}</span>` : ''}
            </div>
            <div class="plan-routes">
                ${routes.map(route => `
                    <span class="route-badge" style="background-color: ${getRouteColor(route)}; color: ${route['badge-style']?.color || '#fff'}">
                        ${route['badge-label'] || route.number}
                    </span>
                `).join(' → ')}
            </div>
            <button class="view-details-btn" data-plan-index="${index}">
                View Details
            </button>
        `;

        planCard.addEventListener('click', (e) => {
            if (!e.target.classList.contains('view-details-btn')) {
                selectPlan(index);
            }
        });

        planCard.querySelector('.view-details-btn').addEventListener('click', () => {
            showPlanDetails(index);
        });

        container.appendChild(planCard);
    });
}

/**
 * Выбирает план и отрисовывает его на карте
 */
function selectPlan(planIndex) {
    drawPlanOnMap(planIndex);
    
    // Обновляем UI
    document.querySelectorAll('.plan-card').forEach((card, idx) => {
        if (idx === planIndex) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
}

/**
 * Показывает детали плана
 */
function showPlanDetails(planIndex) {
    const plan = routePlannerState.currentPlans[planIndex];
    if (!plan) return;

    selectPlan(planIndex);

    const optionsContainer = document.getElementById('route-plan-options');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = `
        <div class="plan-details">
            <h3>Route Details - Option ${plan.number}</h3>
            <div class="segments-list">
                ${plan.segments.map((segment, idx) => renderSegmentDetails(segment, idx)).join('')}
            </div>
            <button class="close-details-btn">Close Details</button>
        </div>
    `;

    optionsContainer.querySelector('.close-details-btn').addEventListener('click', () => {
        optionsContainer.innerHTML = '';
    });

    optionsContainer.style.display = 'block';
}

/**
 * Отрисовывает детали сегмента
 */
function renderSegmentDetails(segment, index) {
    const icon = getSegmentIcon(segment.type);
    const duration = formatDuration(segment.times.durations.total);
    
    let content = `
        <div class="segment-item segment-${segment.type}">
            <div class="segment-icon">${icon}</div>
            <div class="segment-content">
    `;

    if (segment.type === 'walk') {
        const from = segment.from?.stop?.name || segment.from?.origin ? 'Start' : 'Unknown';
        const to = segment.to?.stop?.name || segment.to?.destination ? 'Destination' : 'Unknown';
        content += `
            <div class="segment-title">Walk ${duration}</div>
            <div class="segment-detail">From: ${from}</div>
            <div class="segment-detail">To: ${to}</div>
        `;
    } else if (segment.type === 'ride') {
        const route = segment.route;
        const routeColor = getRouteColor(route);
        content += `
            <div class="segment-title">
                <span class="route-badge" style="background-color: ${routeColor}; color: ${route['badge-style']?.color || '#fff'}">
                    ${route['badge-label'] || route.number}
                </span>
                ${route.name}
            </div>
            <div class="segment-detail">⏱ ${duration} ride</div>
            <div class="segment-detail">🚏 From: ${segment.from?.stop?.name || 'Unknown'}</div>
            <div class="segment-detail">🚏 To: ${segment.to?.stop?.name || 'Unknown'}</div>
            <div class="segment-detail">🚌 Bus #${segment.bus?.key || 'N/A'}</div>
            ${segment.bus?.['bike-rack'] === 'true' ? '<div class="segment-detail">🚲 Bike rack available</div>' : ''}
        `;
    } else if (segment.type === 'transfer') {
        content += `
            <div class="segment-title">Transfer ${duration}</div>
            <div class="segment-detail">From: ${segment.from?.stop?.name || 'Unknown'}</div>
            <div class="segment-detail">To: ${segment.to?.stop?.name || 'Unknown'}</div>
        `;
    }

    content += `
            <div class="segment-time">${formatTime(segment.times.start)}</div>
        </div>
    </div>
    `;

    return content;
}

/**
 * Сбрасывает состояние планировщика
 */
function resetRoutePlanner() {
    clearPlanFromMap();
    routePlannerState.currentPlans = null;
    routePlannerState.selectedPlanIndex = null;
    routePlannerState.originPoint = null;
    routePlannerState.destinationPoint = null;
    
    const resultContainer = document.getElementById('route-plan-result');
    if (resultContainer) resultContainer.innerHTML = '';
    
    const optionsContainer = document.getElementById('route-plan-options');
    if (optionsContainer) {
        optionsContainer.innerHTML = '';
        optionsContainer.style.display = 'none';
    }
}

// Экспортируем функции в глобальную область
if (typeof window !== 'undefined') {
    window.planTrip = planTrip;
    window.formatGeoPoint = formatGeoPoint;
    window.drawPlanOnMap = drawPlanOnMap;
    window.clearPlanFromMap = clearPlanFromMap;
    window.renderPlansUI = renderPlansUI;
    window.selectPlan = selectPlan;
    window.showPlanDetails = showPlanDetails;
    window.resetRoutePlanner = resetRoutePlanner;
    window.routePlannerState = routePlannerState;
}
