# MBTA Tracker

A web-based real-time MBTA vehicle tracker built with Leaflet.js and the MBTA v3 API.

## Project Structure

- `index.html` — Main HTML shell with route picker, basemap picker, direction legend, alert box, and map container
- `app.js` — All application logic (API fetching, map rendering, vehicle positioning, geolocation)
- `style.css` — All styling including vehicle marker animations (halo breathing), responsive layout
- `AGENTS.md` — AI coding agent instructions

## Key Architecture Decisions

- **Single-file JS**: No bundler, no framework. Pure vanilla JS with Leaflet.
- **Vehicle offset system**: Vehicle circles are rendered offset from the true GPS position along a leader line perpendicular to the nearest route segment. No collision avoidance — vehicles may overlap at terminals or dense areas in exchange for stable, smooth positioning during zoom.
- **Route shape segments**: Decoded polylines are cached in `state.routeShapeSegments` so vehicle circles can align to rendered road geometry.
- **Direction coloring**: Each direction (0/1) gets a distinct shade derived from the route color. Silver Line is special-cased.
- **Polling**: Vehicles refresh every 5 seconds (`VEHICLE_REFRESH_MS`).

## Vehicle Stop Status & Halo Animation

The halo breathing animation (CSS `vehicle-stop-halo-breathe` keyframes) is controlled by the `at-stop` class on the `.vehicle-offset-marker` div. There is no `.near-stop` class — the "near-stop" concept was removed on 2026-05-09; `vehicleStopInfo()` now only ever returns `kind: "at"`.

Logic flow:
1. `vehicleStopInfo(vehicle, stopLookup)` determines if a vehicle is at a stop (`STOPPED_AT` only)
2. `createVehicleIcon()` uses the result to set `stopClass`
3. CSS applies the breathing animation only to `.at-stop` markers

Halo color always uses the darker of the two direction colors (`vehicleHaloBase`) via the `--vehicle-halo-base` CSS variable, so it's visible regardless of vehicle direction. Animation duration is injected from JS via `--vehicle-halo-duration` (driven by `VEHICLE_HALO_BREATHE_MS`) so the JS-side constant is the single source of truth — don't hardcode a duration in CSS.

## MBTA API Usage

- Base URL: `https://api-v3.mbta.com`
- Key endpoints: `/routes`, `/vehicles`, `/stops`, `/shapes`, `/route_patterns`, `/predictions`, `/alerts`
- Vehicles include `trip` and `stop` relationships
- `current_status` values: `STOPPED_AT`, `IN_TRANSIT_TO`, `INCOMING_AT`

## CSS Animation Details

- `.vehicle-marker::after` — base pseudo-element for all vehicles (opacity: 0, no animation)
- `.at-stop .vehicle-marker::after` — breathes at `var(--vehicle-halo-duration)` (default 1.65s), ~34% opacity halo
- `@media (prefers-reduced-motion: reduce)` disables animations and replaces them with a static halo

## Polling & Marker Lifecycle

- `refreshVehicles` polls `/vehicles` every `VEHICLE_REFRESH_MS` (5 s). It does NOT refetch shapes, stops, or alerts.
- `state.vehicleRecords` is a `Map` keyed by `vehicle.id`. Existing markers are updated in place (`setLatLng` + `setPopupContent`), new ones are added, vanished ones are removed. This preserves any open vehicle popup across polls.
- Polling pauses on `document.hidden` (visibilitychange) and refreshes immediately + resumes on reveal.

## Network Layer

- `fetchMbta(path, params, signal)` retries up to 3× with jittered exponential backoff (~400 ms, ~800 ms) on `429` and `5xx`. Non-retryable client errors throw immediately.
- `selectRoute` owns a single `state.routeAbortController` that aborts in-flight `/shapes`, `/stops`, `/alerts`, and the initial `/vehicles` fetch when the user switches routes. Polling refresh does not use this signal — it relies on the `requestId` pattern to ignore stale responses.
- `AbortError` is thrown by aborted fetches; all consumers explicitly check `error.name === "AbortError"` and return silently rather than logging.
