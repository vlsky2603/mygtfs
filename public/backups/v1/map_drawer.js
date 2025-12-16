// ===================================================================
//     map_drawer.js - Отрисовка на карте (v11.2 - Bugfix)
// ===================================================================

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe).replace(/[&<>'"]/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c];
    });
}

const userLocationIcon = L.divIcon({
    className: 'user-location-marker-wrapper',
    html: '<div class="user-location-marker"><div class="user-dot"></div></div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

function refreshMarkers(currentMapCenter) {
    if (!map) return;
    currentMapCenter = currentMapCenter || map.getCenter();
    
    // Handle radius circle visibility
    if (radiusCircle) {
        if (filters.route || isLiveBusViewActive || document.body.classList.contains('search-results-active')) {
            radiusCircle.setStyle({ opacity: 0, fillOpacity: 0 });
        } else {
            radiusCircle.setStyle({ opacity: 1, fillOpacity: 0.05 });
        }
    }

    // Don't refresh markers if we are in a specific mode (Route Filter, Live Bus, or Trip Planner)
    if (!allLocalStops?.length || filters.route || isLiveBusViewActive || document.body.classList.contains('search-results-active')) {
        markerClusterGroup.clearLayers(); // Ensure they are cleared
        return;
    }

    markerClusterGroup.clearLayers();

    if (centerMarker) centerMarker.setOpacity(1);

    const centerLatLng = L.latLng(currentMapCenter.lat, currentMapCenter.lng);
    allLocalStops.forEach(stop => {
        if (typeof stop.stop_lat !== 'number' || typeof stop.stop_lon !== 'number' || isNaN(stop.stop_lat) || isNaN(stop.stop_lon)) {
             return;
        }
        try {
            if (centerLatLng.distanceTo(L.latLng(stop.stop_lat, stop.stop_lon)) <= FIXED_RADIUS) {
                let passesFilters = true;
                if (filters.direction) {
                    const nameLower = (stop.stop_name || "").toLowerCase();
                    const dirLower = filters.direction.toLowerCase();
                    const dirPatterns = {"northbound": ["northbound", "nb"], "southbound": ["southbound", "sb"], "eastbound": ["eastbound", "eb"], "westbound": ["westbound", "wb"]};
                    if (!(dirPatterns[dirLower]?.some(p => nameLower.includes(p)))) passesFilters = false;
                }
                if (passesFilters && filters.street && !(stop.stop_name || "").toLowerCase().includes(filters.street)) passesFilters = false;
                if (passesFilters) markerClusterGroup.addLayer(createStopMarker(stop));
            }
        } catch (e) {
            console.error("Error processing stop for marker:", stop, e);
        }
    });
}

// Show or hide tooltip content depending on zoom
function updateTooltipsForZoom() {
    if (!map) return;
    const zoom = map.getZoom();
    markerClusterGroup.eachLayer(layer => {
        if (layer.getTooltip) {
            if (zoom >= 17) layer.openTooltip(); else layer.closeTooltip();
        }
    });
}

map?.on?.('zoomend', () => updateTooltipsForZoom());

function createStopMarker(stop, isLiveOrigin = false) {
    const isFav = isFavorite(stop.stop_id);
    const favoriteClass = isFav ? 'favorite-stop-on-map' : '';
    const liveOriginClass = isLiveOrigin ? 'live-origin-stop-marker' : '';

    // Яркий заметный пин в стиле Moovit/Momego
    const markerHTML = `
        <div class="stop-pin ${favoriteClass} ${liveOriginClass}" data-stop-id="${stop.stop_id}" title="${escapeHtml(stop.stop_name || '')}">
            <div class="stop-dot">${isFav ? '★' : ''}</div>
        </div>
    `;

    const marker = L.marker([stop.stop_lat, stop.stop_lon], {
        icon: L.divIcon({
            html: markerHTML,
            className: 'stop-marker-wrapper',
            iconSize: [44, 44],
            iconAnchor: [22, 44]
        }),
        interactive: !isLiveOrigin,
        zIndexOffset: isLiveOrigin ? 1000 : (isFav ? 10 : 0)
    });

    if (!isLiveOrigin) {
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (window.showSchedulePanel) {
                window.showSchedulePanel(stop);
            }
        });
        // Tooltip shown on hover; permanent label at high zoom
        marker.bindTooltip(stop.stop_name || `Stop ${stop.stop_id}`, { direction: 'top', offset: [0, -18], className: 'stop-tooltip', sticky: true });
    }
    return marker;
}

