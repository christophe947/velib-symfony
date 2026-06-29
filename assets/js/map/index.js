import L from 'leaflet';
import { updateStationPanel } from './stationPanel.js';
import { updateLegend } from './legend.js';
//import { renderMarkers } from './markers.js';
import { renderMarkers, setOpenedStation } from './markers.js';

let displayMode =
    localStorage.getItem('mapMode') || 'bikes';

let bikesButton;
let docksButton;
let mapElement;
let map;
let markersLayer;
//let openedStation = null;
let fromCard = false;
let savedMapView = null;
let isSearching = false;

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
        padding:[50,50]
    });

}
/*
function getMarkerColor(value) {

    if (value >= 10) {
        return 'green';
    }

    if (value > 0) {
        return 'orange';
    }

    return 'red';
}


function createIcon(color) {

    return L.divIcon({

        className: '',

        html: `
            <div style="
                background:${color};
                width:20px;
                height:20px;
                border-radius:50%;
                border:3px solid white;
            ">
            </div>
        `,

        iconSize: [20,20]

    });
}
*/

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
   
/** 
function renderMarkers(data = stations) {

    if (!markersLayer || !data) {
        return;
    }

    let currentPopup = openedStation;

    markersLayer.clearLayers();

    data.forEach(station => {

        const value =
            displayMode === 'bikes'
                ? station.bikes
                : station.docks;

        const marker = L.marker(
            [
                station.latitude,
                station.longitude
            ],
            {
                icon: createIcon(
                    getMarkerColor(value)
                )
            }
        )
        .bindPopup(`
            <strong>${station.name}</strong><br>
            🚲 ${station.bikes} vélos<br>
            🅿️ ${station.docks} places
        `);

        markersLayer.addLayer(marker);

        marker.on('click', () => {

            openedStation = station.id;
            updateStationPanel(station);

            if (typeof selectedStation !== 'undefined') {
                selectedStation = null;
            }

            fromCard = false;

        });


        if (
            currentPopup == station.id ||
        (
            fromCard &&
            selectedStation == station.id
        )

        ) {

        if (fromCard) {

            map.setView(
                [
                    station.latitude,
                    station.longitude
                ],
                16
            );
            updateStationPanel(station);
            openedStation = station.id;
            fromCard = false;
        }

        marker.openPopup();
        }
    });
} 
*/
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

    updateModeButtons();
    renderMarkers(
        map,
        markersLayer,
        stations,
        displayMode,
        updateStationPanel,
        false
    );
    updateLegend(map, displayMode);
});


docksButton?.addEventListener('click', () => {

    displayMode = 'docks';
    
    updateModeButtons();
    renderMarkers(
        map,
        markersLayer,
        stations,
        displayMode,
        updateStationPanel,
        false
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

        savedMapView = {
            center: map.getCenter(),
            zoom: map.getZoom()
        };

        isSearching = true;
    }


    const filtered = stations.filter(station =>
        station.name.toLowerCase().includes(value)
    );


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


        renderMarkers(
            map,
            markersLayer,
            stations,
            displayMode,
            updateStationPanel,
            false
        );


        if (savedMapView) {

            map.setView(
                savedMapView.center,
                savedMapView.zoom
            );

        }

    }

});
/*
searchInput?.addEventListener('input', () => {

    const value = searchInput.value.toLowerCase();


    const filtered = stations.filter(station =>
        station.name.toLowerCase().includes(value)
    );


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

});
*/
/*
searchInput?.addEventListener('input', () => {

    const value = searchInput.value.toLowerCase();

    const filtered = stations.filter(station =>
        station.name.toLowerCase().includes(value)
    );

    showStationList(filtered);

    renderMarkers(
        map,
        markersLayer,
        filtered,
        displayMode,
        updateStationPanel,
        true
    );

});
  */  

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
            13
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
    




