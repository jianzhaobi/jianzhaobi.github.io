/* ====================== */
/* ==== CONFIGURATION === */
/* ====================== */

const MBTA_API_BASE = "https://api-v3.mbta.com";
const MBTA_API_KEY = "5fb2a20d05094524a0b35961a20cf9e4"; // Set to "" to use keyless MBTA requests.
const MAPBOX_ACCESS_TOKEN = [
    "pk.eyJ1IjoiaGl0b3JpMzgiLCJhIjoi",
    "Y21wMDdhaXQ3MHplbTJxcGtrYzZpNWZzdyJ9",
    ".3RBUyxTUMkYK79oxYKSD4A"
].join("");
const VEHICLE_REFRESH_MS = 5000;
const VEHICLE_HALO_BREATHE_MS = 1650;
const VEHICLE_MOVE_MAX_JUMP_METERS = 1200;
const VEHICLE_MOVE_DURATION_MS = Math.min(VEHICLE_REFRESH_MS * 0.85, 4200);

const DEFAULT_VIEW = {
    center: [42.3601, -71.0889],
    zoom: 12
};

const ROUTE_PRIORITY = [
    "Blue",
    "Green-B",
    "Green-C",
    "Green-D",
    "Green-E",
    "Orange",
    "Red",
    "Mattapan"
];

const ROUTE_TYPE_ORDER = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    4: 4
};

const ROUTE_BADGE_OVERRIDES = {
    "CR-Fairmount": "Fair",
    "CR-NewBedford": "NBedfd",
    "CR-Fitchburg": "Fitch",
    "CR-Worcester": "Worc",
    "CR-Franklin": "Frank",
    "CR-Greenbush": "Grnbsh",
    "CR-Haverhill": "Havrhl",
    "CR-Kingston": "King",
    "CR-Lowell": "Lowell",
    "CR-Needham": "Need",
    "CR-Newburyport": "Nwbury",
    "CR-Providence": "Prov",
    "CR-Foxboro": "Foxbr",
    "Boat-EastBoston": "EBos"
};

const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const ESRI_ATTRIBUTION = "Tiles &copy; Esri - Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const DEFAULT_BASEMAP = "light";
const VEHICLE_OFFSET_PX = 24;
const VEHICLE_OFFSET_MIN_PX = 18;
const VEHICLE_OFFSET_MAX_PX = 48;
const VEHICLE_OFFSET_REFERENCE_ZOOM = 14;
const VEHICLE_OFFSET_ZOOM_SCALE = 4;
const VEHICLE_ICON_SIZE = 116;
const VEHICLE_MARKER_RADIUS_PX = 12;
const VEHICLE_COLLISION_PADDING_PX = 6;
const VEHICLE_COLLISION_ITERATIONS = 9;
const VEHICLE_COLLISION_ROTATION_STEP_DEG = 9;
const VEHICLE_MAX_COLLISION_ROTATION_DEG = 120;
const VEHICLE_CROSS_DIRECTION_PUSH_PX = 8;
const VEHICLE_CROSS_DIRECTION_MAX_PUSH_PX = 24;
const VEHICLE_TANGENT_SMOOTH_PX = 60;
const VEHICLE_LAYOUT_DEBOUNCE_MS = 80;
const STOP_AVOID_RADIUS_PX = 13;

const BASEMAPS = {
    light: {
        url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        attribution: CARTO_ATTRIBUTION
    },
    dark: {
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attribution: CARTO_ATTRIBUTION
    },
    detail: {
        url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        attribution: CARTO_ATTRIBUTION
    },
    satellite: {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attribution: ESRI_ATTRIBUTION
    }
};

/* ====================== */
/* ======= STATE ======== */
/* ====================== */

const routePanel = document.querySelector(".route-panel");
const routeFilter = document.getElementById("routeFilter");
const routePicker = document.getElementById("routePicker");
const routePickerButton = document.getElementById("routePickerButton");
const routePickerSelected = document.getElementById("routePickerSelected");
const routePickerMenu = document.getElementById("routePickerMenu");
const routeSearch = document.getElementById("routeSearch");
const routeOptions = document.getElementById("routeOptions");
const routeEmpty = document.getElementById("routeEmpty");
const basemapPicker = document.getElementById("basemapPicker");
const basemapToggle = document.getElementById("basemapToggle");
const basemapOptions = document.getElementById("basemapOptions");
const basemapOptionButtons = [...document.querySelectorAll(".basemap-option")];
const fetchTime = document.getElementById("fetchTime");
const directionLegend = document.getElementById("directionLegend");
const locateUserButton = document.getElementById("locateUser");
const resetRouteViewButton = document.getElementById("resetRouteView");
const alertBox = document.getElementById("routeAlert");
const toggleAlertButton = document.getElementById("toggleAlert");
const panelToggleButton = document.getElementById("panelToggle");
const alertIndicator = document.getElementById("alertIndicator");
const panelDetails = document.getElementById("panelDetails");

const state = {
    routes: new Map(),
    selectedRouteId: null,
    routeRequestId: 0,
    vehicleRequestId: 0,
    vehicleTimer: null,
    hasFitRoute: false,
    userLocation: null,
    userMarker: null,
    userWatchId: null,
    followUserLocation: false,
    isProgrammaticMapMove: false,
    stops: new Map(),
    panelExpanded: false,
    routePickerExpanded: false,
    routeSearchQuery: "",
    activeRouteId: null,
    currentBasemap: DEFAULT_BASEMAP,
    // Keyed by vehicle.id so refreshVehicles can diff-update existing markers
    // (preserve open popups, avoid DOM churn) instead of clearing the whole layer.
    vehicleRecords: new Map(),
    // Cached rendered route segments let vehicle circles align to the road geometry, not just MBTA bearing.
    routeShapeSegments: [],
    // Segments grouped by shapeId for polyline traversal (used by smoothedTangent).
    routeShapeIndex: new Map(),
    vehicleLayoutTimer: null,
    // Aborts in-flight route-load fetches (shapes/stops/alerts/initial vehicles)
    // when the user switches to a different route. Polling refresh does not use this.
    routeAbortController: null
};

/* ====================== */
/* ======= MAP ========== */
/* ====================== */

const map = L.map("map", {
    zoomControl: false,
    doubleClickZoom: false
}).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

L.control.zoom({ position: "topright" }).addTo(map);

/* Move custom buttons into the Leaflet top-right control container so all
   controls share the same positioning context (fixes overlap on iPad landscape). */
const topRightContainer = map.getContainer().querySelector(".leaflet-top.leaflet-right");
if (topRightContainer) {
    topRightContainer.appendChild(locateUserButton);
    topRightContainer.appendChild(resetRouteViewButton);
    /* Prevent Leaflet's Draggable from calling preventDefault() on mousedown for
       this <button> element — without this, Leaflet swallows the mousedown and
       the click event never fires (Leaflet only exempts <a> and <input> tags). */
    [locateUserButton, resetRouteViewButton].forEach(button => {
        button.addEventListener("mousedown", e => e.stopPropagation());
    });
}

let basemapLayer = createBasemapLayer(DEFAULT_BASEMAP).addTo(map);

const routeLayer = L.featureGroup().addTo(map);
const stopLayer = L.layerGroup().addTo(map);
const vehicleLayer = L.layerGroup().addTo(map);
const userLayer = L.layerGroup().addTo(map);
const vehicleHaloClockStartMs = performance.now();

map.on("zoomstart movestart", cancelVehicleMoveAnimations);
map.on("zoomend moveend", scheduleVehicleLayout);

/* ====================== */
/* ===== UTILITIES ====== */
/* ====================== */

function createBasemapLayer(basemapId) {
    const basemap = BASEMAPS[basemapId] || BASEMAPS[DEFAULT_BASEMAP];
    return L.tileLayer(basemap.url, {
        maxZoom: 19,
        attribution: basemap.attribution
    });
}

function setBasemap(basemapId) {
    if (!BASEMAPS[basemapId]) return;

    if (basemapLayer) {
        map.removeLayer(basemapLayer);
    }
    basemapLayer = createBasemapLayer(basemapId).addTo(map);
    basemapLayer.bringToBack();
    state.currentBasemap = basemapId;
    updateBasemapPicker();
}

function setBasemapPickerExpanded(isExpanded) {
    basemapOptions.hidden = !isExpanded;
    basemapPicker.classList.toggle("is-expanded", isExpanded);
    basemapToggle.setAttribute("aria-expanded", String(isExpanded));
}

function updateBasemapPicker() {
    basemapToggle.dataset.basemap = state.currentBasemap;
    basemapOptionButtons.forEach(button => {
        const isSelected = button.dataset.basemap === state.currentBasemap;
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
    });
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function normalizeHexColor(value, fallback) {
    const clean = String(value || "").replace("#", "").trim();
    return /^[0-9a-fA-F]{6}$/.test(clean) ? `#${clean}` : fallback;
}

function routeColor(route) {
    return normalizeHexColor(route?.color, "#165c96");
}

function routeTextColor(route) {
    return normalizeHexColor(route?.textColor, "#ffffff");
}

function hexToRgb(hex) {
    const clean = normalizeHexColor(hex, "#165c96").slice(1);
    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16)
    };
}

function rgbToHex({ r, g, b }) {
    return `#${[r, g, b].map(value =>
        Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")
    ).join("")}`;
}

function mixColor(hex, targetHex, amount) {
    const source = hexToRgb(hex);
    const target = hexToRgb(targetHex);
    return rgbToHex({
        r: source.r + (target.r - source.r) * amount,
        g: source.g + (target.g - source.g) * amount,
        b: source.b + (target.b - source.b) * amount
    });
}

function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return [r, g, b].map(value => {
        const channel = value / 255;
        return channel <= 0.03928
            ? channel / 12.92
            : Math.pow((channel + 0.055) / 1.055, 2.4);
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function isSilverLineRoute(route) {
    const id = String(route?.id || "").toLowerCase();
    const shortName = String(route?.shortName || "").toLowerCase();
    const longName = String(route?.longName || "").toLowerCase();
    return longName.includes("silver")
        || /^sl\d/.test(id)
        || /^sl\d/.test(shortName)
        || normalizeHexColor(route?.color, "").toLowerCase() === "#7c878e";
}

function directionColor(route, directionId) {
    const base = routeColor(route);
    if (isSilverLineRoute(route)) {
        if (directionId === 0) return "#8c989f";
        if (directionId === 1) return "#4b5660";
    }

    if (directionId === 0) {
        return relativeLuminance(base) > 0.58 ? mixColor(base, "#000000", 0.22) : base;
    }
    if (directionId === 1) {
        return relativeLuminance(base) > 0.58
            ? mixColor(base, "#000000", 0.58)
            : mixColor(base, "#ffffff", 0.42);
    }
    return "#6b7280";
}

function vehicleDirectionColor(route, directionId) {
    return directionColor(route, directionId);
}

function setRouteTheme(route) {
    document.documentElement.style.setProperty("--route-color", routeColor(route));
    document.documentElement.style.setProperty("--route-text-color", routeTextColor(route));
    document.documentElement.style.setProperty("--direction-0-color", vehicleDirectionColor(route, 0));
    document.documentElement.style.setProperty("--direction-1-color", vehicleDirectionColor(route, 1));
}

function updateStateForMessage(message) {
    if (/fetch error|unable/i.test(message)) return "error";
    if (/loading/i.test(message)) return "loading";
    return "ok";
}

function updateLabelForMessage(message) {
    if (/fetch error|unable/i.test(message)) return "Update failed";
    if (message.startsWith("Last updated: ")) {
        return `Updated ${message.replace("Last updated: ", "")}`;
    }
    return message;
}

function setUpdated(message) {
    const stateName = updateStateForMessage(message);
    const label = updateLabelForMessage(message);

    fetchTime.dataset.state = stateName;
    fetchTime.title = message;
    fetchTime.setAttribute("aria-label", label);
    fetchTime.innerHTML = `
        <span class="fetch-status-dot" aria-hidden="true"></span>
        <span class="fetch-status-text">${escapeHtml(label)}</span>
    `;
}

function formatTimestamp(date = new Date()) {
    return date.toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
    });
}

