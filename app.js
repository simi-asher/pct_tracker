// ============================================================
// PCT Hiker Tracker — app.js
// Update SHEET_JSON_URL after publishing your Google Sheet.
// ============================================================

// Published Google Sheet CSV URL
const SHEET_JSON_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRWtPeLz9bpJgvueFBKNe71UXDRWj5T5IistwuFWdIPJfflXHvlWPpl-zFRzGIBiJCaFRiGteVl30K_/pub?output=csv';

// Hiker start date (YYYY-MM-DD) — used to compute "days on trail"
const TRAIL_START_DATE = '2026-03-19';

// PCT total distance in miles
const PCT_TOTAL_MILES = 2653;

// Auto-refresh interval (ms) — 10 minutes
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

// PCT southern terminus (Campo, CA) approximate coords
const PCT_SOUTH_TERMINUS = [32.5899, -116.4758];

// PCT northern terminus (Manning Park, BC) approximate coords
const PCT_NORTH_TERMINUS = [49.0006, -120.8027];

// localStorage cache keys
const CACHE_KEY = 'pct_locations_v1';
const CACHE_TS_KEY = 'pct_locations_ts_v1';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

// State boundary miles along PCT
const CA_END_MILE = 1702;
const OR_END_MILE = 1977;

// State trail colors
const STATE_COLORS = { ca: '#e8943a', or: '#5a9e50', wa: '#4a7bc8' };

// PCT milestones for progress bar pins
const PCT_MILESTONES = [
  { label: 'Campo',        mile: 0,    emoji: '🚀', color: '#4a90d9' },
  { label: 'Yosemite',     mile: 942,  emoji: '🏔️', color: '#4a90d9' },
  { label: 'OR Border',    mile: 1702, emoji: '🌲', color: '#5a9e50' },
  { label: 'Crater Lake',  mile: 1820, emoji: '🌋', color: '#5a9e50' },
  { label: 'WA Border',    mile: 1977, emoji: '🦅', color: '#4a7bc8' },
  { label: 'Snoqualmie',   mile: 2393, emoji: '⛷️', color: '#4a7bc8' },
  { label: 'Manning Park', mile: 2653, emoji: '🏁', color: '#4a7bc8' },
];

// Loaded PCT trail coordinates ([lon, lat] GeoJSON order) — populated by loadPctRoute()
let trailCoords = null;
// Cumulative trail miles for each coord index — populated by loadPctRoute()
let trailCumulativeMiles = null;

// Find the index of the trail point closest to [lat, lon]
function findNearestTrailIndex(lat, lon) {
  if (!trailCoords) return -1;
  let minDist = Infinity, minIdx = 0;
  for (let i = 0; i < trailCoords.length; i++) {
    const d = haversineMiles([lat, lon], [trailCoords[i][1], trailCoords[i][0]]);
    if (d < minDist) { minDist = d; minIdx = i; }
  }
  return minIdx;
}

