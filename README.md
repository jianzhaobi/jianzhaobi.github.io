# Published Jianzhao site

This public repository is the GitHub Pages source for the active MBTA Tracker (`/mbta/`) and North America Smoke Map (`/na_smoke_map/`). The Pages workflow builds smoke-map caches hourly and deploys a scoped list of browser runtime files. Project documentation and cache-builder source remain visible in this Git repository but are not copied into the Pages artifact.

The Smoke Map's editable page, cache builders, and tests live here. The MBTA page shell, styles, privacy page, manifest, and icon also live here. `mbta/app.js` is generated from editable JavaScript in the separate private source repository; its release workflow updates the generated script and the page's shared cache version when the script changes. The MBTA Worker and credentials remain outside this repository.

Read the project `AGENTS.md` files before editing either site. Review the public file list and Pages workflow after changing publication rules.
