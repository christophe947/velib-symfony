import L from 'leaflet';
import { navigation } from './navigation.js';
import { clearCurrentFilteredStations } from './search.js';
//import { getCurrentFilteredStations } from './search.js';
import {
    getAvailabilityRate,
    getAvailabilityColor
} from './availability.js';
import {
    setOpenedStation,
    getOpenedStation
} from './state.js';




function createIcon(color) {

    return L.divIcon({

        className:'',

        html:`
        <div style="
            background:${color};
            width:20px;
            height:20px;
            border-radius:50%;
            border:3px solid white;
        ">
        </div>
        `,

        iconSize:[20,20]
    });
}


export function renderMarkers(
    map,
    markersLayer,
    stations,
    displayMode,
    updateStationPanel,
    shouldZoom = false,
    actions = {}
) {
    
    markersLayer.clearLayers();

    stations.forEach(station => {

        /*const value =
            displayMode === 'bikes'
            ? station.bikes
            : station.docks;*/

        const rate = getAvailabilityRate(
            station,
            displayMode
        );
        

        const marker = L.marker(
            [
                station.latitude,
                station.longitude
            ],
            {
                icon:createIcon(
                    getAvailabilityColor(
                        station,
                        displayMode
                    )
                )
            }
        );

        marker.bindPopup(`
            <strong>${station.name}</strong><br>
            🚲 ${station.bikes} vélos<br>
            🅿️ ${station.docks} places
        `);

        marker.on('click',()=>{
    
            navigation.restoreAfterSearch(station);
        
            navigation.saveUserView();
        
            setOpenedStation(station.id);
        
            clearCurrentFilteredStations();
        
            renderMarkers(
                map,
                markersLayer,
                actions.getAllStations(),
                displayMode,
                updateStationPanel,
                false,
                actions
            ); 
   
            updateStationPanel(station);

            actions.endSearch?.();

            actions.clearSearchState?.();
        });
            
        markersLayer.addLayer(marker);

        // 👇 restaure le popup après changement de mode a verif
        if (getOpenedStation() == station.id) {

            if (shouldZoom) {

                map.setView(
                    [
                        station.latitude,
                        station.longitude
                    ],
                    16
                );
            }

            updateStationPanel(station);

            marker.openPopup();
        }
    });
}