function formatTime(value) {
    const date = parseMbtaDate(value);
    if (!date) return "Unknown";
    return date.toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit"
    });
}

function parseMbtaDate(value) {
    if (!value) return null;

    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function buildMbtaUrl(path, params = {}) {
    const url = new URL(path, MBTA_API_BASE);

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, value);
        }
    });

    return url;
}

async function fetchMbta(path, params = {}, signal) {
    const options = {};
    if (MBTA_API_KEY) options.headers = { "x-api-key": MBTA_API_KEY };
    if (signal) options.signal = signal;

    const url = buildMbtaUrl(path, params);
    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response.json();

            // 4xx (other than 429) is a client error — don't bother retrying.
            if (response.status !== 429 && response.status < 500) {
                throw new Error(`MBTA request failed: ${response.status} ${response.statusText}`);
            }
            lastError = new Error(`MBTA request failed: ${response.status} ${response.statusText}`);
        } catch (error) {
            // Don't retry user-initiated aborts.
            if (error.name === "AbortError") throw error;
            lastError = error;
        }

        if (attempt < maxAttempts - 1) {
            // Exponential backoff with ±25% jitter: ~400ms, ~800ms before the final attempt.
            const baseMs = 400 * Math.pow(2, attempt);
            const jitterMs = baseMs * (0.75 + Math.random() * 0.5);
            await new Promise(resolve => setTimeout(resolve, jitterMs));
        }
    }

    throw lastError || new Error("MBTA request failed after retries");
}

function buildMapboxDirectionsUrl(profile, origin, destination) {
    const coordinates = `${origin[1]},${origin[0]};${destination.lng},${destination.lat}`;
    const url = new URL(`https://api.mapbox.com/directions/v5/${profile}/${coordinates}`);

    url.searchParams.set("overview", "false");
    url.searchParams.set("alternatives", "false");
    url.searchParams.set("steps", "false");
    url.searchParams.set("access_token", MAPBOX_ACCESS_TOKEN);

    return url;
}

