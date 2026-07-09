import L from 'leaflet';
import { updateStationPanel } from './stationPanel.js';
import { updateLegend } from './legend.js';
import { renderMarkers} from './markers.js';
import { showStationList, initSearch } from './search.js';
import { navigation } from './navigation.js';
//test
//import { getCurrentFilteredStations } from './search.js';
import {
    setOpenedStation,
    getOpenedStation,
    getSearching
} from './state.js';


let displayMode =
    localStorage.getItem('mapMode') || 'bikes';

let bikesButton;
let docksButton;
let mapElement;
let map;
let markersLayer;
let fromCard = false;
let isSearching = false;
let savedZoom = null;
let currentFilteredStations = null;
let defaultZoom = 13;
let searchTimeout = null;

let ignoreNextMove = false;




export function setSearching(value) {
    isSearching = value;
}


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

    ignoreNextMove: () => {
        setIgnoreNextMove(true);
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


function updateModeButtons() {

    if (!bikesButton || !docksButton) { 
        return;
    }

    if (displayMode === 'bikes') {

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
    
    currentFilteredStations = null;
    

    const searchInput = document.getElementById('station-search');
    if (searchInput) {
        searchInput.value = "";
    }

    const container = document.getElementById('station-results');
    if (container) {
        container.innerHTML = "";
    }
}

function cancelSearch() {

    const searchInput = document.getElementById('station-search');

    // reset état recherche
    isSearching = false;
    currentFilteredStations = null;
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
        displayMode,
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

    bikesButton = document.getElementById('mode-bikes');
    docksButton = document.getElementById('mode-docks');

    updateModeButtons();



    bikesButton?.addEventListener('click', () => {

        navigation.startProgrammaticMove();

    displayMode = 'bikes';

    localStorage.setItem('mapMode', displayMode);

    updateModeButtons();

    //const currentCenter = map.getCenter();
    //const currentZoom = map.getZoom();

    console.log("SWITCH FILTER",  getCurrentFilteredStations()
);

    renderMarkers(
        map,
        markersLayer,
        
        getCurrentFilteredStations() ?? stations,
        
        displayMode,
        updateStationPanel,
        false,
        actions
    );

    

    updateLegend(map, displayMode);
});


docksButton?.addEventListener('click', () => {

    navigation.startProgrammaticMove();

    displayMode = 'docks';

    localStorage.setItem('mapMode', displayMode);
    
    updateModeButtons();

    //const currentCenter = map.getCenter();
    //const currentZoom = map.getZoom();

    console.log("SWITCH FILTER",  getCurrentFilteredStations()
);

    renderMarkers(
        map,
        markersLayer,
        getCurrentFilteredStations() ?? stations,
        
        displayMode,
        updateStationPanel,
        false,
        actions
    );

    

    updateLegend(map, displayMode);

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

        map.setView(
            [48.8566, 2.3522],
            defaultZoom
        );

        markersLayer = L.layerGroup().addTo(map);   
    }

    initMap();

    initSearch({
    stations,
    map,
    markersLayer,
    displayMode,
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
        //navigation.startProgrammaticMove();
        
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
        displayMode,
        updateStationPanel,
        true,
        actions
    );
    updateLegend(map, displayMode);
            
};


    
});
    




