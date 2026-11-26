import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';

const ROUTE_ID = 'walking-route';
const PREVIEW_ROUTE_ID = 'walking-route-preview';
const ROUTE_LAYER_IDS = {
    walking: ROUTE_ID,
    preview: PREVIEW_ROUTE_ID,
};

let destinationMarker = null;
let activeNavigationRouteFeatures = null;
let activeNavigationSegmentIndex = 0;

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

function createRouteFeature(
    coordinates,
    mode = 'pedestrian',
    segmentIndex = 0,
    isActive = null,
) {
    if (mode !== 'pedestrian' && mode !== 'bicycle') {
        throw new RangeError(`Unsupported route mode: ${mode}`);
    }

    const properties = { mode, segmentIndex };
    if (isActive !== null) {
        properties.isActive = isActive;
    }

    return {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates,
        },
        properties,
    };
}

function setRouteData(map, layerId, data, isPreview) {
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
            layout: {
                'line-sort-key': ['get', 'segmentIndex'],
            },
            paint: {
                'line-color': getRouteColorExpression(),
                'line-width': isPreview
                    ? 5
                    : ['case', ['boolean', ['get', 'isActive'], true], 6, 4],
                'line-opacity': isPreview
                    ? 0.8
                    : ['case', ['boolean', ['get', 'isActive'], true], 0.9, 0.45],
            },
        });
    }
}

export function drawWalkingRoute(map, coordinates, mode = 'pedestrian') {
    activeNavigationRouteFeatures = null;
    activeNavigationSegmentIndex = 0;
    setRouteData(
        map,
        ROUTE_ID,
        createRouteFeature(coordinates, mode, 0, true),
        false,
    );
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

    if (activeNavigationRouteFeatures) {
        if (activeNavigationSegmentIndex >= activeNavigationRouteFeatures.length) {
            return false;
        }

        const updatedFeatures = activeNavigationRouteFeatures.map(
            (feature, index) =>
                index === activeNavigationSegmentIndex
                    ? {
                          ...feature,
                          geometry: {
                              type: 'LineString',
                              coordinates,
                          },
                          properties: {
                              ...feature.properties,
                              mode,
                              isActive: true,
                          },
                      }
                    : feature,
        );
        source.setData({
            type: 'FeatureCollection',
            features: updatedFeatures,
        });
        activeNavigationRouteFeatures = updatedFeatures;
        return true;
    }

    source.setData({
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates,
        },
        properties: { mode, segmentIndex: 0, isActive: true },
    });

    return true;
}

/** Installs every journey segment while retaining one feature per mode/leg. */
export function drawNavigationRouteSegments(
    map,
    segments,
    activeSegmentIndex = 0,
) {
    if (
        !map ||
        !Array.isArray(segments) ||
        segments.length === 0 ||
        !Number.isInteger(activeSegmentIndex) ||
        activeSegmentIndex < 0 ||
        activeSegmentIndex >= segments.length ||
        segments.some(
            (segment) =>
                !Array.isArray(segment?.geometry) ||
                segment.geometry.length < 2 ||
                !['pedestrian', 'bicycle'].includes(segment.mode),
        )
    ) {
        return false;
    }

    activeNavigationSegmentIndex = activeSegmentIndex;
    activeNavigationRouteFeatures = segments.map((segment, segmentIndex) =>
        createRouteFeature(
            segment.geometry,
            segment.mode,
            segmentIndex,
            segmentIndex === activeSegmentIndex,
        ),
    );

    setRouteData(
        map,
        ROUTE_ID,
        {
            type: 'FeatureCollection',
            features: activeNavigationRouteFeatures,
        },
        false,
    );
    setRouteVisibility(map, 'walking');
    return true;
}

/** Returns the previous active index, or false when the update is obsolete. */
export function setActiveNavigationRouteSegment(map, segmentIndex) {
    const source = map?.getSource(ROUTE_ID);
    if (
        !source ||
        !activeNavigationRouteFeatures ||
        !Number.isInteger(segmentIndex) ||
        segmentIndex < 0 ||
        segmentIndex >= activeNavigationRouteFeatures.length
    ) {
        return false;
    }

    const previousIndex = activeNavigationSegmentIndex;
    const updatedFeatures = activeNavigationRouteFeatures.map(
        (feature, index) => ({
            ...feature,
            properties: {
                ...feature.properties,
                isActive: index === segmentIndex,
            },
        }),
    );
    source.setData({
        type: 'FeatureCollection',
        features: updatedFeatures,
    });
    activeNavigationSegmentIndex = segmentIndex;
    activeNavigationRouteFeatures = updatedFeatures;
    setRouteVisibility(map, 'walking');
    return previousIndex;
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
    setRouteData(
        map,
        PREVIEW_ROUTE_ID,
        createRouteFeature(coordinates, mode),
        true,
    );
    setRouteVisibility(map, 'preview');
}

export function drawRoutePreviewSegments(map, segments) {
    if (
        !map ||
        !Array.isArray(segments) ||
        segments.length === 0 ||
        segments.some(
            (segment) =>
                !Array.isArray(segment?.geometry) ||
                segment.geometry.length < 2 ||
                !['pedestrian', 'bicycle'].includes(segment.mode),
        )
    ) {
        return false;
    }

    const features = segments.map((segment, segmentIndex) =>
        createRouteFeature(
            segment.geometry,
            segment.mode,
            segmentIndex,
        ),
    );

    setRouteData(
        map,
        PREVIEW_ROUTE_ID,
        { type: 'FeatureCollection', features },
        true,
    );
    setRouteVisibility(map, 'preview');

    return true;
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

export function clearDestinationMarker() {
    destinationMarker?.remove();
    destinationMarker = null;
}

export function clearRouteLayer(map) {
    activeNavigationRouteFeatures = null;
    activeNavigationSegmentIndex = 0;

    if (map.getLayer(ROUTE_ID)) {
        map.removeLayer(ROUTE_ID);
    }

    if (map.getSource(ROUTE_ID)) {
        map.removeSource(ROUTE_ID);
    }

    clearDestinationMarker();
}
