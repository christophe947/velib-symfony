import L from 'leaflet';
import { updateStationPanel } from './stationPanel.js';
import { updateLegend } from './legend.js';
//import { renderMarkers } from './markers.js';
import { renderMarkers, setOpenedStation, getOpenedStation } from './markers.js';

let displayMode =
    localStorage.getItem('mapMode') || 'bikes';

let bikesButton;
let docksButton;
let mapElement;
let map;
let markersLayer;
let fromCard = false;
let savedMapView = null;
let isSearching = false;
let savedZoom = null;
let currentFilteredStations = null;
let defaultZoom = 13;
let searchTimeout = null;

if (typeof selectedStation !== 'undefined' && selectedStation !== null) {
    fromCard = true;
}

const actions = {
    setOpenedStation,
    clearSearchState
};
 
function fitStationsBounds(list) {

    if (!list.length) return;

    const bounds = L.latLngBounds(
        list.map(station => [
            station.latitude,
            station.longitude
        ])
    );

    /*map.fitBounds(bounds, {
        padding: [40, 40],
        animate: true,
        duration: 0.6,   // 👈 smooth mais rapide
        easeLinearity: 0.25
    });*/

    /*const zoom = map.getZoom();

    map.fitBounds(bounds, {
        padding: [40, 40],
        animate: true,
        duration: zoom > 15 ? 0.3 : 0.6
    });*/
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

    isSearching = false;
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
    if (savedMapView) {
        map.setView(
            savedMapView.center,
            savedMapView.zoom
        );
    }
}

function showStationList(list = stations) {

    const container =
        document.getElementById('station-results');

    if (!container) {
        return;
    }

    container.innerHTML = list.slice(0,20).map(station => `

        <div 
            class="mb-3 station-item"
            data-id="${station.id}"
            style="cursor:pointer">

            <strong>
                ${station.name}
            </strong>

            <br>

            🚲 ${station.bikes}
            🅿️ ${station.docks}

        </div>

        `)
        .join('');

        container.querySelectorAll('.station-item').forEach(item => {

            item.addEventListener('pointerdown', () => {

                

    const station = stations.find(
        s => s.id == item.dataset.id
    );

    if (!station) return;


   setOpenedStation(station.id);

   //clearSearchState();
   

container.innerHTML = "";

const searchInput = document.getElementById('station-search');

if (searchInput) {
    //searchInput.blur();
    searchInput.value = "";
}


renderMarkers(
    map,
    markersLayer,
    stations,
    displayMode,
    updateStationPanel,
    false,
    actions
);

map.setView(
    [
        station.latitude,
        station.longitude
    ],
    16
);

updateStationPanel(station);

});
   

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

    bikesButton = document.getElementById('mode-bikes');
    docksButton = document.getElementById('mode-docks');

    updateModeButtons();

    bikesButton?.addEventListener('click', () => {

    displayMode = 'bikes';

    localStorage.setItem('mapMode', displayMode);

    updateModeButtons();

    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();

    renderMarkers(
        map,
        markersLayer,
        currentFilteredStations ?? stations,
        //stations,
        displayMode,
        updateStationPanel,
        false,
        actions
    );

    map.setView(
        currentCenter,
        currentZoom
    );

    updateLegend(map, displayMode);
});


docksButton?.addEventListener('click', () => {

    displayMode = 'docks';

    localStorage.setItem('mapMode', displayMode);
    
    updateModeButtons();

    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();

    renderMarkers(
        map,
        markersLayer,
        currentFilteredStations ?? stations,
        //stations,
        displayMode,
        updateStationPanel,
        false,
        actions
    );

    map.setView(
        currentCenter,
        currentZoom
    );

    updateLegend(map, displayMode);

});


const searchInput = document.getElementById('station-search');

searchInput?.addEventListener('blur', () => {

    setTimeout(() => {
        document
        .getElementById('station-results')
        .innerHTML = "";

    }, 200);

});

searchInput?.addEventListener('keydown', (e) => {

    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
    }

});


    searchInput?.addEventListener('input', () => {

    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }

    searchTimeout = setTimeout(() => {

        const value = searchInput.value.toLowerCase();

        if (!value.trim()) {
            cancelSearch();
            return;
        }

        if (value && !isSearching) {

            savedMapView = {
                center: map.getCenter(),
                zoom: map.getZoom()
            };

            isSearching = true;
        }

        const filtered = stations.filter(station =>
            station.name.toLowerCase().includes(value)
        );

        currentFilteredStations = filtered;

        showStationList(filtered);

        renderMarkers(
            map,
            markersLayer,
            filtered,
            displayMode,
            updateStationPanel,
            false,
            actions
        );

        fitStationsBounds(filtered);

    }, 400);
});

    





searchInput?.addEventListener('focus', () => {

    const value = searchInput.value.toLowerCase();

    if (!value) return;

    const filtered = stations.filter(station =>
        station.name.toLowerCase().includes(value)
    );

    showStationList(filtered);

});


if (mapElement) {

    function initMap() {
            
        if (map) {
            return;
        }

        map = L.map('map');

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

    map.on('moveend', () => {

    if (!isSearching) {

        savedMapView = {
            center: map.getCenter(),
            zoom: map.getZoom()
        };

    }

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
    




