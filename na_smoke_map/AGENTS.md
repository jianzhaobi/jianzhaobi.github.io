# North America Smoke and PM2.5 Map

> **Documentation contract:** Every completed project update must update this `AGENTS.md` in the same change so that data sources, filters, behavior, implementation decisions, verification requirements, and dated history remain accurate. Do not commit or push a project update while knowingly leaving this file stale.

## Project purpose

This project provides a browser-based, mobile-friendly map for exploring current and forecast particulate pollution across North America. The sole primary deliverable is `index.html`.

The map must let users independently choose:

- Wildfire-smoke PM2.5 or total PM2.5.
- Surface concentration or entire-atmosphere column loading.
- United States WFIGS wildfire ignition points and perimeters, or Canadian CWFIS agency-reported fire locations, selected through country tabs in the Fires drawer.
- An optional NOAA HMS observed-smoke overlay (off by default) showing analyst-drawn plume extent, distinct from the modeled RAQDPS smoke.
- Significant wildfires by default for the selected country (US IMSR or CIFFC Priority), with the corresponding full catalog reachable through the drawer's status/size filters.
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

## NOAA HMS observed-smoke overlay

An independent, optional overlay of NOAA Hazard Mapping System (HMS) smoke plumes, layered above the RAQDPS smoke canvas and below the WFIGS fire geometry. It is fundamentally different from the RAQDPS layers and must never be conflated with them:

- **It is observed plume extent, not modeled concentration.** HMS plumes are analyst-drawn from satellite imagery (GOES geostationary plus polar VIIRS/MODIS). They show *where* smoke was seen aloft, not a ground concentration.
- **The `Density` field is a qualitative Light / Medium / Heavy class.** It is not µg/m³ or mg/m² and must never be presented as, or compared against, the PM2.5 colour ramp. Labels and help text must say so.
- **HMS is a daily analyst product with no hourly cadence and no forecast.** Do not tie it to the timeline, do not interpolate it, and do not imply it can be scrubbed into the past or future. Hourly and forecast smoke are RAQDPS's job.

### Sources and hourly cache

