import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';

const ROUTE_ID = 'walking-route';
const PREVIEW_ROUTE_ID = 'walking-route-preview';
const ROUTE_LAYER_IDS = {
    walking: ROUTE_ID,
    preview: PREVIEW_ROUTE_ID,
};

let destinationMarker = null;

export function setRouteVisibility(map, visibleRoute) {
    if (!map || (visibleRoute !== null && !ROUTE_LAYER_IDS[visibleRoute])) {
        return false;
    }

    Object.entries(ROUTE_LAYER_IDS).forEach(([route, layerId]) => {
        if (map.getLayer(layerId)) {
            map.setLayoutProperty(
                layerId,
                'visibility',
                route === visibleRoute ? 'visible' : 'none',
            );
        }
    });

    return true;
}

function getRouteColorExpression() {
    return [
        'match',
        ['get', 'mode'],
        'bicycle',
        '#9250DE',
        '#198754',
    ];
}

function setRouteData(map, layerId, coordinates, isPreview, mode = 'pedestrian') {
    if (mode !== 'pedestrian' && mode !== 'bicycle') {
        throw new RangeError(`Unsupported route mode: ${mode}`);
    }

    const data = {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates,
        },
        properties: { mode },
    };
    const source = map.getSource(layerId);

    if (source) {
        source.setData(data);
    } else {
        map.addSource(layerId, {
            type: 'geojson',
            data,
        });
    }

    if (!map.getLayer(layerId)) {
        map.addLayer({
            id: layerId,
            type: 'line',
            source: layerId,
            paint: {
                'line-color': getRouteColorExpression(),
                'line-width': isPreview ? 5 : 6,
                'line-opacity': isPreview ? 0.8 : 0.9,
            },
        });
    }
}

export function drawWalkingRoute(map, coordinates, mode = 'pedestrian') {
    setRouteData(map, ROUTE_ID, coordinates, false, mode);
    setRouteVisibility(map, 'walking');
}

export function updateWalkingRoute(map, coordinates, mode = 'pedestrian') {
    const source = map.getSource(ROUTE_ID);

    if (
        !source ||
        !coordinates?.length ||
        (mode !== 'pedestrian' && mode !== 'bicycle')
    ) {
        return false;
    }

    source.setData({
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates,
        },
        properties: { mode },
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

export function drawRoutePreview(map, coordinates, mode = 'pedestrian') {
    setRouteData(map, PREVIEW_ROUTE_ID, coordinates, true, mode);
    setRouteVisibility(map, 'preview');
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
