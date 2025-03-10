// Map initialization
const map = L.map('map').setView([42.42021361, -71.054926589], 13);
let busMarkers = [];
const predefinedRoutes = new Set(['Blue', 'Green-B', 'Green-C', 'Green-D', 'Green-E', 'Orange', 'Red']);
let availableRoutes = new Set(predefinedRoutes);

// Tile layer setup
L.tileLayer('https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=74002972fcb44035b775167d6c01a6f0', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// DOM elements
const routeFilter = document.getElementById('routeFilter');

function updateRouteFilterOptions(newRoutes) {
    // Merge new routes with existing ones
    newRoutes.forEach(route => availableRoutes.add(route));

    // Get current selection
    const currentSelection = routeFilter.value;

    // Clear existing options
    routeFilter.innerHTML = '';

    // Add predefined routes first
    predefinedRoutes.forEach(route => {
        const option = new Option(route, route);
        option.className = 'predefined-route';
        routeFilter.add(option);
    });

    // Add other routes alphabetically
    Array.from(availableRoutes)
        .filter(route => !predefinedRoutes.has(route))
        .sort()
        .forEach(route => {
            routeFilter.add(new Option(route, route));
        });

    // Restore selection if still valid
    if (Array.from(routeFilter.options).some(opt => opt.value === currentSelection)) {
        routeFilter.value = currentSelection;
    }
}

// Add this function to generate direction-based icons
function getDirectionIcon(directionId) {
    const colors = {
        0: 'rgba(0, 200, 0, 0.5)',    // Green with 70% opacity
        1: 'rgba(0, 0, 200, 0.5)'  // Blue with 70% opacity
    };

    return L.icon({
        iconUrl: `data:image/svg+xml;base64,${btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                <circle cx="16" cy="16" r="14" fill="${colors[directionId]}"
                        stroke="black" stroke-width="2"/>
            </svg>
        `)}`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });
}

async function updateBusPositions() {
    try {
        // https://mbta-flask-513a6449725e.herokuapp.com/proxy
        // https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json
        const response = await fetch('https://mbta-flask-513a6449725e.herokuapp.com/proxy');
        const data = await response.json();

        // Extract unique routes from data
        const currentRoutes = [...new Set(data.entity.map(e => e.vehicle.trip.route_id))];
        updateRouteFilterOptions(currentRoutes);

        // Clear old markers
        busMarkers.forEach(marker => map.removeLayer(marker));
        busMarkers = [];

        // Get selected route
        const selectedRoute = routeFilter.value;

        data.entity.forEach(entity => {
            const vehicle = entity.vehicle;
            const trip = vehicle.trip;

            if (trip.route_id !== selectedRoute) return;

            const position = vehicle.position;
            const marker = L.marker([position.latitude, position.longitude], {
                icon: getDirectionIcon(trip.direction_id)  // Use direction-based icon
            }).addTo(map);

            const popupContent = `
                <b>${trip.route_id} - ${vehicle.vehicle.label}</b><br>
                Direction: ${trip.direction_id === 0 ? 'Inbound' : 'Outbound'}<br>
                Status: ${vehicle.current_status.replace(/_/g, ' ')}<br>
                Updated: ${new Date(vehicle.timestamp * 1000).toLocaleTimeString()}
            `;

            marker.bindPopup(popupContent);
            busMarkers.push(marker);
        });

    } catch (error) {
        console.error('Error:', error);
    }
}

// Event listeners
routeFilter.addEventListener('change', updateBusPositions);

// Initial setup
updateBusPositions();
setInterval(updateBusPositions, 5000);

// Geolocation
// Add this above the geolocation block
const getUserLocationIcon = () => L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
            <path fill="rgba(128, 0, 128, 0.7)"
                  d="M16 0c-5.523 0-10 4.477-10 10 0 10 10 22 10 22s10-12 10-22c0-5.523-4.477-10-10-10zm0 16c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z"/>
        </svg>
    `)}`,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
});

// Update the geolocation block to:
if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(position => {
        L.marker([position.coords.latitude, position.coords.longitude], {
            icon: getUserLocationIcon(),
            zIndexOffset: 1000  // Ensure it stays on top
        }).addTo(map).bindPopup("Your Location");
        map.setView([position.coords.latitude, position.coords.longitude], 13);
    });
}