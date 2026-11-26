import { subscribeToSelectedStation, setDisplayMode } from '../shared/state.js';
import {
    getUserPositionErrorMessage,
    requestUserPosition,
    startWatchingPosition,
} from '../location/geolocation.js';
import { getRoute } from './routing.js';
import {
    drawWalkingRoute,
    drawRoutePreview,
    clearRoutePreview,
    showDestinationMarker,
    updateWalkingRoute,
    setUserFollowing,
    setNavigationActive,
    showUserMarker,
    updateNavigationPosition,
    recenterOnUser,
    clearNavigationMap,
    ensure2DView,
    presentRoute,
    startBackgroundUserTracking,
    stopBackgroundUserTracking,
    activateCompass,
    reactivateCompassIfEligible,
} from '../map.js';
import { createNavigationEngine } from './navigation.js';
import { NavigationSession } from './navigationSession.js';
import { createScreenWakeLock } from './screenWakeLock.js';
import { formatDistance, formatDuration } from './routeFormatting.js';
import { stopCompass } from './compass.js';
import { showConfirmationDialog } from './ui/confirmationDialog.js';
import {
    renderEmptyPanel as renderEmptyPanelHtml,
    renderRoutePlanner,
    renderStationPanel,
} from './ui/stationPanelView.js';
import { createPaneController } from './ui/paneController.js';
import { initModeSelector } from './ui/modeSelector.js';
import { createRoutePlannerController } from './routePlanner.js';
import { renderRoutePreview } from './ui/routePlannerView.js';
const DESTINATION_CHANGE_GPS_TIMEOUT_MS = 10_000;

let paneController = null;
let element = null;
let paneElement = null;
let plannerElement = null;
let routePreviewElement = null;
let routePlannerController = null;
let isRoutePlannerOpen = false;
let isRoutePreviewOpen = false;
let routePreviewRequestId = 0;
let routePreviewData = null;
let isRouteCalculationPending = false;
let activeRouteCalculationRequestId = null;
let routePreviewAbortController = null;
let isPlannerNavigationStarting = false;
let isPlannerRouteOutdated = false;

let navigationSessionId = 0;
let stationPanelRenderId = 0;
let displayedStation = null;
let activeNavigationStation = null;
let activeNavigationRouteSummary = null;
let routeSummaryData = null;
let destinationChangeRequestId = 0;
let pendingDestinationChange = null;
let destinationChangeError = null;

let navigationEngine = null;
let navigationSession = null;
const screenWakeLock = createScreenWakeLock();

let currentMode = 'bikes';
let latestStationsById = new Map();

function isNavigationStarted() {
    return navigationSession?.isActive() ?? false;
}

function getStationWithLatestAvailability(station) {
    const latestStation = latestStationsById.get(String(station.id));

    if (!latestStation) {
        return station;
    }

    return {
        ...station,
        bikes: latestStation.bikes,
        electricBikes: latestStation.electricBikes,
        docks: latestStation.docks,
    };
}

function updateStationAvailability(stations) {
    if (!Array.isArray(stations)) {
        return;
    }

    latestStationsById = new Map(
        stations
            .filter((station) => station?.id !== undefined)
            .map((station) => [String(station.id), station]),
    );

    if (!displayedStation || !element) {
        return;
    }

    const latestStation = latestStationsById.get(
        String(displayedStation.id),
    );

    if (!latestStation) {
        return;
    }

    const values = {
        bikes: latestStation.bikes ?? 0,
        electricBikes: latestStation.electricBikes ?? 0,
        docks: latestStation.docks ?? 0,
    };

    Object.entries(values).forEach(([key, value]) => {
        const valueElement = element.querySelector(
            `[data-station-availability="${key}"]`,
        );
        const text = String(value);

        if (valueElement && valueElement.textContent.trim() !== text) {
            valueElement.textContent = text;
        }
    });
}

function rememberUserGpsPosition(map, position) {
    if (!navigationSession?.rememberPosition(position)) {
        return;
    }

    const lastKnownPosition = navigationSession.getLastKnownPosition();

    if (navigationSession.isFreshPosition(lastKnownPosition)) {
        showUserMarker(map, lastKnownPosition);
    }
}

function isValidRouteCoordinates(coordinates) {
    return (
        Array.isArray(coordinates) &&
        coordinates.length >= 2 &&
        coordinates.every(
            (coordinate) =>
                Array.isArray(coordinate) &&
                coordinate.length >= 2 &&
                Number.isFinite(coordinate[0]) &&
                coordinate[0] >= -180 &&
                coordinate[0] <= 180 &&
                Number.isFinite(coordinate[1]) &&
                coordinate[1] >= -90 &&
                coordinate[1] <= 90,
        )
    );
}

function isValidRoutePlace(place) {
    return (
        Number.isFinite(place?.latitude) &&
        place.latitude >= -90 &&
        place.latitude <= 90 &&
        Number.isFinite(place?.longitude) &&
        place.longitude >= -180 &&
        place.longitude <= 180
    );
}

function isValidPlannerRoute(route = routePreviewData) {
    const segment = route?.segments?.[0];

    return (
        segment?.mode === 'pedestrian' &&
        isValidRouteCoordinates(segment.geometry) &&
        isValidRoutePlace(segment.origin) &&
        isValidRoutePlace(segment.destination) &&
        Number.isFinite(segment.distance) &&
        segment.distance >= 0 &&
        Number.isFinite(segment.duration) &&
        segment.duration >= 0 &&
        Number.isFinite(route.distance) &&
        Number.isFinite(route.duration)
    );
}

function isPlannerNavigationActive() {
    return (
        isNavigationStarted() &&
        !activeNavigationStation &&
        isValidPlannerRoute()
    );
}

function renderPlannerPreview(navigationActive = false, message = '') {
    if (!routePreviewElement || !isValidPlannerRoute()) {
        return;
    }

    const summary =
        navigationActive && activeNavigationRouteSummary
            ? activeNavigationRouteSummary
            : {
                  distance: formatDistance(routePreviewData.distance),
                  duration: formatDuration(routePreviewData.duration),
              };

    routePreviewElement.innerHTML = renderRoutePreview({
        distance: summary.distance,
        duration: summary.duration,
        navigationActive,
        message,
        starting: isPlannerNavigationStarting,
    });
}

function setPlannerPreviewMessage(message, isError = false) {
    const status = routePreviewElement?.querySelector(
        '[data-route-preview-message]',
    );

    if (!status) {
        return;
    }

    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', isError);
}

