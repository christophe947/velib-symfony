import { getGeometryBounds } from './geometry.js';

let geographicFilesPromise = null;
const geographicDataByStations = new Map();

async function fetchGeographicJson(url, description) {
    for (let attempt = 1; attempt <= 2; attempt++) {
        let response;

        try {
            response = await fetch(url);
        } catch (error) {
            if (!(error instanceof TypeError)) {
                throw new Error(
                    `Impossible de charger ${description} : ${error.message}`,
                );
            }

            if (attempt === 2) {
                throw new Error(
                    `Impossible de charger ${description} après deux tentatives : erreur réseau (${error.message}).`,
                );
            }

            continue;
        }

        if (response.status >= 500 && response.status < 600) {
            if (attempt === 1) {
                continue;
            }

            throw new Error(
                `Impossible de charger ${description} après deux tentatives : HTTP ${response.status}.`,
            );
        }

        if (!response.ok) {
            throw new Error(
                `Impossible de charger ${description} : HTTP ${response.status}.`,
            );
        }

        let responseBody;

        try {
            responseBody = await response.text();
        } catch (error) {
            if (error instanceof TypeError && attempt === 1) {
                continue;
            }

            if (error instanceof TypeError) {
                throw new Error(
                    `Impossible de recevoir les données de ${description} après deux tentatives : erreur réseau (${error.message}).`,
                );
            }

            throw new Error(
                `Impossible de recevoir les données de ${description} : ${error.message}`,
            );
        }

        try {
            return JSON.parse(responseBody);
        } catch (error) {
            throw new Error(
                `Impossible de décoder le GeoJSON pour ${description} : JSON invalide (${error.message}).`,
            );
        }
    }
}

async function loadArrondissements() {
    return fetchGeographicJson(
        '/data/arrondissements.geojson',
        'les arrondissements',
    );
}

async function loadCommunes() {
    return fetchGeographicJson('/data/communes-velib.geojson', 'les communes');
}

function filterZonesWithStations(zones) {
    return {
        ...zones,
        features: zones.features.filter((zone) => {
            const stationCount = zone.properties?.stationCount ?? 0;
            const code = zone.properties?.code ?? '';

            return stationCount > 0 && !code.startsWith('751');
        }),
    };
}

function countStationsByZone(zones, stations) {
    return {
        ...zones,
        features: zones.features.map((zone) => {
            const bounds = getGeometryBounds(zone.geometry);

            const stationCount = bounds
                ? stations.filter((station) => {
                      if (
                          !isPointInsideBounds(
                              station.longitude,
                              station.latitude,
                              bounds,
                          )
                      ) {
                          return false;
                      }

                      return isPointInsideGeometry(
                          station.longitude,
                          station.latitude,
                          zone.geometry,
                      );
                  }).length
                : 0;

            return {
                ...zone,
                properties: {
                    ...zone.properties,
                    stationCount,
                },
            };
        }),
    };
}

function loadGeographicFiles() {
    if (geographicFilesPromise) {
        return geographicFilesPromise;
    }

    const promise = Promise.all([loadArrondissements(), loadCommunes()]).then(
        ([arrondissements, communes]) => ({
            arrondissements,
            communes,
        }),
    );

    geographicFilesPromise = promise.catch((error) => {
        geographicFilesPromise = null;
        throw error;
    });

    return geographicFilesPromise;
}

export function loadGeographicData(stations) {
    const stationPositions = stations.map(({ longitude, latitude }) => ({
        longitude,
        latitude,
    }));
    const stationsKey = JSON.stringify(
        stationPositions.map(({ longitude, latitude }) => [
            longitude,
            latitude,
        ]),
    );

    const cachedPromise = geographicDataByStations.get(stationsKey);

    if (cachedPromise) {
        return cachedPromise;
    }

    const promise = loadGeographicFiles().then(
        ({ arrondissements, communes }) => ({
            communes,
            arrondissementsWithStationCount: countStationsByZone(
                arrondissements,
                stationPositions,
            ),
        }),
    );

    geographicDataByStations.set(stationsKey, promise);

    promise.catch(() => {
        if (geographicDataByStations.get(stationsKey) === promise) {
            geographicDataByStations.delete(stationsKey);
        }
    });

    return promise;
}

function isPointInsideGeometry(longitude, latitude, geometry) {
    if (!geometry) {
        return false;
    }

    if (geometry.type === 'Polygon') {
        return isPointInsidePolygon(longitude, latitude, geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some((polygon) =>
            isPointInsidePolygon(longitude, latitude, polygon),
        );
    }

    return false;
}

function isPointInsidePolygon(longitude, latitude, polygon) {
    if (!polygon.length) {
        return false;
    }

    if (isPointInsideRing(longitude, latitude, polygon[0])) {
        for (let i = 1; i < polygon.length; i++) {
            if (isPointInsideRing(longitude, latitude, polygon[i])) {
                return false;
            }
        }

        return true;
    }

    return false;
}

function isPointInsideRing(longitude, latitude, ring) {
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];

        const xj = ring[j][0];
        const yj = ring[j][1];

        const intersects =
            yi > latitude !== yj > latitude &&
            longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;

        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
}

export function zonesToPointsGeoJSON(zones) {
    return {
        type: 'FeatureCollection',

        features: zones.features.map((zone) => ({
            type: 'Feature',

            geometry: {
                type: 'Point',
                coordinates: [
                    zone.properties.geom_x_y.lon,
                    zone.properties.geom_x_y.lat,
                ],
            },

            properties: {
                ...zone.properties,
            },
        })),
    };
}

function isPointInsideBounds(longitude, latitude, bounds) {
    return (
        longitude >= bounds.minLng &&
        longitude <= bounds.maxLng &&
        latitude >= bounds.minLat &&
        latitude <= bounds.maxLat
    );
}

export function getStationsForZone(zone, stations) {
    if (!zone) {
        return [];
    }

    const bounds = getGeometryBounds(zone.geometry);

    if (!bounds) {
        return [];
    }

    return stations.filter((station) => {
        if (!isPointInsideBounds(station.longitude, station.latitude, bounds)) {
            return false;
        }

        return isPointInsideGeometry(
            station.longitude,
            station.latitude,
            zone.geometry,
        );
    });
}
