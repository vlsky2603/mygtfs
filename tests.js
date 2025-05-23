// tests.js
QUnit.module('Helper Functions', function() {
    QUnit.test('getDistance calculates distance correctly', function(assert) {
        // Test case 1: Short distance (approx. Paris to London)
        // Eiffel Tower: 48.8584, 2.2945
        // Buckingham Palace: 51.5014, -0.1419
        // Expected distance: ~343 km (approx, use a calculator for more precision if needed)
        // Using a simpler known case for easier verification:
        // Golden Gate Bridge to Alcatraz Island (approx 2.33 km)
        // GGB: 37.8199, -122.4783
        // Alcatraz: 37.8270, -122.4230
        const dist1 = getDistance(37.8199, -122.4783, 37.8270, -122.4230);
        assert.close(dist1 / 1000, 2.33, 0.1, 'Distance between GGB and Alcatraz should be approx 2.33 km');

        // Test case 2: Zero distance
        const dist2 = getDistance(10, 20, 10, 20);
        assert.equal(dist2, 0, 'Distance between same points should be 0');

        // Test case 3: Distance across equator/prime meridian
        const dist3 = getDistance(0, 0, 10, 10);
        // Expected: approx 1569 km
        assert.close(dist3 / 1000, 1569, 10, 'Distance from (0,0) to (10,10) approx 1569 km');
    });

    QUnit.test('interpolateOnPolyline calculates position correctly', function(assert) {
        const polyline1 = [[0, 0], [0, 10]]; // Simple vertical line
        let pos = interpolateOnPolyline(polyline1, 0);
        assert.deepEqual({lat: pos.lat, lng: pos.lng}, {lat: 0, lng: 0}, 'Progress 0 should be start point');
        
        pos = interpolateOnPolyline(polyline1, 1);
        assert.deepEqual({lat: pos.lat, lng: pos.lng}, {lat: 0, lng: 10}, 'Progress 1 should be end point');
        
        pos = interpolateOnPolyline(polyline1, 0.5);
        assert.deepEqual({lat: pos.lat, lng: pos.lng}, {lat: 0, lng: 5}, 'Progress 0.5 should be midpoint');

        const polyline2 = [{lat:0, lng:0}, {lat:10, lng:0}, {lat:10, lng:10}]; // L-shape
        // Total distance: 10 (first segment) + 10 (second segment) = 20 (approx, simple lat/lon diff)
        // Actual distance using L.latLng().distanceTo() will be more accurate.
        // L.latLng(0,0).distanceTo(L.latLng(10,0)) approx 1111950 m
        // L.latLng(10,0).distanceTo(L.latLng(10,10)) approx 1105740 m
        // Total approx 2217690 m
        
        pos = interpolateOnPolyline(polyline2, 0.25); // Should be halfway along the first segment
        // First segment is approx 50% of total length (1111950 / 2217690 ~ 0.501)
        // So progress 0.25 should be halfway along first segment.
        // Expected: {lat: 5, lng: 0}
        assert.close(pos.lat, 5, 0.1, 'Progress 0.25 on L-shape (lat close to 5)');
        assert.close(pos.lng, 0, 0.1, 'Progress 0.25 on L-shape (lng close to 0)');

        pos = interpolateOnPolyline(polyline2, 0.75); // Halfway along the second segment
        // Expected: {lat: 10, lng: 5}
        assert.close(pos.lat, 10, 0.1, 'Progress 0.75 on L-shape (lat close to 10)');
        assert.close(pos.lng, 5, 0.1, 'Progress 0.75 on L-shape (lng close to 5)');

        // Edge cases
        const polylineSingle = [[10, 20]];
        pos = interpolateOnPolyline(polylineSingle, 0.5);
        assert.deepEqual({lat: pos.lat, lng: pos.lng}, {lat: 10, lng: 20}, 'Single point polyline returns the point');
        
        pos = interpolateOnPolyline(polyline1, -1); // Progress < 0
        assert.deepEqual({lat: pos.lat, lng: pos.lng}, {lat: 0, lng: 0}, 'Progress < 0 should be start point');

        pos = interpolateOnPolyline(polyline1, 2); // Progress > 1
        assert.deepEqual({lat: pos.lat, lng: pos.lng}, {lat: 0, lng: 10}, 'Progress > 1 should be end point');

        const emptyPolyline = [];
        pos = interpolateOnPolyline(emptyPolyline, 0.5);
        assert.equal(pos, null, 'Empty polyline returns null');
    });
});

