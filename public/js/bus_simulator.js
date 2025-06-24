// ===================================================================
//     bus_simulator.js - Симулятор движения автобусов
// ===================================================================

import { determineSimulationTimeUTC } from './utils.js';
import { gtfsData } from './gtfs_handler.js';
import { activeSimulatedBuses, isLiveBusViewActive } from './ui_controller.js';
import { map, simulatedBusesLayerGroup } from './map_drawer.js';

// Переменные для анимации
let smoothAnimationRequestId = null;

// Константы
const API_BASE = ''; // Пустая строка для локальных запросов
const FETCH_PREVIOUS_STOP_FOR_CLOSEST_BUS = true; // Включить поиск предыдущей остановки

// Вспомогательные функции
function getDirectionFromStopName(stopName) {
    if (!stopName) return null;
    const name = stopName.toLowerCase();
    if (name.includes('northbound') || name.includes(' nb ')) return 'northbound';
    if (name.includes('southbound') || name.includes(' sb ')) return 'southbound';
    if (name.includes('eastbound') || name.includes(' eb ')) return 'eastbound';
    if (name.includes('westbound') || name.includes(' wb ')) return 'westbound';
    return null;
}

function mapDirectionToGtfsId(direction, routeId) {
    // Простая заглушка - возвращаем 0 или 1
    if (direction === 'northbound' || direction === 'eastbound') return 0;
    if (direction === 'southbound' || direction === 'westbound') return 1;
    return 0;
}

function generateBusId(busData) { return `${busData.gtfsTripId}_${new Date(busData.effectiveDepartureTime).getTime()}`; }

async function fetchPreviousStopData(previousStopId, apiRouteNumber, apiVariantKeyForTarget, targetEffectiveDepartureTimeAtCurrentStop) {
    try {
        const queryEndTimeUTC = new Date(targetEffectiveDepartureTimeAtCurrentStop.getTime() - 1 * 60 * 1000); 
        const queryStartTimeUTC = new Date(queryEndTimeUTC.getTime() - 45 * 60 * 1000);
        
        const fetchUrl = `${API_BASE}/api/stops/${previousStopId}/schedule?usage=short&start=${queryStartTimeUTC.toISOString()}&end=${queryEndTimeUTC.toISOString()}`;
        const response = await fetch(fetchUrl); if (!response.ok) return null; const json = await response.json();
        const routeSchedule = json.data?.['stop-schedule']?.['route-schedules']?.find(rs => String(rs.route.number) === String(apiRouteNumber));
        if (routeSchedule?.['scheduled-stops']) {
            let latestMatchingDepartureTime = null;
            routeSchedule['scheduled-stops'].forEach(sStop => {
                if (sStop.cancelled === "true") return;
                if (sStop.variant.key === apiVariantKeyForTarget) {
                    const prevEffectiveTimeStr = sStop.times?.departure?.estimated || sStop.times?.departure?.scheduled;
                    if (prevEffectiveTimeStr) {
                        const prevEffectiveTime = new Date(prevEffectiveTimeStr); 
                        if (prevEffectiveTime.getTime() < targetEffectiveDepartureTimeAtCurrentStop.getTime()) { 
                            if (!latestMatchingDepartureTime || prevEffectiveTime.getTime() > latestMatchingDepartureTime.getTime()) {
                                latestMatchingDepartureTime = prevEffectiveTime;
                            }
                        }
                    }
                }
            }); return latestMatchingDepartureTime; 
        }
    } catch (error) { console.error(`fetchPreviousStopData Error for stop ${previousStopId}:`, error); } return null;
}

