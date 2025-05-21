// proxy.js (patched to serve front-end files and keep APIs)
const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const fetch      = require('node-fetch').default;
const cors       = require('cors');
const NodeCache  = require('node-cache');
const { CronJob }= require('cron');
const csvParser  = require('csv-parser');

const app        = express();
const port       = 8080;
const API_KEY    = 'H_CGXaUefWeHpp0hgndA';
const cache      = new NodeCache({ stdTTL: 0, checkperiod: 600 });
const DATA_PATH  = path.join(__dirname, 'stops.json');

let stopsData = { lastUpdated: null, stops: [] };
loadData();

function loadData() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      fs.writeFileSync(DATA_PATH, JSON.stringify({ lastUpdated: null, stops: [] }), 'utf8');
    }
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    stopsData = JSON.parse(raw);
  } catch (e) {
    console.error('Error loading stops.json:', e.message);
  }
}

function saveData(data) {
  try {
    const toSave = { lastUpdated: new Date().toISOString(), stops: data };
    fs.writeFileSync(DATA_PATH, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing stops.json:', e.message);
  }
}

function isUpdatedToday() {
  return stopsData.lastUpdated && new Date(stopsData.lastUpdated).toDateString() === new Date().toDateString();
}

// Serve front-end static files
app.use(express.static(path.join(__dirname)));

app.use(cors());
app.use(express.json());
app.use('/gtfs', express.static(path.join(__dirname, 'gtfs')));

// Dynamic stops via API
app.get('/api/stops/nearby', (req, res) => {
  // existing handler for nearby stops
});

// Dynamic schedule via API
app.get('/api/stops/:stopId/schedule', (req, res) => {
  // existing handler for live schedule
});

// Static GTFS schedule
app.get('/api/gtfs/schedule/:stopId', (req, res) => {
  const stopId = req.params.stopId;
  const results = [];
  fs.createReadStream(path.join(__dirname, 'gtfs', 'stop_times.txt'))
    .pipe(csvParser())
    .on('data', row => {
      if (row.stop_id === stopId) results.push(row);
    })
    .on('end', () => res.json({ success: true, staticSchedule: results }))
    .on('error', err => res.status(500).json({ success: false, error: err.message }));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  if (!isUpdatedToday()) {
    updateAllStopsData();
  }
});
