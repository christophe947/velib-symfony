export function addClusterLayers(map) {

    map.addLayer({
        id: 'station-clusters',
        type: 'circle',
        source: 'stations',

        filter: ['has', 'point_count'],

        paint: {
            'circle-radius': 22,
            'circle-color': '#0d6efd',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff'
        }
    });


    map.addLayer({
        id: 'station-cluster-count',
        type: 'symbol',
        source: 'stations',

        filter: ['has', 'point_count'],

        layout: {
            'text-field': '{point_count_abbreviated}',
            'text-size': 14
        },

        paint: {
            'text-color': '#ffffff'
        }
    });

}