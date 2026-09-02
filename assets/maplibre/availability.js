import { AVAILABILITY } from './constants.js';


function getAvailableValue(station, mode) {

    const values = {
        bikes: station.bikes,
        electric: station.electricBikes,
        docks: station.docks
    };

    return values[mode] ?? 0;
}


export function getAvailabilityRate(station, mode) {

    const available = getAvailableValue(
        station,
        mode
    );

    if (!station.capacity) {
        return 0;
    }

    return Math.min(
        available / station.capacity,
        1
    );
}


export function getAvailabilityColor(station, mode) {

    const available = getAvailableValue(
        station,
        mode
    );

    const rate = getAvailabilityRate(
        station,
        mode
    );

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