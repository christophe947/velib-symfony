import L from 'leaflet';
//import { navigation } from './navigation.js'


export function createMap() {

    const map = L.map('map');
    
        const standardLayer = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
            attribution: '© OpenStreetMap'
        }
    );

    const watercolorLayer = L.tileLayer(
        'https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg',
        {
            attribution: '© Stadia Maps © Stamen Design © OpenStreetMap',
            maxZoom: 16
        }
    );

     const labelsLayer = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
        {
            attribution: '© OpenStreetMap © CARTO',
            subdomains: 'abcd',
            maxZoom: 16
        }
    );

    //standardLayer.addTo(map);
    map.attributionControl.setPosition('topright');

    watercolorLayer.addTo(map);
    labelsLayer.addTo(map);

    /*L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
            attribution: '© OpenStreetMap'
        }
    ).addTo(map);*/


    const markersLayer =
        L.layerGroup().addTo(map);


    return {
        map,
        markersLayer,
        standardLayer,
        watercolorLayer,
        labelsLayer
    };
}