async function fetchMapboxDuration(profile, origin, destination) {
    const response = await fetch(buildMapboxDirectionsUrl(profile, origin, destination));
    if (!response.ok) {
        throw new Error(`Mapbox request failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const durationSeconds = json.routes?.[0]?.duration;
    if (!Number.isFinite(durationSeconds)) {
        throw new Error("Mapbox response did not include a duration.");
    }

    return Math.max(1, Math.round(durationSeconds / 60));
}

async function fetchTravelTimeSummary(stop) {
    if (!state.userLocation) return "Unavailable";
    if (!MAPBOX_ACCESS_TOKEN) return "Unavailable";

    const [walkResult, driveResult] = await Promise.allSettled([
        fetchMapboxDuration("mapbox/walking", state.userLocation, stop),
        fetchMapboxDuration("mapbox/driving-traffic", state.userLocation, stop)
    ]);

    const walk = walkResult.status === "fulfilled" ? `${walkResult.value} min` : "unavailable";
    const drive = driveResult.status === "fulfilled" ? `${driveResult.value} min` : "unavailable";

    if (walk === "unavailable" && drive === "unavailable") {
        return "Unavailable";
    }

    return `Walk ${walk} · Drive ${drive}`;
}

function displayRouteName(route) {
    if (!route) return "Unknown route";
    if (route.shortName && route.longName && route.shortName !== route.longName) {
        return `${route.shortName} - ${route.longName}`;
    }
    return route.longName || route.shortName || route.id;
}

function routeTitle(route) {
    return route?.longName || route?.shortName || route?.id || "Unknown route";
}

function routeMeta(route) {
    if (!route) return "";
    const type = routeGroupLabel(route);
    const shortName = route.shortName && route.shortName !== routeTitle(route) ? route.shortName : "";
    return [shortName, type].filter(Boolean).join(" · ");
}

function routeBadgeLabel(route) {
    return route?.badgeLabel || firstRouteBadgeCandidate(route) || "?";
}

function cleanBadgeLabel(value) {
    return String(value || "").replace(/[^a-z0-9]/gi, "").slice(0, 6);
}

function splitRouteToken(value) {
    return String(value || "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(/[^a-z0-9]+/i)
        .filter(Boolean);
}

function compressedBadgeLabel(value) {
    const clean = cleanBadgeLabel(value);
    if (clean.length <= 6) return clean;

    const compressed = clean[0] + clean.slice(1).replace(/[aeiou]/gi, "");
    return cleanBadgeLabel(compressed || clean);
}

function compactRouteId(route) {
    if (!route) return "";
    return String(route.id || "")
        .replace(/^Green-/, "")
        .replace(/^CR-/, "")
        .replace(/^Boat-/, "");
}

function firstRouteBadgeCandidate(route) {
    return routeBadgeCandidates(route)[0] || cleanBadgeLabel(route?.id) || "?";
}

function routeBadgeCandidates(route) {
    if (!route) return [];

    const compactId = compactRouteId(route);
    const idParts = splitRouteToken(compactId);
    const longName = String(route.longName || "")
        .replace(/\b(Line|Ferry|Event|Service)\b/gi, "")
        .trim();
    const longParts = splitRouteToken(longName);
    const candidates = [
        ROUTE_BADGE_OVERRIDES[route.id],
        route.id?.startsWith("Boat-F") ? compactId : "",
        route.id?.startsWith("Green-") ? compactId : "",
        route.type === 2 || route.type === 4 ? compressedBadgeLabel(compactId) : "",
        route.type === 2 || route.type === 4 ? cleanBadgeLabel(compactId) : "",
        route.type === 2 || route.type === 4 ? compressedBadgeLabel(longParts[0]) : "",
        route.type === 2 || route.type === 4 ? cleanBadgeLabel(longParts[0]) : "",
        idParts.length > 1 ? cleanBadgeLabel(idParts.map(part => part[0]).join("") + idParts[idParts.length - 1]) : "",
        route.shortName,
        compactId,
        route.id
    ].map(cleanBadgeLabel).filter(Boolean);

    return [...new Set(candidates)];
}

function stableRouteHash(value, salt = 0) {
    let hash = 2166136261 ^ salt;
    String(value || "").split("").forEach(char => {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    });
    return (hash >>> 0).toString(36).toUpperCase();
}

function collisionSafeBadgeLabel(route, usedLabels) {
    const base = firstRouteBadgeCandidate(route);

    for (let suffixLength = 1; suffixLength <= 4; suffixLength += 1) {
        for (let salt = 0; salt < 64; salt += 1) {
            const suffix = stableRouteHash(route.id, salt).padStart(suffixLength, "0").slice(-suffixLength);
            const candidate = cleanBadgeLabel(`${base.slice(0, 6 - suffixLength)}${suffix}`);
            if (candidate && !usedLabels.has(candidate)) return candidate;
        }
    }

    return cleanBadgeLabel(stableRouteHash(route.id).padStart(6, "0"));
}

function assignRouteBadgeLabels(routes) {
    const labels = new Map();
    const routesByLabel = new Map();

    routes.forEach(route => {
        const label = firstRouteBadgeCandidate(route);
        labels.set(route.id, label);
        if (!routesByLabel.has(label)) routesByLabel.set(label, []);
        routesByLabel.get(label).push(route);
    });

    const usedLabels = new Set(
        [...routesByLabel.entries()]
            .filter(([, groupedRoutes]) => groupedRoutes.length === 1)
            .map(([label]) => label)
    );

    routesByLabel.forEach(groupedRoutes => {
        if (groupedRoutes.length === 1) return;

        groupedRoutes.forEach(route => {
            const label = routeBadgeCandidates(route).find(candidate => !usedLabels.has(candidate))
                || collisionSafeBadgeLabel(route, usedLabels);
            labels.set(route.id, label);
            usedLabels.add(label);
        });
    });

    routes.forEach(route => {
        route.badgeLabel = labels.get(route.id) || collisionSafeBadgeLabel(route, usedLabels);
        usedLabels.add(route.badgeLabel);
    });

    const duplicates = routes
        .map(route => route.badgeLabel)
        .filter((label, index, allLabels) => allLabels.indexOf(label) !== index);
    const tooLong = routes.filter(route => route.badgeLabel.length > 6);

    if (duplicates.length || tooLong.length) {
        console.warn("Route badge labels must be unique and no more than 6 characters.", { duplicates, tooLong });
    }
}

function routeGroupKey(route) {
    if (route?.type === 0 || route?.type === 1) return "rapid";
    if (route?.type === 2) return "commuter";
    if (route?.type === 3) return "bus";
    if (route?.type === 4) return "ferry";
    return "other";
}

function routeGroupLabel(routeOrKey) {
    const key = typeof routeOrKey === "string" ? routeOrKey : routeGroupKey(routeOrKey);
    return {
        rapid: "Subway & Light Rail",
        commuter: "Commuter Rail",
        bus: "Bus",
        ferry: "Ferry",
        other: "Other"
    }[key] || "Other";
}

function routeSearchText(route) {
    return [
        route.id,
        route.shortName,
        route.longName,
        displayRouteName(route),
        routeGroupLabel(route)
    ].filter(Boolean).join(" ").toLowerCase();
}

function routeStyleVars(route, colorVar = "--badge-bg") {
    return `${colorVar}: ${routeColor(route)}; --badge-bg: ${routeColor(route)}; --badge-fg: ${routeTextColor(route)};`;
}

function routeButtonHtml(route) {
    return `
        <span class="route-badge" style="${routeStyleVars(route)}" aria-hidden="true">${escapeHtml(routeBadgeLabel(route))}</span>
        <span class="route-picker-text">
            <span class="route-picker-name">${escapeHtml(routeTitle(route))}</span>
            <span class="route-picker-meta">${escapeHtml(routeMeta(route))}</span>
        </span>
    `;
}

function renderRoutePickerSelection(route) {
    if (!route) {
        routePickerSelected.innerHTML = `
            <span class="route-badge route-badge-placeholder" aria-hidden="true"></span>
            <span class="route-picker-text">Loading routes...</span>
        `;
        return;
    }

    routePickerSelected.innerHTML = routeButtonHtml(route);
}

function renderRoutePickerOptions() {
    const query = state.routeSearchQuery.trim().toLowerCase();
    const routes = [...state.routes.values()].filter(route =>
        !query || routeSearchText(route).includes(query)
    );
    const groups = new Map();

    routes.forEach(route => {
        const key = routeGroupKey(route);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(route);
    });

    const groupOrder = ["rapid", "commuter", "bus", "ferry", "other"];
    routeOptions.innerHTML = groupOrder
        .filter(key => groups.has(key))
        .map(key => `
            <div class="route-group">
                <div class="route-group-label">${escapeHtml(routeGroupLabel(key))}</div>
                ${groups.get(key).map(route => routeOptionHtml(route)).join("")}
            </div>
        `).join("");

    routeEmpty.hidden = routes.length > 0;
    routeOptions.hidden = routes.length === 0;
    updateActiveRouteOption();
}

function routeOptionHtml(route) {
    const selected = route.id === state.selectedRouteId;
    const active = route.id === state.activeRouteId;
    return `
        <button id="route-option-${escapeHtml(route.id)}" class="route-option${selected ? " is-selected" : ""}${active ? " is-active" : ""}" type="button" role="option" aria-selected="${selected}" data-route-id="${escapeHtml(route.id)}" style="${routeStyleVars(route, "--option-color")}">
            <span class="route-option-content">
                <span class="route-badge" aria-hidden="true">${escapeHtml(routeBadgeLabel(route))}</span>
                <span class="route-option-text">
                    <span class="route-option-name">${escapeHtml(routeTitle(route))}</span>
                    <span class="route-option-meta">${escapeHtml(routeMeta(route))}</span>
                </span>
            </span>
            <span class="route-option-check${selected ? " is-visible" : ""}" aria-hidden="true"></span>
        </button>
    `;
}

function setRoutePickerExpanded(expanded) {
    if (expanded && !state.routes.size) return;

    state.routePickerExpanded = expanded;
    routePickerMenu.hidden = !expanded;
    routePanel.classList.toggle("is-route-picker-open", expanded);
    routePickerButton.setAttribute("aria-expanded", String(expanded));

    if (expanded) {
        state.activeRouteId = state.selectedRouteId;
        renderRoutePickerOptions();
        window.setTimeout(() => {
            routeSearch.focus({ preventScroll: true });
            scrollActiveRouteOptionIntoView();
        }, 0);
    } else {
        state.routeSearchQuery = "";
        routeSearch.value = "";
        state.activeRouteId = null;
        routePickerButton.removeAttribute("aria-activedescendant");
    }
}

function visibleRouteIds() {
    return [...routeOptions.querySelectorAll(".route-option")].map(button => button.dataset.routeId);
}

function moveActiveRoute(delta) {
    const routeIds = visibleRouteIds();
    if (!routeIds.length) return;

    const currentIndex = routeIds.indexOf(state.activeRouteId);
    const nextIndex = currentIndex === -1
        ? (delta > 0 ? 0 : routeIds.length - 1)
        : (currentIndex + delta + routeIds.length) % routeIds.length;

    state.activeRouteId = routeIds[nextIndex];
    updateActiveRouteOption();
    scrollActiveRouteOptionIntoView();
}

function updateActiveRouteOption() {
    let activeOptionId = null;

    routeOptions.querySelectorAll(".route-option").forEach(button => {
        const isActive = button.dataset.routeId === state.activeRouteId;
        button.classList.toggle("is-active", isActive);
        if (isActive) {
            activeOptionId = button.id;
        }
    });

    if (activeOptionId) {
        routePickerButton.setAttribute("aria-activedescendant", activeOptionId);
    } else {
        routePickerButton.removeAttribute("aria-activedescendant");
    }
}

function scrollActiveRouteOptionIntoView() {
    const activeButton = routeOptions.querySelector(".route-option.is-active");
    if (!activeButton) return;

    const optionTop = activeButton.offsetTop;
    const optionBottom = optionTop + activeButton.offsetHeight;
    const viewportTop = routeOptions.scrollTop;
    const viewportBottom = viewportTop + routeOptions.clientHeight;

    if (optionTop < viewportTop) {
        routeOptions.scrollTop = optionTop;
    } else if (optionBottom > viewportBottom) {
        routeOptions.scrollTop = optionBottom - routeOptions.clientHeight;
    }
}

function chooseActiveRoute() {
    const routeId = state.activeRouteId;
    if (!routeId) return;

    routeFilter.value = routeId;
    setRoutePickerExpanded(false);
    selectRoute(routeId, { updateUrl: true, fitRoute: true });
}

function directionSortValue(directionId) {
    return Number.isFinite(directionId) ? directionId : Number.MAX_SAFE_INTEGER;
}

function directionLabel(route, directionId) {
    const directionName = route?.directionNames?.[directionId];
    const destination = route?.directionDestinations?.[directionId];

    if (directionName && destination) {
        return `${directionName} to ${destination}`;
    }
    if (destination) return `To ${destination}`;
    if (directionName) return directionName;
    return `Direction ${directionId}`;
}

function renderDirectionLegend(route, vehicleCounts = {}) {
    const directionIds = [0, 1].filter(directionId =>
        route?.directionNames?.[directionId] || route?.directionDestinations?.[directionId]
    );
    const hasVehicleCounts = directionIds.some(directionId => Number.isFinite(vehicleCounts[directionId]));
    const vehicleTotal = directionIds.reduce((sum, directionId) =>
        sum + (Number.isFinite(vehicleCounts[directionId]) ? vehicleCounts[directionId] : 0), 0
    );

    if (!directionIds.length) {
        directionLegend.hidden = true;
        directionLegend.innerHTML = "";
        return;
    }

    const directionRows = directionIds.map(directionId => `
        <div class="direction-row">
            <span class="direction-chip direction-${directionId}" style="--direction-color: ${vehicleDirectionColor(route, directionId)}" aria-hidden="true"></span>
            <span class="direction-text">${escapeHtml(directionLabel(route, directionId))}${Number.isFinite(vehicleCounts[directionId]) ? ` · ${vehicleCounts[directionId]}` : ""}</span>
        </div>
    `);

    if (hasVehicleCounts && vehicleTotal === 0) {
        directionRows.push(`
            <div class="direction-service-state">
                No vehicles in service
            </div>
        `);
    }

    directionLegend.innerHTML = directionRows.join("");
    directionLegend.hidden = false;
}

function setPanelExpanded(expanded) {
    state.panelExpanded = expanded;
    panelDetails.hidden = !expanded;
    panelToggleButton.setAttribute("aria-expanded", String(expanded));
    panelToggleButton.textContent = expanded ? "Hide" : "Details";
}

function sortRoutes(routes) {
    const priority = new Map(ROUTE_PRIORITY.map((routeId, index) => [routeId, index]));

    return routes.sort((a, b) => {
        const aPriority = priority.has(a.id) ? priority.get(a.id) : Number.MAX_SAFE_INTEGER;
        const bPriority = priority.has(b.id) ? priority.get(b.id) : Number.MAX_SAFE_INTEGER;
        if (aPriority !== bPriority) return aPriority - bPriority;

        const aType = ROUTE_TYPE_ORDER[a.type] ?? 99;
        const bType = ROUTE_TYPE_ORDER[b.type] ?? 99;
        if (aType !== bType) return aType - bType;

        return displayRouteName(a).localeCompare(displayRouteName(b), undefined, {
            numeric: true,
            sensitivity: "base"
        });
    });
}

function updateURLWithRoute(routeId) {
    const currentURL = new URL(window.location);
    currentURL.searchParams.set("route", routeId);
    // Use replaceState so flipping between routes does not flood browser history;
    // the back button should return to whatever page the user came from, not to
    // each previous route they viewed in this session.
    window.history.replaceState({}, "", currentURL);
}

function getRouteFromURL() {
    return new URLSearchParams(window.location.search).get("route");
}

function decodePolyline(encoded) {
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        let shift = 0;
        let result = 0;
        let byte;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        lat += (result & 1) ? ~(result >> 1) : (result >> 1);
        shift = 0;
        result = 0;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        lng += (result & 1) ? ~(result >> 1) : (result >> 1);
        points.push([lat * 1e-5, lng * 1e-5]);
    }

    return points;
}

function distanceMeters(aLat, aLng, bLat, bLng) {
    const earthRadiusMeters = 6371000;
    const toRadians = degrees => degrees * Math.PI / 180;
    const deltaLat = toRadians(bLat - aLat);
    const deltaLng = toRadians(bLng - aLng);
    const lat1 = toRadians(aLat);
    const lat2 = toRadians(bLat);
    const haversine = Math.sin(deltaLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function nearestRenderedStop(lat, lng, maxMeters) {
    let nearest = null;
    state.stops.forEach(stop => {
        const distance = distanceMeters(lat, lng, stop.lat, stop.lng);
        if (distance <= maxMeters && (!nearest || distance < nearest.distance)) {
            nearest = { stop, distance };
        }
    });
    return nearest;
}

function stopInfoFromMbtaStop(stop) {
    if (!stop) return null;

    const lat = stop.attributes?.latitude;
    const lng = stop.attributes?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
        id: stop.id,
        name: stop.attributes?.name || "Unknown Stop",
        lat,
        lng
    };
}

function vehicleStopInfo(vehicle, stopLookup = new Map()) {
    const attributes = vehicle.attributes || {};
    const status = attributes.current_status;

    if (status !== "STOPPED_AT") return null;

    const lat = attributes.latitude;
    const lng = attributes.longitude;
    const relationshipStopId = vehicle.relationships?.stop?.data?.id;
    const relatedStop = relationshipStopId
        ? state.stops.get(relationshipStopId) || stopInfoFromMbtaStop(stopLookup.get(relationshipStopId))
        : null;

    if (relatedStop) {
        return { kind: "at", stop: relatedStop };
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    const nearest = nearestRenderedStop(lat, lng, 45);
    if (!nearest) return null;

    return { kind: "at", stop: nearest.stop, distance: nearest.distance };
}

async function getRepresentativeShapeIds(routeId, signal) {
    const json = await fetchMbta("/route_patterns", {
        "filter[route]": routeId,
        include: "representative_trip"
    }, signal);

    const trips = new Map((json.included || [])
        .filter(item => item.type === "trip")
        .map(trip => [trip.id, trip]));

    const patterns = (json.data || []).filter(pattern =>
        pattern.relationships?.route?.data?.id === routeId
    );
    const typicalPatterns = patterns.filter(pattern => pattern.attributes?.typicality === 1);
    const canonicalPatterns = patterns.filter(pattern => pattern.attributes?.canonical);
    const selectedPatterns = typicalPatterns.length
        ? typicalPatterns
        : (canonicalPatterns.length ? canonicalPatterns : patterns);

    const shapeInfo = selectedPatterns
        .map(pattern => {
            const tripId = pattern.relationships?.representative_trip?.data?.id;
            return {
                id: trips.get(tripId)?.relationships?.shape?.data?.id,
                directionId: pattern.attributes?.direction_id
            };
        })
        .filter(shape => shape.id);

    return [...new Map(shapeInfo.map(shape => [shape.id, shape])).values()];
}

function canonicalShapeId(shapeId) {
    if (!shapeId) return null;
    return String(shapeId).replace(/^canonical-/, "");
}

function shapeIdMatches(segmentShapeId, vehicleShapeId) {
    if (!segmentShapeId || !vehicleShapeId) return false;
    return canonicalShapeId(segmentShapeId) === canonicalShapeId(vehicleShapeId);
}

/* ====================== */
/* ======= ICONS ======== */
/* ====================== */

function createStopIcon(route) {
    return L.divIcon({
        className: "",
        html: `<span class="stop-marker" style="border-color: ${routeColor(route)}"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -7]
    });
}

