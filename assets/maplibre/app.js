import { createMap } from 'maplibre/map';
import { initStationPanel } from './stationPanel.js';
import { initSearch } from './search.js';
import { setSelectedStation } from './state.js';

const map = createMap();

initStationPanel();

initSearch();

document.addEventListener(
    'station:selected',
    event => {

        const station = event.detail;

        setSelectedStation(station);

        map.flyTo({
            center: [
                station.longitude,
                station.latitude
            ],
            zoom: 16
        });
    }
);