import { AVAILABILITY } from './constants.js';
import { setSelectedStation,
    subscribeToSelectedStation
 } from './state.js';


export function addStationLayer(map, displayMode = 'bikes') {

    const availableProperty = displayMode === 'electric'
        ? 'electricBikes'
        : displayMode === 'docks'
            ? 'docks'
            : 'bikes';


    const available = [
        'get',
        availableProperty
    ];


    const rate = [
        '/',
        available,
        ['get', 'capacity']
    ];


    const colorExpression = [
        'case',

        ['==', available, 0],
        'gray',

        ['<=', available, AVAILABILITY.MIN_RED],
        'red',

        ['<=', available, AVAILABILITY.MIN_ORANGE],
        'orange',

        ['>=', rate, AVAILABILITY.GOOD],
        'green',

        'orange'
    ];


    map.addLayer({
        id: 'station-selected-halo',
        type: 'circle',
        source: 'stations',
        minzoom: 13,

        filter: [
            '==',
            ['to-string', ['get', 'id']],
            ''
        ],

        paint: {
            //'circle-radius': 36,
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],

                13, 36,
                15, 38,
                17, 40
            ],
            'circle-color': '#fff200',
            'circle-opacity': 0.35
        }
    });

    map.addLayer({
        id: 'station-shadow',
        type: 'circle',
        source: 'stations',
        minzoom: 13,

        filter: ['!', ['has', 'point_count']],

        paint: {
            //'circle-radius': 15,
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],

                13, 15,
                15, 17,
                17, 25
            ],
            'circle-color': '#000000',
            'circle-opacity': 0.70,
            'circle-blur': 0.7,
            'circle-translate': [0, 3]
        }
    });

    map.addLayer({
        id: 'stations',
        type: 'circle',
        source: 'stations',
        minzoom: 13,

        filter: ['!', ['has', 'point_count']],

        paint: {
            //'circle-radius': 11,
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],

                13, 10,
                15, 12,
                17, 18
            ],
            'circle-color': colorExpression,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });

    map.addLayer({
        id: 'station-count',
        type: 'symbol',
        source: 'stations',
        minzoom: 13,

        filter: ['!', ['has', 'point_count']],

        layout: {
            'text-field': ['get', availableProperty],
            'text-size': 12,
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },

        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#ffffff',
            'text-halo-width': 0.35,
            'text-halo-blur': 0
        }
    });

    map.addLayer({
        id: 'station-selected',
        type: 'circle',
        source: 'stations',
        minzoom: 13,

        filter: [
            '==',
            ['to-string', ['get', 'id']],
            ''
        ],

        paint: {
            //'circle-radius': 22,
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],

                13, 17,
                15, 20,
                17, 26
            ],
            'circle-color': 'transparent',
            'circle-stroke-width': 7,
            'circle-stroke-color': '#fff200'
        }
    });


    subscribeToSelectedStation(station => {

        if (!station) {

            const emptyFilter = [
                '==',
                ['to-string', ['get', 'id']],
                ''
            ];

            map.setFilter(
                'station-selected',
                emptyFilter
            );

            map.setFilter(
                'station-selected-halo',
                emptyFilter
            );

            return;
        }

        const selectedFilter = [
            '==',
            ['to-string', ['get', 'id']],
            String(station.id)
        ];

        map.setFilter(
            'station-selected',
            selectedFilter
        );

        map.setFilter(
            'station-selected-halo',
            selectedFilter
        );
    });



    map.on('click', 'stations', event => {

        const feature = event.features?.[0];

        if (!feature) {
            return;
        }

        setSelectedStation(feature.properties);
    });


}