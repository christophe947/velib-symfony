import L from 'leaflet';
import { updateStationPanel } from './stationPanel.js';
import { updateLegend } from './legend.js';

let displayMode =
    localStorage.getItem('mapMode') || 'bikes';

let bikesButton;
let docksButton;
let mapElement;
let map;
let markersLayer;
let openedStation = null;
let fromCard = false;

if (typeof selectedStation !== 'undefined' && selectedStation !== null) {
    fromCard = true;
}

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

                openedStation = station.id;

                // cache la liste
                container.innerHTML = "";

                // reset la recherche
                const searchInput = document.getElementById('station-search');

                if (searchInput) {
                    searchInput.value = "";
                }

                updateStationPanel(station);

                map.setView(
                    [
                        station.latitude,
                        station.longitude
                    ],
                    16
                );

                renderMarkers();

            });

        });
}
   
    
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
    renderMarkers();
    updateLegend(map, displayMode);
});


docksButton?.addEventListener('click', () => {

    displayMode = 'docks';
    
    updateModeButtons();
    renderMarkers();
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

    const filtered = stations.filter(station =>
        station.name.toLowerCase().includes(value)
    );

    showStationList(filtered);

    renderMarkers(filtered);

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
            13
        );

        markersLayer = L.layerGroup().addTo(map);   
    }
    initMap();
    renderMarkers();
    updateLegend(map, displayMode);
            
};
    
});
    




