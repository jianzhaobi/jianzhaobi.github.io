// Default coordinates and zoom
const DEFAULT_LAT = 42.3601;
const DEFAULT_LON = -71.0889;
const DEFAULT_ZOOM = 12;

// Initialize map with fallback
const map = L.map('map', { zoomControl: false, doubleClickZoom: false }).setView([DEFAULT_LAT, DEFAULT_LON], DEFAULT_ZOOM);
L.control.zoom({ position: 'topright' }).addTo(map);

// Tile layer setup
L.tileLayer('https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=74002972fcb44035b775167d6c01a6f0', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

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

// Direction

let directionsMap = new Map();

async function loadDirectionData() {
    try {
        const response = await fetch('https://jianzhaobi.github.io/mbtajs/directions.txt');
        const text = await response.text();

        // Skip header line and process each row
        text.split('\n').slice(1).forEach(line => {
            const [route_id, direction_id, direction, destination] = line.split(',').map(item => item.trim());
            if (route_id && direction_id) {
                if (!directionsMap.has(route_id)) {
                    directionsMap.set(route_id, new Map());
                }
                directionsMap.get(route_id).set(parseInt(direction_id), {
                    direction: direction,
                    destination: destination
                });
            }
        });
    } catch (error) {
        console.error('Error loading direction data:', error);
    }
}

// Rest of your original code remains unchanged below
let busMarkers = [];
const predefinedRoutes = new Set(['Blue', 'Green-B', 'Green-C', 'Green-D', 'Green-E', 'Orange', 'Red']);
let availableRoutes = new Set(predefinedRoutes);
const routeFilter = document.getElementById('routeFilter');

function updateRouteFilterOptions(newRoutes) {
    newRoutes.forEach(route => availableRoutes.add(route));
    const currentSelection = routeFilter.value;
    routeFilter.innerHTML = '';

    predefinedRoutes.forEach(route => {
        const option = new Option(route, route);
        option.className = 'predefined-route';
        routeFilter.add(option);
    });

    Array.from(availableRoutes)
        .filter(route => !predefinedRoutes.has(route))
        .sort()
        .forEach(route => {
            routeFilter.add(new Option(route, route));
        });

    if (Array.from(routeFilter.options).some(opt => opt.value === currentSelection)) {
        routeFilter.value = currentSelection;
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

    // Define the new icon size and anchor for the icon
    const iconSize = [30, 30];
    const iconAnchor = [15, 15];

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

async function updateBusPositions() {
    try {
        await loadDirectionData();
        const response = await fetch('https://mbta-flask-513a6449725e.herokuapp.com/proxy');
        const data = await response.json();

        // Update the fetch timestamp
        document.getElementById('fetchTime').textContent = `Last Updated: ${new Date().toLocaleString("sv-SE", { timeZone: "America/New_York" })}`;

        // Process the data
        const currentRoutes = [...new Set(data.entity.map(e => e.vehicle.trip.route_id))];
        updateRouteFilterOptions(currentRoutes);

        busMarkers.forEach(marker => map.removeLayer(marker));
        busMarkers = [];

        const selectedRoute = routeFilter.value;

        data.entity.forEach(entity => {
            const vehicle = entity.vehicle;
            const trip = vehicle.trip;

            if (trip.route_id !== selectedRoute) return;

            const position = vehicle.position;
            const marker = L.marker([position.latitude, position.longitude], {
                icon: getDirectionIcon(trip.direction_id)
            }).addTo(map);

            const directionInfo = directionsMap.get(trip.route_id)?.get(trip.direction_id);

            const popupContent = `
                <b>${trip.route_id} - ${vehicle.vehicle.label}</b><br>
                Direction: ${directionInfo ? directionInfo.destination : "Unknown"}<br>
                Status: ${vehicle.current_status.replace(/_/g, ' ')}<br>
                Updated: ${new Date(vehicle.timestamp * 1000).toLocaleTimeString()}
            `;

            marker.bindPopup(popupContent);
            busMarkers.push(marker);
        });

    } catch (error) {
        console.error('Error:', error);
        document.getElementById('fetchTime').textContent = "Last Updated: Fetch Error";
    }
}


routeFilter.addEventListener('change', updateBusPositions);
updateBusPositions();
setInterval(updateBusPositions, 5000);