export async function simulateAndShowUpcomingBusesForRoute(currentLiveOriginStopData, routeScheduleForSelectedRoute, simulationReferenceTimeStr, isForLiveViewMode = false) {
    if (isForLiveViewMode) { 
        activeSimulatedBuses = {}; 
    } else if (simulatedBusesLayerGroup) { 
        simulatedBusesLayerGroup.clearLayers(); 
        activeSimulatedBuses = {}; 
    }
    if (!routeScheduleForSelectedRoute || !gtfsData.routes?.length) return;
    
    const simulationNowUTC = new Date(simulationReferenceTimeStr);

    const apiRouteNumber = String(routeScheduleForSelectedRoute.route.number);
    let allPotentialCandidates = []; 
    const scheduledStopsAPI = routeScheduleForSelectedRoute['scheduled-stops'] || [];

    for (const sStop of scheduledStopsAPI) {
        if (sStop.cancelled === "true") continue;

        const effectiveDepartureTimeStr = sStop.times?.departure?.estimated || sStop.times?.departure?.scheduled; 
        if (!effectiveDepartureTimeStr) continue;
        
        const effectiveDepartureTimeUTC = new Date(effectiveDepartureTimeStr); 
        const timeToArrivalAtTargetMinutes = (effectiveDepartureTimeUTC.getTime() - simulationNowUTC.getTime()) / (1000 * 60);

        if (timeToArrivalAtTargetMinutes < -10 || timeToArrivalAtTargetMinutes > 90) continue;
        
        let departureTimeAtPreviousStopUTC = null, previousStopGtfsId = null, isConfirmedEnRoute = false;
        if (FETCH_PREVIOUS_STOP_FOR_CLOSEST_BUS) {
            const gtfsRouteForPrev = gtfsData.routes.find(r => String(r.route_short_name) === apiRouteNumber);
            if (gtfsRouteForPrev) {
                const stopDirectionHint = getDirectionFromStopName(currentLiveOriginStopData.stop_name); 
                const expectedGtfsDirId = stopDirectionHint ? mapDirectionToGtfsId(stopDirectionHint, gtfsRouteForPrev.route_id) : null;
                
                const tempGtfsTrip = gtfsData.trips.find(t => 
                    t.route_id === gtfsRouteForPrev.route_id &&
                    (expectedGtfsDirId === null || String(t.direction_id) === String(expectedGtfsDirId)) && 
                    gtfsData.tripToStops[t.trip_id]?.find(st => String(st.stop_id) === String(currentLiveOriginStopData.stop_id))
                );

                if (tempGtfsTrip && gtfsData.tripToStops[tempGtfsTrip.trip_id]) {
                    const stopsOnThisGtfsTrip = gtfsData.tripToStops[tempGtfsTrip.trip_id].sort((a,b) => a.stop_sequence - b.stop_sequence);
                    const currentStopOnGtfsTrip = stopsOnThisGtfsTrip.find(st => String(st.stop_id) === String(currentLiveOriginStopData.stop_id));
                    
                    if (currentStopOnGtfsTrip) {
                        const prevStopsOnTrip = stopsOnThisGtfsTrip.filter(st => st.stop_sequence < currentStopOnGtfsTrip.stop_sequence);
                        if (prevStopsOnTrip.length > 0) {
                            const prevStopInfoOnGtfsTrip = prevStopsOnTrip[prevStopsOnTrip.length -1]; 
                            previousStopGtfsId = prevStopInfoOnGtfsTrip.stop_id; 
                            departureTimeAtPreviousStopUTC = await fetchPreviousStopData(previousStopGtfsId, apiRouteNumber, sStop.variant.key, effectiveDepartureTimeUTC); 
                            if (departureTimeAtPreviousStopUTC && simulationNowUTC.getTime() >= departureTimeAtPreviousStopUTC.getTime()) {
                                isConfirmedEnRoute = true; 
                            }
                        }
                    }
                }
            }
        } 

        allPotentialCandidates.push({ 
            sStopData: sStop, 
            effectiveDepartureTime: effectiveDepartureTimeUTC, 
            departureTimeAtPreviousStop: departureTimeAtPreviousStopUTC, 
            previousStopGtfsId,                                         
            isConfirmedEnRoute, 
            timeToArrivalAtTargetMinutes 
        });
    }

    allPotentialCandidates.sort((a, b) => (a.isConfirmedEnRoute !== b.isConfirmedEnRoute) ? (a.isConfirmedEnRoute ? -1 : 1) : (a.timeToArrivalAtTargetMinutes - b.timeToArrivalAtTargetMinutes));
    const filteredCandidates = allPotentialCandidates.filter(c => !(!c.isConfirmedEnRoute && c.timeToArrivalAtTargetMinutes > MAX_UNDETERMINED_FUTURE_ARRIVAL_MINUTES));
    const topCandidates = filteredCandidates.slice(0, NUMBER_OF_BUSES_TO_SHOW);
    if (topCandidates.length === 0) { if (isForLiveViewMode) updateResetRouteButtonVisibility(); return; }
    
    const elementsToFitInLiveView = [];
    if (liveViewOriginStopMarker) elementsToFitInLiveView.push(liveViewOriginStopMarker);

    for (const candidate of topCandidates) {
        const sStopToProcess = candidate.sStopData; 
        const busEffectiveDepartureTimeUTC = candidate.effectiveDepartureTime; 
        const gtfsRoute = gtfsData.routes.find(r => String(r.route_short_name) === apiRouteNumber); if (!gtfsRoute) continue; 
        const gtfsRouteId = gtfsRoute.route_id;
        const allTripsForRoute = gtfsData.trips.filter(t => t.route_id === gtfsRouteId); if (!allTripsForRoute.length) continue;
        
        let finalGtfsTrip = null; 
        const stopDirectionHint = getDirectionFromStopName(currentLiveOriginStopData.stop_name); 
        const expectedGtfsDirId = stopDirectionHint ? mapDirectionToGtfsId(stopDirectionHint, gtfsRouteId) : null; 
        let bestGtfsMatchScore = -1;

        for (const trip of allTripsForRoute) {
            if (!trip.shape_id) continue; 
            const stopsOnThisCandidateTrip = gtfsData.tripToStops[trip.trip_id]; 
            if (!(stopsOnThisCandidateTrip && stopsOnThisCandidateTrip.find(st => String(st.stop_id) === String(currentLiveOriginStopData.stop_id)))) continue;
            
            let currentScore = 0; 
            if (expectedGtfsDirId !== null && trip.direction_id !== undefined && trip.direction_id !== null) { 
                if (String(trip.direction_id) === String(expectedGtfsDirId)) currentScore += 2; 
            } else if (expectedGtfsDirId === null) { 
                currentScore += 0.5;
            }

            if (trip.trip_headsign && sStopToProcess.variant.name) { 
                const variantNameLower = sStopToProcess.variant.name.toLowerCase(); 
                const headsignLower = trip.trip_headsign.toLowerCase(); 
                if (variantNameLower.includes(headsignLower) || headsignLower.includes(variantNameLower) || headsignLower.startsWith(variantNameLower.split(" to ")[0]) ) currentScore += 1; 
            } else if (!trip.trip_headsign && !sStopToProcess.variant.name) currentScore +=0.5; 

            if (currentScore > bestGtfsMatchScore) { bestGtfsMatchScore = currentScore; finalGtfsTrip = trip; }
        }
        if (!finalGtfsTrip && allTripsForRoute.length > 0) { 
             finalGtfsTrip = allTripsForRoute.find(t => t.shape_id && gtfsData.tripToStops[t.trip_id]?.find(st => String(st.stop_id) === String(currentLiveOriginStopData.stop_id) && (expectedGtfsDirId === null || String(t.direction_id) === String(expectedGtfsDirId)) ));
        }
        if (!finalGtfsTrip) { console.warn("Could not find final GTFS trip for simulation. Route:", apiRouteNumber, "Stop:", currentLiveOriginStopData.stop_id, "ExpectedDir:", expectedGtfsDirId); continue; }
        
        const shapeId = finalGtfsTrip.shape_id; 
        const routeShape = gtfsData.shapes[shapeId]; 
        if (!routeShape || !routeShape.length) { console.warn(`No shape data for shape_id ${shapeId}`); continue; }

        if (isForLiveViewMode && !currentRoutePolyline && shapeId) { 
            liveViewSpecificShapeId = shapeId; 
            const shapePoints = routeShape.map(pt => [pt.lat, pt.lon]); 
            const routeColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(); 
            currentRoutePolyline = L.polyline(shapePoints, { color: routeColor, weight: 4, opacity: 0.75 }).addTo(map); 
            elementsToFitInLiveView.push(currentRoutePolyline); 
        }
        
        const stopsOnFinalTrip = gtfsData.tripToStops[finalGtfsTrip.trip_id]; 
        const stopInfoOnFinalTrip = stopsOnFinalTrip.find(st => String(st.stop_id) === String(currentLiveOriginStopData.stop_id)); 
        if (!stopInfoOnFinalTrip) continue;

        let busDataPayload = { 
            routeNumber: apiRouteNumber, 
            apiVariantKey: sStopToProcess.variant.key, 
            gtfsTripId: finalGtfsTrip.trip_id, 
            variantName: sStopToProcess.variant.name, 
            effectiveDepartureTime: busEffectiveDepartureTimeUTC, 
            sStopData: sStopToProcess, 
            destination: sStopToProcess.variant.name, 
            gtfsDirectionId: finalGtfsTrip.direction_id, 
            shapeId: shapeId, 
            targetStopData: { ...currentLiveOriginStopData }, 
            targetStopSequenceOnTrip: stopInfoOnFinalTrip.stop_sequence, 
            departureTimeAtPreviousStop: candidate.departureTimeAtPreviousStop, 
            previousStopGtfsId: candidate.previousStopGtfsId, 
            closestPointIndexOnShapeForPreviousStop: -1, 
            departureTimeAtTripStart: null,
            tripStartStopGtfsId: null,
            closestPointIndexOnShapeForTripStart: -1,
            isConfirmedEnRoute: candidate.isConfirmedEnRoute 
        };
        
        if (stopsOnFinalTrip && stopsOnFinalTrip.length > 0) {
            const firstStopOnTrip = stopsOnFinalTrip[0]; 
            busDataPayload.tripStartStopGtfsId = firstStopOnTrip.stop_id;
            const firstStopGtfsTimeStr = firstStopOnTrip.departure_time;
            const firstStopGtfsTimeSeconds = gtfsTimeToSeconds(firstStopGtfsTimeStr);
            if (firstStopGtfsTimeSeconds !== null) {
                busDataPayload.departureTimeAtTripStart = getDatetimeForGtfsTime(firstStopGtfsTimeSeconds, simulationNowUTC);
            }

            const firstStopDetail = gtfsData.stopDetails[busDataPayload.tripStartStopGtfsId];
            if (firstStopDetail && routeShape) {
                let minDistSq = Infinity;
                const firstStopLatLng = L.latLng(parseFloat(firstStopDetail.stop_lat), parseFloat(firstStopDetail.stop_lon));
                routeShape.forEach((pt, index) => {
                    const dSq = firstStopLatLng.distanceTo(L.latLng(pt.lat, pt.lon));
                    if (dSq < minDistSq) { minDistSq = dSq; busDataPayload.closestPointIndexOnShapeForTripStart = index; }
                });
            }
        }

        if (busDataPayload.departureTimeAtPreviousStop && busDataPayload.previousStopGtfsId) {
            const prevStopDetail = gtfsData.stopDetails[busDataPayload.previousStopGtfsId];
            if (prevStopDetail && routeShape) { 
                let minDistanceSqPrev = Infinity; 
                const prevStopLatLng = L.latLng(parseFloat(prevStopDetail.stop_lat), parseFloat(prevStopDetail.stop_lon)); 
                routeShape.forEach((pt, index) => { 
                    const dSq = prevStopLatLng.distanceTo(L.latLng(pt.lat, pt.lon)); 
                    if (dSq < minDistanceSqPrev) { 
                        minDistanceSqPrev = dSq; 
                        busDataPayload.closestPointIndexOnShapeForPreviousStop = index;
                    } 
                }); 
            }
        }
        const busId = generateBusId(busDataPayload); 
        setupBusForAnimation(busId, busDataPayload, routeShape, simulationNowUTC); 
        if (activeSimulatedBuses[busId] && activeSimulatedBuses[busId].marker && isForLiveViewMode) {
            elementsToFitInLiveView.push(activeSimulatedBuses[busId].marker);
        }
    }

    if (isForLiveViewMode && elementsToFitInLiveView.length > 0) {
        try { map.fitBounds(L.featureGroup(elementsToFitInLiveView).getBounds().pad(LIVE_VIEW_ZOOM_PADDING), {maxZoom: 17, animate: true}); }
        catch (e) { 
            const busMarkersOnly = elementsToFitInLiveView.filter(el => el instanceof L.Marker); 
            if (busMarkersOnly.length > 0) map.fitBounds(L.featureGroup(busMarkersOnly).getBounds().pad(LIVE_VIEW_ZOOM_PADDING + 0.1), {maxZoom: 17, animate: true}); 
            else if (currentRoutePolyline) map.fitBounds(currentRoutePolyline.getBounds().pad(LIVE_VIEW_ZOOM_PADDING), {maxZoom: 17, animate: true}); 
        }
    } 
    if (isForLiveViewMode) updateResetRouteButtonVisibility();
}