QUnit.module('Caching Functions', function(hooks) {
    let originalLocalStorage;
    let mockStorage;

    hooks.beforeEach(function() {
        originalLocalStorage = window.localStorage;
        mockStorage = {};
        window.localStorage = {
            getItem: function(key) { return mockStorage[key] || null; },
            setItem: function(key, value) { mockStorage[key] = value.toString(); },
            removeItem: function(key) { delete mockStorage[key]; },
            clear: function() { mockStorage = {}; }
        };
    });

    hooks.afterEach(function() {
        window.localStorage = originalLocalStorage;
    });

    QUnit.test('saveToCache and getFromCache basic functionality', function(assert) {
        const key = 'testKey';
        const data = { message: 'Hello World' };
        
        saveToCache(key, data);
        const retrievedData = getFromCache(key);
        assert.deepEqual(retrievedData, data, 'Should retrieve the same data that was saved');
    });

    QUnit.test('getFromCache returns null for non-existent key', function(assert) {
        const retrievedData = getFromCache('nonExistentKey');
        assert.strictEqual(retrievedData, null, 'Should return null for a key not in cache');
    });

    QUnit.test('getFromCache handles expired items', function(assert) {
        const key = 'expiredKey';
        const data = { message: 'This will expire' };
        let originalDateNow = Date.now;
        
        // 1. Save data
        Date.now = function() { return 0; }; // Set time to 0
        saveToCache(key, data);
        
        // 2. Advance time past CACHE_EXPIRY_MS
        Date.now = function() { return CACHE_EXPIRY_MS + 1000; };
        
        const retrievedData = getFromCache(key);
        assert.strictEqual(retrievedData, null, 'Should return null for expired data');
        assert.strictEqual(mockStorage[key], undefined, 'Expired item should be removed from localStorage');
        
        Date.now = originalDateNow; // Restore Date.now
    });

    QUnit.test('getFromCache handles corrupted JSON', function(assert) {
        const key = 'corruptedKey';
        localStorage.setItem(key, 'this is not json');
        const retrievedData = getFromCache(key);
        assert.strictEqual(retrievedData, null, 'Should return null for corrupted data');
        assert.strictEqual(mockStorage[key], undefined, 'Corrupted item should be removed');
    });
});


QUnit.module('API Rate Limiter', function(hooks) {
    let originalDateNow;
    let currentTime;

    hooks.beforeEach(function() {
        apiRequestTimestamps = []; // Reset timestamps before each test
        originalDateNow = Date.now;
        currentTime = 10 * ONE_MINUTE_MS; // Start with a baseline current time
        Date.now = function() { return currentTime; };
    });

    hooks.afterEach(function() {
        Date.now = originalDateNow;
        apiRequestTimestamps = [];
    });

    QUnit.test('canMakeApiRequest allows requests when under limit', function(assert) {
        for (let i = 0; i < MAX_REQUESTS_PER_MINUTE - 1; i++) {
            recordApiRequest(); // Uses mocked Date.now
        }
        assert.ok(canMakeApiRequest(), 'Should allow request when under limit');
    });

    QUnit.test('canMakeApiRequest blocks requests when at limit', function(assert) {
        for (let i = 0; i < MAX_REQUESTS_PER_MINUTE; i++) {
            recordApiRequest();
        }
        assert.notOk(canMakeApiRequest(), 'Should block request when at limit');
    });

    QUnit.test('canMakeApiRequest allows requests after time passes', function(assert) {
        // Fill up to the limit
        for (let i = 0; i < MAX_REQUESTS_PER_MINUTE; i++) {
            recordApiRequest();
            currentTime += 100; // Increment time slightly for each request
        }
        assert.notOk(canMakeApiRequest(), 'Initially blocked');

        // Advance time by more than a minute
        currentTime += ONE_MINUTE_MS + 1000;
        Date.now = function() { return currentTime; }; // Update mocked Date.now

        assert.ok(canMakeApiRequest(), 'Should allow request after sufficient time has passed');
        assert.equal(apiRequestTimestamps.length, 0, 'Old timestamps should be cleared');
    });

    QUnit.test('fetchWithRateLimit works correctly', async function(assert) {
        const done = assert.async();
        let fetchCallCount = 0;
        const originalFetch = window.fetch;
        window.fetch = async function(url, options) {
            fetchCallCount++;
            return { ok: true, json: async () => ({ success: true }), text: async() => "success" };
        };

        // Allowed request
        let response = await fetchWithRateLimit('test-url1');
        assert.equal(fetchCallCount, 1, 'Fetch should be called once');
        assert.ok(response.ok, 'Response should be ok for allowed request');

        // Fill up requests to hit the limit
        apiRequestTimestamps = []; // Reset for this specific sub-test
        for (let i = 0; i < MAX_REQUESTS_PER_MINUTE; i++) {
            recordApiRequest();
        }
        
        // Blocked request
        fetchCallCount = 0; // Reset counter
        response = await fetchWithRateLimit('test-url2');
        assert.equal(fetchCallCount, 0, 'Fetch should not be called when rate limit hit');
        assert.notOk(response.ok, 'Response should not be ok for blocked request');
        assert.equal(response.status, 429, 'Response status should be 429 for blocked request');
        const jsonBody = await response.json();
        assert.equal(jsonBody.error, "Rate limit exceeded", "JSON body should indicate rate limit error");

        window.fetch = originalFetch; // Restore fetch
        done();
    });
});

