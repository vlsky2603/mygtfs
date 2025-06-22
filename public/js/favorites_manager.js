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
    const container = document.querySelector('#favorites-panel .favorites-list-container');
    if (!container) return;
    container.innerHTML = favorites.length === 0 ? '<p class="no-favorites">No favorite stops yet.</p>' : '';
    favorites.forEach(fav => {
        const item = document.createElement('div'); item.className = 'favorite-item'; item.dataset.stopId = fav.stop_id;
        item.innerHTML = `<div class="favorite-item-info" title="Show schedule for ${fav.custom_name}"><span class="favorite-name">${fav.custom_name}</span><span class="favorite-original-name">${fav.original_name} (#${fav.stop_id})</span></div><div class="favorite-item-actions"><button class="action-edit-name" title="Edit Name"><i class="fas fa-edit"></i></button><button class="action-remove-favorite" title="Remove Favorite"><i class="fas fa-trash"></i></button></div>`;
        item.querySelector('.favorite-item-info').addEventListener('click', () => {
            if (map && !isNaN(fav.lat) && !isNaN(fav.lon)) map.setView([fav.lat, fav.lon], FAVORITE_STOP_ZOOM, { animate: true });
            setTimeout(() => {
                const stopDetail = allLocalStops.find(s => String(s.stop_id) === String(fav.stop_id)) || { stop_id: fav.stop_id, stop_name: fav.original_name, stop_lat: fav.lat, stop_lon: fav.lon };
                showSchedulePanel(stopDetail);
            }, 0);
            closeFavoritesPanel();
        });
        item.querySelector('.action-edit-name').addEventListener('click', (e) => { e.stopPropagation(); editFavoriteName(fav.stop_id); });
        item.querySelector('.action-remove-favorite').addEventListener('click', (e) => { e.stopPropagation(); if (confirm(`Remove "${fav.custom_name}"?`)) removeFavorite(fav.stop_id); });
        container.appendChild(item);
    });
}