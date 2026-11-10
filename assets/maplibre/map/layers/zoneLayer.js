import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';
import { zonesToPointsGeoJSON } from '../../geography/zones.js';
import { getGeometryBounds } from '../../geography/geometry.js';

export function addZoneLayer(map, zones) {
    // Délimitations des arrondissements
    map.addSource('arrondissements', {
        type: 'geojson',
        data: zones,
    });

    map.addLayer({
        id: 'arrondissement-fill',
        type: 'fill',
        source: 'arrondissements',
        maxzoom: 13,
        minzoom: 10.5,

        paint: {
            'fill-color': '#0d6efd',
            'fill-opacity': 0.065,
        },
    });

    map.addLayer({
        id: 'arrondissement-line',
        type: 'line',
        source: 'arrondissements',
        maxzoom: 13,
        minzoom: 10.5,

        paint: {
            'line-color': '#0d6efd',
            'line-width': 2,
            'line-opacity': 0.7,
        },
    });

    // Points centraux pour les compteurs
    const zonePoints = zonesToPointsGeoJSON(zones);

    map.addSource('arrondissement-points', {
        type: 'geojson',
        data: zonePoints,
    });

    map.addLayer({
        id: 'arrondissement-count-shadow',
        type: 'circle',
        source: 'arrondissement-points',
        maxzoom: 13,
        minzoom: 10.5,

        paint: {
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],

                10,
                13,
                12,
                18,
                13,
                22,
            ],
            'circle-color': '#000000',
            'circle-opacity': 0.7,
            'circle-blur': 0.6,
            'circle-translate': [0, 4],
        },
    });

    // Cercle bleu
    map.addLayer({
        id: 'arrondissement-count',
        type: 'circle',
        source: 'arrondissement-points',
        maxzoom: 13,
        minzoom: 10.5,

        paint: {
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],

                10,
                9,
                12,
                14,
                13,
                18,
            ],
            'circle-color': '#0d6efd',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
        },
    });

    // Nombre de stations
    map.addLayer({
        id: 'arrondissement-count-label',
        type: 'symbol',
        source: 'arrondissement-points',
        maxzoom: 13,
        minzoom: 10.5,

        layout: {
            'text-field': ['to-string', ['get', 'stationCount']],
            'text-size': 12,
            //'text-font': ['Open Sans Bold'],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },

        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#ffffff',
            'text-halo-width': 0.35,
            'text-halo-blur': 0,
        },
    });

    map.on('click', 'arrondissement-count', (event) => {
        const feature = event.features?.[0];

        if (!feature) {
            return;
        }

        const zoneId = feature.properties?.c_ar;

        const zone = zones.features.find(
            (zone) => zone.properties?.c_ar == zoneId,
        );

        if (!zone) {
            return;
        }

        const geometryBounds = getGeometryBounds(zone.geometry);

        if (!geometryBounds) {
            return;
        }

        const bounds = new maplibregl.LngLatBounds();
        bounds.extend([geometryBounds.minLng, geometryBounds.minLat]);
        bounds.extend([geometryBounds.maxLng, geometryBounds.maxLat]);

        map.fitBounds(bounds, {
            padding: 30,
            maxZoom: 15,
        });
    });

}
