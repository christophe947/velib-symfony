
import { CupertinoPane } from 'cupertino-pane';
import { 
    subscribeToSelectedStation,
    setDisplayMode
 } from './state.js';
import { 
    requestUserPosition,
    showUserMarker,
    startWatchingPosition
 } from './geolocation.js';
import {
    getWalkingRoute,
    decodePolyline
} from './routing.js';
import { 
    drawWalkingRoute,
    fitWalkingRoute,
    showDestinationMarker
 } from './map.js';



let pane = null;
let element = null;
let navigationStarted = false;
let positionWatchId = null;

const mobileQuery = window.matchMedia(
    '(max-width: 767px)'
);

let currentMode = 'bikes';

async function updateMiddleHeight(height) {

    if (!pane) {
        return;
    }

    pane.settings.breaks.middle.height = height;

    // Recalcule réellement les breakpoints internes
    await pane.breakpoints.buildBreakpoints(
        pane.settings.breaks,
        0,
        false
    );

    // Le nouveau middle devient le breakpoint courant
    pane.breakpoints.currentBreakpoint =
        pane.breakpoints.breaks.middle;

    pane.breakpoints.prevBreakpoint = 'middle';

    // Position visuelle
    await pane.moveToHeight(height);
}

async function updateBottomHeight(height) {

    if (!pane) {
        return;
    }

    pane.settings.breaks.bottom.height = height;

    await pane.breakpoints.buildBreakpoints(
        pane.settings.breaks,
        0,
        false
    );

    pane.breakpoints.currentBreakpoint =
        pane.breakpoints.breaks.bottom;

    pane.breakpoints.prevBreakpoint = 'bottom';

    await pane.moveToHeight(height);
}

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
                        height: 270,
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

    if (pane) {
        requestAnimationFrame(() => {

            const content = element.querySelector(
                '.station-panel-empty'
            );

            if (!content) {
                return;
            }

            const bottomHeight =
                content.getBoundingClientRect().height;

            updateBottomHeight(bottomHeight);
        });
    }
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

            <div class="station-panel-route-summary"></div>

            <button type="button" class="station-panel-join">
                Rejoindre
            </button>

            ${renderModeSelector()}

        </div>
    `;

    if (mobileQuery.matches && pane) {

        const title = element.querySelector(
            '.station-panel-title'
        );

        if (title) {

            const bottomHeight =
                title.getBoundingClientRect().height + 30;

            updateBottomHeight(bottomHeight);
        }
    }

    const joinButton = element.querySelector(
        '.station-panel-join'
    );

    const routeSummary = element.querySelector(
        '.station-panel-route-summary'
    );

    joinButton?.addEventListener('click', async () => {


    if (navigationStarted) {
        return;
    }

    if (joinButton.textContent.trim() === 'Démarrer') {

        navigationStarted = true;

        joinButton.disabled = true;
        joinButton.textContent = 'Démarrage…';

        positionWatchId = startWatchingPosition(
            position => {

                showUserMarker(map, position);

                console.log(
                    'Nouvelle position GPS :',
                    position
                );
            },
            error => {

                console.error(
                    'Erreur GPS :',
                    error
                );
            }
        );

        joinButton.disabled = false;
        joinButton.textContent = 'Navigation en cours';

        return;
    }

    joinButton.disabled = true;

    joinButton.innerHTML = `
        <span
            class="spinner-border spinner-border-sm me-2"
            aria-hidden="true"
        ></span>
        Calcul de l'itinéraire…
    `;
        /*joinButton.disabled = true;

        joinButton.innerHTML = `
            <span
                class="spinner-border spinner-border-sm me-2"
                aria-hidden="true"
            ></span>
            Calcul de l'itinéraire…
        `;*/

        try {

            const userPosition = await requestUserPosition();

            showUserMarker(map, userPosition);

            const route = await getWalkingRoute(
                userPosition,
                {
                    latitude: station.latitude,
                    longitude: station.longitude
                }
            );

            const distance = formatDistance(
                route.summary.length
            );

            const duration = formatDuration(
                route.summary.time
            );

            const coordinates = decodePolyline(
                route.legs[0].shape
            );

            drawWalkingRoute(
                map,
                coordinates
            );

            fitWalkingRoute(
                map,
                coordinates
            );

            showDestinationMarker(map, {
                latitude: station.latitude,
                longitude: station.longitude
            });

            navigationStarted = false;

            joinButton.textContent = 'Démarrer';
            

            if (routeSummary) {
                routeSummary.innerHTML = `
                    <span>📍 ${distance}</span>
                    <span>🚶 ${duration}</span>
                `;

                routeSummary.style.display = 'flex';

                if (pane && mobileQuery.matches) {

                    const content = element.querySelector(
                        '.station-panel-content'
                    );

                    if (content) {
                        const middleHeight =
                            content.getBoundingClientRect().height;

                        updateMiddleHeight(middleHeight);
                    }
                }
            }

        } catch (error) {

            console.error(
                'Impossible de calculer l’itinéraire :',
                error
            );
        } finally {
            joinButton.disabled = false;

            joinButton.textContent =
                navigationStarted
                    ? 'Navigation en cours'
                    : 'Démarrer';
                }
    });


    initModeSelector();


    if (mobileQuery.matches && pane) {

        const content = element.querySelector(
            '.station-panel-content'
        );

        pane.present({
            animate: true
        });

        if (content) {
            const middleHeight =
                content.getBoundingClientRect().height;

            updateMiddleHeight(middleHeight);
        }

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

function formatDistance(kilometers) {

    const meters = Math.round(kilometers * 1000);

    if (meters < 1000) {
        return `${meters} m`;
    }

    return `${kilometers.toFixed(1)} km`;
}

function formatDuration(seconds) {

    const minutes = Math.round(seconds / 60);

    if (minutes < 60) {
        return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return remainingMinutes > 0
        ? `${hours} h ${remainingMinutes}`
        : `${hours} h`;
}


