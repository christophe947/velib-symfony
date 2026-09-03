import { CupertinoPane } from 'cupertino-pane';
import { subscribeToSelectedStation } from './state.js';

let pane = null;
let element = null;

const mobileQuery = window.matchMedia(
    '(max-width: 767px)'
);

export function initStationPanel() {

    element = document.querySelector(
        '#station-content'
    );

    if (!element) {
        return;
    }

    if (mobileQuery.matches) {

        pane = new CupertinoPane(
            element,
            {
                parentElement: 'body',

                breaks: {
                    top: {
                        enabled: true,
                        height: window.innerHeight - 80,
                        bounce: true
                    },

                    middle: {
                        enabled: true,
                        height: 320,
                        bounce: true
                    },

                    bottom: {
                        enabled: true,
                        height: 80
                    }
                }
            }
        );
    }

    subscribeToSelectedStation(updateStationPanel);
}

function updateStationPanel(station) {

    if (!station || !element) {
        return;
    }

    element.innerHTML = `
        <h2>${station.name ?? 'Station Vélib'}</h2>

        <p>${station.address ?? ''}</p>

        <div>
            🚲 ${station.bikes ?? 0} vélos
        </div>

        <div>
            🔋 ${station.electricBikes ?? 0} électriques
        </div>

        <div>
            🅿️ ${station.docks ?? 0} places
        </div>
    `;

    if (mobileQuery.matches && pane) {
        pane.present({
            animate: true
        });

        return;
    }

    element.classList.add('is-open');
}