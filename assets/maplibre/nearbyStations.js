function calculateDistance(
    latitude1,
    longitude1,
    latitude2,
    longitude2
) {
    const earthRadius = 6371000;

    const toRadians = value =>
        value * Math.PI / 180;

    const lat1 = toRadians(latitude1);
    const lat2 = toRadians(latitude2);

    const deltaLat = toRadians(
        latitude2 - latitude1
    );

    const deltaLng = toRadians(
        longitude2 - longitude1
    );

    const a =
        Math.sin(deltaLat / 2) ** 2
        +
        Math.cos(lat1)
        * Math.cos(lat2)
        * Math.sin(deltaLng / 2) ** 2;

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return earthRadius * c;
}

export function findNearbyStations(
    latitude,
    longitude,
    stations,
    limit = 10,
    maxDistance = 1000
) {
    return stations
        .map(station => {

            const distance = calculateDistance(
                latitude,
                longitude,
                station.latitude,
                station.longitude
            );

            return {
                ...station,
                distance
            };
        })
        .filter(station => {
            return station.distance <= maxDistance;
        })
        .sort(
            (a, b) => a.distance - b.distance
        )
        .slice(0, limit);
}