# MBTA Project Notes

## Project Purpose

This folder is a standalone browser app for a real-time MBTA tracker by Jianzhao Bi. It renders a full-screen Leaflet map centered on Boston by default, lets the user choose an MBTA route, and displays:

- the selected route's shape/path on the map
- stops along the selected route
- real-time vehicle markers for the selected route
- stop-level arrival predictions when a stop is clicked
- route alerts in a collapsible alert panel
- the user's current location when browser geolocation is available and permitted

There is no build system or backend in this folder. The app is static HTML/CSS/JS and runs directly in the browser.

## Main Files

- `index.html`: Defines the page shell, loads Leaflet from unpkg, loads `style.css`, creates the map container, route selector, update timestamp, credit text, alert toggle button, and alert panel.
- `style.css`: Provides the full-screen map layout, route selector overlay, alert panel styling, zoom-control positioning, and disables text selection/long-press selection.
- `app.js`: Contains all app logic: Leaflet setup, geolocation, MBTA API calls, route dropdown population, URL route parameter handling, vehicle marker rendering, shape/stops rendering, stop prediction popups, alert fetching, and polling.

## External Dependencies

Loaded at runtime from CDNs or remote services:

- Leaflet CSS and JS: `https://unpkg.com/leaflet@1.7.1/...`
- Leaflet global object: `L`
- Thunderforest map tiles:
  - `https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey=...`
- MBTA v3 API:
  - `https://api-v3.mbta.com/...`

The app currently hardcodes API keys in `app.js`:

- `MBTA_API_KEY`
- Thunderforest tile API key embedded in the tile URL

Because this is a static public frontend, these keys are visible to anyone who opens the page source.

## Runtime Inputs

### User Inputs

- Route dropdown selection via `#routeFilter`.
- Optional URL query parameter:
  - `?route=<route-id>`
  - Example: `?route=Green-E`
  - On page load, the app uses this value if it matches a route returned by the MBTA routes endpoint.
- Browser geolocation permission:
  - If granted, the map recenters on the user's location and shows a "Your Location" marker.
  - If denied, unavailable, or timed out, the app stays centered on the default Boston coordinates.
- Map interactions through Leaflet:
  - pan, zoom, click markers, click stops.
- Alert toggle button:
  - Shows or hides the current route's alert panel when route alerts exist.

### Network/API Inputs

The app fetches live JSON from the MBTA API:

- Routes:
  - `GET /routes`
  - Used to populate the route dropdown.
- Shapes:
  - `GET /shapes?filter[route]=<route-id>`
  - Used to draw the selected route path.
  - Subway routes and commuter rail routes prefer shapes whose ID includes `canonical`.
- Stops:
  - `GET /stops?filter[route]=<route-id>`
  - Used to draw stop markers for the selected route.
- Vehicles:
  - `GET /vehicles?filter[route]=<route-id>&include=trip`
  - Used to draw live vehicle markers and destination/headsign details.
- Predictions:
  - `GET /predictions?filter[route]=<route-id>&filter[stop]=<stop-id>&include=trip`
  - Fetched only when the user clicks a stop marker.
  - Used to show upcoming arrivals by direction/headsign in the stop popup.
- Alerts:
  - `GET /alerts?filter[route]=<route-id>`
  - Used to show a collapsible alert panel for the selected route.

### Built-In Defaults

- Default map center: latitude `42.3601`, longitude `-71.0889`.
- Default zoom: `12`.
- Preferred dropdown ordering:
  - `Blue`, `Green-B`, `Green-C`, `Green-D`, `Green-E`, `Orange`, `Red`, `Mattapan`
  - Other routes are sorted alphabetically after these.
- If the current dropdown selection cannot be preserved, `updateRouteFilterOptions()` prefers `Green-E`.
- During initialization, if no valid URL route is present, `initializeRoutes()` sets the dropdown to the first sorted route.

## Outputs

### Visual/UI Outputs