function handleRoutePlannerStateChange(selections, map) {
    routePreviewRequestId++;
    routePreviewAbortController?.abort();
    routePreviewAbortController = null;

    if (selections?.origin?.type === 'current-location') {
        rememberUserGpsPosition(map, selections.origin);
    }

    if (routePreviewData && !isNavigationStarted()) {
        isPlannerRouteOutdated = true;
    }

    const message = plannerElement?.querySelector(
        '[data-route-calculation-message]',
    );

    if (message) {
        message.hidden = true;
        message.textContent = '';
    }

}

function waitForMapMovement(map) {
    return new Promise((resolve) => {
        if (!map.isMoving()) {
            resolve();
            return;
        }

        map.once('moveend', resolve);
    });
}

async function restoreNavigationCamera(map, station, sessionId) {
    const viewButton = map
        .getContainer()
        .querySelector('.map-view-button');

    if (viewButton?.textContent.trim() === '3D') {
        viewButton.click();
    }

    await waitForMapMovement(map);

    const hasCurrentTarget = station
        ? stationsMatch(activeNavigationStation, station) &&
          stationsMatch(displayedStation, station)
        : isPlannerNavigationActive();

    if (
        !isNavigationStarted() ||
        navigationSessionId !== sessionId ||
        !hasCurrentTarget
    ) {
        return false;
    }

    const lastKnownPosition = navigationSession.getLastKnownPosition();

    if (navigationSession.isFreshPosition(lastKnownPosition)) {
        recenterOnUser(map, lastKnownPosition);
        await waitForMapMovement(map);
    } else {
        // Le prochain relevé GPS reprendra le suivi sans recentrer sur une position périmée.
        setUserFollowing(true);
    }

    return true;
}

function clearNavigationPaneCollapseTimeout() {
    paneController?.clearCollapse();
}

function scheduleNavigationPaneCollapse(station, sessionId) {
    const renderId = stationPanelRenderId;

    paneController?.scheduleCollapse(
        () =>
            stationPanelRenderId === renderId &&
            isNavigationStarted() &&
            navigationSessionId === sessionId &&
            stationsMatch(displayedStation, station),
    );
}

/**
 * Met à jour les informations de distance et de durée
 * affichées dans le panneau de navigation.
 */
function updateRouteSummary(distance, duration) {
    routeSummaryData = { distance, duration };

    if (isNavigationStarted()) {
        activeNavigationRouteSummary = routeSummaryData;
    }

    if (isPlannerNavigationActive()) {
        const distanceElement = routePreviewElement?.querySelector(
            '[data-route-preview-distance]',
        );
        const durationElement = routePreviewElement?.querySelector(
            '[data-route-preview-duration]',
        );

        if (distanceElement) {
            distanceElement.textContent = `📍 ${distance}`;
        }

        if (durationElement) {
            durationElement.textContent = `⏱️ ${duration}`;
        }

        isPlannerRouteOutdated = true;
        return;
    }

    if (!element) {
        return;
    }

    if (
        isNavigationStarted() &&
        !stationsMatch(displayedStation, activeNavigationStation)
    ) {
        return;
    }

    const routeSummary = element.querySelector('.station-panel-route-summary');

    if (!routeSummary) {
        return;
    }

    const navigationMode = navigationEngine.getNavigationMode();
    const travelIcon = navigationMode === 'bicycle' ? '🚲' : '🚶';

    routeSummary.innerHTML = `
        <span>📍 ${distance}</span>
        <span>${travelIcon} ${duration}</span>
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

function recalculateStationPanelMiddleHeight() {
    if (!paneController?.isAvailable()) {
        return;
    }

    const content = element?.querySelector('.station-panel-content');

    if (content) {
        void paneController
            .updateMiddleHeight(content.getBoundingClientRect().height, false)
            .catch((error) => {
                console.error(
                    'Impossible de recalculer la hauteur du panneau :',
                    error,
                );
            });
    }
}

function renderActiveNavigationControls() {
    const controls = element?.querySelector(
        '.station-panel-navigation-controls',
    );

    if (!controls) {
        return;
    }

    controls.classList.remove(
        'station-panel-navigation-controls--context',
        'station-panel-navigation-controls--join',
    );
    controls.innerHTML = `
        <button
            type="button"
            class="station-panel-join"
            data-route-mode="${navigationEngine.getNavigationMode() ?? 'pedestrian'}"
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

    recalculateStationPanelMiddleHeight();
}

