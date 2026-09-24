/*export function addClusterLayers(map) {


    map.addLayer({
        id: 'station-cluster-shadow',
        type: 'circle',
        source: 'stations',

        filter: ['has', 'point_count'],

        paint: {
            'circle-radius': 30,
            'circle-color': '#ff0000',
            'circle-opacity': 1,
            'circle-blur': 0.7,
            'circle-translate': [0, 3]
        }
    });


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
            'text-size': 14,
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },

        paint: {
            'text-color': '#ffffff'
        }
    });

}*/