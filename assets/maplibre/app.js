import { createMap } from 'maplibre/map';
import { initStationPanel } from './stationPanel.js';
import { initSearch } from './search.js';
import { setSelectedStation } from './state.js';

import {
    startCompass,
    stopCompass
} from './compass.js';

const map = createMap();


//initStationPanel();
initStationPanel(map);

//initSearch();
initSearch(map);

//map.resize();

document.addEventListener(
    'station:selected',
    event => {

        const station = event.detail;

        setSelectedStation(station);

        map.flyTo({
            center: [
                station.longitude,
                station.latitude
            ],
            zoom: 16
        });
    }
);











// Test temporaire de la boussole sur téléphone.
/*
const compassStartButton = document.getElementById(
    'compass-test-start'
);

const compassStopButton = document.getElementById(
    'compass-test-stop'
);

const compassOutput = document.getElementById(
    'compass-test-output'
);

if (
    compassStartButton &&
    compassStopButton &&
    compassOutput
) {

    compassStartButton.addEventListener(
        'click',
        async () => {

            compassStartButton.disabled = true;

            compassOutput.textContent =
                'Demande d’accès au capteur...';

            await startCompass(

                reading => {

                    compassOutput.textContent =
                        JSON.stringify(
                            reading,
                            null,
                            2
                        );

                },

                error => {

                    compassOutput.textContent =
                        `Erreur : ${error.message}`;

                    compassStartButton.disabled = false;

                }

            );

            compassStopButton.disabled = false;

        }
    );

    compassStopButton.addEventListener(
        'click',
        () => {

            stopCompass();

            compassStartButton.disabled = false;
            compassStopButton.disabled = true;

            compassOutput.textContent =
                'Test arrêté.';

        }
    );

}*/