function effectiveOffsetPx() {
    const delta = VEHICLE_OFFSET_REFERENCE_ZOOM - map.getZoom();
    const raw = VEHICLE_OFFSET_PX + delta * VEHICLE_OFFSET_ZOOM_SCALE;
    return Math.max(VEHICLE_OFFSET_MIN_PX, Math.min(VEHICLE_OFFSET_MAX_PX, raw));
}

function vehicleOffsetForDirection(bearing, directionId, offsetPx) {
    const px = offsetPx || effectiveOffsetPx();
    if (directionId !== 0 && directionId !== 1) {
        return { x: 0, y: -px };
    }

    const radians = bearing * Math.PI / 180;
    return {
        x: Math.round(Math.cos(radians) * px),
        y: Math.round(Math.sin(radians) * px)
    };
}

function normalizeVector(vector) {
    const length = Math.hypot(vector.x, vector.y);
    if (!length) return null;
    return { x: vector.x / length, y: vector.y / length };
}

function rotateVector(vector, degrees) {
    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: vector.x * cos - vector.y * sin,
        y: vector.x * sin + vector.y * cos
    };
}

function rotateOffsetOnSameSide(baseOffset, degrees) {
    const rotated = rotateVector(baseOffset, degrees);
    return rotated.x * baseOffset.x + rotated.y * baseOffset.y > 0 ? rotated : null;
}

// Memoize per-segment screen-pixel coordinates so a single layout pass over N
// vehicles doesn't re-project every segment N times. Invalidated whenever the
// map view changes (zoom/pan), since latLngToLayerPoint depends on view state.
// WeakMap so old segment objects can be GC'd when a route is unloaded.
let segmentLayerPointCache = new WeakMap();

function getSegmentLayerPoints(segment) {
    let cached = segmentLayerPointCache.get(segment);
    if (cached) return cached;
    cached = {
        startPx: map.latLngToLayerPoint(segment.start),
        endPx: map.latLngToLayerPoint(segment.end)
    };
    segmentLayerPointCache.set(segment, cached);
    return cached;
}

map.on("zoom move", () => {
    segmentLayerPointCache = new WeakMap();
});

function findNearestRouteSegment(anchor, predicate) {
    let nearest = null;

    state.routeShapeSegments.forEach(segment => {
        if (predicate && !predicate(segment)) return;

        const { startPx, endPx } = getSegmentLayerPoints(segment);
        const dx = endPx.x - startPx.x;
        const dy = endPx.y - startPx.y;
        const lengthSq = dx * dx + dy * dy;
        if (!lengthSq) return;

        const t = Math.max(0, Math.min(1, ((anchor.x - startPx.x) * dx + (anchor.y - startPx.y) * dy) / lengthSq));
        const projectedX = startPx.x + dx * t;
        const projectedY = startPx.y + dy * t;
        const distanceSq = (anchor.x - projectedX) ** 2 + (anchor.y - projectedY) ** 2;

        if (!nearest || distanceSq < nearest.distanceSq) {
            nearest = {
                distanceSq,
                vector: normalizeVector({ x: dx, y: dy }),
                segmentDirectionId: segment.directionId,
                shapeId: segment.shapeId,
                indexInShape: segment.indexInShape,
                t
            };
        }
    });

    return nearest;
}

function nearestRouteSegment(anchor, shapeId = null, directionId = null) {
    const hasDirection = directionId === 0 || directionId === 1;
    const sameShape = segment => shapeIdMatches(segment.shapeId, shapeId);
    const sameDirection = segment => segment.directionId === directionId;

    if (shapeId && hasDirection) {
        const nearest = findNearestRouteSegment(anchor, segment => sameShape(segment) && sameDirection(segment));
        if (nearest) return nearest;
    }

    if (shapeId) {
        const nearest = findNearestRouteSegment(anchor, sameShape);
        if (nearest) return nearest;
    }

    if (hasDirection) {
        const nearest = findNearestRouteSegment(anchor, sameDirection);
        if (nearest) return nearest;
    }

    return findNearestRouteSegment(anchor) || null;
}

/**
 * Compute a smoothed tangent at a point on the polyline by walking forward
 * and backward along the polyline by `radiusPx` pixels from the projection
 * point, then returning the chord direction between those two distant points.
 *
 * This eliminates abrupt perpendicular changes at segment boundaries.
 */
function smoothedTangent(segResult, radiusPx) {
    const shapeSegments = state.routeShapeIndex.get(segResult.shapeId);
    if (!shapeSegments || !shapeSegments.length) return segResult.vector;

    const idx = segResult.indexInShape;
    const t = segResult.t;

    // Compute the projection point in screen pixels on the matched segment.
    const seg = shapeSegments[idx];
    if (!seg) return segResult.vector;

    const { startPx, endPx } = getSegmentLayerPoints(seg);
    const projX = startPx.x + (endPx.x - startPx.x) * t;
    const projY = startPx.y + (endPx.y - startPx.y) * t;

    // Walk forward along the polyline by radiusPx from the projection point.
    let aheadX = projX;
    let aheadY = projY;
    let remaining = radiusPx;
    // First, walk the rest of the current segment (from projection to end).
    {
        const dx = endPx.x - projX;
        const dy = endPx.y - projY;
        const len = Math.hypot(dx, dy);
        if (len >= remaining) {
            const frac = remaining / len;
            aheadX = projX + dx * frac;
            aheadY = projY + dy * frac;
            remaining = 0;
        } else {
            aheadX = endPx.x;
            aheadY = endPx.y;
            remaining -= len;
        }
    }
    for (let i = idx + 1; remaining > 0 && i < shapeSegments.length; i += 1) {
        const s = shapeSegments[i];
        const { startPx: sStart, endPx: sEnd } = getSegmentLayerPoints(s);
        const dx = sEnd.x - sStart.x;
        const dy = sEnd.y - sStart.y;
        const len = Math.hypot(dx, dy);
        if (len >= remaining) {
            const frac = remaining / len;
            aheadX = sStart.x + dx * frac;
            aheadY = sStart.y + dy * frac;
            remaining = 0;
        } else {
            aheadX = sEnd.x;
            aheadY = sEnd.y;
            remaining -= len;
        }
    }

    // Walk backward along the polyline by radiusPx from the projection point.
    let behindX = projX;
    let behindY = projY;
    remaining = radiusPx;
    // First, walk back the current segment (from projection to start).
    {
        const dx = startPx.x - projX;
        const dy = startPx.y - projY;
        const len = Math.hypot(dx, dy);
        if (len >= remaining) {
            const frac = remaining / len;
            behindX = projX + dx * frac;
            behindY = projY + dy * frac;
            remaining = 0;
        } else {
            behindX = startPx.x;
            behindY = startPx.y;
            remaining -= len;
        }
    }
    for (let i = idx - 1; remaining > 0 && i >= 0; i -= 1) {
        const s = shapeSegments[i];
        const { startPx: sStart, endPx: sEnd } = getSegmentLayerPoints(s);
        // Walk from end toward start (backward along polyline).
        const dx = sStart.x - sEnd.x;
        const dy = sStart.y - sEnd.y;
        const len = Math.hypot(dx, dy);
        if (len >= remaining) {
            const frac = remaining / len;
            behindX = sEnd.x + dx * frac;
            behindY = sEnd.y + dy * frac;
            remaining = 0;
        } else {
            behindX = sStart.x;
            behindY = sStart.y;
            remaining -= len;
        }
    }

    const chord = normalizeVector({ x: aheadX - behindX, y: aheadY - behindY });
    return chord || segResult.vector;
}

function vehicleBaseOffset(record, anchor, offsetPx) {
    const attributes = record.vehicle.attributes || {};
    const directionId = attributes.direction_id;
    const bearing = Number.isFinite(attributes.bearing) ? attributes.bearing : null;
    const segmentResult = nearestRouteSegment(anchor, record.shapeId, directionId);

    if (!segmentResult || !segmentResult.vector) {
        // Fallback: no route geometry available — use bearing or default
        return vehicleOffsetForDirection(bearing ?? 0, directionId, offsetPx);
    }

    // Vehicle-circle layout rule:
    // 1. Compute a smoothed tangent at the projection point by averaging the
    //    polyline direction over a window (chord tangent), eliminating abrupt
    //    perpendicular changes at segment boundaries.
    // 2. If the vehicle's directionId differs from the segment's directionId,
    //    flip the vector so it represents the vehicle's actual travel direction.
    // 3. Take the right-side perpendicular of the travel direction.
    //    Since opposite directions have opposite travel vectors, their right-side
    //    normals naturally point to opposite sides of the route.
    let travelVector = smoothedTangent(segmentResult, VEHICLE_TANGENT_SMOOTH_PX);
    const segDirId = segmentResult.segmentDirectionId;

    if (segDirId === 0 || segDirId === 1) {
        // Segment has a known directionId — use it to align the travel vector
        if (directionId !== segDirId) {
            travelVector = { x: -travelVector.x, y: -travelVector.y };
        }
    } else {
        // Segment has no directionId — fall back to bearing for alignment
        if (bearing !== null) {
            const bearingRad = bearing * Math.PI / 180;
            const bearingVector = { x: Math.sin(bearingRad), y: -Math.cos(bearingRad) };
            if (travelVector.x * bearingVector.x + travelVector.y * bearingVector.y < 0) {
                travelVector = { x: -travelVector.x, y: -travelVector.y };
            }
        }
    }

    const rightNormal = { x: -travelVector.y, y: travelVector.x };
    return {
        x: rightNormal.x * offsetPx,
        y: rightNormal.y * offsetPx
    };
}

