// ===================================================================
//     api_data_loader.js - Загрузчик данных из Winnipeg Transit API
// ===================================================================

// Функция парсинга CSV (копия из gtfs_handler.js для независимости)
function parseCSV(csvText, requiredFields = [], fileNameForLogging = "CSV file") {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    for (const reqField of requiredFields) {
        if (!headers.includes(reqField.toLowerCase())) {
            console.warn(`parseCSV (${fileNameForLogging}): Missing required field "${reqField}" in headers: [${headers.join(', ')}].`);
        }
    }
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((header, i) => {
            let value = values[i]?.trim() || '';
            if (['shape_pt_lat', 'shape_pt_lon', 'stop_lat', 'stop_lon'].includes(header)) {
                 value = parseFloat(value);
            } else if (['shape_pt_sequence', 'stop_sequence', 'direction_id'].includes(header) || header.endsWith('_type')) {
                 value = value !== '' ? parseInt(value, 10) : null;
            }
            obj[header] = value;
        });
        return obj;
    }).filter(obj => requiredFields.every(rf => obj[rf.toLowerCase()] !== undefined && obj[rf.toLowerCase()] !== null && obj[rf.toLowerCase()] !== ''));
}

async function loadAndProcessFromAPI() {
    gtfsData.stopDetails = {}; 
    allLocalStops = []; 

    try {
        showLoadingOverlay("Loading transit data...");
        
        // === 1. МАРШРУТЫ - загружаем из GTFS routes.txt ===
        console.log('Loading routes from GTFS...');
        
        const routesRes = await fetch('/gtfs/routes.txt');
        if (!routesRes.ok) throw new Error('Failed to load routes.txt');
        
        const routesTxt = await routesRes.text();
        const lines = routesTxt.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',');
        
        gtfsData.routes = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            if (values.length < headers.length) continue;
            
            const route = {};
            headers.forEach((header, idx) => {
                route[header.trim()] = values[idx]?.trim() || '';
            });
            
            gtfsData.routes.push({
                route_id: route.route_id,
                route_short_name: route.route_short_name,
                route_long_name: route.route_long_name,
                route_type: route.route_type,
                route_color: route.route_color || 'FFFFFF',
                route_text_color: route.route_text_color || '000000'
            });
        }
        
        console.log(`✅ Loaded ${gtfsData.routes.length} routes from GTFS`);
        
        // === 2. ОСТАНОВКИ - загружаем из GTFS stops.json ===
        console.log('Loading stops from GTFS...');
        
        try {
            const stopsRes = await fetch('/gtfs/stops.json');
            if (stopsRes.ok) {
                const stopsData = await stopsRes.json();
                
                // stops.json имеет структуру { lastUpdated: ..., stops: [...] }
                const stopsArray = stopsData.stops || stopsData;
                
                if (!Array.isArray(stopsArray)) {
                    throw new Error('stops.json does not contain array');
                }
                
                allLocalStops = stopsArray.map(stop => ({
                    stop_id: String(stop.stop_id),
                    stop_name: stop.stop_name || `Stop ${stop.stop_id}`,
                    stop_lat: parseFloat(stop.stop_lat),
                    stop_lon: parseFloat(stop.stop_lon),
                    stop_code: String(stop.stop_code || stop.stop_id),
                    street_name: stop.street_name || '',
                    cross_street_name: stop.cross_street_name || '',
                    direction: stop.direction || ''
                }));
                
                allLocalStops.forEach(s => { gtfsData.stopDetails[s.stop_id] = s; });
                console.log(`✅ Loaded ${allLocalStops.length} stops from GTFS`);
            } else {
                throw new Error('Failed to load stops.json');
            }
        } catch (err) {
            console.error('Error loading GTFS stops:', err);
            // Fallback на stops.txt если stops.json недоступен
            const stopsTxtRes = await fetch('/gtfs/stops.txt');
            const stopsTxt = await stopsTxtRes.text();
            const lines = stopsTxt.split('\n');
            const headers = lines[0].split(',');
            
            allLocalStops = lines.slice(1)
                .filter(line => line.trim())
                .map(line => {
                    const values = line.split(',');
                    const stop = {};
                    headers.forEach((header, i) => {
                        stop[header.trim()] = values[i]?.trim() || '';
                    });
                    return {
                        stop_id: String(stop.stop_id),
                        stop_name: stop.stop_name || `Stop ${stop.stop_id}`,
                        stop_lat: parseFloat(stop.stop_lat),
                        stop_lon: parseFloat(stop.stop_lon),
                        stop_code: String(stop.stop_code || stop.stop_id),
                        street_name: '',
                        cross_street_name: '',
                        direction: ''
                    };
                });
            
            allLocalStops.forEach(s => { gtfsData.stopDetails[s.stop_id] = s; });
            console.log(`✅ Loaded ${allLocalStops.length} stops from stops.txt`);
        }
        
        // === 3. TRIPS И SHAPES загружаются по требованию через loadRouteTripsAndShapes() ===
        // Это оптимизирует начальную загрузку - trips/shapes загружаются только при выборе маршрута
        console.log('✅ Route data will be loaded on-demand when route is selected');
        
        // ВАЖНО: Расписания всегда получаем из API в реальном времени через showSchedulePanel()
        
        populateRouteFilter(); 
        loadFavorites();
        loadRegularNotificationRules(); 
        if (regularNotificationRules.some(rule => rule.isEnabled)) {
            startRuleMonitor();
        }
        populateStreetFilter();
        populateRoutePlannerStops();
        refreshMarkers(map.getCenter());
        hideLoadingOverlay();
        
    } catch (error) {
        console.error("API Load/Process Error:", error);
        showLoadingOverlay(`API error: ${error.message}. Using local GTFS data...`);
        
        // Fallback на локальные данные если API не работает
        setTimeout(() => {
            loadAndProcessGTFS();
        }, 2000);
    }
}

