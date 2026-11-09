import { CupertinoPane } from 'cupertino-pane';
import { subscribeToSelectedStation, setDisplayMode } from '../shared/state.js';
import {
    requestUserPosition,
    showUserMarker,
    startWatchingPosition,
} from '../location/geolocation.js';
import { getWalkingRoute, decodePolyline } from './routing.js';
import {
    drawWalkingRoute,
    fitWalkingRoute,
    showDestinationMarker,
    updateWalkingRoute,
    setUserFollowing,
    setNavigationActive,
    followUserPosition,
    clearNavigationMap,
    ensure2DView,
    startBackgroundUserTracking,
    stopBackgroundUserTracking,
    activateCompass,
    reactivateCompassIfEligible,
} from '../map.js';
import { createNavigationEngine } from './navigation.js';
import { createScreenWakeLock } from './screenWakeLock.js';
import { formatDistance, formatDuration } from './routeFormatting.js';
import { stopCompass } from './compass.js';

let pane = null;
let element = null;

let panelManuallyAtBottom = true;

let navigationStarted = false;
let navigationSessionId = 0;
let stationPanelRenderId = 0;
let displayedStation = null;
let activeNavigationStation = null;
let activeNavigationRouteSummary = null;
let routeSummaryData = null;

let positionWatchId = null;

// Dernière position GPS connue.
let lastKnownUserPosition = null;
let navigationEngine = null;
const screenWakeLock = createScreenWakeLock();

const mobileQuery = window.matchMedia('(max-width: 767px)');

let currentMode = 'bikes';

function isFreshGpsPosition(position) {
    if (
        !position ||
        !Number.isFinite(position.longitude) ||
        position.longitude < -180 ||
        position.longitude > 180 ||
        !Number.isFinite(position.latitude) ||
        position.latitude < -90 ||
        position.latitude > 90 ||
        !Number.isFinite(position.timestamp) ||
        position.timestamp <= 0
    ) {
        return false;
    }

    const age = Date.now() - position.timestamp;

    return age >= 0 && age <= 10_000;
}

/**
 * Met à jour les informations de distance et de durée
 * affichées dans le panneau de navigation.
 */
function updateRouteSummary(distance, duration) {
    routeSummaryData = { distance, duration };

    if (navigationStarted) {
        activeNavigationRouteSummary = routeSummaryData;
    }

    if (!element) {
        return;
    }

    if (
        navigationStarted &&
        !stationsMatch(displayedStation, activeNavigationStation)
    ) {
        return;
    }

    const routeSummary = element.querySelector('.station-panel-route-summary');

    if (!routeSummary) {
        return;
    }

    routeSummary.innerHTML = `
        <span>📍 ${distance}</span>
        <span>🚶 ${duration}</span>
    `;

    routeSummary.style.display = 'flex';
}

function stationsMatch(first, second) {
    return Boolean(
        first &&
            second &&
            first.id !== undefined &&
            second.id !== undefined &&
            String(first.id) === String(second.id),
    );
}

function renderActiveNavigationControls(map, station, styleReady) {
    const controls = element?.querySelector(
        '.station-panel-navigation-controls',
    );

    if (!controls) {
        return;
    }

    controls.classList.remove('station-panel-navigation-controls--context');
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

    controls.querySelector('.station-panel-stop').addEventListener('click', () => {
        showStopNavigationConfirmation(map, station, styleReady);
    });
}

