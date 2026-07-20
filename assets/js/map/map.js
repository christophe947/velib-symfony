import L from 'leaflet';
import { navigation } from './navigation.js'


export function createMap() {

    const map = L.map('map');


    L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
            attribution: '© OpenStreetMap'
        }
    ).addTo(map);


    const markersLayer =
        L.layerGroup().addTo(map);


    return {
        map,
        markersLayer
    };
}