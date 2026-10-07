import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';

import { findNearbyStations } from './nearbyStations.js';
import { renderSearchResults } from './searchResults.js';

let userMarker = null;
let userPosition = null;

export function showUserMarker(map, position) {

    userMarker?.remove();

    userMarker = new maplibregl.Marker({
        color: '#2563eb',
    })
        .setLngLat([
            position.longitude,
            position.latitude
        ])
        .setPopup(
            new maplibregl.Popup({ offset: 25 })
                .setText('Votre position')
        )
        .addTo(map);
}

export function initGeolocation({
    map,
    stations,
    results,
    input,
    onDisplayedStations,
}) {
    const button = document.getElementById('map-search-location');

    if (!button || !map || !results) {
        return;
    }

    button.addEventListener('click', () => {
        if (!navigator.geolocation) {
            results.innerHTML = `
                <div class="search-results-section-title">
                    La géolocalisation n’est pas disponible sur ce navigateur.
                </div>
            `;
            results.style.display = 'block';
            return;
        }

        button.disabled = true;

        if (input) {
            input.value = '';
            input.dispatchEvent(new Event('input'));
        }

        onDisplayedStations?.([]);

        results.innerHTML = `
            <div class="search-results-section-title">
                Recherche de votre position…
            </div>
        `;
        results.style.display = 'block';

        navigator.geolocation.getCurrentPosition(
            position => {
                button.disabled = false;

                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;

                userPosition = {
                    latitude,
                    longitude,
                };

                map.flyTo({
                    center: [longitude, latitude],
                    zoom: 15,
                });

                showUserMarker(map, {
                    latitude,
                    longitude
                });

                /*userMarker?.remove();

                userMarker = new maplibregl.Marker({
                    color: '#2563eb',
                })
                    .setLngLat([longitude, latitude])
                    .setPopup(
                        new maplibregl.Popup({ offset: 25 })
                            .setText('Votre position')
                    )
                    .addTo(map);*/

                const nearbyStations = findNearbyStations(
                    latitude,
                    longitude,
                    stations,
                    8,
                    3000
                );

                const displayedStations = renderSearchResults(
                    results,
                    [],
                    [{
                        label: 'Votre position',
                        city: '',
                        score: 1,
                        stations: nearbyStations,
                    }]
                );

                onDisplayedStations?.(displayedStations);
            },
            error => {
                button.disabled = false;

                const message = error.code === 1
                    ? 'Autorise la localisation dans ton navigateur pour voir les stations proches.'
                    : 'Ta position n’a pas pu être récupérée. Réessaie dans un instant.';

                results.innerHTML = `
                    <div class="search-results-section-title">
                        ${message}
                    </div>
                `;
                results.style.display = 'block';
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000,
            }
        );
    });
}


export function requestUserPosition() {
    return new Promise((resolve, reject) => {

        if (!navigator.geolocation) {
            reject(new Error('Geolocation unavailable'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            position => {

                userPosition = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                };

                resolve(userPosition);
            },
            error => {
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000,
            }
        );
    });
}


export function startWatchingPosition(onPosition, onError) {

    if (!navigator.geolocation) {
        onError?.(
            new Error('Geolocation unavailable')
        );
        return null;
    }

    return navigator.geolocation.watchPosition(
        position => {

            const userPosition = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };

            onPosition?.(userPosition);
        },
        error => {
            onError?.(error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 10000
        }
    );
}