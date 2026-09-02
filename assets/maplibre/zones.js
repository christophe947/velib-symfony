export async function loadArrondissements() {

    const response = await fetch(
        '/data/arrondissements.geojson'
    );

    if (!response.ok) {
        throw new Error(
            `Impossible de charger les arrondissements : ${response.status}`
        );
    }

    return response.json();
}


export async function loadCommunes() {
    const response = await fetch(
        '/data/communes-velib.geojson'
    );

    if (!response.ok) {
        throw new Error(
            `Impossible de charger les communes : ${response.status}`
        );
    }

    return response.json();
}


export function filterZonesWithStations(zones) {
    return {
        ...zones,
        features: zones.features.filter(zone => {
            const stationCount = zone.properties?.stationCount ?? 0;
            const code = zone.properties?.code ?? '';

            return stationCount > 0
                && !code.startsWith('751');
        })
    };
}

export function countStationsByZone(
    zones,
    stations
) {
    return {
        ...zones,
        features: zones.features.map(zone => {

            const bounds = getGeometryBounds(
                zone.geometry
            );

            const stationCount = stations.filter(
                station => {

                    if (!isPointInsideBounds(
                        station.longitude,
                        station.latitude,
                        bounds
                    )) {
                        return false;
                    }

                    return isPointInsideGeometry(
                        station.longitude,
                        station.latitude,
                        zone.geometry
                    );
                }
            ).length;

            return {
                ...zone,
                properties: {
                    ...zone.properties,
                    stationCount
                }
            };
        })
    };
}


function isPointInsideGeometry(
    longitude,
    latitude,
    geometry
) {

    if (!geometry) {
        return false;
    }


    if (geometry.type === 'Polygon') {

        return isPointInsidePolygon(
            longitude,
            latitude,
            geometry.coordinates
        );
    }


    if (geometry.type === 'MultiPolygon') {

        return geometry.coordinates.some(
            polygon =>
                isPointInsidePolygon(
                    longitude,
                    latitude,
                    polygon
                )
        );
    }


    return false;
}


function isPointInsidePolygon(
    longitude,
    latitude,
    polygon
) {

    if (!polygon.length) {
        return false;
    }


    if (
        isPointInsideRing(
            longitude,
            latitude,
            polygon[0]
        )
    ) {

        for (let i = 1; i < polygon.length; i++) {

            if (
                isPointInsideRing(
                    longitude,
                    latitude,
                    polygon[i]
                )
            ) {
                return false;
            }
        }

        return true;
    }


    return false;
}


function isPointInsideRing(
    longitude,
    latitude,
    ring
) {

    let inside = false;


    for (
        let i = 0, j = ring.length - 1;
        i < ring.length;
        j = i++
    ) {

        const xi = ring[i][0];
        const yi = ring[i][1];

        const xj = ring[j][0];
        const yj = ring[j][1];


        const intersects =
            ((yi > latitude) !== (yj > latitude))
            &&
            (
                longitude <
                (xj - xi)
                * (latitude - yi)
                / (yj - yi)
                + xi
            );


        if (intersects) {
            inside = !inside;
        }
    }


    return inside;
}

export function zonesToPointsGeoJSON(zones) {
    return {
        type: 'FeatureCollection',

        features: zones.features.map(zone => ({
            type: 'Feature',

            geometry: {
                type: 'Point',
                coordinates: [
                    zone.properties.geom_x_y.lon,
                    zone.properties.geom_x_y.lat
                ]
            },

            properties: {
                ...zone.properties
            }
        }))
    };
}


function getGeometryBounds(geometry) {

    const coordinates = [];

    function collectCoordinates(coords) {

        if (typeof coords[0] === 'number') {
            coordinates.push(coords);
            return;
        }

        coords.forEach(collectCoordinates);
    }

    collectCoordinates(
        geometry.coordinates
    );

    let minLng = coordinates[0][0];
    let maxLng = coordinates[0][0];
    let minLat = coordinates[0][1];
    let maxLat = coordinates[0][1];

    coordinates.forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    });

    return {
        minLng,
        maxLng,
        minLat,
        maxLat
    };
}


function isPointInsideBounds(
    longitude,
    latitude,
    bounds
) {
    return (
        longitude >= bounds.minLng &&
        longitude <= bounds.maxLng &&
        latitude >= bounds.minLat &&
        latitude <= bounds.maxLat
    );
}