function appendNavigationSimulationButtons(routeSummary) {
    const simulationButton = document.createElement('button');
    simulationButton.type = 'button';
    simulationButton.textContent = '🧪 Simuler le trajet';
    simulationButton.className = 'station-panel-simulate';

    simulationButton.addEventListener('click', () => {
        simulationButton.disabled = true;
        simulationButton.textContent = 'Simulation en cours…';

        navigationEngine.startNavigationSimulation(() => {
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
        navigationEngine.startOffRouteSimulation();
    });

    simulationButton.after(offRouteButton);
}

async function updateMiddleHeight(height) {
    if (!pane) {
        return;
    }

    pane.settings.breaks.middle.height = height;

    // Recalcule réellement les breakpoints internes
    await pane.breakpoints.buildBreakpoints(pane.settings.breaks, 0, false);

    // Le nouveau middle devient le breakpoint courant
    pane.breakpoints.currentBreakpoint = pane.breakpoints.breaks.middle;

    pane.breakpoints.prevBreakpoint = 'middle';

    panelManuallyAtBottom = false;
    // Position visuelle
    await pane.moveToHeight(height);
}

async function updateBottomHeight(height) {
    if (!pane) {
        return;
    }

    pane.settings.breaks.bottom.height = height;

    await pane.breakpoints.buildBreakpoints(pane.settings.breaks, 0, false);
}

export function initStationPanel(map, styleReady) {
    element = document.querySelector('#station-content');

    if (!element) {
        return;
    }
    navigationEngine = createNavigationEngine({
        showUserMarker: (position) => showUserMarker(map, position),
        followUserPosition: (position) => followUserPosition(map, position),
        updateWalkingRoute: (coordinates) =>
            updateWalkingRoute(map, coordinates),
        updateRouteSummary,
    });

    // Le panneau vide est présent dès le lancement
    // sur mobile comme sur desktop.
    renderEmptyPanel();

    if (mobileQuery.matches) {
        pane = new CupertinoPane(element, {
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
                    bounce: true,
                },

                middle: {
                    enabled: true,
                    height: 270,
                    bounce: true,
                },

                bottom: {
                    enabled: true,
                    height: 70,
                },
            },
        });

        pane.present({
            animate: false,
        });
        pane.on('onDragEnd', () => {
            panelManuallyAtBottom = pane.currentBreak() === 'bottom';

            console.log('Panneau manuellement en bas :', panelManuallyAtBottom);
        });
    } else {
        // Desktop : panneau classique
        element.classList.add('is-open');
    }
    subscribeToSelectedStation((station) =>
        updateStationPanel(station, map, styleReady),
    );

    const lowerSearchPanel = () => {
        if (!pane || !mobileQuery.matches) return;
        if (panelManuallyAtBottom === true) return;

        //panelManuallyAtBottom = false;
        pane.moveToBreak('bottom');
    };

    const restoreSearchPanel = () => {
        if (!pane || !mobileQuery.matches) return;
        if (panelManuallyAtBottom === true) {
            return;
        }
        if (panelManuallyAtBottom === false) {
            pane.moveToBreak('middle');
            console.log('doi revenir');
        }
    };

    document.addEventListener('search:focus', lowerSearchPanel);
    document.addEventListener('search:results', lowerSearchPanel);
    document.addEventListener('search:blur', restoreSearchPanel);
    document.addEventListener('search:results:close', restoreSearchPanel);
    //console.log(pane.currentBreak());
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
            const content = element.querySelector('.station-panel-empty');

            if (!content) {
                return;
            }

            const bottomHeight = content.getBoundingClientRect().height;

            updateBottomHeight(bottomHeight);
        });
    }
}

/**
 * Demande confirmation avant d'arrêter la navigation.
 */
function showStopNavigationConfirmation(map, station, styleReady) {
    // Évite d'afficher plusieurs fenêtres.
    if (document.querySelector('.navigation-confirmation-overlay')) {
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
        '.navigation-confirmation-cancel',
    );

    const confirmButton = overlay.querySelector(
        '.navigation-confirmation-stop',
    );

    // Ferme la fenêtre sans interrompre la navigation.
    cancelButton.addEventListener('click', () => {
        overlay.remove();
    });

    // Confirme l'arrêt de la navigation.
    confirmButton.addEventListener('click', () => {
        overlay.remove();
        stopNavigation(map, station, styleReady);
    });

    // Ferme aussi la fenêtre en cliquant sur le fond.
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            overlay.remove();
        }
    });

    cancelButton.focus();
}

/**
 * Arrête complètement la navigation en cours.
 */
