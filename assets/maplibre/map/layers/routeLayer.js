import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';

const ROUTE_ID = 'walking-route';
const PREVIEW_ROUTE_ID = 'walking-route-preview';

let destinationMarker = null;

export function drawWalkingRoute(map, coordinates) {
    if (map.getLayer(ROUTE_ID)) {
        map.removeLayer(ROUTE_ID);
    }

    if (map.getSource(ROUTE_ID)) {
        map.removeSource(ROUTE_ID);
    }

    map.addSource(ROUTE_ID, {
        type: 'geojson',

        data: {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates,
            },
            properties: {},
        },
    });

    map.addLayer({
        id: ROUTE_ID,
        type: 'line',

        source: ROUTE_ID,

        paint: {
            'line-color': '#198754',
            'line-width': 5,
            'line-opacity': 0.9,
        },
    });
}

export function updateWalkingRoute(map, coordinates) {
    const source = map.getSource(ROUTE_ID);

    if (!source || !coordinates?.length) {
        return false;
    }

    source.setData({
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates,
        },
        properties: {},
    });

    return true;
}

export function fitWalkingRoute(map, coordinates) {
    if (!coordinates?.length) {
        return;
    }

    const bounds = new maplibregl.LngLatBounds();

    coordinates.forEach((coordinate) => {
        bounds.extend(coordinate);
    });

    map.fitBounds(bounds, {
        padding: {
            top: 120,
            bottom: 310,
            left: 40,
            right: 40,
        },
        duration: 800,
        maxZoom: 17,
    });
}

export function drawRoutePreview(map, coordinates) {
    clearRoutePreview(map);

    map.addSource(PREVIEW_ROUTE_ID, {
        type: 'geojson',
        data: {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates,
            },
            properties: {},
        },
    });

    map.addLayer({
        id: PREVIEW_ROUTE_ID,
        type: 'line',
        source: PREVIEW_ROUTE_ID,
        paint: {
            'line-color': '#198754',
            'line-width': 5,
            'line-opacity': 0.8,
            'line-dasharray': [1.5, 1],
        },
    });
}

export function clearRoutePreview(map) {
    if (!map) {
        return;
    }

    if (map.getLayer(PREVIEW_ROUTE_ID)) {
        map.removeLayer(PREVIEW_ROUTE_ID);
    }

    if (map.getSource(PREVIEW_ROUTE_ID)) {
        map.removeSource(PREVIEW_ROUTE_ID);
    }
}

export function showDestinationMarker(
    map,
    position,
    { icon = '🚲', label = 'Station Vélib' } = {},
) {
    destinationMarker?.remove();

    const element = document.createElement('div');

    element.className = 'destination-marker';

    const iconElement = document.createElement('span');
    iconElement.textContent = icon;
    element.append(iconElement);

    destinationMarker = new maplibregl.Marker({
        element,
    })
        .setLngLat([position.longitude, position.latitude])
        .setPopup(new maplibregl.Popup({ offset: 25 }).setText(label))
        .addTo(map);
}

export function clearRouteLayer(map) {
    if (map.getLayer(ROUTE_ID)) {
        map.removeLayer(ROUTE_ID);
    }

    if (map.getSource(ROUTE_ID)) {
        map.removeSource(ROUTE_ID);
    }

    destinationMarker?.remove();
    destinationMarker = null;
}
