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
    getOpenedStation,
    getDisplayMode
} from './state.js';


const stationMarkers = new Map();

let highlightedMarker = null;

function createIcon(color, size = 20) {

    return L.divIcon({

        className:'station-marker',

        html:`
        <div 
            class="marker-dot"
            style="
                background:${color};
            ">
        </div>
        `,

        iconSize:[20,20],
        iconAnchor:[10,10]
    });
}


export function highlightMarker(stationId) {

    const marker = stationMarkers.get(stationId);

    if (!marker) {
        return;
    }

    highlightedMarker = marker;
    marker.setZIndexOffset(1000);


    const markerElement = marker.getElement();

    if (markerElement) {
        markerElement.classList.add('highlight');
    }

    navigation.startProgrammaticMove();

    marker.once('popupopen', () => {

        const popupElement = marker
            .getPopup()
            .getElement();

        if (popupElement) {
            
           popupElement.classList.add('highlight');
           console.log('popupElement trouvé', popupElement);
        }

    });
    //navigation.startProgrammaticMove(true);
    marker.openPopup();
    
}


export function resetHighlightedMarker() {

    if (!highlightedMarker) {
        return;
    }
    
    const popupElement = highlightedMarker
    .getPopup()
    ?.getElement();

if (popupElement) {
    popupElement.classList.remove('highlight');
}

    const markerElement = highlightedMarker.getElement();

    if (markerElement) {
        
        markerElement.classList.remove('highlight')
    }

    highlightedMarker.setZIndexOffset(0);
    highlightedMarker.closePopup();
    highlightedMarker = null;
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
    stationMarkers.clear();

    stations.forEach(station => {

        
        const rate = getAvailabilityRate(
            station,
            displayMode
        );

        const color = getAvailabilityColor(
            station,
            displayMode
        );
        

        const marker = L.marker(
            [
                station.latitude,
                station.longitude
            ],
            {
                icon:createIcon(color)
            }
            
        );
        
        marker.options.originalColor = color;
        marker.options.stationId = station.id;
        marker.options.station = station;

        marker.bindPopup(`
            <strong>${station.name}</strong><br>
            🚲 ${station.bikes} vélos<br>
            🅿️ ${station.docks} places
        `);

        

        marker.on('click',()=>{
    
            navigation.restoreAfterSearch(station);

            setOpenedStation(station.id);
        
            //clearCurrentFilteredStations();
            actions.clearCurrentFilteredStations?.();
            //actions.clearSearch?.();
        
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

        });

        stationMarkers.set(station.id, marker);
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

//window.highlightMarker = highlightMarker;
//window.resetHighlightedMarker = resetHighlightedMarker;
//console.log("highlightMarker exposé");