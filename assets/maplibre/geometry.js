export function getGeometryBounds(geometry) {
    if (!Array.isArray(geometry?.coordinates)) {
        return null;
    }

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    function visitCoordinates(coordinates) {
        if (!Array.isArray(coordinates)) {
            return;
        }

        if (typeof coordinates[0] === 'number') {
            const [longitude, latitude] = coordinates;

            if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
                minLng = Math.min(minLng, longitude);
                minLat = Math.min(minLat, latitude);
                maxLng = Math.max(maxLng, longitude);
                maxLat = Math.max(maxLat, latitude);
            }

            return;
        }

        coordinates.forEach(visitCoordinates);
    }

    visitCoordinates(geometry.coordinates);

    if (!Number.isFinite(minLng)) {
        return null;
    }

    return {
        minLng,
        minLat,
        maxLng,
        maxLat,
    };
}
