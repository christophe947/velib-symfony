
import { CupertinoPane } from 'cupertino-pane';
import { 
    subscribeToSelectedStation,
    setDisplayMode
 } from './state.js';
import { requestUserPosition } from './geolocation.js';
import {
    getWalkingRoute,
    decodePolyline
} from './routing.js';
import { drawWalkingRoute } from './map.js';

let pane = null;
let element = null;

const mobileQuery = window.matchMedia(
    '(max-width: 767px)'
);

let currentMode = 'bikes';

export function initStationPanel(map) {

    element = document.querySelector(
        '#station-content'
    );

    if (!element) {
        return;
    }

    // Le panneau vide est présent dès le lancement
    // sur mobile comme sur desktop.
    renderEmptyPanel();

    if (mobileQuery.matches) {

        pane = new CupertinoPane(
            element,
            {
                parentElement: 'body',
                initialBreak: 'bottom',
                showCloseButton: false,
                dragByCursor: true,
                clickBottomOpen: false,

                breaks: {
                    top: {
                        enabled: true,
                        height: window.innerHeight - 80,
                        bounce: true
                    },

                    middle: {
                        enabled: true,
                        height: 275,
                        bounce: true
                    },

                    bottom: {
                        enabled: true,
                        height: 70
                    }
                }
            }
        );

        pane.present({
            animate: false
        });

    } else {

        // Desktop : panneau classique
        element.classList.add('is-open');
    }
    subscribeToSelectedStation(
        station => updateStationPanel(station, map)
    );
    //subscribeToSelectedStation(updateStationPanel, map);
}

function renderModeSelector() {

    return `
        <div class="station-panel-mode-selector">

            <button
                type="button"
                class="${currentMode === 'bikes' ? 'active' : ''}"
                data-mode="bikes"
            >
                🚲 Vélos
            </button>

            <button
                type="button"
                class="${currentMode === 'electric' ? 'active' : ''}"
                data-mode="electric"
            >
                🔋 Électriques
            </button>

            <button
                type="button"
                class="${currentMode === 'docks' ? 'active' : ''}"
                data-mode="docks"
            >
                🅿️ Places
            </button>

            <span class="station-panel-mode-indicator"></span>

        </div>
    `;
}

function renderEmptyPanel() {

    element.innerHTML = `
        <div class="station-panel-empty">

            ${renderModeSelector()}

        </div>
    `;
    initModeSelector();
}

function updateStationPanel(station, map) {

    if (!station || !element) {
        return;
    }

    element.innerHTML = `
        <div class="station-panel-content">

            <h2 class="station-panel-title">
                ${station.name ?? 'Station Vélib'}
            </h2>

            <p class="station-panel-address">
                ${station.address ?? ''}
            </p>

            <div class="station-panel-stats">

                <div class="station-panel-stat">
                    <span class="station-panel-stat-icon">🚲</span>
                    <strong>${station.bikes ?? 0}</strong>
                    <span>vélos</span>
                </div>

                <div class="station-panel-stat">
                    <span class="station-panel-stat-icon">🔋</span>
                    <strong>${station.electricBikes ?? 0}</strong>
                    <span>électriques</span>
                </div>

                <div class="station-panel-stat">
                    <span class="station-panel-stat-icon">🅿️</span>
                    <strong>${station.docks ?? 0}</strong>
                    <span>places</span>
                </div>

            </div>

            <button type="button" class="station-panel-join">
                Rejoindre
            </button>

            ${renderModeSelector()}

        </div>
    `;

    const joinButton = element.querySelector(
        '.station-panel-join'
    );

    joinButton?.addEventListener('click', async () => {

        try {

            const userPosition = await requestUserPosition();

            const route = await getWalkingRoute(
                userPosition,
                {
                    latitude: station.latitude,
                    longitude: station.longitude
                }
            );

            const coordinates = decodePolyline(
                route.legs[0].shape
            );

            drawWalkingRoute(
                map,
                coordinates
            );

        } catch (error) {

            console.error(
                'Impossible de calculer l’itinéraire :',
                error
            );
        }
    });


    initModeSelector();


    if (mobileQuery.matches && pane) {

        pane.present({
            animate: true
        });

        pane.moveToBreak('middle');

        return;
    }

    // Desktop
    element.classList.add('is-open');
}


function initModeSelector() {

    const selector = element.querySelector(
        '.station-panel-mode-selector'
    );

    if (!selector) {
        return;
    }

    const buttons = selector.querySelectorAll('button');
    const indicator = selector.querySelector(
        '.station-panel-mode-indicator'
    );

    function updateIndicator() {

        const activeButton = selector.querySelector(
            'button.active'
        );

        if (!activeButton || !indicator) {
            return;
        }

        indicator.style.width = `${activeButton.offsetWidth}px`;

        indicator.style.transform = `
            translateX(${activeButton.offsetLeft}px)
        `;
    }

    buttons.forEach(button => {

        button.addEventListener('click', event => {

            event.stopPropagation();

            const mode = button.dataset.mode;

            if (!mode) {
                return;
            }

            currentMode = mode;

            setDisplayMode(mode);

            buttons.forEach(item => {
                item.classList.toggle(
                    'active',
                    item.dataset.mode === currentMode
                );
            });

            updateIndicator();
        });

    });

    updateIndicator();
}