// Known PCT resupply towns — many are ON the trail so distance-to-trail
// alone can't detect them. Each entry has [lat, lon, radiusMi].
const PCT_RESUPPLY_TOWNS = [
  [32.6878, -116.5245, 1.5],  // Lake Morena (~mile 20)
  [32.8649, -116.4225, 1.5],  // Mount Laguna (~mile 42)
  [33.0786, -116.6022, 3.0],  // Julian
  [33.2787, -116.6416, 1.5],  // Warner Springs (~mile 109)
  [33.7432, -116.7190, 3.0],  // Idyllwild (~mile 179)
  [34.2590, -116.8542, 2.5],  // Big Bear City (~mile 266)
  [34.3628, -117.6315, 2.0],  // Wrightwood (~mile 369)
  [34.4917, -118.3150, 2.0],  // Agua Dulce (~mile 454)
  [35.1323, -118.4487, 4.0],  // Tehachapi (~mile 558)
  [35.9647, -118.0928, 1.5],  // Kennedy Meadows (~mile 702)
  [36.8032, -118.2005, 6.0],  // Independence (~mile 789)
  [37.3635, -118.3952, 6.0],  // Bishop (~mile 857)
  [37.6485, -118.9721, 4.0],  // Mammoth Lakes (~mile 906)
  [37.9563, -119.4703, 2.0],  // Tuolumne Meadows (~mile 942)
  [38.5954, -119.7729, 2.0],  // Bridgeport/Sonora Pass area
  [38.9357, -119.9773, 6.0],  // South Lake Tahoe (~mile 1092)
  [39.5704, -120.6363, 2.0],  // Sierra City (~mile 1195)
  [40.0012, -121.2465, 1.5],  // Belden (~mile 1284)
  [40.3049, -121.2311, 3.0],  // Chester (~mile 1331)
  [40.8827, -121.6588, 3.0],  // Burney (~mile 1414)
  [41.3099, -122.3111, 4.0],  // Mount Shasta (~mile 1501)
  [41.4571, -122.8955, 2.0],  // Etna (~mile 1577)
  [41.8425, -123.1900, 1.5],  // Seiad Valley (~mile 1647)
  [42.1946, -122.7095, 4.0],  // Ashland OR (~mile 1718)
  [42.9446, -122.1090, 2.5],  // Crater Lake (~mile 1820)
  [43.5244, -122.0026, 1.5],  // Shelter Cove (~mile 1907)
  [44.2901, -121.5491, 4.0],  // Sisters OR (~mile 1981)
  [45.6694, -121.8962, 2.5],  // Cascade Locks (~mile 2147)
  [46.6380, -121.3895, 1.5],  // White Pass (~mile 2294)
  [47.4248, -121.4130, 1.5],  // Snoqualmie Pass (~mile 2393)
  [47.7107, -121.3578, 2.5],  // Skykomish (~mile 2464)
  [48.3149, -120.6769, 2.0],  // Stehekin (~mile 2572)
];

// Returns the straight-line distance (miles) from [lat,lon] to the nearest trail point
function distanceToTrailMiles(lat, lon, nearestIdx) {
  if (!trailCoords || nearestIdx < 0) return 0;
  const c = trailCoords[nearestIdx];
  return haversineMiles([lat, lon], [c[1], c[0]]);
}

// Determine hiker status:
//   within a known PCT town radius → Picking up Resupply (catches on-trail towns)
//   > 1 mile from trail            → Picking up Resupply (catches unlisted stops)
//   on trail, 05:00–19:00 PT       → Hiking
//   on trail, 19:00–05:00 PT       → Camping
function getHikerStatus(lat, lon, nearestIdx) {
  for (const [tLat, tLon, r] of PCT_RESUPPLY_TOWNS) {
    if (haversineMiles([lat, lon], [tLat, tLon]) <= r) {
      return { text: 'Picking up Resupply', emoji: '📦' };
    }
  }
  if (distanceToTrailMiles(lat, lon, nearestIdx) > 1.0) {
    return { text: 'Picking up Resupply', emoji: '📦' };
  }
  const ptHour = parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false })
  );
  return (ptHour >= 5 && ptHour < 19)
    ? { text: 'Hiking', emoji: '🥾' }
    : { text: 'Camping', emoji: '⛺' };
}

// ============================================================
// Map setup
// ============================================================
const map = L.map('map', {
  zoomControl: true,
  attributionControl: true,
}).setView([36.5, -118.5], 6);

const TILE_LAYERS = {
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO', maxZoom: 19,
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri', maxZoom: 19,
  }),
  street: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO', maxZoom: 19,
  }),
};
let activeLayer = 'dark';
TILE_LAYERS.dark.addTo(map);

// Custom emoji map switcher control (top-right)
const MapSwitcherControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const div = L.DomUtil.create('div', 'map-switcher');
    div.innerHTML = `
      <button data-layer="dark" class="active">🌙 Dark</button>
      <button data-layer="satellite">🛰️ Satellite</button>
      <button data-layer="street">🗺️ Street</button>
    `;
    L.DomEvent.disableClickPropagation(div);
    div.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const key = btn.dataset.layer;
      if (key === activeLayer) return;
      map.removeLayer(TILE_LAYERS[activeLayer]);
      TILE_LAYERS[key].addTo(map);
      activeLayer = key;
      div.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    });
    return div;
  }
});
new MapSwitcherControl().addTo(map);

const trailLayer = L.layerGroup().addTo(map);
const historyLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);

// ============================================================
// Animated counter — eases from `from` to `to` over ~600ms
// ============================================================
function animateCounter(el, from, to) {
  const duration = 600;
  const startTime = performance.now();
  el.classList.add('updating');

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Cubic ease-out
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(from + (to - from) * eased);
    el.textContent = value.toLocaleString();
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = to.toLocaleString();
      el.classList.remove('updating');
    }
  }

  requestAnimationFrame(step);
}