function setupBusForAnimation(busId, busData, routeShape, simulationNowUTC) { 
    const targetStopDataForThisBus = busData.targetStopData; 
    const timeToArrivalAtTargetMinutes = (busData.effectiveDepartureTime.getTime() - simulationNowUTC.getTime()) / (1000 * 60);

    if (timeToArrivalAtTargetMinutes < -10) {
        if (activeSimulatedBuses[busId]?.marker) simulatedBusesLayerGroup.removeLayer(activeSimulatedBuses[busId].marker); 
        if (activeSimulatedBuses[busId]?.animatedPath) map.removeLayer(activeSimulatedBuses[busId].animatedPath);
        delete activeSimulatedBuses[busId]; 
        return; 
    }
    
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

    let newCalculatedShapeIndex; 
    const nowMs = simulationNowUTC.getTime(); 
    const timeAtTargetMs = busData.effectiveDepartureTime.getTime(); 

    if (busData.isConfirmedEnRoute && 
        busData.departureTimeAtTripStart && 
        busData.closestPointIndexOnShapeForTripStart !== -1 &&
        busData.departureTimeAtTripStart.getTime() < timeAtTargetMs && 
        busData.closestPointIndexOnShapeForTripStart < closestPointIndexOnShapeForTargetStop) {
        
        const timeAtTripStartMs = busData.departureTimeAtTripStart.getTime(); 
        const indexAtTripStart = busData.closestPointIndexOnShapeForTripStart; 
        const indexAtTarget = closestPointIndexOnShapeForTargetStop;

        if (nowMs < timeAtTripStartMs) { 
            newCalculatedShapeIndex = indexAtTripStart;
        } else if (nowMs > timeAtTargetMs) { 
            newCalculatedShapeIndex = indexAtTarget;
        } else { 
            const segmentDurationMs = timeAtTargetMs - timeAtTripStartMs; 
            const elapsedInSegmentMs = nowMs - timeAtTripStartMs; 
            const fraction = segmentDurationMs > 0 ? Math.max(0, Math.min(1, elapsedInSegmentMs / segmentDurationMs)) : 1; 
            newCalculatedShapeIndex = Math.round(indexAtTripStart + fraction * (indexAtTarget - indexAtTripStart)); 
        }
    } 
    else {
        if (timeToArrivalAtTargetMinutes > MAX_UNDETERMINED_FUTURE_ARRIVAL_MINUTES + 5) { 
            if (busData.targetStopSequenceOnTrip <= 2 && !activeSimulatedBuses[busId]) { 
                newCalculatedShapeIndex = 0; 
            } else { 
                if (activeSimulatedBuses[busId]?.marker) simulatedBusesLayerGroup.removeLayer(activeSimulatedBuses[busId].marker);
                if (activeSimulatedBuses[busId]?.animatedPath) map.removeLayer(activeSimulatedBuses[busId].animatedPath);
                delete activeSimulatedBuses[busId];
                return; 
            }
        } else if (timeToArrivalAtTargetMinutes > 0.25) { 
            const conservativePointsPerMinute = 2.0; 
            const pointsToMoveBack = Math.floor(timeToArrivalAtTargetMinutes * conservativePointsPerMinute);
            newCalculatedShapeIndex = Math.max(0, closestPointIndexOnShapeForTargetStop - pointsToMoveBack);
        } else if (timeToArrivalAtTargetMinutes >= -5) { 
            newCalculatedShapeIndex = closestPointIndexOnShapeForTargetStop;
        } else { 
            const minutesPastTarget = Math.abs(timeToArrivalAtTargetMinutes); 
            const conservativePointsPerMinuteAfter = 1.5;
            const pointsToMoveForward = Math.floor(minutesPastTarget * conservativePointsPerMinuteAfter);
            newCalculatedShapeIndex = closestPointIndexOnShapeForTargetStop + pointsToMoveForward; 
        }
    }
    newCalculatedShapeIndex = Math.max(0, Math.min(newCalculatedShapeIndex, routeShape.length - 1));
    
    const timesForFormatting = busData.sStopData?.times?.departure || { scheduled: busData.effectiveDepartureTime.toISOString(), estimated: busData.effectiveDepartureTime.toISOString() };
    const formattedArrival = formatArrivalTime(timesForFormatting, simulationNowUTC); 
    let arrivalText = formattedArrival.text; 
    let markerClass = 'simulated-bus-marker marker-fade-in';
    if (arrivalText === 'Now') markerClass += ' bus-now'; 
    else if (formattedArrival.css.includes('soon') || formattedArrival.css.includes('critical-soon')) markerClass += ' bus-soon';

    const isAtStopPhysically = minDistanceSqToTargetStop < 100; 
    if (arrivalText === '' && !(isAtStopPhysically && timeToArrivalAtTargetMinutes >= -2 && timeToArrivalAtTargetMinutes <=2) ) { 
        if (activeSimulatedBuses[busId]?.marker) simulatedBusesLayerGroup.removeLayer(activeSimulatedBuses[busId].marker); 
        if (activeSimulatedBuses[busId]?.animatedPath) map.removeLayer(activeSimulatedBuses[busId].animatedPath);
        delete activeSimulatedBuses[busId]; 
        return; 
    }

    const busIconHtml = `<div class="bus-icon-wrapper"><i class="fas fa-bus"></i><span class="bus-route-number">${busData.routeNumber}</span></div>${arrivalText ? `<span class="bus-arrival-time">${arrivalText}</span>` : ''}`;
    const newIcon = L.divIcon({ className: markerClass, html: busIconHtml, iconSize: null, iconAnchor: [15, 15] });
    
    const currentBusPosition = routeShape[newCalculatedShapeIndex] ? L.latLng(routeShape[newCalculatedShapeIndex].lat, routeShape[newCalculatedShapeIndex].lon) : null;

    if (!currentBusPosition) { 
        if (activeSimulatedBuses[busId]?.marker) simulatedBusesLayerGroup.removeLayer(activeSimulatedBuses[busId].marker);
        if (activeSimulatedBuses[busId]?.animatedPath) map.removeLayer(activeSimulatedBuses[busId].animatedPath);
        delete activeSimulatedBuses[busId];
        return;
    }
    
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
        const busMarker = L.marker(currentBusPosition, { icon: newIcon, zIndexOffset: 1000, riseOnHover: true }).addTo(simulatedBusesLayerGroup);
        const localDepartureTime = busData.effectiveDepartureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'America/Winnipeg' }); 
        const localSimTime = simulationNowUTC.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', timeZone: 'America/Winnipeg'});
        busMarker.bindPopup(`<b>Route ${busData.routeNumber}</b> (${busData.variantName || busData.gtfsTripId})<br>Effective Depart: ${localDepartureTime}<br><small>(Sim @ ${localSimTime}, GTFS: ${busData.gtfsTripId}, Dir: ${busData.gtfsDirectionId ?? 'N/A'})</small>`);
        
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

export function updateBusTargetPositions() {
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
        interpolatedShapeIndex = Math.round(Math.max(0, Math.min(interpolatedShapeIndex, busInfo.routeShape.length - 1)));
        
        if (busInfo.routeShape[interpolatedShapeIndex]) { 
            const newLatLng = L.latLng(busInfo.routeShape[interpolatedShapeIndex].lat, busInfo.routeShape[interpolatedShapeIndex].lon); 
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

export function startBusSimulationLoop() {
    // Запускаем цикл симуляции автобусов
    console.log('Bus simulation loop started');
    startSmoothBusAnimationLoop();
    
    // Периодически обновляем позиции автобусов
    setInterval(() => {
        updateBusTargetPositions();
    }, 10000); // каждые 10 секунд
}