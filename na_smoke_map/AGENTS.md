# North America Smoke and PM2.5 Map

## Project purpose

This project provides a browser-based, mobile-friendly map for exploring current and forecast particulate pollution across North America. The sole primary deliverable is `index.html`.

The map must let users independently choose:

- Wildfire-smoke PM2.5 or total PM2.5.
- Surface concentration or entire-atmosphere column loading.
- A single always-visible timeline centered on the current model hour, with a symmetric recent-history and forecast window limited by the model run's remaining forecast horizon.

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
- Generate a schema-v3 manifest containing the four datasets' common, continuous, symmetric `timelineHours` coverage. At runtime, initialize the slider from this list and never expose an hour whose cached frame is missing for any selectable dataset. If the manifest is absent or stale, use the conservative direct-GeoMet range as a fallback.
- Restore the newest rolling GitHub Actions frame cache before each build and save the refreshed bounded set afterward. GeoMet currently advertises roughly 48 hours of reference cycles, so retaining still-needed frames from prior scheduled runs is what allows the deployed artifact to maintain historical coverage without committing binaries.
- Keep the cache build's minimum success ratio at 80% on every run. A few edge-hour or transient GeoMet failures must not block publication of an otherwise valid common timeline; the manifest still exposes only the continuous symmetric hours present for all four datasets.
- Run the Pages cache workflow hourly. Most hourly runs reuse the rolling raw and display caches and mainly advance the manifest's `Now`; the heavier frame refresh occurs when a new 00 or 12 UTC model run becomes available.
- Keep source WMS PNGs only in the rolling GitHub Actions cache. During the build, precompute display-ready PNGs with the selected monochromatic palette, alpha treatment, high-quality smoothing, and final dimensions. Publish only `cache/manifest.json` and these display-ready `cache/frames/` inside the Pages artifact; do not commit generated frames to Git history.
- Build compact scrub-preview atlases for every dataset from the common timeline hours. Each atlas contains a short run of 320 × 200 preview frames and the manifest records the integer hours stored in it. For the selected dataset, load the atlas nearest the current hour first, then fill the rest with a small background worker pool. If a user jumps into an atlas that is not ready yet, prioritize that exact atlas. Retain at most two datasets in memory and use ready atlases for synchronous random-access dragging.
- At runtime, consult the same-origin manifest and load a matching display-ready PNG directly. This bypasses client-side full-frame recoloring and PNG encoding during normal playback. If the manifest, entry, or cached image is missing, stale, partial, or unavailable, fall back to the direct GeoMet WMS request and browser preparation path without clearing the currently visible frame.
- Prepared-frame point probes sample the displayed monochromatic palette and infer its value lazily. Direct-GeoMet fallback frames continue using the original per-pixel value grid.

This arrangement avoids user-device persistence, keeps Git history small, reduces GeoMet latency during normal use, and allows a partial cache to degrade safely.

### Spatial and temporal interpolation

Interpolation is a presentation treatment and must not be described as creating new atmospheric information:

- Decode the rendered source colors into a scalar ramp-position field, then apply normalized high-quality bicubic interpolation at approximately 1.8× plus a restrained 1.1 px Gaussian blur to the weighted scalar field and coverage mask before recoloring. This reduces raster stair-stepping and produces visually continuous plume gradients without bleeding no-data pixels into the modeled field. It is display smoothing, not a higher-resolution forecast.
- Keep the original 1000 × 625 WMS image as the scientific source grid; smoothing applies only to the displayed PNG. Direct-GeoMet fallback retains its original-grid value lookup, while prepared-cache frames use lazy palette sampling for the popup. Build-time preparation removes full-frame canvas recoloring and PNG encoding from normal client playback.
- Linearly interpolate premultiplied pixel color and alpha in the single WebGL canvas over approximately 900 ms during playback. Start the next ready hour on the following animation frame so the animation has no fixed pause between frames.
- Keep the visible timeline labels and resting thumb positions on integer model hours. During pointer dragging, allow a fine-grained internal slider value, synchronously extract the two adjacent integer preview frames, and set the shader mix amount from the pointer's fractional position. On release, snap to the nearest integer hour and smoothly refine the preview to that hour's full-resolution frame.
- Dragging must follow the pointer in either direction and during random jumps without the old debounce delay. Preview textures may be lower resolution while the pointer is moving, but temporal position must update immediately.
- Disable visual interpolation transitions when `prefers-reduced-motion` is active.

