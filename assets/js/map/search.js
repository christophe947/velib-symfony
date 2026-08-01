import L from 'leaflet';
import { navigation } from './navigation.js';
import { showStationList } from './searchResults.js';
import {
    setCurrentFilteredStations,
    getDisplayMode,
} from './state.js';



export function clearSearchState() {
    
    setCurrentFilteredStations(null);
    
    const searchInput = document.getElementById('station-search');

    if (searchInput) {
        searchInput.value = "";
    }

    const container = document.getElementById('station-results');

    if (container) {
        container.innerHTML = "";
    }
}


function restoreSearchMapView() {

    if (navigation.mode !== "savedView") {

        navigation.initDefaultView();

    } else {
        navigation.restoreUserView();
    }    
}


function handleSearchBlur() {

    setTimeout(() => {

        const container =
            document.getElementById('station-results');

        if (container) {
            container.innerHTML = "";
        }

    }, 200);
}


function handleSearchFocus(
    searchInput,
    stations,
    map,
    markersLayer,
    updateStationPanel,
    renderMarkers,
    setOpenedStation,
    actions
) {

    const value = searchInput.value.toLowerCase();

    if (!value) return;

    const filtered = stations.filter(station =>
        station.name.toLowerCase().includes(value)
    );

    showStationList(
        filtered,
        stations,
        map,
        markersLayer,
        getDisplayMode(),
        updateStationPanel,
        renderMarkers,
        setOpenedStation,
        actions
    );

}


function handleSearchKeydown(e) {

    console.log("tappe lettre");

    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
    }
}


function updateSearchResults(
    value,
    stations,
    map,
    markersLayer,
    updateStationPanel,
    renderMarkers,
    setOpenedStation,
    actions
) {

    const filtered = stations.filter(station =>
        station.name.toLowerCase().includes(value)
    );

    setCurrentFilteredStations(filtered);

    showStationList(
        filtered,
        stations,
        map,
        markersLayer,
        getDisplayMode(),
        updateStationPanel,
        renderMarkers,
        setOpenedStation,
        actions
    );

    renderMarkers(
        map,
        markersLayer,
        filtered,
        getDisplayMode(),
        updateStationPanel,
        false,
        actions
    );

    if (filtered.length) {

        const bounds = L.latLngBounds(
            filtered.map(station => [
                station.latitude,
                station.longitude
            ])
        );

        navigation.startProgrammaticMove();

        map.flyToBounds(bounds, {
            padding: [40, 40],
            duration: 0.5
        });
    }
}


export function initSearch(options) {

   const {
    stations,
    map,
    markersLayer,
    updateStationPanel,
    renderMarkers,
    setOpenedStation,
    actions
} = options;

    const searchInput =
        document.getElementById('station-search');

    if (!searchInput) {
        return;
    }

    // 1) Enter
    searchInput.addEventListener('keydown', (e) => {
       handleSearchKeydown(e);
    });

    // 2) Blur
    searchInput.addEventListener('blur', () => {
        handleSearchBlur();
    });

    // 3) Focus
    searchInput.addEventListener('focus', () => {
        handleSearchFocus(
            searchInput,
            stations,
            map,
            markersLayer,
            updateStationPanel,
            renderMarkers,
            setOpenedStation,
            actions
        );
    });

    searchInput.addEventListener('input', () => {
        // debounce à réintroduire pour recherche API externe
        /*if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        searchTimeout = setTimeout(() => {*/

            const value = searchInput.value.toLowerCase();

            if (!value.trim()) {   

                actions.endSearch();
                
                restoreSearchMapView();

                renderMarkers(
                    map,
                    markersLayer,
                    stations,
                    getDisplayMode(),
                    updateStationPanel,
                    false,
                    actions
                );
                return;
            }

            if (!actions.isSearching?.()) {
                actions.startSearch();
            }

            updateSearchResults(
                value,
                stations,
                map,
                markersLayer,
                updateStationPanel,
                renderMarkers,
                setOpenedStation,
                actions
            );
        /*}, 400);*/
    });
}