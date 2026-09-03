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
        id: 'stations',
        type: 'circle',
        source: 'stations',
        minzoom: 13,

        filter: ['!', ['has', 'point_count']],

        paint: {
            'circle-radius': 10,
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
            'text-size': 12
        },

        paint: {
            'text-color': '#ffffff'
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
            'circle-radius': 15,
            'circle-color': 'transparent',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffd43b'
        }
    });

    subscribeToSelectedStation(station => {

        if (!station) {
            map.setFilter(
                'station-selected',
                [
                    '==',
                    ['to-string', ['get', 'id']],
                    ''
                ]
            );

            return;
        }

        map.setFilter(
            'station-selected',
            [
                '==',
                ['to-string', ['get', 'id']],
                String(station.id)
            ]
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