import { initDisplayMode } from './displayMode.js';
import { updateLegend } from './legend.js';
import { createMap } from './map.js';
import { initMapEvents } from './mapEvents.js';
import { renderMarkers} from './markers.js';
import { navigation } from './navigation.js';
import { 
    clearSearchState,
    initSearch
} from './search.js';
import {
    setOpenedStation,
    setSearching,
    getDisplayMode,
    getSearching
} from './state.js';
import { updateStationPanel } from './stationPanel.js';


let mapElement;
let map;
let markersLayer;

let fromCard = false;

if (typeof selectedStation !== 'undefined' && selectedStation !== null) {
    fromCard = true;
}


const actions = {

    
    startSearch: () => {
        setSearching(true);
    },

    endSearch: () => {
        setSearching(false);
        clearSearchState();
    },

    isSearching() {
        return getSearching();
    },

    getAllStations: () => stations,
};
 

document.addEventListener('DOMContentLoaded', () => {

    mapElement = document.getElementById('map');
        
    if (mapElement) {

        const mapInstance = createMap();

        map = mapInstance.map;
       
        markersLayer = mapInstance.markersLayer;


        navigation.init(map);

        navigation.initDefaultView();

        initMapEvents(
            map,
            navigation,
            actions
        );

        initSearch({
            stations,
            map,
            markersLayer,
            getDisplayMode,
            updateStationPanel,
            renderMarkers,
            setOpenedStation,
            actions
        });

        initDisplayMode({
            map,
            markersLayer,
            stations,
            renderMarkers,
            updateStationPanel,
            updateLegend,
            actions
        });

        if (fromCard) {
            setOpenedStation(
                selectedStation.id ?? selectedStation
            );
        }

        renderMarkers(
            map,
            markersLayer,
            stations,
            getDisplayMode(),
            updateStationPanel,
            true,
            actions
        );

        updateLegend(map, getDisplayMode());
    };

});
    




