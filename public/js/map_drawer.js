import { allLocalStops, gtfsData } from './gtfs_handler.js';
import { simulateAndShowUpcomingBusesForRoute } from './bus_simulator.js';
import { determineSimulationTimeUTC } from './utils.js';

// ===================================================================
//     map_drawer.js - Отрисовка на карте (v11.2 - Bugfix)
// ===================================================================

// Константы
const FIXED_RADIUS = 400; // Радиус в метрах для отображения остановок

export let map, markerClusterGroup, routeStopMarkersLayerGroup,
           simulatedBusesLayerGroup, mapTileLayer,
           centerMarker, radiusCircle, userLocationMarker = null;

export const userLocationIcon = L.divIcon({
  className:'user-location-marker-wrapper',
  html:'<div class="user-location-marker"><div class="user-dot"></div></div>',
  iconSize:[30,30], iconAnchor:[15,15]
});

export function initMap() {
  // Проверяем, что элемент карты существует
  const mapElement = document.getElementById('map');
  if (!mapElement) {
    throw new Error('Map element with id "map" not found');
  }
  
  // Устанавливаем начальный вид карты (центр Екатеринбурга и масштаб)
  map = L.map('map').setView([56.8431, 60.6454], 13);
  L.control.zoom({position:'topright'}).addTo(map);
  
  // Initialize map tiles based on theme
  updateMapTiles();
  
  centerMarker = L.marker(map.getCenter(), { icon: L.divIcon({ className: 'center-marker', html: '<div/>' }) }).addTo(map);
  radiusCircle = L.circle(map.getCenter(), {
    radius: FIXED_RADIUS,
    color: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(),
    fillOpacity: 0.05,
    className: 'radius-circle'
  }).addTo(map);
  markerClusterGroup = L.markerClusterGroup().addTo(map);
  routeStopMarkersLayerGroup = L.layerGroup().addTo(map);
  simulatedBusesLayerGroup = L.layerGroup().addTo(map);

  // Smoothly update marker and radius position during dragging
  map.on('move', () => {
    centerMarker.setLatLng(map.getCenter());
    radiusCircle.setLatLng(map.getCenter());
  });
  // Refresh markers after dragging ends
  map.on('moveend', () => {
    refreshMarkers();
  });
  
  // Экспортируем переменные в window для глобального доступа
  window.map = map;
  window.radiusCircle = radiusCircle;
  window.centerMarker = centerMarker;
  window.markerClusterGroup = markerClusterGroup;
  window.routeStopMarkersLayerGroup = routeStopMarkersLayerGroup;
  window.simulatedBusesLayerGroup = simulatedBusesLayerGroup;
}

function updateMapTiles() {
  // Remove existing tile layer
  if (mapTileLayer) {
    map.removeLayer(mapTileLayer);
  }
  
  // Always use dark theme since we removed light theme
  // Dark theme - use CartoDB Dark Matter
  mapTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors, © CartoDB',
    subdomains: 'abcd',
    maxZoom: 19
  });
  
  mapTileLayer.addTo(map);
}

// Export function to update map theme
export function updateMapTheme() {
  if (map && mapTileLayer) {
    updateMapTiles();
  }
}

export function locateUser() {
  if (!navigator.geolocation) { alert('No Geo'); return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    const c=[pos.coords.latitude,pos.coords.longitude];
    if (!userLocationMarker) {
      userLocationMarker = L.marker(c,{icon:userLocationIcon}).addTo(map);
    } else userLocationMarker.setLatLng(c);
    map.setView(c,17);
  });
}

export function refreshMarkers(currentMapCenter) {
    if (!map) return;
    currentMapCenter = currentMapCenter || map.getCenter();
    markerClusterGroup.clearLayers();
    
    // Получаем значения из глобальных переменных
    const filters = window.filters || {};
    const isLiveBusViewActive = window.isLiveBusViewActive || false;
    
    console.log('refreshMarkers called, isLiveBusViewActive:', isLiveBusViewActive);
    
    if (!allLocalStops?.length || filters.route || isLiveBusViewActive) {
        // Если live view активен, НЕ показываем радиус
        if (isLiveBusViewActive) {
            console.log('Live view active - keeping radius hidden');
            if (radiusCircle) radiusCircle.setStyle({ opacity: 0, fillOpacity: 0 });
            if (centerMarker) centerMarker.setOpacity(0);
        }
        return;
    }

    // Показываем радиус только если live view НЕ активен
    console.log('Live view not active - showing radius');
    if (radiusCircle) radiusCircle.setStyle({ opacity: 1, fillOpacity: 0.05 });
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

export function createStopMarker(stop, isLiveOrigin = false) {
    const isFavoriteFunc = window.isFavorite || (() => false);
    const isFav = isFavoriteFunc(stop.stop_id);
    const favoriteClass = isFav ? 'favorite-stop-on-map' : '';
    const liveOriginClass = isLiveOrigin ? 'live-origin-stop-marker' : '';

    const markerHTML = `<div class="stop-marker-dot ${favoriteClass} ${liveOriginClass}" data-stop-id="${stop.stop_id}"></div>`;

    const marker = L.marker([stop.stop_lat, stop.stop_lon], {
        icon: L.divIcon({
            html: markerHTML,
            className: 'stop-marker-wrapper',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        }),
        interactive: !isLiveOrigin,
        zIndexOffset: isLiveOrigin ? 1000 : (isFav ? 10 : 0)
    });

    if (!isLiveOrigin) {
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            const showSchedulePanelFunc = window.showSchedulePanel;
            if (showSchedulePanelFunc) {
                showSchedulePanelFunc(stop);
            } else {
                console.error('showSchedulePanel function not found in window object');
            }
        });
    }
    return marker;
}

