import Fuse from '/maplibre-assets/fuse.mjs';

import {
    loadArrondissements,
    loadCommunes,
    countStationsByZone,
    getStationsForZone,
} from './zones.js';

import {
    classifySearch,
} from './searchIntent.js';

import {
    rankStationResults,
    renderAreaResults,
    renderSearchResults,
} from './searchResults.js';

import {
    searchNearbyStations,
} from './locationSearch.js';

import { initGeolocation } from './geolocation.js';


export async function initSearch(map) {
    const input = document.getElementById('map-search-input');
    const results = document.getElementById('map-search-results');
    const clearButton = document.getElementById('map-search-clear');

    if (!input || !results) {
        return;
    }

    const stations = window.stations ?? [];

    const [zonesData, communesData] = await Promise.all([
        loadArrondissements(),
        loadCommunes(),
    ]);

    const zones = countStationsByZone(
        zonesData,
        stations
    ).features;

    const communes = communesData.features ?? [];

    const searchableStations = stations.map(station => ({
        station,
        searchText: [
            station.name,
            station.address,
        ]
            .filter(Boolean)
            .join(' ')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase(),
    }));

    const fuse = new Fuse(searchableStations, {
        keys: ['searchText'],
        threshold: 0.28,
        ignoreLocation: true,
        minMatchCharLength: 3,
    });

    let debounceTimer = null;
    let searchVersion = 0;
    let displayedStations = [];

    // Un seul gestionnaire de clic pour tous les résultats.
    results.addEventListener('click', event => {
        const resultElement = event.target.closest(
            '[data-station-index]'
        );

        if (!resultElement) {
            return;
        }

        const index = Number(
            resultElement.dataset.stationIndex
        );

        const station = displayedStations[index];

        if (!station) {
            return;
        }

        results.innerHTML = '';
        results.style.display = 'none';

        document.dispatchEvent(
            new CustomEvent('station:selected', {
                detail: station,
            })
        );
    });

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);

        const version = ++searchVersion;
        const query = input.value
            .replace(/\s+/g, ' ')
            .trim();

        if (clearButton) {
            clearButton.hidden = query.length === 0;
        }

        if (!query) {
            results.innerHTML = '';
            results.style.display = 'none';
            displayedStations = [];
            return;
        }

        debounceTimer = setTimeout(async () => {
            const intent = classifySearch(
                query,
                zones,
                communes
            );

            // Une commune ou un arrondissement affiche toutes ses stations.
            if (intent.type === 'area') {
                const areaStations = getStationsForZone(
                    intent.area,
                    stations
                );

                displayedStations = renderAreaResults(
                    results,
                    intent.label,
                    areaStations
                );

                return;
            }

            // Les correspondances de stations apparaissent immédiatement.
            const directStations = intent.type === 'address'
                ? []
                : rankStationResults(
                    fuse,
                    stations,
                    query
                );

            if (directStations.length > 0) {
                displayedStations = renderSearchResults(
                    results,
                    directStations,
                    []
                );
            } else {
                results.innerHTML = `
                    <div class="search-results-section-title">
                        Recherche des lieux et stations proches…
                    </div>
                `;

                results.style.display = 'block';
                displayedStations = [];
            }

            // Cherche ensuite le lieu (adresse, gare, métro ou place)
            // et les stations Vélib proches.
            const locationGroups = await searchNearbyStations(
                intent.query ?? query,
                intent.type,
                stations
            );

            // Ignore une réponse d’une saisie plus ancienne.
            if (version !== searchVersion) {
                return;
            }

            const directIds = new Set(
                directStations.map(station =>
                    String(station.id)
                )
            );

            const cleanGroups = locationGroups
                .map(group => ({
                    ...group,
                    stations: group.stations.filter(
                        station =>
                            !directIds.has(String(station.id))
                    ),
                }))
                .filter(group => group.stations.length > 0);

            displayedStations = renderSearchResults(
                results,
                directStations,
                cleanGroups
            );
        }, 300);
    });

    clearButton?.addEventListener('click', () => {
        input.value = '';
        input.dispatchEvent(new Event('input'));
        input.focus();
    });

    initGeolocation({
        map,
        stations,
        results,
        input,
        onDisplayedStations: stationsToDisplay => {
            displayedStations = stationsToDisplay;
        },
    });
}

    