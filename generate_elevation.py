"""
One-time script to generate pct_elevation.json from PCT mile marker GeoJSON.
Uses the free Open-Topo Data API (no API key required, rate limit: <1 req/sec).

Usage:
  cd pct_website
  pip install requests
  python generate_elevation.py

Output: pct_elevation.json — array of {mile, elevation_m} objects (~200KB)
Commit pct_elevation.json to the repo after running.
"""
import json
import time
import requests

with open('Full_PCT_Mile_Marker.geojson') as f:
    features = json.load(f)['features']

results = []
batch_size = 100
coords = [
    (f['geometry']['coordinates'][1], f['geometry']['coordinates'][0], f['properties']['Mile'])
    for f in features
]

for i in range(0, len(coords), batch_size):
    batch = coords[i:i+batch_size]
    loc_str = '|'.join(f"{lat},{lon}" for lat, lon, _ in batch)
    r = requests.get(f'https://api.opentopodata.org/v1/srtm30m?locations={loc_str}')
    data = r.json()
    for j, result in enumerate(data['results']):
        results.append({'mile': batch[j][2], 'elevation_m': result['elevation']})
    print(f"Fetched {min(i + batch_size, len(coords))}/{len(coords)} points...")
    time.sleep(1.2)  # rate limit: <1 req/sec

with open('pct_elevation.json', 'w') as f:
    json.dump(results, f)
print(f"Wrote {len(results)} elevation points to pct_elevation.json")