function resolveVehicleOffsets(records, anchorResolver = null) {
    const offsetPx = effectiveOffsetPx();
    const minDistance = VEHICLE_MARKER_RADIUS_PX * 2 + VEHICLE_COLLISION_PADDING_PX;
    const visibleBounds = map.getPixelBounds().pad(0.15);
    const visibleStops = [];
    state.stops.forEach(stop => {
        const point = map.latLngToLayerPoint([stop.lat, stop.lng]);
        if (visibleBounds.contains(point)) {
            visibleStops.push(point);
        }
    });
    const layoutItems = records
        .map((record, index) => {
            const attributes = record.vehicle.attributes || {};
            const currentLatLng = anchorResolver ? anchorResolver(record) : record.marker.getLatLng();
            const anchorLatLng = currentLatLng || [attributes.latitude, attributes.longitude];
            const anchor = map.latLngToLayerPoint(anchorLatLng);
            const baseOffset = vehicleBaseOffset(record, anchor, offsetPx);

            return {
                index,
                anchor,
                baseOffset,
                offset: { ...baseOffset },
                rotation: 0,
                pushOut: 0,
                directionId: attributes.direction_id,
                participates: visibleBounds.contains(anchor)
            };
        });

    const activeItems = layoutItems.filter(item => item.participates);

    for (let iteration = 0; iteration < VEHICLE_COLLISION_ITERATIONS; iteration += 1) {
        let moved = false;

        for (let i = 0; i < activeItems.length; i += 1) {
            for (let j = i + 1; j < activeItems.length; j += 1) {
                const a = activeItems[i];
                const b = activeItems[j];

                const ax = a.anchor.x + a.offset.x;
                const ay = a.anchor.y + a.offset.y;
                const bx = b.anchor.x + b.offset.x;
                const by = b.anchor.y + b.offset.y;
                const distance = Math.hypot(bx - ax, by - ay);

                if (distance >= minDistance) continue;

                const sameDirection = (a.directionId === 0 || a.directionId === 1)
                    && a.directionId === b.directionId;

                if (sameDirection) {
                    // Same-direction overlap rule:
                    // Keep each circle on its own fixed-radius path around the true vehicle point.
                    // When two same-direction circles collide, rotate them in opposite directions.
                    // This intentionally allows the leader line to deviate from perpendicular only while avoiding overlap.
                    const aSign = a.index <= b.index ? -1 : 1;
                    const bSign = -aSign;
                    const nextARotation = Math.max(
                        -VEHICLE_MAX_COLLISION_ROTATION_DEG,
                        Math.min(VEHICLE_MAX_COLLISION_ROTATION_DEG, a.rotation + aSign * VEHICLE_COLLISION_ROTATION_STEP_DEG)
                    );
                    const nextBRotation = Math.max(
                        -VEHICLE_MAX_COLLISION_ROTATION_DEG,
                        Math.min(VEHICLE_MAX_COLLISION_ROTATION_DEG, b.rotation + bSign * VEHICLE_COLLISION_ROTATION_STEP_DEG)
                    );

                    const nextAOffset = rotateOffsetOnSameSide(a.baseOffset, nextARotation);
                    const nextBOffset = rotateOffsetOnSameSide(b.baseOffset, nextBRotation);

                    if (nextARotation !== a.rotation && nextAOffset) {
                        a.rotation = nextARotation;
                        a.offset = nextAOffset;
                        moved = true;
                    }
                    if (nextBRotation !== b.rotation && nextBOffset) {
                        b.rotation = nextBRotation;
                        b.offset = nextBOffset;
                        moved = true;
                    }
                } else {
                    // Cross-direction overlap rule:
                    // Push each circle outward along its own base-offset direction (the normal),
                    // preserving perpendicularity and keeping each direction on its own side.
                    // The leader line gets longer but the geometric relationship stays correct.
                    const pushItems = [a, b];
                    pushItems.forEach(item => {
                        if (item.pushOut >= VEHICLE_CROSS_DIRECTION_MAX_PUSH_PX) return;

                        item.pushOut = Math.min(item.pushOut + VEHICLE_CROSS_DIRECTION_PUSH_PX, VEHICLE_CROSS_DIRECTION_MAX_PUSH_PX);
                        const baseNorm = normalizeVector(item.baseOffset);
                        if (baseNorm) {
                            const totalRadius = offsetPx + item.pushOut;
                            const pushed = { x: baseNorm.x * totalRadius, y: baseNorm.y * totalRadius };
                            // Re-apply any existing rotation on top of the new radius
                            const rotated = item.rotation ? rotateOffsetOnSameSide(pushed, item.rotation) : pushed;
                            if (rotated) {
                                item.offset = rotated;
                                // Update baseOffset to reflect new radius so future rotation stays consistent
                                item.baseOffset = pushed;
                                moved = true;
                            }
                        }
                    });
                }
            }
        }

        activeItems.forEach(item => {
            visibleStops.forEach(stopPoint => {
                const markerX = item.anchor.x + item.offset.x;
                const markerY = item.anchor.y + item.offset.y;
                let dx = markerX - stopPoint.x;
                let dy = markerY - stopPoint.y;
                let distance = Math.hypot(dx, dy);
                const stopMinDistance = VEHICLE_MARKER_RADIUS_PX + STOP_AVOID_RADIUS_PX;

                if (distance >= stopMinDistance) return;

                if (distance < 0.1) {
                    dx = item.offset.x || item.baseOffset.x || 1;
                    dy = item.offset.y || item.baseOffset.y || 0;
                    distance = Math.hypot(dx, dy) || 1;
                }

                const push = stopMinDistance - distance;
                const direction = item.index % 2 === 0 ? 1 : -1;
                const rotationStep = Math.max(VEHICLE_COLLISION_ROTATION_STEP_DEG, push / 2);
                const nextRotation = Math.max(
                    -VEHICLE_MAX_COLLISION_ROTATION_DEG,
                    Math.min(VEHICLE_MAX_COLLISION_ROTATION_DEG, item.rotation + direction * rotationStep)
                );

                const nextOffset = rotateOffsetOnSameSide(item.baseOffset, nextRotation);

                if (nextRotation !== item.rotation && nextOffset) {
                    item.rotation = nextRotation;
                    item.offset = nextOffset;
                    moved = true;
                }
            });
        });

        if (!moved) break;
    }

    return layoutItems.map(item => ({
        x: Math.round(item.offset.x),
        y: Math.round(item.offset.y)
    }));
}

function vehicleModeClass(route) {
    if (route?.type === 3) return "vehicle-bus";
    if (route?.type === 4) return "vehicle-ferry";
    return "vehicle-train";
}

function vehicleGlyph(route) {
    if (route?.type === 3) {
        return `
            <rect x="8" y="7" width="20" height="22" rx="5"></rect>
            <rect class="vehicle-cutout" x="11" y="10" width="14" height="7" rx="2"></rect>
            <circle class="vehicle-cutout" cx="13" cy="25" r="2.3"></circle>
            <circle class="vehicle-cutout" cx="23" cy="25" r="2.3"></circle>
        `;
    }
    if (route?.type === 4) {
        return `
            <path d="M7 19.5H29L25.5 28H10.5Z"></path>
            <path d="M11 14H25L27 19.5H9Z"></path>
            <path d="M12 31C15 29 18 33 21 31C24 29 27 33 30 31"></path>
        `;
    }
    return `
        <rect x="10" y="6" width="16" height="22" rx="4"></rect>
        <rect class="vehicle-cutout" x="13" y="10" width="10" height="8" rx="2"></rect>
        <circle class="vehicle-cutout" cx="14" cy="24" r="2"></circle>
        <circle class="vehicle-cutout" cx="22" cy="24" r="2"></circle>
        <path class="vehicle-rail" d="M14 29L10 34M22 29L26 34M12 32H24"></path>
    `;
}

function vehicleHaloBase(route) {
    const color0 = vehicleDirectionColor(route, 0);
    const color1 = vehicleDirectionColor(route, 1);
    return relativeLuminance(color0) <= relativeLuminance(color1) ? color0 : color1;
}

function vehicleHaloAnimationDelay() {
    const elapsedMs = performance.now() - vehicleHaloClockStartMs;
    return `-${((elapsedMs % VEHICLE_HALO_BREATHE_MS) / 1000).toFixed(3)}s`;
}

function createVehicleIcon(vehicle, route, stopInfo, offset = null) {
    const directionId = vehicle.attributes.direction_id;
    const directionClass = directionId === 0 || directionId === 1 ? `direction-${directionId}` : "direction-unknown";
    const bearing = Number.isFinite(vehicle.attributes.bearing) ? vehicle.attributes.bearing : 0;
    const stopClass = vehicle.attributes.current_status === "STOPPED_AT" ? "at-stop" : "";
    const markerAccent = vehicleDirectionColor(route, directionId);
    const visualOffset = offset || vehicleOffsetForDirection(bearing, directionId);
    const center = VEHICLE_ICON_SIZE / 2;
    const offsetDistance = Math.hypot(visualOffset.x, visualOffset.y);
    const leaderLength = Math.max(0, offsetDistance - VEHICLE_MARKER_RADIUS_PX + 1);
    const leaderScale = offsetDistance ? leaderLength / offsetDistance : 0;
    const leaderEndX = center + Math.round(visualOffset.x * leaderScale);
    const leaderEndY = center + Math.round(visualOffset.y * leaderScale);
    const markerCenterX = center + visualOffset.x;
    const markerCenterY = center + visualOffset.y;

    return L.divIcon({
        className: "",
        html: `
            <div class="vehicle-offset-marker ${directionClass} ${stopClass} ${vehicleModeClass(route)}"
                 style="--vehicle-color: ${markerAccent}; --vehicle-halo-base: ${vehicleHaloBase(route)}; --vehicle-halo-duration: ${(VEHICLE_HALO_BREATHE_MS / 1000).toFixed(3)}s; --vehicle-halo-delay: ${vehicleHaloAnimationDelay()}; --vehicle-x: ${visualOffset.x}px; --vehicle-y: ${visualOffset.y}px;">
                <svg class="vehicle-leader" viewBox="0 0 ${VEHICLE_ICON_SIZE} ${VEHICLE_ICON_SIZE}" aria-hidden="true" focusable="false">
                    <line x1="${center}" y1="${center}" x2="${leaderEndX}" y2="${leaderEndY}"></line>
                    <circle cx="${center}" cy="${center}" r="3"></circle>
                </svg>
                <span class="vehicle-marker">
                    <svg class="vehicle-symbol" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
                        ${vehicleGlyph(route)}
                    </svg>
                </span>
                <svg class="vehicle-hit-target" viewBox="0 0 ${VEHICLE_ICON_SIZE} ${VEHICLE_ICON_SIZE}" aria-hidden="true" focusable="false">
                    <circle cx="${markerCenterX}" cy="${markerCenterY}" r="${VEHICLE_MARKER_RADIUS_PX + 4}"></circle>
                </svg>
            </div>
        `,
        iconSize: [VEHICLE_ICON_SIZE, VEHICLE_ICON_SIZE],
        iconAnchor: [center, center],
        popupAnchor: [visualOffset.x, visualOffset.y - 22]
    });
}

