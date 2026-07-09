let openedStation = null;

let currentFilteredStations = null;

let displayMode = 'bikes';

let isSearching = false;



// ====================
// Opened station
// ====================

export function setOpenedStation(id) {

    openedStation = id;
}


export function getOpenedStation() {

    return openedStation;
}



// ====================
// Search filter
// ====================

export function setCurrentFilteredStations(stations) {

    currentFilteredStations = stations;
}


export function getCurrentFilteredStations() {

    return currentFilteredStations;
}



// ====================
// Display mode ( Bikes / Docks )
// ====================

export function setDisplayMode(mode) {

    displayMode = mode;
}


export function getDisplayMode() {

    return displayMode;
}



// ====================
// Search state
// ====================

export function setSearching(value) {

    isSearching = value;
}


export function getSearching() {

    return isSearching;
}