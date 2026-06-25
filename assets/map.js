import L from 'leaflet';

let displayMode =
    localStorage.getItem('mapMode') || 'bikes';

let bikesButton;
let docksButton;
let mapElement;

    

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
        : 'places libres';
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

document.addEventListener('DOMContentLoaded', () => {

    mapElement = document.getElementById('map');

    bikesButton = document.getElementById('mode-bikes');
    docksButton = document.getElementById('mode-docks');

    updateModeButtons();

    bikesButton?.addEventListener('click', () => {
        localStorage.setItem('mapMode', 'bikes');
        location.reload();
    });

    docksButton?.addEventListener('click', () => {
        localStorage.setItem('mapMode', 'docks');
        location.reload();
    });

    if (mapElement) {

        const map = L.map('map');
        
        L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
                attribution: '© OpenStreetMap'
            }
        ).addTo(map);

        const bounds = [];

        stations.forEach(station => {
            bounds.push([
                station.latitude,
                station.longitude
            ]);

        const value =
            displayMode === 'bikes'
                ? station.bikes
                :station.docks;

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
        .addTo(map)
        .bindPopup(`
            <strong>${station.name}</strong><br>
            🚲 ${station.bikes} vélos<br>
            🅿️ ${station.docks} places
        `);

        if (selectedStation == station.id) {
            map.setView(
                [
                    station.latitude,
                    station.longitude
                ],
                16
            );
            marker.openPopup();
        }
    });

    if (!selectedStation) {
        map.setView(
            [
                48.8566,
                2.3522
            ],
            13
        );
    }

    const legend = L.control({ position: 'bottomright' });

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
});



