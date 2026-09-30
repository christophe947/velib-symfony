const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';


export function decodePolyline(encoded) {

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

        const latitudeChange =
            (result & 1)
                ? ~(result >> 1)
                : (result >> 1);

        latitude += latitudeChange;

        result = 0;
        shift = 0;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const longitudeChange =
            (result & 1)
                ? ~(result >> 1)
                : (result >> 1);

        longitude += longitudeChange;

        coordinates.push([
            longitude / 1e6,
            latitude / 1e6
        ]);
    }

    return coordinates;
}



export async function getWalkingRoute(
    from,
    to
) {

    const response = await fetch(VALHALLA_URL, {

        method: 'POST',

        headers: {
            'Content-Type': 'application/json'
        },

        body: JSON.stringify({
            locations: [
                {
                    lat: from.latitude,
                    lon: from.longitude
                },
                {
                    lat: to.latitude,
                    lon: to.longitude
                }
            ],

            costing: 'pedestrian',

            units: 'kilometers'
        })

    });

    if (!response.ok) {
        throw new Error(
            `Routing error: ${response.status}`
        );
    }

    const data = await response.json();

    if (!data.trip) {
        throw new Error(
            'Aucun itinéraire trouvé.'
        );
    }

    return data.trip;
}