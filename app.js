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

// ============================================================
// Placeholder data shown when sheet URL is not yet configured
// ============================================================
const PLACEHOLDER_LOCATIONS = [
  { timestamp: '2026-04-01T10:00:00', lat: 32.5899, lon: -116.4758, message: 'Starting the PCT at Campo! Here we go!' },
  { timestamp: '2026-04-05T14:30:00', lat: 32.7500, lon: -116.5200, message: 'Making good miles. Feet are sore but spirits high.' },
  { timestamp: '2026-04-10T09:15:00', lat: 33.1000, lon: -116.7100, message: 'Warner Springs done. Water was plentiful.' },
];

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

// Layer groups
const trailLayer = L.layerGroup().addTo(map);
const historyLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);

L.control.layers(baseLayers, {
  'PCT Trail': trailLayer,
  'History': historyLayer,
  'Current Location': markerLayer,
}).addTo(map);

// ============================================================
// Parse Google Sheets CSV response
// Expects columns: timestamp, lat, lon, message
// Skips the header row.
// ============================================================
function parseSheetResponse(text) {
  const lines = text.trim().split('\n');
  // Skip header row
  return lines.slice(1).map(line => {
    // Simple CSV split — handles quoted fields containing commas
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
// ============================================================
async function fetchLocations() {
  const resp = await fetch(SHEET_JSON_URL);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
  const text = await resp.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error('Sheet returned HTML instead of CSV — verify it is published: File → Share → Publish to web → CSV');
  }
  return parseSheetResponse(text);
}

// ============================================================
// Haversine distance (miles) between two [lat, lon] points
// ============================================================
function haversineMiles([lat1, lon1], [lat2, lon2]) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ============================================================
// Compute cumulative trail distance from a list of coords
// ============================================================
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

  // Sort by timestamp ascending
  const sorted = [...locations].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const latest = sorted[sorted.length - 1];

  // Miles hiked = cumulative straight-line distance (approximation without PCT GeoJSON)
  const coords = sorted.map(l => [l.lat, l.lon]);
  const milesHiked = cumulativeDistance([[PCT_SOUTH_TERMINUS[0], PCT_SOUTH_TERMINUS[1]], ...coords]);

  // % complete
  const pctComplete = ((milesHiked / PCT_TOTAL_MILES) * 100).toFixed(1);

  // Days on trail
  const startDate = new Date(TRAIL_START_DATE);
  const lastDate = new Date(latest.timestamp);
  const daysOnTrail = Math.max(0, Math.floor((lastDate - startDate) / (1000 * 60 * 60 * 24)));

  // Last update — human readable
  const lastUpdate = formatRelativeTime(lastDate);

  return { milesHiked: Math.round(milesHiked), pctComplete, daysOnTrail, lastUpdate, latest, sorted };
}

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
// Update stats panel
// ============================================================
function updateStatsPanel(stats) {
  document.getElementById('miles-hiked').textContent = stats.milesHiked.toLocaleString();
  document.getElementById('pct-percent').textContent = `${stats.pctComplete}%`;
  document.getElementById('days-on-trail').textContent = stats.daysOnTrail;
  document.getElementById('last-update').textContent = stats.lastUpdate;

  const msg = stats.latest.message || '(no message)';
  document.getElementById('latest-message').textContent = `"${msg}"`;
}

// ============================================================
// Render map layers
// ============================================================
function renderMap(stats) {
  historyLayer.clearLayers();
  markerLayer.clearLayers();

  const { sorted, latest } = stats;
  const coords = sorted.map(l => [l.lat, l.lon]);

  // Draw breadcrumb trail polyline
  if (coords.length > 1) {
    L.polyline(coords, {
      color: '#e94560',
      weight: 3,
      opacity: 0.7,
      dashArray: '6, 4',
    }).addTo(historyLayer);
  }

  // Historical location dots
  sorted.slice(0, -1).forEach(loc => {
    L.circleMarker([loc.lat, loc.lon], {
      radius: 5,
      fillColor: '#e94560',
      color: '#fff',
      weight: 1.5,
      opacity: 0.8,
      fillOpacity: 0.6,
    })
      .bindPopup(`
        <strong>${loc.message || 'Check-in'}</strong><br>
        <span class="popup-time">${formatTimestamp(loc.timestamp)}</span>
      `)
      .addTo(historyLayer);
  });

  // Current location: animated pulse marker
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
      ${latest.message || 'Check-in'}<br>
      <span class="popup-time">${formatTimestamp(latest.timestamp)}</span>
    `)
    .addTo(markerLayer)
    .openPopup();

  // Fit map to show all points
  if (coords.length === 1) {
    map.setView(coords[0], 10);
  } else {
    map.fitBounds(coords, { padding: [40, 40] });
  }
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
// PCT route overlay (loaded from public GeoJSON)
// Only attempted if the browser can reach GitHub raw content.
// ============================================================
async function loadPctRoute() {
  const PCT_GEOJSON_URL =
    'https://raw.githubusercontent.com/bwainstock/halfmile-geojson/master/tracks.geojson';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(PCT_GEOJSON_URL, { signal: controller.signal });
    if (!resp.ok) return;
    const geojson = await resp.json();
    L.geoJSON(geojson, {
      style: { color: '#4a90d9', weight: 2, opacity: 0.5 },
    }).addTo(trailLayer);
  } catch {
    // Non-fatal: PCT route overlay is cosmetic enhancement only
    console.info('PCT route GeoJSON not loaded (CORS, network, or timeout)');
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// Main update cycle
// ============================================================
async function update() {
  document.getElementById('status-text').textContent = 'Refreshing...';
  try {
    const locations = await fetchLocations();
    const stats = calcStats(locations);
    if (!stats) {
      document.getElementById('status-text').textContent = 'No location data yet.';
      document.getElementById('latest-message').textContent = 'Waiting for first check-in...';
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
  // Load PCT route in background (non-blocking)
  loadPctRoute();

  // Initial data load
  await update();

  // Auto-refresh
  setInterval(async () => {
    await update();
    startCountdown();
  }, REFRESH_INTERVAL_MS);

  startCountdown();
})();
