import { AVAILABILITY } from './constants.js';


export function getAvailabilityRate(station, mode) {

    const available =
        mode === 'bikes'
            ? station.bikes
            : station.docks;


    if (!station.capacity) {
        return 0;
    }


    return Math.min(
        available / station.capacity,
        1
    );
}


export function getAvailabilityColor(station, mode) {

    const available =
        mode === 'bikes'
            ? station.bikes
            : station.docks;


    const rate =
        getAvailabilityRate(station, mode);


    if (available === 0) {
        return 'gray';
    }


    if (available <= AVAILABILITY.MIN_RED) {
        return 'red';
    }


    if (available <= AVAILABILITY.MIN_ORANGE) {
        return 'orange';
    }


    if (rate >= AVAILABILITY.GOOD) {
        return 'green';
    }


    return 'orange';
}


export function getAvailabilityLegend() {

    return [
        {
            color: 'gray',
            label: 'Aucune disponibilité'
        },
        {
            color: 'red',
            label: 'Très faible'
        },
        {
            color: 'orange',
            label: 'Moyenne'
        },
        {
            color: 'green',
            label: 'Bonne disponibilité'
        }
    ];
}