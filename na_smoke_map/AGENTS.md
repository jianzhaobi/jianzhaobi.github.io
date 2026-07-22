# North America Smoke and PM2.5 Map

> **Documentation contract:** Every completed project update must update this `AGENTS.md` in the same change so that data sources, filters, behavior, implementation decisions, verification requirements, and dated history remain accurate. Do not commit or push a project update while knowingly leaving this file stale.

## Project purpose

This project provides a browser-based, mobile-friendly map for exploring current and forecast particulate pollution across North America. The sole primary deliverable is `index.html`.

The map must let users independently choose:

- Wildfire-smoke PM2.5 or total PM2.5.
- Surface concentration or entire-atmosphere column loading.
- WFIGS wildfire ignition points, fire perimeters, or both.
- Active wildfires by default, with recently closed incidents available as an explicit optional layer.
- A single always-visible timeline aligned to the current model hour. Use every continuous cached hour available; `Now` may appear anywhere along the track, and the recent-history and forecast sides do not need to be symmetric.

The experience should make the map the dominant visual element and make time exploration fast, smooth, and understandable on both desktop and mobile devices.

## Scientific terminology

Use these definitions consistently in labels, help text, and explanations:

- **Wildfire-smoke PM2.5** is the modeled portion of PM2.5 attributed to wildfire smoke.
- **Total PM2.5** includes modeled PM2.5 from wildfire smoke and other represented sources, such as anthropogenic emissions and other aerosols.
- **Analyzed PM2.5** means a model analysis: the model's best estimate for a particular time after combining a previous forecast with available observations. It is not the same as a direct monitor measurement and is not synonymous with smoke.
- **Surface** products represent near-ground air concentration and use **µg/m³**. These are the most relevant layers for breathing-level air quality.
- **Entire atmosphere** products represent PM2.5 integrated through the full vertical atmospheric column and use **mg/m²**. They show total aerosol loading above each square metre, including elevated smoke that may not affect ground-level air.

Do not compare surface and column numbers as though they used the same physical quantity. Do not describe a column product as ground-level air quality.

## Data source and layer matrix

The application uses Environment and Climate Change Canada GeoMet RAQDPS WMS data:

- Endpoint: `https://geo.weather.gc.ca/geomet`
- Approximate grid resolution: 10 km.
- Forecast cadence: hourly through 72 hours.
- Model runs: 00 and 12 UTC.

Current layer configuration:

| Particles | Vertical extent | WMS layer | WMS style | Display unit |
| --- | --- | --- | --- | --- |
| Wildfire smoke | Surface | `RAQDPS.Sfc_PM2.5-WildfireSmokePlume` | `PM2.5_1to250ugm3` | µg/m³ |
| Wildfire smoke | Entire atmosphere | `RAQDPS.EAtm_PM2.5-WildfireSmokePlume` | `PM2.5_EAtm_1e-7to2e-4kgm2` | mg/m² |
| Total PM2.5 | Surface | `RAQDPS.SFC_PM2.5` | `PM2.5_1to250ugm3` | µg/m³ |
| Total PM2.5 | Entire atmosphere | `RAQDPS.EATM_PM2.5` | `PM2.5_EAtm_1e-7to2e-4kgm2` | mg/m² |

The column style's source quantities are expressed in kg/m², but the interface presents the equivalent, more readable mg/m² scale.

## WFIGS wildfire data

The wildfire overlay is an independent NIFC WFIGS system layered above the RAQDPS smoke canvas. It represents United States incidents that WFIGS classifies as wildfires; it must not be described as a complete wildfire source for Canada or all of North America.

### Official sources and service endpoints

Use the following official ArcGIS items and their layer-0 FeatureServer endpoints under the actual source shard `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services`. Do not use `https://services.arcgis.com/...` as a generic fallback for this organization: it returns `Invalid URL` for these FeatureServer paths even when the HTTP status is 200.

