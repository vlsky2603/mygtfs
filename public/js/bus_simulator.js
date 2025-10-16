// ===================================================================
//     bus_simulator.js - Симулятор движения автобусов (GTFS-based)
// ===================================================================

function generateBusId(busData) { return `${busData.gtfsTripId}_${new Date(busData.effectiveDepartureTime).getTime()}`; }

// Получаем задержку автобуса один раз из API (разница между estimated и scheduled)
function calculateBusDelay(sStopData) {
    const scheduledStr = sStopData.times?.departure?.scheduled;
    const estimatedStr = sStopData.times?.departure?.estimated;
    
    if (!scheduledStr || !estimatedStr) return 0;
    
    const scheduledTime = new Date(scheduledStr);
    const estimatedTime = new Date(estimatedStr);
    
    // Задержка в миллисекундах (может быть отрицательной если автобус раньше)
    return estimatedTime.getTime() - scheduledTime.getTime();
}

// Получаем все остановки рейса с их GTFS расписанием
function getTripStopsWithSchedule(tripId, currentStopId, simulationNowUTC) {
    const stopsOnTrip = gtfsData.tripToStops[tripId];
    if (!stopsOnTrip || !stopsOnTrip.length) return null;
    
    const sortedStops = stopsOnTrip.sort((a, b) => a.stop_sequence - b.stop_sequence);
    const currentStopIndex = sortedStops.findIndex(st => String(st.stop_id) === String(currentStopId));
    
    if (currentStopIndex === -1) return null;
    
    // Конвертируем GTFS времена в абсолютные даты
    const stopsWithTimes = sortedStops.map(stop => {
        const departureSeconds = gtfsTimeToSeconds(stop.departure_time);
        const arrivalSeconds = gtfsTimeToSeconds(stop.arrival_time);
        
        return {
            ...stop,
            scheduledDepartureTime: departureSeconds !== null ? getDatetimeForGtfsTime(departureSeconds, simulationNowUTC) : null,
            scheduledArrivalTime: arrivalSeconds !== null ? getDatetimeForGtfsTime(arrivalSeconds, simulationNowUTC) : null
        };
    });
    
    return {
        allStops: stopsWithTimes,
        currentStopIndex: currentStopIndex,
        currentStop: stopsWithTimes[currentStopIndex]
    };
}

