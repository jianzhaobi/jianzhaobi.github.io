# MBTA Project Notes

## Project Purpose

This folder is the active standalone browser app for a real-time MBTA tracker by Jianzhao Bi. It renders a full-screen Leaflet map centered on Boston, lets the user choose an MBTA route, and displays current route geometry, stops, live vehicles, stop arrival predictions, service alerts, user location, and travel-time context from the user's current location to a selected stop.

There is no backend, package manager, bundler, or build step in this folder. The app is static HTML/CSS/vanilla JavaScript and runs directly in the browser.

## Main Files

- `index.html`: Page shell. Loads Leaflet from unpkg, defines `window.__APP_VERSION__` for cache busting, injects `style.css` and `app.js`, links favicon/apple-touch-icon/manifest assets, and declares the map, route picker, basemap picker, locate/reset buttons, alert controls, and panel details.
- `style.css`: Full-screen map layout, responsive route panel, searchable route picker, basemap picker, stop/vehicle markers, vehicle halo animation, walking-route styling, and mobile/fine-pointer interaction styling.
- `app.js`: All runtime logic: configuration, state, Leaflet map setup, geolocation/follow mode, basemap switching and fine-pointer wheel zoom, MBTA API fetching, route selection, shape/stops/alerts/predictions rendering, travel-time lookups, walk-route rendering, vehicle polling, vehicle marker animation, and vehicle layout along route geometry.
- `site.webmanifest`, `assets/favicon.svg`, `assets/icon.svg`: Browser/PWA metadata and icons referenced by `index.html`.
- `CLAUDE.md`: Shorter AI-agent context summary. Keep it synchronized with this file when model or core behavior changes.

## External Dependencies

Loaded at runtime from CDNs or remote services:

- Leaflet CSS/JS: `https://unpkg.com/leaflet@1.9.4/...`
- Leaflet global object: `L`
- Carto basemap tiles:
  - light: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`
  - dark: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`
  - detail/voyager: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`
- Esri satellite tiles:
  - `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
- MBTA v3 API:
  - `https://api-v3.mbta.com/...`
- Google Routes API:
  - `https://routes.googleapis.com/directions/v2:computeRoutes`
  - Used for walking duration and encoded walking-route polylines from user location to a selected stop.
- Mapbox Directions API:
  - `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/...`
  - Used for driving/traffic duration from user location to a selected stop.

The static frontend currently exposes these keys/tokens in `app.js`:

- `MBTA_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `MAPBOX_ACCESS_TOKEN`

Because this is a public static frontend, these credentials are visible to anyone who opens the page source. Treat them as restricted frontend keys only.

## Runtime Inputs

### User Inputs

- Route selection through the custom searchable route picker (`#routePicker`) backed by the hidden native `#routeFilter` select.
- Optional URL query parameter:
  - `?route=<route-id>`
  - Example: `?route=Green-E`
  - On page load, the app uses this value if it matches a route returned by MBTA `/routes`.
- Browser geolocation permission:
  - If available, the locate button appears.
  - The user can center on current location and toggle follow-user mode.
  - Stop popups use the last known user location for walking/driving travel-time summaries.
- Map interactions through Leaflet: pan, zoom, tap/click stops, tap/click vehicles.
- Basemap picker: light, dark, detail, satellite.
- Reset route view button: fits the current route geometry.
- Alert/details panel controls.
- Stop popup walk-route toggle when Google returns an encoded walking polyline.

### Network/API Inputs

The app fetches live JSON from these APIs:

- MBTA routes:
  - `GET /routes`
  - Populates `state.routes`, route picker options, route colors, direction names, and direction destinations.
- MBTA route patterns:
  - `GET /route_patterns?filter[route]=<route-id>&include=representative_trip`
  - Finds representative trip shapes for typical/canonical route patterns.
- MBTA shapes:
  - `GET /shapes?filter[route]=<route-id>`
  - Draws selected route geometry and populates `state.routeShapeSegments` / `state.routeShapeIndex` for vehicle layout.
- MBTA stops:
  - `GET /stops?filter[route]=<route-id>`
  - Draws stop markers and populates `state.stops`.
- MBTA vehicles:
  - `GET /vehicles?filter[route]=<route-id>&include=trip,stop`
  - Draws and diff-updates live vehicle markers.
