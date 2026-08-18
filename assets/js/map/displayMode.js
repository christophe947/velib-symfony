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

    const electricButton =
        document.getElementById('mode-electric');


    const docksButton =
        document.getElementById('mode-docks');



    function updateModeButtons() {

        if (!bikesButton || !docksButton || !electricButton) {
            return;
        }

        const mode = getDisplayMode();

        bikesButton.className =
            mode === 'bikes'
                ? 'btn btn-primary active mode-bikes'
                : 'btn btn-outline-primary mode-bikes';

        electricButton.className =
            mode === 'electric'
                ? 'btn btn-primary active mode-electric'
                : 'btn btn-outline-primary mode-electric';

        docksButton.className =
            mode === 'docks'
                ? 'btn btn-primary active mode-docks'
                : 'btn btn-outline-primary mode-docks';
        


        /*if (getDisplayMode() === 'bikes') {

            bikesButton.className =
                'btn btn-primary active';

            docksButton.className =
                'btn btn-outline-primary';

        } else {

            docksButton.className =
                'btn btn-primary active';

            bikesButton.className =
                'btn btn-outline-primary';

        }*/
    }


    

    
    bikesButton?.addEventListener('click', () => {

        //navigation.startProgrammaticMove();

        setDisplayMode('bikes');


        updateModeButtons();


        renderMarkers(
            map,
            markersLayer,
            getCurrentFilteredStations() ?? stations,
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

    

    electricButton?.addEventListener('click', () => {

        setDisplayMode('electric');

        updateModeButtons();

        renderMarkers(
            map,
            markersLayer,
            getCurrentFilteredStations() ?? stations,
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

        //navigation.startProgrammaticMove();

        setDisplayMode('docks');


        updateModeButtons();


        renderMarkers(
            map,
            markersLayer,
            getCurrentFilteredStations() ?? stations,
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