async function simulateAndShowUpcomingBusesForRoute(currentLiveOriginStopData, routeScheduleForSelectedRoute, simulationReferenceTimeStr, isForLiveViewMode = false) {
    if (isForLiveViewMode) { 
        activeSimulatedBuses = {}; 
    } else if (simulatedBusesLayerGroup) { 
        simulatedBusesLayerGroup.clearLayers(); 
        activeSimulatedBuses = {}; 
    }
    if (!routeScheduleForSelectedRoute || !gtfsData.routes?.length) return;
    
    const simulationNowUTC = new Date(simulationReferenceTimeStr);
    const apiRouteNumber = String(routeScheduleForSelectedRoute.route.number);
    const scheduledStopsAPI = routeScheduleForSelectedRoute['scheduled-stops'] || [];
    
    const elementsToFitInLiveView = [];
    if (liveViewOriginStopMarker) elementsToFitInLiveView.push(liveViewOriginStopMarker);

    // Собираем автобусы с временем прибытия для сортировки
    const busesToSimulate = [];
    
    for (const sStop of scheduledStopsAPI) {
        if (sStop.cancelled === "true") continue;

        const effectiveDepartureTimeStr = sStop.times?.departure?.estimated || sStop.times?.departure?.scheduled; 
        if (!effectiveDepartureTimeStr) continue;
        
        const effectiveDepartureTimeUTC = new Date(effectiveDepartureTimeStr); 
        const timeToArrivalAtTargetMinutes = (effectiveDepartureTimeUTC.getTime() - simulationNowUTC.getTime()) / (1000 * 60);

        // Показываем автобусы в диапазоне -10 до +90 минут
        if (timeToArrivalAtTargetMinutes < -10 || timeToArrivalAtTargetMinutes > 90) continue;
        
        busesToSimulate.push({
            sStop: sStop,
            effectiveDepartureTimeUTC: effectiveDepartureTimeUTC,
            timeToArrivalAtTargetMinutes: timeToArrivalAtTargetMinutes
        });
    }
    
    // Сортируем по времени прибытия и берем только 2 ближайших
    busesToSimulate.sort((a, b) => a.timeToArrivalAtTargetMinutes - b.timeToArrivalAtTargetMinutes);
    const closestBuses = busesToSimulate.slice(0, 2);
    
    console.log(`📍 Showing ${closestBuses.length} closest buses out of ${busesToSimulate.length} total`);

    // Обрабатываем только 2 ближайших автобуса
    for (const busInfo of closestBuses) {
        const sStop = busInfo.sStop;
        const effectiveDepartureTimeUTC = busInfo.effectiveDepartureTimeUTC;
        const timeToArrivalAtTargetMinutes = busInfo.timeToArrivalAtTargetMinutes;
        
        // Находим GTFS маршрут
        const gtfsRoute = gtfsData.routes.find(r => String(r.route_short_name) === apiRouteNumber); 
        if (!gtfsRoute) continue;
        
        // Находим подходящий GTFS trip
        const stopDirectionHint = getDirectionFromStopName(currentLiveOriginStopData.stop_name); 
        const expectedGtfsDirId = stopDirectionHint ? mapDirectionToGtfsId(stopDirectionHint, gtfsRoute.route_id) : null;
        
        let finalGtfsTrip = null;
        let bestGtfsMatchScore = -1;
        const allTripsForRoute = gtfsData.trips.filter(t => t.route_id === gtfsRoute.route_id);

        for (const trip of allTripsForRoute) {
            if (!trip.shape_id) continue;
            const stopsOnThisCandidateTrip = gtfsData.tripToStops[trip.trip_id];
            if (!(stopsOnThisCandidateTrip && stopsOnThisCandidateTrip.find(st => String(st.stop_id) === String(currentLiveOriginStopData.stop_id)))) continue;
            
            let currentScore = 0;
            if (expectedGtfsDirId !== null && trip.direction_id !== undefined) {
                if (String(trip.direction_id) === String(expectedGtfsDirId)) currentScore += 2;
            } else if (expectedGtfsDirId === null) {
                currentScore += 0.5;
            }

            if (trip.trip_headsign && sStop.variant.name) {
                const variantNameLower = sStop.variant.name.toLowerCase();
                const headsignLower = trip.trip_headsign.toLowerCase();
                if (variantNameLower.includes(headsignLower) || headsignLower.includes(variantNameLower)) currentScore += 1;
            }

            if (currentScore > bestGtfsMatchScore) {
                bestGtfsMatchScore = currentScore;
                finalGtfsTrip = trip;
            }
        }
        
        if (!finalGtfsTrip && allTripsForRoute.length > 0) {
            finalGtfsTrip = allTripsForRoute.find(t => 
                t.shape_id && 
                gtfsData.tripToStops[t.trip_id]?.find(st => String(st.stop_id) === String(currentLiveOriginStopData.stop_id))
            );
        }
        
        if (!finalGtfsTrip) {
            console.warn("Could not find GTFS trip for route:", apiRouteNumber, "Stop:", currentLiveOriginStopData.stop_id);
            continue;
        }
        
        // Получаем shape для отрисовки маршрута
        const shapeId = finalGtfsTrip.shape_id;
        const routeShape = gtfsData.shapes[shapeId];
        if (!routeShape || !routeShape.length) {
            console.warn(`No shape data for shape_id ${shapeId}`);
            continue;
        }

        // Рисуем маршрут один раз для Live View
        if (isForLiveViewMode && !currentRoutePolyline && shapeId) {
            liveViewSpecificShapeId = shapeId;
            const shapePoints = routeShape.map(pt => [pt.lat, pt.lon]);
            const routeColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim();
            currentRoutePolyline = L.polyline(shapePoints, { color: routeColor, weight: 4, opacity: 0.75 }).addTo(map);
            
            // Добавляем остановки на маршруте
            const tripStops = gtfsData.tripToStops[finalGtfsTrip.trip_id];
            if (tripStops && tripStops.length > 0) {
                tripStops.forEach(stopData => {
                    const stopDetail = gtfsData.stopDetails[stopData.stop_id];
                    if (stopDetail) {
                        const stopMarker = L.circleMarker([parseFloat(stopDetail.stop_lat), parseFloat(stopDetail.stop_lon)], {
                            radius: 4,
                            fillColor: '#ffffff',
                            color: routeColor,
                            weight: 2,
                            opacity: 0.8,
                            fillOpacity: 0.9,
                            interactive: false
                        }).addTo(map);
                        
                        // Сохраняем маркер для последующего удаления
                        if (!window.routeStopMarkers) window.routeStopMarkers = [];
                        window.routeStopMarkers.push(stopMarker);
                    }
                });
                console.log(`✅ Drew ${tripStops.length} stops on route`);
            }
        }
        
        // Получаем GTFS расписание для всех остановок рейса
        const tripSchedule = getTripStopsWithSchedule(finalGtfsTrip.trip_id, currentLiveOriginStopData.stop_id, simulationNowUTC);
        if (!tripSchedule) continue;
        
        // Вычисляем задержку автобуса (один раз из API)
        const busDelayMs = calculateBusDelay(sStop);
        
        // Создаем данные автобуса
        let busDataPayload = {
            routeNumber: apiRouteNumber,
            apiVariantKey: sStop.variant.key,
            gtfsTripId: finalGtfsTrip.trip_id,
            variantName: sStop.variant.name,
            effectiveDepartureTime: effectiveDepartureTimeUTC,
            sStopData: sStop,
            destination: sStop.variant.name,
            gtfsDirectionId: finalGtfsTrip.direction_id,
            shapeId: shapeId,
            targetStopData: { ...currentLiveOriginStopData },
            targetStopSequenceOnTrip: tripSchedule.currentStop.stop_sequence,
            busDelayMs: busDelayMs, // Задержка в миллисекундах
            tripSchedule: tripSchedule // Полное GTFS расписание рейса
        };
        
        const busId = generateBusId(busDataPayload);
        setupBusForAnimation(busId, busDataPayload, routeShape, simulationNowUTC);
        
        if (activeSimulatedBuses[busId] && activeSimulatedBuses[busId].marker && isForLiveViewMode) {
            elementsToFitInLiveView.push(activeSimulatedBuses[busId].marker);
        }
    }

    // Подгоняем карту под все элементы в Live View
    if (isForLiveViewMode && elementsToFitInLiveView.length > 0) {
        try {
            // Показываем только от ближайшего автобуса до целевой остановки (не весь маршрут)
            const busMarkersOnly = elementsToFitInLiveView.filter(el => el instanceof L.Marker);
            
            if (busMarkersOnly.length > 0) {
                // Добавляем маркер остановки для правильного зума
                const elementsForZoom = [...busMarkersOnly];
                if (liveViewOriginStopMarker) {
                    elementsForZoom.push(liveViewOriginStopMarker);
                }
                
                map.fitBounds(L.featureGroup(elementsForZoom).getBounds().pad(LIVE_VIEW_ZOOM_PADDING), {maxZoom: 16, animate: true});
            } else if (liveViewOriginStopMarker) {
                // Если автобусов нет, показываем только остановку
                map.setView(liveViewOriginStopMarker.getLatLng(), 15, {animate: true});
            }
        } catch (e) {
            console.warn('Error fitting bounds:', e);
            if (liveViewOriginStopMarker) {
                map.setView(liveViewOriginStopMarker.getLatLng(), 15, {animate: true});
            }
        }
    }
    
    if (isForLiveViewMode) updateResetRouteButtonVisibility();
}

