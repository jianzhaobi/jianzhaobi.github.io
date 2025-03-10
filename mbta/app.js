/* ====================== */
/* ==== MAP SETTINGS ==== */
/* ====================== */

const MBTA_API_KEY = '5fb2a20d05094524a0b35961a20cf9e4'; // Your existing key
const mbtaKeyParams = `api_key=${MBTA_API_KEY}`;

// Default coordinates and zoom
const DEFAULT_LAT = 42.3601;
const DEFAULT_LON = -71.0889;
const DEFAULT_ZOOM = 12;

// Initialize map with fallback
const map = L.map('map', { zoomControl: false, doubleClickZoom: false }).setView([DEFAULT_LAT, DEFAULT_LON], DEFAULT_ZOOM);
L.control.zoom({ position: 'topright' }).addTo(map);

// Tile layer setup
L.tileLayer('https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey=74002972fcb44035b775167d6c01a6f0', {
    attribution: 'Maps © Thunderforest, Data © OpenStreetMap contributors'
}).addTo(map);
// https://tile.thunderforest.com/mobile-atlas/{z}/{x}/{y}.png?apikey=74002972fcb44035b775167d6c01a6f0
// https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=74002972fcb44035b775167d6c01a6f0
// https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey=74002972fcb44035b775167d6c01a6f0
// https://tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=74002972fcb44035b775167d6c01a6f0

/* ======================== */
/* ==== GEOLOCATION ====== */
/* ======================== */

// Geolocation handling
const getUserLocationIcon = () => L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
            <path fill="rgba(228, 0, 0, 0.7)"
                  d="M16 0c-5.523 0-10 4.477-10 10 0 10 10 22 10 22s10-12 10-22c0-5.523-4.477-10-10-10zm0 16c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z"/>
        </svg>
    `)}`,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
});

if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
        position => {
            // Update map view to user's location
            map.setView([position.coords.latitude, position.coords.longitude], 13);

            // Add user location marker
            L.marker([position.coords.latitude, position.coords.longitude], {
                icon: getUserLocationIcon(),
                zIndexOffset: 1000
            }).addTo(map).bindPopup("Your Location");
        },
        error => {
            console.log("Using default location:", error.message);
            // Keep default view
        },
        {
            timeout: 5000,
            maximumAge: 60000
        }
    );
}

/* ======================== */
/* ==== BUS TRACKING ====== */
/* ======================== */

// Bus marker and route filtering
let busMarkers = [];
const routeFilter = document.getElementById('routeFilter');

// Update the route filter options using the routes from the new API
function updateRouteFilterOptions(newRoutes) {
    // Save the current selection (route id)
    const currentSelection = routeFilter.value;

    // Define the prioritized routes in the desired order.
    const prioritizedRoutes = ["Blue", "Green-B", "Green-C", "Green-D", "Green-E", "Orange", "Red"];
    const priorityMapping = {};
    prioritizedRoutes.forEach((route, index) => {
        priorityMapping[route] = index;
    });

    // Sort the routes:
    newRoutes.sort((a, b) => {
        const aIsPriority = priorityMapping.hasOwnProperty(a.id);
        const bIsPriority = priorityMapping.hasOwnProperty(b.id);

        // Both are prioritized: sort by the fixed order.
        if (aIsPriority && bIsPriority) {
            return priorityMapping[a.id] - priorityMapping[b.id];
        }
        // One is prioritized: prioritized route comes first.
        if (aIsPriority && !bIsPriority) return -1;
        if (!aIsPriority && bIsPriority) return 1;
        // Neither is prioritized: sort alphabetically by display text.
        const displayA = (a.shortName === a.id) ? a.shortName : `${a.shortName} - ${a.id}`;
        const displayB = (b.shortName === b.id) ? b.shortName : `${b.shortName} - ${b.id}`;
        return displayA.localeCompare(displayB);
    });

    // Clear the current options and repopulate the dropdown.
    routeFilter.innerHTML = '';
    newRoutes.forEach(route => {
        const displayName = (route.shortName === route.id)
            ? route.shortName
            : `${route.shortName} - ${route.id}`;
        routeFilter.add(new Option(displayName, route.id));
    });

    // Restore the previous selection if it exists;
    // Otherwise, default to "Green-E" if available.
    if (Array.from(routeFilter.options).some(opt => opt.value === currentSelection)) {
        routeFilter.value = currentSelection;
    } else if (Array.from(routeFilter.options).some(opt => opt.value === "Green-E")) {
        routeFilter.value = "Green-E";
    }
}


