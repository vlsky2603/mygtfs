// ===================================================================
//     favorites_manager.js - Менеджер избранного
// ===================================================================

function loadFavorites() {
    const storedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (storedFavorites) {
        try { favorites = JSON.parse(storedFavorites); if (!Array.isArray(favorites)) favorites = []; }
        catch (e) { console.error("Error parsing favorites:", e); favorites = []; }
    } else { favorites = []; }
    renderFavoritesPanel();
}

function saveFavorites() {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    renderFavoritesPanel();
    updateFavoriteButtonInSchedulePanel();
    if (map && (markerClusterGroup.getLayers().length > 0 || routeStopMarkersLayerGroup.getLayers().length > 0)) {
        if (!isLiveBusViewActive) {
             refreshMarkers(map.getCenter());
             if (filters.route) showRouteAndBuses(filters.route);
        }
    }
}

function isFavorite(stopId) { return favorites.some(fav => String(fav.stop_id) === String(stopId)); }

function addFavorite(stopData) {
    if (!stopData || !stopData.stop_id) return;
    const stopIdStr = String(stopData.stop_id);
    if (isFavorite(stopIdStr)) return;
    const defaultName = stopData.stop_name || `Stop #${stopIdStr}`;
    const customName = prompt(`Enter a custom name for stop "${defaultName}":`, defaultName);
    favorites.push({
        stop_id: stopIdStr, custom_name: (customName?.trim() !== "") ? customName.trim() : defaultName,
        original_name: defaultName, lat: parseFloat(stopData.stop_lat), lon: parseFloat(stopData.stop_lon)
    });
    saveFavorites();
}

function removeFavorite(stopId) {
    favorites = favorites.filter(fav => fav.stop_id !== String(stopId));
    saveFavorites();
}

function editFavoriteName(stopId) {
    const favorite = favorites.find(fav => fav.stop_id === String(stopId));
    if (!favorite) return;
    const newCustomName = prompt(`Enter new name for "${favorite.custom_name}":`, favorite.custom_name);
    if (newCustomName !== null) {
        favorite.custom_name = (newCustomName.trim() !== "") ? newCustomName.trim() : favorite.original_name;
        saveFavorites();
    }
}

function renderFavoritesPanel() {
    const container = document.getElementById('favorites-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (favorites.length === 0) {
        container.innerHTML = '<p class="no-favorites" style="grid-column: 1/-1; text-align:center; color:var(--text-secondary);">No favorites yet</p>';
        return;
    }
    
    favorites.forEach(fav => {
        const item = document.createElement('div');
        item.className = 'favorite-item';
        item.innerHTML = `
            <div class="fav-icon-circle"><i class="fas fa-bus"></i></div>
            <div class="fav-label">${fav.custom_name}</div>
        `;
        
        item.addEventListener('click', () => {
            if (map && !isNaN(fav.lat) && !isNaN(fav.lon)) {
                map.setView([fav.lat, fav.lon], FAVORITE_STOP_ZOOM, { animate: true });
            }
            
            const stopDetail = allLocalStops.find(s => String(s.stop_id) === String(fav.stop_id)) || { stop_id: fav.stop_id, stop_name: fav.original_name, stop_lat: fav.lat, stop_lon: fav.lon };
            
            if (window.showStopDetails) {
                window.showStopDetails(stopDetail);
            }
        });
        
        container.appendChild(item);
    });
}
