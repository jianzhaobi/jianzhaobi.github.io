# North America Smoke and PM2.5 Map

## Project purpose

This project provides a browser-based, mobile-friendly map for exploring current and forecast particulate pollution across North America. The sole primary deliverable is `index.html`.

The map must let users independently choose:

- Wildfire-smoke PM2.5 or total PM2.5.
- Surface concentration or entire-atmosphere column loading.
- A single always-visible timeline that starts at the current model hour and continues hourly through the last available hour of the 72-hour model run.

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
- Total PM2.5 should use a clearly distinct monochromatic smoky-blue palette. Vary only lightness and alpha within that single hue family; do not introduce purple, violet, or a second hue.
- Even the darkest concentrations retain some alpha so geographic context remains visible.

Request the artifact-free official WMS PNG, load it with CORS enabled, draw it to an offscreen canvas, infer each pixel's position along the official multi-hue ramp, and recolor it into the particle-specific alpha ramp. Use a blob URL for the processed PNG and revoke stale blob URLs when a buffer is reused.

Do not depend on a custom WMS `SLD_BODY` for per-break transparency. GeoMet accepted the custom color ramp during testing but did not honor the intended per-entry alpha reliably, which painted the model domain as an opaque pale polygon.

### Forecast animation

Preserve the double-buffered animation design:

- Maintain an active image overlay and a hidden standby image overlay.
- Load the requested frame completely into the standby overlay while the active frame remains visible.
- After the standby image fires its load event, raise it, fade it in, and fade the old active overlay out.
- Swap the active and standby references after the cross-fade.
- Preload the following forecast hour whenever practical.
- On a failed or timed-out frame, retain the previous visible map and show a concise status message.
- Never clear or remove the active frame before its replacement has loaded.

Playback should advance through the 73 hourly frames without a vacant flash between frames. Respect `prefers-reduced-motion` by removing or reducing transitions and slowing automated playback appropriately.

The likely model reference time is selected conservatively by allowing roughly seven hours for a run to become available, then choosing the latest 00 or 12 UTC cycle. Forecast requests include both `TIME` and `DIM_REFERENCE_TIME`.

### Spatial and temporal interpolation

Interpolation is a presentation treatment and must not be described as creating new atmospheric information:

- Apply high-quality bilinear canvas upscaling at approximately 1.15× plus a restrained sub-pixel blur to soften raster stair-stepping and make plume edges visually finer.
- Keep the original 1600 × 1000 value grid for lookup and scientific labeling; smoothing applies only to the displayed PNG.
- Linearly cross-fade the active and standby hourly frames over approximately 720 ms. This creates visible intermediate blends between hourly products while preserving their actual valid times.
- Keep automated-playback dwell short after each cross-fade so animation motion remains continuous.
- Disable visual interpolation transitions when `prefers-reduced-motion` is active.

Do not call the spatial smoothing a higher-resolution forecast, and do not call the cross-faded states new sub-hourly model outputs.

### Point-value interaction

Clicking or tapping inside the modeled North America bounds should open a compact Leaflet popup:

- Infer an approximate displayed value from the original ECCC rendered color ramp before the pixel is recolored.
- Keep a `Float32Array` value grid on each active/standby frame buffer.
- Convert the clicked latitude/longitude through the same Web Mercator bounds used by the WMS image before indexing the grid.
- Show the active frame's particle type, vertical extent, valid time, value, and correct unit.
- Show the inferred numeric value without an `≈` prefix. Keep the implementation and accessible context clear that values are inferred from rendered colors rather than read from the raw model field.
- Show the popup's full valid date and time, including year, month, day, weekday, clock time, and time zone.
- Do not show a popup close “×”; clicking elsewhere on the map is sufficient to dismiss or replace the popup.
- For transparent/no-data pixels, say “Below display threshold” rather than claiming the modeled concentration is exactly zero.

## Interface and visual preferences

The desired direction is a modern, map-first weather interface inspired by The Weather Network's fire-and-smoke map, without copying branding or site chrome.

Maintain these preferences:

- Light daytime basemap by default, with compact options for dark and satellite maps.
- Warm orange/coral primary accent rather than a generic bright blue interface.
- Compact icon-led floating controls. Keep particle/extent fields inside a temporary Data menu and basemap choices inside a temporary Map menu so closed controls occupy very little map space.
- Horizontal color scale rather than a tall official legend that consumes map space.
- Keep the horizontal legend compact—roughly 320 px on desktop and narrower on phones—so it does not obscure a large portion of the map.
- Forecast controls and time slider integrated as a floating bottom panel over the map.
- Keep the legend, valid time, frame status, playback controls, and forecast slider fused into one coordinated bottom panel.
- Keep a concise frame-status dot inside the forecast panel: green when the selected frame is ready, orange/pulsing while it loads, and red when unavailable.
- Rounded corners, compact spacing, readable typography, and clear selected states.
- Minimal explanatory chrome; keep the geographic data visually dominant.
- Native, accessible selects and buttons with visible keyboard focus.
- Clear loading, loaded, partial-failure, and unavailable states.

The custom horizontal legend should use the same particle-specific progression as the processed data—orange/brown for wildfire smoke and monochromatic smoky blue for total PM2.5—and track the appropriate surface or column scale and unit.

## Responsive behavior

