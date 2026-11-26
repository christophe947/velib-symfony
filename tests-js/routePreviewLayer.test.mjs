import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(
    new URL('../assets/maplibre/map/layers/routeLayer.js', import.meta.url),
    'utf8',
);
const markers = [];
class MarkerDouble {
    constructor(options) {
        this.options = options;
        markers.push(this);
    }

    setLngLat(position) {
        this.position = position;
        return this;
    }

    setPopup(popup) {
        this.popup = popup;
        return this;
    }

    addTo(map) {
        this.map = map;
        return this;
    }

    remove() {
        this.removed = true;
    }
}
class PopupDouble {
    constructor(options) {
        this.options = options;
    }

    setText(text) {
        this.text = text;
        return this;
    }
}
globalThis.__routeLayerMaplibre = {
    Marker: MarkerDouble,
    Popup: PopupDouble,
};
const moduleSource = source.replace(
    "import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';",
    'const maplibregl = globalThis.__routeLayerMaplibre;',
);
const {
    clearDestinationMarker,
    clearRouteLayer,
    clearRoutePreview,
    drawRoutePreviewSegments,
    drawNavigationRouteSegments,
    drawWalkingRoute,
    showDestinationMarker,
    setActiveNavigationRouteSegment,
    updateWalkingRoute,
} = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

function createMapDouble() {
    const sources = new Map();
    const layers = new Map();

    return {
        sources,
        layers,
        markers,
        getSource: (id) => sources.get(id),
        getLayer: (id) => layers.get(id),
        addSource(id, options) {
            sources.set(id, {
                data: options.data,
                setData(data) {
                    this.data = data;
                },
            });
        },
        addLayer(layer) {
            layers.set(layer.id, { ...layer, visibility: 'visible' });
        },
        setLayoutProperty(id, property, value) {
            layers.get(id)[property] = value;
        },
        removeLayer(id) {
            layers.delete(id);
        },
        removeSource(id) {
            sources.delete(id);
        },
    };
}

const segment = (mode, coords) => ({
    mode,
    geometry: coords,
    origin: { latitude: coords[0][1], longitude: coords[0][0] },
    destination: {
        latitude: coords.at(-1)[1],
        longitude: coords.at(-1)[0],
    },
});

test('un aperçu multimodal conserve chaque géométrie, son mode et son ordre dans une source', () => {
    const map = createMapDouble();
    const segments = [
        segment('pedestrian', [[2.0, 48.0], [2.01, 48.01]]),
        segment('bicycle', [[2.01, 48.01], [2.04, 48.02]]),
        segment('pedestrian', [[2.04, 48.02], [2.05, 48.03]]),
    ];

    assert.equal(drawRoutePreviewSegments(map, segments), true);

    const preview = map.sources.get('walking-route-preview').data;
    const layer = map.layers.get('walking-route-preview');

    assert.equal(preview.type, 'FeatureCollection');
    assert.deepEqual(
        preview.features.map((feature) => feature.geometry.coordinates),
        segments.map(({ geometry }) => geometry),
    );
    assert.deepEqual(
        preview.features.map(({ properties }) => properties),
        [
            { mode: 'pedestrian', segmentIndex: 0 },
            { mode: 'bicycle', segmentIndex: 1 },
            { mode: 'pedestrian', segmentIndex: 2 },
        ],
    );
    assert.deepEqual(layer.paint['line-color'], [
        'match',
        ['get', 'mode'],
        'bicycle',
        '#9250DE',
        '#198754',
    ]);
    assert.deepEqual(layer.layout['line-sort-key'], ['get', 'segmentIndex']);
});

test('les aperçus simples restent compatibles et les remplacements réutilisent la couche', () => {
    const map = createMapDouble();
    const activeCoordinates = [[2, 48], [2.01, 48.01]];
    const previewSegments = [
        segment('bicycle', [[2.01, 48.01], [2.02, 48.02]]),
    ];

    drawWalkingRoute(map, activeCoordinates, 'pedestrian');
    const activeSource = map.sources.get('walking-route');
    const previewSourceCreated = drawRoutePreviewSegments(map, previewSegments);

    assert.equal(previewSourceCreated, true);
    assert.equal(map.sources.get('walking-route'), activeSource);
    assert.deepEqual(
        activeSource.data.geometry.coordinates,
        activeCoordinates,
    );
    assert.equal(map.layers.get('walking-route').visibility, 'none');
    assert.equal(map.layers.get('walking-route-preview').visibility, 'visible');
    assert.equal(
        map.sources.get('walking-route-preview').data.features[0].properties.mode,
        'bicycle',
    );

    const previewSource = map.sources.get('walking-route-preview');
    assert.equal(
        drawRoutePreviewSegments(map, [
            segment('pedestrian', [[2.02, 48.02], [2.03, 48.03]]),
        ]),
        true,
    );
    assert.equal(map.sources.get('walking-route-preview'), previewSource);
    assert.equal(map.layers.size, 2);

    clearRoutePreview(map);
    assert.equal(map.sources.has('walking-route-preview'), false);
    assert.equal(map.layers.has('walking-route-preview'), false);
    assert.equal(map.sources.get('walking-route'), activeSource);
    assert.equal(map.layers.has('walking-route'), true);
});