function getDirectionIcon(directionId) {
    // Semi-transparent fill colors
    const fillColors = {
        0: 'rgba(0, 138, 0, 0.2)',
        1: 'rgba(0, 0, 228, 0.2)'
    };

    // Fully opaque stroke colors matching the fill colors
    const strokeColors = {
        0: 'rgba(0, 138, 0, 0.6)',
        1: 'rgba(0, 0, 228, 0.6)'
    };

    // Define the new icon size and anchor for the icon (28x28 => center is 14,14)
    const iconSize = [28, 28];
    const iconAnchor = [14, 14];

    // If no valid directionId is provided, return a yellow circle icon
    if (directionId !== 0 && directionId !== 1) {
        return L.icon({
            iconUrl: `data:image/svg+xml;base64,${btoa(`
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                    <circle cx="16" cy="16" r="14" fill="rgba(204, 204, 0, 0.2)"
                            stroke="rgba(204, 204, 0, 0.6)" stroke-width="6"/>
                </svg>
            `)}`,
            iconSize: iconSize,
            iconAnchor: iconAnchor
        });
    }

    // Otherwise, return the icon based on the provided directionId (0 or 1)
    return L.icon({
        iconUrl: `data:image/svg+xml;base64,${btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                <circle cx="16" cy="16" r="14" fill="${fillColors[directionId]}"
                        stroke="${strokeColors[directionId]}" stroke-width="6"/>
            </svg>
        `)}`,
        iconSize: iconSize,
        iconAnchor: iconAnchor
    });
}

function decodePolyline(encoded) {
    let points = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;

    while (index < len) {
        let shift = 0, result = 0;
        let byte;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        let deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += deltaLat;

        shift = 0;
        result = 0;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        let deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += deltaLng;

        points.push([lat * 1e-5, lng * 1e-5]);
    }
    return points;
}

/* ======================== */
/* ==== INITIALIZATION ==== */
/* ======================== */

// New method to get routes from MBTA API
async function getRoutes() {
    const url = `https://api-v3.mbta.com/routes?${mbtaKeyParams}`;
    try {
        const response = await fetch(url);
        const json = await response.json();
        return json.data.map(route => ({
            id: route.id,
            shortName: route.attributes.short_name || route.id,
            longName: route.attributes.long_name
        }));
    } catch (error) {
        console.error("Error fetching route data:", error);
        return [];
    }
}

