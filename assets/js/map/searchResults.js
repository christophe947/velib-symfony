import { navigation } from './navigation.js';
import {
    highlightMarker,
    resetHighlightedMarker
} from './markers.js';



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
    
                const station = stations.find(
                    s => s.id == item.dataset.id
                );
                
                if (!station) return;

                item.addEventListener('mouseenter', () => {
                    
                    highlightMarker(station.id);
                });

                item.addEventListener('mouseleave', () => {
                    resetHighlightedMarker();
                });

                item.addEventListener('pointerdown', () => {
    
                    container.innerHTML = "";
                    
                    const searchInput = document.getElementById('station-search');
                    
                    if (searchInput) {
                        
                        searchInput.value = "";
                    }
                    
                    console.log("focus suite a click station liste");
                    
                    setOpenedStation(station.id);
                    navigation.focusStation(station);

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
        
                    actions.endSearch?.();
        //actions.clearSearchState?.();
    
                });
                
            });
}