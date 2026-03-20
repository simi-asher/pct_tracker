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

// PCT milestones for progress bar tooltips
const PCT_MILESTONES = [
  { label: 'Campo',        mile: 0,    emoji: '🚀' },
  { label: 'Kennedy Mdws', mile: 702,  emoji: '⛺' },
  { label: 'Yosemite',     mile: 942,  emoji: '🏔️' },
  { label: 'OR Border',    mile: 1702, emoji: '🌲' },
  { label: 'Crater Lake',  mile: 1820, emoji: '🌋' },
  { label: 'WA Border',    mile: 1977, emoji: '🦅' },
  { label: 'Manning Park', mile: 2653, emoji: '🏁' },
];

// Loaded PCT trail coordinates ([lon, lat] GeoJSON order) — populated by loadPctRoute()
let trailCoords = null;

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

// ============================================================
// Map setup
// ============================================================
const map = L.map('map', {
  zoomControl: true,
  attributionControl: true,
}).setView([36.5, -118.5], 6);

const baseLayers = {
  'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 18,
  }),
  'Street': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }),
  'Topo': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data: © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  }),
};
baseLayers['Satellite'].addTo(map);

// Boundaries + labels overlay (state/country lines on top of satellite)
const boundariesLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Boundaries &copy; Esri', maxZoom: 18, opacity: 1 }
).addTo(map);

const trailLayer = L.layerGroup().addTo(map);
const historyLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);

L.control.layers(baseLayers, {
  'Boundaries & Labels': boundariesLayer,
  'PCT Trail': trailLayer,
  'History': historyLayer,
  'Current Location': markerLayer,
}).addTo(map);

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
  // Each trail point in pct_trail.geojson is 0.5 PCT miles apart starting at mile 0.5,
  // so index n → mile (n+1)*0.5. Fall back to straight-line haversine if trail not yet loaded.
  const nearestIdx = findNearestTrailIndex(latest.lat, latest.lon);
  const milesHiked = nearestIdx >= 0
    ? (nearestIdx + 1) * 0.5
    : cumulativeDistance([[PCT_SOUTH_TERMINUS[0], PCT_SOUTH_TERMINUS[1]], ...coords]);
  const pctComplete = ((milesHiked / PCT_TOTAL_MILES) * 100).toFixed(1);

  const startDate = new Date(TRAIL_START_DATE);
  const lastDate = new Date(latest.timestamp);
  const daysOnTrail = Math.max(0, Math.floor((lastDate - startDate) / (1000 * 60 * 60 * 24)));

  return { milesHiked: Math.round(milesHiked), pctComplete, daysOnTrail, latestTimestamp: lastDate, latest, sorted };
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
// Update stats panel + animated counter + progress bar
// ============================================================
let prevMilesHiked = 0;
let currentLatestTimestamp = null;

function updateStatsPanel(stats) {
  const milesEl = document.getElementById('miles-hiked');
  const currentDisplay = parseInt((milesEl.textContent || '0').replace(/,/g, ''), 10) || 0;

  animateCounter(milesEl, currentDisplay, stats.milesHiked);
  updateProgressBar(stats.milesHiked);

  const milesOfTotal = document.getElementById('miles-of-total');
  if (milesOfTotal) milesOfTotal.textContent = `${stats.milesHiked.toLocaleString()} of ${PCT_TOTAL_MILES.toLocaleString()} miles`;

  const pctEl = document.getElementById('pct-percent');
  if (pctEl) pctEl.textContent = `${stats.pctComplete}%`;

  const pctStatEl = document.getElementById('pct-percent-stat');
  if (pctStatEl) pctStatEl.textContent = `${stats.pctComplete}%`;

  const daysEl = document.getElementById('days-on-trail');
  if (daysEl) daysEl.textContent = stats.daysOnTrail;

  const lastUpdateEl = document.getElementById('last-update');
  if (lastUpdateEl) lastUpdateEl.textContent = formatRelativeTime(stats.latestTimestamp);

  currentLatestTimestamp = stats.latestTimestamp;
  prevMilesHiked = stats.milesHiked;
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
    // trailCoords is [lon, lat]; Leaflet needs [lat, lon]
    const hikedLatLons = trailCoords.slice(0, nearestIdx + 1).map(c => [c[1], c[0]]);
    if (hikedLatLons.length > 0) {
      L.polyline(hikedLatLons, {
        color: '#e94560',
        weight: 3,
        opacity: 0.85,
        dashArray: '6, 4',
      }).addTo(historyLayer);
    }
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
// ============================================================
async function loadPctRoute() {
  const PCT_GEOJSON_URL = './pct_trail.geojson';
  try {
    const resp = await fetch(PCT_GEOJSON_URL);
    if (!resp.ok) return;
    const geojson = await resp.json();
    // Store coordinates globally for snapping and hiked-segment rendering
    trailCoords = geojson.features[0].geometry.coordinates; // [lon, lat] pairs
    L.geoJSON(geojson, {
      style: { color: '#2fb8a0', weight: 3, opacity: 0.8 },
    }).addTo(trailLayer);
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
  // Load PCT trail first (local asset, ~100ms) so snapping and hiked-segment
  // rendering work correctly for both cached and fresh data renders.
  await loadPctRoute();

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
