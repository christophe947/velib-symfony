import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
    iconUrl: '/images/marker-icon.png',
    iconRetinaUrl: '/images/marker-icon-2x.png',
    shadowUrl: '/images/marker-shadow.png',
});

const mapElement = document.getElementById('map');

if (mapElement) {

    const map = L.map('map').setView(
        [48.8566, 2.3522],
        12
    );

    L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
            attribution: '© OpenStreetMap'
        }
    ).addTo(map);


    stations.forEach(station => {

        L.marker([
            station.latitude,
            station.longitude
        ])
        .addTo(map)
        .bindPopup(`
            <strong>${station.name}</strong><br>
            🚲 ${station.bikes} vélos<br>
            🅿️ ${station.docks} places
        `);

    });

}