// ============================================================
// Update progress bar fill + current dot position
// ============================================================
function updateProgressBar(milesHiked) {
  const pct = Math.min((milesHiked / PCT_TOTAL_MILES) * 100, 100);
  const fill = document.getElementById('progress-fill');
  const dot = document.getElementById('current-dot-wrap');
  if (fill) fill.style.width = `${pct}%`;
  if (dot) dot.style.left = `${pct}%`;
}

// ============================================================
// Milestone pins on progress bar
// ============================================================
function renderMilestonePins() {
  const wrap = document.getElementById('progress-bar-wrap');
  wrap.querySelectorAll('.milestone-pin').forEach(el => el.remove());
  PCT_MILESTONES.forEach(m => {
    const pct = (m.mile / PCT_TOTAL_MILES) * 100;
    const pin = document.createElement('div');
    pin.className = 'milestone-pin';
    pin.style.left = pct + '%';
    pin.title = `${m.label} — Mile ${m.mile}`;
    pin.innerHTML = `<div class="pin-icon" style="background:${m.color}"><span>${m.emoji}</span></div><div class="pin-line"></div>`;
    wrap.appendChild(pin);
  });
}

function renderMilestoneLegend() {
  const el = document.getElementById('milestone-legend');
  el.innerHTML = PCT_MILESTONES.map(m =>
    `<div class="milestone-legend-item">
       <div class="milestone-legend-dot" style="background:${m.color}"></div>
       <span>${m.emoji} ${m.label} (mi ${m.mile})</span>
     </div>`
  ).join('');
}

// ============================================================
// Parse Google Sheets CSV response
// ============================================================
function parseSheetResponse(text) {
  const lines = text.trim().split('\n');
  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const lat = parseFloat(cols[1]);
    const lon = parseFloat(cols[2]);
    return {
      timestamp: (cols[0] || '').trim(),
      lat,
      lon,
      message: (cols[3] || '').trim(),
    };
  }).filter(r => !isNaN(r.lat) && !isNaN(r.lon) && new Date(r.timestamp) >= new Date(TRAIL_START_DATE));
}

// Minimal CSV line parser that handles double-quoted fields
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ============================================================
// Fetch location history from Google Sheets (CSV)
// Falls back to localStorage cache if fetch fails.
// ============================================================
async function fetchLocations() {
  try {
    const resp = await fetch(SHEET_JSON_URL);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    const text = await resp.text();
    if (text.trimStart().startsWith('<')) {
      throw new Error('Sheet returned HTML instead of CSV — verify it is published: File → Share → Publish to web → CSV');
    }
    const locations = parseSheetResponse(text);
    // Cache the result
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(locations));
      localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
    } catch {
      // localStorage may be full or unavailable — non-fatal
    }
    return locations;
  } catch (err) {
    // Try cache fallback
    const cached = loadCachedLocations();
    if (cached) {
      console.info('Using cached location data due to fetch error:', err.message);
      return cached;
    }
    throw err;
  }
}