Do not call the spatial smoothing a 1 km forecast, and do not call interpolated states new 10-minute or sub-hourly model outputs. Neither treatment creates new atmospheric information.

### Point-value interaction

Clicking or tapping a visibly rendered concentration pixel inside the modeled North America bounds should open a compact Leaflet popup:

- Infer an approximate displayed value from the original ECCC rendered color ramp before the pixel is recolored.
- Keep a `Float32Array` value grid on each direct-GeoMet processed frame.
- Convert the clicked latitude/longitude through the same Web Mercator bounds used by the WMS image before indexing the grid.
- Show the active frame's particle type, vertical extent, and inferred value with the correct unit on three separate lines. Do not display the valid time.
- Show the inferred numeric value without an `≈` prefix. Keep the implementation and accessible context clear that values are inferred from rendered colors rather than read from the raw model field.
- Do not show a popup close “×”; clicking elsewhere on the map is sufficient to dismiss or replace the popup.
- Treat pixels whose processed display alpha is effectively transparent as below the display threshold.
- Clicking a transparent, below-threshold, no-data, or out-of-bounds location should show nothing and close any existing concentration popup.

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

The custom horizontal legend should use the same particle-specific progression as the processed data—orange/brown for wildfire smoke and monochromatic yellow-brown for total PM2.5—and track the appropriate surface or column scale and unit.

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

- Keep all application markup, styling, and runtime logic in `index.html`. The only local runtime companions are the generated static cache manifest and frames; build and deployment automation live outside the application file.
- Apply every future application, feature, design, and bug-fix update directly to `index.html`.
- Do not create or maintain a duplicate standalone HTML entry point such as `north-america-smoke-forecast.html`.
- Use plain HTML, CSS, and JavaScript; do not introduce a build step without a clear need.
- Scope component styles beneath `#north-america-pm25` to avoid host-page collisions.
- Use CSS custom properties for page and interface colors so the visualization can inherit a host theme.
- Keep external resource URLs HTTPS-only.
- Keep the static cache manifest and frame URLs relative to the deployed `na_smoke_map/` path so they work on the `jianzhaobi.github.io` project site.
- Preserve the current particle/extent dataset matrix as a single source of truth in JavaScript.
- Use `Intl.DateTimeFormat` for local and UTC timestamps rather than manually formatting dates.
- Clamp timeline offsets to the symmetric available range around the current model hour. Present the centered slider position as “Now,” earlier positions with negative relative hours, and later positions with positive relative hours.
- Use generation counters or an equivalent cancellation mechanism so stale asynchronous image loads cannot replace a newer user selection.
- Preserve the default `day` basemap and the `day`, `dark`, and `satellite` basemap option values.
- Keep fallback canvas recoloring off the visible layer and return the processed offscreen canvas directly to the WebGL renderer so the visible frame is never cleared while recoloring occurs.
- Use integer Leaflet zoom levels (`zoomSnap: 1`) for raster basemaps. Fractional zoom scaling exposed visible tile seams.
- Keep basemap tiles at their native size and use only a transparent outline seam guard; do not enlarge tiles, which made grid lines more visible.
- Preserve Leaflet's 250 ms zoom-transform transition on the pollution canvas. Pollution opacity remains constant at the DOM layer; temporal interpolation belongs inside the WebGL shader.
- Apply `will-change: transform` to the pollution canvas so the browser can keep zoom transforms on the compositor.

When editing files in this workspace, use `apply_patch` for manual changes and preserve unrelated user work.

## Version control handoff

