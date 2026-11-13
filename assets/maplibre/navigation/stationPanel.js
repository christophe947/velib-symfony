import { subscribeToSelectedStation, setDisplayMode } from '../shared/state.js';
import {
    getUserPositionErrorMessage,
    requestUserPosition,
    showUserMarker,
    startWatchingPosition,
} from '../location/geolocation.js';
import { getWalkingRoute, decodePolyline } from './routing.js';
import {
    drawWalkingRoute,
    drawRoutePreview,
    clearRoutePreview,
    fitWalkingRoute,
    showDestinationMarker,
    updateWalkingRoute,
    setUserFollowing,
    setNavigationActive,
    updateNavigationPosition,
    recenterOnUser,
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
import { calculateDistanceBetweenCoordinates } from '../geography/geometry.js';

const PLANNER_START_DISTANCE_LIMIT_METERS = 50;

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

let navigationStarted = false;
let navigationSessionId = 0;
let stationPanelRenderId = 0;
let displayedStation = null;
let activeNavigationStation = null;
let activeNavigationRouteSummary = null;
let routeSummaryData = null;
let destinationChangeRequestId = 0;
let pendingDestinationChange = null;
let destinationChangeError = null;

let positionWatchId = null;

// Dernière position GPS connue.
let lastKnownUserPosition = null;
let lastReliableUserPosition = null;
let navigationEngine = null;
const screenWakeLock = createScreenWakeLock();

let currentMode = 'bikes';
let latestStationsById = new Map();

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

function updateStationAvailability(stations, stale = false) {
    if (!Array.isArray(stations) || stale) {
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

function isFreshReliableGpsPosition(position) {
    return (
        isFreshGpsPosition(position) &&
        Number.isFinite(position.accuracy) &&
        position.accuracy >= 0 &&
        position.accuracy <= 25
    );
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
        segment?.mode === 'walking' &&
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
    return navigationStarted && !activeNavigationStation && isValidPlannerRoute();
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

function handleRoutePlannerStateChange() {
    routePreviewRequestId++;
    routePreviewAbortController?.abort();
    routePreviewAbortController = null;

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
        !navigationStarted ||
        navigationSessionId !== sessionId ||
        !hasCurrentTarget
    ) {
        return false;
    }

    if (isFreshGpsPosition(lastKnownUserPosition)) {
        recenterOnUser(map, lastKnownUserPosition);
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
            navigationStarted &&
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

    if (navigationStarted) {
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
    styleReady,
    sessionId,
    {
        station,
        route,
        summary,
        compassActivation,
        onCameraReady,
    },
) {
    stopBackgroundUserTracking();
    activeNavigationStation = station;
    activeNavigationRouteSummary = summary;
    routeSummaryData = summary;
    navigationStarted = true;
    setNavigationActive(
        true,
        isFreshGpsPosition(lastKnownUserPosition)
            ? lastKnownUserPosition
            : null,
    );
    setUserFollowing(true);
    screenWakeLock.start();

    let isInitialCameraSetup = true;
    const isSessionActive = () =>
        navigationStarted && sessionId === navigationSessionId;
    const compassPromise =
        compassActivation ??
        activateCompass(
            map,
            undefined,
            (error) => {
                console.error('Boussole indisponible :', error);
            },
            () => !isInitialCameraSetup,
        );

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

    await compassPromise;

    if (!isSessionActive()) {
        return false;
    }

    if (!isFreshGpsPosition(lastKnownUserPosition)) {
        try {
            const userPosition = await requestUserPosition({
                maximumAge: 0,
            });

            if (!isSessionActive()) {
                return false;
            }

            if (
                isFreshGpsPosition(userPosition) &&
                (!Number.isFinite(lastKnownUserPosition?.timestamp) ||
                    userPosition.timestamp > lastKnownUserPosition.timestamp)
            ) {
                lastKnownUserPosition = userPosition;
            }
        } catch (error) {
            if (!isSessionActive()) {
                return false;
            }

            console.warn(
                'Impossible d’obtenir une position GPS récente au démarrage :',
                error,
            );
        }
    }

    if (route) {
        const segment = route.segments[0];

        drawWalkingRoute(map, segment.geometry);
        showNavigationDestinationMarker(map, segment.destination);
        navigationEngine.setNavigationRoute(segment.geometry, {
            latitude: segment.destination.latitude,
            longitude: segment.destination.longitude,
        });
        clearRoutePreview(map);
    }

    if (lastKnownUserPosition) {
        showUserMarker(map, lastKnownUserPosition);
    }

    await restoreNavigationCamera(map, station, sessionId);

    if (!isSessionActive()) {
        return false;
    }

    isInitialCameraSetup = false;
    onCameraReady?.();

    positionWatchId = startWatchingPosition(
        (position) => {
            const lastKnownTimestamp = lastKnownUserPosition?.timestamp;

            if (
                isFreshGpsPosition(position) &&
                (!Number.isFinite(lastKnownTimestamp) ||
                    position.timestamp > lastKnownTimestamp)
            ) {
                lastKnownUserPosition = position;
            }

            if (
                isFreshReliableGpsPosition(position) &&
                (!Number.isFinite(lastReliableUserPosition?.timestamp) ||
                    position.timestamp > lastReliableUserPosition.timestamp)
            ) {
                lastReliableUserPosition = position;
            }

            navigationEngine.updateNavigationProgress(position);
        },
        (error) => {
            console.error('Erreur GPS :', error);
        },
    );

    if (station && stationsMatch(displayedStation, station)) {
        renderActiveNavigationControls(map, station, styleReady);
        scheduleNavigationPaneCollapse(station, sessionId);
    } else if (
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

    return true;
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
        updateWalkingRoute: (coordinates) =>
            updateWalkingRoute(map, coordinates),
        updateRouteSummary,
    });

    // Le panneau vide est présent dès le lancement
    // sur mobile comme sur desktop.
    renderEmptyPanel();
    plannerElement.innerHTML = renderRoutePlanner();
    routePlannerController = createRoutePlannerController(plannerElement, {
        onChange: handleRoutePlannerStateChange,
    });

    element.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-open-route-planner]');

        if (!trigger) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        showRoutePlanner(true, map);
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
        clearRoutePreview(map);
        routePreviewData = null;

        if (movePane) {
            paneController?.openPlanner();
        }

        return;
    }

    element.hidden = true;
    isRoutePlannerOpen = true;

    if (routePreviewData) {
        plannerElement.hidden = true;
        routePreviewElement.hidden = false;
        isRoutePreviewOpen = true;
        renderPlannerPreview(false);

        if (map && !navigationStarted) {
            drawRoutePreview(map, routePreviewData.segments[0].geometry);
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
    if (!isRoutePlannerOpen || isRoutePreviewOpen || navigationStarted) {
        if (navigationStarted) {
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

    const { origin, destination, mode } =
        routePlannerController?.getSelections() ?? {};

    if (mode !== 'walking') {
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
    const end = {
        latitude: destination.latitude,
        longitude: destination.longitude,
    };

    routePlannerController?.setCalculating(true);
    setPlannerCalculationMessage('Calcul de l’itinéraire en cours…');

    try {
        if (
            origin.type === 'current-location' &&
            !isFreshGpsPosition(origin)
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
                navigationStarted
            ) {
                return;
            }

            if (!isFreshGpsPosition(refreshedPosition)) {
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
        }

        setPlannerCalculationMessage('Calcul de l’itinéraire en cours…');
        const start = {
            latitude: routeOrigin.latitude,
            longitude: routeOrigin.longitude,
        };
        const trip = await getWalkingRoute(start, end, {
            signal: routePreviewAbortController.signal,
        });

        if (
            requestId !== routePreviewRequestId ||
            !isRoutePlannerOpen ||
            navigationStarted
        ) {
            return;
        }

        const shape = trip.legs?.[0]?.shape;
        const coordinates =
            typeof shape === 'string' ? decodePolyline(shape) : [];
        const routeDistance = trip.summary?.length;
        const routeDuration = trip.summary?.time;

        if (
            !isValidRouteCoordinates(coordinates) ||
            !Number.isFinite(routeDistance) ||
            routeDistance < 0 ||
            !Number.isFinite(routeDuration) ||
            routeDuration < 0
        ) {
            throw new Error('Valhalla returned an invalid route.');
        }

        const result = {
            segments: [
                {
                    mode: 'walking',
                    origin: { ...routeOrigin },
                    destination: { ...destination },
                    geometry: coordinates,
                    distance: routeDistance,
                    duration: routeDuration,
                },
            ],
            distance: routeDistance,
            duration: routeDuration,
        };

        await styleReady;

        if (
            requestId !== routePreviewRequestId ||
            !isRoutePlannerOpen ||
            navigationStarted
        ) {
            return;
        }

        drawRoutePreview(map, coordinates);

        if (!navigationStarted) {
            fitWalkingRoute(map, coordinates);
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

        clearRoutePreview(map);
        routePreviewData = null;
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
        navigationStarted ||
        !isRoutePlannerOpen ||
        !isRoutePreviewOpen ||
        !isValidPlannerRoute()
    ) {
        return;
    }

    const route = routePreviewData;
    const requestId = ++routePreviewRequestId;
    const segment = route.segments[0];
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
    const compassActivation = activateCompass(
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
        !navigationStarted;

    try {
        let userPosition = await requestUserPosition({ maximumAge: 0 });

        if (!isCurrentPlannerStart()) {
            return;
        }

        // La demande de permission boussole a été déclenchée dans le clic.
        // Si elle a pris du temps, on renouvelle le fix avant de démarrer.
        await compassActivation;

        if (!isCurrentPlannerStart()) {
            return;
        }

        if (!isFreshGpsPosition(userPosition)) {
            userPosition = await requestUserPosition({ maximumAge: 0 });

            if (!isCurrentPlannerStart()) {
                return;
            }
        }

        if (!isFreshReliableGpsPosition(userPosition)) {
            if (isFreshGpsPosition(userPosition)) {
                setPlannerPreviewMessage(
                    'La position GPS est trop imprécise pour démarrer. Attends un relevé plus précis puis réessaie.',
                    true,
                );
            } else {
                const error = new Error('The GPS fix is stale or invalid.');
                error.code = isValidRoutePlace(userPosition)
                    ? 'POSITION_STALE'
                    : 'POSITION_INVALID';
                throw error;
            }

            return;
        }

        const distanceToStart = calculateDistanceBetweenCoordinates(
            [userPosition.longitude, userPosition.latitude],
            segment.geometry[0],
        );

        if (distanceToStart > PLANNER_START_DISTANCE_LIMIT_METERS) {
            setPlannerPreviewMessage(
                `Tu es à ${Math.round(distanceToStart)} m du départ prévu. Rejoins-le ou modifie le départ avec « Ma position actuelle », puis recalcule l’itinéraire.`,
                true,
            );
            return;
        }

        if (
            !Number.isFinite(lastKnownUserPosition?.timestamp) ||
            userPosition.timestamp > lastKnownUserPosition.timestamp
        ) {
            lastKnownUserPosition = userPosition;
        }

        if (
            !Number.isFinite(lastReliableUserPosition?.timestamp) ||
            userPosition.timestamp > lastReliableUserPosition.timestamp
        ) {
            lastReliableUserPosition = userPosition;
        }

        if (!isCurrentPlannerStart()) {
            return;
        }

        sessionId = ++navigationSessionId;
        isPlannerRouteOutdated = false;

        await startNavigationSession(map, styleReady, sessionId, {
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
            navigationStarted &&
            navigationSessionId === sessionId
        ) {
            stopNavigation(map, null, styleReady);
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

        if (!navigationStarted && sessionId === null) {
            void compassActivation
                .then(() => {
                    if (!isPlannerNavigationStarting && !navigationStarted) {
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

        if (!navigationStarted) {
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
function stopNavigation(map, station, styleReady) {
    const wasPlannerNavigation = isPlannerNavigationActive();
    const shouldRestorePlannerPreview =
        wasPlannerNavigation && !station && !isPlannerRouteOutdated;
    const plannerRouteNeedsRecalculation =
        wasPlannerNavigation && isPlannerRouteOutdated;

    clearNavigationPaneCollapseTimeout();

    // Invalide les opérations asynchrones de la session.
    navigationSessionId++;
    destinationChangeRequestId++;
    pendingDestinationChange = null;
    destinationChangeError = null;
    navigationStarted = false;
    activeNavigationStation = null;
    activeNavigationRouteSummary = null;
    routeSummaryData = null;
    if (plannerRouteNeedsRecalculation) {
        routePreviewData = null;
    }
    isPlannerRouteOutdated = false;
    screenWakeLock.stop();

    // Arrête le suivi GPS.
    if (positionWatchId !== null) {
        navigator.geolocation.clearWatch(positionWatchId);
        positionWatchId = null;
    }

    // Arrête la boussole.
    stopCompass();

    // Arrête les traitements de navigation et invalide les recalculs.
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
    lastKnownUserPosition = null;
    lastReliableUserPosition = null;
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
        updateStationPanel(station, map, styleReady);
    } else if (shouldRestorePlannerPreview) {
        isRoutePlannerOpen = true;
        isRoutePreviewOpen = true;
        element.hidden = true;
        plannerElement.hidden = true;
        routePreviewElement.hidden = false;
        renderPlannerPreview(false);
        drawRoutePreview(map, routePreviewData.segments[0].geometry);

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
    }

    console.log('🛑 Navigation arrêtée.');
}

function isCurrentDestinationChange(request) {
    return (
        pendingDestinationChange === request &&
        request.id === destinationChangeRequestId &&
        request.sessionId === navigationSessionId &&
        navigationStarted
    );
}

async function startDestinationChange(map, station, styleReady) {
    if (!navigationStarted || pendingDestinationChange) {
        return;
    }

    const request = {
        id: ++destinationChangeRequestId,
        sessionId: navigationSessionId,
        engineRequestId: null,
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
        let userPosition = lastReliableUserPosition;

        if (!isFreshReliableGpsPosition(userPosition)) {
            try {
                userPosition = await requestUserPosition({ maximumAge: 0 });
            } catch (error) {
                userPosition = null;
            }

            if (!isCurrentDestinationChange(request)) {
                return;
            }

            if (
                isFreshReliableGpsPosition(lastReliableUserPosition) &&
                (!isFreshReliableGpsPosition(userPosition) ||
                    lastReliableUserPosition.timestamp > userPosition.timestamp)
            ) {
                userPosition = lastReliableUserPosition;
            }

            if (!isFreshReliableGpsPosition(userPosition)) {
                pendingDestinationChange = null;
                destinationChangeError = {
                    station,
                    message:
                        'La position GPS est absente, trop imprécise ou trop ancienne. Attends un nouveau relevé puis réessaie.',
                };
                updateStationPanel(displayedStation ?? station, map, styleReady, false);
                return;
            }

            if (
                (!Number.isFinite(lastKnownUserPosition?.timestamp) ||
                    userPosition.timestamp > lastKnownUserPosition.timestamp) &&
                isFreshGpsPosition(userPosition)
            ) {
                lastKnownUserPosition = userPosition;
            }

            if (
                !Number.isFinite(lastReliableUserPosition?.timestamp) ||
                userPosition.timestamp > lastReliableUserPosition.timestamp
            ) {
                lastReliableUserPosition = userPosition;
            }
        }

        if (!isCurrentDestinationChange(request)) {
            return;
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

        const route = await getWalkingRoute(userPosition, {
            latitude: station.latitude,
            longitude: station.longitude,
        });

        if (!isCurrentDestinationChange(request)) {
            return;
        }

        const coordinates = decodePolyline(route.legs[0].shape);

        if (
            !isValidRouteCoordinates(coordinates) ||
            !Number.isFinite(route.summary?.length) ||
            !Number.isFinite(route.summary?.time)
        ) {
            throw new Error('Valhalla returned an invalid route.');
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
                coordinates,
                {
                    latitude: station.latitude,
                    longitude: station.longitude,
                },
            )
        ) {
            throw new Error('The current route could not be replaced on the map.');
        }

        const distance = formatDistance(route.summary.length);
        const duration = formatDuration(route.summary.time);

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

async function updateStationPanel(
    station,
    map,
    styleReady,
    shouldPresentPane = true,
) {
    if (!station || !element) {
        return;
    }

    // Une sélection explicite revient au panneau station sans détruire les
    // valeurs du planificateur, qui reste présent mais masqué dans le DOM.
    if (isRoutePlannerOpen) {
        closeRoutePlanner(false);
    }

    clearNavigationPaneCollapseTimeout();

    const renderId = ++stationPanelRenderId;
    displayedStation = station;

    const isActiveNavigationPanel =
        navigationStarted && stationsMatch(station, activeNavigationStation);
    const isNavigationContextPanel =
        navigationStarted && !isActiveNavigationPanel;

    element.innerHTML = renderStationPanel({
        station: getStationWithLatestAvailability(station),
        mode: currentMode,
        navigationState: {
            isActiveNavigationPanel,
            isNavigationContextPanel,
        },
    });

    if (isActiveNavigationPanel && activeNavigationRouteSummary) {
        updateRouteSummary(
            activeNavigationRouteSummary.distance,
            activeNavigationRouteSummary.duration,
        );
    }

    if (paneController.isAvailable()) {
        const title = element.querySelector('.station-panel-title');

        if (title) {
            const bottomHeight = title.getBoundingClientRect().height + 30;

            await paneController.updateBottomHeight(bottomHeight);
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

    const stopButton = element.querySelector('.station-panel-stop');
    stopButton?.addEventListener('click', () => {
        showStopNavigationConfirmation(map, station, styleReady);
    });

    const resumeButton = element.querySelector(
        '.station-panel-context-resume',
    );
    resumeButton?.addEventListener('click', () => {
        if (!navigationStarted) {
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
    });

    replaceButton?.addEventListener('click', () => {
        if (replaceButton.disabled || pendingDestinationChange) {
            return;
        }

        showStopNavigationConfirmation(map, station, styleReady, {
            title: 'Changer de destination ?',
            message:
                'Remplacer l’itinéraire actuel par un itinéraire vers cette station ?',
            cancelLabel: 'Annuler',
            confirmLabel: 'Confirmer',
            onConfirm: () => startDestinationChange(map, station, styleReady),
        });
    });

    joinButton?.addEventListener('click', async () => {
        if (navigationStarted) {
            return;
        }

        // Identifie cette opération asynchrone.
        const sessionId = ++navigationSessionId;

        if (joinButton.textContent.trim() === 'Démarrer') {
            joinButton.disabled = true;
            joinButton.textContent = 'Démarrage…';
            await startNavigationSession(map, styleReady, sessionId, {
                station,
                route: null,
                summary: routeSummaryData,
            });

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

            if (isFreshReliableGpsPosition(userPosition)) {
                lastReliableUserPosition = userPosition;
            }

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

            const coordinates = decodePolyline(route.legs[0].shape);

            if (
                !isValidRouteCoordinates(coordinates) ||
                !Number.isFinite(route.summary?.length) ||
                !Number.isFinite(route.summary?.time)
            ) {
                throw new Error('Valhalla returned an invalid route.');
            }

            const distance = formatDistance(route.summary.length);

            const duration = formatDuration(route.summary.time);

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

                if (paneController.isAvailable()) {
                    const content = element.querySelector(
                        '.station-panel-content',
                    );

                    paneController.present({
                        animate: true,
                    });

                    if (content) {
                        const middleHeight =
                            content.getBoundingClientRect().height;

                        paneController.updateMiddleHeight(middleHeight);
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
                if (paneController.isAvailable()) {
                    const content = element.querySelector(
                        '.station-panel-content',
                    );

                    paneController.present({
                        animate: true,
                    });

                    if (content) {
                        const middleHeight =
                            content.getBoundingClientRect().height;

                        paneController.updateMiddleHeight(middleHeight);
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

    initModeSelector(element, {
        onModeChange: (mode) => {
            currentMode = mode;
            setDisplayMode(mode);
        },
    });

    if (paneController.isAvailable()) {
        const content = element.querySelector('.station-panel-content');

        if (!shouldPresentPane) {
            if (content) {
                const middleHeight = content.getBoundingClientRect().height;

                await paneController.updateMiddleHeight(middleHeight, false);
            }

            return;
        }

        paneController.present({
            animate: true,
        });

        if (content) {
            const middleHeight = content.getBoundingClientRect().height;

            paneController.updateMiddleHeight(middleHeight);
        }

        return;
    }

    // Desktop
    paneElement.classList.add('is-open');
}