function loadCachedLocations() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadCachedLocationsIfFresh() {
  try {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0', 10);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ============================================================
// Haversine distance (miles) between two [lat, lon] points
// ============================================================
function haversineMiles([lat1, lon1], [lat2, lon2]) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function cumulativeDistance(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMiles(coords[i - 1], coords[i]);
  }
  return total;
}

// ============================================================
// Stats calculation
// ============================================================
function calcStats(locations) {
  if (!locations.length) return null;

  const sorted = [...locations].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const latest = sorted[sorted.length - 1];

  const coords = sorted.map(l => [l.lat, l.lon]);

  // Snap latest position to nearest trail point for accurate mileage.
  // Use pre-computed cumulative_miles from GeoJSON for exact distance.
  // Falls back to straight-line haversine before trail is loaded.
  const nearestIdx = findNearestTrailIndex(latest.lat, latest.lon);
  const milesHiked = (nearestIdx >= 0 && trailCumulativeMiles)
    ? trailCumulativeMiles[nearestIdx]
    : cumulativeDistance([[PCT_SOUTH_TERMINUS[0], PCT_SOUTH_TERMINUS[1]], ...coords]);
  const pctComplete = ((milesHiked / PCT_TOTAL_MILES) * 100).toFixed(2);

  // Days on trail = calendar days from start date to today (start day = day 1).
  // Parse start date as LOCAL midnight (not UTC) to avoid timezone drift where
  // new Date('YYYY-MM-DD') gives UTC midnight which can read as the previous day
  // in US timezones, causing the day count to jump an extra day by evening.
  const [sy, sm, sd] = TRAIL_START_DATE.split('-').map(Number);
  const startMidnight = new Date(sy, sm - 1, sd);
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const daysOnTrail = Math.floor((todayMidnight - startMidnight) / (1000 * 60 * 60 * 24)) + 1;

  const lastDate = new Date(latest.timestamp);
  return { milesHiked, pctComplete, daysOnTrail, latestTimestamp: lastDate, latest, sorted };
}

// ============================================================
// Relative time formatting
// ============================================================
function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

// ============================================================
// Temperature fetch (Open-Meteo, free, no API key)
// ============================================================
const WEATHER_CACHE_KEY = 'pct_weather';
const WEATHER_CACHE_TS_KEY = 'pct_weather_ts';
const WEATHER_TTL_MS = 30 * 60 * 1000; // 30 min

async function fetchTemperature(lat, lon) {
  const cached = localStorage.getItem(WEATHER_CACHE_KEY);
  const ts = parseInt(localStorage.getItem(WEATHER_CACHE_TS_KEY) || '0');
  if (cached && Date.now() - ts < WEATHER_TTL_MS) {
    renderTemperature(JSON.parse(cached));
    return;
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&temperature_unit=celsius`;
    const r = await fetch(url);
    const data = await r.json();
    const tempC = data.current.temperature_2m;
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(tempC));
    localStorage.setItem(WEATHER_CACHE_TS_KEY, Date.now().toString());
    renderTemperature(tempC);
  } catch(e) { console.warn('Weather fetch failed', e); }
}

function renderTemperature(tempC) {
  const tempF = Math.round(tempC * 9/5 + 32);
  const el = document.getElementById('temp-display');
  if (el) el.textContent = `${tempF}°F / ${Math.round(tempC)}°C`;
}

// ============================================================
// Elevation chart (Chart.js + pct_elevation.json)
// ============================================================
let elevationData = null;
let elevationChart = null;

async function loadElevationData() {
  try {
    const r = await fetch('./pct_elevation.json');
    elevationData = await r.json(); // [{mile, elevation_m}]
  } catch(e) { console.warn('Elevation data unavailable', e); }
}

function renderElevationChart(milesHiked) {
  if (!elevationData) return;
  const hiked = elevationData.filter(d => d.mile <= milesHiked);
  if (hiked.length < 2) return;

  const labels = hiked.map(d => d.mile);
  const data = hiked.map(d => Math.round(d.elevation_m * 3.28084)); // m → ft
  const current = data[data.length - 1];
  const low = Math.min(...data), high = Math.max(...data);
  const gained = data.reduce((acc, v, i) => i > 0 && v > data[i-1] ? acc + (v - data[i-1]) : acc, 0);

  const elevCurrentEl = document.getElementById('elev-current');
  const elevLowEl = document.getElementById('elev-low');
  const elevHighEl = document.getElementById('elev-high');
  const elevGainedEl = document.getElementById('elev-gained');
  if (elevCurrentEl) elevCurrentEl.textContent = current.toLocaleString() + ' ft';
  if (elevLowEl) elevLowEl.textContent = low.toLocaleString() + ' ft';
  if (elevHighEl) elevHighEl.textContent = high.toLocaleString() + ' ft';
  if (elevGainedEl) elevGainedEl.textContent = Math.round(gained).toLocaleString() + ' ft';

  const canvas = document.getElementById('elevation-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (elevationChart) elevationChart.destroy();
  elevationChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#2fb8a0',
        borderWidth: 1.5,
        backgroundColor: 'rgba(47,184,160,0.1)',
        fill: true,
        pointRadius: 0,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => `${ctx.parsed.y.toLocaleString()} ft` }
        }
      },
      scales: {
        x: { display: false },
        y: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 11 } }
        }
      }
    }
  });
}

// ============================================================
// Update stats panel + animated counter + progress bar
// ============================================================
let prevMilesHiked = 0;
let currentLatestTimestamp = null;

function updateStatsPanel(stats) {
  const milesEl = document.getElementById('miles-hiked');
  const milesRounded = Math.round(stats.milesHiked);
  const currentDisplay = parseInt((milesEl.textContent || '0').replace(/,/g, ''), 10) || 0;

  animateCounter(milesEl, currentDisplay, milesRounded);
  updateProgressBar(stats.milesHiked);

  const kmHiked = Math.round(stats.milesHiked * 1.60934);
  const milesOfTotal = document.getElementById('miles-of-total');
  if (milesOfTotal) milesOfTotal.textContent = `${milesRounded.toLocaleString()} miles / ${kmHiked.toLocaleString()} km`;

  const pctEl = document.getElementById('pct-percent');
  if (pctEl) pctEl.textContent = `${stats.pctComplete}%`;

  const pctStatEl = document.getElementById('pct-percent-stat');
  if (pctStatEl) pctStatEl.textContent = `${stats.pctComplete}%`;

  const daysEl = document.getElementById('days-on-trail');
  if (daysEl) daysEl.textContent = stats.daysOnTrail;

  const lastUpdateEl = document.getElementById('last-update');
  if (lastUpdateEl) lastUpdateEl.textContent = formatRelativeTime(stats.latestTimestamp);

  const nearestIdx = findNearestTrailIndex(stats.latest.lat, stats.latest.lon);
  const status = getHikerStatus(stats.latest.lat, stats.latest.lon, nearestIdx);
  const statusEl = document.getElementById('hiker-status');
  if (statusEl) statusEl.textContent = `${status.emoji} ${status.text}`;

  currentLatestTimestamp = stats.latestTimestamp;
  prevMilesHiked = stats.milesHiked;

  renderElevationChart(stats.milesHiked);
  fetchTemperature(stats.latest.lat, stats.latest.lon); // non-blocking, fire-and-forget
}

// Live-ticking timestamp — updates "Last GPS update" every 60s
setInterval(() => {
  if (!currentLatestTimestamp) return;
  const el = document.getElementById('last-update');
  if (el) el.textContent = formatRelativeTime(currentLatestTimestamp);
}, 60 * 1000);

// ============================================================
// Render map layers
// ============================================================
function renderMap(stats) {
  historyLayer.clearLayers();
  markerLayer.clearLayers();

  const { sorted, latest } = stats;
  const coords = sorted.map(l => [l.lat, l.lon]);

  // Draw "hiked so far" segment along actual PCT trail coordinates.
  // Slice trail from start to the point nearest the hiker's current location.
  if (trailCoords) {
    const nearestIdx = findNearestTrailIndex(latest.lat, latest.lon);
    // trailCoords is [lon, lat]; Leaflet needs [lat, lon].
    // Always prepend PCT_SOUTH_TERMINUS (mile 0) so we have at least 2 points
    // even when the hiker is at the very start of the trail (nearestIdx = 0).
    const trailSegment = trailCoords.slice(0, nearestIdx + 1).map(c => [c[1], c[0]]);
    const hikedLatLons = [PCT_SOUTH_TERMINUS, ...trailSegment];
    L.polyline(hikedLatLons, {
      color: '#e94560',
      weight: 3,
      opacity: 0.85,
      dashArray: '6, 4',
    }).addTo(historyLayer);
  } else {
    // Fallback before trail loads: straight line from Campo
    L.polyline([PCT_SOUTH_TERMINUS, ...coords], {
      color: '#e94560',
      weight: 3,
      opacity: 0.7,
      dashArray: '6, 4',
    }).addTo(historyLayer);
  }

  // Historical check-in dots (all except the latest)
  sorted.slice(0, -1).forEach(loc => {
    L.circleMarker([loc.lat, loc.lon], {
      radius: 5,
      fillColor: '#e94560',
      color: '#fff',
      weight: 1.5,
      opacity: 0.8,
      fillOpacity: 0.6,
    })
      .bindPopup(`<span class="popup-time">${formatTimestamp(loc.timestamp)}</span>`)
      .addTo(historyLayer);
  });

  const pulseIcon = L.divIcon({
    className: '',
    html: '<div class="pulse-marker"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });

  L.marker([latest.lat, latest.lon], { icon: pulseIcon })
    .bindPopup(`
      <strong>Current Location</strong><br>
      <span class="popup-time">${formatTimestamp(latest.timestamp)}</span>
    `)
    .addTo(markerLayer)
    .openPopup();

  // Fit bounds from Campo through current location
  map.fitBounds([PCT_SOUTH_TERMINUS, ...coords], { padding: [40, 40] });
}

function formatTimestamp(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

// ============================================================
// PCT route overlay — loads from local asset for fast rendering
// State-colored polylines: CA=orange, OR=green, WA=blue
// ============================================================
function buildStatePolylines(coords, cumMiles) {
  const ca = [], or = [], wa = [];
  coords.forEach((c, i) => {
    const m = cumMiles[i];
    const pt = [c[1], c[0]]; // [lon,lat] → [lat,lon]
    if (m <= CA_END_MILE)      ca.push(pt);
    else if (m <= OR_END_MILE) or.push(pt);
    else                        wa.push(pt);
  });
  // Add last CA point to OR start (continuity at border)
  if (ca.length) or.unshift(ca[ca.length - 1]);
  if (or.length) wa.unshift(or[or.length - 1]);
  return { ca, or, wa };
}

async function loadPctRoute() {
  const PCT_GEOJSON_URL = './pct_trail.geojson';
  try {
    const resp = await fetch(PCT_GEOJSON_URL);
    if (!resp.ok) return;
    const geojson = await resp.json();
    trailCoords = geojson.features[0].geometry.coordinates; // [lon, lat] pairs
    trailCumulativeMiles = geojson.features[0].properties.cumulative_miles || null;

    if (trailCumulativeMiles) {
      const segs = buildStatePolylines(trailCoords, trailCumulativeMiles);
      L.polyline(segs.ca, { color: STATE_COLORS.ca, weight: 3, opacity: 0.8 }).addTo(trailLayer);
      L.polyline(segs.or, { color: STATE_COLORS.or, weight: 3, opacity: 0.8 }).addTo(trailLayer);
      L.polyline(segs.wa, { color: STATE_COLORS.wa, weight: 3, opacity: 0.8 }).addTo(trailLayer);
    } else {
      // Fallback: single teal line if no cumulative miles data
      L.geoJSON(geojson, {
        style: { color: '#2fb8a0', weight: 3, opacity: 0.8 },
      }).addTo(trailLayer);
    }
  } catch {
    console.info('PCT route GeoJSON not loaded');
  }
}

// ============================================================
// Main update cycle
// ============================================================
async function update() {
  document.getElementById('status-text').textContent = 'Refreshing...';
  document.getElementById('status-text').classList.remove('error-text');
  try {
    const locations = await fetchLocations();
    const stats = calcStats(locations);
    if (!stats) {
      document.getElementById('status-text').textContent = 'No location data yet.';
      return;
    }
    updateStatsPanel(stats);
    renderMap(stats);
    document.getElementById('status-text').textContent =
      `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error('Update failed:', err);
    document.getElementById('status-text').classList.add('error-text');
    document.getElementById('status-text').textContent = `Error loading data: ${err.message}`;
  }
}

// ============================================================
// Countdown timer display
// ============================================================
let secondsUntilRefresh = REFRESH_INTERVAL_MS / 1000;

function startCountdown() {
  secondsUntilRefresh = REFRESH_INTERVAL_MS / 1000;
  const el = document.getElementById('refresh-countdown');
  const tick = () => {
    const m = Math.floor(secondsUntilRefresh / 60);
    const s = secondsUntilRefresh % 60;
    el.textContent = `Next refresh: ${m}:${s.toString().padStart(2, '0')}`;
    if (secondsUntilRefresh > 0) {
      secondsUntilRefresh--;
      setTimeout(tick, 1000);
    }
  };
  tick();
}

// ============================================================
// Boot
// ============================================================
(async () => {
  // Load PCT trail and elevation data in parallel (local assets, ~100ms each)
  await Promise.all([loadPctRoute(), loadElevationData()]);

  // Render milestone pins and legend once after trail loads
  renderMilestonePins();
  renderMilestoneLegend();

  // Render cached data immediately so the UI isn't blank
  const cachedLocations = loadCachedLocationsIfFresh();
  if (cachedLocations) {
    const cachedStats = calcStats(cachedLocations);
    if (cachedStats) {
      updateStatsPanel(cachedStats);
      renderMap(cachedStats);
      document.getElementById('status-text').textContent = 'Loading fresh data...';
    }
  }

  // Initial data load
  await update();

  // Auto-refresh
  setInterval(async () => {
    await update();
    startCountdown();
  }, REFRESH_INTERVAL_MS);

  startCountdown();
})();