async function fetchAndShowPredictions(routeId, stopId, stopMarker) {
    try {
        const response = await fetch(`https://api-v3.mbta.com/predictions?${mbtaKeyParams}&filter[route]=${routeId}&filter[stop]=${stopId}&include=trip`);
        const jsonData = await response.json();

        if (!jsonData.data || jsonData.data.length === 0) {
            stopMarker.setPopupContent(`<b>${stopMarker.options.title}</b><br>No predictions available.`).openPopup();
            return;
        }

        // Get current time in milliseconds
        const currentTime = new Date().getTime();

        // Group predictions by direction -> headsign
        let directionPredictions = { 0: {}, 1: {} };

        jsonData.data.forEach(prediction => {
            let attributes = prediction.attributes;
            let relationships = prediction.relationships;

            let directionId = attributes.direction_id;
            let arrivalTime = attributes.arrival_time ? new Date(attributes.arrival_time).getTime() : null;

            // Get headsign using trip ID
            let tripId = relationships.trip?.data?.id;
            let headsign = "Unknown";
            if (tripId && jsonData.included) {
                let tripData = jsonData.included.find(trip => trip.id === tripId);
                if (tripData && tripData.attributes.headsign) {
                    headsign = tripData.attributes.headsign;
                }
            }

            if (arrivalTime) {
                let timeDiffMin = Math.round((arrivalTime - currentTime) / 60000);

                // Exclude negative times (past arrivals)
                if (timeDiffMin >= 0) {
                    if (!directionPredictions[directionId][headsign]) {
                        directionPredictions[directionId][headsign] = [];
                    }
                    directionPredictions[directionId][headsign].push(timeDiffMin);
                }
            }
        });

        // Sort and limit predictions per headsign
        for (const directionId of [0, 1]) {
            for (const headsign in directionPredictions[directionId]) {
                directionPredictions[directionId][headsign].sort((a, b) => a - b);
                directionPredictions[directionId][headsign] = directionPredictions[directionId][headsign].slice(0, 3);
            }
        }

        // Create popup content dynamically
        let popupContent = `<b>${stopMarker.options.title}</b><br>`;

        let directionEntries = [];

        // Format predictions by direction, ensuring direction 0 appears first
        for (const directionId of [0, 1]) {
            let headsignEntries = Object.entries(directionPredictions[directionId]).map(([headsign, times]) => {
                return `<b>${headsign}:</b> ${times.join(" / ")} min`;
            });

            if (headsignEntries.length > 0) {
                directionEntries.push(headsignEntries.join("<br>"));
            }
        }

        if (directionEntries.length > 0) {
            popupContent += directionEntries.join("<br>"); 
        } else {
            popupContent += "<br>No upcoming arrivals.";
        }

        // Update stop marker popup dynamically
        stopMarker.setPopupContent(popupContent).openPopup();

    } catch (error) {
        console.error("Error fetching predictions:", error);
        stopMarker.setPopupContent(`<b>${stopMarker.options.title}</b><br>Error fetching arrival times.`).openPopup();
    }
}

async function plotRouteShape(selectedRouteId) {
    try {
        // Fetch route shape data
        const response = await fetch(`https://api-v3.mbta.com/shapes?${mbtaKeyParams}&filter[route]=${selectedRouteId}`);
        const jsonData = await response.json();

        // Remove previous route polyline if exists
        if (window.routeLayer) {
            map.removeLayer(window.routeLayer);
        }

        if (!jsonData.data || jsonData.data.length === 0) {
            console.warn(`No shape data found for route: ${selectedRouteId}`);
            return;
        }

        // Sort and decode shape segments
        jsonData.data.sort((a, b) => a.id.localeCompare(b.id));
        let allSegments = jsonData.data.map(shape => decodePolyline(shape.attributes.polyline));

        // Draw each shape segment separately to prevent incorrect connections
        let layers = allSegments.map(segment => L.polyline(segment, {
            color: 'orange',
            weight: 5,
            opacity: 0.6
        }).addTo(map));

        // Store the route polyline layers
        window.routeLayer = L.layerGroup(layers).addTo(map);

        // Fetch and plot stops
        await plotRouteStops(selectedRouteId);

        // Preserve the current map view
        const currentCenter = map.getCenter();
        const currentZoom = map.getZoom();
        map.setView(currentCenter, currentZoom);

    } catch (error) {
        console.error("Error fetching or plotting route shape:", error);
    }
}

async function plotRouteStops(selectedRouteId) {
    try {
        // Fetch stops for the selected route
        const response = await fetch(`https://api-v3.mbta.com/stops?${mbtaKeyParams}&filter[route]=${selectedRouteId}`);
        const jsonData = await response.json();

        // Remove previous stop markers if exist
        if (window.stopMarkers) {
            window.stopMarkers.forEach(marker => map.removeLayer(marker));
        }
        window.stopMarkers = [];

        if (!jsonData.data || jsonData.data.length === 0) {
            console.warn(`No stops found for route: ${selectedRouteId}`);
            return;
        }

        jsonData.data.forEach(stop => {
            const stopLat = stop.attributes.latitude;
            const stopLng = stop.attributes.longitude;
            const stopName = stop.attributes.name || "Unknown Stop";
            const stopId = stop.id;

            // Define a dark red stop icon
            const stopIcon = L.icon({
                iconUrl: `data:image/svg+xml;base64,${btoa(`
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="14" fill="rgba(139, 0, 0, 0.8)" stroke="rgba(139, 0, 0, 1)" stroke-width="6"/>
                    </svg>
                `)}`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });

            // Create a marker for the stop
            const stopMarker = L.marker([stopLat, stopLng], {
                icon: stopIcon,
                title: stopName // Use stop name as the default popup title
            }).addTo(map);

            // Bind popup and trigger fetch when clicked
            stopMarker.bindPopup(`<b>${stopName}</b><br>Loading arrival times...`).on("click", () => {
                fetchAndShowPredictions(selectedRouteId, stopId, stopMarker);
            });

            // Store marker reference
            window.stopMarkers.push(stopMarker);
        });

    } catch (error) {
        console.error("Error fetching stops:", error);
    }
}

