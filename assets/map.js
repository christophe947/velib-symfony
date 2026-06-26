import L from 'leaflet';

let displayMode =
    localStorage.getItem('mapMode') || 'bikes';

let bikesButton;
let docksButton;
let mapElement;
let map;
let markersLayer;
let legend;
let openedStation = null;
let fromCard = false;

if (typeof selectedStation !== 'undefined' && selectedStation !== null) {
    fromCard = true;
}


function getLegendTitle() {

    return displayMode === 'bikes'
        ? 'Disponibilité vélos'
        : 'Places disponibles';
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

function getModeLabel() {

    return displayMode === 'bikes'
        ? 'vélos disponibles'
        : 'places disponibles';
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


function updateLegend() {

    if (legend) {
        legend.remove();
    }

    legend = L.control({ position: 'bottomright' });

    legend.onAdd = function () {

        const div = L.DomUtil.create(
            'div',
            'map-legend'
        );

        div.innerHTML = `
            <strong>${getLegendTitle()}</strong><br>

            <span style="
                background:green;
                width:12px;
                height:12px;
                display:inline-block;
                border-radius:50%;
            "></span>
            10 ${getModeLabel()} ou plus<br>

            <span style="
                background:orange;
                width:12px;
                height:12px;
                display:inline-block;
                border-radius:50%;
            "></span>
            1 à 9 ${getModeLabel()}<br>

            <span style="
                background:red;
                width:12px;
                height:12px;
                display:inline-block;
                border-radius:50%;
            "></span>
            Pas de ${getModeLabel()}
        `;

        return div;
    };

    legend.addTo(map);
}

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
    iconUrl: '/images/marker-icon.png',
    iconRetinaUrl: '/images/marker-icon-2x.png',
    shadowUrl: '/images/marker-shadow.png',
});


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


function updateStationPanel(station) {

    const panel =
        document.getElementById('station-panel');

    if (!panel) {
        return;
    }

    panel.innerHTML = `
        <div class="station-info">

            <h4>${station.name}</h4>

            <hr>

            <p>
                🚲 <strong>${station.bikes}</strong>
                vélos disponibles
            </p>

            <p>
                🅿️ <strong>${station.docks}</strong>
                places libres
            </p>

        </div>

    `;
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

    localStorage.setItem(
        'mapMode',
        'bikes'
    );

    updateModeButtons();
    renderMarkers();
    updateLegend();
});


docksButton?.addEventListener('click', () => {

    displayMode = 'docks';

    localStorage.setItem(
        'mapMode',
        'docks'
    );
    
    updateModeButtons();
    renderMarkers();
    updateLegend();

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
    updateLegend();
            
};
    
});
    




