import { geocode } from './geocoding.js';

import {
    findNearbyStations
} from './nearbyStations.js';

export async function searchNearbyStations(
    query,
    stations
) {
    const coordinates = await geocode(query);

    if (!coordinates) {
        return [];
    }

    return findNearbyStations(
        coordinates.latitude,
        coordinates.longitude,
        stations
    );
}