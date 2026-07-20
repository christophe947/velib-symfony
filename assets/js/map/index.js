import L from 'leaflet';
import { updateStationPanel } from './stationPanel.js';
import { updateLegend } from './legend.js';
import { renderMarkers} from './markers.js';
import { createMap } from './map.js';
import { initDisplayMode } from './displayMode.js';
import { showStationList,
     initSearch,
      cancelSearch,
      clearSearchState
} from './search.js';
import { navigation } from './navigation.js';
import {
    setOpenedStation,
    getOpenedStation,
    setSearching,
    getSearching,
    setCurrentFilteredStations,
    getCurrentFilteredStations,
    setDisplayMode,
    getDisplayMode
} from './state.js';


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

    setOpenedStation,

    clearSearchState,

    startSearch: () => {
        setSearching(true);
    },

    endSearch: () => {
        setSearching(false);
        //test
        clearSearchState();
    },

    getSearching,


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

    const searchForm = document.getElementById('station-search-form');

    if (searchForm) {
        searchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            return false;
        });
    }

    mapElement = document.getElementById('map');

    



const searchInput = document.getElementById('station-search');

           



if (mapElement) {

    

    const mapInstance = createMap();


    map = mapInstance.map;
    //console.log('map');
    markersLayer = mapInstance.markersLayer;


    navigation.init(map);

    navigation.initDefaultView();


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

    map.on('moveend', () => {

        if (navigation.isProgrammatic()) {

            const saveAfter = navigation.saveAfterProgrammaticMove;

            navigation.endProgrammaticMove();

            if (saveAfter) {

                navigation.saveUserView();
                
            }
            console.log("move from code ");
            return;
            /*if (navigation.saveAfterProgrammaticMove) {

                navigation.saveUserView();
                navigation.saveAfterProgrammaticMove = false;

            }*/

            
            
        } 
        navigation.saveUserView(); 

        console.log("move from user");
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
        //displayMode,
        getDisplayMode(),
        updateStationPanel,
        true,
        actions
    );

    updateLegend(map, getDisplayMode());
};

});
    