- MBTA predictions:
  - `GET /predictions?filter[route]=<route-id>&filter[stop]=<stop-id>&include=trip`
  - Fetched when the user clicks a stop. Shows upcoming arrivals grouped by direction/headsign.
- MBTA alerts:
  - `GET /alerts?filter[route]=<route-id>`
  - Shows service alerts in the collapsible panel.
- Google Routes:
  - `POST /directions/v2:computeRoutes` with `travelMode: "WALK"`
  - Returns walking duration and `routes.polyline.encodedPolyline`.
- Mapbox Directions:
  - `GET /directions/v5/mapbox/driving-traffic/<origin>;<destination>`
  - Returns driving/traffic duration.

## Core Runtime State Model

`app.js` uses a single module-level `state` object. Important fields:

- `routes: Map<routeId, route>`: MBTA route records normalized from `/routes`.
- `selectedRouteId`: Current route ID.
- `routeRequestId`: Monotonic request guard for route-load operations.
- `vehicleRequestId`: Monotonic request guard for vehicle polling responses.
- `vehicleTimer`: `setInterval` handle for vehicle polling.
- `routeAbortController`: Aborts in-flight shape/stop/alert/initial-vehicle fetches when route changes.
- `stops: Map<stopId, stopInfo>`: Rendered stops for the selected route.
- `vehicleRecords: Map<vehicleId, record>`: Marker/vehicle/popup/layout record per live vehicle.
- `routeShapeSegments: Array<segment>`: Decoded route segments used to align vehicles to route geometry.
- `routeShapeIndex: Map<shapeId, segment[]>`: Shape-specific segment cache for smoothed tangent calculations.
- `activeWalkRouteStopId`: Stop whose walking-route polyline is currently shown.
- `stopPredictionRequestId`: Monotonic request guard for stop popup prediction/travel-time updates.
- Route/panel UI state: `panelExpanded`, `routePickerExpanded`, `routeSearchQuery`, `activeRouteId`.
- User-location UI state: `userLocation`, `userMarker`, `userWatchId`, `followUserLocation`, `allowInitialLocationView`, `hasAppliedInitialLocationView`, `isProgrammaticMapMove`.
- Basemap/fine-pointer zoom state: `currentBasemap`, `isFinePointerWheelZooming`, `finePointerWheel*`, and `basemapWheelGhost*` fields. The ghost remembers capture zoom, capture map-pane offset, tile-load listener/layer, release/fade timers, and release token.
- Vehicle layout/interaction state: `vehicleLayoutTimer`, `vehicleZoomLayoutFrame`, `vehicleZoomLayoutZoom`, `vehicleMapInteractionTimer`, `isVehicleMapInteracting`, `hasActiveVehicleTouchGesture`.

## Data Models

### Route Model

Routes are normalized in `loadRoutes()` from MBTA `/routes` into objects with:

- `id`
- `shortName`
- `longName`
- `color`
- `textColor`
- `type`
- `directionNames`
- `directionDestinations`
- `badgeLabel` assigned later by `assignRouteBadgeLabels()`

Route sorting prioritizes the rapid-transit route IDs in `ROUTE_PRIORITY`, then route type via `ROUTE_TYPE_ORDER`, then display name. Route picker options are grouped as rapid transit, commuter rail, bus, ferry, and other. Badge labels are generated to avoid collisions where possible, with explicit overrides in `ROUTE_BADGE_OVERRIDES`.

### Shape / Segment Model

`renderRouteShape()` fetches `/shapes` and representative route patterns in parallel. `getRepresentativeShapeIds()` prefers typical route patterns (`typicality === 1`), then canonical patterns, and falls back to all patterns. Representative shapes are preferred when available; otherwise all shapes are rendered.

Decoded polyline points become:

- Leaflet polylines in `routeLayer`
- Segment objects in `state.routeShapeSegments`
- Per-shape segment arrays in `state.routeShapeIndex`

Each segment has:

- `shapeId`
- `directionId` when known from representative pattern metadata
- `start: [lat, lng]`
- `end: [lat, lng]`
- `indexInShape`

Vehicle layout uses these segments to find nearest route geometry and a smoothed route tangent.

