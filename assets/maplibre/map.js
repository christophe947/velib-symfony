import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';

import { stationsToGeoJSON } from './stations.js';
import { addStationLayer } from './stationLayer.js';
import {
    loadArrondissements,
    loadCommunes,
    countStationsByZone,
    filterZonesWithStations
} from './zones.js';
import { addZoneLayer } from './zoneLayer.js';
import { addCommuneLayer } from './communeLayer.js';

let destinationMarker = null;

export function createMap() {

    const map = new maplibregl.Map({
        container: 'maplibre-map',
        style: 'https://openmaptiles.data.gouv.fr/styles/osm-bright/style.json',
        center: [2.3522, 48.8566],
        zoom: 11,
        maxZoom: 18,
        minZoom: 10.5,
    });


    const stations = window.stations ?? [];


    const geoJSON = stationsToGeoJSON(stations);



    
    map.on('load', async () => {

    map.addSource('stations', {
        type: 'geojson',
        data: geoJSON
    });

    const communes = await loadCommunes();

    addCommuneLayer(
        map,
        communes
    );

    const zones = await loadArrondissements();

    const zonesWithStations = countStationsByZone(
        zones,
        window.stations ?? []
    );

    addZoneLayer(
        map,
        zonesWithStations
    );

    addStationLayer(
        map,
        'bikes'
    );
});


    return map;

}




export function drawWalkingRoute(map, coordinates) {

    const sourceId = 'walking-route';
    const layerId = 'walking-route';

    if (map.getSource(sourceId)) {
        map.removeLayer(layerId);
        map.removeSource(sourceId);
    }

    map.addSource(sourceId, {
        type: 'geojson',

        data: {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates
            }
        }
    });

    map.addLayer({
        id: layerId,
        type: 'line',

        source: sourceId,

        paint: {
            'line-color': '#198754',
            'line-width': 5,
            'line-opacity': 0.9
        }
    });
}


export function fitWalkingRoute(map, coordinates) {

    if (!coordinates?.length) {
        return;
    }

    const bounds = new maplibregl.LngLatBounds();

    coordinates.forEach(coordinate => {
        bounds.extend(coordinate);
    });

    map.fitBounds(bounds, {
        padding: {
            top: 120,
            bottom: 310,
            left: 40,
            right: 40
        },
        duration: 800,
        maxZoom: 17
    });
}


export function showDestinationMarker(map, position) {

    destinationMarker?.remove();

    const element = document.createElement('div');

    element.className = 'destination-marker';

    element.innerHTML = `
        <span>🚲</span>
    `;

    destinationMarker = new maplibregl.Marker({
        element
    })
        .setLngLat([
            position.longitude,
            position.latitude
        ])
        .setPopup(
            new maplibregl.Popup({ offset: 25 })
                .setText('Station Vélib')
        )
        .addTo(map);
}