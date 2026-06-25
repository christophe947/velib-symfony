import L from 'leaflet';

function getMarkerColor(bikes) {

    if (bikes >= 10) {
        return 'green';
    }

    if (bikes > 0) {
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

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
    iconUrl: '/images/marker-icon.png',
    iconRetinaUrl: '/images/marker-icon-2x.png',
    shadowUrl: '/images/marker-shadow.png',
});

const mapElement = document.getElementById('map');


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

        const color = getMarkerColor(
            station.bikes
        );

        const marker = L.marker(
        [
            station.latitude,
            station.longitude
        ],
        {
            icon: createIcon(
                getMarkerColor(station.bikes)
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
            <strong>Disponibilité vélos</strong><br>
            <span style="
                background:green;
                width:12px;
                height:12px;
                display:inline-block;
                border-radius:50%;
            "></span>
            10 vélos ou plus<br>

            <span style="
                background:orange;
                width:12px;
                height:12px;
                display:inline-block;
                border-radius:50%;
            "></span>
            1 à 9 vélos<br>

            <span style="
                background:red;
                width:12px;
                height:12px;
                display:inline-block;
                border-radius:50%;
            "></span>
            Aucun vélo
        `;

        return div;
    };

    legend.addTo(map);


}