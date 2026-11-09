import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';
import { getGeometryBounds } from '../../geography/geometry.js';

function communesToPointsGeoJSON(communes) {
    return {
        type: 'FeatureCollection',

        features: communes.features
            .map((commune) => {
                const center = getGeometryCenter(commune.geometry);

                if (!center) {
                    return null;
                }

                return {
                    type: 'Feature',

                    geometry: {
                        type: 'Point',
                        coordinates: center,
                    },

                    properties: {
                        ...commune.properties,
                    },
                };
            })
            .filter(Boolean),
    };
}

function getGeometryCenter(geometry) {
    const bounds = getGeometryBounds(geometry);

    if (!bounds) {
        return null;
    }

    return [
        (bounds.minLng + bounds.maxLng) / 2,
        (bounds.minLat + bounds.maxLat) / 2,
    ];
}

function toMapLibreBounds(bounds) {
    if (!bounds) {
        return null;
    }

    const mapBounds = new maplibregl.LngLatBounds();
    mapBounds.extend([bounds.minLng, bounds.minLat]);
    mapBounds.extend([bounds.maxLng, bounds.maxLat]);

    return mapBounds;
}

export function addCommuneLayer(map, communes) {
    // Délimitations des communes
    map.addSource('communes', {
        type: 'geojson',
        data: communes,
    });

    map.addLayer({
        id: 'commune-fill',
        type: 'fill',
        source: 'communes',
        maxzoom: 13,
        minzoom: 10.5,

        filter: ['!=', ['get', 'code'], '75056'],

        paint: {
            'fill-color': '#4dabf7',
            'fill-opacity': 0.07,
        },
    });

    map.addLayer({
        id: 'commune-line',
        type: 'line',
        source: 'communes',
        maxzoom: 13,
        minzoom: 10.5,

        filter: ['!=', ['get', 'code'], '75056'],

        paint: {
            'line-color': '#4dabf7',
            'line-width': 2,
            'line-opacity': 0.65,
        },
    });

    // Points centraux
    const communePoints = communesToPointsGeoJSON(communes);

    map.addSource('commune-points', {
        type: 'geojson',
        data: communePoints,
    });

    map.addLayer({
        id: 'commune-count-shadow',
        type: 'circle',
        source: 'commune-points',
        maxzoom: 13,
        minzoom: 10.5,

        filter: ['!=', ['get', 'code'], '75056'],

        paint: {
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],

                10,
                19,
                12,
                22,
                13,
                27,
            ],
            'circle-color': '#000000',
            'circle-opacity': 0.7,
            'circle-blur': 0.6,
            'circle-translate': [0, 4],
        },
    });
    // Rond bleu clair
    map.addLayer({
        id: 'commune-count',
        type: 'circle',
        source: 'commune-points',
        maxzoom: 13,
        minzoom: 10.5,

        filter: ['!=', ['get', 'code'], '75056'],

        paint: {
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],

                10,
                12,
                12,
                15,
                13,
                19,
            ],
            'circle-color': '#4dabf7',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
        },
    });

    // Nombre de stations
    map.addLayer({
        id: 'commune-count-label',
        type: 'symbol',
        source: 'commune-points',
        maxzoom: 13,
        minzoom: 10.5,

        filter: ['!=', ['get', 'code'], '75056'],

        layout: {
            'text-field': ['to-string', ['get', 'stationCount']],
            'text-size': 14,
            'text-font': ['Open Sans Bold'],
        },

        paint: {
            'text-color': '#ffffff',
        },
    });

    // Clic sur une commune
    map.on('click', 'commune-count', (event) => {
        const feature = event.features?.[0];

        if (!feature) {
            return;
        }

        const code = feature.properties?.code;

        const commune = communes.features.find(
            (commune) => commune.properties?.code == code,
        );

        if (!commune) {
            return;
        }

        // Paris → niveau arrondissements
        if (code === '75056') {
            const bounds = toMapLibreBounds(
                getGeometryBounds(commune.geometry),
            );

            if (!bounds) {
                return;
            }

            map.fitBounds(bounds, {
                padding: 30,
                maxZoom: 13,
            });

            return;
        }

        // Commune périphérique → niveau stations
        const bounds = toMapLibreBounds(
            getGeometryBounds(commune.geometry),
        );

        if (!bounds) {
            return;
        }

        map.fitBounds(bounds, {
            padding: 30,
            maxZoom: 15,
        });
    });
}
