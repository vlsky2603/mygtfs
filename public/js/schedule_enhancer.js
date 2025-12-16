// ===================================================================
//     schedule_enhancer.js - Улучшенная система расписания
//     Комбинирует GTFS расписание с реальным временем из API
// ===================================================================

/**
 * Получает полное расписание для остановки:
 * - GTFS данные (статическое расписание)
 * - API данные (реальное время и задержки)
 * - Объединяет и сортирует по времени
 */
async function getEnhancedSchedule(stopId, currentTimeUTC, hoursAhead = 4) {
    const scheduleStartTime = new Date(currentTimeUTC.getTime());
    const scheduleEndTime = new Date(currentTimeUTC.getTime() + hoursAhead * 60 * 60 * 1000);
    
    // Параллельно загружаем GTFS и API данные
        const [gtfsSchedule, apiSchedule] = await Promise.all([
        getGTFSScheduleForStop(stopId, scheduleStartTime, scheduleEndTime),
        getAPIScheduleForStop(stopId, scheduleStartTime, scheduleEndTime)
    ]);
    
    // Объединяем данные
        // Пометим источники и объединим данные
        const gtfsMarked = gtfsSchedule.map(s => Object.assign({}, s, { type: 'gtfs' }));
        const apiMarked = apiSchedule.map(s => Object.assign({}, s, { type: 'api' }));
        return mergeSchedules(gtfsMarked, apiMarked, currentTimeUTC);
}

/**
 * Получает расписание из GTFS файлов
 */
function getGTFSScheduleForStop(stopId, startTime, endTime) {
    const results = [];
    
    if (!gtfsData.stopToTrips || !gtfsData.stopToTrips[stopId]) {
        return Promise.resolve(results);
    }
    
    const tripsAtStop = gtfsData.stopToTrips[stopId];
    const currentDay = startTime.getDay(); // 0-6, Sunday = 0
    
    tripsAtStop.forEach(({ tripId, index }) => {
        const trip = gtfsData.trips.find(t => t.trip_id === tripId);
        if (!trip) return;
        
        const route = gtfsData.routes.find(r => r.route_id === trip.route_id);
        if (!route) return;
        
        const stopTime = gtfsData.tripToStops[tripId]?.[index];
        if (!stopTime || !stopTime.departure_time) return;
        
        // Конвертируем GTFS время (HH:MM:SS) в Date объект
        const departureDate = gtfsTimeToDate(stopTime.departure_time, startTime);
        
        // Проверяем попадает ли в временной диапазон
        if (departureDate >= startTime && departureDate <= endTime) {
            results.push({
                type: 'gtfs',
                routeNumber: route.route_short_name,
                routeName: route.route_long_name,
                routeColor: route.route_color,
                headsign: trip.trip_headsign,
                scheduledTime: departureDate,
                estimatedTime: null,
                delay: null,
                tripId: tripId,
                isRealTime: false
            });
        }
    });
    
    return Promise.resolve(results.sort((a, b) => a.scheduledTime - b.scheduledTime));
}

/**
 * Получает расписание из Winnipeg Transit API
 */
async function getAPIScheduleForStop(stopId, startTime, endTime) {
    try {
        // API ожидает timestamp в миллисекундах
        const startTimestamp = startTime.getTime();
        const endTimestamp = endTime.getTime();
        
        const fetchUrl = `${API_BASE}/api/stops/${stopId}/schedule?usage=long&start=${startTimestamp}&end=${endTimestamp}`;
        
        console.log(`🌐 API request: start=${new Date(startTimestamp).toISOString()}, end=${new Date(endTimestamp).toISOString()}`);
        
        const response = await fetch(fetchUrl);
        
        if (!response.ok) {
            console.warn(`API schedule fetch failed: ${response.status}`);
            if (typeof showToast === 'function') showToast(`Failed to fetch live schedule (API ${response.status}). Falling back to GTFS.`, 'error', 4000);
            return [];
        }
        
        const data = await response.json();
        const routeSchedules = extractRouteSchedules(data);
        
        const results = [];
        
        routeSchedules.forEach(routeSchedule => {
            const route = routeSchedule.route;
            const scheduledStops = routeSchedule['scheduled-stops'] || [];
            
            scheduledStops.forEach(sStop => {
                if (sStop.cancelled === "true") return;
                
                const times = sStop.times?.departure || sStop.times?.arrival;
                if (!times) return;
                
                const scheduledTime = times.scheduled ? new Date(times.scheduled) : null;
                const estimatedTime = times.estimated ? new Date(times.estimated) : null;
                const effectiveTime = estimatedTime || scheduledTime;
                
                if (!effectiveTime || effectiveTime < startTime || effectiveTime > endTime) return;
                
                // Рассчитываем задержку
                let delay = null;
                if (scheduledTime && estimatedTime) {
                    delay = Math.round((estimatedTime - scheduledTime) / 60000); // минуты
                }
                
                results.push({
                    type: 'api',
                    routeNumber: route.number,
                    routeName: route.name,
                    routeColor: route['badge-style']?.['background-color'],
                    headsign: sStop.variant?.name,
                    scheduledTime: scheduledTime,
                    estimatedTime: estimatedTime,
                    delay: delay,
                    variantKey: sStop.variant?.key,
                    isRealTime: !!estimatedTime,
                    isCancelled: sStop.cancelled === "true"
                });
            });
        });
        
        return results.sort((a, b) => {
            const timeA = a.estimatedTime || a.scheduledTime;
            const timeB = b.estimatedTime || b.scheduledTime;
            return timeA - timeB;
        });
        
    } catch (err) {
        console.error('Error fetching API schedule:', err);
        return [];
    }
}

