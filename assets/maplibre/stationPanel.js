import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';
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
    showDestinationMarker,
    updateWalkingRoute,
    setUserFollowing,
    setNavigationActive,
    followUserPosition,
    updateCameraFromCompass,
    clearNavigationMap,
    ensure2DView,
    startBackgroundUserTracking,
    stopBackgroundUserTracking,
    activateCompass
 } from './map.js';
import {
    setNavigationRoute,
    updateNavigationProgress,
    startNavigationSimulation,
    startOffRouteSimulation,
    stopNavigationProcessing
} from './navigation.js'; 
import {
    setRouteSummaryCallback
} from './routeSummary.js';
import {
    formatDistance,
    formatDuration
} from './routeFormatting.js';
import { startCompass,stopCompass } from './compass.js';

let pane = null;
let element = null;
let navigationStarted = false;
let navigationSessionId = 0;

let positionWatchId = null;

// Dernière position GPS connue.
let lastKnownUserPosition = null;
let lastCompassLogTime = 0;
let currentRouteCoordinates = [];
let lastRouteProgressIndex = 0;

const mobileQuery = window.matchMedia(
    '(max-width: 767px)'
);

let currentMode = 'bikes';







/**
 * Met à jour les informations de distance et de durée
 * affichées dans le panneau de navigation.
 */
export function updateRouteSummary(distance, duration) {
    if (!element) {
        return;
    }

    const routeSummary = element.querySelector(
        '.station-panel-route-summary'
    );

    if (!routeSummary) {
        return;
    }

    routeSummary.innerHTML = `
        <span>📍 ${distance}</span>
        <span>🚶 ${duration}</span>
    `;

    routeSummary.style.display = 'flex';
}



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
}