async function initializeRoutes() {
    try {
        const currentRoutes = await getRoutes();
        updateRouteFilterOptions(currentRoutes);

        // Ensure a default route is selected
        if (!routeFilter.value && currentRoutes.length > 0) {
            routeFilter.value = currentRoutes[0].id;
        }

        // Fetch and plot the selected route shape on startup
        await plotRouteShape(routeFilter.value);

    } catch (error) {
        console.error("Error initializing routes:", error);
    }
}

async function updateBusPositions() {
    try {
        const selectedRoute = routeFilter.value;
        if (!selectedRoute) {
            console.warn("No selected route available.");
            return;
        }

        // Plot the new route shape when the route changes
        await plotRouteShape(selectedRoute);

        // Fetch vehicle positions from MBTA API (including trip details)
        const response = await fetch(`https://api-v3.mbta.com/vehicles?${mbtaKeyParams}&filter[route]=${selectedRoute}&include=trip`);
        const jsonData = await response.json();

        // Update timestamp
        document.getElementById('fetchTime').textContent = `Last Updated: ${new Date().toLocaleString("sv-SE", { timeZone: "America/New_York" })}`;

        // Remove old markers
        busMarkers.forEach(marker => map.removeLayer(marker));
        busMarkers = [];

        // Process vehicle data
        let tripLookup = new Map();
        if (jsonData.included) {
            jsonData.included.forEach(trip => {
                if (trip.type === "trip" && trip.id && trip.attributes.headsign) {
                    tripLookup.set(trip.id, trip.attributes.headsign);
                }
            });
        }

        jsonData.data.forEach(vehicleData => {
            const attributes = vehicleData.attributes;
            const relationships = vehicleData.relationships;

            const latitude = attributes.latitude;
            const longitude = attributes.longitude;
            const directionId = attributes.direction_id;
            const vehicleLabel = attributes.label || "Unknown";
            const status = attributes.current_status ? attributes.current_status.replace(/_/g, ' ') : "Unknown";
            const updatedTime = attributes.updated_at ? new Date(attributes.updated_at).toLocaleTimeString() : "Unknown";

            const routeId = relationships.route?.data?.id || "Unknown";
            if (routeId !== selectedRoute) return;

            // Get headsign from trip relationships
            const tripId = relationships.trip?.data?.id;
            const headsign = tripId && tripLookup.has(tripId) ? tripLookup.get(tripId) : "Unknown";

            const marker = L.marker([latitude, longitude], {
                icon: getDirectionIcon(directionId)
            }).addTo(map);

            const popupContent = `
                <b>${routeId} - ${vehicleLabel}</b><br>
                Destination: ${headsign}<br>
                Status: ${status}<br>
                Updated: ${updatedTime}
            `;

            marker.bindPopup(popupContent);
            busMarkers.push(marker);
        });

    } catch (error) {
        console.error('Error:', error);
        document.getElementById('fetchTime').textContent = "Last Updated: Fetch Error";
    }
}

/* ==== Load Routes Once on Page Load ==== */
initializeRoutes().then(() => updateBusPositions());

/* ==== Start Bus Position Updates Every 5 Seconds ==== */
setInterval(updateBusPositions, 5000);

/* ==== Update Bus Positions & Route Shape When Route is Manually Changed ==== */
routeFilter.addEventListener('change', updateBusPositions);