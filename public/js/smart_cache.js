// ===================================================================
//     smart_cache.js - Умное кэширование данных из Winnipeg Transit API
// ===================================================================

const SmartCache = {
    // Ключи для localStorage
    CACHE_KEYS: {
        STOPS: 'wtransit_stops_cache',
        ROUTES: 'wtransit_routes_cache',
        ROUTE_DETAILS: 'wtransit_route_details_cache',
        STOP_AREAS: 'wtransit_stop_areas_cache', // Какие области уже загружены
        CACHE_META: 'wtransit_cache_meta'
    },
    
    // Время жизни кэша
    CACHE_TTL: {
        STOPS: 7 * 24 * 60 * 60 * 1000, // 7 дней (остановки редко меняются)
        ROUTES: 24 * 60 * 60 * 1000, // 1 день (маршруты меняются редко)
        ROUTE_DETAILS: 24 * 60 * 60 * 1000, // 1 день
        SCHEDULES: 0 // Расписания НЕ кэшируем (всегда актуальные)
    },
    
    // Инициализация кэша
    init() {
        if (!this.getMeta()) {
            this.setMeta({
                version: '1.0',
                created: Date.now(),
                lastUpdated: Date.now()
            });
        }
    },
    
    // Работа с метаданными
    getMeta() {
        try {
            const meta = localStorage.getItem(this.CACHE_KEYS.CACHE_META);
            return meta ? JSON.parse(meta) : null;
        } catch (e) {
            return null;
        }
    },
    
    setMeta(meta) {
        try {
            localStorage.setItem(this.CACHE_KEYS.CACHE_META, JSON.stringify({
                ...meta,
                lastUpdated: Date.now()
            }));
        } catch (e) {
            console.error('Failed to save cache meta:', e);
        }
    },
    
    // === ОСТАНОВКИ ===
    
    // Получить все кэшированные остановки
    getStops() {
        try {
            const cached = localStorage.getItem(this.CACHE_KEYS.STOPS);
            if (!cached) return [];
            
            const data = JSON.parse(cached);
            if (Date.now() - data.timestamp > this.CACHE_TTL.STOPS) {
                // Кэш устарел
                return [];
            }
            return data.stops || [];
        } catch (e) {
            console.error('Failed to get cached stops:', e);
            return [];
        }
    },
    
    // Добавить остановки в кэш (merge с существующими)
    addStops(newStops) {
        try {
            const existing = this.getStops();
            const stopMap = new Map();
            
            // Добавляем существующие
            existing.forEach(stop => stopMap.set(stop.key || stop.stop_id, stop));
            
            // Добавляем новые (перезаписываем если есть)
            newStops.forEach(stop => stopMap.set(stop.key || stop.stop_id, stop));
            
            const allStops = Array.from(stopMap.values());
            
            localStorage.setItem(this.CACHE_KEYS.STOPS, JSON.stringify({
                timestamp: Date.now(),
                stops: allStops,
                count: allStops.length
            }));
            
            console.log(`📦 Cached ${allStops.length} total stops (added ${newStops.length} new)`);
            return allStops;
        } catch (e) {
            console.error('Failed to cache stops:', e);
            // Если localStorage переполнен, очищаем старый кэш
            if (e.name === 'QuotaExceededError') {
                this.clearOldCache();
            }
            return [];
        }
    },
    
    // Проверить, загружена ли область
    isAreaLoaded(lat, lon, radius) {
        try {
            const areas = localStorage.getItem(this.CACHE_KEYS.STOP_AREAS);
            if (!areas) return false;
            
            const data = JSON.parse(areas);
            if (Date.now() - data.timestamp > this.CACHE_TTL.STOPS) return false;
            
            // Проверяем, есть ли область в пределах ±radius от центра
            return data.areas.some(area => {
                const distance = this.getDistance(lat, lon, area.lat, area.lon);
                return distance <= radius;
            });
        } catch (e) {
            return false;
        }
    },
    
    // Отметить область как загруженную
    markAreaLoaded(lat, lon, radius) {
        try {
            let data = { timestamp: Date.now(), areas: [] };
            const cached = localStorage.getItem(this.CACHE_KEYS.STOP_AREAS);
            
            if (cached) {
                data = JSON.parse(cached);
                if (Date.now() - data.timestamp > this.CACHE_TTL.STOPS) {
                    data.areas = []; // Сбросить если устарело
                }
            }
            
            data.areas.push({ lat, lon, radius, timestamp: Date.now() });
            data.timestamp = Date.now();
            
            localStorage.setItem(this.CACHE_KEYS.STOP_AREAS, JSON.stringify(data));
        } catch (e) {
            console.error('Failed to mark area loaded:', e);
        }
    },
    
    // === МАРШРУТЫ ===
    
    // Получить все кэшированные маршруты
    getRoutes() {
        try {
            const cached = localStorage.getItem(this.CACHE_KEYS.ROUTES);
            if (!cached) return null;
            
            const data = JSON.parse(cached);
            if (Date.now() - data.timestamp > this.CACHE_TTL.ROUTES) {
                return null;
            }
            return data.routes;
        } catch (e) {
            return null;
        }
    },
    
    // Сохранить маршруты
    saveRoutes(routes) {
        try {
            localStorage.setItem(this.CACHE_KEYS.ROUTES, JSON.stringify({
                timestamp: Date.now(),
                routes: routes,
                count: routes.length
            }));
            console.log(`📦 Cached ${routes.length} routes`);
        } catch (e) {
            console.error('Failed to cache routes:', e);
            if (e.name === 'QuotaExceededError') {
                this.clearOldCache();
            }
        }
    },
    
    // === ДЕТАЛИ МАРШРУТА ===
    
    // Получить детали маршрута
    getRouteDetails(routeNumber) {
        try {
            const cached = localStorage.getItem(this.CACHE_KEYS.ROUTE_DETAILS);
            if (!cached) return null;
            
            const data = JSON.parse(cached);
            const route = data.routes?.[routeNumber];
            
            if (!route) return null;
            if (Date.now() - route.timestamp > this.CACHE_TTL.ROUTE_DETAILS) {
                return null;
            }
            
            return route.data;
        } catch (e) {
            return null;
        }
    },
    
    // Сохранить детали маршрута
    saveRouteDetails(routeNumber, details) {
        try {
            let data = { routes: {} };
            const cached = localStorage.getItem(this.CACHE_KEYS.ROUTE_DETAILS);
            
            if (cached) {
                data = JSON.parse(cached);
            }
            
            data.routes[routeNumber] = {
                timestamp: Date.now(),
                data: details
            };
            
            localStorage.setItem(this.CACHE_KEYS.ROUTE_DETAILS, JSON.stringify(data));
            console.log(`📦 Cached route details for ${routeNumber}`);
        } catch (e) {
            console.error('Failed to cache route details:', e);
            if (e.name === 'QuotaExceededError') {
                this.clearOldCache();
            }
        }
    },
    
    // === УТИЛИТЫ ===
    
    // Расстояние между двумя точками (метры)
    getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Радиус Земли в метрах
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },
    
    // Очистка старого кэша при переполнении
    clearOldCache() {
        console.warn('📦 localStorage full, clearing old cache...');
        try {
            // Удаляем детали маршрутов (самое тяжелое)
            localStorage.removeItem(this.CACHE_KEYS.ROUTE_DETAILS);
            // Удаляем области
            localStorage.removeItem(this.CACHE_KEYS.STOP_AREAS);
        } catch (e) {
            console.error('Failed to clear cache:', e);
        }
    },
    
    // Полная очистка кэша
    clearAll() {
        Object.values(this.CACHE_KEYS).forEach(key => {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.error(`Failed to remove ${key}:`, e);
            }
        });
        console.log('📦 Cache cleared');
    },
    
    // Статистика кэша
    getStats() {
        const stops = this.getStops();
        const routes = this.getRoutes();
        
        return {
            stops: stops.length,
            routes: routes ? routes.length : 0,
            meta: this.getMeta()
        };
    }
};

// Инициализация при загрузке
SmartCache.init();
