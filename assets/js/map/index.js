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

if (typeof selectedStation !== 'undefined' && selectedStation !== null) {
    fromCard = true;
}

 
function fitStationsBounds(list) {

    if (!list.length) return;

    const bounds = L.latLngBounds(
        list.map(station => [
            station.latitude,
            station.longitude
        ])
    );

    map.fitBounds(bounds, {
        padding:[30,30]
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
   

container.innerHTML = "";

const searchInput = document.getElementById('station-search');

if (searchInput) {
    searchInput.value = "";
}

renderMarkers(
    map,
    markersLayer,
    stations,
    displayMode,
    updateStationPanel
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
        false
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
        false
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

    const value = searchInput.value.toLowerCase();


    if (value && !isSearching) {

        //savedZoom = map.getZoom();

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
        false
    );


    if (value && filtered.length) {

        fitStationsBounds(filtered);

    }


    if (!value && isSearching) {

        isSearching = false;
        currentFilteredStations = null;


        renderMarkers(
            map,
            markersLayer,
            stations,
            displayMode,
            updateStationPanel,
            false
        );


        const openedId = getOpenedStation();

const station = stations.find(
    s => s.id == openedId
);

if (station) {

    map.setView(
        [
            station.latitude,
            station.longitude
        ],
        //map.getZoom()
        savedMapView?.zoom ?? defaultZoom
    );

} else if (savedMapView) {

        map.setView(
        savedMapView.center,
        savedMapView.zoom
    );

    }

    }

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
        true
    );
    updateLegend(map, displayMode);
            
};
    
});
    