function createRoutePlannerMarker(lat, lon, type) {
    const className = type === 'start' ? 'route-planner-start' : 'route-planner-end';
    const markerHTML = `<div class="route-planner-dot ${className}"></div>`;
    return L.marker([lat, lon], {
        icon: L.divIcon({
            html: markerHTML,
            className: 'stop-marker-wrapper',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        }),
        interactive: false,
        keyboard: false
    });
}

function clearPreviousRouteDrawing() {
    if (currentRoutePolyline) {
        map.removeLayer(currentRoutePolyline);
        currentRoutePolyline = null;
    }
    Object.values(activeSimulatedBuses).forEach(busInfo => {
        if (busInfo.animatedPath) {
            map.removeLayer(busInfo.animatedPath);
            busInfo.animatedPath = null;
        }
    });
    liveViewSpecificShapeId = null;
}

// Показывает остановки маршрута из API когда нет локальных GTFS данных
async function showRouteStopsFromAPI(routeId) {
    showLoadingOverlay('Loading route stops from API...');
    
    try {
        const stops = await loadRouteStopsFromAPI(routeId);
        
        if (!stops || stops.length === 0) {
            console.warn(`No stops found for route ${routeId}`);
            alert(`Route ${routeId}: No data available.\n\n` +
                  `This route may be temporarily unavailable or requires updated GTFS data.\n\n` +
                  `Check console for details.`);
            hideLoadingOverlay();
            return;
        }
        
        // Отображаем остановки на карте
        routeStopMarkersLayerGroup.clearLayers();
        const elementsToFit = [];
        
        stops.forEach(apiStop => {
            const stopData = {
                stop_id: String(apiStop.key),
                stop_name: apiStop.name,
                stop_lat: apiStop.centre?.geographic?.latitude,
                stop_lon: apiStop.centre?.geographic?.longitude
            };
            
            if (stopData.stop_lat && stopData.stop_lon) {
                // Добавляем в stopDetails если еще нет
                if (!gtfsData.stopDetails[stopData.stop_id]) {
                    gtfsData.stopDetails[stopData.stop_id] = stopData;
                }
                
                const marker = createStopMarker(stopData);
                routeStopMarkersLayerGroup.addLayer(marker);
                elementsToFit.push(marker);
            }
        });
        
        if (elementsToFit.length > 0) {
            map.fitBounds(L.featureGroup(elementsToFit).getBounds().pad(0.1), {maxZoom: 16});
        }
        
        console.log(`✅ Displayed ${stops.length} stops for route ${routeId} from API`);
        
    } catch (err) {
        console.error(`Error showing route ${routeId} stops:`, err);
        alert(`Failed to load route ${routeId} data from API.`);
    } finally {
        hideLoadingOverlay();
    }
}