| Purpose | Official source |
| --- | --- |
| Current-day HMS smoke polygons | [NOAA HMS Smoke Detection](https://www.arcgis.com/home/item.html?id=ab7a5fbd76e3499296350eabf599fc63), layer 0 of `NOAA_Satellite_Smoke_Detection_(v1)/FeatureServer` on `services2.arcgis.com` |
| Most recent completed daily analysis | NOAA's dated KML archive at `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/YYYY/MM/hms_smokeYYYYMMDD.kml` |

Browsers never query either NOAA source directly. The Pages workflow runs `scripts/build_hms_cache.py` on the same hourly schedule as the RAQDPS and WFIGS builders and publishes `cache/hms/manifest.json` plus one content-addressed `polygons.<hash>.json` asset. The builder first queries the live ArcGIS layer. When that layer contains geometry, it publishes the whole current analysis. When the layer is empty or unavailable, it searches the official dated KML archive backward for up to 14 days, selects the newest file containing polygons, and converts that file to GeoJSON. This closes NOAA's normal morning gap between clearing the current-day ArcGIS view and publishing the first analyst smoke classification without pretending the previous analysis is current; data older than that bound are deliberately not introduced into a current conditions map.

The manifest records `generatedAt` (when the hourly cache checked), `sourceKind` (`live` or `archive`), `sourceUpdatedAt`, `analysisDate`, `observedStart`, `observedEnd`, polygon count, byte size, and SHA-256. `observedEnd`, derived from the polygons' `End_` values, is the primary user-facing timeliness timestamp; a fresh cache build must never make older polygons look newly observed. If refresh fails and a complete prior cache exists, retain it atomically. The browser validates the manifest, length, digest, version, and feature count before replacing the in-memory snapshot.

Because HMS, WFIGS, CWFIS, and CIFFC are cache-only in the browser, the page `Content-Security-Policy` `connect-src` allowlist is `'self'` only. Adding any future browser-side source requires explicitly allowing its host, but build-time sources do not belong in browser CSP.

### Design and rendering rules

- **Default off.** The overlay loads and renders only after the user ticks the `Observed smoke (HMS)` checkbox. The three top-level layer toggles are ordered `Smoke & PM2.5 (RAQDPS)`, the selected fire source (`Wildfires (WFIGS)` for US or `Wildfires (CWFIS)` for Canada), and `Observed smoke (HMS)`, matching the order of the option sections below. Each option section's heading text is identical to its toggle label; the shared section-title style renders them uppercase.
- **Static, one dated analysis.** The layer draws every polygon in the one analysis selected by the hourly builder: today's live analysis when non-empty, otherwise the newest official archived analysis. No past/forecast/timeline filtering. Persistent plumes may appear as several overlapping polygons because the analysis contains multiple satellite time steps.
- **Density styling and timeliness.** Graded translucent smoke-grey (`HMS_DENSITY_STYLE`), Light → Heavy by increasing fill opacity, with a dashed outline on Light/Medium so pale fills stay legible on both the light and dark basemaps. Polygons are drawn Light-first, Heavy-last so denser plumes sit on top. The Layers panel shows a matching Light/Medium/Heavy legend and a timestamped status such as `N HMS smoke polygons · previous analysis · observed through Jul 26, 2026, 11:00 PM EDT · cache checked 18 min ago`. The exact observation time and archive/previous-analysis label are mandatory whenever applicable.
- **Layering.** HMS polygons live in a dedicated `hmsPane` at z-index 440 — above the modeled smoke canvas (`overlayPane` z 420) and below the fire panes (`firePane` z 450, `fireComplexPane` z 460) — so WFIGS fires always sit on top.
- **Attribution.** Add the `NOAA HMS Smoke` attribution item only while the overlay is visible and at least one polygon is present; remove it when the layer is toggled off. This is independent of the WFIGS attribution.
- The overlay is North America wide (GOES East/West coverage) and successfully loaded data is cached in memory for the session (`hmsFeatures`); toggling off clears the drawn layers but keeps that cache so re-enabling is instant. If it is toggled off while the first cache request is still running, abort that request and let a later re-enable start a fresh generation; a superseded response must never redraw the layer or replace a newer result. While visible, check the hourly manifest on the hourly timer and after a sufficiently old tab resumes; validate a replacement before atomically redrawing, and retain the visible snapshot with Retry on failure.

## WFIGS wildfire data

The default **United States** fire tab is an independent NIFC WFIGS system layered above the RAQDPS smoke canvas. It represents United States incidents that WFIGS classifies as wildfires; it must not be described as a complete wildfire source for Canada or all of North America. Selecting Canada replaces only fire geometry and list membership; it never changes the RAQDPS or HMS smoke layers.

### Official sources and service endpoints

Use the following official ArcGIS items and their layer-0 FeatureServer endpoints under the actual source shard `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services`. Do not use `https://services.arcgis.com/...` as a generic fallback for this organization: it returns `Invalid URL` for these FeatureServer paths even when the HTTP status is 200.

| Purpose | ArcGIS item | Runtime service |
| --- | --- | --- |
| Current incident ignition locations | [Current Incident Locations](https://www.arcgis.com/home/item.html?id=4181a117dc9e43db8598533e29972015) | `WFIGS_Incident_Locations_Current/FeatureServer/0` |
| Current fire perimeters | [Current Fire Perimeters](https://www.arcgis.com/home/item.html?id=d1c32af3212341869b3c810f1a215824) | `WFIGS_Interagency_Perimeters_Current/FeatureServer/0` |
| Year-to-date incident locations | [Year-to-Date Locations](https://www.arcgis.com/home/item.html?id=405814902c9e411cb4384c49d694e82b) | `WFIGS_Incident_Locations_YearToDate/FeatureServer/0` |
| Year-to-date fire perimeters | [Year-to-Date Perimeters](https://www.arcgis.com/home/item.html?id=7c81ab78d8464e5c9771e49b64e834e9) | `WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0` |

Current and Year-to-Date are overlapping hosted views of the same WFIGS incident source; they are **not** mutually exclusive datasets. Records present in both views retain the same incident identity (normalized `IrwinID`, and currently the same `OBJECTID`). Current is the recency/current-membership view and can contain a small number of carry-over incidents that are not in the current-calendar-year view. Year-to-Date is the current-calendar-year view and includes both current and closed incidents. The app therefore builds one logical snapshot: the unfiltered set is the ordered union of Year-to-Date plus Current-only records, Active uses Current, and the closed/Not current filters use Year-to-Date with Current membership resolved explicitly. Do not describe Year-to-Date as an all-years archive.

Every WFIGS request must enforce the official wildfire categories:

- Ordinary ignition geometry stays WF-only: `IncidentTypeCategory='WF'`. Perimeter hydration permits `attr_IncidentTypeCategory IN ('WF','CX')` so a CX parent can carry authoritative perimeter geometry without ever becoming a normal ignition circle. Member fires (`IsCpxChild = 1`) are WF and render as ordinary fires inside their parent complex.
- CX parents render as a distinct **complex diamond marker** at the center of their canonical member geometry. `renderComplexMarkers()` draws one diamond per loaded parent, positioned by `complexDisplayLatLng()` (the bounds center of its pre-hydrated member records, falling back to the raw CX point only when no member geometry resolves). This is the only way a CX parent appears on the persistent map — as a diamond, never as a WF fire.
- Top-level list queries use the complex roll-up clause `((IncidentTypeCategory='WF' AND (IsCpxChild = 0 OR IsCpxChild IS NULL)) OR IncidentTypeCategory='CX')`, so each complex appears once as a CX parent group-header row. Member fires (`IsCpxChild = 1`) are excluded from pagination, fetched and fully hydrated before the parent row is committed, and revealed instantly when the header is expanded. Point and perimeter hydration may use `IN ('WF','CX')` where a parent record must resolve its own geometry.
- Never display prescribed fire (`RX`) records anywhere.
- Caution: CX parent records carry placeholder `InitialLatitude`/`InitialLongitude` values (a dispatch-center coordinate such as NIFC Boise — all four sampled 2026-07-24 complexes sat at 43.6167, -116.2). Because this raw point is not the fire, the diamond is instead anchored at the member fires' bounds center (`complexDisplayLatLng()`) so it sits with the actual fires and coincides with the popup that a diamond click opens in place (`openFirePopup(record, latlng)`) and with the one `zoomToComplex()` opens from the list header; the raw point is used only as a last-resort fallback when no member geometry is in memory. A parent point must still never be treated as a member fire's real position.

When WFIGS is visible, add the `NIFC WFIGS` item link to Leaflet attribution. Remove the attribution when no persistent or selected wildfire geometry is visible.

### Incident identity and attribute use

Normalize `IrwinID` by trimming whitespace, removing surrounding braces, and lowercasing it. Merge all matching ignition and perimeter features into one event. A valid event may contain:

- Ignition plus one or more perimeter polygons.
- Ignition only.
- One or more perimeters only.

Use a source-and-OBJECTID fallback only when no usable IRWIN identifier exists. The live layer now ingests Current WF points and perimeters only, so its point and perimeter geometry merge by normalized IRWIN id without a separate recently-closed dedup step.

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
- `ICS209ReportDateTime`
- `IsCpxChild`, `CpxName`, and `CpxID` (a member fire's `CpxID` equals its parent complex's `IrwinID`)
- `IncidentTypeCategory` (retained on records as `category` for the Complex list badge)
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

**The list, persistent map, and list selection all consume the same canonical snapshot.** The hourly builder merges Current and Year-to-Date membership, point geometry, matching perimeters, and complex members before publishing either cache asset. The browser inflates those complete wire records before it atomically updates the list DOM, `fireMirrorRecords`, and `canonicalFireRecords`. The default filter is **All + IMSR**, so the small startup asset is the ordered Current ∪ Year-to-Date IMSR set: it includes IMSR fires that have dropped out of Current and any matching Current-only carry-over record. Every later filter/search/sort/page is derived from the already-downloaded full catalog; it performs no WFIGS request and never changes a canonical point independently of its row.

There is no "recently closed" layer. Closed incidents (Contained, Controlled, Out) are reachable only through the database drawer's status filters; the map mirrors whichever filter is active, so they are never part of the default (All + IMSR) view.

### Wildfire rendering and interaction

Render WFIGS with Leaflet `L.geoJSON` and a Canvas renderer in a `firePane` above the smoke canvas. Keep perimeter geometry below ignition geometry within that pane, and render a selected database event above normal wildfire geometry. Complex diamond markers render in a separate `fireComplexPane` (z-index 460, just above `firePane` 450) as Leaflet `divIcon` markers (not Canvas), so they sit above the ignition circles.

Complex diamond symbol: a `divIcon` diamond (a 16 px rotated square with a white border and soft shadow, in a 26 px icon box anchored at its center). Its fill uses the **same discovery-age palette as the ignition circles** (`activeFirePointColor(record.discovery)`, safe to inline because the function only returns fixed hex literals); the diamond **shape** and white border — not a separate color — are what distinguish a complex from a point fire, and the larger size keeps it legible among the circles. (`--pm-fire-complex` remains only as a CSS fallback.) `renderComplexMarkers()` rebuilds `fireComplexGroup` on every re-render; its source is always the CX rows of the loaded list (`fireMirrorRecords`), since the map always mirrors the list, so the diamonds are whatever complexes the current filter returned. Each diamond is positioned at its member fires' bounds center (`complexDisplayLatLng()`), not the raw dispatch point. The diamond follows the **Ignitions** toggle (it is a point anchor), is removed with the Wildfires master toggle, and clicking it opens the complex popup in place at the diamond's anchor (`openFirePopup(record, latlng)`) **without reframing the map** — matching ignition-dot and perimeter map clicks, which also only open a popup. Its hover response mirrors the ignition circles and perimeters: `renderComplexMarkers()` binds `mouseover`/`mouseout` on the marker to toggle `pm-fire-hover` on the map container (pointer cursor) and `pm-hovered` on the diamond span (a `scale(1.18)` grow plus a deeper shadow, applied instantly with no CSS transition so it snaps like the circles' `setStyle` hover). Because a `divIcon` has no `setStyle`, the class is toggled on `marker.getElement()`'s inner `.pm-fire-complex-diamond`. Rescaling to a complex is reserved for the list: only the complex **group header** runs `zoomToComplex()`. This keeps map clicks uniform (inspect in place) and the list the single navigation surface. No permanent legend is added; the diamond's meaning is carried by its popup, which states the complex's textual status like every other card. `zoomToComplex(record)` (list header only) frames the combined extent of the already-hydrated member point/perimeter geometry (`complexMemberRecords()`) with the same padding/`maxZoom:15` conventions as a database selection, and falls back to the raw CX point only when the canonical snapshot has no member geometry. It never starts a second geometry request.

Ignition styling combines age and reported acreage while keeping the map restrained:

- Discovery age must use a deliberately broad warm range in recency order: 0–24 hours light golden yellow (`#f2c75c`), 24–72 hours amber-orange (`#ee9138`), 72–168 hours coral-orange (`#e45b2f`), 7–14 days red (`#bd3426`), and older active incidents deep burgundy red (`#861d1d`).
- Missing discovery time uses the middle red-orange fallback `#d84a2f`.
- Point radii follow compressed NWCG fire-size classes: up to 0.25 acre, under 10, under 100, under 300, under 1,000, under 5,000, and 5,000+ acres map to approximately 3.25–7 CSS pixels.
- Scale the displayed and interactive ignition radius progressively above Leaflet zoom 6, reaching no more than approximately 2.1 times the base radius at deep zoom. Reapply point styles after every completed zoom so small incidents remain practical click targets without overwhelming the regional view.
- The `Large · 300+ acres` database threshold begins at 300 acres, corresponding to the start of NWCG class E. It is intentionally a useful large-incident filter rather than a claim that every 300-acre event is nationally significant.

Active perimeters use a coral-red outline and low-opacity fill. Closed-status geometry (Contained/Controlled/Out fires reached through the database filters) uses a gray-brown hollow point or dashed perimeter. Hover increases point size or perimeter emphasis. A selected database incident receives a larger, stronger non-flashing highlight; a selected archived ignition keeps the neutral gray-brown status styling by using a medium-opacity gray-brown fill with the stronger white selection border instead of becoming a white-on-white circle or adopting the active-fire age palette. Do not add a permanent wildfire symbol legend; the Layers menu should remain compact and the popup/list must always state the status in text.

Sort ignition features by `FireDiscoveryDateTime` ascending before adding them to the shared Leaflet Canvas renderer. Treat a missing or invalid discovery time as oldest and use OBJECTID as a stable tie-breaker. Because Canvas draws later features above earlier ones, this guarantees that the newest ignition is visually and interactively above every older overlapping ignition after initial render and every zoom redraw. A deliberately selected database incident remains above the normal time ordering.

Ignitions and perimeters have independent checkboxes and apply to persistent and selected geometry alike. Turning Wildfires off removes every wildfire layer and popup. Smoke and Wildfires also remain independently selectable; turning both off leaves only the basemap.

Fire interaction has priority over the pollution probe:

1. Ignition point.
2. Perimeter when no ignition hit is present.
3. Smoke/PM2.5 point probe when no wildfire geometry handled the event.

Keep ignition layers above perimeter layers, stop Leaflet event propagation on wildfire clicks, mark handled pointer events, and suppress the smoke probe while a wildfire geometry is hovered. The Canvas renderer uses a modest hit tolerance so desktop and touch interaction remains practical. Hover must visibly respond on desktop.

Clicking either geometry of the same merged event must produce the same popup data and status. Anchor an ignition click at the point and a perimeter click at the clicked polygon location. Build all WFIGS-derived popup text with DOM nodes and `textContent`, never raw HTML. The card contains incident name, textual status, discovery time, acres, percent contained, county/state, cause, last update, and whether ignition, perimeter, or both are available. Two conditional rows use logic identical for every event: an `ICS-209 report` row with the relative `ICS209ReportDateTime` whenever the record has a valid one (the report time can lag or lead other WFIGS attributes, so it is surfaced uniformly rather than only for filtered fires), and a `Complex` row reading `Part of <CpxName>` whenever the record carries a complex name.

The map itself permits integer zoom through level 17, while basemaps advertise their native higher limits. A database perimeter selection fits all matching polygons with a maximum fit zoom of 15; when an ignition is available, use bounds mirrored around that point so the point is centered in the usable padded viewport while every perimeter remains visible. A point-only selection flies to integer zoom 13. Stop any previous map animation before starting a selection move, and disable popup auto-pan for database selections so it cannot race or override the requested camera. Do not reintroduce a regional maximum zoom that prevents city- or incident-level inspection.

### Wildfire database drawer

The `Fires` control opens a right-side desktop drawer or mobile bottom sheet with United States and Canada tabs. United States is the default; the rules in this WFIGS subsection apply while that tab is selected. On phones, selecting a record closes the sheet before showing the mapped incident.

Database behavior:

- Load the default All + IMSR list at startup even while the drawer is closed because `fireMirrorRecords` is also the map's membership source. Opening an already-populated drawer must not issue a redundant page request; non-default filters/search/sort and pagination remain user-driven.
- Fetch only the small content-addressed `default` asset on the critical startup path. After it validates and the opening map/list commits, schedule the full `catalog` asset with `requestIdleCallback` (bounded fallback timeout) and download, SHA-256 verification, JSON parsing, and IndexedDB I/O inside a dedicated Worker. Inflation into runtime records is chunked with idle yields so the main thread remains responsive.
- Persist the latest validated catalog by its `generatedAt` version in IndexedDB (`na-smoke-map-wildfire-cache`, store `catalogs`). IndexedDB is a same-version resilience/performance layer, not a separately stale data source: a new manifest version still requires its matching asset before non-default filters replace the map.
- If a user selects a non-default filter before the catalog is ready, retain the default map/list, show `Preparing full wildfire database`, prioritize the already-running catalog load, and automatically run the pending filter when it finishes. A failed background catalog download retries indefinitely with exponential backoff capped at 60 seconds; it must never turn the already-visible default snapshot into an error.
- Default to `FireDiscoveryDateTime DESC, OBJECTID DESC`.
- The sort icon toggles between newest discovery first and `IncidentSize DESC, FireDiscoveryDateTime DESC, OBJECTID DESC`.
- Keep the sort button neutral white with accent text/border in both modes; do not reuse the generic solid-orange `aria-pressed` button treatment.
- When `IMSR` is off, locally filter the complete catalog, show 50 **final matching** records, and require an explicit `Load more` action. When `IMSR` is on, show the whole matching IMSR set and hide `Load more`.
- Show the exact locally computed matching total whenever the first page does not capture everything, e.g. `50 of 24,795 wildfires shown`.
- Debounce incident-name search by approximately 300 ms. Search, status, IMSR, size, sort, and pagination all run locally against the inflated catalog/default records.
- Row one is Active, Contained, Controlled, Out, and Not current — mutually exclusive status chips. There is no `All` chip: **no chip pressed is the "all statuses" state**, and clicking the already-pressed chip clears it back to that state (`fireDatabaseFilter === "all"`). Row two holds the independent `IMSR` and `Large · 300+ acres` toggles (in that order). **The default is no status chip + `IMSR` on**, so the default list population is every IMSR-grade fire and matches the map's default live view. `IMSR` is a pure modifier: it ANDs with the row-one status. `Contained/Controlled/Out + IMSR` are empty by definition because IMSR excludes every official end date; `Not current + IMSR` remains meaningful for still-reporting fires that have dropped out of Current.
- The `IMSR` toggle filters to fires with ongoing ICS-209 incident reporting, below 100% containment, and no official containment/control/out date: `ICS209ReportStatus IN ('U','I') AND (PercentContained < 100 OR PercentContained IS NULL) AND ContainmentDateTime IS NULL AND ControlDateTime IS NULL AND FireOutDateTime IS NULL`. The client-side twin is `isImsrGradeFire()`; keep the SQL and function in sync, and keep the `IS NULL` percentage branch — a missing percentage means "not known to be contained", never 0. This deliberately excludes contradictory WFIGS rows that still carry U/I but already have an official end-state date.
- No status chip ("all") uses the builder's ordered Year-to-Date plus Current-only union. Active/Contained/Controlled/Out/Not current are resolved locally from the builder-supplied Current membership flag and the shared `fireStatus()` priority.
- Not current means no official end date plus either (a) absence from Current or (b) a final (`F`) ICS-209 report, whose priority intentionally wins even when WFIGS Current still retains the row. This deliberately includes still-reporting U/I fires that have dropped out of Current, such as Alaska monitor fires.
- Every list where clause starts from the complex roll-up base described in the official-sources section; a CX parent renders as a collapsible **group header** carrying an outline `Complex` badge next to the status badge. Before that header is committed, its member points and perimeters are loaded from the same source view and stored in `record.memberRecords`. The header body runs `zoomToComplex()` against those canonical members; the trailing chevron (`aria-expanded`) only reveals the already-loaded ordinary rows and performs no request. Selecting a member row behaves like any other canonical fire selection. `buildFireRowButton()` is the shared row markup for standalone fires, members, and the header.
- Contained means containment is present while control and out are absent. Controlled means control is present while out is absent. Out means out is present. Every status chip is finally validated by the same `fireStatus()` function used for badges, popups, and map styling; SQL is only a candidate-set optimization.
- Cancel obsolete local filter/sort/page commits and HMS requests with generation counters or `AbortController` as appropriate. Selection performs no request. Late local results must not overwrite the latest user action.
- A reset must leave the previously rendered rows in place until the replacement cache asset validates and the new snapshot commits. On cache failure, retain the current list/map and expose Retry.
- `InitialLongitude`/`InitialLatitude` remains only the fallback when the cached point feature lacks point geometry.

Selecting a database record performs no network request. It reuses the exact object in `canonicalFireRecords`, highlights whichever canonical ignition/perimeter geometry is allowed by the current layer toggles, fits all available perimeter polygons around the canonical ignition, falls back to the ignition point, or retains the current map and reports `Location unavailable` when neither selected geometry type is visible. Keep the temporary selection until the popup is closed, another event is selected, or the selection is otherwise cleared.

### Map always mirrors the list (single source of truth)

The drawer's filter state, persistent map, and selection are unified around one immutable page snapshot. **The map always draws exactly the top-level rows loaded in the list**, and every interaction with a loaded row resolves to the same canonical object. There is no render-time Current-vs-YTD choice and no second selection geometry path.

- **Atomic snapshot commit**: the builder publishes content-addressed default/catalog assets first and atomically replaces `manifest.json` only after both are complete. `loadFireDatabase()` applies final local filters against an already-complete asset before mutating visible state. A reset keeps the old list/map until the replacement is complete. On success, `fireList`, `fireMirrorRecords`, and `canonicalFireRecords` are cleared and extended together; `Load more` extends all three together.
- **Unified membership and pagination**: the catalog is the ordered Year-to-Date plus Current-only union. Each wire record carries a resolved Current-membership flag; normalized IRWIN ID is primary and OBJECTID is fallback. All filters operate on this one union and every non-IMSR page contains up to 50 final matches in requested sort order.
- **Canonical geometry**: `fireMirrorRecords` contains every top-level record and `canonicalFireRecords` contains those same objects plus complex members. `renderFireLayers()`, `renderComplexMarkers()`, `selectDatabaseFire()`, and `zoomToComplex()` read only these records. `fireRenderRecord()` has no `fireEvents` fallback. Thus a point/perimeter cannot appear only after a list click, and the ignition cannot jump between the persistent map and selection.
- **CX parents**: each parent owns its fully hydrated `memberRecords`. `complexMemberRecords()` reads that array; map member rendering, diamond anchoring, row expansion, and list-header zoom all share it. The parent itself is never drawn as an ignition circle, and the raw placeholder point is only the last-resort diamond/zoom fallback.
- **`fireMirrorActive`** no longer gates rendering. It means only "the current filter is non-default" (`wildfiresVisible && !fireFilterStateIsDefault()`), and drives the `Filtered · N fires` banner, the Layers-menu status line, and the map's accessible name. `fireFilterStateIsDefault()` is `All`, `IMSR` on, empty search, `Large` off (sort excluded — it reorders without changing membership).
- **Banner**: when the filter is non-default, a `pm-glass` banner under the toolbar shows `Filtered · N fires` with a clear (`×`) button that resets every filter control to the default (All + IMSR) and reloads; it works with the drawer open or closed.
- **Teardown paths** (all must keep working): restoring the default filters via the chips/search, the banner clear button, the unified manual refresh (`resetMapToInitialState`, which reloads the default asset), and turning the Wildfires master toggle off clear the canonical maps. Re-enabling Wildfires reloads the default cache snapshot. Closing the drawer does **not** change the map.
- **Current membership**: membership belongs to the canonical record, not to render-time cache availability. YTD top-level rows and YTD complex members are checked against Current before `fireStatus()` runs. A final-report record still badges `Not current` because the `fireStatus` `'F'`-first rule wins.

### WFIGS performance, refresh, and caching policy

Browsers never query WFIGS directly. The Pages workflow runs `scripts/build_wildfire_cache.py` on the same hourly schedule as the smoke cache, publishes it at `cache/wildfires/`, and the page reads only same-origin immutable assets. This removes ArcGIS latency, shared organization quota exhaustion, and transient WFIGS availability from every user-facing request.

The cache contract is:

- Fetch all four official layer-0 services with no more than two concurrent jobs. Location requests include WF and CX so the builder can construct top-level rollups and member geometry; output still excludes RX and never renders CX as an ordinary fire. Perimeters use `outSR=4326`, `geometryPrecision=5`, and `maxAllowableOffset=0.0001`.
- Page each source deterministically by OBJECTID, retry transient failures up to the configured total attempts, and honor an ArcGIS 429 quota window before retrying. These delays occur in CI, never in a user's browser.
- Build one complete catalog as the ordered Year-to-Date plus Current-only union, then retain unmatched WF perimeter-only events while excluding perimeters already owned by a top-level or complex-member point. Unmatched CX perimeters have no trustworthy point/member anchor for the required complex diamond and remain excluded. Every record includes its available point geometry/attributes, matching perimeters, resolved Current membership, and pre-hydrated complex members. Build the small default asset from the final perimeter-supplemented IMSR predicate so it is exactly the opening All + IMSR membership.
- Serialize compact JSON, SHA-256 each asset, write content-addressed `default.<hash>.json` and `catalog.<hash>.json`, then atomically replace `manifest.json`. Prune old assets only after the new manifest exists. If refresh fails and a complete prior cache is present, preserve and deploy that prior version; fail the build only when no complete cache exists.
- The manifest records `generatedAt`, a 60-minute refresh interval, source edit times, counts, byte sizes, hashes, and immutable filenames. The UI presents this source time as `updated N min/hr/day ago` and refreshes that wording every minute without rebuilding geometry.
- Startup fetches and validates the manifest and default asset only. The default map/list must commit before the full catalog is scheduled. The Worker first checks IndexedDB for the exact `generatedAt` version; otherwise full-catalog fetch, hash/length validation, parsing, and persistence all occur there. Runtime inflation yields between chunks. A forced refresh terminates the active catalog Worker, increments the cache generation, and prevents a late old version from committing.
- The catalog background task retries until the current manifest version completes. Foreground interactions remain available during transfer/parsing; selecting a non-default filter before readiness queues that filter instead of issuing a network request or clearing the default map.
- Once loaded, all filter/search/sort/page changes are local. There are no WFIGS network requests, total-count requests, per-record hydration requests, or selection-time requests. The browser CSP intentionally excludes `services3.arcgis.com`.
- On each hourly timer, `pageshow`, visibility resume, Retry, or unified manual refresh, the page cache-busts `manifest.json` and the small default asset, then restarts background catalog hydration. An unchanged catalog reuses the exact-version IndexedDB copy first (and its content-addressed HTTP cache if needed); a newer version validates before it atomically replaces the default. A failed replacement retains the last visible snapshot.

The map's manual refresh button is a unified refresh-and-reset action. It must refetch the smoke cache manifest and every field atlas for the initial wildfire-smoke/surface dataset, cache-bust and validate the latest wildfire manifest/default asset, and cache-bust and validate the latest HMS manifest/polygon asset. It restores the complete opening map state: North America center and zoom, Day basemap, wildfire-smoke surface PM2.5 at Now, stopped playback, Smoke/Wildfires/Ignitions/Perimeters on, HMS off, closed menus and database drawer, default All + IMSR database state, and no popup or selected wildfire. Although HMS is returned to its default off state, its latest cache is still refreshed in memory so the validated polygons are ready for the next toggle. A known current-location dot may remain. Its accessible name is `Refresh smoke, wildfire, and HMS data`. Report success only if all three cache systems succeed, partial success if at least one succeeds, and retain the prior visible smoke frame or canonical wildfire snapshot for each failed visible source; if HMS refresh fails, its prior in-memory polygons/timestamp remain available for a later toggle. If the default smoke reload fails, restore its prior particle, extent, and hour labels so they continue to match the retained frame.

The WFIGS and smoke builders share the deployment schedule and cache output root but retain independent schemas and manifests. Do not couple `scripts/build_wildfire_cache.py` to the schema-v5 smoke field format.

## Canadian CWFIS and CIFFC wildfire data

The **Canada** tab is a points-only national view built from Natural Resources Canada's Canadian Wildland Fire Information System (CWFIS), enriched with the Canadian Interagency Forest Fire Centre (CIFFC) national situation report and, where available, a province's official display name. It replaces the selected fire snapshot but does not change modeled RAQDPS smoke, observed HMS smoke, the timeline, or either smoke layer's visibility.

### Official sources and inclusion rule

| Purpose | Official source |
| --- | --- |
| Canonical current-season fire catalog | CWFIS [Agency Reported Wildfires metadata](https://catalogue.cwfif.nrcan.gc.ca/geonetwork/srv/api/records/937eb7be-83fd-4b94-a122-9cc0385f3bf7), WFS type `public:cwfif_national_reportedfires` at `https://geoserver.cwfif.nrcan.gc.ca/geoserver/public/wfs` |
| Reference active-fire view | CWFIS [Active Wildfires metadata](https://catalogue.cwfif.nrcan.gc.ca/geonetwork/srv/api/records/bd641635-d30d-4b77-abc0-d6b59b1e8a00), WFS type `public:cwfif_national_activefires` |
| National significance modifier | CIFFC situation report API at `https://api.ciffc.net/v1/sitrep`, using every agency report's `priority_fires` array |
| BC official display-name enrichment | BC Wildfire Service [Fire Locations - Current](https://catalogue.data.gov.bc.ca/dataset/2790e3f7-6395-4230-8545-04efb5a18800), ArcGIS layer `mpcm/bcgwpub/MapServer/502` at `https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/502` |

Use **Agency Reported Wildfires as the only canonical fire catalog**. At 2026-08-05 13:44 UTC, its current temporal slice contained 4,482 records and the Active view contained 696; every Active `national_fire_id` was present in Agency Reported, and the 696 Active records were exactly the Agency Reported records whose `stage_of_control_status` was not `EX`. The same equality was checked at seven dates from March through August 2026. Therefore derive Canadian active membership locally as `stage_of_control_status IN ('OC','BH','UC')`; do not download or merge the separate Active view. This avoids transient omissions or duplicates if the two WFS views refresh non-atomically. Treat this as a verified operational relationship, not a schema-level guarantee that permits dropping the status check.

The builder queries the Agency Reported layer with one build timestamp and `record_start <= timestamp AND record_end >= timestamp`, excludes `fire_was_prescribed = 1`, requests EPSG:4326 point geometry, and paginates deterministically by `id`. Keep and display, without inventing missing values: `national_fire_id`, `agency_code`, `region_code`, `agency_fire_id`, `national_fire_cause`, `percent_contained`, `fire_size` (hectares), `response_type`, `stage_of_control_status`, `situation_report_date`, `status_date`, and reported latitude/longitude. A CWFIS point is a **reported fire location**, not necessarily an ignition point; Canadian copy must never call it an ignition. Do not request or imply Canadian perimeters in this implementation.

Map CWFIS stages exactly: `OC` → `Out of control`, `BH` → `Being held`, `UC` → `Under control`, and `EX` → `Extinguished`. Natural/human/undetermined causes map from `N`/`H`/`U`; response labels map `FUL`/`MOD`/`MON` to Full/Modified/Monitored response. Retain `Not reported` for unknown values. CWFIS supplies `fire_size` in hectares, but convert it internally with `1 ha = 2.47105381 acres` and display Canadian area in acres so Canadian and US rows, popups, sorting, and size filters share one unit. Both countries use `Large · 300+ acres` and the same compressed acreage point-radius scale. Point colour uses situation-report/status recency because CWFIS does not provide the WFIGS discovery timestamp; do not describe that colour as discovery age.

### Provincial official display names

CWFIS remains the sole canonical Canadian fire catalog. Province sources may enrich only the optional **display name**; they never add records or override CWFIS geometry, identifiers, stage, area, containment, cause, response, or timestamps. The title precedence is an exact provincial official name, then `agency_code + agency_fire_id`, then `national_fire_id`.

The first source is BC Wildfire Service's current `Fire Locations` layer. The hourly builder fetches only `FIRE_NUMBER` and `INCIDENT_NAME`, normalizes the CWFIS and BC fire numbers by stripping punctuation, case, and an optional leading four-digit year, and joins only exact BC-to-BC identifiers. It preserves every nonblank official `INCIDENT_NAME` as supplied, including an identifier-shaped value or a value equal to `FIRE_NUMBER`; the application does not judge or repair a provincial field. Conflicting duplicate official names for one normalized ID are skipped because there is no unambiguous source value to serialize. The serialized record stores the supplied name and `BC Wildfire Service` provenance, and a Canadian popup exposes that provenance in a `Name source` row. The manifest records BC source, availability status, fetched record count, usable-name count, exact matched-name count, and skipped ambiguous-ID count.

Do not use proximity, text fuzzing, news reports, geographic descriptions, or CIFFC labels to invent a provincial name. Later province integrations must meet the same bar: an official machine-readable source, a stable identifier that exactly resolves to CWFIS in the same agency/current season, a distinct event-name field, bounded pagination, atomic failure retention, coverage telemetry, and regression tests before they are enabled.

### CIFFC Priority matching

`CIFFC Priority` is Canada's default significance modifier, analogous in interface purpose but not definition to US IMSR. Always include `CIFFC` in the filter label, list badge, status text, popup row, reset label, and explanatory copy so users do not interpret “Priority” as an application-defined score. CIFFC has supplied both `Name (ID)` labels and plain-name-only labels in `field_fire_id`; the builder must support both without classifying a plain name as an identifier. Join each CIFFC priority row to Agency Reported only within the same agency, first using any actual fire-ID tokens against normalized `agency_fire_id` (ignore punctuation and an optional four-digit year prefix). One CIFFC label may contain multiple fire IDs; mark every unambiguous matching Agency Reported record and audit every individual ID independently. When CIFFC supplies no ID, count the row as one source fire and match by same-agency coordinate proximity. Also use same-agency coordinate proximity when no supplied ID token resolves. CIFFC labels are build-time matching/audit evidence only and must never be serialized or shown as a Canadian fire's display name; CWFIS remains canonical and only an exact provincial official-name enrichment can replace the ID title. Do not publish unmatched CIFFC fires as invented standalone national records. Retain the legacy row-level match counts for compatibility, but publish `priorityFireCount`, `matchedPriorityFireCount`, `unmatchedPriorityFireCount`, and the agency/optional-ID/source label of each unmatched fire in the manifest. The Canada status line must report `N of M CIFFC Priority fires mapped` and, whenever applicable, `K could not be mapped`; old manifests without individual-fire coverage fields remain valid and simply omit that clause.

### Canadian cache, UI, and interaction

- `scripts/build_canada_wildfire_cache.py` runs hourly in the Pages workflow and publishes `cache/canada-wildfires/manifest.json` plus content-addressed `default` and `catalog` JSON assets. The default asset is the matched CIFFC Priority subset; the catalog is the complete temporally current Agency Reported set. A failure of CWFIS or CIFFC retains a complete prior cache. BC is optional display-name enrichment: if its request fails, the builder publishes the fresh CWFIS/CIFFC catalog without BC names, records `nameSources.BC.status: unavailable`, and retries the enrichment on the next hour; it must never silently freeze the entire Canadian cache. The manifest distinguishes CIFFC report rows from the individual fire IDs named inside them so a partially matched grouped row cannot hide a missing fire. Publish assets before atomically replacing the manifest, validate byte length/SHA-256/schema/version in the browser, and prune superseded assets only after publication.
- The browser is cache-only and CSP remains `connect-src 'self'`; build-time CWFIS/CIFFC/BC hosts never belong in the page allowlist. Canada is lazy: initial page load remains US and starts only the US WFIGS default/catalog lifecycle. The Canadian manifest/default request begins only when the Canada tab is first selected; its complete catalog is scheduled afterward during idle time and inflated in chunks.
- The Fires drawer exposes `United States` and `Canada` tabs, with United States selected at startup and after unified reset. Switching tabs clears selection and resets the destination to its significant default (no status chip, IMSR or CIFFC Priority on, Large off, empty search, latest-time sort). US perimeters return to their prior visibility preference when the user comes back from Canada.
- Canada shows `Reported fire locations`, hides the Perimeters checkbox, and renders points only. Its mutually exclusive status chips are Out of control, Being held, Under control, and Extinguished. `CIFFC Priority` and `Large · 300+ acres` are independent modifiers. CIFFC Priority shows every match; otherwise local pagination is 50 final matches with exact totals. Search matches an accepted provincial official name when available or the displayed agency/fire ID; sort toggles between latest report/status time and largest acreage.
- The map still mirrors the list exactly. Canadian filtering, selection, point popup, source attribution (`NRCan CWFIS · CIFFC · BC Wildfire Service`), generation guards, Load more behavior, and missing-location handling reuse the same canonical `fireMirrorRecords`/`canonicalFireRecords` contract as US. A Canadian popup shows reported date, acres, containment when available, agency/region, fire ID, provincial name source when applicable, cause, response, status update, CIFFC Priority date when applicable, and `Reported fire location` data availability.
- The Layers wildfire source label and fire section heading switch together between `Wildfires (WFIGS)` and `Wildfires (CWFIS)`. The top-level Wildfires master toggle continues to affect only fire data. NOAA HMS and RAQDPS smoke stay unchanged across country switches.

### 2026-08-05 Canadian fire-tab implementation

- Added the tabbed US/Canada fire source selector while preserving US as the startup and unified-reset default. Existing WFIGS cache, IMSR filters, perimeters, complex rollups, popups, selection, sorting, rendering, and background Worker/IndexedDB catalog lifecycle remain the US path.
- Added the hourly CWFIS Agency Reported + CIFFC Priority builder, current temporal filtering, local active derivation, identifier/proximity Priority enrichment, atomic cache retention, lazy cache-only browser loader, Canadian filters/copy/units, and points-only rendering.
- Live production validation at 2026-08-05 14:02 UTC produced 4,483 Agency Reported records, 696 locally active records, and six CIFFC Priority rows matched to six canonical records with zero unmatched rows. These are dated verification counts, not application constants.
- Follow-up consistency update converts CWFIS hectares to acres for every visible Canadian size and uses the same `Large · 300+ acres` threshold as US. It also expands every user-facing Canadian significance label from `Priority` to `CIFFC Priority`; the source data and matching predicate are unchanged.
- Follow-up coverage audit at 2026-08-05 17:14 UTC found that the six CIFFC Priority rows named seven individual fire IDs. Six IDs matched CWFIS; `BC K41315` did not, even though the grouped row also contained matched `K51402`. The builder now audits IDs rather than only rows, publishes the one missing ID in the manifest, and makes the Canada drawer/layer status say that six of seven were mapped and one could not be mapped. This is a dated observation, not an application constant.
- At 2026-08-05 20:20 UTC, CIFFC changed the six current `field_fire_id` values from labels containing fire IDs to plain names. The prior parser treated each whole name as an ID and consequently serialized every matched display name as null. The builder was corrected to distinguish real ID tokens from plain labels, count a no-ID row as one source fire, and use the documented coordinate fallback; regression tests cover old `Name (ID)`, grouped-ID, plain-name matched, and plain-name unmatched inputs. The former use of a plain label as a display name was superseded by the 2026-08-15 provincial-source rule below.
- On 2026-08-15, added BC Wildfire Service exact-ID display-name enrichment. CWFIS remains canonical; any nonblank BC `INCIDENT_NAME` is displayed exactly as the official source supplies it when it exactly matches the same normalized BC CWFIS fire identifier, even if it is identifier-shaped or repeats `FIRE_NUMBER`. CIFFC labels no longer become UI/cache display names and remain only Priority matching and audit evidence. This preserves the CIFFC significance filter while making every displayed Canadian name provincially authoritative and sourced. A follow-up made BC enrichment non-blocking: BC failures explicitly publish a fresh unnamed CWFIS/CIFFC cache rather than retaining an old cache with a successful workflow status.

### 2026-07-22 wildfire implementation record

The following work was completed and pushed on 2026-07-22:

The direct-browser WFIGS request, retry, page-cache, and five-minute refresh mechanics described in dated records from 2026-07-22 through 2026-07-26 are retained as historical context only; the 2026-07-27 hourly cache architecture supersedes them.

- `c46a6dd` added the four official WFIGS sources, mandatory WF filtering, normalized IrwinID merging, active and recent map layers, ignition/perimeter-independent records, popup cards, Layers controls, NIFC attribution, the Year-to-Date database drawer, search, status filters, pagination, sorting, large-fire filtering, on-demand historical geometry, and in-memory refresh/cancellation logic.
- `6ede96b` corrected wildfire hover and click handling, established ignition-over-perimeter-over-smoke click priority, increased Canvas hit tolerance, made ignition and perimeter popup content identical for one event, added independent ignition/perimeter visibility, added age colors and NWCG-derived size radii, added the 300-acre large-fire filter and date/size sort control, increased map zoom capability for city- and perimeter-level inspection, and connected the existing map refresh control to smoke and wildfire together.
- `380d938` removed the wildfire symbol legend, made recently closed geometry opt-in, corrected old Year-to-Date events that were being labeled Active, added the neutral `Not current` state and final ICS-209 handling, made Active filtering use the Current service while excluding final reports, fixed the mobile sort button's solid-orange state, reduced ArcGIS request bursts, added retry/full-query fallback behavior, and fixed a startup race in which `initialize()` and `pageshow` started competing WFIGS refreshes and aborted one another.
- A later 2026-07-22 reliability and visual-order follow-up moved the primary WFIGS hostname to ArcGIS's generic routing endpoint with the original shard as an alternating fallback, added five-attempt database recovery, five-minute bounded page caching, and old-row retention during failed resets. It also expanded ignition age colors from deep red through light golden yellow and explicitly sorted ignition drawing oldest-to-newest so the newest event always remains on top across zoom redraws.
- A subsequent 2026-07-22 diagnosis found that the generic hostname did not route this WFIGS organization at all and that the valid `services3` shard was periodically returning ArcGIS code 429 after the organization exceeded its 57,600 request-unit-per-minute quota. The corrective follow-up removed the invalid hostname, changed list pages to attribute-only JSON, made 429 recovery respect the reported 60-second quota window, and added a clearly labeled bounded 24-hour local fallback so a previously loaded list remains usable during a transient WFIGS outage.

During the initial service-health investigation, direct official queries returned HTTP 200 for all four services. A volatile diagnostic snapshot contained approximately 472 Current WF locations, 169 Current WF perimeters, 266 recently ended Year-to-Date locations, and 38 recently ended Year-to-Date perimeters. Full Current perimeter GeoJSON was roughly 2.5 MB and completed in several seconds. These numbers are diagnostic history, not application constants. A later recurrence captured the authoritative failure: the shard returned ArcGIS code 429 with 63,925 request units consumed against a 57,600-per-minute organization limit and explicitly requested a 60-second retry. After that interval, the count query recovered to 23,694 WF records and a 51-record page returned normally. The generic hostname continued returning `Invalid URL`; a deployed browser could appear healthy only because it had a cached page. This evidence supersedes the earlier assumption that generic routing was a valid redundant host.

### 2026-07-23 wildfire selection and recency update

- Documentation-only repository submission checks confirmed that project instructions can be updated independently, with no runtime files or data behavior changed.
- Database selections now locate an ignition from canonical service geometry rather than normally drawing the attribute-only list record at its reported initial coordinates. Active selections reuse the already-loaded Current point when possible; other selections make one bounded point query against the same source service, with reported initial coordinates retained only as an availability fallback. This fixes the visible offset between a selected list ignition and its normal map position without restoring geometry to every list-page response.
- Active ignition colors now run from light golden yellow for the newest discoveries to deep burgundy red for the oldest, reversing the earlier age direction while retaining the same five age buckets and missing-date fallback.
- The application continues to enforce `IncidentTypeCategory='WF'` in every location query and checks returned point attributes again before rendering. Consequently, an urban ignition displayed in Los Angeles is classified as `WF` by WFIGS; that source classification does not independently establish fuel, severity, or exact real-world conditions.
- Database-selection camera movement now stops an in-progress map animation, includes every matching perimeter in ignition-centered symmetric bounds, and prevents the selected popup from auto-panning against that move. Point-only selections remain centered at zoom 13. Ignition radii now grow progressively after zoom 6 and refresh on `zoomend`, capped at 2.1 times their regional size so deep-zoom incidents are easier to click. Selected archived ignitions now use a neutral gray-brown fill with a white selection border rather than rendering as pure white or using the active-fire age palette.

### 2026-07-23 unified refresh reset update

- The map utility refresh now behaves like a fresh page view as well as a data refresh. It resets viewport, basemap, timeline, layer choices, transient selections, open panels, and wildfire-database controls, cache-busts and reloads the complete default smoke field timeline, and forces full WFIGS point and perimeter queries rather than the normal incremental perimeter path.
- Refresh failure retention remains source-specific: the previous wildfire geometry stays visible when WFIGS fails, while a failed default smoke reload restores the prior particle, extent, and selected-hour state so the retained smoke frame is never mislabeled.
- The location and unified-refresh utility buttons explicitly stop their click events before running their actions. A utility-button click must never fall through to the map's PM2.5 probe, open a concentration popup, or let popup auto-pan override the requested refresh viewport.

### 2026-07-24 correctness and resilience update

A systematic bug review fixed the following. Non-networking behavior remains normative; the older direct-WFIGS transport details are historical and superseded by the 2026-07-27 cache:

- **No invented zeros.** Missing `IncidentSize` and `PercentContained` values (null/empty from WFIGS) render as `Not reported`; `Number(null)` coercion previously displayed fabricated `0 acres` / `0%`. A missing acreage also uses the documented 4.25 px missing-size point radius rather than the smallest size class.
- **Perimeter dedup.** Current membership now wins over a duplicate recently closed perimeter as well as a duplicate point: an event with both a Current and a Year-to-Date perimeter draws only the Current geometry, never two stacked polygons.
- **Paginated map queries.** Point and full-perimeter map queries page through `resultOffset` (2,000 records per page, bounded at 20 pages) until the service stops filling pages, so peak-season record counts cannot be silently truncated at the transfer limit. The incremental changed-ID perimeter fetch also carries the explicit WF `where` filter, satisfying the every-request rule literally.
- **Database drawer resilience.** An aborted page load caused by a row selection or drawer close restores the `Load more` control instead of leaving it stuck on `Loading…`; closing the drawer clears any pending 300 ms search debounce so no request or 60-second quota wait can start after close; a stale stored fallback page is never written into the five-minute memory cache as fresh, so live retries resume immediately after recovery.
- **Honest refresh reporting.** Turning the Wildfires layer off mid-refresh no longer reports a spurious WFIGS failure (deliberate aborts bump the refresh generation first, including on `pagehide`). A partially successful WFIGS refresh (Current data replaced, recent data retained) reports the unified refresh as partial, not as a total failure.
- **Lifecycle.** The `pagehide` handler stays registered across back/forward-cache restores and no longer kills the periodic refresh timers, so the five-minute wildfire refresh survives bfcache navigation. The hourly smoke-cache check also runs on its own five-minute periodic tick so a continuously visible tab realigns `Now` without needing visibility events. The cache-manifest fetch carries a 45-second timeout so a stalled response cannot leave the refresh control stuck in its loading state.
- **Timeline self-heal.** A locked timeline (failed startup manifest, failed atlas load, or a mid-session smooth-render failure) is retried by the periodic cache check via a `recover` path, and the unified refresh clears a transient `fieldRenderingFailed` flag before rebuilding. The unchanged-manifest early return does not short-circuit while the timeline is locked. On rollback, the prior lock state is restored rather than force-unlocking.
- **Degraded unified refresh.** When smooth field rendering is unavailable (Canvas 2D fallback), the unified refresh refreshes the direct-GeoMet frame caches and re-renders the current hour instead of guaranteed-failing the smoke half.
- **Unified-refresh integrity.** The particle/extent selects and the Layers-menu wildfire Retry button are disabled while the combined refresh runs, and the smoke-failure restore path bumps the dataset generation, so no concurrent dataset change can race the restore. During the in-flight window the legend and time labels keep describing the retained visible frame; they update only when the default dataset actually renders, extending the no-mislabeling rule to the whole refresh, not just its end state.
- **Rendering.** Switching from smooth field rendering back to direct-frame mode cuts immediately instead of crossfading from the raw atlas texture (which flashed an opaque channel mosaic). Draw calls are refused while the WebGL context is lost so a blank canvas can never be reported as a ready frame, and the lost-context flag is cleared only after a successful renderer re-initialization. A stale `showFrame` failure cannot overwrite a newer selection's status, and a scrub whose cached blend state was superseded falls back to a full field re-upload instead of silently reporting success.
- **Reduced motion.** The 250 ms zoom-transform transition on the pollution canvas is geographic synchronization with the basemap, not decorative motion, and is exempt from `prefers-reduced-motion`; disabling it desynchronized the plume from the tiles during zoom.
- **Security.** The Leaflet and lucide CDN tags carry Subresource Integrity hashes with `crossorigin="anonymous"`. Keep the `integrity` attributes in sync whenever a CDN dependency version changes.
- **Accessibility.** Escape closes an open Layers/Map menu and returns focus to its summary; the unified-refresh outcome is announced through a polite sr-only live region inside the refresh control; selecting a database row on a phone returns focus to the Fires button instead of stranding it in the hidden sheet; frame-status live-region text skips identical rewrites during playback; the Fires and Map controls include their visible text in their accessible names; the fire list, layer-toggle containers, and legend carry explicit roles.
- **Touch targets.** Transport buttons are at least 38 px and the timeline keeps its 40 px touch box across the full ≤760 px range, not only ≤560 px.
- **Icon fallback.** If the lucide icon script fails to load, toolbar and play text labels are revealed instead of leaving blank icon-only buttons.
- `scripts/build_static_cache.py` dropped the dead per-hour display-frame generator, its palette lookup tables, and the unused `--process-jobs` argument; `--blur-radius` (default 0.55) is now actually applied to field-pack smoothing, preserving byte-identical output for default builds.

### 2026-07-24 wildfire fuel-type basemap addition

- Added the fourth `fuel` basemap option (Map menu radio labeled `Fuel`, lucide `trees` icon) composed of CARTO no-label tiles, LANDFIRE LF2024 FBFM40 WMS for the US, CWFIS FBP fuel-types WMS for Canada, and CARTO label-only tiles, as specified in the Fuel basemap section.
- Refactored `BASEMAPS` so every entry declares a `layers` array and `setBasemap`/`createBasemapLayers` manage a `baseLayers` array instead of a single `baseLayer` tile layer. Explicit `zIndex` options replace the old `bringToBack()` call for in-pane ordering.
- Service selection notes: LANDFIRE's `lfps.usgs.gov` ArcGIS ImageServers carry the same products but would need one tile layer per geographic area and per-layer export requests; the GeoServer WMS merges CONUS/AK/HI in one GetMap and is GeoWebCache-backed, so it was chosen. `LF2024_FBFM40_PRVI` was attempted and removed after the live WMS returned `LayerNotDefined`, which broke every merged tile.
- Verified: node syntax check; local HTTP server; basemap switching in all directions removes and restores WMS tiles and attribution; fuel tiles load without failures at continental and deep zooms; unified refresh still resets Fuel back to Day; 375 px mobile menu shows all four options without horizontal overflow; no console errors.

### 2026-07-24 fuel basemap performance rework

- The initial tiled-WMS LANDFIRE layer was near-unusable in practice: measured 2–20 s per dynamic 256 px tile from `edcintl.cr.usgs.gov`, so a 24-tile viewport behind the browser's 6-connection-per-host limit took tens of seconds. Investigated alternatives that did not help: the server's GeoWebCache WMTS (16–22 s even on repeated identical tiles — evidently load-balanced nodes with independent cold caches), `lfps.usgs.gov` ImageServer `exportImage` (5–24 s), and an ArcGIS Online search that found no public pre-tiled national FBFM40 service (only county-scale CWPP tile sets).
- The same server answers one viewport-sized GetMap in ~0.5–4 s regardless of scale, so the US layer now uses the `SingleImageWmsLayer` described in the LANDFIRE single-image rendering section: one padded `image/png8` request per settled view, previous image retained until the replacement loads, stale loads discarded by generation counter. Measured in-app: initial fuel activation 1 request ≈ 0.5 s; a zoom change 1 request ≈ 1 s.
- CWFIS remains a normal tiled WMS layer (sub-second tile responses). New Leaflet panes `fuelPane` (250) and `fuelLabelPane` (260) keep the LANDFIRE image above the base tiles and below the place labels, smoke canvas, and wildfire geometry.
- Verified: node syntax check; basemap switch to Fuel issues exactly one LANDFIRE request and renders US/AK/HI plus CWFIS Canada; zoom-in issues one replacement request and sharpens without a blank gap; switching back to Day removes the fuel image, label tiles, and both attribution entries; no console errors.

### 2026-07-24 fuel legend addition

- Added the collapsible fuel-type Legend control described in the Fuel legend section: visible only on the Fuel basemap, grouped by fuel family with expandable per-class rows, colors copied from both services' GetLegendGraphic JSON. Grouping was chosen deliberately — a flat 60-row list defeats quick visual matching, while 12 family strips are scannable and each expands on demand.
- Raised the toolbar z-index from 700 to 1010 so tall toolbar popovers are not overlapped by Leaflet's zoom/location/refresh control stack (Leaflet controls sit at 1000; the fire drawer remains above at 1100).
- Verified: node syntax check; Legend appears/disappears with basemap switches and stays hidden on Day/Dark/Satellite; group expansion, scrolling, accent open-state, and chevron rotation; no zoom-control punch-through; 375 px mobile fit without horizontal overflow; no console errors.

### 2026-07-24 IMSR filter, list/map mirror mode, and complex roll-up

- Added the `IMSR` database toggle (`ICS209ReportStatus IN ('U','I') AND (PercentContained < 100 OR PercentContained IS NULL)`). The clause reproduces the fires the NIFC Incident Management Situation Report tracks: validated the same day against the live IMSR PDF, it covered all 77 listed large fires; extra matches were Alaska monitor-status fires (which the IMSR omits while they still produce smoke) and initial-209 new fires the next IMSR lists as new large incidents. IMSR and WFIGS share the same upstream ICS-209/IRWIN data, so no IMSR PDF parsing is needed or wanted.
- Unified the drawer filter with the map: the default status chip changed from `All` to `Active` (matching the map's normal view), and any non-default filter state switches the map into the mirror mode documented in the Filtered map mirror mode section, showing exactly the loaded list rows with a dismissible `Filtered · N fires` banner.
- Complex handling: list queries roll complexes up to one CX parent row (`Complex` badge) and exclude member fires; the live map still renders member fires only; selection queries widened to `IN ('WF','CX')`; popups gained uniform `ICS-209 report` and `Part of <CpxName>` rows. Live sampling found CX parents carry placeholder dispatch coordinates (NIFC Boise), so mirror rendering prefers in-memory member geometry and suppresses the placeholder parent point.
- Plumbing: `FIRE_POINT_FIELDS` gained `ICS209ReportDateTime`, `IsCpxChild`, `CpxName`, `CpxID`; records gained the matching attributes plus `category`; the database storage key bumped to v2 with one-time v1 cleanup.
- API sanity checks the same day: the roll-up + active clause counted 537 Current records and the IMSR clause 103, both plausible against the ~78 uncontained large fires in that morning's IMSR at national Preparedness Level 5.

### 2026-07-24 land-cover basemap addition

- Added the fifth `landcover` basemap option (Map menu radio labeled `Land cover`, lucide `leaf` icon): CARTO no-label background, the Esri/Impact Observatory Sentinel-2 10 m Land Cover 2020 raster via ArcGIS `exportImage`, and CARTO labels, as specified in the Land cover basemap section. One global layer covers all of North America including Mexico.
- Generalized the fuel single-image layer for reuse: `SingleImageWmsLayer` → `SingleImageLayer` with an `options.mode` of `"wms"` (LANDFIRE GetMap) or `"arcgis"` (Sentinel-2 `exportImage`); the mercator viewport math, padding, size cap, preload/swap, skip-when-covered, generation guard, and zero-size handling are shared. The basemap spec key `singleWms` became `singleImage`. The shared panes `fuelPane`/`fuelLabelPane` were renamed `themePane`/`themeLabelPane` since two thematic basemaps now use them (dated records above predate this rename).
- Generalized the legend: `FUEL_LEGEND` → `LEGENDS` keyed by basemap, and `buildFuelLegend()` (built once at startup) → `renderLegend(basemap)` (rebuilds on basemap change, idempotent per basemap). A region with `groups` renders collapsible family rows (Fuel); a region with a flat `classes` array renders a simple swatch list (Land cover's 9 classes). `setBasemap` shows the Legend control for any basemap present in `LEGENDS`.
- Product-selection record: CEC NALCMS 2020 (the original request) and ESA WorldCover were both investigated and rejected for lack of a reachable mercator/PNG render path — CEC's only official service is LERC + Lambert Azimuthal Equal-Area + tiles-only (`gis.cec.org` WMS returns 403 from here; the CECAtlas hosted tiled image service and all third-party re-hosts keep the LAEA scheme), and ESA WorldCover's rendered Terrascope WMS was unreachable from both the sandbox and the in-app browser while the Esri-hosted copies are LERC tiles-only. Sentinel-2 10 m LULC exposes `exportImage` (verified mercator PNG, 2020 selectable, ~0.5–1.4 s per viewport image) and covers all three countries.
- Format note: `exportImage` must use `format=png32` (RGBA) so ocean/no-data are transparent; `png`/`png8` return opaque RGB that paints the sea black over the CARTO background.
- Verified: node syntax check; no stale identifiers (`singleWms`, `fuelPane`, `SingleImageWmsLayer`, `buildFuelLegend` all gone); Land cover renders full North America incl. Mexico with transparent ocean; one `exportImage` per settled view, one replacement per zoom, sharper at deep zoom; Fuel↔Land cover legend content swaps (12 groups vs 9 flat rows) with correct aria-labels; switching to Day removes the theme image, labels, legend, and attribution; 375 px mobile fit without overflow; no console errors.

### 2026-07-24 iOS page-zoom suppression update

- Fixed iPhone Safari's sudden page zoom when tapping controls (double-tap zoom) and when focusing text fields (automatic input-focus zoom on form controls with text smaller than 16 px).
- Viewport meta now includes `maximum-scale=1, user-scalable=no`. This suppresses the automatic focus zoom and the double-tap page zoom; note iOS Safari still honors deliberate pinch as an accessibility override in the in-browser context, while installed (standalone) mode locks the scale fully. Map pinch is unaffected because Leaflet handles map gestures itself.
- `.pm-fire-search` and `.pm-select` use `font-size: 16px` (previously inherited/declared 14 px) so form-control focus can never trigger the iOS auto zoom even if viewport hints are ignored.
- Added `touch-action: manipulation` to `button`, `summary`, `label`, `input`, `select`, and `a` within the app container to remove browser double-tap zoom on tappable controls (including Leaflet's `+`/`−` anchors, a frequent rapid-tap zoom trigger). The timeline slider's more specific `touch-action: pan-y` still wins by specificity.
- Verified: local HTTP server; computed styles confirm 16 px form-control text, `manipulation` on buttons/summaries/inputs/selects, and `pan-y` retained on `.pm-range`; Layers panel, Fires sheet, and search row show no clipping or horizontal overflow at 320 px and 375 px widths or at desktop size; no console errors.

### 2026-07-24 complex diamond markers and grouped complex list

- Complexes are no longer flattened to a single opaque parent row. A CX parent now renders as a **collapsible group header** in the Fires list: the header body zooms the map to all member fires (`zoomToComplex()`), and a chevron lazily fetches the members (`IsCpxChild=1 AND CpxID='<parent IrwinID>'`) and nests them as ordinary selectable rows (member click still shows that child's ignition + perimeter). `appendFireDatabaseRow` was refactored to share `buildFireRowButton()` across standalone fires, members, and the header; member loads cache per row, offer Retry on error, and abort via `abortComplexMemberLoads()` on drawer close and list reset.
- The persistent live map now shows a distinct **complex diamond marker** at each active complex's raw CX point, in addition to the member WF fires that already render as normal live ignitions/perimeters. This intentionally relaxes the former "live layers stay WF-only / complex parents never render on the live map" rule: the WF ignition/perimeter geometry is still WF-only, but a CX parent appears as a diamond (never as a WF circle). New plumbing: `fireComplexPane` (z 460), `fireComplexGroup`, `currentComplexPoints`, `fetchComplexPointFeatures()` (a `IncidentTypeCategory='CX'` fetch added to `refreshWildfires`, kept out of `fireEvents`), and `renderComplexMarkers()` (source = mirrored CX rows while mirroring, else `currentComplexPoints`). The diamond follows the Ignitions toggle, clears with the Wildfires toggle, and opens the standard status popup.
- The raw CX point is a dispatch-center placeholder (all four sampled complexes at NIFC Boise 43.6167, -116.2), used deliberately per request; the diamond marks the reported complex, and click-to-zoom frames the real member extent. Mirror mode's CX handling dropped its member-point circle fallback — the diamond now represents the parent in both live and mirror views. `CpxID` on a child is the parent's `IrwinID` verbatim (braced/uppercase), verified live 2026-07-24 (Hay Creek Complex → 8 members).
- Member fires follow the normal status rules on the default map (no special complex-member visibility exemption): WFIGS often stamps burning complex members with a final ICS-209 report, so on the default `Active` map many members are `Not current` and hidden, and `zoomToComplex` frames their extent even though the members themselves may not be drawn until a `Not current` filter or mirror mode shows them. This is intentional — status honesty is preserved and a dedicated `Not current` filter is the planned way to surface them.
- Verified: extracted-inline-script `node --check`; local server; live diamonds render at complexes with correct popup/status and zoom-to-members on click; drawer group expand/collapse lazily loads and nests members; member and standalone selection unchanged; Ignitions/Wildfires toggles and unified refresh behave; IMSR mirror mode shows diamonds + member geometry with a correct banner count; 375 px mobile group layout has no horizontal overflow; no console errors.

### 2026-07-25 canonical Current + Year-to-Date snapshot

- Root cause fixed: the persistent map previously borrowed geometry from the Current-only `fireEvents` cache while a list click separately fetched Year-to-Date geometry. A closed fire could therefore be point-only (using reported initial coordinates) on the persistent map, then jump to its authoritative ignition and gain a perimeter after selection. Membership mirrored the list, but geometry did not.
- Current and Year-to-Date were verified as overlapping hosted views, not mutually exclusive feeds. The unfiltered list now performs an ordered union of Year-to-Date and Current-only rows; Active reads Current, while closed/Not current rows read Year-to-Date with Current membership explicitly resolved.
- `loadFireDatabase()` now builds a complete page snapshot before commit: canonical GeoJSON point, source-matched perimeter set, explicit Current membership, and fully hydrated complex members. The list, persistent map, complex diamond/member rendering, row expansion, selection, and complex zoom all consume the same record objects. A list click performs no geometry request.
- Reset loads are atomic: the prior map/list remains visible until the replacement snapshot is complete. The persistent fallback key is v3 because v1/v2 stored attribute-only pages. The drawer heading now states `Wildfires · Current + year to date`.
- Verified with static contracts and a local HTTP browser session: default All + IMSR loaded 132 rows with no console warnings; All without IMSR paginated 50 of 24,566; Controlled paginated 50 of 3,785; selecting the closed LOIS incident showed the already-hydrated `Ignition + perimeter` geometry without changing data paths. These live totals are diagnostic snapshots, not constants.

The dated entries below remain an implementation history. Where an older entry mentions render-time borrowing from `fireEvents`, attribute-only list pages, on-demand selection geometry, or lazy complex-member requests, the canonical-snapshot contract above supersedes it.

### 2026-07-25 IMSR-default view, recently-closed removal, and list totals

- **Default view changed from `Active` to `All + IMSR`.** The map now opens on every IMSR-grade (significant, still-reporting) fire, drawn from the live layer filtered client-side with `isImsrGradeFire()`, and `renderFireLayers()`'s non-mirror predicate changed from "status is Active" to "is IMSR-grade". This is a more useful default for a smoke map (these are the fires actually producing smoke) and it still refreshes every five minutes and renders immediately without opening the drawer. `fireDatabaseFilter` now defaults to `"all"`, `fireDatabaseImsrOnly` to `true`, and `fireFilterStateIsDefault()`, `clearFireMirror()`, and `resetMapToInitialState()` were updated to match.
- **`IMSR` shows every match; every other filter paginates 50.** The list uses `FIRE_IMSR_PAGE_SIZE` (1000, hiding `Load more`) when IMSR is on and `FIRE_PAGE_SIZE` (50, with `Load more`) otherwise. IMSR is a bounded set (127 live matches on 2026-07-25), so loading all is safe. IMSR stays a pure modifier that ANDs with the row-one status, so `Contained/Controlled/Out + IMSR` correctly return nothing.
- **List total ("50 of 24,344 wildfires shown").** `loadFireDatabaseTotal()` runs a `returnCountOnly=true` companion query (same service and where clause, cached per service+where, not awaited, graceful on failure) and `renderFireListStatus()` composes the status line, fetched only when the first page did not already capture everything.
- **Removed the "Recently closed · last 24 h" layer entirely**: the checkbox, `recentClosedVisible`, `recentFireToggle`, `setRecentClosedVisibility()`, `recentFireWhere()`/`fireSqlTimestamp()`/`FIRE_RECENT_MS`, the `recentFirePoints` fetch in `refreshWildfires`, and the recent branch in `rebuildFireEvents`. Closed incidents are still reachable through the drawer's status filters (mirror mode). The Layers menu now has four checkboxes.
- **Filter markup** is now two rows (status chips, then `IMSR` before `Large · 300+ acres`) via a `.pm-fire-filter-break` flex spacer; the 100+ acre threshold discussed was intentionally not added.
- Verified: extracted-inline-script `node --check`; local server; default opens on All + IMSR showing 127 significant fires continent-wide with no banner; turning IMSR off switches to a 50-cap mirror reading `50 of 24,344 wildfires shown` with the `Filtered · 50 fires` banner and `Load more`; the banner clear restores All + IMSR; four Layers checkboxes (no recently-closed); 375 px mobile shows both filter rows with no horizontal overflow; no console errors.

### 2026-07-25 complex diamond fixes and Not-current status filter

- **Complex diamond position.** Diamonds were drawn at the CX parent's raw dispatch-center placeholder point while `zoomToComplex()` opened the popup at the member fires' bounds center, so the popup appeared offset from the diamond and multiple complexes could stack at one placeholder. New `complexDisplayLatLng()` (and shared `complexMemberGeoFeatures()`) anchors each diamond at its member fires' bounds center, matching the popup; the raw point is a last-resort fallback only.
- **Complex IMSR filter.** `renderComplexMarkers()` now filters the live `currentComplexPoints` through `isImsrGradeFire()` in the default (non-mirror) view, so a non-IMSR complex (e.g. Fossil) no longer shows a diamond while IMSR is the active filter. Mirror mode was already filtered by the list SQL. Verified live: default diamonds reduced to the IMSR-grade complexes (Rowe Creek, Hay Creek) and the popup opened on the diamond.
- **Complex members in the default view.** `renderFireLayers()`'s non-mirror path previously drew a complex member only if the member was itself IMSR-grade, so complexes showed just a diamond with no fire geometry. It now builds the set of IMSR-grade complex parent ids and draws the members of those complexes with full ignition/perimeter geometry regardless of each member's own IMSR status — matching mirror mode's CX-row expansion. Verified live: zooming into an IMSR complex in the default view shows its member perimeters and ignition points around the diamond.
- **Row-one status set.** Removed the `All` chip and added `Not current`, giving Active / Contained / Controlled / Out / Not current. The chips are mutually exclusive and clicking the pressed chip clears it; the no-chip state is "all statuses" (`fireDatabaseFilter === "all"`, unchanged default value). `Not current` queries YTD `ICS209ReportStatus = 'F' AND ContainmentDateTime IS NULL AND ControlDateTime IS NULL AND FireOutDateTime IS NULL` — the final-report-without-end-date case, which excludes still-reporting active fires. The default (no chip + IMSR) is unchanged in behavior.
- **Complex diamond color and size.** The diamond fill switched from the fixed `--pm-fire-complex` purple to the ignition-circle discovery-age palette (`activeFirePointColor()`), and the diamond grew from a 12 px square in an 18 px box to a 16 px square in a 26 px box. The diamond shape plus white border still distinguish a complex from a point fire; the age color now conveys recency the same way it does for circles. Verified live: complex diamonds render in the age palette (e.g. dark red for an older complex) at the larger size with no console errors.
- Verified: `node --check`; local server; default shows only IMSR-grade complex diamonds anchored on their fires with the popup on the diamond; `Not current` selects exclusively and reads `50 of 656 wildfires shown` with the `Filtered · 50 fires` banner; clicking the pressed chip returns to no-chip "all" (`50 of 24,362`); no console errors.

### 2026-07-25 "Not current" filter redefinition and complex status fix

- Reported symptom: the `Not current` filter combined with IMSR showed nothing, yet fires such as **Kilolitna** (an Alaska monitor fire, `ICS209ReportStatus='U'`, 0% contained, no closure dates, absent from the Current service) are genuinely `Not current` and IMSR-grade at once.
- Root cause: `Not current` had been defined as `ICS209ReportStatus = 'F'`, which contradicts IMSR's `U`/`I`, so the intersection was always empty. That definition was wrong — `Not current` per `fireStatus()` means **no closure dates AND not in the live/current service**, which does not depend on the report code and cannot be expressed purely in Year-to-Date SQL.
- Fix (two parts):
  - `Not current` now queries no-closure records and `loadFireDatabase()` keeps only rows whose `fireStatus()` is actually `Not current` (a client-side pass that removes currently-active rows). The `of N` total is suppressed for this filter because the SQL count would include the removed rows. `Not current` + IMSR now correctly lists Kilolitna and the other still-reporting fires that have left the Current feed.
  - Added `currentComplexIds` (normalized IRWINs of Current-service complexes, rebuilt in `refreshWildfires()`); `fireRecordFromPointFeature()` marks a CX record active when it is in that set, so an actively reporting complex badges `Active` instead of falling through to a misleading `Not current` (a final-report complex still badges `Not current`).
- Data check (live YTD counts, 2026-07-25): base+IMSR 132; `no-closure` alone 6,964 (dominated by active fires, which the client-side pass removes); `no-closure`+IMSR 127; CX total 7 (2 IMSR, both in Current → now `Active`).
- Verified: `node --check`; local server; Rowe Creek complex popup badges `ACTIVE`; `Not current` + IMSR lists 13 fires including Kilolitna (searchable), each badged `Not current`; `Not current` alone lists no-closure/not-in-current fires with a plain `N shown`; no console errors.

### 2026-07-25 map always mirrors the list (single source of truth)

- Motivation: an IMSR audit found the default map (drawn from the live Current layer) showed ~112 fires while the drawer's IMSR list showed 131 — the ~18 IMSR fires that had dropped out of the Current feed (Kilolitna and other Alaska monitor fires) were in the list but had no marker on the map. Per request, the map and list must always match.
- Change: the map now **always** mirrors `fireMirrorRecords` (the loaded list) in every state, including the default — the separate "live active" render path is gone. `renderFireLayers()` and `renderComplexMarkers()` always iterate the list rows; `fireRenderRecord()` prefers the list row; geometry is always borrowed from `fireEvents` by IRWIN (point-only fallback for rows not in the Current feed). `fireMirrorActive` no longer gates rendering — it now only flags a non-default view for the banner/status/accessible name.
- Plumbing: `initialize()` loads the default list on startup; `loadFireDatabase()`'s `fireDrawer.hidden` early-return was removed so the list loads/refreshes with the drawer closed; a `refreshWildfires()` success reloads the default list on the five-minute cycle (default state only, so filtered/paginated views are not disrupted — their geometry still refreshes because `renderFireLayers()` runs each refresh).
- Verified: `node --check`; local server; default map and drawer both read **131** (was 112 vs 131), Alaska not-in-feed fires now plotted; `Out + IMSR` shows 2 on both map and list; manual refresh repopulates the map to the full default set (not blank); no console errors.
- Issue 2 from the audit (5 IMSR fires — Sharpe, Spring Creek, River, MOON, LITTLE — carry closure dates and badge as Contained/Controlled/Out) was left as-is by request: the app should report WFIGS data honestly.

### 2026-07-25 fix: complex popup could not reopen after being dismissed

- Symptom: clicking a complex diamond opened its popup the first time, but after dismissing it with the close button, clicking the same diamond again did nothing — until a different fire was selected, which "reset" it.
- Cause: `openFirePopup()` had an "update in place if the same selection popup is already open" shortcut keyed on Leaflet's private popup reference. Leaflet can retain a popup dismissed via its close button, so the repeat click matched the shortcut and called `setContent()` on a dead popup instead of opening a new one.
- Current fix: `popupopen`/`popupclose` maintain the public-event-backed `activePopup`, and a `WeakMap` stores the app's fire/selection/id metadata without adding private-looking properties to Leaflet objects. The shortcut still requires `isOpen()`. Verified live: close + re-click reopens the complex popup repeatedly; clicking while open updates in place with no duplicate popups.

### 2026-07-25 complex diamond click no longer reframes the map

- Change: clicking a complex diamond on the map now opens its popup in place (`openFirePopup(record, latlng)`) instead of running `zoomToComplex()`. This makes all map clicks uniform — ignition dots, perimeter polygons, and complex diamonds all just inspect in place without reframing — and reserves rescaling for the Fires list (a single-fire row still runs `selectDatabaseFire()`, a complex group header still runs `zoomToComplex()`). The list is now the sole navigation/reframe surface; the map is inspect-only.
- Scope: one-line handler change in `renderComplexMarkers()`. `zoomToComplex()` itself is unchanged and still wired to the complex list-header button. No change to popup content, toggles, anchoring, or the popup-reopen guard.

### 2026-07-25 complex diamond hover now matches ignition circles/perimeters

- Symptom: hovering an ignition circle or a perimeter visibly emphasized it (grow + pointer cursor via `bindFireInteraction`'s `setStyle` on `mouseover`/`mouseout`), but hovering a complex diamond did nothing — the diamond marker had only a `click` handler and no hover response.
- Fix: `renderComplexMarkers()` now binds `mouseover`/`mouseout` on each diamond marker. Because a `divIcon` has no `setStyle`, the handlers toggle `pm-fire-hover` on the map container (pointer cursor, shared with the circle/perimeter path) and `pm-hovered` on the inner `.pm-fire-complex-diamond` span (via `marker.getElement()`). The new `.pm-hovered` CSS rule applies `transform: rotate(45deg) scale(1.18)` (≈ the circles' hover radius bump) and a deeper shadow, with **no** CSS transition so it snaps instantly like the circles' `setStyle` hover rather than animating.
- Verified: local server; the live Leaflet `mouseover` grows the diamond (22.63 px → 26.70 px) and sets the map cursor to `pointer`, `mouseout` reverts both; class toggles cleanly with no stray mutations; no console errors. (Note: the preview browser's `getComputedStyle`/`getBoundingClientRect` under an active CSS `transition` reports pre-transition transform values — a measurement artifact, not a rendering bug; confirmed by testing with the transition removed.)

### 2026-07-25 reliability and equivalent-weight optimization pass

- **Confirmed wildfire toggle bug fixed.** Reproduction was Active + IMSR (`112` rows in the verification run) → close Wildfires → re-enable within the five-minute geometry freshness window. `clearFireMirror(false)` correctly reset membership, but the old enable path only reloaded when geometry was stale, leaving `0 significant` on the map beside the stale drawer list. Re-enable now reloads whenever `fireDatabaseNeedsReset`, independent of geometry age; verified recovery to the default `132` map/list rows.
- **Refresh consistency.** A partial Current geometry refresh now also reloads a reset default list, so unified refresh cannot leave an empty map merely because complex/perimeter data was partial. The degraded direct-GeoMet refresh path installs the newly fetched manifest, timeline alignment, and selected absolute hour before reporting success, with explicit rollback if that frame fails.
- **Request and lifecycle reliability.** HMS first-load requests, database count queries, and page-hide teardown now have dedicated abort/generation handling. A successful HMS result remains session-cached; an in-flight off/on sequence starts a clean request and cannot redraw a superseded result. Image-load timeouts detach handlers and clear the failed source. Pending preview datasets use a generation/cache-identity check and release decoded atlases if invalidated while loading.
- **Data integrity and safety.** Both ArcGIS paging helpers now fail explicitly on a non-progressing or over-100-page response instead of silently truncating. Database rows are normalized/de-duplicated before DOM append, preserving the drawer/map one-to-one contract while raw result offsets continue advancing. HMS density is normalized to the fixed known classes, and tooltip content is constructed with `textContent`.
- **Equivalent simplification/performance.** Removed dead `recent`, `manifestHourOffset`, refresh-label, `quiet`, CSS-variable/rule state; consolidated identical RGB-ramp projection into `nearestRampPosition()`; replaced repeated whole-event complex-member scans with the `fireComplexMembers` index rebuilt alongside `fireEvents`; replaced Leaflet-private popup access with public events + `WeakMap`.
- **Timeline/build reliability.** The cache builder now takes every common contiguous hour independently on the history and forecast sides through the pure `scripts/cache_timeline.py` helper. Browser `Now` alignment uses floor-hour semantics. The workflow uses a unique `cycle-run_id` rolling-cache key and saves every successful run, fixing the immutable-exact-key behavior that discarded newly downloaded history during later runs of one model cycle.
- **Regression automation.** Added `scripts/test_static_contracts.py` and a pre-build workflow step. The six checks cover asymmetric/gapped/missing-Now timelines, embedded JavaScript parsing, removal of private/unsupported guards, floor-hour alignment, and rolling-cache key/save behavior.
- Verified: six automated checks; Python compile; `git diff --check`; local HTTP server; all four particle/extent combinations reach `Forecast frame loaded`; current wall time `22:24` aligns to `10:00 PM` Now; default map/drawer both show `132`; HMS rapid on/off/on loads `135` polygons with correct attribution; complex popup closes and reopens; desktop visual inspection shows unchanged controls/layer ordering.

### 2026-07-26 unified final filtering and WFIGS hydration performance

- Fixed the empty `Not current` result reported with IMSR off. The old path paginated the broad YTD no-closure candidates in groups of 50 and only then removed Current incidents; on 2026-07-26 the first three newest candidate pages produced zero final rows even though thousands of older matches existed, and the UI misleadingly said `No more wildfires`. `collectFilteredStatusPage()` now resolves Current membership, applies the shared `fireStatus()` rule, automatically scans until it fills the final 50-row page or exhausts the source, buffers surplus matches for `Load more`, and never reports a raw candidate page as the visible result page.
- Unified status truth: SQL remains a candidate-set optimization, while Active/Contained/Controlled/Out/Not current chips, row badges, popups, and map styling all ultimately use `fireStatus()` through `fireMatchesDatabaseStatus()`. Status-filter totals are intentionally plain `N shown` because SQL counts are not guaranteed to equal final post-membership counts.
- Tightened IMSR to exclude official containment/control/out dates in both SQL and `isImsrGradeFire()`. This removes contradictory closed-status rows from the default All + IMSR smoke-oriented map while preserving still-reporting U/I fires that have left Current.
- Reduced load latency without changing canonical output: supplement candidate status with lightweight no-geometry perimeter attributes, reject nonmatches before polygon hydration, replace per-page membership batches with cached service-wide OBJECTID sets, reuse one locally filtered Current-only base snapshot, use automatic POST for up to 500 perimeter/member IrwinIDs per request, run independent hydration batches with a two-request concurrency cap, hydrate YTD/Current sources in parallel, and reuse bounded five-minute caches for membership, perimeter attributes/results (including empty results), and complex-member point sets. Manual unified refresh clears these caches.
- Regression coverage now asserts final-filter-before-page behavior, IMSR end-date exclusions, bounded parallel hydration, and geometry-cache presence in addition to the existing canonical snapshot/selection contracts.

### 2026-07-26 WFIGS cold-start performance and quota fix

- Root cause: startup launched two independent WFIGS pipelines at once. The visible canonical All + IMSR load first downloaded the entire unfiltered Current location view with geometry to find a tiny Current-only difference, while the legacy background refresh simultaneously downloaded all Current points and perimeters. The canonical path then queried perimeter attributes and the same full polygons separately. This redundant traffic substantially lengthened cold starts and could consume enough shared ArcGIS request units to produce `WFIGS database temporarily unavailable`.
- The startup and automatic five-minute paths are now canonical-only. The legacy full-Current health/bookkeeping refresh no longer starts in `initialize()` and is reserved for the explicit unified full refresh. The layer readiness/error indicator is driven directly by the canonical snapshot, and its Retry action retries that snapshot instead of launching the legacy full download.
- The default All + IMSR loader now requests the selective IMSR Current and Year-to-Date point sets concurrently, derives their union and Current membership directly, and never downloads all Current incidents or the two service-wide top-level membership sets. Non-default Current-only loads also include their active server-side modifiers in the Current query.
- The small startup candidate set now receives one full perimeter hydration pass, which simultaneously supplies geometry and missing end-state attributes; the former preliminary perimeter-attribute request is removed for this path. Final IMSR validation and pre-commit complex hydration remain intact.
- Lifecycle guards now prevent a `pageshow`, wildfire re-enable, or Retry action from starting a competing refresh while the canonical database controller is active. Wildfire re-enable and the five-minute/visibility cycle reload the canonical snapshot directly; a successful default commit owns the five-minute wildfire freshness timestamp.
- Regression coverage asserts the parallel unified IMSR path, selective Current-only cache key, canonical-only `initialize()`, and absence of a startup `refreshWildfires()` call.

### 2026-07-27 hourly WFIGS cache architecture

- Replaced every user-facing WFIGS ArcGIS request with an hourly same-origin cache built in the Pages workflow. This isolates page load and filter latency from WFIGS response time, organization-wide 429 quota windows, and temporary ArcGIS unavailability.
- Added `scripts/build_wildfire_cache.py`, which downloads the four official WFIGS layers with at most two concurrent requests, builds the complete canonical YTD + Current-only catalog (including unmatched perimeter-only events) and the final All + IMSR startup subset, then publishes hash-addressed assets behind an atomically replaced manifest. A failed scheduled refresh retains the prior complete cache.
- Split client loading into a critical default path and a background catalog path. The default asset renders first; the full catalog is then fetched, SHA-256 checked, parsed, and stored in IndexedDB from a dedicated Worker, with chunked main-thread inflation and automatic capped-backoff retry.
- Converted status, IMSR, large-fire, name-search, sort, total, and pagination behavior to local filtering over the complete catalog. Non-default input received before readiness is queued, and every selection/complex expansion continues to reuse pre-hydrated canonical geometry with no request.
- Added source freshness text (`updated N min/hr/day ago`) to both the Layers status and drawer status, refreshed once per minute. The hourly lifecycle and unified manual refresh cache-bust only the small manifest/default path; a forced version change terminates the superseded catalog Worker and rejects late commits.
- At that stage browser CSP still allowed the live `services2.arcgis.com` HMS source while excluding WFIGS's `services3.arcgis.com`; the later hourly HMS cache update below supersedes that direct-browser HMS path.

### 2026-07-27 hourly HMS cache and timeliness

- Replaced the direct-browser ArcGIS HMS request with `scripts/build_hms_cache.py` in the existing hourly Pages workflow. The builder prefers the non-empty live NOAA ArcGIS layer and otherwise converts the newest official dated NOAA KML archive to GeoJSON, publishing one content-addressed asset behind an atomically replaced same-origin manifest.
- Added distinct source and time metadata: `sourceKind`, source update time, analysis date, observation start/end, cache generation time, polygon count, byte size, and SHA-256. The UI identifies archived data as a `previous analysis`, prints the exact latest observation time in the reader's timezone, and separately reports how recently the hourly cache checked.
- The browser validates and session-caches the same-origin asset, checks for a newer version hourly while HMS is visible, retains already-rendered polygons on a failed replacement, and preserves abort/generation protection across rapid off/on actions. Retry forces a cache recheck. The unified manual refresh always rechecks HMS but returns its visibility to the default off state, preloading the refreshed snapshot in memory for the next toggle.
- Unified-refresh follow-up: the map utility now reports `Refresh smoke, wildfire, and HMS data`, awaits all three cache results, treats complete success as all three succeeding, and reports partial success when only a subset succeeds. HMS cache acquisition is therefore consistent with RAQDPS and WFIGS while the reset remains consistent with the application's default display.
- Browser CSP is now `connect-src 'self'` only for both HMS and WFIGS. Regression coverage enforces the cache-only HMS loader, workflow publication path, archive KML conversion, live-over-archive preference, fallback metadata, timestamp display contract, and content digest.

## Rendering architecture

Use Leaflet with five selectable basemaps:

- **Day**: CARTO Positron, and the default.
- **Dark**: CARTO Dark Matter.
- **Satellite**: Esri World Imagery.
- **Fuel**: a wildfire fuel-type composite described below.
- **Land cover**: a tri-national Sentinel-2 10 m land-cover view described below.

Preserve the corresponding Leaflet, OpenStreetMap, CARTO, and Esri attribution.

### Thematic single-image basemaps

Fuel and Land cover are thematic basemaps: a CARTO `light_nolabels` background, one dynamic raster rendered through the custom `SingleImageLayer`, and CARTO `light_only_labels` place names on top. `SingleImageLayer` requests one viewport-sized image per settled view instead of a tile grid, because the source servers render a single padded image in ~0.5–4 s but take multiple seconds per individual tile. It supports two endpoint modes via `options.mode`:

- `"wms"` — OGC WMS 1.1.1 `GetMap` (the LANDFIRE fuel layer).
- `"arcgis"` — ArcGIS ImageServer `exportImage` with `bboxSR/imageSR=3857`, `format=png32`, and an optional `time` window (the Sentinel-2 land-cover layer, whose tiles are LERC-only but whose `exportImage` is enabled).

Only the request URL differs between modes; the mercator viewport math, 25%-per-side padding, 2048 px long-edge cap, world-bounds clamp, `Image` preload then `L.imageOverlay` swap (previous image retained until the replacement loads; failed load keeps the old image and the next settled move retries), the skip-when-still-covered check (re-request when zooming in past the loaded zoom so the raster sharpens), the generation-counter stale guard, and the zero-size early return with `resize` re-trigger are all shared.

Both thematic rasters render into the shared `themePane` (z-index 250) with labels in `themeLabelPane` (260); these sit above the tile pane (200) and below the smoke overlay pane (400) and `firePane` (450). Only one thematic basemap is active at a time, so a single shared pair of panes is sufficient.

Basemaps are built through `createBasemapLayers()`, which turns each `BASEMAPS` entry's `layers` array (plain tile `url`, tiled `wms`, or `singleImage` endpoint specs) into Leaflet layers tracked in the `baseLayers` array; `setBasemap` removes and recreates the whole array. Single-layer basemaps keep the same structure with a one-element array.

### Fuel basemap

The Fuel basemap composes CARTO `light_nolabels`, the LANDFIRE fuel raster, the CWFIS fuel tiles, and CARTO `light_only_labels`:

1. CARTO Positron `light_nolabels` raster tiles as the neutral background (tile pane, `zIndex` 1).
2. LANDFIRE FBFM40 (Scott & Burgan 40 fire behavior fuel models) for the United States from the official USGS GeoServer at `https://edcintl.cr.usgs.gov/geoserver/landfire/ows`, merged layers `LF2024_FBFM40_CONUS,LF2024_FBFM40_AK,LF2024_FBFM40_HI`, rendered through `SingleImageLayer` in `"wms"` mode (one viewport-sized `image/png8` GetMap per settled view, `themePane`).
3. Canadian FBP System fuel types via tiled WMS from the official Natural Resources Canada CWFIS GeoServer at `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms`, layer `cffdrs_fbp_fuel_types` (tile pane, `zIndex` 2).
4. CARTO Positron `light_only_labels` place-name tiles on top (`themeLabelPane`, above the LANDFIRE image).

Why single-image for LANDFIRE (performance-critical). Do not render the LANDFIRE fuel layer as `L.tileLayer.wms`. Measured 2026-07-24: the LANDFIRE GeoServer takes roughly 2–20 seconds per dynamic 256 px GetMap tile, its GeoWebCache WMTS returned 16–22 second responses even on repeats (multiple backend nodes with independent, mostly cold caches), and the `lfps.usgs.gov` ImageServer `exportImage` path measured 5–24 seconds — so a 24-tile viewport was effectively unusable, while a single viewport-sized GetMap for the same coverage consistently returned in roughly 0.5–4 seconds. CWFIS does not have this problem (sub-second tiles) and stays tiled.

Constraints and rationale:

- `LF2024` is the newest LANDFIRE release with complete CONUS, Alaska, and Hawaii FBFM40 coverage on the WMS. `LF2025_FBFM40` exists only for CONUS/AK plus seasonal variants, and `LF2024_FBFM40_PRVI` (Puerto Rico/USVI) is not published on this WMS — requesting it makes the whole merged GetMap fail with `LayerNotDefined`, so it must not be added without re-verifying capabilities.
- Mexico and other non-US/Canada areas intentionally show only the neutral background: neither national fuel product covers them.
- The US and Canadian layers use different national classification systems and palettes; the border seam is expected and must not be "fixed" by recoloring either official rendering.
- When the Fuel basemap is active, add the LANDFIRE (USGS) and CWFIS (NRCan) attribution entries; they must disappear when another basemap is selected.

### Land cover basemap

The Land cover basemap composes CARTO `light_nolabels`, the Sentinel-2 land-cover raster, and CARTO `light_only_labels`:

1. CARTO Positron `light_nolabels` background (tile pane, `zIndex` 1).
2. Sentinel-2 10 m Land Cover (Impact Observatory / Microsoft / Esri) from the ArcGIS ImageServer `https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer`, rendered through `SingleImageLayer` in `"arcgis"` mode (`themePane`). The service is a global annual time series (2017–present); the layer pins the 2020 composite with `time=1577836800000,1609459200000` (2020-01-01 .. 2021-01-01 UTC in epoch ms). `format=png32` is required so ocean/no-data are transparent — the default `png` returns opaque RGB and paints the sea black.
3. CARTO Positron `light_only_labels` place names on top (`themeLabelPane`).

Constraints and rationale:

- This is a single global layer, so unlike Fuel it covers all of North America including Mexico with one continuous classification — no US/Canada split and no border seam.
- The service exposes `exportImage` (mercator PNG) even though its cached tiles are LERC-encoded in a Lambert Azimuthal Equal-Area scheme; the LERC tiles cannot drop into a mercator Leaflet map, so `exportImage` is the required path.
- CEC NALCMS 2020 was the originally requested product but was rejected after investigation: its only official service (CECAtlas hosted, plus the blocked `gis.cec.org` WMS) is LERC + LAEA + tiles-only with no reachable mercator/PNG endpoint, so it cannot be added without a self-hosted reprojection pipeline. ESA WorldCover was also rejected: Terrascope's rendered WMS was unreachable from both the build sandbox and the in-app browser, and the Esri-hosted copies are LERC tiles-only like CEC. Sentinel-2 10 m LULC was the one tri-national land-cover product with a verified, reachable mercator render path.
- When the Land cover basemap is active, add the Sentinel-2 / Impact Observatory attribution entry; it must disappear when another basemap is selected.

### Thematic legend

A collapsible `Legend` control (lucide `palette` icon) appears in the toolbar next to the Map menu only while a thematic basemap (Fuel or Land cover) is active; `setBasemap` calls `renderLegend(basemap)` and hides/closes the control for any basemap without legend content, so the unified refresh reset also removes it. It is a standard `.pm-menu` details element and inherits the shared menu behavior (mutual exclusion, outside-pointerdown close, Escape close with focus return).

- Legend content lives in `LEGENDS`, keyed by basemap. `renderLegend` rebuilds the panel only when the basemap changes (idempotent: reopening the same basemap's legend keeps expanded groups) and updates the panel and summary `aria-label` for the active theme.
- A region with a `groups` array renders as collapsible family rows (Fuel): US FBFM40 GR/GS/SH/TU/TL/SB/NB and Canada Conifer/Deciduous/Mixedwood/Grass/Non-fuel, each a color strip that expands into per-class swatch/code/name rows. This grouping exists because a flat 60-row list defeats quick visual matching.
- A region with a flat `classes` array renders as a simple swatch list (Land cover): the nine Sentinel-2 classes (Trees, Rangeland, Crops, Flooded vegetation, Water, Snow/ice, Bare ground, Built area, Clouds), which are few enough not to need grouping.
- Swatch colors are hard-coded in `LEGENDS`, copied verbatim from each service's official legend (fuel: `GetLegendGraphic&format=application/json`; land cover: the ImageServer `/legend` swatch PNGs), all fetched 2026-07-24, so they match the rendered basemap exactly. If a source layer version changes (for example LF2024 → a newer LANDFIRE release, or the LULC year pin), re-fetch that legend and update `LEGENDS` in the same change.
- Legend DOM is built with `textContent`/`createElement` only; the panel scrolls within `min(62vh, 520px)` and fits 320–390 px phones.
- The toolbar z-index is 1010 (above Leaflet's 1000 control layer) so the legend popover is not overlapped by the zoom stack; the fire drawer (1100) intentionally stays above both.

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
- Generate a schema-v5 manifest containing the four datasets' common, continuous `timelineHours` coverage and lossless WebP field-atlas metadata. Starting at hour 0, extend independently through every contiguous common history hour and every contiguous common forecast hour; do not shorten the longer side merely to make the range symmetric. At runtime, never expose an hour whose cached field is missing for any selectable dataset.
- Do not reject an otherwise complete schema-v5 cache merely because its manifest is more than four hours old. Align the browser's current integer model hour to the matching cached absolute valid time, translate manifest-relative field hours into current-relative slider hours, and expose the entire continuous range. For example, a `-59…+59` cache delayed by four hours becomes `-63…+55`; `Now` moves right while all 119 cached hours remain usable.
- Keep `Now` available at any track position, including an endpoint. Align it to the current completed hour with floor semantics, never to a future hour after the wall clock passes `:30`. Only abandon the schema-v5 timeline when the current valid hour lies outside its continuous cached coverage or a required field asset fails validation. Use direct GeoMet only after that cached-field path is unavailable.
- Make delayed-cache use clear in accessible status text. Do not imply that an older model run is newly produced data; the displayed valid hour remains exact, while the cache refresh may be delayed.
- Restore the newest rolling GitHub Actions frame cache before each build and save the refreshed bounded set afterward. Use a unique `cycle-run_id` cache key for every run, with cycle and global restore prefixes, because GitHub Actions caches are immutable: reusing one exact cycle key would restore successfully but prevent later hourly runs from persisting newly downloaded history. Keep the two newest rolling v5 caches after saving. GeoMet currently advertises roughly 48 hours of reference cycles, so retaining still-needed frames from prior scheduled runs is what allows the deployed artifact to maintain historical coverage without committing binaries.
- Keep the cache build's minimum success ratio at 80% on every run. A few edge-hour or transient GeoMet failures must not block publication of an otherwise valid common timeline; the manifest still exposes only the continuous hours around Now present for all four datasets, with each side allowed to end independently.
- Run the Pages cache workflow hourly. Most hourly runs reuse the rolling raw and display caches and mainly advance the manifest's `Now`; the heavier frame refresh occurs when a new 00 or 12 UTC model run becomes available.
- Run `python na_smoke_map/scripts/test_static_contracts.py` in the workflow before selecting/building the model cycle. The dependency-light suite checks asymmetric timeline selection, embedded-JavaScript syntax, public/compatible runtime guards, and the unique rolling-cache key contract.
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
- Immutable field atlases are already published to R2 by `scripts/publish_r2_cache.py` when the workflow's R2 secrets are configured (the manifest itself still ships in the Pages artifact). The remaining deferred item is publishing the latest manifest through R2 as well, so successful cache builds do not depend on a Pages deployment.
- Add an external freshness/asset health check and alert only after repeated failures or a materially delayed manifest.

Discuss the exact workflow design with the user before implementing these deferred items.

### Spatial and temporal interpolation

Interpolation is a presentation treatment and must not be described as creating new atmospheric information:

- Infer the scalar ramp position first, alpha-weight it by source coverage, and apply a restrained Gaussian blur to the scalar and coverage fields before packing them at build time. Smoothing the scalar field rather than already-colored pixels removes high-concentration stair steps while preserving a continuous plume. This is display smoothing, not a higher-resolution forecast.
- Keep the original 1000 × 625 WMS image as the scientific source grid. In normal schema-v5 operation, upload the pre-smoothed fields from the decoded WebP atlases and use GPU linear spatial sampling to render them into the fixed 1500 × 938 display canvas. Reconstruct the scalar position from weighted value and coverage, then apply the selected monochromatic palette in the shader.
- Linearly interpolate premultiplied pixel color and alpha from the two adjacent field hours in the single WebGL canvas over approximately 900 ms during playback. Start the next ready hour on the following animation frame so the animation has no fixed pause between frames.
- Keep visible timeline labels and resting thumb positions on integer model hours. During pointer dragging, allow a fine-grained internal slider value and synchronously set the adjacent field hours, channel masks, and fractional shader mix. On release, snap to the nearest integer hour without changing render source, resolution, canvas, or image quality.
- Dragging must follow the pointer in either direction and during random jumps without debounce, delayed network requests, or a post-release clarity swap. Every intermediate and resting state must use the same smooth full-grid field renderer.
- Disable visual interpolation transitions when `prefers-reduced-motion` is active. This applies to temporal fades and decorative animation only; the 250 ms zoom-transform transition on the pollution canvas is geographic synchronization with the basemap tiles and must remain active under reduced motion.

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

- Light daytime basemap by default, with compact options for dark, satellite, wildfire fuel-type, and land-cover maps.
- Warm orange/coral primary accent rather than a generic bright blue interface.
- Compact icon-led floating controls. Keep smoke, ignition, and perimeter visibility plus particle/extent fields inside the temporary Layers menu; keep basemap choices inside the temporary Map menu so closed controls occupy very little map space.
- Keep the separate Fires control for the tabbed US WFIGS and Canadian CWFIS databases. Do not put a permanent wildfire-symbol legend in the Layers menu.
- Horizontal color scale rather than a tall official legend that consumes map space.
- Keep the horizontal legend compact—roughly 200 px on desktop; on phones it spans the bottom dock's width inside the fused panel—so it does not obscure a large portion of the map.
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
- The page scale must never change on phones. Keep `maximum-scale=1, user-scalable=no` in the viewport meta, keep every text-entry and select control at a font size of at least 16 px so iOS never auto-zooms on focus, and keep `touch-action: manipulation` on tappable controls (buttons, summaries, labels, inputs, selects, and links) so double-tap cannot zoom the page. Map pinch gestures belong to Leaflet and must remain unaffected.
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
- Scope component styles beneath `#north-america-pm25` to avoid host-page collisions. A deliberately minimal set of page-level rules (`:root` custom properties, `box-sizing`, `html/body` overflow, focus-visible styling, `[hidden]`, `.sr-only`) remains global because the page is currently the sole occupant; scope them if the map is ever embedded in a host page.
- Use CSS custom properties for page and interface colors so the visualization can inherit a host theme.
- Keep external resource URLs HTTPS-only, and keep Subresource Integrity (`integrity` + `crossorigin="anonymous"`) attributes on the version-pinned CDN script and stylesheet tags; recompute the hashes whenever a CDN dependency version changes.
- Keep the static cache manifest and frame URLs relative to the deployed `na_smoke_map/` path so they work on the `jianzhaobi.github.io` project site.
- Preserve the current particle/extent dataset matrix as a single source of truth in JavaScript.
- Use `Intl.DateTimeFormat` for local and UTC timestamps rather than manually formatting dates.
- Clamp timeline offsets to the full continuous range after aligning the manifest's cached valid hours to the browser's current integer model hour. Present the current-hour slider position as “Now” wherever it falls, earlier positions with negative relative hours, and later positions with positive relative hours.
- Use generation counters or an equivalent cancellation mechanism so stale asynchronous image loads cannot replace a newer user selection.
- Preserve the default `day` basemap and the `day`, `dark`, `satellite`, `fuel`, and `landcover` basemap option values.
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

1. Run `python3 scripts/test_static_contracts.py`, then check Python compilation and `git diff --check`. The regression script includes the embedded-JavaScript syntax check and timeline/workflow contracts.
2. Load the standalone HTML through a local HTTP server rather than relying only on a `file:` URL.
3. Confirm all four particle/extent combinations reach the loaded state.
4. Visually inspect wildfire smoke + entire atmosphere for yellow projection wedges, rectangles, or other model-domain artifacts.
5. Scrub across every available side of the possibly non-central Now position, use previous/next, Reset, and play several frames.
6. Confirm the previous frame remains visible while the next frame loads and that there is no vacant flash.
7. Confirm the horizontal legend title, scale, and units update correctly.
8. Confirm the timeline is always visible, places “Now” at its correct possibly non-central position, and has correct Play/Pause and Reset states and accessible labels.
9. Check desktop and phone layouts for clipping and horizontal overflow.
10. Check the browser console and data status for relevant errors.
11. Switch among Day, Dark, Satellite, Fuel, and Land cover and verify both appearance and attribution. For Fuel, confirm the LANDFIRE single image over the US (exactly one `edcintl` request per settled view, replaced after zoom without a blank gap), CWFIS tiles over Canada, place labels on top, LANDFIRE/CWFIS attribution present only while Fuel is active, and no broken imagery at continental and deep zooms. For Land cover, confirm the Sentinel-2 single image (exactly one `exportImage` request per settled view, replaced after zoom, sharper at deeper zoom) covers all of North America including Mexico, ocean/no-data is transparent (not black), the Sentinel-2/Impact Observatory attribution appears only while active, and 10 m detail resolves at city zoom. Confirm the Legend control appears only on Fuel/Land cover, opens above the zoom controls, renders grouped family rows for Fuel and a flat swatch list for Land cover with swatches matching the map, its content swaps correctly when switching between the two thematic basemaps, scrolls within its capped height, closes on Escape/outside click, and disappears (closed) when the basemap changes to a non-thematic one or the unified refresh runs.
12. Confirm light concentrations remain transparent, wildfire smoke uses the monochromatic orange/brown ramp, and total PM2.5 uses the distinct monochromatic yellow-brown ramp without hiding the basemap completely.
13. Inspect the daytime basemap for tile-grid seams at the initial zoom and after zooming.
14. Click a plume pixel and verify the popup shows pollutant type, vertical extent, and inferred concentration on three lines with the active layer's unit, without an approximation symbol or time. Verify its close “×” works on desktop and mobile. Then click a transparent or no-data pixel and verify that no popup remains.
15. During playback, confirm there is exactly one pollution canvas and no pollution `<img>` overlays. Inspect several transition midpoints for brightness pulses or vacant flashes.
16. Drag the slider slowly forward and backward, then rapidly across random positions. The thumb and plume must track continuously during pointer movement, visible hour labels and release positions must remain integer hours, and every intermediate and resting state must keep the same fixed high-resolution canvas and smooth full-grid field source. Confirm that release causes no delayed full-frame request, clarity swap, or temporal jump.
17. Zoom in and out repeatedly over a distinct plume edge; confirm the basemap and pollution canvas scale and settle together without visible lag.
18. Confirm the initial view focuses on the United States and Canada at desktop and phone sizes, and that the location control displays a blue current-location marker and zooms to it after permission is granted.
19. Confirm playback loops from the final forecast frame to Now and continues, and switch pollutant or vertical extent during playback to verify the current hour is preserved and animation resumes without a blank map.
20. Validate a generated schema-v5 cache manifest and lossless weighted/coverage WebP atlas set. Confirm that a delayed manifest is re-aligned without discarding valid hours, the page loads only the selected dataset's field atlases before enabling the timeline, performs no field or GeoMet request when dragging or releasing, and still falls back safely when a field asset is absent.
21. Confirm every build-time Current and Year-to-Date WFIGS request contains its documented WF/CX category constraint, that no RX event appears anywhere, and that the browser makes no request to `services3.arcgis.com`. Confirm CX records appear only where documented: as database roll-up rows (with the `Complex` badge, no complex-child rows alongside), database selections, and as diamonds with their member-fire geometry — a CX parent is never drawn as a WF ignition circle.
22. Exercise WFIGS point-only, perimeter-only, point-plus-perimeter, multiple-polygons, missing attributes, missing geometry with reported initial coordinates, missing location, duplicate IrwinID, and perimeter-only event cases.
23. Confirm status priority for final ICS-209/Not current, Current/Active, Out, Controlled, Contained, and fallback Not current. Confirm `PercentContained = 100` alone does not create an end state.
24. Confirm the US small default asset populates the All + IMSR map before the full catalog finishes, without opening the drawer, and that **the map count equals the drawer list count**, including IMSR fires that have left Current and any matching Current-only carry-over incident. Confirm the hourly manifest check keeps the default canonical set current, the displayed `updated N min/hr/day ago` age advances without geometry reload, complex diamonds sit with their hydrated member fires, hovering a diamond emphasizes it (grow + pointer cursor) exactly like an ignition circle or perimeter, and clicking a diamond opens the popup on the diamond. Confirm no `Recently closed` control exists and that the initial Layers menu has the documented layer checkboxes: three top-level toggles in order — `Smoke & PM2.5 (RAQDPS)`, `Wildfires (WFIGS)`, `Observed smoke (HMS)` — plus Ignition points and Perimeters, with HMS unchecked. Confirm each option section's heading text matches its toggle label exactly.
25. Confirm Ignitions, Perimeters, Wildfires, and Smoke switches work independently in all meaningful combinations. A selected fire must obey the same Wildfires/Ignitions/Perimeters visibility as its persistent canonical geometry.
26. Hover and click both active and closed-status (mirror-mode) ignition/perimeter geometry. Confirm hover emphasis works, ignition wins over an overlapping perimeter, perimeter wins over smoke when no ignition is hit, and wildfire clicks never open the PM2.5 probe. Create overlapping old/new ignition cases and verify the newest point is visibly and interactively on top before and after multiple zoom redraws. Verify point radii stay at their restrained base size through zoom 6, grow progressively at deeper zooms, refresh after zoom completion, and remain practical click targets through zoom 17.
27. Confirm ignition and perimeter clicks for one IrwinID show identical status and incident attributes, use safely constructed DOM text, and anchor the popup at the appropriate point or polygon click.
28. Open the wildfire database on desktop and phone; test 300 ms name search, all status filters, the independent 300+ acre filter, the IMSR toggle, newest-first and acreage-first ordering, and rapid consecutive actions whose stale local commits arrive late. Confirm that with IMSR off the list paginates by 50 **final** matches and shows the exact `N of TOTAL`; every status filter receives the same exact local total. Confirm All is the correctly sorted YTD + Current-only union; `Not current` alone fills its first page when at least 50 matches exist; `Not current + IMSR` lists still-reporting fires that have left Current; IMSR hides `Load more`; repeated filters complete locally without requests; and a failed cache reset retains the old atomic snapshot.
29. Select active, closed-status (Contained/Controlled/Out), older Not current, point-only, perimeter-only, and multi-polygon records. Confirm no point/perimeter request begins on selection, the persistent and selected ignition coordinates are identical, and the `Data` row does not gain geometry only after clicking. Confirm the map stops any previous animation, centers an available ignition in the padded usable viewport, keeps every matching perimeter visible at no more than zoom 15, and does not shift after the popup opens. Confirm point-only selection flies to zoom 13, selected archived ignitions use a neutral gray-brown fill and white selection border without adopting the active age palette, the phone sheet closes, and missing/disabled geometry reports `Location unavailable` without moving.
30. Confirm large year-to-date fires with final ICS-209 reports or no live membership do not appear as Active, and confirm the Active filter uses the Current service while excluding final reports.
31. Test fresh wildfire/HMS cache loads, hourly/visibility refresh, Layers-menu Retry, and the unified manual three-cache refresh. Before manual refresh, change viewport/zoom, basemap, fire country, particle/extent/hour, playback state, layer switches, popup/selection, database filters/search/sort, and open panels. Confirm refresh restores the complete documented opening state, including the US fire tab and HMS off, while refetching every default smoke atlas plus the latest US wildfire manifest/default asset and HMS manifest/polygon asset. Confirm it preserves an already-known location dot, terminates superseded work, rejects late old-version commits, retains each prior snapshot on its replacement failure, and reports success/partial/error feedback matching the actual three-cache result. After refreshing with HMS initially open or off, confirm HMS remains off and the refreshed in-memory snapshot appears immediately on the next toggle; after an HMS refresh failure, confirm the prior in-memory snapshot and timestamp remain available. Click both map utility buttons over probeable pollution and confirm neither click opens a PM2.5 popup; in particular, switch to Total PM2.5 before refresh and confirm no stale Total PM2.5 probe or popup auto-pan overrides the opening viewport.
32. Inspect WFIGS cache request and payload behavior. On fresh startup, confirm only manifest + default are on the critical path, the default list/map is visible before catalog work begins, and catalog fetch/hash/parse/IndexedDB work runs in the Worker. Confirm a catalog request starts afterward and completes even while the drawer remains closed; filter changes remain responsive during it; selecting a non-default filter early queues and eventually applies it. Once ready, confirm every filter/search/sort/load-more/selection/complex action produces zero WFIGS or extra geometry requests and normally completes within one second. Verify asset byte count/SHA-256 rejection, generation guards, chunked inflation, exact local totals, and IndexedDB same-version reuse.
33. Simulate build-time ArcGIS code 429 and a general WFIGS failure. Confirm the builder honors the quota wait and retry limit, atomically retains a previously complete manifest/assets on failure, and fails when no complete prior cache exists. Simulate a browser catalog failure and confirm the default remains usable while the background retry delay increases up to the 60-second cap and eventually installs the catalog.
34. At 320–390 px widths, verify the Fires bottom sheet, US/Canada segmented tabs, Layers checkboxes, country-specific filter wrapping, search/sort row, neutral sort-button background in both modes, popup width, timeline coexistence, and absence of horizontal overflow.
35. Confirm mobile page-zoom suppression is intact: the viewport meta still declares `maximum-scale=1, user-scalable=no`; every text-entry input and select has a computed font size of at least 16 px (any new form control must comply); tappable controls (buttons, summaries, labels, inputs, selects, and links, including Leaflet's zoom anchors) keep `touch-action: manipulation`; the timeline slider keeps `touch-action: pan-y`; and Leaflet map pan/pinch gestures still work.
36. Exercise the filter/map mirror. The map must always equal the loaded list: in every state the top-level markers/groups are exactly the list rows and use the same canonical geometry. Default open shows no status chip pressed and `IMSR` pressed, with no Contained/Controlled/Out rows because IMSR excludes official end dates. Turning IMSR off, choosing any status chip, enabling Large, or typing updates the map to exactly the loaded final matches and the `Filtered · N fires` banner. With IMSR off, every status page contains up to 50 final matches in the requested sort order; changing sort may change which first-page records are shown but must not change status truth or create a false empty page. With IMSR on the whole bounded matching set is shown and `Not current + IMSR` still includes U/I fires that left Current. Confirm chip clearing and every documented teardown path restores a populated All + IMSR snapshot.
37. Confirm the popup's `ICS-209 report` row appears for any fire with a valid report time and is absent otherwise, and that a complex member fire shows `Part of <CpxName>`. Expand a CX row and verify its members appear instantly without a request; select a member and confirm it reuses its canonical ignition/perimeters. Select a CX parent row and confirm `zoomToComplex()` fits the already-hydrated member/perimeter bounds and performs no request; its raw point fallback may sit at the documented placeholder dispatch coordinate only when no member geometry exists. On the map confirm a CX parent draws its canonical member fires and a diamond at their center, never a circle at the placeholder parent point.
38. Exercise the NOAA HMS observed-smoke cache and overlay. At build time, confirm a non-empty live ArcGIS layer wins, an empty/unavailable live layer falls back to the newest official dated KML containing polygons, the KML fields/rings convert correctly, and a failed refresh retains a previously complete manifest/asset. In the browser confirm HMS is off on first load and draws nothing until ticked; enabling requests only `cache/hms/manifest.json` plus its same-origin content-addressed asset, verifies byte length/SHA-256/version/count, and makes no request to NOAA or ArcGIS. Confirm the polygons render as graded grey Light/Medium/Heavy plumes (dashed outline on the paler classes) in `hmsPane` beneath WFIGS and above modeled smoke, the Layers panel shows the disclaimer and legend, and the status includes polygon count, `previous analysis` for archive fallback, exact `observed through` timestamp, and separate relative `cache checked` age. Confirm the layer does not react to the timeline, playback, or particle/extent changes. Toggle off/on and confirm the in-memory snapshot re-renders instantly; toggle off/on before first load finishes and confirm a superseded response cannot commit. Simulate an hourly replacement failure and confirm visible polygons and their original observation timestamp remain with Retry; confirm a successful newer manifest atomically redraws. Confirm tooltip density is text, unified refresh turns HMS off while rechecking and preloading its cache, and CSP `connect-src` is `'self'` only.
39. Confirm `AGENTS.md` was updated for the current project change and no instruction in it contradicts the final code, data behavior, or workflow.
40. Exercise the Canada tab without reloading the page. Confirm no Canadian request occurs during US startup; selecting Canada requests only same-origin `cache/canada-wildfires` manifest/assets and changes no RAQDPS/HMS state. Confirm the Layers label becomes `Wildfires (CWFIS)`, the point label becomes `Reported fire locations`, Perimeters is hidden, NRCan CWFIS/CIFFC/BC Wildfire Service attribution replaces NIFC, and the default map/list are exactly the matched CIFFC Priority records. Use old `Name (ID)`, grouped-ID, and current plain-name-only CIFFC labels to confirm they control Priority matching/coverage but never appear as fire display names. Verify a BC CWFIS `agency_fire_id` exactly matches a normalized BC `FIRE_NUMBER`, and that every nonblank BC `INCIDENT_NAME` reaches the row/popup title and `Name source` row exactly as supplied, including an ID-shaped or repeated ID value; an unmatched ID or conflicting duplicate names falls back to the CWFIS identifier. Confirm a BC fetch failure produces a newer catalog with `nameSources.BC.status: unavailable` rather than retaining an old Canadian manifest. A grouped row containing one matched and one missing ID must count both IDs independently; a no-ID row counts as one source fire and matches only by the documented coordinate fallback. Confirm only matched CWFIS records are published and both Canada status surfaces show `N of M CIFFC Priority fires mapped · K could not be mapped` without affecting old manifests that lack those optional fields. Turn CIFFC Priority off and test all four Canadian status chips, 300+ acres, search, latest/acreage sort, 50-row pagination, exact totals, selection, acres/cause/response/status popup copy, point-only missing-location behavior, tab-race generation guards, and return to US. Confirm returning to US restores the complete WFIGS behavior and its perimeter preference, while smoke visibility/dataset/hour and HMS visibility never change.

## Known tradeoffs

- A single 1000 × 625 WMS image per frame avoids tile artifacts, stays close to the approximate 10 km model resolution, and lowers client processing cost, but it will become pixelated at unusually deep zoom levels.
- Preloading all full-grid field packs for the selected dataset increases its initial transfer and decoded-memory cost, but it removes timeline-time image loading and guarantees consistent spatial quality while dragging. Three-hour RGB packing, one decoded dataset at a time, and four WebGL field textures bound normal client memory.
- Direct-GeoMet fallback recoloring adds CPU work before a frame becomes ready. It belongs on an offscreen source canvas so it cannot clear the persistent visible WebGL canvas.
- The Pages cache is refreshed on a schedule rather than continuously. Runtime GeoMet fallback is required for gaps between publication and the next successful deployment.
- The fixed image bounds intentionally focus the product on North America. Expanding coverage requires recalculating the matching Web Mercator WMS bounding box and validating the image overlay alignment.
- WFIGS service membership is not a perfect synonym for actively burning. Final ICS-209 reports retained by Current are labeled `Not current`; absent official end dates remain absent rather than being invented.
- The WFIGS cache intentionally trades sub-hour incident freshness for predictable page performance and availability. Its source age may approach one hour plus deployment duration after a successful run, and may be older when a build-time outage causes the prior complete version to be retained; the UI must always expose the actual `generatedAt` age rather than implying live data.
- The complete catalog is a large transfer, but it is outside the default critical path, handled by a Worker, stored by version in IndexedDB, and needed only for non-default filters. Its background retries must never clear or slow the already-rendered default IMSR snapshot.
- WFIGS perimeters are simplified for display and may not preserve survey-level boundary detail. They are operational map context, not cadastral or evacuation-boundary data.
- The 300-acre large-fire threshold and compressed point-radius classes are visualization and browsing aids. Acreage remains printed in text, and circle radius must not be interpreted as an exact area-to-scale symbol.
- Canadian CWFIS points are agency-reported fire locations, not guaranteed ignition coordinates, and this implementation has no Canadian perimeter source. CWFIS hectares are converted to visible acres; the shared 300-acre threshold, report-recency colour, and compressed point-radius scale are browsing aids. CIFFC Priority is a situation-report designation rather than the same operational definition as US IMSR, and a priority label can group multiple fire IDs. CIFFC does not guarantee that every named ID is present in the current CWFIS Agency Reported catalog; missing IDs are counted and disclosed but cannot be mapped without canonical CWFIS geometry.
- The HMS archive fallback prioritizes continuity over same-day recency during NOAA's empty-live-layer window. Previous-day plume extent may no longer describe current smoke, so the UI must keep the `previous analysis` label and exact observation timestamp visible and must never blend or interpolate it with the RAQDPS timeline.
- The Fuel basemap depends on two live government WMS services (USGS LANDFIRE and NRCan CWFIS) with no local cache; an outage leaves the neutral no-label background visible. Mexico has no fuel coverage, the US and Canadian classifications and palettes differ at the border by design, and no in-app class legend is shown because FBFM40 alone has 40 classes and the Map menu must stay compact. The LANDFIRE half is one image per settled view: for the ~1–4 s after a zoom or large pan the previous, coarser image remains visible (brief softness or a padded-edge gap) instead of a loading indicator, which is the accepted cost of avoiding the server's multi-second per-tile latency.
- The Land cover basemap depends on one live Esri/Impact Observatory ArcGIS service with no local cache; an outage leaves the neutral background. It pins the 2020 annual composite and uses a 9-class scheme (Sentinel-2 10 m LULC), so it shows land cover, not fuel: it distinguishes trees vs rangeland vs crops but not conifer vs broadleaf, and its classes are coarser than CEC NALCMS's 19. It is the pragmatic tri-national choice because CEC and ESA WorldCover have no reachable mercator render path (see the Land cover basemap section). Same single-image tradeoff as Fuel: a brief coarse-image interval after zoom/pan.

## Primary artifacts

- `index.html`: the only standalone interactive map and the only application file to update for interface or runtime behavior.
- `scripts/build_static_cache.py`: the bounded static-frame cache generator.
- `scripts/build_wildfire_cache.py`: the hourly WFIGS default/catalog cache builder with atomic publication and prior-complete-cache retention.
- `scripts/build_canada_wildfire_cache.py`: the hourly CWFIS Agency Reported catalog and CIFFC Priority enrichment/cache builder with atomic publication and prior-complete-cache retention.
- `scripts/build_hms_cache.py`: the hourly HMS live/official-archive selector, KML-to-GeoJSON converter, observation-time recorder, and atomic cache publisher.
- `scripts/cache_timeline.py`: dependency-light selection of every common contiguous cached hour around Now; shared by the cache builder and regression tests.
- `scripts/test_static_contracts.py`: dependency-light timeline, embedded-JavaScript, runtime-guard, and workflow-cache regression checks; runs locally and in the Pages workflow.
- `scripts/publish_r2_cache.py`: uploads content-addressed schema-v5 field atlases to Cloudflare R2 when the workflow's R2 secrets are configured; verifies size and SHA-256 metadata and reuses already-uploaded immutable objects.
- `cache/manifest.json`: an empty development fallback; production deployment replaces it with the generated manifest.
- `cache/wildfires/manifest.json`: an empty development fallback; production deployment replaces it and adds the two content-addressed wildfire assets.
- `cache/canada-wildfires/manifest.json`: an empty development fallback; production deployment replaces it and adds the Canadian CIFFC Priority/default and Agency Reported/catalog assets.
- `cache/hms/manifest.json`: an empty development fallback; production deployment replaces it and adds the content-addressed HMS polygon asset.
- `.github/workflows/deploy-pages-with-smoke-cache.yml`: repository-root Pages build and scheduled cache deployment workflow.
- `AGENTS.md`: required, current record of data sources, scientific terminology, UI behavior, implementation constraints, operational history, verification requirements, and known tradeoffs; update it with every project change.

If an inline Codex visualization is also generated, keep it as an HTML fragment without document-level `doctype`, `html`, `head`, or `body` tags, while keeping the standalone file functionally equivalent.
