import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';
import { zonesToPointsGeoJSON } from './zones.js';

export function addZoneLayer(
    map,
    zones
) {
    // Délimitations des arrondissements
    map.addSource('arrondissements', {
        type: 'geojson',
        data: zones
    });

    map.addLayer({
        id: 'arrondissement-fill',
        type: 'fill',
        source: 'arrondissements',
        maxzoom: 13,
        minzoom: 10.5,

        paint: {
            'fill-color': '#0d6efd',
            'fill-opacity': 0.08
        }
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
            'line-opacity': 0.7
        }
    });

    // Points centraux pour les compteurs
    const zonePoints = zonesToPointsGeoJSON(zones);

    map.addSource('arrondissement-points', {
        type: 'geojson',
        data: zonePoints
    });

    // Cercle bleu
    map.addLayer({
        id: 'arrondissement-count',
        type: 'circle',
        source: 'arrondissement-points',
        maxzoom: 13,
        minzoom: 10.5,

        paint: {
            'circle-radius': 22,
            'circle-color': '#0d6efd',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff'
        }
    });

    // Nombre de stations
    map.addLayer({
        id: 'arrondissement-count-label',
        type: 'symbol',
        source: 'arrondissement-points',
        maxzoom: 13,
        minzoom: 10.5,

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




    map.on('click', 'arrondissement-count', event => {

    const feature = event.features?.[0];

    if (!feature) {
        return;
    }

    const zoneId = feature.properties?.c_ar;

    const zone = zones.features.find(
        zone => zone.properties?.c_ar == zoneId
    );

    if (!zone) {
        return;
    }

    const bounds = getGeometryBounds(
        zone.geometry
    );

    if (!bounds) {
        return;
    }

    map.fitBounds(
        bounds,
        {
            padding: 60,
            maxZoom: 15
        }
    );
});





function getGeometryBounds(geometry) {

    if (!geometry) {
        return null;
    }

    const bounds = new maplibregl.LngLatBounds();

    function extendCoordinates(coordinates) {

        if (
            typeof coordinates[0] === 'number'
        ) {
            bounds.extend(coordinates);
            return;
        }

        coordinates.forEach(
            extendCoordinates
        );
    }

    extendCoordinates(
        geometry.coordinates
    );

    return bounds;
}





}