- After every completed project modification, commit the relevant changes and push the commit to the configured GitHub remote before handing the work back to the user.
- Preserve unrelated user work and include only the files relevant to the requested change in the commit.
- If a commit or push cannot be completed, report the exact blocker instead of implying that the remote repository is up to date.

## Verification checklist

Before handing off a material change:

1. Check the embedded JavaScript for syntax errors.
2. Load the standalone HTML through a local HTTP server rather than relying only on a `file:` URL.
3. Confirm all four particle/extent combinations reach the loaded state.
4. Visually inspect wildfire smoke + entire atmosphere for yellow projection wedges, rectangles, or other model-domain artifacts.
5. Scrub both sides of the centered Now position, use previous/next, Reset, and play several frames.
6. Confirm the previous frame remains visible while the next frame loads and that there is no vacant flash.
7. Confirm the horizontal legend title, scale, and units update correctly.
8. Confirm the timeline is always visible, centers “Now,” and has correct Play/Pause and Reset states and accessible labels.
9. Check desktop and phone layouts for clipping and horizontal overflow.
10. Check the browser console and data status for relevant errors.
11. Switch among Day, Dark, and Satellite and verify both appearance and attribution.
12. Confirm light concentrations remain transparent, wildfire smoke uses the monochromatic orange/brown ramp, and total PM2.5 uses the distinct monochromatic yellow-brown ramp without hiding the basemap completely.
13. Inspect the daytime basemap for tile-grid seams at the initial zoom and after zooming.
14. Click a plume pixel and verify the popup shows pollutant type, vertical extent, and inferred concentration on three lines with the active layer's unit, without an approximation symbol or time. Then click a transparent or no-data pixel and verify that no popup remains.
15. During playback, confirm there is exactly one pollution canvas and no pollution `<img>` overlays. Inspect several transition midpoints for brightness pulses or vacant flashes.
16. Drag the slider slowly forward and backward, then rapidly across random positions. The thumb and preview plume must track continuously during pointer movement, visible hour labels and release positions must remain integer hours, and release must refine to the full-resolution integer frame without a temporal jump.
17. Zoom in and out repeatedly over a distinct plume edge; confirm the basemap and pollution canvas scale and settle together without visible lag.
18. Confirm the initial view focuses on the United States and Canada at desktop and phone sizes, and that the location control displays a blue current-location marker and zooms to it after permission is granted.
19. Confirm playback loops from the final forecast frame to Now and continues, and switch pollutant or vertical extent during playback to verify the current hour is preserved and animation resumes without a blank map.
20. Validate a generated cache manifest, display PNG set, and preview-atlas set; confirm the page loads matching same-origin assets and falls back to GeoMet when a full frame is absent.

## Known tradeoffs

- A single 1000 × 625 WMS image per frame avoids tile artifacts, stays close to the approximate 10 km model resolution, and lowers client processing cost, but it will become pixelated at unusually deep zoom levels.
- Loading full-frame PNGs can use more bandwidth per time step than a small set of visible tiles. The processed-frame LRU, WebGL's two textures, and selected-dataset-only preview atlases bound normal client memory.
- Direct-GeoMet fallback recoloring adds CPU work before a frame becomes ready. It belongs on an offscreen source canvas so it cannot clear the persistent visible WebGL canvas.
- The Pages cache is refreshed on a schedule rather than continuously. Runtime GeoMet fallback is required for gaps between publication and the next successful deployment.
- The fixed image bounds intentionally focus the product on North America. Expanding coverage requires recalculating the matching Web Mercator WMS bounding box and validating the image overlay alignment.

## Primary artifacts

- `index.html`: the only standalone interactive map and the only application file to update for interface or runtime behavior.
- `scripts/build_static_cache.py`: the bounded static-frame cache generator.
- `cache/manifest.json`: an empty development fallback; production deployment replaces it with the generated manifest.
- `.github/workflows/deploy-pages-with-smoke-cache.yml`: repository-root Pages build and scheduled cache deployment workflow.

If an inline Codex visualization is also generated, keep it as an HTML fragment without document-level `doctype`, `html`, `head`, or `body` tags, while keeping the standalone file functionally equivalent.
