import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';

function communesToPointsGeoJSON(communes) {
    return {
        type: 'FeatureCollection',

        features: communes.features.map(commune => ({
            type: 'Feature',

            geometry: {
                type: 'Point',
                coordinates: getGeometryCenter(
                    commune.geometry
                )
            },

            properties: {
                ...commune.properties
            }
        }))
    };
}

function getGeometryCenter(geometry) {
    const coordinates = [];

    function collectCoordinates(coords) {
        if (typeof coords[0] === 'number') {
            coordinates.push(coords);
            return;
        }

        coords.forEach(collectCoordinates);
    }

    collectCoordinates(geometry.coordinates);

    let minLng = coordinates[0][0];
    let maxLng = coordinates[0][0];
    let minLat = coordinates[0][1];
    let maxLat = coordinates[0][1];

    coordinates.forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    });

    return [
        (minLng + maxLng) / 2,
        (minLat + maxLat) / 2
    ];
}

function getGeometryBounds(geometry) {
    const bounds = new maplibregl.LngLatBounds();

    function extendCoordinates(coords) {
        if (typeof coords[0] === 'number') {
            bounds.extend(coords);
            return;
        }

        coords.forEach(extendCoordinates);
    }

    extendCoordinates(geometry.coordinates);

    return bounds;
}

export function addCommuneLayer(
    map,
    communes
) {
    // Délimitations des communes
    map.addSource('communes', {
        type: 'geojson',
        data: communes
    });

    map.addLayer({
        id: 'commune-fill',
        type: 'fill',
        source: 'communes',
        maxzoom: 13,
        minzoom: 10.5,

        filter: [
            '!=',
            ['get', 'code'],
            '75056'
        ],


        paint: {
            'fill-color': '#4dabf7',
            'fill-opacity': 0.07
        }
    });

    map.addLayer({
        id: 'commune-line',
        type: 'line',
        source: 'communes',
        maxzoom: 13,
        minzoom: 10.5,

        filter: [
            '!=',
            ['get', 'code'],
            '75056'
        ],


        paint: {
            'line-color': '#4dabf7',
            'line-width': 2,
            'line-opacity': 0.65
        }
    });

    // Points centraux
    const communePoints = communesToPointsGeoJSON(
        communes
    );

    map.addSource('commune-points', {
        type: 'geojson',
        data: communePoints
    });

    // Rond bleu clair
    map.addLayer({
        id: 'commune-count',
        type: 'circle',
        source: 'commune-points',
        maxzoom: 13,
        minzoom: 10.5,

        filter: [
            '!=',
            ['get', 'code'],
            '75056'
        ],


        paint: {
            'circle-radius': 22,
            'circle-color': '#4dabf7',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff'
        }
    });

    // Nombre de stations
    map.addLayer({
        id: 'commune-count-label',
        type: 'symbol',
        source: 'commune-points',
        maxzoom: 13,
        minzoom: 10.5,

        filter: [
            '!=',
            ['get', 'code'],
            '75056'
        ],


        layout: {
            'text-field': [
                'to-string',
                ['get', 'stationCount']
            ],
            'text-size': 14,
            'text-font': [
                'Open Sans Bold'
            ]
        },

        paint: {
            'text-color': '#ffffff'
        }
    });

    // Clic sur une commune
    map.on('click', 'commune-count', event => {

        const feature = event.features?.[0];

        if (!feature) {
            return;
        }

        const code = feature.properties?.code;

        const commune = communes.features.find(
            commune =>
                commune.properties?.code == code
        );

        if (!commune) {
            return;
        }

        // Paris → niveau arrondissements
        if (code === '75056') {

            const bounds = getGeometryBounds(
                commune.geometry
            );
            

            map.fitBounds(
                bounds,
                {
                    padding: 60,
                    maxZoom: 13
                }
            );

            return;
        }

        // Commune périphérique → niveau stations
        const bounds = getGeometryBounds(
            commune.geometry
        );

        map.fitBounds(
            bounds,
            {
                padding: 60,
                maxZoom: 15
            }
        );
    });
}