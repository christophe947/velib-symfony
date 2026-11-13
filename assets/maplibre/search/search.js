import Fuse from '/maplibre-assets/fuse.mjs';
import {
    loadGeographicData,
    getStationsForZone,
} from '../geography/zones.js';
import { setUserFollowing } from '../map.js';
import { subscribeToDisplayMode } from '../shared/state.js';
import { classifySearch } from './searchIntent.js';
import {
    rankStationResults,
    renderAreaResults,
    renderSearchResults,
    updateSearchResultAvailability,
} from './searchResults.js';
import { searchNearbyStations } from './locationSearch.js';
import { geocodeCandidates } from './geocoding.js';
import { initGeolocation } from '../location/geolocation.js';


export async function initSearch(map) {
    const input = document.getElementById('map-search-input');
    const results = document.getElementById('map-search-results');
    const clearButton = document.getElementById('map-search-clear');

    if (!input || !results) {
        return;
    }

    let stations = window.stations ?? [];

    let zones = [];
    let communes = [];

    function createSearchableStations(stationList) {
        return stationList.map((station) => ({
            station,
            searchText: [station.name, station.address]
                .filter(Boolean)
                .join(' ')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase(),
        }));
    }

    function getSearchIndexSignature(stationList) {
        return JSON.stringify(
            stationList
                .map((station) => [
                    String(station.id),
                    station.name ?? '',
                    station.address ?? '',
                ])
                .sort(([firstId], [secondId]) =>
                    firstId.localeCompare(secondId),
                ),
        );
    }

    function createFuse(searchableStationList) {
        return new Fuse(searchableStationList, {
            keys: ['searchText'],
            threshold: 0.28,
            ignoreLocation: true,
            minMatchCharLength: 3,
        });
    }

    let searchableStations = createSearchableStations(stations);
    let searchIndexSignature = getSearchIndexSignature(stations);
    let fuse = createFuse(searchableStations);

    let debounceTimer = null;
    let searchVersion = 0;
    let displayedStations = [];
    let currentMode = 'bikes';

    function updateStations(updatedStations) {
        if (!Array.isArray(updatedStations)) {
            return;
        }

        const updatedSearchIndexSignature = getSearchIndexSignature(
            updatedStations,
        );
        const latestStationsById = new Map(
            updatedStations.map((station) => [String(station.id), station]),
        );

        stations = updatedStations;

        if (updatedSearchIndexSignature !== searchIndexSignature) {
            searchableStations = createSearchableStations(updatedStations);
            searchIndexSignature = updatedSearchIndexSignature;
            fuse = createFuse(searchableStations);
        } else {
            searchableStations.forEach((item) => {
                const latestStation = latestStationsById.get(
                    String(item.station.id),
                );

                if (latestStation) {
                    item.station = latestStation;
                }
            });
        }

        displayedStations = displayedStations.map((displayedStation) => {
            if (!displayedStation) {
                return null;
            }

            const latestStation = latestStationsById.get(
                String(displayedStation.id),
            );

            if (!latestStation) {
                return null;
            }

            return Number.isFinite(displayedStation.distance)
                ? { ...latestStation, distance: displayedStation.distance }
                : latestStation;
        });

        updateSearchResultAvailability(results, displayedStations, currentMode);
    }

    async function searchRouteCandidates(query) {
        const cleanQuery = String(query).replace(/\s+/g, ' ').trim();

        if (cleanQuery.length < 3) {
            return { candidates: [], error: false };
        }

        const intent = classifySearch(cleanQuery, zones, communes);
        const matchingStations =
            intent.type === 'area'
                ? getStationsForZone(intent.area, stations).slice(0, 8)
                : rankStationResults(fuse, stations, cleanQuery, 8);
        const stationCandidates = matchingStations
            .filter(
                (station) =>
                    station?.id !== undefined &&
                    Number.isFinite(station.longitude) &&
                    station.longitude >= -180 &&
                    station.longitude <= 180 &&
                    Number.isFinite(station.latitude) &&
                    station.latitude >= -90 &&
                    station.latitude <= 90,
            )
            .map((station) => ({
                type: 'station',
                label: station.name ?? 'Station Vélib',
                detail: station.address ?? '',
                latitude: station.latitude,
                longitude: station.longitude,
                stationId: String(station.id),
            }));

        if (intent.type === 'area') {
            return { candidates: stationCandidates, error: false };
        }

        let locations;

        try {
            locations = await geocodeCandidates(
                cleanQuery,
                intent.type,
                { throwOnError: true },
            );
        } catch (error) {
            console.warn('Échec du géocodage du planificateur :', error);
            return { candidates: stationCandidates, error: true };
        }

        const locationType = intent.type === 'address' ? 'address' : 'place';
        const locationCandidates = locations
            .filter(
                (location) =>
                    Number.isFinite(location.longitude) &&
                    location.longitude >= -180 &&
                    location.longitude <= 180 &&
                    Number.isFinite(location.latitude) &&
                    location.latitude >= -90 &&
                    location.latitude <= 90,
            )
            .map((location) => ({
                type: locationType,
                label: location.label,
                detail: location.city,
                latitude: location.latitude,
                longitude: location.longitude,
            }));

        return {
            candidates: [...stationCandidates, ...locationCandidates],
            error: false,
        };
    }

    function resolveRouteCandidate(candidate) {
        if (candidate?.type !== 'station') {
            return candidate;
        }

        const station = stations.find(
            (item) => String(item.id) === String(candidate.stationId),
        );

        if (
            !station ||
            !Number.isFinite(station.longitude) ||
            station.longitude < -180 ||
            station.longitude > 180 ||
            !Number.isFinite(station.latitude) ||
            station.latitude < -90 ||
            station.latitude > 90
        ) {
            return null;
        }

        return {
            type: 'station',
            label: station.name ?? 'Station Vélib',
            detail: station.address ?? '',
            latitude: station.latitude,
            longitude: station.longitude,
            stationId: String(station.id),
        };
    }

    const routeSearchApi = {
        updateStations,
        searchRouteCandidates,
        resolveRouteCandidate,
    };

    let geographicData;

    try {
        geographicData = await loadGeographicData(stations);
    } catch (error) {
        console.error(
            'Impossible d’initialiser la recherche géographique :',
            error,
        );
        results.textContent =
            'Les données géographiques sont indisponibles. Recharge la page pour réessayer.';
        results.style.display = 'block';
        return routeSearchApi;
    }

    results.textContent = '';
    results.style.display = 'none';

    const { arrondissementsWithStationCount, communes: communesData } =
        geographicData;

    zones = arrondissementsWithStationCount.features;
    communes = communesData.features ?? [];

    input.addEventListener('focus', () => {
        document.dispatchEvent(new Event('search:focus'));
    });
    input.addEventListener('blur', () => {
        document.dispatchEvent(new Event('search:blur'));
        console.log('blur');
    });

    subscribeToDisplayMode((mode) => {
        currentMode = mode;
        updateSearchResultAvailability(results, displayedStations, currentMode);
    });

    // Un seul gestionnaire de clic pour tous les résultats.
    results.addEventListener('click', (event) => {
        const resultElement = event.target.closest('[data-station-index]');

        if (!resultElement) {
            return;
        }

        const index = Number(resultElement.dataset.stationIndex);

        const station = displayedStations[index];

        if (!station) {
            return;
        }

        clearTimeout(debounceTimer);
        debounceTimer = null;
        searchVersion += 1;

        results.innerHTML = '';
        results.style.display = 'none';

        // Désactive le suivi caméra lors de la sélection d'une station.
        setUserFollowing(false);

        document.dispatchEvent(
            new CustomEvent('station:selected', {
                detail: station,
            }),
        );
    });

    // Ferme la liste si l'utilisateur clique en dehors de la recherche.
    document.addEventListener('click', (event) => {
        if (!event.target.closest('#map-search')) {
            const hasResults = displayedStations.length > 0;
            const hasPendingSearch = debounceTimer !== null ||
                results.style.display === 'block';

            if (hasPendingSearch) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
                searchVersion += 1;
            }

            results.innerHTML = '';
            results.style.display = 'none';
            displayedStations = [];

            if (hasResults) {
                document.dispatchEvent(new Event('search:results:close'));
            }
        }
    });

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);

        const version = ++searchVersion;
        const query = input.value.replace(/\s+/g, ' ').trim();

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
            debounceTimer = null;
            const intent = classifySearch(query, zones, communes);

            // Une commune ou un arrondissement affiche toutes ses stations.
            if (intent.type === 'area') {
                const areaStations = getStationsForZone(intent.area, stations);

                displayedStations = renderAreaResults(
                    results,
                    intent.label,
                    areaStations,
                    currentMode,
                );

                return;
            }

            // Les correspondances de stations apparaissent immédiatement.
            const directStations =
                intent.type === 'address'
                    ? []
                    : rankStationResults(fuse, stations, query);

            if (directStations.length > 0) {
                displayedStations = renderSearchResults(
                    results,
                    directStations,
                    [],
                    currentMode,
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
                () => stations,
            );

            // Ignore une réponse d’une saisie plus ancienne.
            if (version !== searchVersion) {
                return;
            }

            const latestDirectStations =
                intent.type === 'address'
                    ? []
                    : rankStationResults(fuse, stations, query);
            const directIds = new Set(
                latestDirectStations.map((station) => String(station.id)),
            );

            const cleanGroups = locationGroups
                .map((group) => ({
                    ...group,
                    stations: group.stations.filter(
                        (station) => !directIds.has(String(station.id)),
                    ),
                }))
                .filter((group) => group.stations.length > 0);

            displayedStations = renderSearchResults(
                results,
                latestDirectStations,
                cleanGroups,
                currentMode,
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
        getStations: () => stations,
        getDisplayMode: () => currentMode,
        results,
        input,
        onDisplayedStations: (stationsToDisplay) => {
            displayedStations = stationsToDisplay;
        },
    });

    return routeSearchApi;
}