### Stop Model

`renderRouteStops()` fetches `/stops`, creates stop markers, and stores stop records in `state.stops`:

- `id`
- `name`
- `lat`
- `lng`
- `marker`

Clicking a stop clears any previous walking route, marks `activeWalkRouteStopId`, opens a popup, starts travel-time lookup, and fetches MBTA predictions.

### Prediction Model

`renderPredictions()` fetches MBTA predictions with included trips. It:

- uses `arrival_time || departure_time`
- discards missing/invalid/past times
- computes rounded minutes from current time
- groups by `direction_id` and trip headsign or route destination
- sorts by direction then headsign
- limits each group to the next three arrivals

The popup is guarded by `stopPredictionRequestId`, selected route, and marker presence so stale responses do not update old popups.

### Travel-Time / Walk-Route Model

Stop popup travel time is independent from MBTA predictions:

- If `state.userLocation` is missing, travel time is `Unavailable`.
- Google Routes provides walking minutes and the encoded walking-route polyline.
- Mapbox Directions provides driving/traffic minutes.
- Results are combined as `Walk <x> min · Drive <y> min`.
- If Google returns a polyline, the popup shows a walk-route toggle.
- `renderWalkRoute()` decodes the Google polyline and draws a dotted route in `walkRouteLayer`.

### Alert Model

`renderAlerts()` fetches MBTA `/alerts?filter[route]=<route-id>` once per route change. Alerts with headers are sorted lifecycle-first (`NEW`, `ONGOING`, `ONGOING_UPCOMING`, `UPCOMING`), then by severity descending, then by first active-period start time. The first lifecycle-prioritized alert sets `data-lifecycle` on the alert panel, indicator, and toggle; individual alert rows also receive their own lifecycle state for color styling. `hideAlerts()` and alert fetch errors clear lifecycle data so stale colors do not remain.

### Vehicle Model

`refreshVehicles()` polls MBTA vehicles every `VEHICLE_REFRESH_MS` (5 seconds). The model is diff-based:

- `state.vehicleRecords` is keyed by `vehicle.id`.
- Existing markers are updated in place with new vehicle data, popup HTML, icon presentation, and animated target location.
- New vehicles create markers.
- Vehicles missing from the latest response are removed.
- This avoids DOM churn and preserves open vehicle popups when possible.
- The vehicle request includes sparse fieldsets for vehicle, trip, and stop data. Included trips provide headsigns and shape IDs; included stops provide names and coordinates for at-stop display.

Vehicle movement:

- Markers animate between polling updates over `VEHICLE_MOVE_DURATION_MS`.
- Large jumps over `VEHICLE_MOVE_MAX_JUMP_METERS` snap instead of animating.
- Movement animations are canceled during map interactions, then settled afterward.

Vehicle layout:

- Visual vehicle circles are offset from the true GPS marker anchor.
- Offset direction follows the normal/perpendicular of the nearest rendered route segment.
- The heading arrow uses the route tangent when available.
- A leader line connects the true GPS point to the visual marker.
- `getSegmentLayerPoints(segment)` memoizes projected segment points in a `WeakMap` and is invalidated on map zoom/move.
- There is no collision-avoidance solver; vehicles may overlap in dense areas in exchange for stable route-aligned positioning.

Vehicle stop status:

- `vehicleStopInfo()` only returns a stop state for `current_status === "STOPPED_AT"`.
- There is no `.near-stop` class and no near-stop model.
- If MBTA includes a stop relationship, that stop is preferred.
- Otherwise the nearest rendered stop within 45 meters is used as fallback.
- Only `.at-stop` markers get the breathing halo animation.

## UI / Map Model

- Map defaults: center `[42.3601, -71.0889]`, zoom `12`.
- Basemaps: `light`, `dark`, `detail`, `satellite`; current choice is `state.currentBasemap`.
- Fine-pointer devices use custom wheel zoom with a rasterized basemap ghost to smooth tile transitions. The ghost is captured from loaded tiles, tracks the map-pane offset at capture time, fades after the live tile layer loads, and has a max-wait fallback so stale snapshots do not linger.
- Route panel contains the custom searchable route picker, fetch/update status, alert indicator, details toggle, direction legend, alert panel, and credit.
- Leaflet zoom, locate-user, and reset-route-view controls share the top-right control area.
- `updateURLWithRoute()` writes route changes using `history.replaceState()`, not `pushState`.
- `window.__APP_VERSION__` in `index.html` is the single cache-busting string for both CSS and JS.
- Browser metadata/icons are static files: `site.webmanifest`, `assets/favicon.svg`, and `assets/icon.svg`.

