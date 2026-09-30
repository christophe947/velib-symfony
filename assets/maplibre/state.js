let selectedStation = null;

const listeners = new Set();

export function setSelectedStation(station) {
    selectedStation = station;

    console.log('Station sélectionnée :', station);
    
    listeners.forEach(listener => {
        listener(station);
    });
}

export function getSelectedStation() {
    return selectedStation;
}

export function clearSelectedStation() {
    selectedStation = null;

    listeners.forEach(listener => {
        listener(null);
    });
}

export function subscribeToSelectedStation(listener) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

let displayMode = 'bikes';

const displayModeSubscribers = [];

export function setDisplayMode(mode) {

    displayMode = mode;

    displayModeSubscribers.forEach(callback => {
        callback(displayMode);
    });
}

export function subscribeToDisplayMode(callback) {

    displayModeSubscribers.push(callback);

    callback(displayMode);
}