import {
    getAvailableValue,
    getAvailabilityColor
} from './availability.js';


const stationMarkers = new Map();


export function createStationMarker(
    map,
    MarkerClass,
    station,
    displayMode = 'bikes'
) {

    const markerElement = document.createElement('div');

    const available = getAvailableValue(
        station,
        displayMode
    );

    const color = getAvailabilityColor(
        station,
        displayMode
    );

    markerElement.className = 'velib-marker';
    markerElement.textContent = available;
    markerElement.style.background = color;

    const marker = new MarkerClass({
        element: markerElement
    })
        .setLngLat([
            station.longitude,
            station.latitude
        ])
        .addTo(map);

    stationMarkers.set(
        station.id,
        marker
    );

    return marker;
}


export function renderMarkers(
    map,
    MarkerClass,
    stations,
    displayMode = 'bikes'
) {

    stationMarkers.forEach(marker => {
        marker.remove();
    });

    stationMarkers.clear();

    stations.forEach(station => {

        createStationMarker(
            map,
            MarkerClass,
            station,
            displayMode
        );

    });
}