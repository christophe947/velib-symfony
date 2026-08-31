let openedStation = null;

let currentFilteredStations = null;

let displayMode = 'bikes';

let isSearching = false;

let stationPanelClosed = false;

let mapBackground = 'watercolor';


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






export function setMapBackground(background) {
    mapBackground = background;
}

export function getMapBackground() {
    return mapBackground;
}





// ====================
// Offcanvas closed state
// ====================



export function setStationPanelClosed(value) {
    stationPanelClosed = value;
}

export function getStationPanelClosed() {
    return stationPanelClosed;
}