// === ЗАГРУЗКА ДЕТАЛЕЙ МАРШРУТА ПО ТРЕБОВАНИЮ ===
async function loadRouteDetailsFromAPI(routeNumber) {
    // Проверяем кэш
    let routeDetails = SmartCache.getRouteDetails(routeNumber);
    
    if (routeDetails) {
        console.log(`📦 Loaded route ${routeNumber} details from cache`);
        return routeDetails;
    }
    
    // Загружаем из API
    console.log(`Fetching route ${routeNumber} details from API...`);
    
    try {
        const routeRes = await fetch(`${API_BASE}/api/routes/${routeNumber}`);
        if (!routeRes.ok) {
            throw new Error(`Failed to fetch route ${routeNumber}`);
        }
        
        const data = await routeRes.json();
        routeDetails = data.route || data;
        
        // Сохраняем в кэш
        SmartCache.saveRouteDetails(routeNumber, routeDetails);
        
        console.log(`✅ Loaded route ${routeNumber} from API`);
        return routeDetails;
        
    } catch (err) {
        console.error(`Error loading route ${routeNumber}:`, err);
        return null;
    }
}

// === ЗАГРУЗКА TRIPS И SHAPES ДЛЯ МАРШРУТА ИЗ ЛОКАЛЬНЫХ GTFS ===
async function loadRouteTripsAndShapes(routeId) {
    console.log(`Loading trips and shapes for route ${routeId}...`);
    
    // Проверяем если уже есть trips для этого маршрута
    if (gtfsData.routeToTrips[routeId] && gtfsData.routeToTrips[routeId].length > 0) {
        console.log(`📦 Route ${routeId} trips already loaded`);
        return true;
    }
    
    try {
        // Загружаем trips и shapes из локальных GTFS если еще не загружены
        if (!gtfsData.trips || gtfsData.trips.length === 0) {
            const tripsRes = await fetch('./gtfs/trips.txt');
            if (!tripsRes.ok) throw new Error('trips.txt fetch failed');
            gtfsData.trips = parseCSV(await tripsRes.text(), ['route_id', 'trip_id', 'shape_id', 'direction_id', 'trip_headsign'], 'trips.txt');
            
            gtfsData.routeToTrips = {}; 
            gtfsData.tripToShape = {};
            gtfsData.trips.forEach(trip => {
                if (!gtfsData.routeToTrips[trip.route_id]) gtfsData.routeToTrips[trip.route_id] = [];
                gtfsData.routeToTrips[trip.route_id].push(trip.trip_id);
                if (trip.shape_id?.trim()) gtfsData.tripToShape[trip.trip_id] = trip.shape_id;
            });
            
            console.log(`✅ Loaded ${gtfsData.trips.length} trips`);
        }
        
        if (!gtfsData.shapes || Object.keys(gtfsData.shapes).length === 0) {
            const shapesRes = await fetch('./gtfs/shapes.txt');
            if (!shapesRes.ok) throw new Error('shapes.txt fetch failed');
            const shapesRaw = parseCSV(await shapesRes.text(), ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], 'shapes.txt');
            gtfsData.shapes = {}; 
            shapesRaw.forEach(shapePt => {
                if (!gtfsData.shapes[shapePt.shape_id]) gtfsData.shapes[shapePt.shape_id] = [];
                gtfsData.shapes[shapePt.shape_id].push({ 
                    lat: parseFloat(shapePt.shape_pt_lat), 
                    lon: parseFloat(shapePt.shape_pt_lon), 
                    sequence: parseInt(shapePt.shape_pt_sequence, 10) 
                });
            });
            for (const shapeId in gtfsData.shapes) gtfsData.shapes[shapeId].sort((a, b) => a.sequence - b.sequence);
            
            console.log(`✅ Loaded shapes`);
        }
        
        if (!gtfsData.stopTimes || gtfsData.stopTimes.length === 0) {
            const stopTimesRes = await fetch('./gtfs/stop_times.txt');
            if (!stopTimesRes.ok) throw new Error('stop_times.txt fetch failed');
            gtfsData.stopTimes = parseCSV(await stopTimesRes.text(), ['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'], 'stop_times.txt');

            gtfsData.tripToStops = {}; 
            gtfsData.stopTimes.forEach(st => {
                if (!gtfsData.tripToStops[st.trip_id]) gtfsData.tripToStops[st.trip_id] = [];
                gtfsData.tripToStops[st.trip_id].push({ 
                    stop_id: st.stop_id, 
                    stop_sequence: parseInt(st.stop_sequence, 10),
                    arrival_time: st.arrival_time,     
                    departure_time: st.departure_time  
                });
            });
            for (const tripId in gtfsData.tripToStops) gtfsData.tripToStops[tripId].sort((a, b) => a.stop_sequence - b.stop_sequence);

            gtfsData.stopToTrips = {};
            for (const tripId in gtfsData.tripToStops) {
                const stops = gtfsData.tripToStops[tripId];
                stops.forEach((st, idx) => {
                    if (!gtfsData.stopToTrips[st.stop_id]) gtfsData.stopToTrips[st.stop_id] = [];
                    gtfsData.stopToTrips[st.stop_id].push({ tripId, index: idx });
                });
            }
            for (const stopId in gtfsData.stopToTrips) {
                gtfsData.stopToTrips[stopId].sort((a, b) => {
                    const depA = gtfsTimeToSeconds(gtfsData.tripToStops[a.tripId][a.index].departure_time) || 0;
                    const depB = gtfsTimeToSeconds(gtfsData.tripToStops[b.tripId][b.index].departure_time) || 0;
                    return depA - depB;
                });
            }
            
            console.log(`✅ Loaded stop times`);
        }
        
        // Загружаем stopDetails если нужно
        if (!gtfsData.stopDetails || Object.keys(gtfsData.stopDetails).length === 0) {
            gtfsData.stopDetails = {};
            allLocalStops.forEach(stop => {
                gtfsData.stopDetails[stop.stop_id] = stop;
            });
        }
        
        // Загружаем stops.txt для получения координат всех остановок (в том числе тех, которых нет в stops.json)
        if (!gtfsData.allGtfsStopsLoaded) {
            try {
                const stopsRes = await fetch('./gtfs/stops.txt');
                if (stopsRes.ok) {
                    const gtfsStops = parseCSV(await stopsRes.text(), ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'stop_code'], 'stops.txt');
                    gtfsStops.forEach(stop => {
                        // Добавляем только если еще нет в stopDetails
                        if (!gtfsData.stopDetails[stop.stop_id]) {
                            gtfsData.stopDetails[stop.stop_id] = {
                                stop_id: stop.stop_id,
                                stop_name: stop.stop_name,
                                stop_lat: parseFloat(stop.stop_lat),
                                stop_lon: parseFloat(stop.stop_lon),
                                stop_code: stop.stop_code || stop.stop_id
                            };
                        }
                    });
                    console.log(`✅ Merged ${gtfsStops.length} stops from stops.txt, total stopDetails: ${Object.keys(gtfsData.stopDetails).length}`);
                    gtfsData.allGtfsStopsLoaded = true;
                }
            } catch (err) {
                console.warn('Could not load stops.txt:', err);
            }
        }
        
        return true;
        
    } catch (err) {
        console.error(`Error loading trips/shapes for route ${routeId}:`, err);
        return false;
    }
}

// === ЗАГРУЗКА ОСТАНОВОК МАРШРУТА ПО ТРЕБОВАНИЮ ===
async function loadRouteStopsFromAPI(routeNumber) {
    try {
        console.log(`Fetching stops for route ${routeNumber} from API...`);
        
        const stopsRes = await fetch(`${API_BASE}/api/routes/${routeNumber}/stops`);
        if (!stopsRes.ok) {
            throw new Error(`Failed to fetch stops for route ${routeNumber}`);
        }
        
        const data = await stopsRes.json();
        const stops = data.stops || [];
        
        // Добавляем остановки в кэш
        if (stops.length > 0) {
            SmartCache.addStops(stops);
        }
        
        console.log(`✅ Loaded ${stops.length} stops for route ${routeNumber}`);
        return stops;
        
    } catch (err) {
        console.error(`Error loading stops for route ${routeNumber}:`, err);
        return [];
    }
}
