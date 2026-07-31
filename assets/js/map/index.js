import L from 'leaflet';
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
import { showStationList } from './searchResults.js';
import {
    setOpenedStation,
    getOpenedStation,
    setSearching,
    setDisplayMode,
    getDisplayMode,
    getSearching
} from './state.js';
import { updateStationPanel } from './stationPanel.js';


let bikesButton;
let docksButton;
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
 

function fitStationsBounds(list) {

    if (!list.length) return;

    const bounds = L.latLngBounds(
        list.map(station => [
            station.latitude,
            station.longitude
        ])
    );

    
    let duration = 0.5;
    let padding = [40, 40];

    if (list.length <= 3) {
        duration = 0.4;
        padding = [60, 60];
    }
    else if (list.length <= 15) {
        duration = 0.5;
        padding = [50, 50];
    }
    else {
        duration = 0.7;
        padding = [30, 30];
    }

    map.fitBounds(bounds, {
        padding,
        animate: true,
        duration,
        easeLinearity: 0.25
    });
}




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
            clearSearchState,
            actions,
            fitStationsBounds
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
    