async function showRouteAndBuses(routeId) {
    clearPreviousRouteDrawing();
    if (isLiveBusViewActive) { 
        deactivateLiveBusView(false); 
    }
    if (radiusCircle) radiusCircle.setStyle({ opacity: 0, fillOpacity: 0 });
    if (centerMarker) centerMarker.setOpacity(0);

    // Сначала загружаем trips и shapes для этого маршрута
    showLoadingOverlay('Loading route data...');
    const loaded = await loadRouteTripsAndShapes(routeId);
    hideLoadingOverlay();

    if (!gtfsData.routes?.length || !gtfsData.routeToTrips || !gtfsData.tripToShape || !gtfsData.shapes || !gtfsData.tripToStops || !gtfsData.stopDetails) {
        console.error("showRouteAndBuses: GTFS data not fully loaded."); 
        updateResetRouteButtonVisibility();
        return;
    }
    
    const tripIdsForRoute = gtfsData.routeToTrips[routeId];
    
    // Если нет trips в локальных GTFS, загружаем остановки из API
    if (!tripIdsForRoute || tripIdsForRoute.length === 0) { 
        console.warn(`⚠️ Route ${routeId} not found in local GTFS files.`);
        console.log(`📡 Loading stops from Winnipeg Transit API...`);
        console.log(`ℹ️  Note: Route lines and bus simulation unavailable for this route.`);
        console.log(`ℹ️  To enable full functionality, update GTFS files (see UPDATE_GTFS.md)`);
        await showRouteStopsFromAPI(routeId);
        updateResetRouteButtonVisibility();
        return;
    }

    // ==========================================================
    //     ↓↓↓ ИСПРАВЛЕНИЕ: Собираем все уникальные линии (shapes) ↓↓↓
    // ==========================================================
    const uniqueShapeIds = new Set();
    tripIdsForRoute.forEach(tripId => {
        const shapeId = gtfsData.tripToShape[tripId];
        if (shapeId) {
            uniqueShapeIds.add(shapeId);
        }
    });

    const multiPolylinePoints = [];
    uniqueShapeIds.forEach(shapeId => {
        if (gtfsData.shapes[shapeId] && gtfsData.shapes[shapeId].length > 1) {
            const shapePoints = gtfsData.shapes[shapeId].map(pt => [pt.lat, pt.lon]);
            multiPolylinePoints.push(shapePoints);
        }
    });
    
    const routeColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim();
    const elementsToFit = [];

    if (multiPolylinePoints.length > 0) {
        // Leaflet автоматически создает MultiPolyline, если передать массив массивов координат
        currentRoutePolyline = L.polyline(multiPolylinePoints, { color: routeColor, weight: 4, opacity: 0.75 }).addTo(map);
        elementsToFit.push(currentRoutePolyline);
    } else {
        console.warn(`No valid shapes found for route ${routeId}`);
    }
    // ==========================================================
    //     ↑↑↑ КОНЕЦ ИСПРАВЛЕНИЯ ↑↑↑
    // ==========================================================

    const stopsOnThisRoute = new Set();
    tripIdsForRoute.forEach(tripId => {
        // Эта логика была правильной: она собирает все остановки со всех поездок
        if(gtfsData.tripToStops[tripId]) {
            gtfsData.tripToStops[tripId].forEach(st => stopsOnThisRoute.add(st.stop_id));
        }
    });

    routeStopMarkersLayerGroup.clearLayers();
    stopsOnThisRoute.forEach(stopId => {
        const stopData = gtfsData.stopDetails[stopId];
        if (stopData) {
            let passesFilters = true;
            if (filters.direction) {
                const nameLower = (stopData.stop_name || "").toLowerCase();
                const dirLower = filters.direction.toLowerCase();
                const dirPatterns = {"northbound": ["northbound", "nb"], "southbound": ["southbound", "sb"], "eastbound": ["eastbound", "eb"], "westbound": ["westbound", "wb"]};
                if (!(dirPatterns[dirLower]?.some(p => nameLower.includes(p)))) passesFilters = false;
            }
            if (passesFilters && filters.street && !(stopData.stop_name || "").toLowerCase().includes(filters.street)) passesFilters = false;
            if (passesFilters) { 
                const marker = createStopMarker(stopData); 
                routeStopMarkersLayerGroup.addLayer(marker); 
                elementsToFit.push(marker); 
            }
        }
    });

    if (elementsToFit.length > 0) {
        map.fitBounds(L.featureGroup(elementsToFit).getBounds().pad(0.1), {maxZoom: 16});
    } else if (currentRoutePolyline) {
        map.fitBounds(currentRoutePolyline.getBounds().pad(0.1), {maxZoom: 16});
    }

    updateResetRouteButtonVisibility();
}