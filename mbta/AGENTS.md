# Public MBTA Tracker assets

This directory owns the public MBTA page shell, styles, privacy notice, manifest, and icon. Edit those files here. The browser script `app.js` is generated from editable source in the private Jianzhao site repository; its release workflow updates that script. Never treat the minified public script as the editable source. The Cloudflare Worker owns API proxying, travel requests, visit recording, and private credentials.

The page is a responsive Leaflet tracker for MBTA routes, stops, vehicles, predictions, alerts, and travel-time context. Preserve the existing `/mbta/` URL, relative asset paths, privacy link, accessible controls, mobile layout, and Worker requests when changing public markup or styles. Browser-delivered files and the domain-restricted basemap key are inspectable; other provider credentials belong only in Worker secrets.

`index.html` uses one `window.__APP_VERSION__` value for both CSS and JavaScript cache-busting. Bump it when publishing changes to public static assets. The private JavaScript release workflow updates it when a new generated script differs from the current public script. Check that both URLs resolve to the intended versions after deployment.

The public Pages workflow deploys only runtime files. Documentation in this directory is kept in Git and excluded from the Pages artifact. Test desktop and mobile presentation, route selection, map rendering, live vehicles, stop details, privacy navigation, and the Worker health/route behavior after changes. Coordinate private JavaScript and Worker changes with their own source repository and release checks.
