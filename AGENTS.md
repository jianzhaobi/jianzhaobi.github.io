# Published Jianzhao site: agent guide

This public repository owns the GitHub Pages publication for the active MBTA Tracker at `/mbta/` and North America Smoke Map at `/na_smoke_map/`. Its Pages workflow deploys an explicit list of runtime files, so adding a tracked file alone does not make it available on the site. Read `README.md` and the project-specific `AGENTS.md` before changing either page.

## Ownership

- `na_smoke_map/` contains the editable page, icons, cache builders, tests, and empty fallback manifests. Its workflow is scheduled hourly and also runs on pushes; actual GitHub schedule times may vary. `na_smoke_map/AGENTS.md` explains source meaning, data flow, and checks; `PROJECT_HISTORY.md` is historical context.
- `mbta/` owns public HTML, CSS, privacy text, manifest, and icon. Its `app.js` is generated from editable source in the separate private `jianzhaobi/jianzhaobi-site-source` repository. Never edit the generated script by hand or bring its private Worker, source JavaScript, secrets, or archives into this repository. `mbta/AGENTS.md` explains the public assets and cache version.
- Repository documentation and Smoke Map Python builders remain in Git for maintenance but are excluded from the Pages artifact. Preserve `.nojekyll` and review the workflow allowlist before changing publication rules or adding a route.

## Change and release checks

Check the remote, branch, and working tree before editing or pushing. Run the relevant project checks, inspect the staged public diff and expected Pages artifact file list, then confirm the GitHub Actions deployment and live page. For Smoke Map, check cache-manifest times and source-status labels; for MBTA, check browser asset versions, route loading, privacy navigation, and Worker health. Keep active URLs and responsive/accessibility behavior intact. A change to the private MBTA source reaches this repository through its release workflow; public static-asset changes are made here.
