/*let openedStation = null;
let currentFilteredStations = null;
let displayMode = 'bikes';

let isSearching = false;
let ignoreNextMove = false;



export function setOpenedStation(stationId) {
    openedStation = stationId;
}


export function getOpenedStation() {
    return openedStation;
}


export function setCurrentFilteredStations(stations) {
    currentFilteredStations = stations;
}


export function getCurrentFilteredStations() {
    return currentFilteredStations;
}


export function setDisplayMode(mode) {
    displayMode = mode;
}


export function getDisplayMode() {
    return displayMode;
}





export function setSearching(value) {
    isSearching = value;
}


export function getSearching() {
    return isSearching;
}


export function setIgnoreNextMove(value) {
    ignoreNextMove = value;
}


export function getIgnoreNextMove() {
    return ignoreNextMove;
}*/


let openedStation = null;

let currentFilteredStations = null;

let displayMode = 'bikes';

let isSearching = false;



// --------------------
// Opened station
// --------------------

export function setOpenedStation(id) {

    openedStation = id;
}


export function getOpenedStation() {

    return openedStation;
}



// --------------------
// Search filter
// --------------------

export function setCurrentFilteredStations(stations) {

    currentFilteredStations = stations;
}


export function getCurrentFilteredStations() {

    return currentFilteredStations;
}



// --------------------
// Display mode
// --------------------

export function setDisplayMode(mode) {

    displayMode = mode;
}


export function getDisplayMode() {

    return displayMode;
}



// --------------------
// Search state
// --------------------

export function setSearching(value) {

    isSearching = value;
}


export function getSearching() {

    return isSearching;
}