/**
 * Объединяет GTFS и API расписания
 * Приоритет: API данные (если есть), затем GTFS
 */
function mergeSchedules(gtfsSchedule, apiSchedule, currentTime) {
    const merged = [];
    const apiByRouteAndTime = new Map();
    
    // Индексируем API данные по маршруту и времени
    apiSchedule.forEach(apiItem => {
        const key = `${apiItem.routeNumber}_${apiItem.scheduledTime?.getTime()}`;
        apiByRouteAndTime.set(key, apiItem);
    });
    
    // Добавляем GTFS данные, пропуская те что есть в API
    gtfsSchedule.forEach(gtfsItem => {
        const key = `${gtfsItem.routeNumber}_${gtfsItem.scheduledTime.getTime()}`;
        
        if (!apiByRouteAndTime.has(key)) {
            merged.push(gtfsItem);
        }
    });
    
    // Добавляем все API данные
    merged.push(...apiSchedule);
    
    // Сортируем по времени
    return merged.sort((a, b) => {
        const timeA = a.estimatedTime || a.scheduledTime;
        const timeB = b.estimatedTime || b.scheduledTime;
        return timeA - timeB;
    });
}

/**
 * Конвертирует GTFS время (HH:MM:SS, может быть >24h) в Date
 */
function gtfsTimeToDate(gtfsTime, baseDate) {
    const [hours, minutes, seconds] = gtfsTime.split(':').map(Number);
    const result = new Date(baseDate);
    
    // GTFS может иметь часы > 24 (например 25:30:00 для 01:30 следующего дня)
    if (hours >= 24) {
        result.setDate(result.getDate() + Math.floor(hours / 24));
        result.setHours(hours % 24, minutes, seconds || 0, 0);
    } else {
        result.setHours(hours, minutes, seconds || 0, 0);
    }
    
    return result;
}

/**
 * Создает HTML для отображения расписания с улучшенным UI
 */
function renderEnhancedSchedule(scheduleItems, currentTime) {
    const container = document.createElement('div');
    container.className = 'schedule-route-list';

    if (scheduleItems.length === 0) {
        container.innerHTML = `
            <div class="schedule-empty-state">
                <p>No upcoming buses for this stop.</p>
                <span>Service may be temporarily unavailable or there are no scheduled trips for today.</span>
                <div style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
                    <button class="btn ghost" id="retry-schedule-btn">Retry</button>
                    <button class="btn" id="report-issue-btn">Report</button>
                </div>
            </div>
        `;
        // Attach click handlers
        setTimeout(() => {
            const retryBtn = document.getElementById('retry-schedule-btn');
            if (retryBtn) retryBtn.addEventListener('click', () => { if (window.loadScheduleContentForStop && window.currentStopForSchedulePanel) window.loadScheduleContentForStop(window.currentStopForSchedulePanel, { showSkeleton: true }); });
            const reportBtn = document.getElementById('report-issue-btn');
            if (reportBtn) reportBtn.addEventListener('click', () => { if (typeof showToast === 'function') showToast('Please include the stop number when reporting. Thanks!', 'info', 5000); });
        }, 50);
        return container;
    }

    const grouped = groupScheduleByRoute(scheduleItems);
    grouped.forEach(routeGroup => {
        const routeItem = buildRouteScheduleCard(routeGroup, currentTime);
        container.appendChild(routeItem);
    });

    return container;
}