function vehicleLeaderGeometry(offset) {
    const center = VEHICLE_ICON_SIZE / 2;
    const offsetDistance = Math.hypot(offset.x, offset.y);
    const leaderLength = Math.max(0, offsetDistance - VEHICLE_MARKER_RADIUS_PX + 1);
    const leaderScale = offsetDistance ? leaderLength / offsetDistance : 0;

    return {
        leaderEndX: center + offset.x * leaderScale,
        leaderEndY: center + offset.y * leaderScale,
        markerCenterX: center + offset.x,
        markerCenterY: center + offset.y
    };
}

function applyVehicleVisualOffset(record, offset) {
    const visualOffset = {
        x: Number.isFinite(offset?.x) ? offset.x : 0,
        y: Number.isFinite(offset?.y) ? offset.y : 0
    };
    record.visualOffset = visualOffset;
    const popupAnchor = [visualOffset.x, visualOffset.y - 22];
    if (record.marker.options.icon?.options) {
        record.marker.options.icon.options.popupAnchor = popupAnchor;
    }

    const element = record.marker.getElement();
    const root = element?.querySelector(".vehicle-offset-marker");
    if (!root) {
        record.marker.setIcon(createVehicleIcon(record.vehicle, record.route, record.stopInfo, visualOffset));
        return;
    }

    const { leaderEndX, leaderEndY, markerCenterX, markerCenterY } = vehicleLeaderGeometry(visualOffset);
    root.style.setProperty("--vehicle-x", `${visualOffset.x}px`);
    root.style.setProperty("--vehicle-y", `${visualOffset.y}px`);
    root.querySelector(".vehicle-leader line")?.setAttribute("x2", leaderEndX);
    root.querySelector(".vehicle-leader line")?.setAttribute("y2", leaderEndY);
    root.querySelector(".vehicle-hit-target circle")?.setAttribute("cx", markerCenterX);
    root.querySelector(".vehicle-hit-target circle")?.setAttribute("cy", markerCenterY);
    if (record.marker._popup?.isOpen()) {
        record.marker._popup.options.offset = L.point(popupAnchor);
        record.marker._popup.update();
    }
}

function setVehicleMoving(record, isMoving) {
    record.marker.getElement()
        ?.querySelector(".vehicle-offset-marker")
        ?.classList.toggle("is-moving", isMoving);
}

function applyVehicleLayout() {
    if (!state.vehicleRecords.size) return;

    const records = [...state.vehicleRecords.values()];
    const offsets = resolveVehicleOffsets(records);
    records.forEach((record, index) => {
        record.marker.setIcon(createVehicleIcon(record.vehicle, record.route, record.stopInfo, offsets[index]));
        record.visualOffset = offsets[index];
    });
}

function scheduleVehicleLayout() {
    if (state.vehicleLayoutTimer) {
        clearTimeout(state.vehicleLayoutTimer);
    }
    state.vehicleLayoutTimer = setTimeout(() => {
        state.vehicleLayoutTimer = null;
        applyVehicleLayout();
    }, VEHICLE_LAYOUT_DEBOUNCE_MS);
}

function createUserLocationIcon() {
    return L.divIcon({
        className: "",
        html: '<div class="user-location-marker"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -9]
    });
}

function setFollowUserLocation(isFollowing) {
    state.followUserLocation = isFollowing && Boolean(state.userLocation);
    document.body.classList.toggle("is-following-user", state.followUserLocation);
    locateUserButton.classList.toggle("is-following", state.followUserLocation);
    locateUserButton.setAttribute("aria-pressed", String(state.followUserLocation));
    locateUserButton.title = state.followUserLocation ? "Stop following my location" : "My location";
}

function setUserLocationAvailable(isAvailable) {
    locateUserButton.hidden = false;
    locateUserButton.classList.toggle("is-unavailable", !isAvailable);
    locateUserButton.setAttribute("aria-disabled", String(!isAvailable));
    if (!isAvailable) {
        setFollowUserLocation(false);
    }
}

function centerMapOnUser(latLng, zoom = map.getZoom()) {
    state.isProgrammaticMapMove = true;
    map.setView(latLng, zoom, { animate: true });
    map.once("moveend", () => {
        state.isProgrammaticMapMove = false;
    });
    window.setTimeout(() => {
        state.isProgrammaticMapMove = false;
    }, 500);
}

/* ====================== */
/* ======= ROUTES ======= */
/* ====================== */

async function loadRoutes() {
    const json = await fetchMbta("/routes");
    const routes = sortRoutes(json.data.map(route => ({
        id: route.id,
        shortName: route.attributes.short_name || route.id,
        longName: route.attributes.long_name,
        color: route.attributes.color,
        textColor: route.attributes.text_color,
        type: route.attributes.type,
        directionNames: route.attributes.direction_names || [],
        directionDestinations: route.attributes.direction_destinations || []
    })));
    assignRouteBadgeLabels(routes);

    state.routes = new Map(routes.map(route => [route.id, route]));
    routeFilter.innerHTML = "";
    routes.forEach(route => {
        routeFilter.add(new Option(displayRouteName(route), route.id));
    });

    routeFilter.disabled = false;
    routePickerButton.disabled = false;
    renderRoutePickerOptions();
    return routes;
}

async function initializeRoutes() {
    setUpdated("Loading routes...");

    const routes = await loadRoutes();
    const routeFromURL = getRouteFromURL();
    const initialRoute = state.routes.has(routeFromURL)
        ? routeFromURL
        : (state.routes.has("Green-E") ? "Green-E" : routes[0]?.id);

    if (!initialRoute) {
        throw new Error("No MBTA routes were returned.");
    }

    routeFilter.value = initialRoute;
    renderRoutePickerSelection(state.routes.get(initialRoute));
    await selectRoute(initialRoute, { updateUrl: false, fitRoute: true });
}

async function selectRoute(routeId, options = {}) {
    const route = state.routes.get(routeId);
    if (!route) return;

    // Cancel any in-flight fetches from a previous route load. The requestId
    // pattern would catch stale responses anyway, but aborting frees the network
    // immediately so the new route loads faster on slow connections.
    if (state.routeAbortController) {
        state.routeAbortController.abort();
    }
    state.routeAbortController = new AbortController();
    const signal = state.routeAbortController.signal;

    stopVehiclePolling();
    state.selectedRouteId = routeId;
    routeFilter.value = routeId;
    state.routeRequestId += 1;
    state.hasFitRoute = false;
    const requestId = state.routeRequestId;

    setRouteTheme(route);
    renderRoutePickerSelection(route);
    if (state.routePickerExpanded) {
        renderRoutePickerOptions();
    }
    renderDirectionLegend(route);
    setUpdated(`Loading ${displayRouteName(route)}...`);
    clearMapForRouteChange();
    hideAlerts();

    if (options.updateUrl !== false) {
        updateURLWithRoute(routeId);
    }

    try {
        await renderRouteShape(routeId, route, requestId, options.fitRoute !== false, signal);
        await renderRouteStops(routeId, route, requestId, signal);
        await renderAlerts(routeId, requestId, signal);

        if (!isCurrentRoute(routeId, requestId)) return;

        await refreshVehicles(routeId, signal);
        restartVehiclePolling();
    } catch (error) {
        if (error.name === "AbortError") return;
        if (!isCurrentRoute(routeId, requestId)) return;
        console.error(error);
        setUpdated("Unable to load route data");
    }
}

function isCurrentRoute(routeId, requestId = state.routeRequestId) {
    return state.selectedRouteId === routeId && state.routeRequestId === requestId;
}

function clearMapForRouteChange() {
    state.vehicleRecords.forEach(record => cancelVehicleMoveAnimation(record.marker));
    routeLayer.clearLayers();
    stopLayer.clearLayers();
    vehicleLayer.clearLayers();
    state.vehicleRecords.clear();
    state.stops.clear();
    state.routeShapeSegments = [];
    state.routeShapeIndex.clear();
    resetRouteViewButton.hidden = true;
}

/* ====================== */
/* ======== SHAPES ====== */
/* ====================== */

function fitCurrentRouteView(options = {}) {
    if (!routeLayer.getLayers().length) return false;

    map.fitBounds(routeLayer.getBounds(), {
        paddingTopLeft: [24, 155],
        paddingBottomRight: [24, 24],
        maxZoom: 15,
        ...options
    });
    return true;
}

async function renderRouteShape(routeId, route, requestId, shouldFit, signal) {
    const [json, representativeShapeInfo] = await Promise.all([
        fetchMbta("/shapes", { "filter[route]": routeId }, signal),
        getRepresentativeShapeIds(routeId, signal).catch(error => {
            if (error.name === "AbortError") throw error;
            console.warn(`Unable to load representative route patterns for ${routeId}:`, error);
            return [];
        })
    ]);
    if (!isCurrentRoute(routeId, requestId)) return;

    routeLayer.clearLayers();
    state.routeShapeSegments = [];
    state.routeShapeIndex.clear();

    if (!json.data?.length) {
        console.warn(`No shape data found for route: ${routeId}`);
        return;
    }

    const representativeShapeSet = new Set(representativeShapeInfo.map(shape => shape.id));
    const representativeDirectionByShape = new Map(representativeShapeInfo.map(shape => [
        canonicalShapeId(shape.id),
        shape.directionId
    ]));
    const representativeShapes = json.data.filter(shape =>
        representativeShapeSet.has(shape.id)
            || representativeShapeInfo.some(representativeShape => shapeIdMatches(shape.id, representativeShape.id))
    );
    const shapes = representativeShapes.length ? representativeShapes : json.data;

    shapes.forEach(shape => {
        const points = decodePolyline(shape.attributes.polyline || "");
        if (!points.length) return;
        const directionId = representativeDirectionByShape.get(canonicalShapeId(shape.id));
        const shapeSegments = [];

        for (let index = 0; index < points.length - 1; index += 1) {
            const seg = {
                shapeId: shape.id,
                directionId,
                start: points[index],
                end: points[index + 1],
                indexInShape: index
            };
            state.routeShapeSegments.push(seg);
            shapeSegments.push(seg);
        }

        state.routeShapeIndex.set(shape.id, shapeSegments);

        L.polyline(points, {
            color: routeColor(route),
            weight: 5,
            opacity: 0.82,
            lineCap: "round",
            lineJoin: "round",
            interactive: false
        }).addTo(routeLayer);
    });

    resetRouteViewButton.hidden = !routeLayer.getLayers().length;

    if (shouldFit && fitCurrentRouteView()) {
        state.hasFitRoute = true;
    }
}

/* ====================== */
/* ======== STOPS ======= */
/* ====================== */

async function renderRouteStops(routeId, route, requestId, signal) {
    const json = await fetchMbta("/stops", { "filter[route]": routeId }, signal);
    if (!isCurrentRoute(routeId, requestId)) return;

    stopLayer.clearLayers();
    state.stops.clear();

    if (!json.data?.length) {
        console.warn(`No stops found for route: ${routeId}`);
        return;
    }

    json.data.forEach(stop => {
        const lat = stop.attributes.latitude;
        const lng = stop.attributes.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const stopName = stop.attributes.name || "Unknown Stop";
        state.stops.set(stop.id, {
            id: stop.id,
            name: stopName,
            lat,
            lng
        });

        const marker = L.marker([lat, lng], {
            icon: createStopIcon(route),
            title: stopName,
            zIndexOffset: 300
        }).addTo(stopLayer);

        marker.bindPopup(stopPopup(stopName, {
            travel: "Travel time loading...",
            arrivals: '<span class="popup-muted">Loading arrivals...</span>'
        }), { closeButton: false });
        marker.on("click", () => {
            renderPredictions(routeId, stop.id, marker);
        });
    });
}

