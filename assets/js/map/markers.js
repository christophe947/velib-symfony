import L from 'leaflet';

let openedStation = null;

export function setOpenedStation(id) {

    openedStation = id;

}


function getMarkerColor(value) {

    if (value >= 10) {
        return 'green';
    }

    if (value > 0) {
        return 'orange';
    }

    return 'red';
}


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
    shouldZoom = false
) {


    markersLayer.clearLayers();


    stations.forEach(station => {


        const value =
            displayMode === 'bikes'
            ? station.bikes
            : station.docks;



        const marker = L.marker(
            [
                station.latitude,
                station.longitude
            ],
            {
                icon:createIcon(
                    getMarkerColor(value)
                )
            }
        );


        marker.bindPopup(`
            <strong>${station.name}</strong><br>
            🚲 ${station.bikes} vélos<br>
            🅿️ ${station.docks} places
        `);



        marker.on('click',()=>{

            //openedStation = station.id;
            setOpenedStation(station.id);


            updateStationPanel(station);

        });



        markersLayer.addLayer(marker);



        // 👇 restaure le popup après changement de mode
        if (openedStation == station.id) {

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