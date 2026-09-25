# Published Jianzhao site

This public repository is the GitHub Pages source for the active MBTA Tracker (`/mbta/`) and North America Smoke Map (`/na_smoke_map/`). The Pages workflow builds smoke-map caches hourly and deploys a scoped list of browser runtime files. Project documentation and cache-builder source remain visible in this Git repository but are not copied into the Pages artifact.

The Smoke Map's editable page, cache builders, and tests live here. The MBTA page shell, styles, privacy page, manifest, and icon also live here. `mbta/app.js` is generated from editable JavaScript in the separate private source repository; its release workflow updates the generated script and the page's shared cache version when the script changes. The MBTA Worker and credentials remain outside this repository.

## Build and maintenance

- For Smoke Map changes, start with `na_smoke_map/AGENTS.md`. Edit the page, cache builders, or tests here. Run `python3 na_smoke_map/scripts/test_static_contracts.py` before publishing. The Pages workflow installs builder dependencies, aims to refresh data caches hourly and on pushes, then deploys the site; inspect its logs and the published manifest timestamps for actual freshness. GitHub scheduled runs can be delayed or skipped. Checked-in cache manifests are empty fallbacks, not current observations.
- For MBTA markup, styles, metadata, or privacy changes, start with `mbta/AGENTS.md`. These files are published directly from this repository. Bump the single cache version in `mbta/index.html` when changing CSS; the private JavaScript release workflow updates it when the generated script changes. Check browser caching separately for icons or manifest changes. Edit MBTA JavaScript and the Worker in the private source repository; do not hand-edit generated `mbta/app.js` here.
- The Pages workflow uses an explicit runtime-file allowlist. When adding a page or asset, update that allowlist and inspect the deployed artifact. Repository docs and builder scripts remain in Git for maintenance but are not served by Pages. The site root is not a separate active homepage.

After changes, check the relevant GitHub Actions run, the live route at desktop and mobile widths, referenced assets, and any Worker or cache endpoint the page needs. Check GitHub Pages settings when changing the publication source or domain.
