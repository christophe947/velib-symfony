import L from 'leaflet';
import { updateStationPanel } from './stationPanel.js';
import { updateLegend } from './legend.js';
import { renderMarkers} from './markers.js';
import { showStationList,
     initSearch,
      cancelSearch
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
    },

    getSearching,

    /*ignoreNextMove: () => {
        setIgnoreNextMove(true);
    },*/

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


function updateModeButtons() {

    if (!bikesButton || !docksButton) { 
        return;
    }

    if (getDisplayMode() === 'bikes') {

        bikesButton.className =
            'btn btn-primary active';

        docksButton.className =
            'btn btn-outline-primary';

    } else {

        docksButton.className =
            'btn btn-primary active';

        bikesButton.className =
            'btn btn-outline-primary';

    }
}

export function clearSearchState() {

    console.log("CLEAR SEARCH");
    
    setCurrentFilteredStations(null);
    
    const searchInput = document.getElementById('station-search');
    if (searchInput) {
        searchInput.value = "";
    }

    const container = document.getElementById('station-results');
    if (container) {
        container.innerHTML = "";
    }
}

/*function cancelSearch() {

    const searchInput = document.getElementById('station-search');

    // reset état recherche
    setSearching(false);

    setCurrentFilteredStations(null);

    console.log("CANCEL SEARCH");

    if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
}

    // vider input + liste
    if (searchInput) {
        searchInput.value = "";
    }

    const container = document.getElementById('station-results');
    if (container) {
        container.innerHTML = "";
    }

    // remettre tous les markers
    renderMarkers(
        map,
        markersLayer,
        stations,
        getDisplayMode(),
        updateStationPanel,
        false,
        actions
    );

    // restaurer la vue sauvegardée si elle existe
    if (navigation.mode === "savedView") {

        navigation.startProgrammaticMove();

        navigation.restoreUserView();

        setTimeout(() => {
    actions.endSearch?.();
}, 300);
    }

    if (!navigation.saveUserView) {
        navigation.initDefaultView();
    }


}*/


document.addEventListener('DOMContentLoaded', () => {

    const searchForm = document.getElementById('station-search-form');

    if (searchForm) {
        searchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            return false;
        });
    }

    mapElement = document.getElementById('map');

    bikesButton = document.getElementById('mode-bikes');
    docksButton = document.getElementById('mode-docks');

    updateModeButtons();



    bikesButton?.addEventListener('click', () => {

        navigation.startProgrammaticMove();
        setDisplayMode('bikes');
    
        updateModeButtons();

        renderMarkers(
            map,
            markersLayer,
            
            getCurrentFilteredStations() ?? stations,
            getDisplayMode(),
            updateStationPanel,
            false,
            actions
        );

    updateLegend(map, getDisplayMode());
});


docksButton?.addEventListener('click', () => {

    navigation.startProgrammaticMove();

    setDisplayMode('docks');

    updateModeButtons();

    renderMarkers(
        map,
        markersLayer,
        getCurrentFilteredStations() ?? stations,
        getDisplayMode(),
        updateStationPanel,
        false,
        actions
    );

    updateLegend(map, getDisplayMode());
});


const searchInput = document.getElementById('station-search');

           



if (mapElement) {

    function initMap() {
            
        if (map) {
            return;
        }

        map = L.map('map');


        navigation.init(map);

        L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
                attribution: '© OpenStreetMap'
            }
        ).addTo(map);

        navigation.initDefaultView();

        markersLayer = L.layerGroup().addTo(map);   
    }

    initMap();

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

    map.on('moveend', () => {

        if (navigation.isProgrammatic()) {

            navigation.endProgrammaticMove();
            
            console.log("move from code ");
            return;
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
    




