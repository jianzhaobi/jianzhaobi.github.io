# Active North America Smoke Map

## Purpose and ownership

This directory is the editable and published source of the North America Smoke & PM2.5 Map. It belongs in the public Pages repository. Keep one active source here; do not maintain a second copy in the private repository. The long historical project record is `PROJECT_HISTORY.md`; consult it for the reasons behind past choices, and verify details against current code and sources before reusing them.

The map lets readers explore modeled wildfire-smoke and total PM2.5 at the surface or across the full atmospheric column. It overlays U.S. WFIGS incidents, Canadian CWFIS agency-reported fires with CIFFC Priority matching, and optional NOAA HMS observed-smoke polygons. Model analysis, forecast, observed plume extent, incident locations, and structure/impact context are different kinds of evidence; label each accurately.

## Structure and data flow

- `index.html` contains the standalone application markup, styles, and browser logic. `site.webmanifest` and `icons/` supply browser metadata.
- `scripts/` contains the cache builders, timeline helper, R2 publisher, and static contract tests. These scripts run in GitHub Actions, not in the visitor's browser.
- `cache/` contains checked-in fallback manifests. The Pages workflow refreshes smoke/PM2.5 frames, WFIGS and Canadian fire data, and HMS polygons. It publishes validated cache assets and may place immutable field atlases in R2 when the service is configured. Check the workflow and current manifest before assuming which storage path is active.
- The public Pages workflow is the only production scheduler and deployer for this page. Its artifact allowlist includes runtime HTML, icons, manifest, and cache data; documentation and Python source are kept in Git but are not served as Pages assets.

## Updating and recovery

Run `python3 na_smoke_map/scripts/test_static_contracts.py` from the public repository root for page and cache-contract checks. The workflow is the source of truth for builder order, dependencies, and publishing flags; inspect each script's current interface before running it manually. A push or scheduled run builds fresh caches, then uploads and deploys one Pages artifact. Do not hand-edit generated assets inside an Actions artifact or commit a live cache snapshot as a substitute for fixing a failed builder.

The checked-in cache manifests are intentionally empty fallbacks. For data freshness, inspect the deployed manifest timestamps, source-status labels in the page, and the latest successful workflow run. GitHub's scheduled runs can be delayed or skipped even with an hourly cron; use the workflow's manual dispatch when the published cache is stale, and consider a separate scheduler if a strict freshness guarantee becomes necessary. If a build or upstream source fails, investigate the workflow log and keep the prior successful deployment available while repairing the source or builder. If R2 is configured, verify the manifest's asset URLs, browser image/CORS access, and R2 publication step as well as the Pages artifact; do not assume the fallback storage mode is active.

## Enduring rules

- Preserve the distinction between surface concentration (µg/m³) and entire-atmosphere column loading (mg/m²). NOAA HMS polygons show observed plume extent and qualitative density, not modeled PM2.5 concentration or a forecast.
- Use the controlling official source and retain its incident identity. WFIGS Current and Year-to-Date overlap; Canadian CWFIS locations and CIFFC Priority rows require careful matching. Disclose unmatched or stale data rather than inventing incidents or presenting old observations as current.
- Keep successful caches content-addressed and validated before replacing visible data. A failed refresh should retain a complete previous snapshot with its actual source/observation time visible. Preserve request cancellation and generation guards so slower results cannot overwrite newer user choices.
- Keep source access and cache generation out of the browser where the current design expects same-origin cache files. Preserve attribution, external-resource integrity metadata, accessible controls, and responsive desktop/mobile behavior.
- Treat the historical notes in `PROJECT_HISTORY.md` and `wildfire_data_sources.md` as context. Update this guide when ownership, scientific meaning, core behavior, or deployment changes; retain implementation-specific details near the code and tests.

## Verification before publication

Run the static contract tests and any tests for changed builders. Inspect the Pages artifact file list. Review the map in a real browser at desktop and mobile sizes, including the four particle/extent choices, time controls, U.S./Canada fires, optional HMS layer, basemap selection, source-age labels, failed-cache behavior, and keyboard/accessibility flow. After deployment, confirm the live page and manifests load while MBTA remains available.
