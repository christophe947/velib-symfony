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

                    const latLng = [
                        station.latitude,
                        station.longitude
                    ];

                    const bounds = map.getBounds();

                    if (!bounds.contains(latLng)) {
                        map.panTo(latLng, {
                            animate: true,
                            duration: 0.5
                        });
                    }
                });

                item.addEventListener('mouseleave', () => {
                    resetHighlightedMarker();
                });

                item.addEventListener('click', () => {

                    container.innerHTML = "";

                    const searchInput =
                        document.getElementById('station-search');

                    if (searchInput) {
                        searchInput.value = "";
                    }

                    resetHighlightedMarker();

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
                    document.body.classList.remove('search-active');
            
                });
                
            
            });
}