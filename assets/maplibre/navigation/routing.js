const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
const ROUTING_PROFILES = {
    pedestrian: {
        costing: 'pedestrian',
        costing_options: {
            pedestrian: {
                shortest: true,
            },
        },
    },
    bicycle: {
        costing: 'bicycle',
    },
};

function decodePolyline(encoded) {
    const coordinates = [];

    let index = 0;
    let latitude = 0;
    let longitude = 0;

    while (index < encoded.length) {
        let result = 0;
        let shift = 0;
        let byte;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const latitudeChange = result & 1 ? ~(result >> 1) : result >> 1;

        latitude += latitudeChange;

        result = 0;
        shift = 0;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const longitudeChange = result & 1 ? ~(result >> 1) : result >> 1;

        longitude += longitudeChange;

        coordinates.push([longitude / 1e6, latitude / 1e6]);
    }

    return coordinates;
}

function isValidPlace(place) {
    return (
        place &&
        Number.isFinite(place.latitude) &&
        place.latitude >= -90 &&
        place.latitude <= 90 &&
        Number.isFinite(place.longitude) &&
        place.longitude >= -180 &&
        place.longitude <= 180
    );
}

function isValidCoordinates(coordinates) {
    return (
        Array.isArray(coordinates) &&
        coordinates.length >= 2 &&
        coordinates.every(
            (coordinate) =>
                Array.isArray(coordinate) &&
                coordinate.length >= 2 &&
                Number.isFinite(coordinate[0]) &&
                coordinate[0] >= -180 &&
                coordinate[0] <= 180 &&
                Number.isFinite(coordinate[1]) &&
                coordinate[1] >= -90 &&
                coordinate[1] <= 90,
        )
    );
}

async function requestRouteTrip(from, to, mode, { signal } = {}) {
    const profile = ROUTING_PROFILES[mode];

    if (!profile) {
        throw new RangeError(`Unsupported routing mode: ${mode}`);
    }

    const response = await fetch(VALHALLA_URL, {
        method: 'POST',
        signal,

        headers: {
            'Content-Type': 'application/json',
        },

        body: JSON.stringify({
            locations: [
                {
                    lat: from.latitude,
                    lon: from.longitude,
                },
                {
                    lat: to.latitude,
                    lon: to.longitude,
                },
            ],

            ...profile,
            units: 'kilometers',
        }),
    });

    if (!response.ok) {
        throw new Error(`Routing error: ${response.status}`);
    }

    const data = await response.json();

    if (!data?.trip) {
        throw new Error('Aucun itinéraire trouvé.');
    }

    return data.trip;
}

export async function getRoute(
    from,
    to,
    mode = 'pedestrian',
    options = {},
) {
    if (!isValidPlace(from) || !isValidPlace(to)) {
        throw new TypeError('Les coordonnées de départ ou d’arrivée sont invalides.');
    }

    const trip = await requestRouteTrip(from, to, mode, options);
    const encodedGeometry = trip.legs?.[0]?.shape;
    const geometry =
        typeof encodedGeometry === 'string' && encodedGeometry.length > 0
            ? decodePolyline(encodedGeometry)
            : [];
    const distance = trip.summary?.length;
    const duration = trip.summary?.time;

    if (
        !isValidCoordinates(geometry) ||
        !Number.isFinite(distance) ||
        distance < 0 ||
        !Number.isFinite(duration) ||
        duration < 0
    ) {
        throw new Error('Valhalla returned an invalid route.');
    }

    return {
        mode,
        origin: { ...from },
        destination: { ...to },
        geometry,
        distance,
        duration,
    };
}