| Purpose | ArcGIS item | Runtime service |
| --- | --- | --- |
| Current incident ignition locations | [Current Incident Locations](https://www.arcgis.com/home/item.html?id=4181a117dc9e43db8598533e29972015) | `WFIGS_Incident_Locations_Current/FeatureServer/0` |
| Current fire perimeters | [Current Fire Perimeters](https://www.arcgis.com/home/item.html?id=d1c32af3212341869b3c810f1a215824) | `WFIGS_Interagency_Perimeters_Current/FeatureServer/0` |
| Year-to-date incident locations | [Year-to-Date Locations](https://www.arcgis.com/home/item.html?id=405814902c9e411cb4384c49d694e82b) | `WFIGS_Incident_Locations_YearToDate/FeatureServer/0` |
| Year-to-date fire perimeters | [Year-to-Date Perimeters](https://www.arcgis.com/home/item.html?id=7c81ab78d8464e5c9771e49b64e834e9) | `WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0` |

The Current services supply the normal live map. The Year-to-Date services supply the incident database, the optional recently closed layer, and on-demand geometry for a database selection. The database intentionally covers only the current calendar year in the first implementation; do not imply that it is an all-years archive.

Every WFIGS request must enforce the official wildfire category:

- Point services: `IncidentTypeCategory='WF'`.
- Perimeter services: `attr_IncidentTypeCategory='WF'`.
- Do not display prescribed fire (`RX`) or complex (`CX`) records as wildfires.

When WFIGS is visible, add the `NIFC WFIGS` item link to Leaflet attribution. Remove the attribution when no persistent or selected wildfire geometry is visible.

### Incident identity and attribute use

Normalize `IrwinID` by trimming whitespace, removing surrounding braces, and lowercasing it. Merge all matching ignition and perimeter features into one event. A valid event may contain:

- Ignition plus one or more perimeter polygons.
- Ignition only.
- One or more perimeters only.

Use a source-and-OBJECTID fallback only when no usable IRWIN identifier exists. Current membership wins over a duplicate recently closed record so the event is not drawn twice.

Point attributes are authoritative when available. Perimeter `attr_*` values and `poly_GISAcres` supplement missing point values. Preserve and display these fields without inventing values:

- `IncidentName`
- `FireDiscoveryDateTime`
- `IncidentSize` in acres
- `PercentContained`
- `ContainmentDateTime`
- `ControlDateTime`
- `FireOutDateTime`
- `FireCause`
- `POOCounty` and `POOState`
- `ModifiedOnDateTime_dt`
- `ICS209ReportStatus`
- `poly_PolygonDateTime`

If a point lacks GeoJSON geometry, use its reported `InitialLongitude` and `InitialLatitude` when both are finite. Missing display values must read `Not reported`; do not infer a cause, date, size, containment, or location.

### Status and map-membership rules

Use the following current implementation order. This order is deliberate because WFIGS Current can retain records whose ongoing ICS-209 reporting has ended:

1. If `ICS209ReportStatus === 'F'` and no containment, control, or out date is present, label the event `Not current`, even if the record remains in the Current service.
2. Otherwise, a Current point or Current perimeter makes the merged event `Active`.
3. For a non-current record, a `FireOutDateTime` makes it `Out`.
4. Otherwise a `ControlDateTime` makes it `Controlled`.
5. Otherwise a `ContainmentDateTime` makes it `Contained`.
6. A year-to-date record with none of those signals is `Not current`, not `Active`.

`PercentContained = 100` remains a reported percentage and is not, by itself, an official closure state. `ICS209ReportStatus = 'F'` indicates final reporting; when WFIGS omits all official end dates, the UI uses the neutral `Not current` label rather than claiming `Contained`, `Controlled`, or `Out`.

The persistent map includes:

- Active events from the Current point and perimeter services, except final-report-only records classified as `Not current` above.
- Year-to-date events whose reported containment, control, or out timestamp falls within the last 24 hours, but only when the user enables `Recently closed · last 24 h`.

Recently closed ignitions and perimeters are hidden by default. The checkbox changes rendering from already loaded memory and must not trigger a new network request. A non-current Current record that is not also in the 24-hour recent set is not made visible by this checkbox.

### Wildfire rendering and interaction

Render WFIGS with Leaflet `L.geoJSON` and a Canvas renderer in a `firePane` above the smoke canvas. Keep perimeter geometry below ignition geometry within that pane, and render a selected database event above normal wildfire geometry.

Ignition styling combines age and reported acreage while keeping the map restrained:

- Discovery age must use a deliberately broad warm range: 0–24 hours deep burgundy red (`#861d1d`), 24–72 hours red (`#bd3426`), 72–168 hours coral-orange (`#e45b2f`), 7–14 days amber-orange (`#ee9138`), and older active incidents light golden yellow (`#f2c75c`).
- Missing discovery time uses the middle red-orange fallback `#d84a2f`.
- Point radii follow compressed NWCG fire-size classes: up to 0.25 acre, under 10, under 100, under 300, under 1,000, under 5,000, and 5,000+ acres map to approximately 3.25–7 CSS pixels.
- The `Large · 300+ acres` database threshold begins at 300 acres, corresponding to the start of NWCG class E. It is intentionally a useful large-incident filter rather than a claim that every 300-acre event is nationally significant.

Active perimeters use a coral-red outline and low-opacity fill. Recently closed geometry uses a gray-brown hollow point or dashed perimeter. Hover increases point size or perimeter emphasis. A selected database incident receives a larger, stronger non-flashing highlight. Do not add a permanent wildfire symbol legend; the Layers menu should remain compact and the popup/list must always state the status in text.

Sort ignition features by `FireDiscoveryDateTime` ascending before adding them to the shared Leaflet Canvas renderer. Treat a missing or invalid discovery time as oldest and use OBJECTID as a stable tie-breaker. Because Canvas draws later features above earlier ones, this guarantees that the newest ignition is visually and interactively above every older overlapping ignition after initial render and every zoom redraw. A deliberately selected database incident remains above the normal time ordering.

Ignitions and perimeters have independent checkboxes. Turning Wildfires off removes persistent wildfire layers and their popup, but a fire deliberately selected from the database may still be temporarily displayed. Smoke and Wildfires also remain independently selectable; turning both off leaves only the basemap.

Fire interaction has priority over the pollution probe:

1. Ignition point.
2. Perimeter when no ignition hit is present.
3. Smoke/PM2.5 point probe when no wildfire geometry handled the event.

Keep ignition layers above perimeter layers, stop Leaflet event propagation on wildfire clicks, mark handled pointer events, and suppress the smoke probe while a wildfire geometry is hovered. The Canvas renderer uses a modest hit tolerance so desktop and touch interaction remains practical. Hover must visibly respond on desktop.

Clicking either geometry of the same merged event must produce the same popup data and status. Anchor an ignition click at the point and a perimeter click at the clicked polygon location. Build all WFIGS-derived popup text with DOM nodes and `textContent`, never raw HTML. The card contains incident name, textual status, discovery time, acres, percent contained, county/state, cause, last update, and whether ignition, perimeter, or both are available.

The map itself permits integer zoom through level 17, while basemaps advertise their native higher limits. A database perimeter selection fits all matching polygons with a maximum fit zoom of 15; a point-only selection flies to integer zoom 13. Do not reintroduce a regional maximum zoom that prevents city- or incident-level inspection.

### Wildfire database drawer

The `Fires` control opens a right-side desktop drawer or mobile bottom sheet. On phones, selecting a record closes the sheet before showing the mapped incident.

Database behavior:

- Load the live database lazily on first open; do not add an eager startup request.
- Use a bounded 24-page in-memory cache with a five-minute lifetime for successful query/filter/sort/page combinations.
- Persist at most 12 recently successful database pages for 24 hours in local storage solely as a stale-on-error fallback. A live response always replaces the stored page; a stored page must be labeled `cached` and used only when live WFIGS is unavailable or rate-limited.
- Default to `FireDiscoveryDateTime DESC, OBJECTID DESC`.
- The sort icon toggles between newest discovery first and `IncidentSize DESC, FireDiscoveryDateTime DESC, OBJECTID DESC`.
- Keep the sort button neutral white with accent text/border in both modes; do not reuse the generic solid-orange `aria-pressed` button treatment.
- Fetch 50 visible records plus one look-ahead record and require an explicit `Load more` action.
- Debounce incident-name search by approximately 300 ms and escape SQL quote characters.
- Provide All, Active, Contained, Controlled, and Out status filters plus an independent `Large · 300+ acres` toggle.
- All, Contained, Controlled, and Out query the Year-to-Date location service.
- Active queries the Current location service and excludes final ICS-209 reports with `(ICS209ReportStatus IS NULL OR ICS209ReportStatus <> 'F')`.
- Contained means containment is present while control and out are absent. Controlled means control is present while out is absent. Out means out is present.
- Cancel obsolete search, filter, sort, pagination, and selection requests with `AbortController` and generation counters. Late results must not overwrite the latest user action.
- A reset request must leave the previously rendered rows in place until its replacement page succeeds. On failure, report temporary unavailability, keep the current list, and make Retry repeat the pending reset rather than append duplicate rows.
- Database list queries use `f=json` with `returnGeometry=false` to reduce payload and request cost. Convert ArcGIS `attributes` to internal GeoJSON-like features and reconstruct the selected point from `InitialLongitude` and `InitialLatitude`; selection may still request a Year-to-Date perimeter normally.
- Database queries get up to three attempts against the valid shard host. On ArcGIS error code 429, do not burn retries inside the same quota window: use an available stored page immediately, or wait once for the server-specified interval—approximately 60 seconds—then retry. Closing the drawer must abort that wait.

Selecting a database record queries all Year-to-Date perimeter polygons with the same `attr_IrwinID`. Draw both ignition and every matching perimeter when available, including for an older event not normally visible. Fit perimeter bounds, fall back to the ignition point, or retain the current map and report `Location unavailable` when neither exists. Keep the temporary selection until the popup is closed, another event is selected, or the selection is otherwise cleared.

### WFIGS performance, refresh, and caching policy

WFIGS currently loads directly from the official ArcGIS FeatureServer. Do not add a static wildfire cache unless measured production behavior shows that the official service is a material user-facing bottleneck. The 2026-07-22 investigation found acceptable direct response times, so a new Pages cache, workflow, or committed wildfire artifact was not justified.

The current lightweight client strategy is:

- Keep live points, recent records, and perimeter geometry in page memory. Cache at most 24 successful database pages for five minutes and evict the oldest entry at the limit. The only browser-persistent WFIGS data is the bounded 12-page, 24-hour database fallback described above; never treat it as live data.
- On first load, fetch full display-simplified Current and recent perimeter GeoJSON directly, avoiding a fragile index-plus-geometry request burst.
- On later refreshes, fetch a lightweight `OBJECTID`, polygon-time, and modified-time index, reuse unchanged geometry from `firePerimeterCache`, request only new or changed object IDs, and remove records no longer returned by Current.
- If the incremental perimeter path fails, retry a full perimeter query. If one perimeter source still fails, retain cached geometry and current points and report a partial refresh rather than clearing the map.
- Request `outSR=4326`, `geometryPrecision=5`, and `maxAllowableOffset=0.0001` for displayed perimeters.
- Retry normal ArcGIS map-layer requests against the valid `services3` shard up to three total attempts, using bounded 300 ms and 700 ms backoffs. Abort errors are never retried. For database 429 errors, follow the explicit cache-or-one-quota-window-wait behavior above instead of normal short retries.
- Use a 45-second refresh controller timeout, request generation checks, and sequential same-host point requests to reduce contention.
- Load Active points first so useful wildfire locations can appear while perimeter geometry continues loading.
- Refresh while the page is visible every five minutes. On `pageshow` or visibility resume, do not start a second refresh while one is already running.
- Preserve the old wildfire layer on any refresh failure and expose a concise Layers-menu error plus `Retry`.

The map's manual refresh button is a unified action: it must refresh the smoke cache manifest/data path and WFIGS wildfire data together. Clear the database page cache, mark the visible list for replacement, and reload it immediately when the drawer is open or on the next drawer open when it is closed. Its accessible name is `Refresh smoke and wildfire data`. Report success only if both primary systems succeed, partial success if one succeeds, and retain current visible data for any failed source.

Do not change `scripts/build_static_cache.py`, the schema-v5 smoke cache format, or `.github/workflows/deploy-pages-with-smoke-cache.yml` merely to support WFIGS. Smoke cache behavior and wildfire in-memory caching are separate systems.

### 2026-07-22 wildfire implementation record

The following work was completed and pushed on 2026-07-22:

- `c46a6dd` added the four official WFIGS sources, mandatory WF filtering, normalized IrwinID merging, active and recent map layers, ignition/perimeter-independent records, popup cards, Layers controls, NIFC attribution, the Year-to-Date database drawer, search, status filters, pagination, sorting, large-fire filtering, on-demand historical geometry, and in-memory refresh/cancellation logic.
- `6ede96b` corrected wildfire hover and click handling, established ignition-over-perimeter-over-smoke click priority, increased Canvas hit tolerance, made ignition and perimeter popup content identical for one event, added independent ignition/perimeter visibility, added age colors and NWCG-derived size radii, added the 300-acre large-fire filter and date/size sort control, increased map zoom capability for city- and perimeter-level inspection, and connected the existing map refresh control to smoke and wildfire together.
- `380d938` removed the wildfire symbol legend, made recently closed geometry opt-in, corrected old Year-to-Date events that were being labeled Active, added the neutral `Not current` state and final ICS-209 handling, made Active filtering use the Current service while excluding final reports, fixed the mobile sort button's solid-orange state, reduced ArcGIS request bursts, added retry/full-query fallback behavior, and fixed a startup race in which `initialize()` and `pageshow` started competing WFIGS refreshes and aborted one another.
- A later 2026-07-22 reliability and visual-order follow-up moved the primary WFIGS hostname to ArcGIS's generic routing endpoint with the original shard as an alternating fallback, added five-attempt database recovery, five-minute bounded page caching, and old-row retention during failed resets. It also expanded ignition age colors from deep red through light golden yellow and explicitly sorted ignition drawing oldest-to-newest so the newest event always remains on top across zoom redraws.
- A subsequent 2026-07-22 diagnosis found that the generic hostname did not route this WFIGS organization at all and that the valid `services3` shard was periodically returning ArcGIS code 429 after the organization exceeded its 57,600 request-unit-per-minute quota. The corrective follow-up removed the invalid hostname, changed list pages to attribute-only JSON, made 429 recovery respect the reported 60-second quota window, and added a clearly labeled bounded 24-hour local fallback so a previously loaded list remains usable during a transient WFIGS outage.

During the initial service-health investigation, direct official queries returned HTTP 200 for all four services. A volatile diagnostic snapshot contained approximately 472 Current WF locations, 169 Current WF perimeters, 266 recently ended Year-to-Date locations, and 38 recently ended Year-to-Date perimeters. Full Current perimeter GeoJSON was roughly 2.5 MB and completed in several seconds. These numbers are diagnostic history, not application constants. A later recurrence captured the authoritative failure: the shard returned ArcGIS code 429 with 63,925 request units consumed against a 57,600-per-minute organization limit and explicitly requested a 60-second retry. After that interval, the count query recovered to 23,694 WF records and a 51-record page returned normally. The generic hostname continued returning `Invalid URL`; a deployed browser could appear healthy only because it had a cached page. This evidence supersedes the earlier assumption that generic routing was a valid redundant host.

## Rendering architecture

Use Leaflet with three selectable basemaps:

- **Day**: CARTO Positron, and the default.
- **Dark**: CARTO Dark Matter.
- **Satellite**: Esri World Imagery.

Preserve the corresponding Leaflet, OpenStreetMap, CARTO, and Esri attribution.

Frame the initial map around the United States and Canada instead of showing the full RAQDPS data domain. Use a comparable regional scale on desktop and mobile, while allowing a slightly wider integer zoom on narrow screens so the view remains useful.

### Data-frame rendering

Do not render the RAQDPS data as a tiled Leaflet WMS layer. GeoMet reprojection of the full-column product into individual Web Mercator tiles produced large, solid yellow triangular or rectangular artifacts near model-domain boundaries.

Instead:

1. Request each data frame as one transparent WMS `GetMap` PNG for the fixed North America bounds.
2. Request the image in `EPSG:3857` and display it with `L.imageOverlay` using the matching geographic bounds.
3. Keep the transparent column style `PM2.5_EAtm_1e-7to2e-4kgm2` for both column products.
4. Keep the displayed North America data bounds at approximately `[[16, -170], [76, -52]]` unless a deliberate coverage change is requested.

This full-frame approach is an intentional correctness fix. Do not revert to `L.tileLayer.wms` without proving that projection-boundary artifacts have been eliminated.

### Concentration palette

The user-facing data palette is intentionally different from the official ECCC multi-hue legend:

- Low concentrations should become fully or nearly transparent.
- Wildfire-smoke concentrations should progress through light amber, orange, burnt orange, and dark reddish brown.
- Total PM2.5 should use a clearly distinct monochromatic yellow-brown palette. Vary only lightness and alpha within that single hue family; do not introduce purple, violet, blue, or a second hue.
- Even the darkest concentrations retain some alpha so geographic context remains visible.

Request the artifact-free official WMS PNG, load it with CORS enabled, draw it to an offscreen canvas, infer each pixel's position along the official multi-hue ramp, and recolor it into the particle-specific alpha ramp. Keep the processed canvas as the render source; do not encode a temporary browser-side PNG when the WebGL overlay can consume the canvas directly.

Do not depend on a custom WMS `SLD_BODY` for per-break transparency. GeoMet accepted the custom color ramp during testing but did not honor the intended per-entry alpha reliably, which painted the model domain as an opaque pale polygon.

### Forecast animation

Render pollution through one persistent Leaflet-aligned canvas:

- Subclass `L.ImageOverlay` with a canvas so Leaflet continues to own geographic positioning, zoom animation, pane placement, attribution, and z-index.
- Use two WebGL textures inside that one canvas. Convert each sampled straight-alpha color to premultiplied alpha in the fragment shader, then interpolate the premultiplied RGBA values with a uniform mix amount.
- Do not animate two transparent DOM images with independent CSS opacity. Their combined alpha dips at the midpoint and makes the basemap flash through even when both opacity transitions are linear.
- Keep canvas opacity constant. Apply the global data opacity inside the shader to both RGB and alpha.
- Keep the canvas backing dimensions fixed at the display-frame size. Uploading a preview or replacement texture must not resize and clear the visible drawing buffer.
- Use a mathematically equivalent additive premultiplied-alpha blend in the Canvas 2D fallback.
- Settle every render promise on success, cancellation, drawing failure, or WebGL context loss. A failed render must never leave future timeline requests waiting on a rejected or permanently pending queue tail.
- Coalesce asynchronous full-frame loads so the latest requested hour wins. Generation checks must run after every asynchronous boundary, and stale loads must never update frame state, labels, or status.
- Preload the following full-resolution hour whenever practical, but keep prefetch independent of the visible canvas.
- On a failed or timed-out frame, retain the previous visible map and show a concise status message.

Playback should advance without a vacant flash or brightness pulse between frames. Run the shader interpolation for approximately 900 ms and begin the next ready transition on the following animation frame without a fixed dwell. At the end of the available forecast, return to the current model hour and continue playing. Switching particle type or vertical extent during playback must preserve the selected hour and resume playback after the replacement dataset has loaded; keep the previous visible frame in place during that load. The Reset control stops playback and returns to the current model hour. Respect `prefers-reduced-motion` by removing or reducing transitions and slowing automated playback appropriately.

The likely model reference time is selected conservatively by allowing roughly seven hours for a run to become available, then choosing the latest 00 or 12 UTC cycle. Forecast requests include both `TIME` and `DIM_REFERENCE_TIME`.

### Static Pages frame cache

The production cache is a same-origin GitHub Pages deployment artifact, not browser storage and not committed binary data:

- `.github/workflows/deploy-pages-with-smoke-cache.yml` runs hourly, on pushes, and on manual dispatch.
- `scripts/build_static_cache.py` downloads the latest bounded set of raw, transparent WMS PNGs for all four particle/extent combinations.
- Cache up to 64 valid hours on either side of the current model hour. The actual future side may be shorter near the end of a model run.
- Generate a schema-v5 manifest containing the four datasets' common, continuous `timelineHours` coverage and lossless WebP field-atlas metadata. At runtime, never expose an hour whose cached field is missing for any selectable dataset.
- Do not reject an otherwise complete schema-v5 cache merely because its manifest is more than four hours old. Align the browser's current integer model hour to the matching cached absolute valid time, translate manifest-relative field hours into current-relative slider hours, and expose the entire continuous range. For example, a `-59…+59` cache delayed by four hours becomes `-63…+55`; `Now` moves right while all 119 cached hours remain usable.
- Keep `Now` available at any track position, including an endpoint. Only abandon the schema-v5 timeline when the current valid hour lies outside its continuous cached coverage or a required field asset fails validation. Use direct GeoMet only after that cached-field path is unavailable.
- Make delayed-cache use clear in accessible status text. Do not imply that an older model run is newly produced data; the displayed valid hour remains exact, while the cache refresh may be delayed.
- Restore the newest rolling GitHub Actions frame cache before each build and save the refreshed bounded set afterward. GeoMet currently advertises roughly 48 hours of reference cycles, so retaining still-needed frames from prior scheduled runs is what allows the deployed artifact to maintain historical coverage without committing binaries.
- Keep the cache build's minimum success ratio at 80% on every run. A few edge-hour or transient GeoMet failures must not block publication of an otherwise valid common timeline; the manifest still exposes only the continuous symmetric hours present for all four datasets.
- Run the Pages cache workflow hourly. Most hourly runs reuse the rolling raw and display caches and mainly advance the manifest's `Now`; the heavier frame refresh occurs when a new 00 or 12 UTC model run becomes available.
- Keep source WMS PNGs only in the rolling GitHub Actions cache. Publish `cache/manifest.json` and content-addressed `cache/fields/v5/` assets inside the Pages artifact when R2 is not configured; do not publish per-hour display PNGs or commit generated binary data to Git history.
- Build full-source-grid field packs for every dataset from the common timeline hours. Each lossless WebP atlas stores up to three consecutive 1000 × 625 hours in RGB channels, with the alpha-weighted scalar field in its top half and coverage in its bottom half. Keep decoded field values byte-for-byte equivalent to the source field pack.
- For the selected dataset, load every field atlas before enabling the timeline. Retain at most one decoded field dataset in memory. Dragging, playback, previous/next, Reset, and release snapping must all sample these same full-grid fields through the persistent WebGL canvas; never render a low-resolution scrub preview and never fetch or swap to a separate full-frame image when dragging ends.
- Validate the 1000 × 625 field dimensions, 1000 × 1250 atlas dimensions, three-hour RGB packing, paths, uniqueness, current-hour alignment, and complete continuous runtime coverage. Fully decode every selected-dataset atlas before enabling timeline interaction.
- If WebGL is unavailable, reconstruct the same palette through the Canvas 2D field fallback. Use direct GeoMet only when the schema-v5 field timeline or a required atlas is unavailable, without clearing the currently visible frame.
- Schema-v5 point probes sample the weighted scalar and coverage fields at the displayed temporal mix. Direct-GeoMet fallback frames keep the original per-pixel value grid.

This arrangement avoids user-device persistence, keeps Git history small, reduces GeoMet latency during normal use, and allows a partial cache to degrade safely.

### Deferred Pages workflow resilience

Do not change `actions/configure-pages` as part of the non-symmetric timeline and touch-target update. Keep these items as a future deployment-resilience TODO and remind the user when a later task concerns Pages failures, repeated cache publication failures, or hosting reliability:

- Move `Configure GitHub Pages` out of the cache-build critical path and into the deploy job so a transient Pages API failure cannot prevent source-cache refresh and field generation.
- Add bounded retries with backoff around Pages configuration and deployment.
- Consider publishing the latest manifest as well as immutable field atlases through R2 so successful cache builds do not depend on a Pages deployment.
- Add an external freshness/asset health check and alert only after repeated failures or a materially delayed manifest.

Discuss the exact workflow design with the user before implementing these deferred items.

### Spatial and temporal interpolation

Interpolation is a presentation treatment and must not be described as creating new atmospheric information:

- Infer the scalar ramp position first, alpha-weight it by source coverage, and apply a restrained Gaussian blur to the scalar and coverage fields before packing them at build time. Smoothing the scalar field rather than already-colored pixels removes high-concentration stair steps while preserving a continuous plume. This is display smoothing, not a higher-resolution forecast.
- Keep the original 1000 × 625 WMS image as the scientific source grid. In normal schema-v5 operation, upload the pre-smoothed fields from the decoded WebP atlases and use GPU linear spatial sampling to render them into the fixed 1500 × 938 display canvas. Reconstruct the scalar position from weighted value and coverage, then apply the selected monochromatic palette in the shader.
- Linearly interpolate premultiplied pixel color and alpha from the two adjacent field hours in the single WebGL canvas over approximately 900 ms during playback. Start the next ready hour on the following animation frame so the animation has no fixed pause between frames.
- Keep visible timeline labels and resting thumb positions on integer model hours. During pointer dragging, allow a fine-grained internal slider value and synchronously set the adjacent field hours, channel masks, and fractional shader mix. On release, snap to the nearest integer hour without changing render source, resolution, canvas, or image quality.
- Dragging must follow the pointer in either direction and during random jumps without debounce, delayed network requests, or a post-release clarity swap. Every intermediate and resting state must use the same smooth full-grid field renderer.
- Disable visual interpolation transitions when `prefers-reduced-motion` is active.

Do not call the spatial smoothing a 1 km forecast, and do not call interpolated states new 10-minute or sub-hourly model outputs. Neither treatment creates new atmospheric information.

### Point-value interaction

Clicking or tapping a visibly rendered concentration pixel inside the modeled North America bounds should open a compact Leaflet popup:

- Infer an approximate displayed value from the original ECCC rendered color ramp before the pixel is recolored.
- Keep a `Float32Array` value grid on each direct-GeoMet processed frame.
- Convert the clicked latitude/longitude through the same Web Mercator bounds used by the WMS image before indexing the grid.
- Show the active frame's particle type, vertical extent, and inferred value with the correct unit on three separate lines. Do not display the valid time.
- Show the inferred numeric value without an `≈` prefix. Keep the implementation and accessible context clear that values are inferred from rendered colors rather than read from the raw model field.
- Show a compact popup close “×” on desktop and mobile so users can dismiss the concentration reading deliberately. Clicking elsewhere on the map should still dismiss or replace the popup.
- Treat pixels whose processed display alpha is effectively transparent as below the display threshold.
- Clicking a transparent, below-threshold, no-data, or out-of-bounds location should show nothing and close any existing concentration popup.

## Interface and visual preferences

The desired direction is a modern, map-first weather interface inspired by The Weather Network's fire-and-smoke map, without copying branding or site chrome.

Maintain these preferences:

- Light daytime basemap by default, with compact options for dark and satellite maps.
- Warm orange/coral primary accent rather than a generic bright blue interface.
- Compact icon-led floating controls. Keep smoke, ignition, perimeter, and recently closed visibility plus particle/extent fields inside the temporary Layers menu; keep basemap choices inside the temporary Map menu so closed controls occupy very little map space.
- Keep the separate Fires control for the WFIGS Year-to-Date database. Do not put a permanent wildfire-symbol legend in the Layers menu.
- Horizontal color scale rather than a tall official legend that consumes map space.
- Keep the horizontal legend compact—roughly 320 px on desktop and narrower on phones—so it does not obscure a large portion of the map.
- Forecast controls and time slider integrated as a floating bottom panel over the map.
- Keep the legend, valid time, frame status, playback controls, and forecast slider fused into one coordinated bottom panel.
- Keep the visible valid-time line compact while preserving weekday, month/day, time, and timezone while omitting the year; prefer a form such as `Sat · Jul 18 · 12:00 PM EDT`. Keep the fully expanded localized timestamp, including the year, in accessible labels.
- Keep a concise frame-status dot inside the forecast panel: green when the selected frame is ready, orange/pulsing while it loads, and red when unavailable.
- Rounded corners, compact spacing, readable typography, and clear selected states.
- Minimal explanatory chrome; keep the geographic data visually dominant.
- Native, accessible selects and buttons with visible keyboard focus.
- Clear loading, loaded, partial-failure, and unavailable states.

The custom horizontal legend should use the same particle-specific progression as the processed data—orange/brown for wildfire smoke and monochromatic yellow-brown for total PM2.5—and track the appropriate surface or column scale and unit.

## Responsive behavior

Cell-phone usability is a core requirement, not a later enhancement.

- The page must not overflow horizontally at narrow widths.
- Controls stack into a single column on small phones.
- Touch targets should remain at least approximately 38 px high.
- The legend must fit within the map width.
- Closed Layers, Fires, and Map controls should be icon-led on phones; icon-only controls require accessible names.
- Keep the basemap menu programmatically labeled, but do not display a visible “Basemap” heading inside the open menu.
- Keep the zoom controls vertically centered along the right edge and place a compact location control directly beneath them.
- Render the range track explicitly instead of relying on platform-native styling. The elapsed side uses the coral accent and the future side uses the same light neutral gray on desktop and mobile.
- Give the timeline range input a generous mobile touch box of about 40 px without making the visual track heavy. Preserve the original neutral white thumb, subtle border, and shadow; increase its mobile visual diameter only slightly to approximately 24 px, keep clear space above the time labels, and retain a keyboard focus ring.
- After location permission is granted, show the user's current location as a modern blue dot with a restrained accuracy halo. Each location-button press should refresh the position and zoom to it; if permission was already granted, show the dot without prompting or changing the initial map view.
- Forecast controls must remain usable without covering all meaningful map content.
- The map receives additional vertical height on phones to accommodate floating controls.
- Labels may wrap, but controls and scale values must not be clipped.

Test at a representative desktop viewport and at phone widths around 320–390 px whenever browser tooling allows.

## Accessibility and copy

- Keep programmatic labels for the map, selects, slider, frame status, and playback buttons.
- Update the map's accessible name with the selected particles, vertical extent, and valid time.
- Use `aria-live` for concise data-loading and valid-time feedback.
- Use `aria-pressed` for Play/Pause state.
- Keep previous and next controls labeled even if their visible content is only an arrow.
- Keep Leaflet zoom controls vertically centered along the right edge of the map.
- Give the location control an accessible label and concise live feedback for loading, success, denied permission, timeout, or unavailable geolocation.
- Give Layers, Fires, wildfire geometry toggles, recent-fire visibility, database search/filter/sort/pagination, wildfire Retry, and the unified smoke/wildfire refresh control programmatic labels and visible keyboard focus.
- Do not rely on color alone to communicate selection or loading state.
- Prefer plain-language labels such as “Entire atmosphere” and “Column loading.”

## Implementation conventions

- Keep all application markup, styling, and runtime logic in `index.html`. The only local runtime companions are the generated static cache manifest, fallback frames, and field packs; build and deployment automation live outside the application file.
- Apply every future application, feature, design, and bug-fix update directly to `index.html`.
- Do not create or maintain a duplicate standalone HTML entry point such as `north-america-smoke-forecast.html`.
- Use plain HTML, CSS, and JavaScript; do not introduce a build step without a clear need.
- Scope component styles beneath `#north-america-pm25` to avoid host-page collisions.
- Use CSS custom properties for page and interface colors so the visualization can inherit a host theme.
- Keep external resource URLs HTTPS-only.
- Keep the static cache manifest and frame URLs relative to the deployed `na_smoke_map/` path so they work on the `jianzhaobi.github.io` project site.
- Preserve the current particle/extent dataset matrix as a single source of truth in JavaScript.
- Use `Intl.DateTimeFormat` for local and UTC timestamps rather than manually formatting dates.
- Clamp timeline offsets to the full continuous range after aligning the manifest's cached valid hours to the browser's current integer model hour. Present the current-hour slider position as “Now” wherever it falls, earlier positions with negative relative hours, and later positions with positive relative hours.
- Use generation counters or an equivalent cancellation mechanism so stale asynchronous image loads cannot replace a newer user selection.
- Preserve the default `day` basemap and the `day`, `dark`, and `satellite` basemap option values.
- Keep fallback canvas recoloring off the visible layer and return the processed offscreen canvas directly to the WebGL renderer so the visible frame is never cleared while recoloring occurs.
- Use integer Leaflet zoom levels (`zoomSnap: 1`) for raster basemaps. Fractional zoom scaling exposed visible tile seams.
- Keep basemap tiles at their native size and use only a transparent outline seam guard; do not enlarge tiles, which made grid lines more visible.
- Preserve Leaflet's 250 ms zoom-transform transition on the pollution canvas. Pollution opacity remains constant at the DOM layer; temporal interpolation belongs inside the WebGL shader.
- Apply `will-change: transform` to the pollution canvas so the browser can keep zoom transforms on the compositor.

### Required AGENTS.md maintenance

`AGENTS.md` is the durable implementation record and must change with every completed project update. This requirement applies to every future feature, bug fix, design adjustment, data-source or schema change, filtering or status change, cache or performance change, interaction change, script change, deployment/workflow change, and material verification finding.

- Update the relevant normative section so it describes the implementation that will exist after the change, not merely the earlier plan.
- Add or update a dated implementation record when the reason, migration history, measured behavior, incident diagnosis, or tradeoff would help a future maintainer understand why the implementation exists.
- Update source URLs, service names, field names, query filters, thresholds, refresh intervals, cache rules, UI defaults, and verification steps whenever any of them changes.
- Remove or clearly supersede stale instructions that conflict with the new behavior.
- Include the `AGENTS.md` edit in the same commit as the corresponding project change whenever practical. A completed update must not be committed and pushed while leaving this file knowingly out of date.
- Before handoff, explicitly compare the final diff against this document and confirm that all material behavior is represented here.

When editing files in this workspace, use `apply_patch` for manual changes and preserve unrelated user work.

After every completed and verified project update, commit the in-scope changes and push the current branch to its configured GitHub remote before handing off. Do not leave completed project updates only in the local worktree.

## Verification checklist

Before handing off a material change:

1. Check the embedded JavaScript for syntax errors.
2. Load the standalone HTML through a local HTTP server rather than relying only on a `file:` URL.
3. Confirm all four particle/extent combinations reach the loaded state.
4. Visually inspect wildfire smoke + entire atmosphere for yellow projection wedges, rectangles, or other model-domain artifacts.
5. Scrub across every available side of the possibly non-central Now position, use previous/next, Reset, and play several frames.
6. Confirm the previous frame remains visible while the next frame loads and that there is no vacant flash.
7. Confirm the horizontal legend title, scale, and units update correctly.
8. Confirm the timeline is always visible, places “Now” at its correct possibly non-central position, and has correct Play/Pause and Reset states and accessible labels.
9. Check desktop and phone layouts for clipping and horizontal overflow.
10. Check the browser console and data status for relevant errors.
11. Switch among Day, Dark, and Satellite and verify both appearance and attribution.
12. Confirm light concentrations remain transparent, wildfire smoke uses the monochromatic orange/brown ramp, and total PM2.5 uses the distinct monochromatic yellow-brown ramp without hiding the basemap completely.
13. Inspect the daytime basemap for tile-grid seams at the initial zoom and after zooming.
14. Click a plume pixel and verify the popup shows pollutant type, vertical extent, and inferred concentration on three lines with the active layer's unit, without an approximation symbol or time. Verify its close “×” works on desktop and mobile. Then click a transparent or no-data pixel and verify that no popup remains.
15. During playback, confirm there is exactly one pollution canvas and no pollution `<img>` overlays. Inspect several transition midpoints for brightness pulses or vacant flashes.
16. Drag the slider slowly forward and backward, then rapidly across random positions. The thumb and plume must track continuously during pointer movement, visible hour labels and release positions must remain integer hours, and every intermediate and resting state must keep the same fixed high-resolution canvas and smooth full-grid field source. Confirm that release causes no delayed full-frame request, clarity swap, or temporal jump.
17. Zoom in and out repeatedly over a distinct plume edge; confirm the basemap and pollution canvas scale and settle together without visible lag.
18. Confirm the initial view focuses on the United States and Canada at desktop and phone sizes, and that the location control displays a blue current-location marker and zooms to it after permission is granted.
19. Confirm playback loops from the final forecast frame to Now and continues, and switch pollutant or vertical extent during playback to verify the current hour is preserved and animation resumes without a blank map.
20. Validate a generated schema-v5 cache manifest and lossless weighted/coverage WebP atlas set. Confirm that a delayed manifest is re-aligned without discarding valid hours, the page loads only the selected dataset's field atlases before enabling the timeline, performs no field or GeoMet request when dragging or releasing, and still falls back safely when a field asset is absent.
21. Confirm every Current and Year-to-Date WFIGS request contains its correct WF category filter and that no RX or CX event appears.
22. Exercise WFIGS point-only, perimeter-only, point-plus-perimeter, multiple-polygons, missing attributes, missing geometry with reported initial coordinates, missing location, duplicate IrwinID, and perimeter-only event cases.
23. Confirm status priority for final ICS-209/Not current, Current/Active, Out, Controlled, Contained, and fallback Not current. Test the exact 24-hour recent boundary and confirm `PercentContained = 100` alone does not create an end state.
24. Confirm recently closed ignition and perimeter geometry is hidden on first load, appears immediately without a request when its checkbox is enabled, and disappears again without changing Active geometry.
25. Confirm Ignitions, Perimeters, Wildfires, and Smoke switches work independently in all meaningful combinations, including a database-selected temporary event while persistent Wildfires is off.
26. Hover and click both active and recently closed ignition/perimeter geometry. Confirm hover emphasis works, ignition wins over an overlapping perimeter, perimeter wins over smoke when no ignition is hit, and wildfire clicks never open the PM2.5 probe. Create overlapping old/new ignition cases and verify the newest point is visibly and interactively on top before and after multiple zoom redraws.
27. Confirm ignition and perimeter clicks for one IrwinID show identical status and incident attributes, use safely constructed DOM text, and anchor the popup at the appropriate point or polygon click.
28. Open the wildfire database on desktop and phone; test at least ten fresh early-page opens, 300 ms name search, all status filters, the independent 300+ acre filter, 50-record Load more pagination, newest-first and acreage-first ordering, and rapid consecutive actions whose stale responses arrive late. Confirm cached repeat queries return immediately, attribute-only JSON records still locate through reported initial coordinates, and a failed reset retains existing rows without duplicate Retry results.
29. Select active, recently closed, older Not current, point-only, perimeter-only, and multi-polygon database events. Confirm the map fits or flies to the available geometry, temporarily draws an otherwise hidden incident, closes the phone sheet, and reports `Location unavailable` without moving when necessary.
30. Confirm large year-to-date fires with final ICS-209 reports or no live membership do not appear as Active, and confirm the Active filter uses the Current service while excluding final reports.
31. Test a fresh WFIGS load, five-minute/visibility refresh, Layers-menu Retry, and the unified manual smoke-and-wildfire refresh. Confirm no startup `pageshow` race, no duplicate active refresh, only the valid `services3` host is used, old geometry survives failures, and success/partial/error feedback matches the actual two-source result.
32. Inspect WFIGS request count and payload behavior: initial full simplified perimeter query, later unchanged-geometry reuse, changed-ID fetches, removal of expired Current records, full-query fallback after incremental failure, five-minute database-page reuse, 24-page eviction, explicit memory-cache clearing during unified manual refresh, and bounded 12-page persistent fallback retention.
33. Simulate an ArcGIS code-429 database response with and without a stored page. With a stored page, confirm immediate clearly labeled cached rendering and no rapid retry loop. Without one, confirm a single abortable wait using the reported retry interval, a successful retry after recovery, and immediate cancellation when the drawer closes.
34. At 320–390 px widths, verify the Fires bottom sheet, Layers checkboxes, filter wrapping, search/sort row, neutral sort-button background in both modes, popup width, timeline coexistence, and absence of horizontal overflow.
35. Confirm `AGENTS.md` was updated for the current project change and no instruction in it contradicts the final code, data behavior, or workflow.

## Known tradeoffs

- A single 1000 × 625 WMS image per frame avoids tile artifacts, stays close to the approximate 10 km model resolution, and lowers client processing cost, but it will become pixelated at unusually deep zoom levels.
- Preloading all full-grid field packs for the selected dataset increases its initial transfer and decoded-memory cost, but it removes timeline-time image loading and guarantees consistent spatial quality while dragging. Three-hour RGB packing, one decoded dataset at a time, and four WebGL field textures bound normal client memory.
- Direct-GeoMet fallback recoloring adds CPU work before a frame becomes ready. It belongs on an offscreen source canvas so it cannot clear the persistent visible WebGL canvas.
- The Pages cache is refreshed on a schedule rather than continuously. Runtime GeoMet fallback is required for gaps between publication and the next successful deployment.
- The fixed image bounds intentionally focus the product on North America. Expanding coverage requires recalculating the matching Web Mercator WMS bounding box and validating the image overlay alignment.
- WFIGS service membership is not a perfect synonym for actively burning. Final ICS-209 reports retained by Current are labeled `Not current`; absent official end dates remain absent rather than being invented.
- Direct WFIGS loading avoids maintaining another publication pipeline and keeps incidents timely, but availability depends on an official ArcGIS organization-wide quota. In-memory geometry reuse, quota-aware retry, partial map refresh, old-layer retention, and a clearly labeled bounded stale database fallback mitigate transient failures. The persistent fallback may be up to 24 hours old and must never be presented as live data.
- WFIGS perimeters are simplified for display and may not preserve survey-level boundary detail. They are operational map context, not cadastral or evacuation-boundary data.
- The 300-acre large-fire threshold and compressed point-radius classes are visualization and browsing aids. Acreage remains printed in text, and circle radius must not be interpreted as an exact area-to-scale symbol.

## Primary artifacts

- `index.html`: the only standalone interactive map and the only application file to update for interface or runtime behavior.
- `scripts/build_static_cache.py`: the bounded static-frame cache generator.
- `cache/manifest.json`: an empty development fallback; production deployment replaces it with the generated manifest.
- `.github/workflows/deploy-pages-with-smoke-cache.yml`: repository-root Pages build and scheduled cache deployment workflow.
- `AGENTS.md`: required, current record of data sources, scientific terminology, UI behavior, implementation constraints, operational history, verification requirements, and known tradeoffs; update it with every project change.

If an inline Codex visualization is also generated, keep it as an HTML fragment without document-level `doctype`, `html`, `head`, or `body` tags, while keeping the standalone file functionally equivalent.