function setupBusForAnimation(busId, busData, routeShape, simulationNowUTC) {
    const targetStopDataForThisBus = busData.targetStopData;
    const timeToArrivalAtTargetMinutes = (busData.effectiveDepartureTime.getTime() - simulationNowUTC.getTime()) / (1000 * 60);

    // Удаляем автобусы, которые уехали более 10 минут назад
    if (timeToArrivalAtTargetMinutes < -10) {
        if (activeSimulatedBuses[busId]?.marker) simulatedBusesLayerGroup.removeLayer(activeSimulatedBuses[busId].marker);
        if (activeSimulatedBuses[busId]?.animatedPath) map.removeLayer(activeSimulatedBuses[busId].animatedPath);
        delete activeSimulatedBuses[busId];
        return;
    }

    // Находим ближайшую точку на shape для целевой остановки
    let closestPointIndexOnShapeForTargetStop = -1;
    let minDistanceSqToTargetStop = Infinity;
    const targetStopLatLng = L.latLng(parseFloat(targetStopDataForThisBus.stop_lat), parseFloat(targetStopDataForThisBus.stop_lon));
    
    routeShape.forEach((pt, index) => {
        const dSq = targetStopLatLng.distanceTo(L.latLng(pt.lat, pt.lon));
        if (dSq < minDistanceSqToTargetStop) {
            minDistanceSqToTargetStop = dSq;
            closestPointIndexOnShapeForTargetStop = index;
        }
    });

    if (closestPointIndexOnShapeForTargetStop === -1) {
        if (activeSimulatedBuses[busId]?.marker) simulatedBusesLayerGroup.removeLayer(activeSimulatedBuses[busId].marker);
        if (activeSimulatedBuses[busId]?.animatedPath) map.removeLayer(activeSimulatedBuses[busId].animatedPath);
        delete activeSimulatedBuses[busId];
        return;
    }

        // ===== УПРОЩЕННАЯ ТОЧНАЯ ЛОГИКА: Используем API время + пропорции GTFS =====
    let newCalculatedShapeIndex;
    const nowMs = simulationNowUTC.getTime();
    const busDelayMs = busData.busDelayMs || 0;
    const targetArrivalMs = busData.effectiveDepartureTime.getTime();
    const timeUntilArrivalMinutes = (targetArrivalMs - nowMs) / (1000 * 60);
    
    console.log(`🚌 Bus ${busData.routeNumber}: arrival in ${timeUntilArrivalMinutes.toFixed(1)} min, delay: ${Math.round(busDelayMs/60000)} min`);
    
    if (!busData.tripSchedule || !busData.tripSchedule.allStops || busData.tripSchedule.allStops.length < 2) {
        // Нет расписания - простая логика
        if (timeUntilArrivalMinutes <= 0) {
            newCalculatedShapeIndex = closestPointIndexOnShapeForTargetStop;
        } else {
            const distanceFromTarget = Math.max(0, Math.floor(timeUntilArrivalMinutes * 2));
            newCalculatedShapeIndex = Math.max(0, closestPointIndexOnShapeForTargetStop - distanceFromTarget);
        }
        console.log(`⚠️ No schedule, simple logic: index ${newCalculatedShapeIndex}`);
    } else {
        // Используем GTFS для определения общей продолжительности поездки
        const allStops = busData.tripSchedule.allStops;
        const currentStopIndex = busData.tripSchedule.currentStopIndex;
        
        // Определяем направление движения по shape (прямое или обратное)
        // Сравниваем позиции целевой остановки и первой остановки на shape
        let isReverseDirection = false;
        
        // Находим первую остановку маршрута с временем
        let firstStopWithTime = null;
        let firstStopShapeIndex = -1;
        
        console.log(`🔍 Searching for first stop in ${allStops.length} stops...`);
        
        for (let i = 0; i < allStops.length; i++) {
            if (allStops[i].departure_time || allStops[i].arrival_time) {
                firstStopWithTime = allStops[i];
                console.log(`🔍 Found first stop with time: stop_id=${firstStopWithTime.stop_id}, seq=${firstStopWithTime.stop_sequence}, time=${firstStopWithTime.departure_time || firstStopWithTime.arrival_time}`);
                
                // Находим эту остановку на shape
                const stopDetail = gtfsData.stopDetails[firstStopWithTime.stop_id];
                if (stopDetail) {
                    const stopLatLng = L.latLng(parseFloat(stopDetail.stop_lat), parseFloat(stopDetail.stop_lon));
                    let minDist = Infinity;
                    
                    routeShape.forEach((pt, idx) => {
                        const dist = stopLatLng.distanceTo(L.latLng(pt.lat, pt.lon));
                        if (dist < minDist) {
                            minDist = dist;
                            firstStopShapeIndex = idx;
                        }
                    });
                    console.log(`✅ First stop mapped to shape index ${firstStopShapeIndex} (min distance: ${minDist.toFixed(1)}m)`);
                } else {
                    console.warn(`⚠️ Stop detail not found for stop_id=${firstStopWithTime.stop_id}`);
                }
                break;
            }
        }
        
        // Определяем направление: если целевая остановка имеет МЕНЬШИЙ индекс на shape, едем в обратном направлении
        if (firstStopShapeIndex !== -1 && closestPointIndexOnShapeForTargetStop < firstStopShapeIndex) {
            isReverseDirection = true;
            console.log(`🔄 Reverse direction detected: target=${closestPointIndexOnShapeForTargetStop} < first=${firstStopShapeIndex}, trip=${busData.gtfsTripId}, direction_id=${busData.gtfsDirectionId}`);
        } else if (firstStopShapeIndex !== -1) {
            console.log(`➡️ Forward direction detected: target=${closestPointIndexOnShapeForTargetStop} >= first=${firstStopShapeIndex}, trip=${busData.gtfsTripId}, direction_id=${busData.gtfsDirectionId}`);
        } else {
            console.warn(`⚠️ Could not determine direction: firstStopShapeIndex=${firstStopShapeIndex}`);
        }
        
        console.log(`🔍 Checking condition: firstStopWithTime=${!!firstStopWithTime}, firstStopShapeIndex=${firstStopShapeIndex}, distance=${Math.abs(closestPointIndexOnShapeForTargetStop - firstStopShapeIndex)}`);
        
        if (firstStopWithTime && firstStopShapeIndex !== -1 && Math.abs(closestPointIndexOnShapeForTargetStop - firstStopShapeIndex) > 0) {
            // Вычисляем общую продолжительность от первой остановки до целевой
            const firstStopTimeSeconds = gtfsTimeToSeconds(firstStopWithTime.departure_time);
            const targetStopTimeSeconds = gtfsTimeToSeconds(allStops[currentStopIndex].arrival_time);
            
            console.log(`📊 Debug: firstStop="${firstStopWithTime.departure_time}" (${firstStopTimeSeconds}s), targetStop="${allStops[currentStopIndex].arrival_time}" (${targetStopTimeSeconds}s)`);
            
            if (firstStopTimeSeconds !== null && targetStopTimeSeconds !== null) {
                let totalTripDurationSeconds = targetStopTimeSeconds - firstStopTimeSeconds;
                
                // Учитываем переход через полночь (если target < first)
                if (totalTripDurationSeconds < 0) {
                    totalTripDurationSeconds += 24 * 3600;
                }
                
                // Вычисляем сколько времени прошло с момента выезда
                const totalTripDurationMs = totalTripDurationSeconds * 1000;
                const timeFromFirstStopMs = totalTripDurationMs - (timeUntilArrivalMinutes * 60 * 1000);
                
                console.log(`📊 Total trip: ${(totalTripDurationMs/60000).toFixed(1)} min, Time from first: ${(timeFromFirstStopMs/60000).toFixed(1)} min, Until arrival: ${timeUntilArrivalMinutes.toFixed(1)} min`);
                
                if (timeFromFirstStopMs >= 0 && timeFromFirstStopMs <= totalTripDurationMs) {
                    // Автобус в пути - вычисляем общий прогресс от первой остановки до целевой
                    const progress = timeFromFirstStopMs / totalTripDurationMs;
                    
                    if (isReverseDirection) {
                        // Для обратного направления: едем от большего индекса к меньшему
                        const shapeDistance = Math.abs(firstStopShapeIndex - closestPointIndexOnShapeForTargetStop);
                        newCalculatedShapeIndex = Math.round(firstStopShapeIndex - progress * shapeDistance);
                        console.log(`🔄 Reverse calc: first=${firstStopShapeIndex}, target=${closestPointIndexOnShapeForTargetStop}, dist=${shapeDistance}, result=${newCalculatedShapeIndex}`);
                    } else {
                        // Для прямого направления: едем от меньшего индекса к большему
                        const shapeDistance = Math.abs(closestPointIndexOnShapeForTargetStop - firstStopShapeIndex);
                        newCalculatedShapeIndex = Math.round(firstStopShapeIndex + progress * shapeDistance);
                        console.log(`➡️ Forward calc: first=${firstStopShapeIndex}, target=${closestPointIndexOnShapeForTargetStop}, dist=${shapeDistance}, result=${newCalculatedShapeIndex}`);
                    }
                    
                    console.log(`✅ Bus en route: ${(progress * 100).toFixed(1)}% of trip, shape ${newCalculatedShapeIndex} ${isReverseDirection ? '(reverse)' : '(forward)'}`);
                    
                } else if (timeFromFirstStopMs < 0) {
                    // Автобус еще не выехал
                    console.log(`❌ Bus not yet departed (${Math.abs(Math.round(timeFromFirstStopMs / 60000))} min before first stop)`);
                    if (activeSimulatedBuses[busId]?.marker) simulatedBusesLayerGroup.removeLayer(activeSimulatedBuses[busId].marker);
                    if (activeSimulatedBuses[busId]?.animatedPath) map.removeLayer(activeSimulatedBuses[busId].animatedPath);
                    delete activeSimulatedBuses[busId];
                    return;
                } else {
                    // Автобус уже проехал целевую остановку - продолжаем движение дальше
                    // Находим следующие остановки после целевой
                    const nextStopIndex = currentStopIndex + 1;
                    if (nextStopIndex < allStops.length && allStops[nextStopIndex].arrival_time) {
                        // Есть следующая остановка - продолжаем движение
                        const nextStopTimeSeconds = gtfsTimeToSeconds(allStops[nextStopIndex].arrival_time);
                        let extendedTripDurationSeconds = nextStopTimeSeconds - firstStopTimeSeconds;
                        if (extendedTripDurationSeconds < 0) extendedTripDurationSeconds += 24 * 3600;
                        
                        const extendedTripDurationMs = extendedTripDurationSeconds * 1000;
                        const extendedProgress = timeFromFirstStopMs / extendedTripDurationMs;
                        
                        // Находим следующую остановку на shape
                        const nextStopDetail = gtfsData.stopDetails[allStops[nextStopIndex].stop_id];
                        let nextStopShapeIndex = closestPointIndexOnShapeForTargetStop;
                        
                        if (nextStopDetail) {
                            const nextStopLatLng = L.latLng(parseFloat(nextStopDetail.stop_lat), parseFloat(nextStopDetail.stop_lon));
                            let minDist = Infinity;
                            routeShape.forEach((pt, idx) => {
                                const dist = nextStopLatLng.distanceTo(L.latLng(pt.lat, pt.lon));
                                if (dist < minDist) {
                                    minDist = dist;
                                    nextStopShapeIndex = idx;
                                }
                            });
                        }
                        
                        if (isReverseDirection) {
                            const shapeDistance = Math.abs(firstStopShapeIndex - nextStopShapeIndex);
                            newCalculatedShapeIndex = Math.round(firstStopShapeIndex - extendedProgress * shapeDistance);
                        } else {
                            const shapeDistance = Math.abs(nextStopShapeIndex - firstStopShapeIndex);
                            newCalculatedShapeIndex = Math.round(firstStopShapeIndex + extendedProgress * shapeDistance);
                        }
                        
                        console.log(`🚏 Bus past target, continuing to next stop: ${(extendedProgress * 100).toFixed(1)}%, shape ${newCalculatedShapeIndex}`);
                    } else {
                        // Конец маршрута - ставим на последнюю точку
                        newCalculatedShapeIndex = isReverseDirection ? 0 : routeShape.length - 1;
                        console.log(`🏁 Bus at end of route, shape ${newCalculatedShapeIndex}`);
                    }
                }
            } else {
                // Не удалось получить времена - простая логика
                const distanceFromTarget = Math.max(0, Math.floor(timeUntilArrivalMinutes * 2));
                
                if (isReverseDirection) {
                    newCalculatedShapeIndex = Math.min(routeShape.length - 1, closestPointIndexOnShapeForTargetStop + distanceFromTarget);
                } else {
                    newCalculatedShapeIndex = Math.max(0, closestPointIndexOnShapeForTargetStop - distanceFromTarget);
                }
                console.log(`⚠️ Time parse failed, fallback: ${newCalculatedShapeIndex} ${isReverseDirection ? '(reverse)' : ''}`);
            }
        } else {
            // Не нашли первую остановку - простая логика
            const distanceFromTarget = Math.max(0, Math.floor(timeUntilArrivalMinutes * 2));
            
            if (isReverseDirection) {
                newCalculatedShapeIndex = Math.min(routeShape.length - 1, closestPointIndexOnShapeForTargetStop + distanceFromTarget);
            } else {
                newCalculatedShapeIndex = Math.max(0, closestPointIndexOnShapeForTargetStop - distanceFromTarget);
            }
            console.log(`⚠️ First stop not found, fallback: ${newCalculatedShapeIndex} ${isReverseDirection ? '(reverse)' : ''}`);
        }
    }
    
    newCalculatedShapeIndex = Math.max(0, Math.min(newCalculatedShapeIndex, routeShape.length - 1));
    
    // Форматирование времени прибытия
    const timesForFormatting = busData.sStopData?.times?.departure || {
        scheduled: busData.effectiveDepartureTime.toISOString(),
        estimated: busData.effectiveDepartureTime.toISOString()
    };
    const formattedArrival = formatArrivalTime(timesForFormatting, simulationNowUTC);
    let arrivalText = formattedArrival.text;
    let markerClass = 'simulated-bus-marker marker-fade-in';
    
    if (arrivalText === 'Now') markerClass += ' bus-now';
    else if (formattedArrival.css.includes('soon') || formattedArrival.css.includes('critical-soon')) markerClass += ' bus-soon';

    const isAtStopPhysically = minDistanceSqToTargetStop < 100;
    if (arrivalText === '' && !(isAtStopPhysically && timeToArrivalAtTargetMinutes >= -2 && timeToArrivalAtTargetMinutes <= 2)) {
        if (activeSimulatedBuses[busId]?.marker) simulatedBusesLayerGroup.removeLayer(activeSimulatedBuses[busId].marker);
        if (activeSimulatedBuses[busId]?.animatedPath) map.removeLayer(activeSimulatedBuses[busId].animatedPath);
        delete activeSimulatedBuses[busId];
        return;
    }

    // Определяем загруженность на основе времени суток (в Виннипеге)
    const winnipegTime = new Date(simulationNowUTC.toLocaleString('en-US', { timeZone: 'America/Winnipeg' }));
    const hour = winnipegTime.getHours();
    const minute = winnipegTime.getMinutes();
    
    let occupancyLevel = 'low'; // low, medium, high
    let occupancyEmoji = '🟢'; // 🟢 низкая, 🟡 средняя, 🔴 высокая
    
    // Пиковые часы: 7:00-9:00 и 16:00-18:00
    if ((hour === 7 && minute >= 30) || hour === 8 || (hour === 9 && minute < 30)) {
        occupancyLevel = 'high';
        occupancyEmoji = '🔴';
    } else if ((hour === 16 && minute >= 30) || hour === 17 || (hour === 18 && minute < 30)) {
        occupancyLevel = 'high';
        occupancyEmoji = '🔴';
    } else if ((hour >= 6 && hour < 7) || (hour === 9 && minute >= 30) || (hour >= 10 && hour < 12) || (hour >= 15 && hour < 16) || (hour >= 18 && hour < 20)) {
        occupancyLevel = 'medium';
        occupancyEmoji = '🟡';
    }
    
    const occupancyHtml = `<span class="bus-occupancy-minimal" title="Occupancy level">${occupancyEmoji}</span>`;
    const busIconHtml = `<div class="bus-icon-wrapper"><i class="fas fa-bus"></i><span class="bus-route-number">${busData.routeNumber}</span></div>${arrivalText ? `<span class="bus-arrival-time">${arrivalText} ${occupancyHtml}</span>` : ''}`;
    const newIcon = L.divIcon({ className: markerClass, html: busIconHtml, iconSize: null, iconAnchor: [15, 15] });

    const currentBusPosition = routeShape[newCalculatedShapeIndex] ? L.latLng(routeShape[newCalculatedShapeIndex].lat, routeShape[newCalculatedShapeIndex].lon) : null;

    if (!currentBusPosition) {
        if (activeSimulatedBuses[busId]?.marker) simulatedBusesLayerGroup.removeLayer(activeSimulatedBuses[busId].marker);
        if (activeSimulatedBuses[busId]?.animatedPath) map.removeLayer(activeSimulatedBuses[busId].animatedPath);
        delete activeSimulatedBuses[busId];
        return;
    }

    // Обновление или создание маркера автобуса
    if (activeSimulatedBuses[busId]) {
        const busInfo = activeSimulatedBuses[busId];
        busInfo.previousCalculatedShapeIndex = busInfo.currentCalculatedShapeIndex;
        busInfo.currentCalculatedShapeIndex = newCalculatedShapeIndex;
        busInfo.lastUpdateTime = simulationNowUTC.getTime();
        busInfo.busData = { ...busData };
        busInfo.closestPointIndexOnShapeForTargetStop = closestPointIndexOnShapeForTargetStop;
        
        if (busInfo.marker.options.icon.options.html !== newIcon.options.html || busInfo.marker.options.icon.options.className !== newIcon.options.className) {
            busInfo.marker.setIcon(newIcon);
        }

        if (busInfo.animatedPath) map.removeLayer(busInfo.animatedPath);
        busInfo.animatedPath = null;

        if (currentBusPosition && isLiveBusViewActive && busInfo.busData.targetStopData && newCalculatedShapeIndex < closestPointIndexOnShapeForTargetStop) {
            const pathToStopPoints = routeShape.slice(newCalculatedShapeIndex, closestPointIndexOnShapeForTargetStop + 1).map(p => L.latLng(p.lat, p.lon));
            if (pathToStopPoints.length > 1) {
                busInfo.animatedPath = L.polyline(pathToStopPoints, {
                    color: 'var(--live-path-color)',
                    weight: 3,
                    opacity: 0.9,
                    className: 'animated-live-path'
                }).addTo(map);
            }
        }
    } else {
        const busMarker = L.marker(currentBusPosition, { 
            icon: newIcon, 
            zIndexOffset: 1000, 
            riseOnHover: false,
            interactive: false // Делаем маркер некликабельным
        }).addTo(simulatedBusesLayerGroup);
        
        // Убираем popup - автобусы в симуляции не должны быть кликабельными

        let newAnimatedPath = null;
        if (isLiveBusViewActive && busData.targetStopData && newCalculatedShapeIndex < closestPointIndexOnShapeForTargetStop) {
            const pathToStopPoints = routeShape.slice(newCalculatedShapeIndex, closestPointIndexOnShapeForTargetStop + 1).map(p => L.latLng(p.lat, p.lon));
            if (pathToStopPoints.length > 1) {
                newAnimatedPath = L.polyline(pathToStopPoints, {
                    color: 'var(--live-path-color)', weight: 3, opacity: 0.9, className: 'animated-live-path'
                }).addTo(map);
            }
        }
        
        activeSimulatedBuses[busId] = {
            marker: busMarker,
            busData: { ...busData },
            routeShape: routeShape,
            lastUpdateTime: simulationNowUTC.getTime(),
            currentCalculatedShapeIndex: newCalculatedShapeIndex,
            previousCalculatedShapeIndex: newCalculatedShapeIndex,
            closestPointIndexOnShapeForTargetStop: closestPointIndexOnShapeForTargetStop,
            animatedPath: newAnimatedPath
        };
    }
}