function groupScheduleByRoute(items) {
    const groups = new Map();
    items.forEach(item => {
        const key = `${item.routeNumber}|${item.headsign || ''}`;
        if (!groups.has(key)) {
            groups.set(key, {
                routeNumber: item.routeNumber,
                routeName: item.routeName,
                headsign: item.headsign,
                routeColor: normalizeRouteColor(item.routeColor),
                arrivals: []
            });
        }
        groups.get(key).arrivals.push(item);
    });

    return Array.from(groups.values()).sort((a, b) => {
        const nextA = getEffectiveTime(a.arrivals[0]);
        const nextB = getEffectiveTime(b.arrivals[0]);
        return nextA - nextB;
    });
}

function buildRouteScheduleCard(routeGroup, currentTime) {
    const wrapper = document.createElement('div');
    wrapper.className = 'route-item';

    const infoColumn = document.createElement('div');
    infoColumn.className = 'route-item-info';

    const circle = document.createElement('div');
    circle.className = 'route-circle';
    circle.textContent = routeGroup.routeNumber || '—';
    if (routeGroup.routeColor) circle.style.background = routeGroup.routeColor;
    infoColumn.appendChild(circle);

    const detailsColumn = document.createElement('div');
    detailsColumn.className = 'route-item-details';

    const title = document.createElement('div');
    title.className = 'route-name-schedule';
    const headsign = routeGroup.headsign || routeGroup.routeName || 'Upcoming service';
    title.textContent = headsign;
    detailsColumn.appendChild(title);

    if (routeGroup.routeName && routeGroup.headsign && routeGroup.routeName !== routeGroup.headsign) {
        const caption = document.createElement('div');
        caption.className = 'route-caption';
        caption.textContent = routeGroup.routeName;
        detailsColumn.appendChild(caption);
    }

    const grid = document.createElement('div');
    grid.className = 'route-schedule-grid';
    routeGroup.arrivals.slice(0, 3).forEach(arrival => {
        const tile = buildArrivalTile(arrival, currentTime);
        // add class for source badge styling
        const badge = tile.querySelector('.arrival-source-badge');
        if (badge) {
            badge.classList.add(arrival.type === 'api' ? 'live' : 'scheduled');
        }
        grid.appendChild(tile);
    });
    detailsColumn.appendChild(grid);

    wrapper.appendChild(infoColumn);
    wrapper.appendChild(detailsColumn);
    return wrapper;
}

function buildArrivalTile(arrival, currentTime) {
    const tile = document.createElement('div');
    tile.className = 'arrival-time-item';

    const effectiveTime = getEffectiveTime(arrival);
    const diffMinutes = Math.round((effectiveTime - currentTime) / 60000);

    // Display time and add a small badge for source (API/GTFS)
    const timeLabel = document.createElement('div');
    timeLabel.className = 'arrival-time-label';
    timeLabel.textContent = formatArrivalLabel(effectiveTime, diffMinutes);
    tile.appendChild(timeLabel);

    const sourceBadge = document.createElement('div');
    sourceBadge.className = 'arrival-source-badge';
    sourceBadge.textContent = arrival.type === 'api' ? 'Live' : 'Scheduled';
    tile.appendChild(sourceBadge);

    if (diffMinutes <= 0) tile.classList.add('now');
    else if (diffMinutes <= 5) tile.classList.add('critical-soon');
    else if (diffMinutes <= 15) tile.classList.add('soon');

    if (arrival.isRealTime) {
        tile.classList.add('time-live');
        if (arrival.delay) {
            const delayBadge = document.createElement('span');
            delayBadge.className = arrival.delay > 0 ? 'delay-late' : 'delay-early';
            delayBadge.textContent = arrival.delay > 0 ? `+${arrival.delay}m` : `${arrival.delay}m`;
            tile.appendChild(delayBadge);
        }
    }

    return tile;
}

function getEffectiveTime(arrival) {
    return arrival.estimatedTime || arrival.scheduledTime;
}

function formatArrivalLabel(date, diffMinutes) {
    if (diffMinutes <= 1) return 'Due';
    if (diffMinutes < 60) return `${diffMinutes} min`;
    return date.toLocaleTimeString('en-CA', {
        timeZone: 'America/Winnipeg',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalizeRouteColor(color) {
    if (!color) return null;
    const trimmed = color.trim();
    if (trimmed.startsWith('#')) return trimmed;
    return `#${trimmed}`;
}
