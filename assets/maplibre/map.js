import * as maplibregl from '/maplibre/dist/maplibre-gl.mjs';

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