export function initStationPanel(map) {

    element = document.querySelector(
        '#station-content'
    );

    if (!element) {
        return;
    }
    setRouteSummaryCallback(updateRouteSummary);
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
                //animationDuration: 500,

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


/**
 * Demande confirmation avant d'arrêter la navigation.
 */
function showStopNavigationConfirmation(map, station) {
    // Évite d'afficher plusieurs fenêtres.
    if (element.querySelector('.navigation-confirmation-overlay')) {
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'navigation-confirmation-overlay';

    overlay.innerHTML = `
        <div
            class="navigation-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="navigation-confirmation-title"
        >
            <h3 id="navigation-confirmation-title">
                Arrêter la navigation ?
            </h3>

            <p>
                Es-tu sûr de vouloir arrêter ton itinéraire ?
            </p>

            <div class="navigation-confirmation-actions">
                <button
                    type="button"
                    class="navigation-confirmation-cancel"
                >
                    Continuer
                </button>

                <button
                    type="button"
                    class="navigation-confirmation-stop"
                >
                    Arrêter
                </button>
            </div>
        </div>
    `;

    //element.appendChild(overlay);
    document.body.appendChild(overlay);

    const cancelButton = overlay.querySelector(
        '.navigation-confirmation-cancel'
    );

    const confirmButton = overlay.querySelector(
        '.navigation-confirmation-stop'
    );

    // Ferme la fenêtre sans interrompre la navigation.
    cancelButton.addEventListener('click', () => {
        overlay.remove();
    });

    // Confirme l'arrêt de la navigation.
    confirmButton.addEventListener('click', () => {
        overlay.remove();
        stopNavigation(map, station);
    });

    // Ferme aussi la fenêtre en cliquant sur le fond.
    overlay.addEventListener('click', event => {
        if (event.target === overlay) {
            overlay.remove();
        }
    });

    cancelButton.focus();
}



/**
 * Arrête complètement la navigation en cours.
 */
function stopNavigation(map, station) {
    // Invalide les opérations asynchrones de la session.
    navigationSessionId++;
    navigationStarted = false;

    // Arrête le suivi GPS.
    if (positionWatchId !== null) {
        navigator.geolocation.clearWatch(positionWatchId);
        positionWatchId = null;
    }

    // Arrête la boussole.
    stopCompass();

    // Désactive le suivi automatique de la caméra.
    setUserFollowing(false);

    // Arrête les simulations et invalide les recalculs.
    stopNavigationProcessing();

    // Nettoie le tracé et le marqueur de destination.
    clearNavigationMap(map);

    setUserFollowing(true);
    startBackgroundUserTracking(map);

    // Réinitialise l'état local.
    //navigationStarted = false;
    lastKnownUserPosition = null;

    // Réinitialise l'affichage de la boussole.
    const compassDisplay = element.querySelector(
        '.station-panel-compass-status'
    );

    if (compassDisplay) {
        compassDisplay.textContent = '';
    }

    // Restaure le bouton permettant de recalculer l'itinéraire.
    const controls = element.querySelector(
        '.station-panel-navigation-controls'
    );

    if (controls) {
        controls.innerHTML = `
            <button
                type="button"
                class="station-panel-join"
            >
                Rejoindre
            </button>
        `;
    }

    // Réinitialise le résumé et les boutons de test.
    const routeSummary = element.querySelector(
        '.station-panel-route-summary'
    );

    if (routeSummary) {
        routeSummary.innerHTML = '';
        routeSummary.style.display = 'none';
    }

    element.querySelectorAll(
        '.station-panel-simulate'
    ).forEach(button => button.remove());

    // Réafficher le panneau de la station avec ses gestionnaires de clic.
    if (station) {
        updateStationPanel(station, map);
    }

    console.log('🛑 Navigation arrêtée.');

}


async function updateStationPanel(station, map) {

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

            <div
                class="station-panel-compass-status"
                role="status"
                aria-live="polite"
            ></div>

            <div class="station-panel-message" role="status" aria-live="polite" hidden></div>

            <div class="station-panel-navigation-controls">
                <button type="button" class="station-panel-join">
                    Rejoindre
                </button>
            </div>


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

            await updateBottomHeight(bottomHeight);
        }
    }


    const joinButton = element.querySelector(
        '.station-panel-join'
    );

    const routeSummary = element.querySelector(
        '.station-panel-route-summary'
    );

    const routeMessage = element.querySelector(
        '.station-panel-message'
    );


    joinButton?.addEventListener('click', async () => {


    if (navigationStarted) {
        return;
    }

    // Identifie cette opération asynchrone.
    const sessionId = ++navigationSessionId;

    if (joinButton.textContent.trim() === 'Démarrer') {
        stopBackgroundUserTracking();
        navigationStarted = true;
        setNavigationActive(true);
        setUserFollowing(true);

        const isSessionActive = () =>
        navigationStarted &&
        sessionId === navigationSessionId;

        joinButton.disabled = true;
        joinButton.textContent = 'Démarrage…';

        let isInitialCameraSetup = true;

        await activateCompass(
            map,
    
            reading => {

                /*if (!isInitialCameraSetup) {
                    updateCameraFromCompass(map, reading);
                }*/

                const compassDisplay = element.querySelector(
                '.station-panel-compass-status'
                );


                if (compassDisplay) {
                    compassDisplay.textContent =
                        reading.compassHeading !== null
                            ? `🧭 Boussole active — Cap : ${Math.round(reading.compassHeading)}°`
                            : '🧭 Boussole active — Cap indisponible';
                }
            },
            error => {
                const compassDisplay = element.querySelector(
                    '.station-panel-compass-status'
                );

                if (compassDisplay) {
                    compassDisplay.textContent =
                        `⚠️ Boussole indisponible : ${error.message}`;
                }
            },
            () => !isInitialCameraSetup


        );

        if (!isSessionActive()) {
            return;
        }


        
        const waitForCameraMove = () => new Promise(resolve => {
            
            if (!map.isMoving()) {
                resolve();
                return;
            }

            map.once('moveend', resolve);
        });

        if (!isSessionActive()) {
            return;
        }

        const viewButton = map
            .getContainer()
            .querySelector('.map-view-button');

        // Position GPS connue au moment du démarrage.
        const cameraCenter = lastKnownUserPosition
            ? [
                lastKnownUserPosition.longitude,
                lastKnownUserPosition.latitude
            ]
            : [
                map.getCenter().lng,
                map.getCenter().lat
            ];

        if (lastKnownUserPosition) {
            showUserMarker(map, lastKnownUserPosition);
        }

        // 1. Centrer et zoomer d'abord en 2D.
        map.easeTo({
            center: cameraCenter,
            zoom: 17,
            pitch: 0,
            duration: 500,
            essential: true
        });

        await waitForCameraMove();

        if (!isSessionActive()) {
            return;
        }

        // 2. Passer ensuite en 3D.
        if (viewButton?.textContent.trim() === '3D') {
            viewButton.click();

            await waitForCameraMove();
            if (!isSessionActive()) {
                return;
            }
}

// 3. La caméra est prête : la boussole peut reprendre la main.
isInitialCameraSetup = false;

        await waitForCameraMove();

        if (!isSessionActive()) {
            return;
        }

        positionWatchId = startWatchingPosition(
            position => {

                lastKnownUserPosition = position;
                showUserMarker(map, position);
                followUserPosition(map, position);
                //updateRouteProgress(position, map);
                 updateNavigationProgress(position, map);
                 
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
         
        //if (!isSessionActive()) {
        //    return;
        //}

        //joinButton.disabled = false;
        //joinButton.textContent = 'Navigation en cours';
        const controls = element.querySelector(
            '.station-panel-navigation-controls'
        );

        if (controls) {
            controls.innerHTML = `
                <button
                    type="button"
                    class="station-panel-join"
                    disabled
                >
                    Navigation en cours
                </button>

                <button
                    type="button"
                    class="station-panel-stop"
                    aria-label="Arrêter la navigation"
                    title="Arrêter la navigation"
                >
                    ✕
                </button>
            `;

            const stopButton = controls.querySelector(
                '.station-panel-stop'
            );

            stopButton.addEventListener('click', () => {
                showStopNavigationConfirmation(map, station);
            });
        }
                
                // 📱 Réduit le panneau après 2 secondes.
                if (pane && mobileQuery.matches) {
                    setTimeout(() => {
                        pane.moveToBreak('bottom');
                    }, 2000);
                }

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
            
            await ensure2DView();

            
        if (routeMessage) {
            routeMessage.hidden = true;
            routeMessage.textContent = '';
        }

        try {

            const userPosition = await requestUserPosition();
            
            lastKnownUserPosition = userPosition;

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

            //setNavigationRoute(coordinates);
            setNavigationRoute(
                coordinates,
                {
                    latitude: station.latitude,
                    longitude: station.longitude
                }
            );
            

            //currentRouteCoordinates = coordinates;
            //lastRouteProgressIndex = 0;

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


                const simulationButton = document.createElement('button');

                simulationButton.type = 'button';
                simulationButton.textContent = '🧪 Simuler le trajet';
                simulationButton.className = 'station-panel-simulate';

                simulationButton.addEventListener('click', () => {

                    simulationButton.disabled = true;
                    simulationButton.textContent = 'Simulation en cours…';

                    startNavigationSimulation(map, () => {
                        simulationButton.disabled = false;
                        simulationButton.textContent = '🧪 Simuler le trajet';
                    });

                });

                routeSummary.after(simulationButton);



                const offRouteButton = document.createElement('button');

                offRouteButton.type = 'button';
                offRouteButton.textContent = '🧭 Tester une déviation';
                offRouteButton.className = 'station-panel-simulate';

                offRouteButton.addEventListener('click', () => {
                    startOffRouteSimulation(map);
                });

                simulationButton.after(offRouteButton);



                if (pane && mobileQuery.matches) {

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
                }
            }

        } catch (error) {

            console.error(
                'Impossible de calculer l’itinéraire :',
                error
            );

            if (routeMessage) { 
                routeMessage.hidden = false; 
                if ( error instanceof Error && error.message === 'Geolocation unavailable' ) { 
                    routeMessage.textContent = '📍 La géolocalisation n’est pas disponible sur cet appareil.';
                } else { 
                    routeMessage.textContent = '📍 Autorise la localisation dans ton navigateur pour calculer l’itinéraire.';
                } 
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
            }
            
        } finally {
            joinButton.disabled = false;

            joinButton.textContent = 
                navigationStarted 
                    ? 'Navigation en cours' 
                    : routeMessage && !routeMessage.hidden
                        ? 'Rejoindre'
                        : joinButton.textContent === 'Démarrer'
                            ? 'Démarrer'
                            : 'Rejoindre';
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