## Data Flow

1. Browser loads `index.html`.
2. Leaflet, CSS, and `app.js` initialize the map and layers.
3. Geolocation watch is initialized when available.
4. On startup, the app fetches MBTA routes, normalizes/sorts them, assigns badge labels, populates route-picker UI, and applies a valid `?route=` parameter if present. If not, it defaults to `Green-E` when available, otherwise the first returned route.
5. `selectRoute()`:
   - aborts prior route-load fetches
   - stops vehicle polling
   - sets selected route state and URL
   - applies route theme and route picker selection
   - clears route/stop/vehicle/walk-route layers
   - fetches/renders route shape, stops, and alerts
   - performs an initial vehicle refresh
   - restarts vehicle polling
6. Every 5 seconds, vehicle polling refreshes vehicles only. Shapes, stops, and alerts are not refetched by the polling loop.
7. When the tab is hidden, polling pauses. On reveal, vehicles refresh immediately and polling resumes.
8. Clicking a stop opens a popup, starts travel-time lookup, fetches predictions, and optionally enables walking-route display.

## Error Handling and Staleness Guards

- `fetchMbta(path, params, signal)` retries up to 3 attempts with jittered exponential backoff on `429` and `5xx` responses.
- Non-retryable MBTA client errors throw immediately.
- `AbortError` is treated as expected route-switch cancellation and should not be logged as an error.
- `routeRequestId`, `vehicleRequestId`, and `stopPredictionRequestId` prevent stale async responses from mutating current UI.
- Google/Mapbox travel-time failures degrade popup travel info to `Unavailable` or per-mode `unavailable` without blocking MBTA predictions.

## Running Locally

The app can be opened directly as `mbta/index.html`. A local static server is also fine:

```sh
cd mbta
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Documentation Maintenance Rule

Every model or core behavior change must be reflected in the Markdown docs in this directory in the same change set.

Update `AGENTS.md` and `CLAUDE.md` whenever changing any of these areas:

- route model, route sorting, route badge labeling, or route picker behavior
- MBTA endpoint usage, included relationships, request parameters, retry logic, or abort/staleness logic
- shape selection, representative route-pattern logic, decoded segment structure, or route fitting
- stop model, stop popup contents, prediction grouping/sorting/filtering, or alert sorting/display
- user-location, travel-time, Google Routes, Mapbox Directions, or walking-route behavior
- vehicle polling, `state.vehicleRecords`, marker lifecycle, movement animation, route-aligned offset layout, leader lines, heading arrows, or stop halo behavior
- basemap list, fine-pointer wheel zoom, basemap ghost behavior, map controls, or cache-busting/versioning
- any addition/removal/rename of important fields in the `state` object

Do not leave docs describing removed behavior. In particular, do not reintroduce a near-stop vehicle model unless the code also implements it.

## Maintenance Notes

- Keep this folder dependency-light unless there is a clear need for a build step.
- If changing UI behavior, test mobile and desktop viewport sizes because the map and overlays are absolute-positioned.
- Preserve MBTA route IDs exactly as returned by the API; IDs like `Green-E`, `CR-*`, and ferry route IDs are meaningful.
- Be careful with public API keys. For production use beyond a personal/static demo, move sensitive key handling behind a backend or use strictly restricted frontend keys.
- If performance becomes an issue, keep the 5-second interval focused on vehicles and avoid refetching route geometry/stops/alerts inside the polling loop.
- If the MBTA API changes its response shape, inspect `loadRoutes()`, `getRepresentativeShapeIds()`, `renderRouteShape()`, `renderRouteStops()`, `renderPredictions()`, `renderAlerts()`, and `refreshVehicles()` first.
- Bump only `window.__APP_VERSION__` in `index.html` when shipping JS/CSS changes; do not maintain separate CSS and JS version query strings.
