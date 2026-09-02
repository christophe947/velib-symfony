import { AVAILABILITY } from './constants.js';


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


}