function createRoutePlannerMarker(lat, lon, type) {
    const className = type === 'start' ? 'route-planner-start' : 'route-planner-end';
    const markerHTML = `<div class="stop-marker-dot ${className}"></div>`;
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

export function clearPreviousRouteDrawing() {
    const currentRoutePolyline = window.currentRoutePolyline;
    if (currentRoutePolyline) {
        map.removeLayer(currentRoutePolyline);
        window.currentRoutePolyline = null;
    }
    const activeSimulatedBuses = window.activeSimulatedBuses || {};
    Object.values(activeSimulatedBuses).forEach(busInfo => {
        if (busInfo.animatedPath) {
            map.removeLayer(busInfo.animatedPath);
            busInfo.animatedPath = null;
        }
    });
    // liveViewSpecificShapeId = null; // Закомментировано - переменная не определена
}

export async function showRouteAndBuses(routeId) {
    clearPreviousRouteDrawing();
    const isLiveBusViewActive = window.isLiveBusViewActive;
    if (isLiveBusViewActive) { 
        // deactivateLiveBusView(false); // Закомментировано - функция не определена
        window.isLiveBusViewActive = false;
    }
    if (radiusCircle) radiusCircle.setStyle({ opacity: 0, fillOpacity: 0 });
    if (centerMarker) centerMarker.setOpacity(0);

    if (!gtfsData.routes?.length || !gtfsData.routeToTrips || !gtfsData.tripToShape || !gtfsData.shapes || !gtfsData.tripToStops || !gtfsData.stopDetails) {
        console.error("showRouteAndBuses: GTFS data not fully loaded."); return;
    }
    const tripIdsForRoute = gtfsData.routeToTrips[routeId];
    if (!tripIdsForRoute || tripIdsForRoute.length === 0) { 
        console.warn(`No trips for route: ${routeId}`); 
        const updateResetRouteButtonVisibilityFunc = window.updateResetRouteButtonVisibility;
        if (updateResetRouteButtonVisibilityFunc) updateResetRouteButtonVisibilityFunc();
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
        const polyline = L.polyline(multiPolylinePoints, { color: routeColor, weight: 4, opacity: 0.75 }).addTo(map);
        window.currentRoutePolyline = polyline;
        elementsToFit.push(polyline);
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
    } else {
        const currentRoutePolyline = window.currentRoutePolyline;
        if (currentRoutePolyline) {
            map.fitBounds(currentRoutePolyline.getBounds().pad(0.1), {maxZoom: 16});
        }
    }

    // Запуск симуляции автобусов для маршрута
    await simulateBusesForRoute(routeId, stopsOnThisRoute);

    const updateResetRouteButtonVisibilityFunc = window.updateResetRouteButtonVisibility;
    if (updateResetRouteButtonVisibilityFunc) updateResetRouteButtonVisibilityFunc();
}

// Функция симуляции автобусов для маршрута
async function simulateBusesForRoute(routeId, stopsOnRoute) {
    if (!stopsOnRoute || stopsOnRoute.size === 0) return;

    const simulationTime = determineSimulationTimeUTC();
    
    // Берём несколько остановок на маршруте для симуляции
    const stopsArray = Array.from(stopsOnRoute).slice(0, 5); // Ограничиваем количество остановок
    
    for (const stopId of stopsArray) {
        try {
            const stopData = gtfsData?.stopDetails?.[stopId];
            if (!stopData) continue;

            // Загружаем расписание для остановки
            const now = simulationTime;
            const endTime = new Date(now.getTime() + 2 * 3600000); // +2 часа
            const url = `/api/stops/${stopId}/schedule?usage=short&start=${now.toISOString()}&end=${endTime.toISOString()}`;
            
            const response = await fetch(url);
            if (!response.ok) continue;
            
            const data = await response.json();
            const routeSchedules = data?.data?.['stop-schedule']?.['route-schedules'] || [];
            
            // Найти расписание для нашего маршрута
            const routeSchedule = routeSchedules.find(rs => String(rs.route.number) === String(routeId));
            
            if (routeSchedule) {
                // Запуск симуляции автобусов для этой остановки
                await simulateAndShowUpcomingBusesForRoute(stopData, routeSchedule, simulationTime.toISOString(), false);
            }
        } catch (error) {
            console.warn(`Failed to simulate buses for stop ${stopId}:`, error);
        }
    }
}