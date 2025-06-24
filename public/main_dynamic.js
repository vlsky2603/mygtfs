// ===================================================================
//   main_dynamic.js — точка входа, собирает все модули вместе (v13.0 - CLEAN)
// ===================================================================
// - Весь дублирующий код перенесен в соответствующие модули
// - Убраны все заглушки и повторные объявления
// - Оставлена только координация между модулями
// ===================================================================

import { 
  initMap, 
  locateUser, 
  refreshMarkers,
  map,
  updateMapTheme
} from './js/map_drawer.js';

import { 
  initUI,
  resetFilters,
  updateLiveActivity,
  buildRouteFromAddresses,
  onSelectRoute,
  handleResetRoute,
  showSchedulePanel,
  populateRouteFilter,
  filters,
  isLiveBusViewActive,
  currentRoutePolyline,
  updateResetRouteButtonVisibility
} from './js/ui_controller.js';

import { 
  loadAndProcessGTFS,
  allLocalStops,
  gtfsData
} from './js/gtfs_handler.js';

import { 
  loadFavorites,
  renderFavoritesPanel,
  isFavorite,
  toggleFavorite
} from './js/favorites_manager.js';

import {
  loadRegularNotificationRules,
  startRuleMonitor,
  renderRegularNotificationsPanel,
  checkScheduledNotifications,
  closeRuleEditor
} from './js/notifications_manager.js';

import { 
  startBusSimulationLoop,
  updateBusTargetPositions 
} from './js/bus_simulator.js';

// Expose global functions that need to be accessible
window.resetFilters = resetFilters;
window.updateLiveActivity = updateLiveActivity;
window.showSchedulePanel = showSchedulePanel;
window.buildRouteFromAddresses = buildRouteFromAddresses;
window.onSelectRoute = onSelectRoute;
window.handleResetRoute = handleResetRoute;
window.locateUser = locateUser;
window.refreshMarkers = refreshMarkers;
window.renderFavoritesPanel = renderFavoritesPanel;
window.closeFavoritesPanel = () => { const panel = document.getElementById('favorites-panel'); if (panel) panel.classList.remove('active'); };
window.renderRegularNotificationsPanel = renderRegularNotificationsPanel;
window.populateRouteFilter = populateRouteFilter;
window.checkScheduledNotifications = checkScheduledNotifications;
window.updateBusTargetPositions = updateBusTargetPositions;
window.isFavorite = isFavorite;
window.toggleFavorite = toggleFavorite;
window.closeRuleEditor = closeRuleEditor;

console.log('Global functions exported to window:');
console.log('window.showSchedulePanel:', typeof window.showSchedulePanel);
console.log('Functions exported successfully');

// Make map and data globally accessible
window.map = map;
window.updateMapTheme = updateMapTheme;
window.allLocalStops = allLocalStops;
window.gtfsData = gtfsData;
window.filters = filters;
window.isLiveBusViewActive = isLiveBusViewActive;
window.currentRoutePolyline = currentRoutePolyline;
window.updateResetRouteButtonVisibility = updateResetRouteButtonVisibility;

// Инициализация приложения
window.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Инициализируем карту
    await initMap();

    // 2. Настраиваем интерфейс
    initUI();

    // 3. Определяем местоположение пользователя
    locateUser();

    // 4. Загружаем и обрабатываем GTFS-данные
    await loadAndProcessGTFS();

    // 5. Загружаем избранные остановки и правила уведомлений
    loadFavorites();
    loadRegularNotificationRules();

    // 6. Запускаем мониторинг и симуляцию автобусов
    startRuleMonitor();
    startBusSimulationLoop();

    console.log('App initialized successfully');
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
});