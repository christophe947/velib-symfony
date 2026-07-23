import L from 'leaflet';
import { navigation } from './navigation.js';
import { showStationList } from './searchResults.js';
import {
    setCurrentFilteredStations,
    getCurrentFilteredStations,
    getDisplayMode,
    getSearching
} from './state.js';
import {
    highlightMarker,
    resetHighlightedMarker
} from './markers.js';

console.log("exports search chargés");





let searchTimeout = null;


export function clearSearchState() {

    console.log("CLEAR SEARCH");
    
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



export function initSearch(options) {

   const {
    stations,
    map,
    markersLayer,
    //getDisplayMode,
    updateStationPanel,
    renderMarkers,
    setOpenedStation,
    clearSearchState,
    actions,
    fitStationsBounds
} = options;


    const searchInput =
        document.getElementById('station-search');

        
    if (!searchInput) {
        return;
    }


    // 1) Enter
    searchInput.addEventListener('keydown', (e) => {
        //a chaque letre le mode move from programme activé
        //test a enlever peu etre
         navigation.startProgrammaticMove();
         console.log("tappe lettre");

        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
        }

    });


    // 2) Blur
    searchInput.addEventListener('blur', () => {

        setTimeout(() => {

            const container =
                document.getElementById('station-results');

            if (container) {
                container.innerHTML = "";
            }

        }, 200);

    });


    // 3) Focus
    searchInput.addEventListener('focus', () => {

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
        });




searchInput.addEventListener('input', () => {

    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }

    searchTimeout = setTimeout(() => {

        const value = searchInput.value.toLowerCase();


        if (!value.trim()) {   
            //important pour reset lors du switch par exemple un affichage complet et non filtré avec 4 stations
            setCurrentFilteredStations(null);

            console.log('mode de nav : ', navigation.mode);

            if (navigation.mode !== "savedView") {            
                console.log("search vide sans vue enregistre");

                navigation.initDefaultView();
                //navigation.endtProgrammaticMove();

                //return;
            } else {
                console.log('devrai juste restaure')
                navigation.restoreUserView();
            }
            
            clearSearchState?.();

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


        if (!getSearching?.()) {
            console.log("search en cour");
            // a verifier
            actions.startSearch();
        }

        


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
                padding: [40,40],
                //animate:true,
                duration:0.5
            });
        }
    }, 400);

});

}