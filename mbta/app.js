/* ====================== */
/* ==== CONFIGURATION === */
/* ====================== */

const MBTA_API_BASE = "https://api-v3.mbta.com";
const MBTA_API_KEY = "5fb2a20d05094524a0b35961a20cf9e4"; // Set to "" to use keyless MBTA requests.
const VEHICLE_REFRESH_MS = 5000;

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

const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const ESRI_ATTRIBUTION = "Tiles &copy; Esri - Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const DEFAULT_BASEMAP = "light";
const VEHICLE_OFFSET_PX = 22;
const VEHICLE_ICON_SIZE = 116;
const VEHICLE_MARKER_RADIUS_PX = 10;
const VEHICLE_COLLISION_PADDING_PX = 6;
const VEHICLE_COLLISION_ITERATIONS = 9;
const VEHICLE_MAX_COLLISION_SHIFT_PX = 44;
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

const routeFilter = document.getElementById("routeFilter");
const basemapPicker = document.getElementById("basemapPicker");
const basemapToggle = document.getElementById("basemapToggle");
const basemapOptions = document.getElementById("basemapOptions");
const basemapOptionButtons = [...document.querySelectorAll(".basemap-option")];
const fetchTime = document.getElementById("fetchTime");
const directionLegend = document.getElementById("directionLegend");
const locateUserButton = document.getElementById("locateUser");
const alertBox = document.getElementById("routeAlert");
const toggleAlertButton = document.getElementById("toggleAlert");
const panelToggleButton = document.getElementById("panelToggle");
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
    stops: new Map(),
    panelExpanded: false,
    currentBasemap: DEFAULT_BASEMAP,
    vehicleRecords: [],
    vehicleLayoutTimer: null
};

/* ====================== */
/* ======= MAP ========== */
/* ====================== */

const map = L.map("map", {
    zoomControl: false,
    doubleClickZoom: false
}).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

L.control.zoom({ position: "topright" }).addTo(map);

let basemapLayer = createBasemapLayer(DEFAULT_BASEMAP).addTo(map);

const routeLayer = L.featureGroup().addTo(map);
const stopLayer = L.layerGroup().addTo(map);
const vehicleLayer = L.layerGroup().addTo(map);
const userLayer = L.layerGroup().addTo(map);

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

function directionColor(route, directionId) {
    const base = routeColor(route);
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

function setUpdated(message) {
    fetchTime.textContent = message;
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
    if (!value) return "Unknown";
    return new Date(value).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit"
    });
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

