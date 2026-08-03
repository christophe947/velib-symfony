import { getAvailabilityColor } from './availability.js';
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
    
        container.innerHTML = list.slice(0,20).map(station => {

            const color = getAvailabilityColor(station, displayMode);
            
            return `
                <div 
                    class="mb-3 station-item"
                    data-id="${station.id}"
                    style="cursor:pointer">
        
                    <span 
                        class="station-status-dot"
                        style="background:${color}">
                    </span>
                    &nbsp
                    <strong>
                        ${station.name}
                    </strong>

                    <br>
                    &nbsp &nbsp &nbsp
        
                    🚲 ${station.bikes}
                    &nbsp
                    🅿️ ${station.docks}
        
                </div>
            `; 
        })
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

                let startY = 0;

                item.addEventListener('pointerdown', (e) => {
                    startY = e.clientY;
                });


                item.addEventListener('pointerup', (e) => {

                    const diff = Math.abs(e.clientY - startY);

                    // Si le doigt a bougé, c'est un scroll
                    if (diff > 10) {
                        return;
                    }

                    // Sinon c'est une sélection
                    container.innerHTML = "";

                    const searchInput = document.getElementById('station-search');

                    if (searchInput) {
                        searchInput.value = "";
                    }

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

                });

                
                
            });
}