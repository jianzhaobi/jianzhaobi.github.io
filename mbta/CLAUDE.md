# MBTA Tracker

A static web-based real-time MBTA tracker built with vanilla JavaScript, Leaflet, the MBTA v3 API, Google Routes, Mapbox Directions, and Carto/Esri basemaps.

## Project Structure

- `index.html` — Main HTML shell with map container, route picker, basemap picker, locate/reset controls, alert/details panel, Leaflet CDN load, and shared `window.__APP_VERSION__` cache-busting for CSS/JS.
- `app.js` — All application logic: API fetching, state model, map rendering, route selection, vehicle polling/layout/animation, geolocation, travel-time lookup, and stop/alert popups.
- `style.css` — Full-screen map styling, responsive route panel, route/basemap pickers, stop and vehicle markers, walk-route visuals, and vehicle halo animation.
- `AGENTS.md` — Detailed AI coding-agent documentation. Keep it synchronized with this file.

## Current Architecture

- No backend, bundler, package manager, framework, or build step.
- Leaflet single-page app with all logic in `app.js`.
- Route state is loaded once per route change; vehicle positions poll every 5 seconds.
- Public frontend keys/tokens are hardcoded in `app.js` for MBTA, Google Routes, and Mapbox.

## Core State / Model Summary

Important `state` fields in `app.js`:

- `routes`: normalized MBTA routes from `/routes`.
- `selectedRouteId`: active route.
- `stops`: selected-route stops keyed by stop ID.
- `vehicleRecords`: live vehicle marker records keyed by `vehicle.id`.
- `routeShapeSegments`: decoded route segments used for route-aligned vehicle layout.
- `routeShapeIndex`: segments grouped by shape ID for smoothed tangent lookup.
- `routeAbortController`, `routeRequestId`, `vehicleRequestId`, `stopPredictionRequestId`: abort/staleness guards.
- `activeWalkRouteStopId`: stop whose Google walking route is currently displayed.
- `currentBasemap` and `basemapWheelGhost*`: basemap and fine-pointer wheel-zoom ghost state.

## API Usage

- MBTA v3:
  - `/routes`
  - `/route_patterns?include=representative_trip`
  - `/shapes?filter[route]=...`
  - `/stops?filter[route]=...`
  - `/vehicles?filter[route]=...&include=trip,stop`
  - `/predictions?filter[route]=...&filter[stop]=...&include=trip`
  - `/alerts?filter[route]=...`
- Google Routes API:
  - walking duration and encoded walking-route polyline from user location to selected stop.
- Mapbox Directions API:
  - driving/traffic duration from user location to selected stop.
- Carto/Esri tiles:
  - light, dark, detail, and satellite basemaps.

## Key Behavior

- **Route picker**: custom searchable picker backed by hidden native `select`; route badges are collision-managed by `assignRouteBadgeLabels()` with overrides.
- **Route shapes**: `renderRouteShape()` prefers representative shapes from `/route_patterns`, then falls back to all shapes. Decoded polylines populate both Leaflet route lines and segment caches.
- **Stops**: `renderRouteStops()` creates stop records and popups. Clicking a stop fetches predictions and travel-time info.
- **Predictions**: grouped by direction/headsign, past times ignored, each group limited to the next 3 arrivals.
- **Travel time**: stop popup shows `Walk ... · Drive ...` when user location and API results are available. Google supplies the optional walk-route polyline; Mapbox supplies drive time.
- **Walk route**: popup toggle draws/clears a dotted Google walking polyline in `walkRouteLayer`.
- **Alerts**: loaded on route change, sorted lifecycle-first (`NEW`, `ONGOING`, `ONGOING_UPCOMING`, `UPCOMING`), then by severity and start time. The first lifecycle-prioritized alert colors the alert panel, indicator, and toggle via `data-lifecycle`; individual rows use their own lifecycle state. Not refreshed during vehicle polling.
- **Vehicles**: `refreshVehicles()` polls every `VEHICLE_REFRESH_MS` (5 s), diff-updates `state.vehicleRecords`, preserves open popups when possible, animates normal movement, and removes vanished vehicles.
- **Vehicle layout**: visual vehicle circles are offset from true GPS anchor along the normal of the nearest rendered route segment. A leader line connects the GPS anchor to the visual marker. Heading arrows follow smoothed route tangents when available. There is no collision-avoidance solver.
- **Stop halo**: only `current_status === "STOPPED_AT"` creates an at-stop state. There is no near-stop model and no `.near-stop` class. Only `.at-stop` gets the breathing halo animation.
- **Geolocation**: user location can be shown and followed; manual map movement exits follow mode.
- **Basemaps**: fine-pointer devices use custom wheel zoom with a rasterized basemap ghost to smooth tile transitions.
- **URL**: route changes update `?route=<route-id>` with `history.replaceState()`.

## Network / Async Rules

- `fetchMbta()` retries up to 3 times with jittered exponential backoff on `429` and `5xx`.
- Route switches abort in-flight route-load fetches using `AbortController`.
- `AbortError` is expected during route switches and should be ignored silently.
- Request ID guards prevent stale route, vehicle, and stop-popup responses from mutating current UI.
- Vehicle polling refreshes vehicles only; it does not refetch shapes, stops, or alerts.
- Polling pauses while `document.hidden` and refreshes immediately when visible again.

## Documentation Maintenance Rule

Every model or core behavior change must update Markdown docs in the same change set.

Update both `AGENTS.md` and `CLAUDE.md` when changing:

- `state` fields or data structures
- route, shape, stop, prediction, alert, travel-time, or vehicle models
- MBTA/Google/Mapbox endpoints or request/response handling
- vehicle movement, route-aligned layout, halo logic, leader lines, or heading arrows
- route picker, route badges, basemaps, geolocation, panel UI, or cache-busting
- polling, retry, abort, or stale-response behavior

Do not leave docs describing removed behavior. The near-stop vehicle state was removed and should not be documented unless reimplemented in code.