function stopPopup(stopName, { travel = "", arrivals = "" } = {}) {
    return `
        <div class="popup-card popup-card-stop">
            <span class="popup-title">${escapeHtml(stopName)}</span>
            ${travel ? popupInfoRow("Travel time", travel, "popup-time-value") : ""}
            <div class="popup-section popup-arrivals">${arrivals}</div>
        </div>
    `;
}

function popupInfoRow(label, value, valueClass = "") {
    if (!value) return "";
    const className = ["popup-info-value", valueClass].filter(Boolean).join(" ");

    return `
        <div class="popup-info-row">
            <span class="popup-info-label">${escapeHtml(label)}</span>
            <span class="${escapeHtml(className)}">${escapeHtml(value)}</span>
        </div>
    `;
}

function vehiclePopup({ title, direction, destination, stopInfo, status, updatedAt }) {
    // vehicleStopInfo() only ever returns kind: "at" — the "near-stop" concept
    // was removed in 2026-05-09. Keep the label collapsed to a single value.
    const stopLabel = stopInfo ? "At stop" : "";
    const stopName = stopInfo?.stop?.name || "";

    return `
        <div class="popup-card popup-card-vehicle">
            <span class="popup-title">${escapeHtml(title)}</span>
            <div class="popup-info-list">
                ${popupInfoRow("Direction", direction)}
                ${popupInfoRow("Destination", destination)}
                ${popupInfoRow(stopLabel, stopName)}
                ${popupInfoRow("Status", status)}
                ${popupInfoRow("Updated", updatedAt)}
            </div>
        </div>
    `;
}

async function renderPredictions(routeId, stopId, stopMarker) {
    const route = state.routes.get(routeId);
    const stop = state.stops.get(stopId);
    let travel = "Travel time loading...";
    let arrivals = '<span class="popup-muted">Loading arrivals...</span>';
    const updatePopup = () => {
        stopMarker.setPopupContent(stopPopup(stopMarker.options.title, { travel, arrivals })).openPopup();
    };

    updatePopup();

    if (stop) {
        fetchTravelTimeSummary(stop)
            .then(summary => {
                if (state.selectedRouteId !== routeId || !map.hasLayer(stopMarker)) return;
                travel = summary;
                updatePopup();
            })
            .catch(error => {
                if (state.selectedRouteId !== routeId || !map.hasLayer(stopMarker)) return;
                console.error("Error fetching travel times:", error);
                travel = "Unavailable";
                updatePopup();
            });
    } else {
        travel = "Unavailable";
        updatePopup();
    }

    try {
        const json = await fetchMbta("/predictions", {
            "filter[route]": routeId,
            "filter[stop]": stopId,
            include: "trip"
        });

        if (state.selectedRouteId !== routeId || !map.hasLayer(stopMarker)) return;

        const tripLookup = new Map((json.included || [])
            .filter(item => item.type === "trip")
            .map(trip => [trip.id, trip.attributes.headsign]));

        const now = Date.now();
        const groups = new Map();

        (json.data || []).forEach(prediction => {
            const attributes = prediction.attributes || {};
            const arrivalOrDeparture = attributes.arrival_time || attributes.departure_time;
            const predictionTime = parseMbtaDate(arrivalOrDeparture);
            if (!predictionTime) return;

            const minutes = Math.round((predictionTime.getTime() - now) / 60000);
            if (!Number.isFinite(minutes) || minutes < 0) return;

            const directionId = attributes.direction_id;
            const tripId = prediction.relationships?.trip?.data?.id;
            const headsign = tripLookup.get(tripId)
                || route?.directionDestinations?.[directionId]
                || "Unknown destination";
            const key = `${directionId}-${headsign}`;

            if (!groups.has(key)) {
                groups.set(key, { directionId, headsign, minutes: [] });
            }
            groups.get(key).minutes.push(minutes);
        });

        const rows = Array.from(groups.values())
            .sort((a, b) =>
                directionSortValue(a.directionId) - directionSortValue(b.directionId)
                    || a.headsign.localeCompare(b.headsign)
            )
            .map(group => {
                const times = group.minutes.sort((a, b) => a - b).slice(0, 3);
                const label = route?.directionNames?.[group.directionId] || `Direction ${group.directionId}`;
                return `
                    <div class="popup-info-row">
                        <span class="popup-info-label">${escapeHtml(label)} to ${escapeHtml(group.headsign)}</span>
                        <span class="popup-info-value popup-time-value">${times.join(" / ")} min</span>
                    </div>
                `;
            });

        arrivals = rows.length
            ? rows.join("")
            : '<span class="popup-muted">No upcoming arrivals.</span>';

        updatePopup();
    } catch (error) {
        if (state.selectedRouteId !== routeId || !map.hasLayer(stopMarker)) return;

        console.error("Error fetching predictions:", error);
        arrivals = '<span class="popup-muted">Unable to load arrivals.</span>';
        updatePopup();
    }
}

/* ====================== */
/* ======= ALERTS ======= */
/* ====================== */

async function renderAlerts(routeId, requestId, signal) {
    try {
        const json = await fetchMbta("/alerts", { "filter[route]": routeId }, signal);
        if (!isCurrentRoute(routeId, requestId)) return;

        const alerts = (json.data || [])
            .filter(alert => alert.attributes?.header)
            .sort((a, b) => {
                const lifecycleRank = {
                    NEW: 0,
                    ONGOING: 1,
                    ONGOING_UPCOMING: 2,
                    UPCOMING: 3
                };
                const aLifecycle = lifecycleRank[a.attributes.lifecycle] ?? 99;
                const bLifecycle = lifecycleRank[b.attributes.lifecycle] ?? 99;
                const lifecycle = aLifecycle - bLifecycle;
                if (lifecycle !== 0) return lifecycle;

                const severity = (b.attributes.severity || 0) - (a.attributes.severity || 0);
                if (severity !== 0) return severity;

                const aStart = new Date(a.attributes.active_period?.[0]?.start || 0);
                const bStart = new Date(b.attributes.active_period?.[0]?.start || 0);
                return aStart - bStart;
            });

        if (!alerts.length) {
            hideAlerts();
            return;
        }

        alertBox.innerHTML = alerts.map(alert => {
            const severity = alert.attributes.severity ?? "n/a";
            const lifecycle = alert.attributes.lifecycle || "Alert";
            const effect = alert.attributes.effect || "Service alert";
            const header = alert.attributes.header;
            return `
                <div class="alert-item">
                    <span class="alert-meta">${escapeHtml(lifecycle)} - ${escapeHtml(effect)} - severity ${escapeHtml(severity)}</span>
                    ${escapeHtml(header)}
                </div>
            `;
        }).join("");

        alertBox.style.display = "none";
        toggleAlertButton.hidden = false;
        toggleAlertButton.textContent = `Show alerts (${alerts.length})`;
        toggleAlertButton.dataset.count = String(alerts.length);
        alertIndicator.textContent = alerts.length > 99 ? "99+" : String(alerts.length);
        alertIndicator.setAttribute("aria-label", `${alerts.length} active service ${alerts.length === 1 ? "alert" : "alerts"} on this route`);
        alertIndicator.title = `${alerts.length} active service ${alerts.length === 1 ? "alert" : "alerts"}`;
        alertIndicator.hidden = false;
    } catch (error) {
        if (error.name === "AbortError") return;
        if (!isCurrentRoute(routeId, requestId)) return;

        console.error("Error fetching alerts:", error);
        alertBox.textContent = "Unable to load alerts.";
        alertBox.style.display = "none";
        toggleAlertButton.hidden = false;
        toggleAlertButton.textContent = "Show alerts";
        toggleAlertButton.dataset.count = "";
    }
}

function hideAlerts() {
    alertBox.style.display = "none";
    alertBox.innerHTML = "";
    toggleAlertButton.hidden = true;
    toggleAlertButton.textContent = "Show alerts";
    toggleAlertButton.dataset.count = "";
    alertIndicator.textContent = "";
    alertIndicator.hidden = true;
}

toggleAlertButton.addEventListener("click", () => {
    const isVisible = alertBox.style.display === "block";
    const count = toggleAlertButton.dataset.count;

    alertBox.style.display = isVisible ? "none" : "block";
    toggleAlertButton.textContent = isVisible
        ? (count ? `Show alerts (${count})` : "Show alerts")
        : "Hide alerts";
});

panelToggleButton.addEventListener("click", () => {
    setPanelExpanded(!state.panelExpanded);
});

/* ====================== */
/* ====== VEHICLES ====== */
/* ====================== */

function cancelVehicleMoveAnimation(marker) {
    if (!marker) return;

    if (marker?._vehicleMoveAnimationFrame) {
        cancelAnimationFrame(marker._vehicleMoveAnimationFrame);
        marker._vehicleMoveAnimationFrame = null;
    }
    marker.getElement()
        ?.querySelector(".vehicle-offset-marker")
        ?.classList.remove("is-moving");
}

function cancelVehicleMoveAnimations() {
    state.vehicleRecords.forEach(record => cancelVehicleMoveAnimation(record.marker));
}

function animateVehicleTo(record, targetLatLng, targetOffset, options = {}) {
    const marker = record.marker;
    const duration = options.duration ?? VEHICLE_MOVE_DURATION_MS;
    const maxJumpMeters = options.maxJumpMeters ?? VEHICLE_MOVE_MAX_JUMP_METERS;
    const from = marker.getLatLng();
    const to = L.latLng(targetLatLng);
    const fromOffset = record.visualOffset || targetOffset || { x: 0, y: 0 };
    const toOffset = targetOffset || fromOffset;

    if (!from || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) {
        cancelVehicleMoveAnimation(marker);
        marker.setLatLng(to);
        applyVehicleVisualOffset(record, toOffset);
        setVehicleMoving(record, false);
        return;
    }

    const distance = from.distanceTo(to);
    if (!Number.isFinite(distance) || distance < 0.5 || distance > maxJumpMeters || duration <= 0) {
        cancelVehicleMoveAnimation(marker);
        marker.setLatLng(to);
        applyVehicleVisualOffset(record, toOffset);
        setVehicleMoving(record, false);
        return;
    }

    cancelVehicleMoveAnimation(marker);
    setVehicleMoving(record, true);

    const start = performance.now();
    const startPoint = map.latLngToLayerPoint(from);
    const endPoint = map.latLngToLayerPoint(to);
    const deltaX = endPoint.x - startPoint.x;
    const deltaY = endPoint.y - startPoint.y;
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

    const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const eased = easeOutCubic(t);
        const point = L.point(
            startPoint.x + deltaX * eased,
            startPoint.y + deltaY * eased
        );
        const currentLatLng = map.layerPointToLatLng(point);
        const offset = {
            x: fromOffset.x + (toOffset.x - fromOffset.x) * eased,
            y: fromOffset.y + (toOffset.y - fromOffset.y) * eased
        };

        // Move the marker in layer-pixel space so browser transforms can use
        // fractional pixels. Calling setLatLng every frame goes through
        // Leaflet's rounded latLngToLayerPoint path, which creates visible
        // one-pixel stepping on slow vehicle movements.
        marker._latlng = currentLatLng;
        marker._setPos(point);
        if (marker._popup?.isOpen()) {
            marker._popup.setLatLng(currentLatLng);
        }
        applyVehicleVisualOffset(record, offset);

        if (t < 1) {
            marker._vehicleMoveAnimationFrame = requestAnimationFrame(step);
        } else {
            marker._vehicleMoveAnimationFrame = null;
            marker.setLatLng(to);
            applyVehicleVisualOffset(record, toOffset);
            setVehicleMoving(record, false);
        }
    };

    marker._vehicleMoveAnimationFrame = requestAnimationFrame(step);
}