test('refuse un aperçu sans tronçon ou avec un mode non pris en charge', () => {
    const map = createMapDouble();

    assert.equal(drawRoutePreviewSegments(map, []), false);
    assert.equal(
        drawRoutePreviewSegments(map, [
            segment('driving', [[2, 48], [2.1, 48.1]]),
        ]),
        false,
    );
    assert.equal(map.sources.size, 0);
    assert.equal(map.layers.size, 0);
});

test('installe les parcours actifs à un, deux ou trois segments sans fusionner leur géométrie', () => {
    for (const count of [1, 2, 3]) {
        const map = createMapDouble();
        const segments = Array.from({ length: count }, (_, index) =>
            segment(
                index % 2 === 0 ? 'pedestrian' : 'bicycle',
                [[2 + index * 0.01, 48], [2.005 + index * 0.01, 48.005]],
            ),
        );

        assert.equal(drawNavigationRouteSegments(map, segments), true);
        const route = map.sources.get('walking-route').data;
        assert.equal(route.type, 'FeatureCollection');
        assert.deepEqual(
            route.features.map((feature) => feature.geometry.coordinates),
            segments.map((value) => value.geometry),
        );
        assert.deepEqual(
            route.features.map((feature) => feature.properties.isActive),
            [true, ...Array(count - 1).fill(false)],
        );
        assert.equal(map.layers.get('walking-route').visibility, 'visible');
    }
});

test('met en évidence le segment actif et actualise sa géométrie sans toucher aux autres', () => {
    const map = createMapDouble();
    const segments = [
        segment('pedestrian', [[2, 48], [2.01, 48.01]]),
        segment('bicycle', [[2.01, 48.01], [2.03, 48.03]]),
        segment('pedestrian', [[2.03, 48.03], [2.04, 48.04]]),
    ];
    drawNavigationRouteSegments(map, segments);
    const source = map.sources.get('walking-route');
    const originalFirstGeometry = source.data.features[0].geometry;
    const originalLastGeometry = source.data.features[2].geometry;

    assert.equal(setActiveNavigationRouteSegment(map, 1), 0);
    assert.deepEqual(
        source.data.features.map((feature) => feature.properties.isActive),
        [false, true, false],
    );

    const recalculatedGeometry = [[2.015, 48.015], [2.031, 48.031]];
    assert.equal(updateWalkingRoute(map, recalculatedGeometry, 'bicycle'), true);
    assert.deepEqual(source.data.features[0].geometry, originalFirstGeometry);
    assert.deepEqual(source.data.features[1].geometry.coordinates, recalculatedGeometry);
    assert.deepEqual(source.data.features[2].geometry, originalLastGeometry);
    assert.equal(source.data.features[1].properties.mode, 'bicycle');
    assert.deepEqual(map.layers.get('walking-route').paint['line-width'], [
        'case', ['boolean', ['get', 'isActive'], true], 6, 4,
    ]);
    assert.deepEqual(map.layers.get('walking-route').paint['line-opacity'], [
        'case', ['boolean', ['get', 'isActive'], true], 0.9, 0.45,
    ]);
});

test('refuse un index invalide ou devenu obsolète et nettoie le plan actif', () => {
    const map = createMapDouble();
    drawNavigationRouteSegments(map, [
        segment('pedestrian', [[2, 48], [2.01, 48.01]]),
        segment('bicycle', [[2.01, 48.01], [2.02, 48.02]]),
    ]);
    const source = map.sources.get('walking-route');
    const previousData = source.data;

    assert.equal(setActiveNavigationRouteSegment(map, 2), false);
    assert.equal(source.data, previousData);

    drawNavigationRouteSegments(map, [
        segment('bicycle', [[3, 49], [3.01, 49.01]]),
    ]);
    const replacementData = source.data;
    assert.equal(setActiveNavigationRouteSegment(map, 1), false);
    assert.equal(source.data, replacementData);

    clearRouteLayer(map);
    assert.equal(map.sources.has('walking-route'), false);
    assert.equal(map.layers.has('walking-route'), false);
    assert.equal(setActiveNavigationRouteSegment(map, 0), false);
});

test('le marqueur final est remplacé puis nettoyé sans laisser de doublon', () => {
    const previousDocument = globalThis.document;
    globalThis.document = {
        createElement: () => ({
            append() {},
        }),
    };

    try {
        const initialMarkerCount = markers.length;
        showDestinationMarker({}, { longitude: 2, latitude: 48 });
        const firstMarker = markers.at(-1);
        showDestinationMarker({}, { longitude: 2.1, latitude: 48.1 });
        const currentMarker = markers.at(-1);

        assert.equal(firstMarker.removed, true);
        assert.equal(currentMarker.removed, undefined);
        assert.equal(markers.length, initialMarkerCount + 2);

        clearDestinationMarker();
        assert.equal(currentMarker.removed, true);

        clearDestinationMarker();
        assert.equal(currentMarker.removed, true);
    } finally {
        if (previousDocument === undefined) {
            delete globalThis.document;
        } else {
            globalThis.document = previousDocument;
        }
    }
});
