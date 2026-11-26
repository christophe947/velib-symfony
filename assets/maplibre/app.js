import { createMap } from 'maplibre/map';
import { initStationPanel } from './navigation/stationPanel.js';
import { initSearch } from './search/search.js';
import { setSelectedStation } from './shared/state.js';
import { startStationRefresh } from './shared/stationRefresh.js';


const providedSnapshot = window.stationSnapshot;
const initialStations =
    providedSnapshot?.stations ?? window.stations ?? [];
const hasCompleteInitialSnapshot =
    Array.isArray(providedSnapshot?.stations) &&
    typeof providedSnapshot.fetchedAt === 'string' &&
    Number.isFinite(Date.parse(providedSnapshot.fetchedAt)) &&
    typeof providedSnapshot.stale === 'boolean';
const initialSnapshot = hasCompleteInitialSnapshot
    ? providedSnapshot
    : {
          stations: initialStations,
          fetchedAt: null,
          stale: null,
      };
let currentStationSnapshot = initialSnapshot;
const getStationSnapshot = () => currentStationSnapshot;
const { map, styleReady, updateStationData } = createMap();

function updateStationDataStatus(snapshot) {
    const status = document.getElementById('station-data-status');

    if (!status) {
        return;
    }

    if (!snapshot?.stale) {
        status.hidden = true;
        status.textContent = '';
        return;
    }

    const fetchedAt =
        typeof snapshot.fetchedAt === 'string'
            ? new Date(snapshot.fetchedAt)
            : null;
    const formattedDate =
        !fetchedAt || Number.isNaN(fetchedAt.getTime())
            ? null
            : new Intl.DateTimeFormat('fr-FR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
              }).format(fetchedAt);

    status.textContent = formattedDate
        ? `Données de secours — dernier relevé : ${formattedDate}`
        : 'Données de secours — date du dernier relevé indisponible';
    status.hidden = false;
}

updateStationDataStatus(initialSnapshot);

styleReady.catch((error) => {
    console.error('Le fond cartographique est indisponible :', error);

    const fallbackMessage = document.getElementById('map-style-fallback');

    if (fallbackMessage) {
        fallbackMessage.hidden = false;
    }
});

const stationPanel = initStationPanel(map, styleReady, {
    getStationSnapshot,
});

const searchReady = initSearch(map).catch((error) => {
    console.error('Impossible d’initialiser la recherche des stations :', error);
    return null;
});

void searchReady.then((searchApi) => {
    stationPanel?.setRouteSearchApi(searchApi);
});

startStationRefresh({
    initialStations,
    initialSnapshot: hasCompleteInitialSnapshot ? initialSnapshot : null,
    onSnapshot: (snapshot, { dataChanged, metadataChanged }) => {
        currentStationSnapshot = snapshot;

        if (dataChanged) {
            updateStationData(snapshot.stations);
            stationPanel?.updateAvailability(snapshot.stations);

            void searchReady.then((searchApi) => {
                searchApi?.updateStations(snapshot.stations);
            });
        }

        if (metadataChanged) {
            updateStationDataStatus(snapshot);
        }
    },
});


document.addEventListener('station:selected', (event) => {
    const station = event.detail;

    setSelectedStation(station);

    map.flyTo({
        center: [station.longitude, station.latitude],
        zoom: 16,
    });
});