async function calculateJoinRoute(map, styleReady, station, activeButton) {
    const joinModeOptions = element.querySelector(
        '.station-panel-join-options',
    );
    const joinModeButtons = Array.from(
        element.querySelectorAll('.station-panel-join-option'),
    );
    const joinStartButton = element.querySelector('.station-panel-join-start');
    const joinChangeModeButton = element.querySelector(
        '.station-panel-change-mode',
    );
    const routeSummary = element.querySelector('.station-panel-route-summary');
    const routeMessage = element.querySelector('.station-panel-message');

    if (
        isNavigationStarted() ||
        activeButton.disabled ||
        element.querySelector('.station-panel-join-option[aria-busy="true"]') ||
        (activeButton.dataset.routeMode !== 'pedestrian' &&
            activeButton.dataset.routeMode !== 'bicycle')
    ) {
        return;
    }

    const mode = activeButton.dataset.routeMode;
    const renderId = stationPanelRenderId;
    const previewRenderId = renderId;
    const previewSessionId = ++navigationSessionId;

    joinModeButtons.forEach((button) => {
        button.disabled = true;
    });
    if (joinStartButton) {
        joinStartButton.disabled = true;
    }
    if (joinChangeModeButton) {
        joinChangeModeButton.disabled = true;
    }
    const originalButtonContent = activeButton.innerHTML;
    activeButton.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        Calcul de l'itinéraire…
    `;
    activeButton.setAttribute('aria-busy', 'true');

    if (routeMessage) {
        routeMessage.hidden = true;
        routeMessage.textContent = '';
    }

    let routeStep = 'camera';

    try {
        await ensure2DView();

        if (
            previewRenderId !== stationPanelRenderId ||
            previewSessionId !== navigationSessionId ||
            isNavigationStarted()
        ) {
            return;
        }

        setUserFollowing(false);

        routeStep = 'gps';
        const userPosition = await requestUserPosition();

        if (
            previewRenderId !== stationPanelRenderId ||
            previewSessionId !== navigationSessionId ||
            isNavigationStarted()
        ) {
            return;
        }

        routeStep = 'gps-marker';
        rememberUserGpsPosition(map, userPosition);

        routeStep = 'routing';
        const route = await getRoute(userPosition, station, mode);

        if (
            previewRenderId !== stationPanelRenderId ||
            previewSessionId !== navigationSessionId ||
            isNavigationStarted()
        ) {
            return;
        }

        const distance = formatDistance(route.distance);
        const duration = formatDuration(route.duration);

        routeStep = 'style';
        await styleReady;

        if (
            previewRenderId !== stationPanelRenderId ||
            previewSessionId !== navigationSessionId ||
            isNavigationStarted()
        ) {
            return;
        }

        routeStep = 'presentation';
        const wasPresented = await presentRoute(map, route, {
            layer: 'walking',
            isCurrent: () =>
                previewRenderId === stationPanelRenderId &&
                previewSessionId === navigationSessionId &&
                !isNavigationStarted(),
        });

        if (!wasPresented) {
            return;
        }

        navigationEngine.setNavigationRoute(
            route.geometry,
            {
                latitude: station.latitude,
                longitude: station.longitude,
            },
            route.mode,
        );
        displayedStation = station;
        updateRouteSummary(distance, duration);

        if (joinStartButton) {
            joinStartButton.dataset.routeMode = route.mode;
            joinStartButton.hidden = false;
            joinStartButton.textContent = 'Démarrer';
        }
        if (joinModeOptions) {
            joinModeOptions.hidden = true;
        }
        if (joinChangeModeButton) {
            joinChangeModeButton.hidden = false;
            joinChangeModeButton.textContent = 'Changer de mode';
        }

        if (routeSummary && paneController.isAvailable()) {
            const content = element.querySelector('.station-panel-content');

            paneController.present({ animate: true });

            if (content) {
                paneController.updateMiddleHeight(
                    content.getBoundingClientRect().height,
                );
            }
        }
    } catch (error) {
        console.error('Impossible de calculer l’itinéraire :', error);

        if (
            previewRenderId !== stationPanelRenderId ||
            previewSessionId !== navigationSessionId ||
            isNavigationStarted()
        ) {
            return;
        }

        if (routeStep === 'presentation') {
            map.stop();
            navigationEngine.stopNavigationProcessing();
            clearNavigationMap(map);
            if (joinStartButton) {
                joinStartButton.hidden = true;
            }
            if (joinChangeModeButton) {
                joinChangeModeButton.hidden = true;
            }
            if (joinModeOptions) {
                joinModeOptions.hidden = false;
            }
            if (routeSummary) {
                routeSummary.style.display = 'none';
            }
            routeSummaryData = null;
        }

        if (routeMessage) {
            routeMessage.hidden = false;
            if (routeStep === 'presentation' || routeStep === 'style') {
                routeMessage.textContent =
                    '🗺️ La carte n’a pas pu afficher l’itinéraire. Réessaie.';
            } else if (routeStep === 'camera') {
                routeMessage.textContent =
                    '🗺️ La vue de la carte n’a pas pu être préparée. Réessaie.';
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

            if (paneController.isAvailable()) {
                const content = element.querySelector('.station-panel-content');

                paneController.present({ animate: true });

                if (content) {
                    paneController.updateMiddleHeight(
                        content.getBoundingClientRect().height,
                    );
                }
            }
        }
    } finally {
        joinModeButtons.forEach((button) => {
            button.disabled = false;
            button.removeAttribute('aria-busy');
        });
        activeButton.innerHTML = originalButtonContent;
        if (joinStartButton) {
            joinStartButton.disabled = false;
        }
        if (joinChangeModeButton) {
            joinChangeModeButton.disabled = false;
        }
    }
}

function startJoinNavigation(map, styleReady, startButton) {
    if (
        isNavigationStarted() ||
        element.querySelector('.station-panel-join-option[aria-busy="true"]')
    ) {
        return;
    }

    const routeMode = navigationEngine.getNavigationMode();

    if (
        startButton.dataset.routeMode !== routeMode ||
        (routeMode !== 'pedestrian' && routeMode !== 'bicycle')
    ) {
        return;
    }

    const station = displayedStation;
    const renderId = stationPanelRenderId;
    const sessionId = ++navigationSessionId;

    startButton.disabled = true;
    startButton.textContent = 'Démarrage…';

    void startNavigationSession(map, sessionId, {
        station,
        route: null,
        summary: routeSummaryData,
    })
        .catch(async (error) => {
            console.error('Impossible de démarrer la navigation :', error);

            if (
                renderId === stationPanelRenderId &&
                sessionId === navigationSessionId &&
                !isNavigationStarted()
            ) {
                activeNavigationStation = null;
                activeNavigationRouteSummary = null;
                routeSummaryData = null;

                try {
                    await updateStationPanel(station, map, styleReady, false);
                } catch (renderError) {
                    console.error(
                        'Impossible de restaurer le panneau station :',
                        renderError,
                    );
                }

                if (
                    sessionId === navigationSessionId &&
                    !isNavigationStarted()
                ) {
                    const currentMessage = element.querySelector(
                        '.station-panel-message',
                    );

                    if (currentMessage) {
                        currentMessage.hidden = false;
                        currentMessage.textContent =
                            'La navigation n’a pas pu démarrer. Réessaie.';
                    }
                }
            }
        })
        .finally(() => {
            if (renderId === stationPanelRenderId && !isNavigationStarted()) {
                startButton.disabled = false;
                startButton.textContent = 'Démarrer';
            }
        });
}

function toggleJoinMode(button) {
    if (
        element.querySelector('.station-panel-join-option[aria-busy="true"]')
    ) {
        return;
    }

    const joinModeOptions = element.querySelector(
        '.station-panel-join-options',
    );
    const joinStartButton = element.querySelector('.station-panel-join-start');

    if (!joinModeOptions) {
        return;
    }

    joinModeOptions.hidden = !joinModeOptions.hidden;
    if (joinStartButton) {
        joinStartButton.hidden = !joinModeOptions.hidden;
    }
    button.textContent = joinModeOptions.hidden
        ? 'Changer de mode'
        : 'Retour à l’aperçu';
    recalculateStationPanelMiddleHeight();
}

function resumeNavigation(map, styleReady) {
    if (!isNavigationStarted()) {
        return;
    }

    if (!activeNavigationStation && isValidPlannerRoute()) {
        const sessionId = navigationSessionId;
        showRoutePlanner(true, map);
        restoreNavigationCamera(map, null, sessionId).catch((error) => {
            console.error(
                'Impossible de reprendre le suivi de navigation :',
                error,
            );
        });
        return;
    }

    if (!activeNavigationStation) {
        return;
    }

    const destination = activeNavigationStation;
    const sessionId = navigationSessionId;
    updateStationPanel(destination, map, styleReady, false);
    scheduleNavigationPaneCollapse(destination, sessionId);

    restoreNavigationCamera(map, destination, sessionId).catch((error) => {
        console.error('Impossible de reprendre le suivi de navigation :', error);
    });
}

function confirmDestinationChange(map, styleReady, button) {
    if (button.disabled || pendingDestinationChange) {
        return;
    }

    const station = displayedStation;
    showStopNavigationConfirmation(map, station, styleReady, {
        title: 'Changer de destination ?',
        message:
            'Remplacer l’itinéraire actuel par un itinéraire vers cette station ?',
        cancelLabel: 'Annuler',
        confirmLabel: 'Confirmer',
        onConfirm: () => startDestinationChange(map, station, styleReady),
    });
}

function showNavigationDestinationMarker(map, destination) {
    const isStation =
        destination?.type === 'station' ||
        destination?.stationId !== undefined ||
        destination?.id !== undefined;

    showDestinationMarker(
        map,
        destination,
        isStation
            ? undefined
            : {
                  icon: '📍',
                  label: destination?.label ?? 'Destination',
              },
    );
}

async function startNavigationSession(
    map,
    sessionId,
    {
        station,
        route,
        summary,
        compassActivation,
        onCameraReady,
    },
) {
    if (navigationSession.isActive()) {
        return false;
    }

    const started = await navigationSession.start({
        route,
        compassActivation,
        isCurrent: () => sessionId === navigationSessionId,
        onActivating: () => {
            activeNavigationStation = station;
            activeNavigationRouteSummary = summary;
            routeSummaryData = summary;
        },
        onPreparing: () => {
            if (
                !station &&
                isRoutePlannerOpen &&
                isRoutePreviewOpen &&
                isValidPlannerRoute()
            ) {
                renderPlannerPreview(true);
                routePreviewElement.hidden = false;
                plannerElement.hidden = true;
                element.hidden = true;
            }
        },
        prepareCamera: () => restoreNavigationCamera(map, station, sessionId),
        onCameraReady,
    });

    if (started && station && stationsMatch(displayedStation, station)) {
        renderActiveNavigationControls();
        scheduleNavigationPaneCollapse(station, sessionId);
    } else if (
        started &&
        !station &&
        isPlannerNavigationActive() &&
        isRoutePlannerOpen &&
        isRoutePreviewOpen
    ) {
        renderPlannerPreview(true);
        routePreviewElement.hidden = false;
        plannerElement.hidden = true;
        element.hidden = true;
    }

    return started;
}

export function initStationPanel(map, styleReady) {
    element = document.querySelector('#station-content');
    paneElement = document.querySelector('#maplibre-station-panel');
    plannerElement = document.querySelector('#route-planner');
    routePreviewElement = document.querySelector('#route-preview');

    if (
        !element ||
        !paneElement ||
        !plannerElement ||
        !routePreviewElement ||
        paneController
    ) {
        return;
    }
    navigationEngine = createNavigationEngine({
        updateNavigationPosition: (gpsPosition, displayedPosition) =>
            updateNavigationPosition(map, gpsPosition, displayedPosition),
        updateWalkingRoute: (coordinates, mode) =>
            updateWalkingRoute(map, coordinates, mode),
        updateRouteSummary,
    });
    navigationSession = new NavigationSession({
        navigationEngine,
        gps: {
            requestPosition: requestUserPosition,
            startWatchingPosition,
            clearWatch: (watchId) => navigator.geolocation.clearWatch(watchId),
        },
        mapEffects: {
            stopBackgroundTracking: stopBackgroundUserTracking,
            setNavigationActive: (initialPosition, mode) =>
                setNavigationActive(true, initialPosition, mode, map),
            setUserFollowing,
            showUserPosition: (position) => showUserMarker(map, position),
            drawNavigationRoute: (route) => {
                const segment = route.segments[0];

                drawWalkingRoute(map, segment.geometry, segment.mode);
                showNavigationDestinationMarker(map, segment.destination);
            },
            clearPlannerRoutePreview: () => clearRoutePreview(map),
            clearNavigation: () => clearNavigationMap(map),
            startBackgroundTracking: () => startBackgroundUserTracking(map),
        },
        compass: {
            stop: stopCompass,
            activate: (canControlCamera, onError) =>
                activateCompass(map, undefined, onError, canControlCamera),
            reactivateIfEligible: () => reactivateCompassIfEligible(map),
        },
        wakeLock: screenWakeLock,
    });

    // Le panneau vide est présent dès le lancement
    // sur mobile comme sur desktop.
    renderEmptyPanel();
    plannerElement.innerHTML = renderRoutePlanner();
    routePlannerController = createRoutePlannerController(plannerElement, {
        onChange: (selections) =>
            handleRoutePlannerStateChange(selections, map),
    });

    element.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-open-route-planner]');
        const joinOption = event.target.closest('.station-panel-join-option');
        const startButton = event.target.closest('.station-panel-join-start');
        const changeModeButton = event.target.closest(
            '.station-panel-change-mode',
        );
        const stopButton = event.target.closest('.station-panel-stop');
        const resumeButton = event.target.closest(
            '.station-panel-context-resume',
        );
        const replaceButton = event.target.closest(
            '.station-panel-context-replace',
        );

        if (trigger) {
            event.preventDefault();
            event.stopPropagation();
            showRoutePlanner(true, map);
        } else if (joinOption) {
            void calculateJoinRoute(map, styleReady, displayedStation, joinOption);
        } else if (startButton) {
            startJoinNavigation(map, styleReady, startButton);
        } else if (changeModeButton) {
            toggleJoinMode(changeModeButton);
        } else if (stopButton) {
            showStopNavigationConfirmation(map, displayedStation, styleReady);
        } else if (resumeButton) {
            resumeNavigation(map, styleReady);
        } else if (replaceButton) {
            confirmDestinationChange(map, styleReady, replaceButton);
        }
    });

    plannerElement.addEventListener('click', (event) => {
        const closeButton = event.target.closest('[data-close-route-planner]');
        const calculateButton = event.target.closest('.route-planner-calculate');

        if (closeButton) {
            event.preventDefault();
            event.stopPropagation();
            closeRoutePlanner(true);
        } else if (calculateButton) {
            event.preventDefault();
            event.stopPropagation();
            void calculatePlannerRoute(map, styleReady).catch((error) => {
                console.error('Erreur inattendue du calcul d’itinéraire :', error);
                setPlannerCalculationMessage(
                    'Le calcul a échoué. Vérifie ta connexion puis réessaie.',
                    true,
                );
            });
        }
    });

    routePreviewElement.addEventListener('click', (event) => {
        const editButton = event.target.closest('[data-edit-route-planner]');
        const startButton = event.target.closest('.route-preview-start');
        const stopButton = event.target.closest('[data-route-stop-navigation]');

        if (startButton && !startButton.disabled) {
            event.preventDefault();
            event.stopPropagation();
            void startPlannerNavigation(map, styleReady);
            return;
        }

        if (stopButton) {
            event.preventDefault();
            event.stopPropagation();
            showStopNavigationConfirmation(map, null, styleReady);
            return;
        }

        if (!editButton) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        showRoutePlanner(true, map);
    });

    paneController = createPaneController(paneElement, {
        shouldIgnoreSearchEvents: () => isRoutePlannerOpen,
        onUserBreakChange: (currentBreak) => {
            if (currentBreak === 'bottom') {
                if (isRoutePlannerOpen && !isPlannerNavigationActive()) {
                    closeRoutePlanner(false);
                }

                return;
            }

            if (!displayedStation && !isRoutePlannerOpen) {
                showRoutePlanner(true, map);
            }
        },
    });

    if (!paneController.isAvailable()) {
        // Desktop : panneau classique
        paneElement.classList.add('is-open');
    }
    subscribeToSelectedStation((station) =>
        updateStationPanel(station, map, styleReady),
    );
    paneController.bindSearchEvents();

    return {
        updateAvailability: updateStationAvailability,
        setRouteSearchApi: (searchApi) =>
            routePlannerController?.setSearchApi(searchApi),
    };
}

function showRoutePlanner(movePane, map) {
    if (!element || !plannerElement || !routePreviewElement) {
        return;
    }

    if (isPlannerNavigationActive()) {
        if (!isRoutePlannerOpen) {
            element.hidden = true;
            plannerElement.hidden = true;
            isRoutePlannerOpen = true;
            isRoutePreviewOpen = true;
            routePreviewElement.hidden = false;
            renderPlannerPreview(true);

            if (movePane && paneController?.isAvailable()) {
                const preview = routePreviewElement.querySelector(
                    '.route-preview-panel',
                );

                if (preview) {
                    void paneController
                        .updateMiddleHeight(preview.getBoundingClientRect().height)
                        .catch((error) => {
                            console.error(
                                'Impossible de restaurer la hauteur de l’aperçu :',
                                error,
                            );
                        });
                }
            }
        }

        return;
    }

    if (isRoutePlannerOpen) {
        if (!isRoutePreviewOpen) {
            return;
        }

        isRoutePreviewOpen = false;
        routePreviewElement.hidden = true;
        plannerElement.hidden = false;

        if (movePane) {
            paneController?.openPlanner();
        }

        return;
    }

    element.hidden = true;
    isRoutePlannerOpen = true;

    if (routePreviewData && !isPlannerRouteOutdated) {
        plannerElement.hidden = true;
        routePreviewElement.hidden = false;
        isRoutePreviewOpen = true;
        renderPlannerPreview(false);

        if (map && !isNavigationStarted()) {
            drawRoutePreview(
                map,
                routePreviewData.segments[0].geometry,
                routePreviewData.segments[0].mode,
            );
        }

        if (movePane && paneController?.isAvailable()) {
            const preview = routePreviewElement.querySelector(
                '.route-preview-panel',
            );

            if (preview) {
                void paneController
                    .updateMiddleHeight(preview.getBoundingClientRect().height)
                    .catch((error) => {
                        console.error(
                            'Impossible de restaurer la hauteur de l’aperçu :',
                            error,
                        );
                    });
            }
        }

        return;
    }

    plannerElement.hidden = false;
    routePreviewElement.hidden = true;
    isRoutePreviewOpen = false;

    if (movePane) {
        paneController?.openPlanner();
    }
}

function closeRoutePlanner(movePane) {
    if (
        !element ||
        !plannerElement ||
        !routePreviewElement ||
        !isRoutePlannerOpen
    ) {
        return;
    }

    const closeRequestId = ++routePreviewRequestId;
    routePreviewAbortController?.abort();
    routePreviewAbortController = null;
    routePlannerController?.hideSuggestions();
    plannerElement.hidden = true;
    routePreviewElement.hidden = true;
    element.hidden = false;
    isRoutePlannerOpen = false;
    isRoutePreviewOpen = false;
    setPlannerCalculationMessage('');

    if (movePane && displayedStation && paneController?.isAvailable()) {
        const content = element.querySelector('.station-panel-content');

        if (content) {
            const middleHeight = content.getBoundingClientRect().height;

            void paneController
                .updateMiddleHeight(middleHeight, false)
                .then(() => {
                    if (
                        closeRequestId === routePreviewRequestId &&
                        !isRoutePlannerOpen
                    ) {
                        paneController.closePlanner('middle');
                    }
                });
        } else {
            paneController.closePlanner('middle');
        }
    } else if (movePane) {
        paneController?.closePlanner('bottom');
    }
}

function setPlannerCalculationMessage(message, isError = false) {
    const status = plannerElement?.querySelector(
        '[data-route-calculation-message]',
    );

    if (!status) {
        return;
    }

    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', isError);
}

async function calculatePlannerRoute(map, styleReady) {
    if (!isRoutePlannerOpen || isRoutePreviewOpen || isNavigationStarted()) {
        if (isNavigationStarted()) {
            setPlannerCalculationMessage(
                'Termine ou arrête la navigation en cours avant de calculer un autre itinéraire.',
                true,
            );
        }

        return;
    }

    if (isRouteCalculationPending || isPlannerNavigationStarting) {
        return;
    }

    const calculateButton = plannerElement.querySelector(
        '.route-planner-calculate',
    );

    if (!calculateButton || calculateButton.disabled) {
        return;
    }

    const { origin, destination, alreadyOnVelib } =
        routePlannerController?.getSelections() ?? {};

    if (alreadyOnVelib) {
        return;
    }

    if (!isValidRoutePlace(origin) || !isValidRoutePlace(destination)) {
        setPlannerCalculationMessage(
            'Choisis un départ et une arrivée valides avant de calculer.',
            true,
        );
        return;
    }

    const requestId = ++routePreviewRequestId;
    isRouteCalculationPending = true;
    activeRouteCalculationRequestId = requestId;
    routePreviewAbortController = new AbortController();
    let routeOrigin = origin;

    routePlannerController?.setCalculating(true);
    setPlannerCalculationMessage('Calcul de l’itinéraire en cours…');

    try {
        if (
            origin.type === 'current-location' &&
            !navigationSession.isFreshPosition(origin)
        ) {
            setPlannerCalculationMessage(
                'Actualisation de la position GPS en cours…',
            );

            const refreshedPosition = await requestUserPosition({
                maximumAge: 0,
            });

            if (
                requestId !== routePreviewRequestId ||
                !isRoutePlannerOpen ||
                isNavigationStarted()
            ) {
                return;
            }

            if (!navigationSession.isFreshPosition(refreshedPosition)) {
                const error = new Error('The GPS fix is stale.');
                error.code = 'POSITION_STALE';
                throw error;
            }

            routeOrigin = {
                ...origin,
                latitude: refreshedPosition.latitude,
                longitude: refreshedPosition.longitude,
                timestamp: refreshedPosition.timestamp,
                accuracy: refreshedPosition.accuracy,
            };
            routePlannerController?.updateCurrentLocation(refreshedPosition);
            rememberUserGpsPosition(map, refreshedPosition);
        }

        setPlannerCalculationMessage('Calcul de l’itinéraire en cours…');
        const routeSegment = await getRoute(
            routeOrigin,
            destination,
            'pedestrian',
            {
                signal: routePreviewAbortController.signal,
            },
        );

        if (
            requestId !== routePreviewRequestId ||
            !isRoutePlannerOpen ||
            isNavigationStarted()
        ) {
            return;
        }

        const result = {
            segments: [
                {
                    mode: routeSegment.mode,
                    origin: routeSegment.origin,
                    destination: routeSegment.destination,
                    geometry: routeSegment.geometry,
                    distance: routeSegment.distance,
                    duration: routeSegment.duration,
                },
            ],
            distance: routeSegment.distance,
            duration: routeSegment.duration,
        };

        await styleReady;

        if (
            requestId !== routePreviewRequestId ||
            !isRoutePlannerOpen ||
            isNavigationStarted()
        ) {
            return;
        }

        const wasPresented = await presentRoute(map, routeSegment, {
            layer: 'preview',
            isCurrent: () =>
                requestId === routePreviewRequestId &&
                isRoutePlannerOpen &&
                !isNavigationStarted(),
        });

        if (!wasPresented) {
            return;
        }

        routePreviewData = result;
        isPlannerRouteOutdated = false;
        renderPlannerPreview();
        setPlannerPreviewMessage('');
        routePreviewElement.hidden = false;
        plannerElement.hidden = true;
        isRoutePreviewOpen = true;
        setPlannerCalculationMessage('');

        if (paneController?.isAvailable()) {
            const preview = routePreviewElement.querySelector(
                '.route-preview-panel',
            );

            if (preview) {
                await paneController.updateMiddleHeight(
                    preview.getBoundingClientRect().height,
                );
            }
        }
    } catch (error) {
        if (requestId !== routePreviewRequestId || !isRoutePlannerOpen) {
            return;
        }

        isRoutePreviewOpen = false;
        routePreviewElement.hidden = true;
        plannerElement.hidden = false;

        console.error('Impossible de calculer l’aperçu piéton :', error);
        const message =
            error?.code === 1 ||
            error?.code === 2 ||
            error?.code === 3 ||
            error?.code === 'POSITION_STALE' ||
            error?.code === 'POSITION_INVALID' ||
            error?.message === 'Geolocation unavailable'
                ? getUserPositionErrorMessage(error)
                : error instanceof Error &&
                    error.message === 'Aucun itinéraire trouvé.'
                  ? 'Aucun itinéraire piéton trouvé pour ces lieux.'
                  : 'Le calcul a échoué. Vérifie ta connexion puis réessaie.';

        setPlannerCalculationMessage(message, true);
    } finally {
        if (activeRouteCalculationRequestId === requestId) {
            isRouteCalculationPending = false;
            activeRouteCalculationRequestId = null;
            routePreviewAbortController = null;
            routePlannerController?.setCalculating(false);
        }
    }
}

async function startPlannerNavigation(map, styleReady) {
    if (
        isPlannerNavigationStarting ||
        isNavigationStarted() ||
        !isRoutePlannerOpen ||
        !isRoutePreviewOpen ||
        isPlannerRouteOutdated ||
        !isValidPlannerRoute()
    ) {
        return;
    }

    const route = routePreviewData;
    const routeMode = route.segments[0].mode ?? 'pedestrian';
    const requestId = ++routePreviewRequestId;
    const startButton = routePreviewElement.querySelector(
        '.route-preview-start',
    );
    let canControlCamera = false;
    let sessionId = null;

    isPlannerNavigationStarting = true;
    if (startButton) {
        startButton.disabled = true;
        startButton.textContent = 'Vérification GPS…';
    }
    setPlannerPreviewMessage('Vérification de la position GPS…');

    // Lance la demande de permission dans le geste du clic. Les lectures ne
    // pilotent la caméra qu'après la restauration de la vue de navigation.
    const compassActivation =
        routeMode === 'bicycle'
            ? Promise.resolve()
            : activateCompass(
                  map,
                  undefined,
                  (error) => {
                      console.error('Boussole indisponible :', error);
                  },
                  () => canControlCamera,
              );

    const isCurrentPlannerStart = () =>
        requestId === routePreviewRequestId &&
        routePreviewData === route &&
        isRoutePlannerOpen &&
        isRoutePreviewOpen &&
        !isNavigationStarted();

    try {
        // La demande de permission boussole a été déclenchée dans le clic.
        await compassActivation;

        if (!isCurrentPlannerStart()) {
            return;
        }

        sessionId = ++navigationSessionId;
        isPlannerRouteOutdated = false;

        await startNavigationSession(map, sessionId, {
            station: null,
            route,
            summary: {
                distance: formatDistance(route.distance),
                duration: formatDuration(route.duration),
            },
            compassActivation,
            onCameraReady: () => {
                canControlCamera = true;
            },
        });
    } catch (error) {
        if (
            sessionId !== null &&
            navigationSessionId === sessionId &&
            routePreviewData === route &&
            isRoutePlannerOpen &&
            isRoutePreviewOpen
        ) {
            stopNavigation(map, null, styleReady, {
                preservePlannerPreview: true,
                failedPlannerStart: !isNavigationStarted(),
            });
        }

        if (
            requestId === routePreviewRequestId &&
            routePreviewData === route &&
            isRoutePreviewOpen
        ) {
            setPlannerPreviewMessage(
                error?.code === 1 ||
                    error?.code === 2 ||
                    error?.code === 3 ||
                    error?.code === 'POSITION_STALE' ||
                    error?.code === 'POSITION_INVALID' ||
                    error?.message === 'Geolocation unavailable'
                    ? getUserPositionErrorMessage(error)
                    : 'La navigation n’a pas pu démarrer. Réessaie depuis le départ de l’itinéraire.',
                true,
            );
            console.error('Impossible de démarrer l’itinéraire planifié :', error);
        }
    } finally {
        isPlannerNavigationStarting = false;

        if (!isNavigationStarted() && sessionId === null) {
            void compassActivation
                .then(() => {
                    if (
                        !isPlannerNavigationStarting &&
                        !isNavigationStarted()
                    ) {
                        return reactivateCompassIfEligible(map);
                    }
                })
                .catch((error) => {
                    console.error(
                        'Impossible de rétablir la boussole après le démarrage annulé :',
                        error,
                    );
                });
        }

        if (!isNavigationStarted()) {
            const button = routePreviewElement?.querySelector(
                '.route-preview-start',
            );

            if (button) {
                button.disabled = false;
                button.textContent = 'Démarrer';
            }
        }
    }
}

function renderEmptyPanel() {
    element.innerHTML = renderEmptyPanelHtml(currentMode);
    initModeSelector(element, {
        onModeChange: (mode) => {
            currentMode = mode;
            setDisplayMode(mode);
        },
    });

    if (paneController?.isAvailable()) {
        requestAnimationFrame(() => {
            const content = element.querySelector('.station-panel-empty');

            if (!content) {
                return;
            }

            const bottomHeight = content.getBoundingClientRect().height;

            paneController.updateBottomHeight(bottomHeight);
        });
    }
}

/**
 * Demande confirmation avant d'arrêter la navigation.
 */
function showStopNavigationConfirmation(
    map,
    station,
    styleReady,
    options = {},
) {
    const {
        title = 'Arrêter la navigation ?',
        message = 'Es-tu sûr de vouloir arrêter ton itinéraire ?',
        cancelLabel = 'Continuer',
        confirmLabel = 'Arrêter',
        onConfirm = () => stopNavigation(map, station, styleReady),
    } = options;

    showConfirmationDialog({
        title,
        message,
        cancelLabel,
        confirmLabel,
        onConfirm,
    });
}

/**
 * Arrête complètement la navigation en cours.
 */
function stopNavigation(
    map,
    station,
    styleReady,
    {
        preservePlannerPreview = false,
        failedPlannerStart = false,
    } = {},
) {
    const wasPlannerNavigation =
        isPlannerNavigationActive() || failedPlannerStart;
    const shouldRestorePlannerPreview =
        preservePlannerPreview &&
        wasPlannerNavigation &&
        !station &&
        !isPlannerRouteOutdated;
    const plannerRouteNeedsRecalculation =
        wasPlannerNavigation && isPlannerRouteOutdated;

    clearNavigationPaneCollapseTimeout();

    // Invalide les opérations asynchrones de la session.
    navigationSessionId++;
    destinationChangeRequestId++;
    pendingDestinationChange?.abortController.abort();
    pendingDestinationChange = null;
    destinationChangeError = null;
    activeNavigationStation = null;
    activeNavigationRouteSummary = null;
    routeSummaryData = null;
    if (wasPlannerNavigation && !shouldRestorePlannerPreview) {
        routePreviewData = null;
    }
    isPlannerRouteOutdated = false;

    // La session libère le watch, les capteurs et nettoie la carte.
    navigationSession.stop({
        afterNavigationClear:
            wasPlannerNavigation && !shouldRestorePlannerPreview
                ? () => clearRoutePreview(map)
                : undefined,
    });
    stationPanelRenderId++;

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

    // Réinitialise le résumé d'itinéraire.
    const routeSummary = element.querySelector('.station-panel-route-summary');

    if (routeSummary) {
        routeSummary.innerHTML = '';
        routeSummary.style.display = 'none';
    }

    // Réafficher le panneau de la station avec ses gestionnaires de clic.
    if (station) {
        updateStationPanel(
            station,
            map,
            styleReady,
            !paneController?.isManuallyAtBottom(),
        );
    } else if (shouldRestorePlannerPreview) {
        isRoutePlannerOpen = true;
        isRoutePreviewOpen = true;
        element.hidden = true;
        plannerElement.hidden = true;
        routePreviewElement.hidden = false;
        renderPlannerPreview(false);
        drawRoutePreview(
            map,
            routePreviewData.segments[0].geometry,
            routePreviewData.segments[0].mode,
        );

        if (paneController?.isAvailable()) {
            const preview = routePreviewElement.querySelector(
                '.route-preview-panel',
            );

            if (preview) {
                void paneController
                    .updateMiddleHeight(preview.getBoundingClientRect().height, false)
                    .catch((error) => {
                        console.error(
                            'Impossible de restaurer la hauteur de l’aperçu :',
                            error,
                        );
                    });
            }
        }
    } else if (plannerRouteNeedsRecalculation && !station) {
        isRoutePlannerOpen = true;
        isRoutePreviewOpen = false;
        element.hidden = true;
        routePreviewElement.hidden = true;
        plannerElement.hidden = false;
        setPlannerCalculationMessage(
            'L’itinéraire a été recalculé pendant la navigation. Calcule un nouvel aperçu avant de redémarrer.',
            true,
        );
    } else if (wasPlannerNavigation) {
        isRoutePlannerOpen = true;
        isRoutePreviewOpen = false;
        element.hidden = true;
        routePreviewElement.hidden = true;
        plannerElement.hidden = false;
    }

    console.log('🛑 Navigation arrêtée.');
}

function isCurrentDestinationChange(request) {
    return (
        pendingDestinationChange === request &&
        request.id === destinationChangeRequestId &&
        request.sessionId === navigationSessionId &&
        isNavigationStarted()
    );
}

async function startDestinationChange(map, station, styleReady) {
    if (!isNavigationStarted() || pendingDestinationChange) {
        return;
    }

    const request = {
        id: ++destinationChangeRequestId,
        sessionId: navigationSessionId,
        engineRequestId: null,
        abortController: new AbortController(),
        station,
    };
    const previousDestination =
        activeNavigationStation ??
        (isPlannerNavigationActive()
            ? routePreviewData.segments[0].destination
            : null);
    const replacingPlannerRoute =
        !activeNavigationStation && isValidPlannerRoute();

    pendingDestinationChange = request;
    destinationChangeError = null;

    updateStationPanel(displayedStation ?? station, map, styleReady, false);

    let destinationMarkerTouched = false;

    try {
        let userPosition;

        try {
            userPosition = await navigationSession.getReliablePosition({
                timeoutMs: DESTINATION_CHANGE_GPS_TIMEOUT_MS,
                signal: request.abortController.signal,
            });
        } catch (error) {
            if (!isCurrentDestinationChange(request)) {
                return;
            }

            pendingDestinationChange = null;
            destinationChangeError = {
                station,
                message:
                    error.code === 'POSITION_WAIT_TIMEOUT'
                        ? 'Aucun nouveau relevé GPS assez précis reçu après 10 secondes. L’itinéraire actuel est conservé. Réessaie lorsque le signal sera meilleur.'
                        : 'La position GPS est absente, trop imprécise ou trop ancienne. Attends un nouveau relevé puis réessaie.',
            };
            updateStationPanel(displayedStation ?? station, map, styleReady, false);
            return;
        }

        if (!isCurrentDestinationChange(request)) {
            return;
        }

        if (!userPosition) {
            pendingDestinationChange = null;
            destinationChangeError = {
                station,
                message:
                    'La position GPS est absente, trop imprécise ou trop ancienne. Attends un nouveau relevé puis réessaie.',
            };
            updateStationPanel(displayedStation ?? station, map, styleReady, false);
            return;
        }

        if (!isCurrentDestinationChange(request)) {
            return;
        }

        const routeMode = navigationEngine.getNavigationMode();

        if (!routeMode) {
            throw new Error('The active navigation route mode is unavailable.');
        }

        const engineRequestId = navigationEngine.beginRouteReplacement();

        if (engineRequestId === null) {
            pendingDestinationChange = null;
            destinationChangeError = {
                station,
                message:
                    'Le changement de destination ne peut pas démarrer pour le moment. Réessaie.',
            };
            updateStationPanel(displayedStation ?? station, map, styleReady, false);
            return;
        }

        request.engineRequestId = engineRequestId;

        const segment = await getRoute(userPosition, station, routeMode);

        if (!isCurrentDestinationChange(request)) {
            return;
        }

        await styleReady;

        if (!isCurrentDestinationChange(request)) {
            return;
        }

        destinationMarkerTouched = true;
        showDestinationMarker(map, station);

        if (
            !navigationEngine.commitRouteReplacement(
                request.engineRequestId,
                segment.geometry,
                {
                    latitude: station.latitude,
                    longitude: station.longitude,
                },
                segment.mode,
            )
        ) {
            throw new Error('The current route could not be replaced on the map.');
        }

        const distance = formatDistance(segment.distance);
        const duration = formatDuration(segment.duration);

        activeNavigationStation = station;
        if (replacingPlannerRoute) {
            routePreviewData = null;
            isPlannerRouteOutdated = false;
        }
        activeNavigationRouteSummary = { distance, duration };
        routeSummaryData = activeNavigationRouteSummary;
        pendingDestinationChange = null;
        destinationChangeError = null;

        updateStationPanel(station, map, styleReady, false);
        scheduleNavigationPaneCollapse(station, request.sessionId);

        await restoreNavigationCamera(map, station, request.sessionId);
    } catch (error) {
        if (!isCurrentDestinationChange(request)) {
            return;
        }

        if (request.engineRequestId !== null) {
            navigationEngine.cancelRouteReplacement(request.engineRequestId);
        }

        if (destinationMarkerTouched) {
            try {
                if (previousDestination) {
                    showNavigationDestinationMarker(map, previousDestination);
                }
            } catch (restoreError) {
                console.error(
                    'Impossible de restaurer le marqueur de destination :',
                    restoreError,
                );
            }
        }

        pendingDestinationChange = null;
        destinationChangeError = {
            station,
            message:
                'Le nouvel itinéraire n’a pas pu être calculé. L’itinéraire actuel est conservé. Réessaie.',
        };

        console.error('Impossible de changer la destination :', error);

        updateStationPanel(displayedStation ?? station, map, styleReady, false);
    }
}

function getStationPanelNavigationState(station) {
    const isActiveNavigationPanel =
        isNavigationStarted() &&
        stationsMatch(station, activeNavigationStation);

    return {
        isActiveNavigationPanel,
        isNavigationContextPanel:
            isNavigationStarted() && !isActiveNavigationPanel,
        navigationMode: navigationEngine.getNavigationMode() ?? 'pedestrian',
    };
}

async function updateStationPanelBottomHeight(renderId) {
    const title = element.querySelector('.station-panel-title');

    if (title) {
        const bottomHeight = title.getBoundingClientRect().height + 30;

        await paneController.updateBottomHeight(bottomHeight);
    }

    return renderId === stationPanelRenderId;
}

function updateStationPanelDestinationStatus(station) {
    const routeMessage = element.querySelector('.station-panel-message');
    const replaceButton = element.querySelector(
        '.station-panel-context-replace',
    );

    if (pendingDestinationChange) {
        if (routeMessage) {
            routeMessage.hidden = false;
            routeMessage.textContent = 'Calcul du nouvel itinéraire…';
        }

        if (replaceButton) {
            replaceButton.disabled = true;
            replaceButton.setAttribute('aria-busy', 'true');
        }
    } else if (
        destinationChangeError &&
        stationsMatch(destinationChangeError.station, station)
    ) {
        if (routeMessage) {
            routeMessage.hidden = false;
            routeMessage.textContent = destinationChangeError.message;
        }
    }
}

async function presentStationPanel(shouldPresentPane) {
    if (!paneController.isAvailable()) {
        paneElement.classList.add('is-open');
        return;
    }

    const content = element.querySelector('.station-panel-content');

    if (!shouldPresentPane) {
        if (content) {
            const middleHeight = content.getBoundingClientRect().height;

            await paneController.updateMiddleHeight(middleHeight, false);
        }

        return;
    }

    paneController.present({ animate: true });

    if (content) {
        const middleHeight = content.getBoundingClientRect().height;

        paneController.updateMiddleHeight(middleHeight);
    }
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

    const pendingChange = pendingDestinationChange;

    if (
        pendingChange &&
        !stationsMatch(station, pendingChange.station)
    ) {
        destinationChangeRequestId++;
        pendingDestinationChange = null;
        pendingChange.abortController.abort();

        if (pendingChange.engineRequestId !== null) {
            navigationEngine.cancelRouteReplacement(
                pendingChange.engineRequestId,
            );
        }

        destinationChangeError = null;
    }

    // Une sélection explicite revient au panneau station sans détruire les
    // valeurs du planificateur, qui reste présent mais masqué dans le DOM.
    if (isRoutePlannerOpen) {
        closeRoutePlanner(false);
    }

    clearNavigationPaneCollapseTimeout();

    const renderId = ++stationPanelRenderId;
    displayedStation = station;

    const navigationState = getStationPanelNavigationState(station);

    element.innerHTML = renderStationPanel({
        station: getStationWithLatestAvailability(station),
        mode: currentMode,
        navigationState,
    });

    if (
        navigationState.isActiveNavigationPanel &&
        activeNavigationRouteSummary
    ) {
        updateRouteSummary(
            activeNavigationRouteSummary.distance,
            activeNavigationRouteSummary.duration,
        );
    }

    if (
        paneController.isAvailable() &&
        !(await updateStationPanelBottomHeight(renderId))
    ) {
        return;
    }

    updateStationPanelDestinationStatus(station);

    initModeSelector(element, {
        onModeChange: (mode) => {
            currentMode = mode;
            setDisplayMode(mode);
        },
    });

    return presentStationPanel(shouldPresentPane);
}