async function refreshVehicles(routeId = state.selectedRouteId, signal) {
    if (!routeId) return;

    const requestId = ++state.vehicleRequestId;
    const route = state.routes.get(routeId);

    try {
        const json = await fetchMbta("/vehicles", {
            "filter[route]": routeId,
            include: "trip,stop"
        }, signal);

        if (requestId !== state.vehicleRequestId || state.selectedRouteId !== routeId) return;

        const tripLookup = new Map((json.included || [])
            .filter(item => item.type === "trip")
            .map(trip => [trip.id, {
                headsign: trip.attributes.headsign,
                shapeId: trip.relationships?.shape?.data?.id
            }]));
        const stopLookup = new Map((json.included || [])
            .filter(item => item.type === "stop")
            .map(stop => [stop.id, stop]));

        const vehicles = (json.data || []).filter(vehicle => {
            const lat = vehicle.attributes?.latitude;
            const lng = vehicle.attributes?.longitude;
            return Number.isFinite(lat) && Number.isFinite(lng);
        });
        const vehicleCounts = { 0: 0, 1: 0 };
        const seenIds = new Set();

        // Diff-update markers in place rather than nuking the whole layer every poll.
        // Reusing the L.marker instance preserves the open popup (if any), avoids
        // DOM churn, and lets repeated MBTA updates animate between coordinates.
        vehicles.forEach(vehicle => {
            const attributes = vehicle.attributes;
            const position = [attributes.latitude, attributes.longitude];
            const tripId = vehicle.relationships?.trip?.data?.id;
            const trip = tripLookup.get(tripId);
            const directionId = attributes.direction_id;
            if (directionId === 0 || directionId === 1) {
                vehicleCounts[directionId] += 1;
            }
            const stopInfo = vehicleStopInfo(vehicle, stopLookup);
            const headsign = trip?.headsign
                || route?.directionDestinations?.[directionId]
                || "Unknown destination";
            const status = attributes.current_status
                ? attributes.current_status.replace(/_/g, " ").toLowerCase()
                : "unknown";
            const label = attributes.label || vehicle.id || "Unknown vehicle";
            const direction = directionId === 0 || directionId === 1
                ? directionLabel(route, directionId)
                : "Unknown direction";
            const popupHtml = vehiclePopup({
                title: `${routeId} - ${label}`,
                direction,
                destination: headsign,
                stopInfo,
                status,
                updatedAt: formatTime(attributes.updated_at)
            });
            const zIndexOffset = stopInfo ? 1200 : 1000;

            seenIds.add(vehicle.id);
            const existing = state.vehicleRecords.get(vehicle.id);
            let marker;
            let record;
            if (existing) {
                marker = existing.marker;
                marker.setPopupContent(popupHtml);
                marker.setZIndexOffset(zIndexOffset);
                record = existing;
                Object.assign(record, {
                    vehicle,
                    route,
                    stopInfo,
                    shapeId: trip?.shapeId,
                    targetLatLng: L.latLng(position),
                    shouldAnimate: true
                });
                marker.setIcon(createVehicleIcon(vehicle, route, stopInfo, record.visualOffset));
            } else {
                marker = L.marker(position, {
                    icon: createVehicleIcon(vehicle, route, stopInfo),
                    zIndexOffset
                }).addTo(vehicleLayer);
                marker.bindPopup(popupHtml, { closeButton: false });
                record = {
                    marker,
                    vehicle,
                    route,
                    stopInfo,
                    shapeId: trip?.shapeId,
                    targetLatLng: L.latLng(position),
                    shouldAnimate: false
                };
            }
            state.vehicleRecords.set(vehicle.id, record);
        });

        // Drop markers for vehicles that disappeared from the response.
        [...state.vehicleRecords.keys()].forEach(id => {
            if (seenIds.has(id)) return;
            const record = state.vehicleRecords.get(id);
            cancelVehicleMoveAnimation(record.marker);
            vehicleLayer.removeLayer(record.marker);
            state.vehicleRecords.delete(id);
        });

        const records = [...state.vehicleRecords.values()];
        const targetOffsets = resolveVehicleOffsets(records, record => record.targetLatLng || record.marker.getLatLng());
        records.forEach((record, index) => {
            const targetOffset = targetOffsets[index];
            if (record.shouldAnimate) {
                animateVehicleTo(record, record.targetLatLng, targetOffset);
            } else {
                applyVehicleVisualOffset(record, targetOffset);
            }
            record.shouldAnimate = false;
        });
        renderDirectionLegend(route, vehicleCounts);
        setUpdated(`Last updated: ${formatTimestamp()}`);
    } catch (error) {
        if (error.name === "AbortError") return;
        if (requestId !== state.vehicleRequestId || state.selectedRouteId !== routeId) return;

        console.error("Error fetching vehicles:", error);
        setUpdated("Last updated: fetch error");
    }
}

function stopVehiclePolling() {
    if (!state.vehicleTimer) return;

    clearInterval(state.vehicleTimer);
    state.vehicleTimer = null;
}

function restartVehiclePolling() {
    stopVehiclePolling();
    state.vehicleTimer = setInterval(() => refreshVehicles(), VEHICLE_REFRESH_MS);
}

/* ====================== */
/* ==== GEOLOCATION ===== */
/* ====================== */

function initializeGeolocation() {
    setUserLocationAvailable(false);

    if (!("geolocation" in navigator)) return;

    if (state.userWatchId !== null) {
        navigator.geolocation.clearWatch(state.userWatchId);
        state.userWatchId = null;
    }

    state.userWatchId = navigator.geolocation.watchPosition(
        updateUserLocation,
        error => {
            console.log("Using default location:", error.message);
            setUserLocationAvailable(false);
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

function updateUserLocation(position) {
    const latLng = [position.coords.latitude, position.coords.longitude];
    const isFirstLocation = !state.userLocation;

    state.userLocation = latLng;
    setUserLocationAvailable(true);

    if (state.userMarker) {
        state.userMarker.setLatLng(latLng);
    } else {
        state.userMarker = L.marker(latLng, {
            icon: createUserLocationIcon(),
            interactive: false,
            zIndexOffset: 500
        }).addTo(userLayer);
    }

    if (state.followUserLocation) {
        centerMapOnUser(latLng);
    } else if (isFirstLocation && !state.hasFitRoute) {
        centerMapOnUser(latLng, 13);
    }
}

locateUserButton.addEventListener("click", () => {
    if (!state.userLocation) {
        initializeGeolocation();
        return;
    }

    if (state.followUserLocation) {
        setFollowUserLocation(false);
    } else {
        setFollowUserLocation(true);
        centerMapOnUser(state.userLocation, Math.max(map.getZoom(), 15));
    }
});

resetRouteViewButton.addEventListener("click", () => {
    setFollowUserLocation(false);
    fitCurrentRouteView({ animate: true });
});

map.on("dragstart zoomstart", () => {
    if (!state.isProgrammaticMapMove) {
        setFollowUserLocation(false);
    }
});

/* ====================== */
/* ==== INITIALIZE ====== */
/* ====================== */

routeFilter.addEventListener("change", () => {
    selectRoute(routeFilter.value, { updateUrl: true, fitRoute: true });
});

routePickerButton.addEventListener("click", event => {
    event.stopPropagation();
    setRoutePickerExpanded(!state.routePickerExpanded);
});

routePickerButton.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setRoutePickerExpanded(true);
        moveActiveRoute(event.key === "ArrowDown" ? 1 : -1);
    }
});

routeSearch.addEventListener("input", () => {
    state.routeSearchQuery = routeSearch.value;
    state.activeRouteId = state.selectedRouteId;
    renderRoutePickerOptions();

    if (!routeOptions.querySelector(".route-option.is-active")) {
        state.activeRouteId = visibleRouteIds()[0] || null;
        updateActiveRouteOption();
    }
});

routeSearch.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveActiveRoute(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
        event.preventDefault();
        chooseActiveRoute();
    } else if (event.key === "Escape") {
        setRoutePickerExpanded(false);
        routePickerButton.focus();
    }
});

routeOptions.addEventListener("click", event => {
    const option = event.target.closest(".route-option");
    if (!option) return;

    state.activeRouteId = option.dataset.routeId;
    chooseActiveRoute();
});

routeOptions.addEventListener("mousemove", event => {
    const option = event.target.closest(".route-option");
    if (!option || state.activeRouteId === option.dataset.routeId) return;

    state.activeRouteId = option.dataset.routeId;
    updateActiveRouteOption();
});

basemapToggle.addEventListener("click", event => {
    event.stopPropagation();
    setBasemapPickerExpanded(basemapOptions.hidden);
});

basemapOptionButtons.forEach(button => {
    button.addEventListener("click", event => {
        event.stopPropagation();
        setBasemap(button.dataset.basemap);
        setBasemapPickerExpanded(false);
    });
});

document.addEventListener("click", event => {
    if (!routePicker.contains(event.target)) {
        setRoutePickerExpanded(false);
    }

    if (!basemapPicker.contains(event.target)) {
        setBasemapPickerExpanded(false);
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        setRoutePickerExpanded(false);
        setBasemapPickerExpanded(false);
    }
});

// Pause vehicle polling while the tab is hidden so background tabs don't keep
// hitting the MBTA API. When the user comes back, refresh once immediately so
// they don't see stale positions, then resume the regular interval.
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopVehiclePolling();
        return;
    }
    if (state.selectedRouteId) {
        refreshVehicles();
        restartVehiclePolling();
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    try {
        updateBasemapPicker();
        setPanelExpanded(false);
        initializeGeolocation();
        await initializeRoutes();
    } catch (error) {
        console.error(error);
        routeFilter.disabled = true;
        routePickerButton.disabled = true;
        setUpdated("Last updated: fetch error");
    }
});