QUnit.module('showSchedule Functionality', function(hooks) {
    let originalFetch;
    let mockSchedulePanel;
    let mockScheduleContent;
    let mockMapElement; // For map.classList.add

    hooks.beforeEach(function() {
        // Mock fetch
        originalFetch = window.fetch;

        // Mock DOM elements used by showSchedule
        mockScheduleContent = { innerHTML: '' };
        mockSchedulePanel = { classList: { add: sinon.spy(), remove: sinon.spy() }, querySelector: sinon.stub().returns(mockScheduleContent) };
        mockMapElement = { classList: { add: sinon.spy(), remove: sinon.spy() }};
        
        const originalGetElementById = document.getElementById;
        sinon.stub(document, 'getElementById').callsFake(function(id) {
            if (id === 'schedule-panel') return mockSchedulePanel;
            if (id === 'map') return mockMapElement; // if showSchedule directly touches map id
            // Allow other getElementById calls to pass through for QUnit or other setup needs
            return originalGetElementById.apply(document, arguments);
        });

        // Reset any global state modified by showSchedule if necessary (e.g., activeRouteData)
        activeRouteData = null;
        apiRequestTimestamps = []; // Clear rate limit timestamps
        localStorage.clear(); // Clear cache
    });

    hooks.afterEach(function() {
        window.fetch = originalFetch;
        document.getElementById.restore(); // Restore original getElementById
        sinon.restore();
    });

    const mockStop = { id: 'stop1', name: 'Test Stop' };

    QUnit.test('showSchedule displays Live Data when available and recent', async function(assert) {
        const done = assert.async();
        const now = Date.now();

        window.fetch = sinon.stub();
        // Live schedule (recent)
        window.fetch.withArgs(`${API_BASE}/api/stops/${mockStop.id}/schedule`).resolves({
            ok: true,
            json: async () => ({
                success: true,
                data: {
                    'stop-schedule': {
                        'route-schedules': [{
                            route: { number: '10' },
                            'scheduled-stops': [{ times: { arrival: { estimated: new Date(now - 10*60*1000).toISOString() } } }] // 10 mins ago
                        }]
                    }
                }
            })
        });
        // Static schedule (won't be used)
        window.fetch.withArgs(`${API_BASE}/api/gtfs/schedule/${mockStop.id}`).resolves({
            ok: true,
            json: async () => ({ success: true, staticSchedule: [{ trip_id: 'static123', arrival_time: '20:00' }] })
        });
        // Shapes (empty for this test is fine)
        window.fetch.withArgs(`${API_BASE}/api/gtfs/shapes/stop/${mockStop.id}`).resolves({
            ok: true,
            json: async () => ({ success: true, shapes: [] })
        });
        
        await showSchedule(mockStop);

        assert.ok(mockSchedulePanel.classList.add.calledWith('active'), 'Schedule panel should be active');
        assert.ok(mockScheduleContent.innerHTML.includes('<h3>Test Stop</h3>'), 'Stop name should be displayed');
        assert.ok(mockScheduleContent.innerHTML.includes('<div class="data-source-indicator">Live Data</div>'), 'Live Data indicator should be present');
        assert.ok(mockScheduleContent.innerHTML.includes('route-circle">10</span>'), 'Live route 10 should be shown');
        assert.notOk(mockScheduleContent.innerHTML.includes('Local Schedule'), 'Local Schedule indicator should NOT be present');
        done();
    });

    QUnit.test('showSchedule displays Local Schedule when live data is old', async function(assert) {
        const done = assert.async();
        const now = Date.now();
        const twoHoursAgo = new Date(now - (2 * 60 * 60 * 1000)).toISOString(); // 2 hours ago

        window.fetch = sinon.stub();
        // Live schedule (old)
        window.fetch.withArgs(`${API_BASE}/api/stops/${mockStop.id}/schedule`).resolves({
            ok: true,
            json: async () => ({
                success: true,
                data: {
                    'stop-schedule': {
                        'route-schedules': [{
                            route: { number: '10' },
                            'scheduled-stops': [{ times: { arrival: { estimated: twoHoursAgo } } }]
                        }]
                    }
                }
            })
        });
        // Static schedule (will be used)
        const staticTime = new Date(now + 10*60*1000).toLocaleTimeString(); // 10 mins in future
        window.fetch.withArgs(`${API_BASE}/api/gtfs/schedule/${mockStop.id}`).resolves({
            ok: true,
            json: async () => ({
                success: true,
                staticSchedule: [{ trip_id: 'staticXYZ', route_short_name: 'S1', arrival_time: new Date(now + 10*60*1000).toISOString() }]
            })
        });
        // Shapes
        window.fetch.withArgs(`${API_BASE}/api/gtfs/shapes/stop/${mockStop.id}`).resolves({
            ok: true,
            json: async () => ({ success: true, shapes: [] })
        });

        await showSchedule(mockStop);

        assert.ok(mockScheduleContent.innerHTML.includes('<div class="data-source-indicator">Local Schedule</div>'), 'Local Schedule indicator should be present');
        assert.ok(mockScheduleContent.innerHTML.includes('route-circle">S1</span>'), 'Static route S1 should be shown');
        assert.ok(mockScheduleContent.innerHTML.includes(staticTime), 'Static schedule time should be shown');
        assert.notOk(mockScheduleContent.innerHTML.includes('Live Data'), 'Live Data indicator should NOT be present');
        done();
    });

    QUnit.test('showSchedule displays Local Schedule when live data fails or is empty', async function(assert) {
        const done = assert.async();
        const now = Date.now();

        window.fetch = sinon.stub();
        // Live schedule (fails)
        window.fetch.withArgs(`${API_BASE}/api/stops/${mockStop.id}/schedule`).resolves({
            ok: false, // Simulate network error or API error for live data
            json: async () => ({ success: false, error: "Live data unavailable" })
        });
        // Static schedule (will be used)
        window.fetch.withArgs(`${API_BASE}/api/gtfs/schedule/${mockStop.id}`).resolves({
            ok: true,
            json: async () => ({
                success: true,
                staticSchedule: [{ trip_id: 'staticABC', route_short_name: 'S2', arrival_time: new Date(now + 20*60*1000).toISOString() }]
            })
        });
        // Shapes
        window.fetch.withArgs(`${API_BASE}/api/gtfs/shapes/stop/${mockStop.id}`).resolves({
            ok: true,
            json: async () => ({ success: true, shapes: [] })
        });

        await showSchedule(mockStop);

        assert.ok(mockScheduleContent.innerHTML.includes('<div class="data-source-indicator">Local Schedule</div>'), 'Local Schedule indicator should be present');
        assert.ok(mockScheduleContent.innerHTML.includes('route-circle">S2</span>'), 'Static route S2 should be shown');
        done();
    });
    
    QUnit.test('showSchedule displays "No schedule data available" when all sources fail or are empty', async function(assert) {
        const done = assert.async();
        window.fetch = sinon.stub();

        // All fetches return null, empty or error
        window.fetch.withArgs(`${API_BASE}/api/stops/${mockStop.id}/schedule`).resolves({ ok: true, json: async () => ({ success: false }) });
        window.fetch.withArgs(`${API_BASE}/api/gtfs/schedule/${mockStop.id}`).resolves({ ok: true, json: async () => ({ success: false }) });
        window.fetch.withArgs(`${API_BASE}/api/gtfs/shapes/stop/${mockStop.id}`).resolves({ ok: true, json: async () => ({ success: false }) });

        await showSchedule(mockStop);
        assert.ok(mockScheduleContent.innerHTML.includes('<div class="no-schedule">No schedule data available.</div>'), '"No schedule" message shown');
        done();
    });
});

// Ensure QUnit autorun is not disabled if it was somewhere else
QUnit.start();
