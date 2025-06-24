// ===================================================================
//     gtfs_handler.js - Обработчик данных GTFS
// ===================================================================

import { gtfsTimeToSeconds } from './utils.js';
import { 
  populateRouteFilter, 
  populateStreetFilter, 
  populateRoutePlannerStops,
  showLoadingOverlay,
  hideLoadingOverlay
} from './ui_controller.js';
import { loadFavorites } from './favorites_manager.js';
import { loadRegularNotificationRules, startRuleMonitor, regularNotificationRules } from './notifications_manager.js';
import { refreshMarkers, map } from './map_drawer.js';

export let gtfsData = {
  routes:[], trips:[], shapes:{}, stopTimes:[],
  routeToTrips:{}, tripToShape:{}, tripToStops:{}, stopDetails:{}, stopToTrips:{}
};
export let allLocalStops = [];

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

export async function loadAndProcessGTFS() {
  gtfsData.stopDetails = {}; 
  allLocalStops = []; 

  try {
        showLoadingOverlay("Loading transit data...");
        const stopsRes = await fetch('./gtfs/stops.txt');
        if (!stopsRes.ok) throw new Error('stops.txt fetch failed with status: ' + stopsRes.status);
        const stopsText = await stopsRes.text();
        const parsedStopsFromTxt = parseCSV(stopsText, ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], 'stops.txt');
            
        if (parsedStopsFromTxt.length > 0) {
            allLocalStops = parsedStopsFromTxt.map(stop => ({ 
                ...stop,
                stop_lat: parseFloat(stop.stop_lat),
                stop_lon: parseFloat(stop.stop_lon)
            }));
        } else {
            throw new Error('stops.txt parsing resulted in empty data.');
        }

        allLocalStops.forEach(s => { gtfsData.stopDetails[s.stop_id] = s; });
        
        showLoadingOverlay("Loading additional data...");

        const [routesRes, tripsRes, shapesRes, stopTimesRes] = await Promise.all([
            fetch('./gtfs/routes.txt'), fetch('./gtfs/trips.txt'), fetch('./gtfs/shapes.txt'),
            fetch('./gtfs/stop_times.txt') 
        ]);

        if (!routesRes.ok) throw new Error('routes.txt fetch failed');
        gtfsData.routes = parseCSV(await routesRes.text(), ['route_id', 'route_short_name', 'route_long_name'], 'routes.txt');
        
        if (!tripsRes.ok) throw new Error('trips.txt fetch failed');
        gtfsData.trips = parseCSV(await tripsRes.text(), ['route_id', 'trip_id', 'shape_id', 'direction_id', 'trip_headsign'], 'trips.txt');
        
        gtfsData.routeToTrips = {}; 
        gtfsData.tripToShape = {};
        gtfsData.trips.forEach(trip => {
            if (!gtfsData.routeToTrips[trip.route_id]) gtfsData.routeToTrips[trip.route_id] = [];
            gtfsData.routeToTrips[trip.route_id].push(trip.trip_id);
            if (trip.shape_id?.trim()) gtfsData.tripToShape[trip.trip_id] = trip.shape_id;
        });

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
        console.error("GTFS Load/Process Error:", error);
        showLoadingOverlay(`Data loading error: ${error.message}. Please refresh the page.`);
    }
}