- Full-viewport Leaflet map in `#map`.
- Route selector overlay in the upper-left corner.
- "Last Updated" timestamp in America/New_York time, formatted via `toLocaleString("sv-SE", { timeZone: "America/New_York" })`.
- Credit text: `MBTA Tracker by Jianzhao Bi`.
- Selected route polyline:
  - color `#FFD580`
  - weight `5`
  - opacity `0.5`
- Stop markers:
  - small golden circular SVG markers.
  - clicking a stop opens a popup and fetches arrival predictions.
- Vehicle markers:
  - custom inline SVG bus icons.
  - direction `0` uses green.
  - direction `1` uses red.
  - invalid/unknown direction uses a yellow warning circle.
  - popups include route ID, vehicle label, destination/headsign, current status, and updated time.
- User location marker:
  - salmon map-pin SVG marker with "Your Location" popup.
- Route alert controls:
  - `Show Alerts` / `Hide Alerts` button appears only when alerts with headers exist or an alert fetch error occurs.
  - Alert panel lists alert lifecycle and header text.

### URL/Browser Outputs

- When the user manually changes routes, `updateURLWithRoute()` writes the selected route into the browser URL query string as `route=<route-id>` using `history.pushState()`.

### Console Outputs

The app logs warnings or errors for:

- geolocation fallback
- route fetch failures
- missing shape or stop data
- prediction fetch failures
- alert fetch failures
- vehicle fetch failures

## Data Flow

1. Browser loads `index.html`.
2. Leaflet and app code initialize the map.
3. Browser geolocation is requested if available.
4. On `DOMContentLoaded`, the app:
   - fetches all MBTA routes
   - sorts and populates the route dropdown
   - applies the `route` query parameter when valid
   - fetches and renders the selected route's shape, stops, vehicles, and alerts
5. Every 5 seconds, `setInterval(updateBusPositions, 5000)` refreshes:
   - route shape
   - stops
   - vehicle positions
   - last-updated timestamp
6. When the user changes the selected route:
   - URL query parameter is updated
   - route shape, stops, vehicles, and alerts are refetched
7. When the user clicks a stop:
   - predictions for that route/stop are fetched
   - the stop popup is replaced with upcoming arrival minutes grouped by direction and headsign

## Important Implementation Details

- `decodePolyline(encoded)` decodes MBTA encoded polylines into Leaflet `[lat, lng]` coordinate arrays.
- `window.routeLayer` stores the current route polyline layer group so it can be removed before drawing a new route.
- `window.stopMarkers` stores current stop markers so they can be removed before drawing stops for a new route.
- `busMarkers` stores current vehicle markers so they can be removed before each vehicle refresh.
- Vehicle polling currently calls `plotRouteShape(selectedRoute)` every 5 seconds, which also refetches and redraws stops. This keeps data fresh but causes repeated shape/stop network requests even when the route has not changed.
- Alerts are fetched on initial load and route changes, not on the 5-second vehicle polling interval.
- Predictions filter out past arrivals by ignoring negative minute differences.
- Prediction popup results are sorted ascending and limited to the next 3 arrivals per direction/headsign.
- Alert sorting treats lower MBTA severity values as more critical, then sorts by active-period start time.

## Running Locally

Since the app is static, it can be opened directly as `mbta/index.html`. A local static server is also fine if browser/CORS behavior or local testing convenience requires it, for example:

```sh
cd mbta
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Maintenance Notes

- Keep this folder dependency-light unless there is a clear need for a build step.
- If changing UI behavior, test at mobile and desktop viewport sizes because the map and overlays are all absolute-positioned.
- If changing API request behavior, preserve MBTA route IDs exactly as returned by the API; IDs like `Green-E` and `CR-*` are meaningful.
- Be careful with public API keys. If this project becomes more than a personal/static demo, move API key handling behind a backend or use restricted keys.
- If performance becomes an issue, the first likely improvement is to fetch route shapes/stops only when the route changes, while keeping the 5-second interval focused on vehicles.
- If the MBTA API changes its response shape, the most sensitive code is in `getRoutes()`, `fetchAndShowPredictions()`, `plotRouteShape()`, `plotRouteStops()`, `fetchAndDisplayAlert()`, and `updateBusPositions()`.