function stopNavigation(map, station, styleReady) {
    // Invalide les opérations asynchrones de la session.
    navigationSessionId++;
    navigationStarted = false;
    activeNavigationStation = null;
    activeNavigationRouteSummary = null;
    routeSummaryData = null;
    screenWakeLock.stop();

    // Arrête le suivi GPS.
    if (positionWatchId !== null) {
        navigator.geolocation.clearWatch(positionWatchId);
        positionWatchId = null;
    }

    // Arrête la boussole.
    stopCompass();

    // Arrête les simulations et invalide les recalculs.
    navigationEngine.stopNavigationProcessing();

    // Nettoie le tracé et le marqueur de destination.
    const wasFollowingUser = clearNavigationMap(map);

    // Le marqueur revient à la dernière coordonnée GPS brute connue.
    if (isFreshGpsPosition(lastKnownUserPosition)) {
        showUserMarker(map, lastKnownUserPosition);
    }

    setUserFollowing(wasFollowingUser);
    startBackgroundUserTracking(map);

    // Redémarre uniquement un capteur déjà autorisé, sans redemander
    // la permission iOS pendant l'arrêt de navigation.
    if (wasFollowingUser) {
        reactivateCompassIfEligible(map);
    }

    // Réinitialise l'état local.
    //navigationStarted = false;
    lastKnownUserPosition = null;
    stationPanelRenderId++;

    // Réinitialise l'affichage de la boussole.
    const compassDisplay = element.querySelector(
        '.station-panel-compass-status',
    );

    if (compassDisplay) {
        compassDisplay.textContent = '';
    }

    // Restaure le bouton permettant de recalculer l'itinéraire.
    const controls = element.querySelector(
        '.station-panel-navigation-controls',
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
    const routeSummary = element.querySelector('.station-panel-route-summary');

    if (routeSummary) {
        routeSummary.innerHTML = '';
        routeSummary.style.display = 'none';
    }

    element
        .querySelectorAll('.station-panel-simulate')
        .forEach((button) => button.remove());

    // Réafficher le panneau de la station avec ses gestionnaires de clic.
    if (station) {
        updateStationPanel(station, map, styleReady);
    }

    console.log('🛑 Navigation arrêtée.');
}

async function updateStationPanel(
    station,
    map,
    styleReady,
    shouldPresentPane = true,
) {
    if (!station || !element) {
        return;
    }

    const renderId = ++stationPanelRenderId;
    displayedStation = station;

    const isActiveNavigationPanel =
        navigationStarted && stationsMatch(station, activeNavigationStation);
    const isNavigationContextPanel =
        navigationStarted && !isActiveNavigationPanel;

    let navigationControls = `
        <div class="station-panel-navigation-controls">
            <button type="button" class="station-panel-join">
                Rejoindre
            </button>
        </div>
    `;

    if (isActiveNavigationPanel) {
        navigationControls = `
            <div class="station-panel-navigation-controls">
                <button type="button" class="station-panel-join" disabled>
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
            </div>
        `;
    } else if (isNavigationContextPanel) {
        navigationControls = `
            <div class="station-panel-navigation-active" role="status">
                Navigation en cours
            </div>
            <div class="station-panel-navigation-controls station-panel-navigation-controls--context">
                <div class="station-panel-context-actions">
                    <button
                        type="button"
                        class="station-panel-join station-panel-context-resume"
                    >
                        Reprendre l'itinéraire
                    </button>
                    <button
                        type="button"
                        class="station-panel-stop"
                        aria-label="Arrêter la navigation"
                        title="Arrêter la navigation"
                    >
                        ✕
                    </button>
                </div>
                <button
                    type="button"
                    class="station-panel-join station-panel-context-replace"
                    disabled
                    aria-disabled="true"
                    title="Cette action sera disponible prochainement"
                >
                    Naviguer vers cette station
                </button>
            </div>
        `;
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

            ${navigationControls}

            ${renderModeSelector()}

        </div>
    `;

    if (isActiveNavigationPanel && activeNavigationRouteSummary) {
        updateRouteSummary(
            activeNavigationRouteSummary.distance,
            activeNavigationRouteSummary.duration,
        );
        appendNavigationSimulationButtons(
            element.querySelector('.station-panel-route-summary'),
        );
    }

    if (shouldPresentPane && mobileQuery.matches && pane) {
        const title = element.querySelector('.station-panel-title');

        if (title) {
            const bottomHeight = title.getBoundingClientRect().height + 30;

            await updateBottomHeight(bottomHeight);
        }

        if (renderId !== stationPanelRenderId) {
            return;
        }
    }

    const joinButton = element.querySelector(
        '.station-panel-join:not(.station-panel-context-resume):not(.station-panel-context-replace)',
    );

    const routeSummary = element.querySelector('.station-panel-route-summary');

    const routeMessage = element.querySelector('.station-panel-message');

    const stopButton = element.querySelector('.station-panel-stop');
    stopButton?.addEventListener('click', () => {
        showStopNavigationConfirmation(map, station, styleReady);
    });

    const resumeButton = element.querySelector(
        '.station-panel-context-resume',
    );
    resumeButton?.addEventListener('click', () => {
        if (!navigationStarted || !activeNavigationStation) {
            return;
        }

        const destination = activeNavigationStation;
        setUserFollowing(true);

        if (isFreshGpsPosition(lastKnownUserPosition)) {
            followUserPosition(map, lastKnownUserPosition);
        }

        updateStationPanel(destination, map, styleReady, false);
    });

    joinButton?.addEventListener('click', async () => {
        if (navigationStarted) {
            return;
        }

        // Identifie cette opération asynchrone.
        const sessionId = ++navigationSessionId;

        if (joinButton.textContent.trim() === 'Démarrer') {
            stopBackgroundUserTracking();
            activeNavigationStation = station;
            activeNavigationRouteSummary = routeSummaryData;
            navigationStarted = true;
            setNavigationActive(true);
            setUserFollowing(true);
            screenWakeLock.start();

            const isSessionActive = () =>
                navigationStarted && sessionId === navigationSessionId;

            joinButton.disabled = true;
            joinButton.textContent = 'Démarrage…';

            let isInitialCameraSetup = true;

            await activateCompass(
                map,

                (reading) => {
                    if (
                        !stationsMatch(displayedStation, activeNavigationStation)
                    ) {
                        return;
                    }

                    const compassDisplay = element.querySelector(
                        '.station-panel-compass-status',
                    );

                    if (compassDisplay) {
                        compassDisplay.textContent =
                            reading.compassHeading !== null
                                ? `🧭 Boussole active — Cap : ${Math.round(reading.compassHeading)}°`
                                : '🧭 Boussole active — Cap indisponible';
                    }
                },
                (error) => {
                    if (
                        !stationsMatch(displayedStation, activeNavigationStation)
                    ) {
                        return;
                    }

                    const compassDisplay = element.querySelector(
                        '.station-panel-compass-status',
                    );

                    if (compassDisplay) {
                        compassDisplay.textContent = `⚠️ Boussole indisponible : ${error.message}`;
                    }
                },
                () => !isInitialCameraSetup,
            );

            if (!isSessionActive()) {
                return;
            }

            const waitForCameraMove = () =>
                new Promise((resolve) => {
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
                      lastKnownUserPosition.latitude,
                  ]
                : [map.getCenter().lng, map.getCenter().lat];

            if (lastKnownUserPosition) {
                showUserMarker(map, lastKnownUserPosition);
            }

            // 1. Centrer et zoomer d'abord en 2D.
            map.easeTo({
                center: cameraCenter,
                zoom: 17,
                pitch: 0,
                duration: 500,
                essential: true,
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
                (position) => {
                    const lastKnownTimestamp =
                        lastKnownUserPosition?.timestamp;

                    if (
                        isFreshGpsPosition(position) &&
                        (!Number.isFinite(lastKnownTimestamp) ||
                            position.timestamp > lastKnownTimestamp)
                    ) {
                        lastKnownUserPosition = position;
                    }

                    navigationEngine.updateNavigationProgress(position);

                    console.log('Nouvelle position GPS :', position);
                },
                (error) => {
                    console.error('Erreur GPS :', error);
                },
            );

            if (stationsMatch(displayedStation, activeNavigationStation)) {
                renderActiveNavigationControls(
                    map,
                    activeNavigationStation,
                    styleReady,
                );
            }

            // 📱 Réduit le panneau après 2 secondes.
            if (
                pane &&
                mobileQuery.matches &&
                stationsMatch(displayedStation, activeNavigationStation)
            ) {
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

        const previewRenderId = renderId;
        await ensure2DView();

        if (previewRenderId !== stationPanelRenderId || navigationStarted) {
            return;
        }

        setUserFollowing(false);

        if (routeMessage) {
            routeMessage.hidden = true;
            routeMessage.textContent = '';
        }

        let routeStep = 'gps';

        try {
            const userPosition = await requestUserPosition();

            if (previewRenderId !== stationPanelRenderId || navigationStarted) {
                return;
            }

            lastKnownUserPosition = userPosition;

            routeStep = 'map';
            showUserMarker(map, userPosition);

            routeStep = 'routing';
            const route = await getWalkingRoute(userPosition, {
                latitude: station.latitude,
                longitude: station.longitude,
            });

            if (previewRenderId !== stationPanelRenderId || navigationStarted) {
                return;
            }

            const distance = formatDistance(route.summary.length);

            const duration = formatDuration(route.summary.time);

            const coordinates = decodePolyline(route.legs[0].shape);

            routeStep = 'map';
            await styleReady;

            if (previewRenderId !== stationPanelRenderId || navigationStarted) {
                return;
            }

            drawWalkingRoute(map, coordinates);

            fitWalkingRoute(map, coordinates);

            showDestinationMarker(map, {
                latitude: station.latitude,
                longitude: station.longitude,
            });

            navigationEngine.setNavigationRoute(coordinates, {
                latitude: station.latitude,
                longitude: station.longitude,
            });

            displayedStation = station;

            navigationStarted = false;

            joinButton.textContent = 'Démarrer';

            if (routeSummary) {
                updateRouteSummary(distance, duration);
                appendNavigationSimulationButtons(routeSummary);

                if (pane && mobileQuery.matches) {
                    const content = element.querySelector(
                        '.station-panel-content',
                    );

                    pane.present({
                        animate: true,
                    });

                    if (content) {
                        const middleHeight =
                            content.getBoundingClientRect().height;

                        updateMiddleHeight(middleHeight);
                    }
                }
            }
        } catch (error) {
            console.error('Impossible de calculer l’itinéraire :', error);

            if (previewRenderId !== stationPanelRenderId || navigationStarted) {
                return;
            }

            if (routeStep === 'map') {
                navigationEngine.stopNavigationProcessing();
                clearNavigationMap(map);
            }

            if (routeMessage) {
                routeMessage.hidden = false;
                if (routeStep === 'map') {
                    routeMessage.textContent =
                        '🗺️ La carte n’a pas pu afficher l’itinéraire. Réessaie.';
                } else if (routeStep === 'routing') {
                    routeMessage.textContent =
                        '🧭 L’itinéraire n’a pas pu être calculé. Réessaie.';
                } else if (
                    error instanceof Error &&
                    error.message === 'Geolocation unavailable'
                ) {
                    routeMessage.textContent =
                        '📍 La géolocalisation n’est pas disponible sur cet appareil.';
                } else {
                    routeMessage.textContent =
                        '📍 Ta position n’a pas pu être récupérée. Vérifie les autorisations de localisation et réessaie.';
                }
                if (mobileQuery.matches && pane) {
                    const content = element.querySelector(
                        '.station-panel-content',
                    );

                    pane.present({
                        animate: true,
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

            joinButton.textContent = navigationStarted
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
        if (!shouldPresentPane) {
            return;
        }

        const content = element.querySelector('.station-panel-content');

        pane.present({
            animate: true,
        });

        if (content) {
            const middleHeight = content.getBoundingClientRect().height;

            updateMiddleHeight(middleHeight);
        }

        return;
    }

    // Desktop
    element.classList.add('is-open');
}

function initModeSelector() {
    const selector = element.querySelector('.station-panel-mode-selector');

    if (!selector) {
        return;
    }

    const buttons = selector.querySelectorAll('button');
    const indicator = selector.querySelector('.station-panel-mode-indicator');

    function updateIndicator() {
        const activeButton = selector.querySelector('button.active');

        if (!activeButton || !indicator) {
            return;
        }

        indicator.style.width = `${activeButton.offsetWidth}px`;

        indicator.style.transform = `
            translateX(${activeButton.offsetLeft}px)
        `;
    }

    buttons.forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();

            const mode = button.dataset.mode;

            if (!mode) {
                return;
            }

            currentMode = mode;

            setDisplayMode(mode);

            buttons.forEach((item) => {
                item.classList.toggle(
                    'active',
                    item.dataset.mode === currentMode,
                );
            });

            updateIndicator();
        });
    });

    updateIndicator();
}
