export function stationsToGeoJSON(stations) {

    return {
        type: 'FeatureCollection',

        features: stations.map(station => ({
            type: 'Feature',

            geometry: {
                type: 'Point',
                coordinates: [
                    station.longitude,
                    station.latitude
                ]
            },

            properties: {
                id: station.id,
                name: station.name,
                bikes: station.bikes,
                electricBikes: station.electricBikes,
                mechanicalBikes: station.mechanicalBikes,
                docks: station.docks,
                capacity: station.capacity
            }
        }))
    };
}