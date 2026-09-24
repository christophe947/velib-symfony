import Fuse from '/maplibre-assets/fuse.mjs';

import {
    filterSearchResults
} from './searchResults.js';

import {
    loadArrondissements,
    countStationsByZone,
    findZoneByQuery,
    getStationsForZone
} from './zones.js';

import { getAvailabilityColor } from './availability.js';

import {
    searchNearbyStations
} from './locationSearch.js';


function looksLikeAddress(query) {

    return /^\d+\s+/.test(
        query.trim()
    );
}

export async function initSearch() {

    const input = document.getElementById(
        'map-search-input'
    );

    const results = document.getElementById(
        'map-search-results'
    );

    if (!input || !results) {
        return;
    }

    const stations = window.stations ?? [];

    let searchTimeout = null;

    const zones = await loadArrondissements();

    const zonesWithStations = countStationsByZone(
        zones,
        stations
    );

    const fuse = new Fuse(
        stations,
        {
            keys: [
                'name',
                'address'
            ],

            threshold: 0.35
        }
    );

    input.addEventListener('input', () => {

        clearTimeout(searchTimeout);

        searchTimeout = setTimeout(async () => {

            const query = input.value.trim();

            if (!query) {
                results.innerHTML = '';
                results.style.display = 'none';

                return;
            }

            // ---------------------------------
            // Recherche par arrondissement
            // ---------------------------------

            const zone = findZoneByQuery(
                zonesWithStations,
                query
            );

            if (zone) {

                const stationsInZone =
                    getStationsForZone(
                        zone,
                        stations
                    );

                const stationCount =
                    stationsInZone.length;

                const stationResults =
                    stationsInZone
                        .map((station, index) => {

                            const availabilityColor =
                                getAvailabilityColor(
                                    station,
                                    'bikes'
                                );

                            return `
                                <div
                                    class="search-result search-zone-station"
                                    data-station-index="${index}"
                                >
                                    <div
                                        class="search-zone-station-main"
                                    >

                                        <span
                                            class="search-availability-dot search-availability-${availabilityColor}"
                                        ></span>

                                        <strong>
                                            ${station.name}
                                        </strong>

                                        <span
                                            class="search-zone-station-count"
                                        >
                                            ${station.bikes ?? 0}
                                        </span>

                                    </div>

                                    <small>
                                        ${station.address ?? ''}
                                    </small>
                                </div>
                            `;
                        })
                        .join('');

                results.innerHTML = `
                    <div class="search-result search-zone-result">
                        <strong>
                            📍 ${zone.properties?.l_ar}
                        </strong>

                        <small>
                            Arrondissement · ${stationCount} stations Vélib'
                        </small>
                    </div>

                    <div class="search-zone-stations">
                        ${stationResults}
                    </div>
                `;

                results.style.display = 'block';

                results
                    .querySelectorAll('.search-zone-station')
                    .forEach(resultElement => {

                        resultElement.addEventListener(
                            'click',
                            () => {

                                const index = Number(
                                    resultElement.dataset.stationIndex
                                );

                                const station =
                                    stationsInZone[index];

                                if (!station) {
                                    return;
                                }

                                results.innerHTML = '';
                                results.style.display = 'none';

                                document.dispatchEvent(
                                    new CustomEvent(
                                        'station:selected',
                                        {
                                            detail: station
                                        }
                                    )
                                );
                            }
                        );
                    });

                return;
            }

            // ---------------------------------
            // Recherche directe de stations
            // ---------------------------------

            const isAddress = looksLikeAddress(query);

            let directStations = [];

            if (!isAddress) {

                const matches =
                    fuse.search(query);

                const filteredMatches =
                    filterSearchResults(
                        matches,
                        query
                    );

                directStations =
                    filteredMatches
                        .slice(0, 8)
                        .map(result => result.item);
            }

            // ---------------------------------
            // Recherche autour d'une adresse
            // ou d'un lieu
            // ---------------------------------

            const nearbyStations =
                await searchNearbyStations(
                    query,
                    stations
                );


            // ---------------------------------
            // Suppression des doublons
            // ---------------------------------

            const directStationIds =
                new Set(
                    directStations.map(
                        station => String(station.id)
                    )
                );

            const nearbyOnly =
                nearbyStations.filter(
                    station =>
                        !directStationIds.has(
                            String(station.id)
                        )
                );


            // ---------------------------------
            // Aucun résultat
            // ---------------------------------

            if (
                !directStations.length &&
                !nearbyOnly.length
            ) {

                results.innerHTML = '';
                results.style.display = 'none';

                return;
            }


            // ---------------------------------
            // Résultats directs
            // ---------------------------------

            const directResults =
                directStations
                    .map((station, index) => {

                        const availabilityColor =
                            getAvailabilityColor(
                                station,
                                'bikes'
                            );

                        return `
                            <div
                                class="search-result search-direct-station"
                                data-direct-index="${index}"
                            >

                                <div
                                    class="search-zone-station-main"
                                >

                                    <span
                                        class="search-availability-dot search-availability-${availabilityColor}"
                                    ></span>

                                    <strong>
                                        ${station.name}
                                    </strong>

                                    <span
                                        class="search-zone-station-count"
                                    >
                                        ${station.bikes ?? 0}
                                    </span>

                                </div>

                                <small>
                                    ${station.address ?? ''}
                                </small>

                            </div>
                        `;
                    })
                    .join('');


            // ---------------------------------
            // Stations proches
            // ---------------------------------

            const nearbyResults =
                nearbyOnly
                    .map(station => {

                        const availabilityColor =
                            getAvailabilityColor(
                                station,
                                'bikes'
                            );

                        return `
                            <div
                                class="search-result search-nearby-station"
                                data-station-id="${station.id}"
                            >

                                <div
                                    class="search-nearby-station-main"
                                >

                                    <span
                                        class="search-availability-dot search-availability-${availabilityColor}"
                                    ></span>

                                    <strong>
                                        ${station.name}
                                    </strong>

                                    <span
                                        class="search-nearby-bikes"
                                    >
                                        ${station.bikes ?? 0}
                                    </span>

                                </div>

                                <small
                                    class="search-nearby-distance"
                                >
                                    ${Math.round(
                                        station.distance
                                    )} m
                                </small>

                            </div>
                        `;
                    })
                    .join('');


            // ---------------------------------
            // Construction de la liste
            // ---------------------------------

            results.innerHTML = `
                <div class="search-standard-results">
                    ${
                        directStations.length
                            ? `
                                <div class="search-results-section-title">
                                    Stations correspondantes
                                </div>

                                ${directResults}
                            `
                            : ''
                    }

                    ${
                        nearbyOnly.length
                            ? `
                                <div class="search-results-section-title">
                                    Stations à proximité
                                </div>

                                ${nearbyResults}
                            `
                            : ''
                    }
                </div>
            `;

            results.style.display = 'block';


            // ---------------------------------
            // Clic sur une station directe
            // ---------------------------------

            results
                .querySelectorAll(
                    '.search-direct-station'
                )
                .forEach(resultElement => {

                    resultElement.addEventListener(
                        'click',
                        () => {

                            const index = Number(
                                resultElement.dataset.directIndex
                            );

                            const station =
                                directStations[index];

                            if (!station) {
                                return;
                            }

                            results.innerHTML = '';
                            results.style.display = 'none';

                            document.dispatchEvent(
                                new CustomEvent(
                                    'station:selected',
                                    {
                                        detail: station
                                    }
                                )
                            );
                        }
                    );
                });


            // ---------------------------------
            // Clic sur une station proche
            // ---------------------------------

            results
                .querySelectorAll(
                    '.search-nearby-station'
                )
                .forEach(resultElement => {

                    resultElement.addEventListener(
                        'click',
                        () => {

                            const stationId =
                                resultElement.dataset.stationId;

                            const station =
                                nearbyOnly.find(
                                    station =>
                                        String(station.id)
                                        === stationId
                                );

                            if (!station) {
                                return;
                            }

                            results.innerHTML = '';
                            results.style.display = 'none';

                            document.dispatchEvent(
                                new CustomEvent(
                                    'station:selected',
                                    {
                                        detail: station
                                    }
                                )
                            );
                        }
                    );
                });

        }, 300);
    });
}