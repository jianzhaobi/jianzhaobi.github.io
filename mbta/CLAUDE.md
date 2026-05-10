# MBTA Tracker

A web-based real-time MBTA vehicle tracker built with Leaflet.js and the MBTA v3 API.

## Project Structure

- `index.html` — Main HTML shell with route picker, basemap picker, direction legend, alert box, and map container
- `app.js` — All application logic (API fetching, map rendering, vehicle positioning, geolocation)
- `style.css` — All styling including vehicle marker animations (halo breathing), responsive layout
- `AGENTS.md` — AI coding agent instructions

## Key Architecture Decisions

- **Single-file JS**: No bundler, no framework. Pure vanilla JS with Leaflet.
- **Vehicle offset/collision system**: Vehicle circles are rendered offset from the true GPS position along a leader line perpendicular to the nearest route segment. A multi-iteration collision resolver rotates overlapping same-direction vehicles apart.
- **Route shape segments**: Decoded polylines are cached in `state.routeShapeSegments` so vehicle circles can align to rendered road geometry.
- **Direction coloring**: Each direction (0/1) gets a distinct shade derived from the route color. Silver Line is special-cased.
- **Polling**: Vehicles refresh every 5 seconds (`VEHICLE_REFRESH_MS`).

## Vehicle Stop Status & Halo Animation

The halo breathing animation (CSS `vehicle-stop-halo-breathe` keyframes) is controlled by adding CSS classes `at-stop` or `near-stop` to the `.vehicle-offset-marker` div.

Logic flow:
1. `vehicleStopInfo(vehicle, stopLookup)` determines if a vehicle is at/near a stop
2. `createVehicleIcon()` uses the result to set `stopClass`
3. CSS applies the breathing animation only to `.near-stop` and `.at-stop` markers

**Fixed (2026-05-09):** Halo only appears for `STOPPED_AT` vehicles. The "near-stop" concept was removed entirely. Halo color always uses the darker of the two direction colors (`vehicleHaloBase`) via `--vehicle-halo-base` CSS variable, so it's visible regardless of vehicle direction.

## MBTA API Usage

- Base URL: `https://api-v3.mbta.com`
- Key endpoints: `/routes`, `/vehicles`, `/stops`, `/shapes`, `/route_patterns`, `/predictions`, `/alerts`
- Vehicles include `trip` and `stop` relationships
- `current_status` values: `STOPPED_AT`, `IN_TRANSIT_TO`, `INCOMING_AT`

## CSS Animation Details

- `.vehicle-marker::after` — base pseudo-element for all vehicles (opacity: 0, no animation)
- `.near-stop .vehicle-marker::after` — 1.9s breathing, 24% opacity halo
- `.at-stop .vehicle-marker::after` — 1.65s breathing, 34% opacity halo (more prominent)
- `@media (prefers-reduced-motion: reduce)` disables animations
