export function calculateDistanceBetweenCoordinates(start, end) {
    const earthRadius = 6371000;
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const latitude1 = toRadians(start[1]);
    const latitude2 = toRadians(end[1]);
    const latitudeDifference = latitude2 - latitude1;
    const longitudeDifference = toRadians(end[0] - start[0]);
    const haversine =
        Math.sin(latitudeDifference / 2) ** 2 +
        Math.cos(latitude1) *
            Math.cos(latitude2) *
            Math.sin(longitudeDifference / 2) ** 2;

    return (
        2 *
        earthRadius *
        Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
}

/**
 * Calcule la projection d'une position GPS sur un segment.
 *
 * Les coordonnées de départ et de fin sont au format [longitude, latitude].
 * Le résultat contient la distance minimale en mètres, les coordonnées du
 * point le plus proche et le facteur de projection sur le segment.
 */
export function calculateProjectionOnSegment(
    position,
    start,
    end,
    minT = 0,
    maxT = 1,
) {
    const earthRadius = 6371000;

    const toRadians = (degrees) => (degrees * Math.PI) / 180;

    const referenceLatitude = toRadians(position.latitude);

    const project = (coordinate) => {
        const [longitude, latitude] = coordinate;

        return {
            x:
                toRadians(longitude - position.longitude) *
                earthRadius *
                Math.cos(referenceLatitude),

            y: toRadians(latitude - position.latitude) * earthRadius,
        };
    };

    // Projection locale du segment en mètres.
    const a = project(start);
    const b = project(end);

    const abX = b.x - a.x;
    const abY = b.y - a.y;

    const segmentLengthSquared = abX * abX + abY * abY;

    let t = 0;

    if (segmentLengthSquared > 0) {
        t = -(a.x * abX + a.y * abY) / segmentLengthSquared;

        t = Math.max(minT, Math.min(maxT, t));
    }

    // Point le plus proche de la position GPS.
    const closestX = a.x + t * abX;
    const closestY = a.y + t * abY;

    // Coordonnées géographiques de ce point.
    const coordinate = [
        start[0] + t * (end[0] - start[0]),
        start[1] + t * (end[1] - start[1]),
    ];

    return {
        distance: Math.hypot(closestX, closestY),
        coordinate,
        factor: t,
    };
}

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