function updateBusTargetPositions() {
    if (Object.keys(activeSimulatedBuses).length === 0 && !isLiveBusViewActive) return; 

    const nowUTCForSim = determineSimulationTimeUTC();
    
    Object.keys(activeSimulatedBuses).forEach(busId => {
        const busInfo = activeSimulatedBuses[busId];
        if (!busInfo || !busInfo.marker || !simulatedBusesLayerGroup.hasLayer(busInfo.marker)) { 
            if (busInfo?.animatedPath) map.removeLayer(busInfo.animatedPath);
            delete activeSimulatedBuses[busId]; 
            return; 
        }
        setupBusForAnimation(busId, busInfo.busData, busInfo.routeShape, nowUTCForSim);
    });
}

function animateBusesSmoothly() {
    const now = Date.now(); 
    Object.values(activeSimulatedBuses).forEach(busInfo => {
        if (!busInfo.marker || !busInfo.routeShape || busInfo.routeShape.length === 0) return;
        
        const timeSinceLastTargetUpdate = now - busInfo.lastUpdateTime; 
        let progress = BUS_TARGET_UPDATE_INTERVAL > 0 ? Math.max(0, Math.min(1, timeSinceLastTargetUpdate / BUS_TARGET_UPDATE_INTERVAL)) : 1;
        
        const prevIdx = Number(busInfo.previousCalculatedShapeIndex); 
        const currentTargetIdx = Number(busInfo.currentCalculatedShapeIndex);

        if (isNaN(prevIdx) || isNaN(currentTargetIdx) || prevIdx < 0 || currentTargetIdx < 0 || prevIdx >= busInfo.routeShape.length || currentTargetIdx >= busInfo.routeShape.length ) { 
            if (!isNaN(currentTargetIdx) && currentTargetIdx >= 0 && currentTargetIdx < busInfo.routeShape.length) {
                if (busInfo.routeShape[currentTargetIdx]) {
                    busInfo.marker.setLatLng(L.latLng(busInfo.routeShape[currentTargetIdx].lat, busInfo.routeShape[currentTargetIdx].lon));
                }
            }
            return; 
        }
        
        let interpolatedShapeIndex; 
        if (prevIdx === currentTargetIdx) {
            interpolatedShapeIndex = currentTargetIdx; 
        } else {
            interpolatedShapeIndex = prevIdx + progress * (currentTargetIdx - prevIdx);
        }
        
        // Используем дробный индекс для более плавной интерполяции между точками
        const lowerIdx = Math.floor(interpolatedShapeIndex);
        const upperIdx = Math.ceil(interpolatedShapeIndex);
        const fraction = interpolatedShapeIndex - lowerIdx;
        
        if (lowerIdx >= 0 && lowerIdx < busInfo.routeShape.length && upperIdx < busInfo.routeShape.length) {
            let newLatLng;
            
            if (lowerIdx === upperIdx || fraction === 0) {
                // Находимся точно на точке
                newLatLng = L.latLng(busInfo.routeShape[lowerIdx].lat, busInfo.routeShape[lowerIdx].lon);
            } else {
                // Интерполируем между двумя точками для очень плавного движения
                const lowerPoint = busInfo.routeShape[lowerIdx];
                const upperPoint = busInfo.routeShape[upperIdx];
                
                const lat = lowerPoint.lat + (upperPoint.lat - lowerPoint.lat) * fraction;
                const lon = lowerPoint.lon + (upperPoint.lon - lowerPoint.lon) * fraction;
                
                newLatLng = L.latLng(lat, lon);
            }
            
            if (!busInfo.marker.getLatLng().equals(newLatLng, 0.000001)) { 
                busInfo.marker.setLatLng(newLatLng); 
            }
        }
    });
}

function startSmoothBusAnimationLoop() {
    if (smoothAnimationRequestId) cancelAnimationFrame(smoothAnimationRequestId);
    function loop() { animateBusesSmoothly(); smoothAnimationRequestId = requestAnimationFrame(loop); }
    smoothAnimationRequestId = requestAnimationFrame(loop);
}