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
    return mergeSchedules(gtfsSchedule, apiSchedule, currentTimeUTC);
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
            return [];
        }
        
        const data = await response.json();
        const routeSchedules = data?.data?.['stop-schedule']?.['route-schedules'] || [];
        
        const results = [];
        
        routeSchedules.forEach(routeSchedule => {
            const route = routeSchedule.route;
            const scheduledStops = routeSchedule['scheduled-stops'] || [];
            
            scheduledStops.forEach(sStop => {
                if (sStop.cancelled === "true") return;
                
                const times = sStop.times?.departure;
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
    container.className = 'enhanced-schedule-container';
    
    if (scheduleItems.length === 0) {
        container.innerHTML = `
            <div class="no-schedule-message">
                <i class="fas fa-info-circle"></i>
                <p>${getRandomNoScheduleMessage()}</p>
            </div>
        `;
        return container;
    }
    
    // Группируем по маршрутам
    const groupedByRoute = {};
    scheduleItems.forEach(item => {
        if (!groupedByRoute[item.routeNumber]) {
            groupedByRoute[item.routeNumber] = {
                routeNumber: item.routeNumber,
                routeName: item.routeName,
                routeColor: item.routeColor,
                arrivals: []
            };
        }
        groupedByRoute[item.routeNumber].arrivals.push(item);
    });
    
    // Сортируем маршруты по ближайшему прибытию
    const routes = Object.values(groupedByRoute).sort((a, b) => {
        const timeA = a.arrivals[0].estimatedTime || a.arrivals[0].scheduledTime;
        const timeB = b.arrivals[0].estimatedTime || b.arrivals[0].scheduledTime;
        return timeA - timeB;
    });
    
    routes.forEach(route => {
        const routeBlock = createRouteScheduleBlock(route, currentTime);
        container.appendChild(routeBlock);
    });
    
    return container;
}

/**
 * Создает блок расписания для одного маршрута
 */
function createRouteScheduleBlock(routeData, currentTime) {
    const block = document.createElement('div');
    block.className = 'route-schedule-block';
    
    // Заголовок маршрута
    const header = document.createElement('div');
    header.className = 'route-schedule-header';
    
    const routeBadge = document.createElement('span');
    routeBadge.className = 'route-badge';
    routeBadge.textContent = routeData.routeNumber;
    if (routeData.routeColor) {
        routeBadge.style.backgroundColor = routeData.routeColor.startsWith('#') 
            ? routeData.routeColor 
            : `#${routeData.routeColor}`;
    }
    
    const routeName = document.createElement('span');
    routeName.className = 'route-name';
    routeName.textContent = routeData.routeName || '';
    
    header.appendChild(routeBadge);
    header.appendChild(routeName);
    
    // Список прибытий
    const arrivalsList = document.createElement('div');
    arrivalsList.className = 'arrivals-list';
    
    // Показываем до 3 ближайших прибытий
    routeData.arrivals.slice(0, 3).forEach((arrival, index) => {
        const arrivalItem = createArrivalItem(arrival, currentTime, index === 0);
        arrivalsList.appendChild(arrivalItem);
    });
    
    block.appendChild(header);
    block.appendChild(arrivalsList);
    
    return block;
}

/**
 * Определяет уровень загруженности на основе времени суток
 */
function getOccupancyLevel(dateTime) {
    const winnipegTime = new Date(dateTime.toLocaleString('en-US', { timeZone: 'America/Winnipeg' }));
    const hour = winnipegTime.getHours();
    const minute = winnipegTime.getMinutes();
    
    // Пиковые часы: 7:00-9:00 и 16:00-18:00
    if ((hour === 7 && minute >= 30) || hour === 8 || (hour === 9 && minute < 30)) {
        return { level: 'high', icon: '●', text: 'High occupancy', color: '#fa383e' };
    } else if ((hour === 16 && minute >= 30) || hour === 17 || (hour === 18 && minute < 30)) {
        return { level: 'high', icon: '●', text: 'High occupancy', color: '#fa383e' };
    } else if ((hour >= 6 && hour < 7) || (hour === 9 && minute >= 30) || (hour >= 10 && hour < 12) || (hour >= 15 && hour < 16) || (hour >= 18 && hour < 20)) {
        return { level: 'medium', icon: '◐', text: 'Medium occupancy', color: '#ffc700' };
    }
    return { level: 'low', icon: '○', text: 'Low occupancy', color: '#00a400' };
}

/**
 * Создает элемент отображения одного прибытия
 */
function createArrivalItem(arrival, currentTime, isFirst) {
    const item = document.createElement('div');
    item.className = 'arrival-item';
    if (isFirst) item.classList.add('next-arrival');
    
    // Время прибытия
    const timeInfo = document.createElement('div');
    timeInfo.className = 'arrival-time-info';
    
    const effectiveTime = arrival.estimatedTime || arrival.scheduledTime;
    const diffMinutes = Math.round((effectiveTime - currentTime) / 60000);
    
    let timeText = '';
    let timeClass = '';
    
    if (diffMinutes <= 1) {
        timeText = 'NOW';
        timeClass = 'time-now';
    } else if (diffMinutes < 60) {
        timeText = `${diffMinutes} min`;
        timeClass = diffMinutes <= 5 ? 'time-soon' : 'time-upcoming';
    } else {
        timeText = effectiveTime.toLocaleTimeString('en-US', {
            timeZone: 'America/Winnipeg',
            hour: '2-digit',
            minute: '2-digit'
        });
        timeClass = 'time-scheduled';
    }
    
    const timeSpan = document.createElement('span');
    timeSpan.className = `arrival-time ${timeClass}`;
    timeSpan.textContent = timeText;
    
    timeInfo.appendChild(timeSpan);
    
    // Статус и задержка
    const statusInfo = document.createElement('div');
    statusInfo.className = 'arrival-status';
    
    if (arrival.isRealTime) {
        const liveIndicator = document.createElement('span');
        liveIndicator.className = 'live-indicator';
        liveIndicator.innerHTML = '<i class="fas fa-circle"></i> LIVE';
        liveIndicator.title = 'Real-time tracking';
        statusInfo.appendChild(liveIndicator);
        
        if (arrival.delay !== null && arrival.delay !== 0) {
            const delaySpan = document.createElement('span');
            delaySpan.className = arrival.delay > 0 ? 'delay-late' : 'delay-early';
            const delayText = arrival.delay > 0 
                ? `+${arrival.delay} min late` 
                : `${Math.abs(arrival.delay)} min early`;
            delaySpan.textContent = delayText;
            delaySpan.title = `Scheduled: ${arrival.scheduledTime.toLocaleTimeString('en-US', {timeZone: 'America/Winnipeg', hour: '2-digit', minute: '2-digit'})}`;
            statusInfo.appendChild(delaySpan);
        }
    } else {
        const scheduledIndicator = document.createElement('span');
        scheduledIndicator.className = 'scheduled-indicator';
        scheduledIndicator.textContent = 'Scheduled';
        scheduledIndicator.title = 'Based on GTFS timetable';
        statusInfo.appendChild(scheduledIndicator);
    }
    
    // Headsign/направление
    if (arrival.headsign) {
        const headsignSpan = document.createElement('span');
        headsignSpan.className = 'arrival-headsign';
        headsignSpan.textContent = arrival.headsign;
        statusInfo.appendChild(headsignSpan);
    }
    
    // Индикатор загруженности
    const occupancy = getOccupancyLevel(effectiveTime);
    const occupancySpan = document.createElement('span');
    occupancySpan.className = `occupancy-indicator occupancy-${occupancy.level}`;
    
    // Короткие названия для компактности
    const occupancyLabels = {
        'low': 'Low',
        'medium': 'Medium', 
        'high': 'High'
    };
    
    occupancySpan.innerHTML = `<span style="font-size: 1.2em;">${occupancy.icon}</span> ${occupancyLabels[occupancy.level]}`;
    occupancySpan.title = occupancy.text;
    statusInfo.appendChild(occupancySpan);
    
    item.appendChild(timeInfo);
    item.appendChild(statusInfo);
    
    return item;
}