async function fetchMbta(path, params = {}) {
    const options = MBTA_API_KEY ? { headers: { "x-api-key": MBTA_API_KEY } } : {};
    let response = await fetch(buildMbtaUrl(path, params), options);
    if (response.status === 429 || response.status >= 500) {
        await new Promise(resolve => setTimeout(resolve, 800));
        response = await fetch(buildMbtaUrl(path, params), options);
    }

    if (!response.ok) {
        throw new Error(`MBTA request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function displayRouteName(route) {
    if (!route) return "Unknown route";
    if (route.shortName && route.longName && route.shortName !== route.longName) {
        return `${route.shortName} - ${route.longName}`;
    }
    return route.longName || route.shortName || route.id;
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

    if (!directionIds.length) {
        directionLegend.hidden = true;
        directionLegend.innerHTML = "";
        return;
    }

    directionLegend.innerHTML = directionIds.map(directionId => `
        <div class="direction-row">
            <span class="direction-chip direction-${directionId}" style="--direction-color: ${vehicleDirectionColor(route, directionId)}" aria-hidden="true"></span>
            <span class="direction-text">${escapeHtml(directionLabel(route, directionId))}${Number.isFinite(vehicleCounts[directionId]) ? ` · ${vehicleCounts[directionId]}` : ""}</span>
        </div>
    `).join("");
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
    window.history.pushState({}, "", currentURL);
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

function vehicleStopInfo(vehicle) {
    const attributes = vehicle.attributes || {};
    const lat = attributes.latitude;
    const lng = attributes.longitude;
    const status = attributes.current_status;
    const relationshipStopId = vehicle.relationships?.stop?.data?.id;
    const relatedStop = relationshipStopId ? state.stops.get(relationshipStopId) : null;

    if (relatedStop && status === "STOPPED_AT") {
        return { kind: "at", stop: relatedStop };
    }
    if (relatedStop) {
        return { kind: "near", stop: relatedStop };
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    const nearest = nearestRenderedStop(lat, lng, status === "STOPPED_AT" ? 45 : 26);
    if (!nearest) return null;

    return {
        kind: status === "STOPPED_AT" || nearest.distance <= 12 ? "at" : "near",
        stop: nearest.stop,
        distance: nearest.distance
    };
}

async function getRepresentativeShapeIds(routeId) {
    const json = await fetchMbta("/route_patterns", {
        "filter[route]": routeId,
        include: "representative_trip"
    });

    const trips = new Map((json.included || [])
        .filter(item => item.type === "trip")
        .map(trip => [trip.id, trip]));

    const patterns = json.data || [];
    const typicalPatterns = patterns.filter(pattern => pattern.attributes?.typicality === 1);
    const canonicalPatterns = patterns.filter(pattern => pattern.attributes?.canonical);
    const selectedPatterns = typicalPatterns.length
        ? typicalPatterns
        : (canonicalPatterns.length ? canonicalPatterns : patterns);

    const shapeIds = selectedPatterns
        .map(pattern => {
            const tripId = pattern.relationships?.representative_trip?.data?.id;
            return trips.get(tripId)?.relationships?.shape?.data?.id;
        })
        .filter(Boolean);

    return [...new Set(shapeIds)];
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

function vehicleOffsetForDirection(bearing, directionId) {
    if (directionId !== 0 && directionId !== 1) {
        return { x: 0, y: -VEHICLE_OFFSET_PX };
    }

    const radians = bearing * Math.PI / 180;
    return {
        x: Math.round(Math.cos(radians) * VEHICLE_OFFSET_PX),
        y: Math.round(Math.sin(radians) * VEHICLE_OFFSET_PX)
    };
}

function clampVehicleOffset(offset, baseOffset) {
    const shiftX = offset.x - baseOffset.x;
    const shiftY = offset.y - baseOffset.y;
    const shiftDistance = Math.hypot(shiftX, shiftY);

    if (shiftDistance <= VEHICLE_MAX_COLLISION_SHIFT_PX || shiftDistance === 0) {
        return offset;
    }

    const scale = VEHICLE_MAX_COLLISION_SHIFT_PX / shiftDistance;
    return {
        x: baseOffset.x + shiftX * scale,
        y: baseOffset.y + shiftY * scale
    };
}

function resolveVehicleOffsets(records) {
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
            const anchor = map.latLngToLayerPoint([attributes.latitude, attributes.longitude]);
            const baseOffset = vehicleOffsetForDirection(
                Number.isFinite(attributes.bearing) ? attributes.bearing : 0,
                attributes.direction_id
            );

            return {
                index,
                anchor,
                baseOffset,
                offset: { ...baseOffset },
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
                let dx = bx - ax;
                let dy = by - ay;
                let distance = Math.hypot(dx, dy);

                if (distance >= minDistance) continue;

                if (distance < 0.1) {
                    const angle = ((a.index + b.index + iteration) * 137.508) * Math.PI / 180;
                    dx = Math.cos(angle);
                    dy = Math.sin(angle);
                    distance = 1;
                }

                const push = (minDistance - distance) / 2;
                const nx = dx / distance;
                const ny = dy / distance;

                a.offset = clampVehicleOffset({
                    x: a.offset.x - nx * push,
                    y: a.offset.y - ny * push
                }, a.baseOffset);
                b.offset = clampVehicleOffset({
                    x: b.offset.x + nx * push,
                    y: b.offset.y + ny * push
                }, b.baseOffset);
                moved = true;
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
                const nx = dx / distance;
                const ny = dy / distance;

                item.offset = clampVehicleOffset({
                    x: item.offset.x + nx * push,
                    y: item.offset.y + ny * push
                }, item.baseOffset);
                moved = true;
            });
        });

        if (!moved) break;
    }

    return layoutItems.map(item => ({
        x: Math.round(item.offset.x),
        y: Math.round(item.offset.y)
    }));
}

function createVehicleIcon(vehicle, route, stopInfo, offset = null) {
    const directionId = vehicle.attributes.direction_id;
    const directionClass = directionId === 0 || directionId === 1 ? `direction-${directionId}` : "direction-unknown";
    const bearing = Number.isFinite(vehicle.attributes.bearing) ? vehicle.attributes.bearing : 0;
    const stopClass = stopInfo ? (stopInfo.kind === "at" ? "at-stop" : "near-stop") : "";
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
            <div class="vehicle-offset-marker ${directionClass} ${stopClass}"
                 style="--vehicle-color: ${markerAccent}; --vehicle-x: ${visualOffset.x}px; --vehicle-y: ${visualOffset.y}px;">
                <svg class="vehicle-leader" viewBox="0 0 ${VEHICLE_ICON_SIZE} ${VEHICLE_ICON_SIZE}" aria-hidden="true" focusable="false">
                    <line x1="${center}" y1="${center}" x2="${leaderEndX}" y2="${leaderEndY}"></line>
                    <circle cx="${center}" cy="${center}" r="3"></circle>
                </svg>
                <span class="vehicle-marker" aria-hidden="true"></span>
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

function applyVehicleLayout() {
    if (!state.vehicleRecords.length) return;

    const offsets = resolveVehicleOffsets(state.vehicleRecords);
    state.vehicleRecords.forEach((record, index) => {
        record.marker.setIcon(createVehicleIcon(record.vehicle, record.route, record.stopInfo, offsets[index]));
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

    state.routes = new Map(routes.map(route => [route.id, route]));
    routeFilter.innerHTML = "";
    routes.forEach(route => {
        routeFilter.add(new Option(displayRouteName(route), route.id));
    });

    routeFilter.disabled = false;
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
    await selectRoute(initialRoute, { updateUrl: false, fitRoute: true });
}

async function selectRoute(routeId, options = {}) {
    const route = state.routes.get(routeId);
    if (!route) return;

    state.selectedRouteId = routeId;
    state.routeRequestId += 1;
    state.hasFitRoute = false;
    const requestId = state.routeRequestId;

    setRouteTheme(route);
    renderDirectionLegend(route);
    setUpdated(`Loading ${displayRouteName(route)}...`);
    clearMapForRouteChange();
    hideAlerts();

    if (options.updateUrl !== false) {
        updateURLWithRoute(routeId);
    }

    try {
        await renderRouteShape(routeId, route, requestId, options.fitRoute !== false);
        await renderRouteStops(routeId, route, requestId);
        await renderAlerts(routeId, requestId);

        if (!isCurrentRoute(routeId, requestId)) return;

        await refreshVehicles(routeId);
        restartVehiclePolling();
    } catch (error) {
        if (!isCurrentRoute(routeId, requestId)) return;
        console.error(error);
        setUpdated("Unable to load route data");
    }
}

function isCurrentRoute(routeId, requestId = state.routeRequestId) {
    return state.selectedRouteId === routeId && state.routeRequestId === requestId;
}

function clearMapForRouteChange() {
    routeLayer.clearLayers();
    stopLayer.clearLayers();
    vehicleLayer.clearLayers();
    state.vehicleRecords = [];
    state.stops.clear();
}

/* ====================== */
/* ======== SHAPES ====== */
/* ====================== */

async function renderRouteShape(routeId, route, requestId, shouldFit) {
    const [json, representativeShapeIds] = await Promise.all([
        fetchMbta("/shapes", { "filter[route]": routeId }),
        getRepresentativeShapeIds(routeId).catch(error => {
            console.warn(`Unable to load representative route patterns for ${routeId}:`, error);
            return [];
        })
    ]);
    if (!isCurrentRoute(routeId, requestId)) return;

    routeLayer.clearLayers();

    if (!json.data?.length) {
        console.warn(`No shape data found for route: ${routeId}`);
        return;
    }

    const representativeShapeSet = new Set(representativeShapeIds);
    const representativeShapes = json.data.filter(shape => representativeShapeSet.has(shape.id));
    const shapes = representativeShapes.length ? representativeShapes : json.data;

    shapes.forEach(shape => {
        const segment = decodePolyline(shape.attributes.polyline || "");
        if (!segment.length) return;

        L.polyline(segment, {
            color: routeColor(route),
            weight: 5,
            opacity: 0.82,
            lineCap: "round",
            lineJoin: "round"
        }).addTo(routeLayer);
    });

    if (shouldFit && routeLayer.getLayers().length) {
        map.fitBounds(routeLayer.getBounds(), {
            paddingTopLeft: [24, 155],
            paddingBottomRight: [24, 24],
            maxZoom: 15
        });
        state.hasFitRoute = true;
    }
}

/* ====================== */
/* ======== STOPS ======= */
/* ====================== */

async function renderRouteStops(routeId, route, requestId) {
    const json = await fetchMbta("/stops", { "filter[route]": routeId });
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

        marker.bindPopup(stopPopup(stopName, "Loading arrivals..."));
        marker.on("click", () => {
            renderPredictions(routeId, stop.id, marker);
        });
    });
}

function stopPopup(stopName, body) {
    return `
        <span class="popup-title">${escapeHtml(stopName)}</span>
        <span>${body}</span>
    `;
}

async function renderPredictions(routeId, stopId, stopMarker) {
    const route = state.routes.get(routeId);
    stopMarker.setPopupContent(stopPopup(stopMarker.options.title, "Loading arrivals...")).openPopup();

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
            if (!arrivalOrDeparture) return;

            const minutes = Math.round((new Date(arrivalOrDeparture).getTime() - now) / 60000);
            if (minutes < 0) return;

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
            .sort((a, b) => a.directionId - b.directionId || a.headsign.localeCompare(b.headsign))
            .map(group => {
                const times = group.minutes.sort((a, b) => a - b).slice(0, 3);
                const label = route?.directionNames?.[group.directionId] || `Direction ${group.directionId}`;
                return `<b>${escapeHtml(label)} to ${escapeHtml(group.headsign)}:</b> ${times.join(" / ")} min`;
            });

        const content = rows.length
            ? rows.join("<br>")
            : '<span class="popup-muted">No upcoming arrivals.</span>';

        stopMarker.setPopupContent(stopPopup(stopMarker.options.title, content)).openPopup();
    } catch (error) {
        console.error("Error fetching predictions:", error);
        stopMarker.setPopupContent(stopPopup(stopMarker.options.title, "Unable to load arrivals.")).openPopup();
    }
}

/* ====================== */
/* ======= ALERTS ======= */
/* ====================== */

async function renderAlerts(routeId, requestId) {
    try {
        const json = await fetchMbta("/alerts", { "filter[route]": routeId });
        if (!isCurrentRoute(routeId, requestId)) return;

        const alerts = (json.data || [])
            .filter(alert => alert.attributes?.header)
            .sort((a, b) => {
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
    } catch (error) {
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

async function refreshVehicles(routeId = state.selectedRouteId) {
    if (!routeId) return;

    const requestId = ++state.vehicleRequestId;
    const route = state.routes.get(routeId);

    try {
        const json = await fetchMbta("/vehicles", {
            "filter[route]": routeId,
            include: "trip"
        });

        if (requestId !== state.vehicleRequestId || state.selectedRouteId !== routeId) return;

        const tripLookup = new Map((json.included || [])
            .filter(item => item.type === "trip")
            .map(trip => [trip.id, trip.attributes.headsign]));

        vehicleLayer.clearLayers();
        state.vehicleRecords = [];

        const vehicles = (json.data || []).filter(vehicle => {
            const lat = vehicle.attributes?.latitude;
            const lng = vehicle.attributes?.longitude;
            return Number.isFinite(lat) && Number.isFinite(lng);
        });
        const vehicleCounts = { 0: 0, 1: 0 };

        vehicles.forEach(vehicle => {
            const attributes = vehicle.attributes;
            const position = [attributes.latitude, attributes.longitude];
            const tripId = vehicle.relationships?.trip?.data?.id;
            const directionId = attributes.direction_id;
            if (directionId === 0 || directionId === 1) {
                vehicleCounts[directionId] += 1;
            }
            const stopInfo = vehicleStopInfo(vehicle);
            const marker = L.marker(position, {
                icon: createVehicleIcon(vehicle, route, stopInfo),
                zIndexOffset: stopInfo ? 1200 : 1000
            }).addTo(vehicleLayer);
            state.vehicleRecords.push({ marker, vehicle, route, stopInfo });

            const headsign = tripLookup.get(tripId)
                || route?.directionDestinations?.[directionId]
                || "Unknown destination";
            const status = attributes.current_status
                ? attributes.current_status.replace(/_/g, " ").toLowerCase()
                : "unknown";
            const label = attributes.label || vehicle.id || "Unknown vehicle";
            const direction = directionId === 0 || directionId === 1
                ? directionLabel(route, directionId)
                : "Unknown direction";
            const stopLine = stopInfo
                ? `${stopInfo.kind === "at" ? "At stop" : "Near stop"}: ${escapeHtml(stopInfo.stop.name)}<br>`
                : "";

            marker.bindPopup(`
                <span class="popup-title">${escapeHtml(routeId)} - ${escapeHtml(label)}</span>
                Direction: ${escapeHtml(direction)}<br>
                Destination: ${escapeHtml(headsign)}<br>
                ${stopLine}
                Status: ${escapeHtml(status)}<br>
                Updated: ${escapeHtml(formatTime(attributes.updated_at))}
            `);
        });

        applyVehicleLayout();
        renderDirectionLegend(route, vehicleCounts);
        setUpdated(`Last updated: ${formatTimestamp()}${vehicles.length ? "" : " - no vehicles in service"}`);
    } catch (error) {
        console.error("Error fetching vehicles:", error);
        setUpdated("Last updated: fetch error");
    }
}

function restartVehiclePolling() {
    if (state.vehicleTimer) {
        clearInterval(state.vehicleTimer);
    }
    state.vehicleTimer = setInterval(() => refreshVehicles(), VEHICLE_REFRESH_MS);
}

/* ====================== */
/* ==== GEOLOCATION ===== */
/* ====================== */

function initializeGeolocation() {
    if (!("geolocation" in navigator)) return;

    navigator.geolocation.getCurrentPosition(
        position => {
            const latLng = [position.coords.latitude, position.coords.longitude];
            state.userLocation = latLng;
            userLayer.clearLayers();
            state.userMarker = L.marker(latLng, {
                icon: createUserLocationIcon(),
                zIndexOffset: 500
            }).addTo(userLayer).bindPopup('<span class="popup-title">Your location</span>');
            locateUserButton.hidden = false;

            if (!state.hasFitRoute) {
                map.setView(latLng, 13);
            }
        },
        error => {
            console.log("Using default location:", error.message);
        },
        {
            timeout: 5000,
            maximumAge: 60000
        }
    );
}

locateUserButton.addEventListener("click", () => {
    if (!state.userLocation) return;

    map.setView(state.userLocation, 15);
    if (state.userMarker) {
        state.userMarker.openPopup();
    }
});

/* ====================== */
/* ==== INITIALIZE ====== */
/* ====================== */

routeFilter.addEventListener("change", () => {
    selectRoute(routeFilter.value, { updateUrl: true, fitRoute: true });
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
    if (!basemapPicker.contains(event.target)) {
        setBasemapPickerExpanded(false);
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        setBasemapPickerExpanded(false);
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
        setUpdated("Last updated: fetch error");
    }
});