Cell-phone usability is a core requirement, not a later enhancement.

- The page must not overflow horizontally at narrow widths.
- Controls stack into a single column on small phones.
- Touch targets should remain at least approximately 38 px high.
- The legend must fit within the map width.
- Closed Data and Map menus should be icon-led on phones; icon-only controls require accessible names.
- Keep the basemap menu programmatically labeled, but do not display a visible “Basemap” heading inside the open menu.
- Keep the zoom controls vertically centered along the right edge and place a compact location control directly beneath them.
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
- Do not rely on color alone to communicate selection or loading state.
- Prefer plain-language labels such as “Entire atmosphere” and “Column loading.”

## Implementation conventions

- Keep the application self-contained in `index.html` except for explicitly loaded Leaflet, CARTO, Esri, and ECCC web resources.
- Apply every future application, feature, design, and bug-fix update directly to `index.html`.
- Do not create or maintain a duplicate standalone HTML entry point such as `north-america-smoke-forecast.html`.
- Use plain HTML, CSS, and JavaScript; do not introduce a build step without a clear need.
- Scope component styles beneath `#north-america-pm25` to avoid host-page collisions.
- Use CSS custom properties for page and interface colors so the visualization can inherit a host theme.
- Keep external resource URLs HTTPS-only.
- Preserve the current particle/extent dataset matrix as a single source of truth in JavaScript.
- Use `Intl.DateTimeFormat` for local and UTC timestamps rather than manually formatting dates.
- Clamp forecast indices to the range from the current model hour through model hour 72. Present the first slider position as “Now” and later positions as hours relative to it.
- Use generation counters or an equivalent cancellation mechanism so stale asynchronous image loads cannot replace a newer user selection.
- Preserve the default `day` basemap and the `day`, `dark`, and `satellite` basemap option values.
- Keep canvas recoloring inside the existing double-buffer preparation step so the visible frame is never cleared while recoloring occurs.
- Use integer Leaflet zoom levels (`zoomSnap: 1`) for raster basemaps. Fractional zoom scaling exposed visible tile seams.
- Keep basemap tiles at their native size and use only a transparent outline seam guard; do not enlarge tiles, which made grid lines more visible.
- Preserve Leaflet's 250 ms zoom-transform transition on pollution image overlays while retaining the separate 720 ms opacity cross-fade. A high-specificity opacity-only `transition` shorthand overrides Leaflet's transform animation and makes the basemap and pollution layer appear out of sync.
- Apply `will-change: opacity, transform` to pollution overlays so the browser can keep zoom transforms and forecast fades on the compositor.

When editing files in this workspace, use `apply_patch` for manual changes and preserve unrelated user work.

## Verification checklist

Before handing off a material change:

1. Check the embedded JavaScript for syntax errors.
2. Load the standalone HTML through a local HTTP server rather than relying only on a `file:` URL.
3. Confirm all four particle/extent combinations reach the loaded state.
4. Visually inspect wildfire smoke + entire atmosphere for yellow projection wedges, rectangles, or other model-domain artifacts.
5. Scrub the always-visible forecast slider, use previous/next, and play several frames.
6. Confirm the previous frame remains visible while the next frame loads and that there is no vacant flash.
7. Confirm the horizontal legend title, scale, and units update correctly.
8. Confirm the timeline is always visible, begins at “Now,” and has correct Play/Pause pressed states and accessible labels.
9. Check desktop and phone layouts for clipping and horizontal overflow.
10. Check the browser console and data status for relevant errors.
11. Switch among Day, Dark, and Satellite and verify both appearance and attribution.
12. Confirm light concentrations remain transparent, wildfire smoke uses the monochromatic orange/brown ramp, and total PM2.5 uses the monochromatic smoky-blue ramp without hiding the basemap completely.
13. Inspect the daytime basemap for tile-grid seams at the initial zoom and after zooming.
14. Click both a plume pixel and a transparent pixel; verify the popup uses the active layer's unit, omits the approximation symbol, shows the full valid date/time/time zone, and says “Below display threshold” for transparent pixels.
15. During playback, confirm both image buffers have a 720 ms opacity transition and visibly hold complementary intermediate opacities.
16. Zoom in and out repeatedly over a distinct plume edge; confirm the basemap and pollution overlay scale and settle together without visible lag.
17. Confirm the initial view focuses on the United States and Canada at desktop and phone sizes, and that the location control displays a blue current-location marker and zooms to it after permission is granted.

## Known tradeoffs

- A single 1600 × 1000 WMS image per frame avoids tile artifacts and is well matched to the approximate 10 km model resolution, but it will become pixelated at unusually deep zoom levels.
- Loading full-frame PNGs can use more bandwidth per time step than a small set of visible tiles. The two-buffer design limits simultaneous frame memory and prioritizes visual continuity.
- Canvas recoloring adds CPU work before each frame becomes ready. It belongs in the standby-frame preparation path so it does not create a blank frame.
- The fixed image bounds intentionally focus the product on North America. Expanding coverage requires recalculating the matching Web Mercator WMS bounding box and validating the image overlay alignment.

## Primary artifact

- `index.html`: the only standalone interactive map and the only application file to update.

If an inline Codex visualization is also generated, keep it as an HTML fragment without document-level `doctype`, `html`, `head`, or `body` tags, while keeping the standalone file functionally equivalent.
