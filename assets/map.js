import L from 'leaflet';

let displayMode =
    localStorage.getItem('mapMode') || 'bikes';

let bikesButton;
let docksButton;
let mapElement;

let map;
let markersLayer;
let legend;

//let currentPopup = openedStation;

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

    if (!legend) return;

    legend.remove();

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

function renderMarkers() {

    if (!markersLayer || !stations) {
        return;
    }

    let currentPopup = openedStation;

    markersLayer.clearLayers();

    stations.forEach(station => {

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

        openedStation = station.id;
        fromCard = false;
    }

    marker.openPopup();
}
    });
} 

document.addEventListener('DOMContentLoaded', () => {

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

    //fromCard = false;
    

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

    //fromCard = false;
    
    updateModeButtons();
    renderMarkers();
    updateLegend();

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

            legend = L.control({ position: 'bottomright' });

            legend.onAdd = function () {

                const div = L.DomUtil.create('div', 'map-legend');

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

        


        initMap();
        renderMarkers();
        updateLegend();
            
    };


    
});
    




