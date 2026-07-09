import L from 'leaflet';
import { navigation } from './navigation.js';
import {
    setCurrentFilteredStations,
    getCurrentFilteredStations
} from './state.js';



export function showStationList(
    list,
    stations,
    map,
    markersLayer,
    displayMode,
    updateStationPanel,
    renderMarkers,
    setOpenedStation,
    actions
) {

        const container =
            document.getElementById('station-results');
    
        if (!container) {
            return;
        }
    
        container.innerHTML = list.slice(0,20).map(station => `
    
            <div 
                class="mb-3 station-item"
                data-id="${station.id}"
                style="cursor:pointer">
    
                <strong>
                    ${station.name}
                </strong>
    
                <br>
    
                🚲 ${station.bikes}
                🅿️ ${station.docks}
    
            </div>
    
            `)
            .join('');
    
            container.querySelectorAll('.station-item').forEach(item => {
    
                item.addEventListener('pointerdown', () => {
    
        const station = stations.find(
            s => s.id == item.dataset.id
        );
    
        if (!station) return;
    
    
    container.innerHTML = "";
    
    const searchInput = document.getElementById('station-search');
    
    if (searchInput) {
        
        searchInput.value = "";
    }
    
    console.log("focus suite a click station liste");
    
    setOpenedStation(station.id);

    renderMarkers(
    map,
    markersLayer,
    stations,
    displayMode,
    updateStationPanel,
    false,
    actions
); 
        updateStationPanel(station);
        navigation.focusStation(station);
        //navigation.saveUserView();
        //console.log(navigation.saveUserView);
      
        actions.endSearch?.();
        actions.clearSearchState?.();
    
    });
            });
}

let searchTimeout = null;
setCurrentFilteredStations(null);

export function clearCurrentFilteredStations() {
    setCurrentFilteredStations(null);
    //currentFilteredStations = null;
    console.log("currentFilteredStations appelé", getCurrentFilteredStations());
}

export function cancelSearch() {

    const searchInput = document.getElementById('station-search');

    // reset état recherche
    setSearching(false);

    setCurrentFilteredStations(null);

    console.log("CANCEL SEARCH");

    if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
}

    // vider input + liste
    if (searchInput) {
        searchInput.value = "";
    }

    const container = document.getElementById('station-results');
    if (container) {
        container.innerHTML = "";
    }

    // remettre tous les markers
    renderMarkers(
        map,
        markersLayer,
        stations,
        getDisplayMode(),
        updateStationPanel,
        false,
        actions
    );

    // restaurer la vue sauvegardée si elle existe
    if (navigation.mode === "savedView") {

        navigation.startProgrammaticMove();

        navigation.restoreUserView();

        setTimeout(() => {
    actions.endSearch?.();
}, 300);
    }

    if (!navigation.saveUserView) {
        navigation.initDefaultView();
    }


}

export function initSearch(options) {

   const {
    stations,
    map,
    markersLayer,
    displayMode,
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
                displayMode,
                updateStationPanel,
                renderMarkers,
                setOpenedStation,
                actions
            );
        });




searchInput.addEventListener('input', () => {

     //actions.startSearch();

    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }

    searchTimeout = setTimeout(() => {

        const value = searchInput.value.toLowerCase();


        if (!value.trim()) {   
            //important pour reset lors du switch par exemple un affichage complet et non filtré avec 4 stations
            //currentFilteredStations = null;
            
            setCurrentFilteredStations(null);

            /*const container = document.getElementById('station-results');

if (container) {
    container.innerHTML = "";
}*/

            console.log(navigation.mode);

            if (navigation.mode !== "savedView") {            
                console.log("search vide sans vue enregistre");

                navigation.initDefaultView();
                //navigation.endtProgrammaticMove();

                //return;
            } else {
                
                navigation.restoreUserView();
            }
            
            
            
            
            clearSearchState?.();

            renderMarkers(
                map,
                markersLayer,
                stations,
                displayMode,
                updateStationPanel,
                false,
                actions
            );

            return;
        }


        if (!actions.getSearching?.()) {
            console.log("search en cour");
    //navigation.saveUserView();

    // a verifier
    actions.startSearch();
    

       }

        


        const filtered = stations.filter(station =>
            station.name.toLowerCase().includes(value)
        );


        //currentFilteredStations = filtered;
        setCurrentFilteredStations(filtered);

        showStationList(
            filtered,
            stations,
            map,
            markersLayer,
            displayMode,
            updateStationPanel,
            renderMarkers,
            setOpenedStation,
            actions
        );


        renderMarkers(
            map,
            markersLayer,
            filtered,
            displayMode,
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

            map.flyToBounds(bounds, {
                padding: [40,40],
                //animate:true,
                duration:0.5
            });
        }
    }, 400);

});

}