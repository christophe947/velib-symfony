import { navigation } from './navigation.js';
import {
    setDisplayMode,
    getDisplayMode,
    getCurrentFilteredStations
} from './state.js';


export function initDisplayMode(options) {

    const {
        map,
        markersLayer,
        stations,
        renderMarkers,
        updateStationPanel,
        updateLegend,
        actions
    } = options;


    const bikesButton =
        document.getElementById('mode-bikes');


    const docksButton =
        document.getElementById('mode-docks');



    function updateModeButtons() {

        if (!bikesButton || !docksButton) {
            return;
        }


        if (getDisplayMode() === 'bikes') {

            bikesButton.className =
                'btn btn-primary active';

            docksButton.className =
                'btn btn-outline-primary';

        } else {

            docksButton.className =
                'btn btn-primary active';

            bikesButton.className =
                'btn btn-outline-primary';

        }
    }



    bikesButton?.addEventListener('click', () => {

        navigation.startProgrammaticMove();

        setDisplayMode('bikes');


        updateModeButtons();


        renderMarkers(
            map,
            markersLayer,
            getCurrentFilteredStations() ?? stations,
            //stations,
            getDisplayMode(),
            updateStationPanel,
            false,
            actions
        );


        updateLegend(
            map,
            getDisplayMode()
        );

    });



    docksButton?.addEventListener('click', () => {

        navigation.startProgrammaticMove();

        setDisplayMode('docks');


        updateModeButtons();


        renderMarkers(
            map,
            markersLayer,
            getCurrentFilteredStations() ?? stations,
            //stations,
            getDisplayMode(),
            updateStationPanel,
            false,
            actions
        );


        updateLegend(
            map,
            getDisplayMode()
        );

    });



    updateModeButtons();

}