import { createMap } from 'maplibre/map';
import { initStationPanel } from './navigation/stationPanel.js';
import { initSearch } from './search/search.js';
import { setSelectedStation } from './shared/state.js';
import { startStationRefresh } from './shared/stationRefresh.js';


const initialStations = window.stations ?? [];
const { map, styleReady, updateStationData } = createMap();

styleReady.catch((error) => {
    console.error('Le fond cartographique est indisponible :', error);

    const fallbackMessage = document.getElementById('map-style-fallback');

    if (fallbackMessage) {
        fallbackMessage.hidden = false;
    }
});

initStationPanel(map, styleReady);

const searchReady = initSearch(map).catch((error) => {
    console.error('Impossible d’initialiser la recherche des stations :', error);
    return null;
});

startStationRefresh({
    initialStations,
    onSnapshot: (snapshot, { dataChanged }) => {
        if (dataChanged) {
            updateStationData(snapshot.stations);

            void searchReady.then((updateSearchStations) => {
                updateSearchStations?.(snapshot.stations);
            });
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

