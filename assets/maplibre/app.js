import { createMap } from 'maplibre/map';
import { initStationPanel } from './stationPanel.js';
import { initSearch } from './search/search.js';
import { setSelectedStation } from './state.js';


const { map, styleReady } = createMap();

styleReady.catch((error) => {
    console.error('Le fond cartographique est indisponible :', error);

    const fallbackMessage = document.getElementById('map-style-fallback');

    if (fallbackMessage) {
        fallbackMessage.hidden = false;
    }
});

initStationPanel(map, styleReady);

initSearch(map);


document.addEventListener('station:selected', (event) => {
    const station = event.detail;

    setSelectedStation(station);

    map.flyTo({
        center: [station.longitude, station.latitude],
        zoom: 16,
    });
});

