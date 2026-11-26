import { getRoute } from './routing.js';
import { formatDistance, formatDuration } from './routeFormatting.js';
import {
    calculateDistanceBetweenCoordinates,
    calculateProjectionOnSegment,
} from '../geography/geometry.js';

export function createNavigationEngine(effects) {
    const {
        updateNavigationPosition,
        updateWalkingRoute,
        updateRouteSummary,
        // Observateur synchrone appelé après l'acceptation d'une progression.
        onProgress,
    } = effects;
    const progressListeners = new Set();
    const routeRecalculationListeners = new Set();

    let currentRouteCoordinates = [];
    let cumulativeRouteDistances = [];
    let lastRouteProgressIndex = 0;
    let lastAcceptedRouteProgress = 0;
    let lastAcceptedProgressTimestamp = null;
    let lastCameraGpsTimestamp = null;
    let navigationDestination = null;
    let currentRouteMode = null;

    let isRecalculatingRoute = false;
    let isReplacingRoute = false;

    let navigationSessionId = 0;
    // Identifie la géométrie active indépendamment des requêtes de remplacement.
    let routeGeneration = 0;
    // Paramètres de détection des sorties d'itinéraire.
    const OFF_ROUTE_THRESHOLD = 30;
    const OFF_ROUTE_CONFIRMATIONS = 3;
    const MAX_GPS_FIX_AGE_MS = 10_000;
    // Écarte les rafales sub-seconde pour compter des fixes distincts.
    const MIN_OFF_ROUTE_CONFIRMATION_INTERVAL_MS = 500;

    let consecutiveOffRoutePositions = 0;
    let lastProcessedGpsTimestamp = null;
    let lastOffRouteConfirmationTimestamp = null;

    const MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND = {
        pedestrian: 3,
        bicycle: 10,
    };
    const ROUTE_PROGRESS_MARGIN_METERS = 15;
    // Un écart inférieur au bruit GPS courant ne suffit pas à préférer une branche future.
    const ROUTE_BRANCH_DISTANCE_ADVANTAGE_METERS = 8;

    function setRouteProgressGeometry(coordinates) {
        currentRouteCoordinates = coordinates;
        cumulativeRouteDistances = [0];

        for (let i = 0; i < coordinates.length - 1; i++) {
            cumulativeRouteDistances.push(
                cumulativeRouteDistances[i] +
                    calculateDistanceBetweenCoordinates(
                        coordinates[i],
                        coordinates[i + 1],
                    ),
            );
        }

        lastRouteProgressIndex = 0;
        lastAcceptedRouteProgress = 0;
        lastAcceptedProgressTimestamp = null;
    }

    function resetOffRouteConfirmations() {
        consecutiveOffRoutePositions = 0;
        lastOffRouteConfirmationTimestamp = null;
    }

    /**
     * Enregistre l'itinéraire, sa destination et son profil de déplacement.
     */
    function setNavigationRoute(
        coordinates,
        destination,
        mode = 'pedestrian',
    ) {
        if (mode !== 'pedestrian' && mode !== 'bicycle') {
            throw new RangeError(`Unsupported navigation mode: ${mode}`);
        }

        setRouteProgressGeometry(coordinates);
        navigationDestination = destination;
        currentRouteMode = mode;
        routeGeneration++;
        resetOffRouteConfirmations();
        lastProcessedGpsTimestamp = null;
        lastCameraGpsTimestamp = null;
    }

    function getNavigationMode() {
        return currentRouteMode;
    }

    function getRouteGeneration() {
        return routeGeneration;
    }

    function subscribeToProgress(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('Progress listener must be a function.');
        }

        progressListeners.add(listener);
        return () => progressListeners.delete(listener);
    }

    function subscribeToRouteRecalculation(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('Route recalculation listener must be a function.');
        }

        routeRecalculationListeners.add(listener);
        return () => routeRecalculationListeners.delete(listener);
    }

    function notifyProgressListener(listener, event) {
        try {
            listener({
                ...event,
                position: { ...event.position },
                destination: event.destination
                    ? { ...event.destination }
                    : null,
            });
        } catch (error) {
            console.error('Erreur du callback de progression GPS :', error);
        }
    }

    function notifyRouteRecalculationListener(listener, event) {
        try {
            listener({
                ...event,
                destination: event.destination
                    ? { ...event.destination }
                    : null,
            });
        } catch (error) {
            console.error('Erreur du callback de recalcul de route :', error);
        }
    }

    function beginRouteReplacement() {
        if (isReplacingRoute || !navigationDestination || !currentRouteMode) {
            return null;
        }

        // Invalide un recalcul de l'ancienne destination encore en vol.
        navigationSessionId++;
        isRecalculatingRoute = false;
        isReplacingRoute = true;
        resetOffRouteConfirmations();

        return navigationSessionId;
    }

    function cancelRouteReplacement(replacementId) {
        if (!isReplacingRoute || replacementId !== navigationSessionId) {
            return false;
        }

        isReplacingRoute = false;
        navigationSessionId++;

        return true;
    }

    function commitRouteReplacement(
        replacementId,
        coordinates,
        destination,
        mode = currentRouteMode,
    ) {
        if (
            !isReplacingRoute ||
            replacementId !== navigationSessionId ||
            !Array.isArray(coordinates) ||
            coordinates.length < 2 ||
            (mode !== 'pedestrian' && mode !== 'bicycle')
        ) {
            return false;
        }

        // Garde la géométrie A si sa source cartographique n'est plus disponible.
        if (updateWalkingRoute(coordinates, mode) === false) {
            return false;
        }

        setRouteProgressGeometry(coordinates);
        navigationDestination = destination;
        currentRouteMode = mode;
        routeGeneration++;
        resetOffRouteConfirmations();
        lastProcessedGpsTimestamp = null;
        lastCameraGpsTimestamp = null;
        isRecalculatingRoute = false;
        isReplacingRoute = false;
        navigationSessionId++;

        return true;
    }

    /**
     * Recalcule l'itinéraire depuis la position actuelle
     * jusqu'à la destination initiale.
     */
    async function recalculateNavigationRoute(position) {
        if (isRecalculatingRoute || isReplacingRoute) {
            return;
        }

        if (!navigationDestination) {
            console.warn('Impossible de recalculer : destination inconnue.');
            return;
        }

        isRecalculatingRoute = true;

        const sessionId = navigationSessionId;
        const expectedRouteGeneration = routeGeneration;
        const routeMode = currentRouteMode;
        const routeDestination = navigationDestination
            ? { ...navigationDestination }
            : null;

        if (routeMode !== 'pedestrian' && routeMode !== 'bicycle') {
            isRecalculatingRoute = false;
            console.warn('Impossible de recalculer : mode de route inconnu.');
            return;
        }

        console.log('🔄 Recalcul de l’itinéraire en cours…');

        try {
            // Recalcule l'itinéraire avec le profil de la route courante.
            const segment = await getRoute(
                position,
                routeDestination,
                routeMode,
            );

            if (
                sessionId !== navigationSessionId ||
                expectedRouteGeneration !== routeGeneration
            ) {
                return;
            }

            // Remplace l'itinéraire actuel.
            // La progression repart du début du nouvel itinéraire.
            setRouteProgressGeometry(segment.geometry);
            currentRouteMode = segment.mode;
            routeGeneration++;

            const recalculationEvent = {
                sessionId,
                previousRouteGeneration: expectedRouteGeneration,
                routeGeneration,
                mode: currentRouteMode,
                destination: navigationDestination
                    ? { ...navigationDestination }
                    : null,
            };

            for (const listener of [...routeRecalculationListeners]) {
                notifyRouteRecalculationListener(listener, recalculationEvent);
            }

            // Réinitialise la détection de déviation.
            resetOffRouteConfirmations();

            // Met à jour la ligne sur la carte.
            updateWalkingRoute(segment.geometry, segment.mode);
            // Actualise la distance et la durée dans le panneau.
            updateRouteSummary(
                formatDistance(segment.distance),
                formatDuration(segment.duration),
            );

            console.log(
                '✅ Nouvel itinéraire calculé !',
                `Distance : ${segment.distance.toFixed(2)} km`,
            );
        } catch (error) {
            console.error('❌ Échec du recalcul de l’itinéraire :', error);
        } finally {
            if (sessionId === navigationSessionId) {
                isRecalculatingRoute = false;
            }
        }
    }

    /**
     * Met à jour la progression de l'utilisateur
     * et détecte les sorties d'itinéraire.
     */
    function updateNavigationProgress(position) {
        if (currentRouteCoordinates.length < 2) {
            return;
        }

        const timestamp = position.timestamp;
        const age = Date.now() - timestamp;
        const hasValidTimestamp =
            Number.isFinite(timestamp) && timestamp > 0;
        const hasFreshTimestamp =
            hasValidTimestamp &&
            age >= 0 &&
            age <= MAX_GPS_FIX_AGE_MS;
        const isFreshAndDistinct =
            hasFreshTimestamp &&
            (lastProcessedGpsTimestamp === null ||
                timestamp > lastProcessedGpsTimestamp);
        const isNewCameraFix =
            hasFreshTimestamp &&
            (lastCameraGpsTimestamp === null ||
                timestamp > lastCameraGpsTimestamp);

        if (hasFreshTimestamp && isNewCameraFix) {
            // L'horloge caméra avance même si précision/projection rejettent le fix.
            lastCameraGpsTimestamp = timestamp;
        }

        const hasValidCoordinates =
            Number.isFinite(position.longitude) &&
            position.longitude >= -180 &&
            position.longitude <= 180 &&
            Number.isFinite(position.latitude) &&
            position.latitude >= -90 &&
            position.latitude <= 90;

        if (!hasValidCoordinates) {
            resetOffRouteConfirmations();
            return;
        }

        let closestRouteDistance = Infinity;
        let closestProgressCandidate = null;

        const isDistinctProgressFix =
            hasFreshTimestamp &&
            (lastAcceptedProgressTimestamp === null ||
                timestamp > lastAcceptedProgressTimestamp);
        const elapsedSeconds =
            lastAcceptedProgressTimestamp === null
                ? 0
                : Math.max(
                      0,
                      (timestamp - lastAcceptedProgressTimestamp) / 1000,
                  );
        const initialGpsDisplacement =
            lastAcceptedProgressTimestamp === null
                ? calculateDistanceBetweenCoordinates(
                      currentRouteCoordinates[0],
                      [position.longitude, position.latitude],
                  )
                : 0;
        const maxForwardProgress =
            lastAcceptedRouteProgress +
            (lastAcceptedProgressTimestamp === null
                ? initialGpsDisplacement
                : (MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND[currentRouteMode] ??
                      MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND.pedestrian) *
                  elapsedSeconds) +
            ROUTE_PROGRESS_MARGIN_METERS;
        const minForwardProgress = lastAcceptedRouteProgress;

        for (let i = 0; i < currentRouteCoordinates.length - 1; i++) {
            const start = currentRouteCoordinates[i];
            const end = currentRouteCoordinates[i + 1];
            const segmentStartProgress = cumulativeRouteDistances[i];
            const segmentLength =
                cumulativeRouteDistances[i + 1] - segmentStartProgress;

            // La distance utilisée pour le détecteur reste mesurée sur tout le tracé.
            const routeProjection = calculateProjectionOnSegment(
                position,
                start,
                end,
            );

            closestRouteDistance = Math.min(
                closestRouteDistance,
                routeProjection.distance,
            );

            if (!isDistinctProgressFix || segmentLength === 0) {
                continue;
            }

            const segmentEndProgress = segmentStartProgress + segmentLength;
            if (
                segmentEndProgress < minForwardProgress ||
                segmentStartProgress > maxForwardProgress
            ) {
                continue;
            }

            const minT = Math.max(
                0,
                (minForwardProgress - segmentStartProgress) / segmentLength,
            );
            const maxT = Math.min(
                1,
                (maxForwardProgress - segmentStartProgress) / segmentLength,
            );
            const projection = calculateProjectionOnSegment(
                position,
                start,
                end,
                minT,
                maxT,
            );
            const progress =
                segmentStartProgress + projection.factor * segmentLength;

            const candidateIsFartherAhead =
                closestProgressCandidate &&
                progress - closestProgressCandidate.progress >
                    ROUTE_PROGRESS_MARGIN_METERS;
            const candidateImprovesDistance =
                !closestProgressCandidate ||
                projection.distance + ROUTE_BRANCH_DISTANCE_ADVANTAGE_METERS <
                    closestProgressCandidate.distance;

            if (
                !closestProgressCandidate ||
                (!candidateIsFartherAhead &&
                    projection.distance < closestProgressCandidate.distance) ||
                (candidateIsFartherAhead && candidateImprovesDistance)
            ) {
                closestProgressCandidate = {
                    distance: projection.distance,
                    coordinate: projection.coordinate,
                    segmentIndex: i,
                    progress,
                };
            }
        }

        // Seules les mesures GPS fraîches, uniques et suffisamment précises
        // peuvent confirmer une sortie d'itinéraire.
        if (!hasValidTimestamp || age < 0) {
            resetOffRouteConfirmations();
        } else if (age > MAX_GPS_FIX_AGE_MS) {
            resetOffRouteConfirmations();
        } else if (isFreshAndDistinct) {
            lastProcessedGpsTimestamp = timestamp;

            const accuracy = position.accuracy;
            const hasValidAccuracy =
                Number.isFinite(accuracy) && accuracy >= 0;

            if (!hasValidAccuracy) {
                resetOffRouteConfirmations();
            } else {
                const reliableOffRouteThreshold =
                    OFF_ROUTE_THRESHOLD + accuracy;

                if (closestRouteDistance > reliableOffRouteThreshold) {
                    if (
                        lastOffRouteConfirmationTimestamp !== null &&
                        timestamp - lastOffRouteConfirmationTimestamp >
                            MAX_GPS_FIX_AGE_MS
                    ) {
                        resetOffRouteConfirmations();
                    }

                    const timeSinceLastConfirmation =
                        lastOffRouteConfirmationTimestamp === null
                            ? null
                            : timestamp - lastOffRouteConfirmationTimestamp;

                    if (
                        timeSinceLastConfirmation === null ||
                        timeSinceLastConfirmation >=
                            MIN_OFF_ROUTE_CONFIRMATION_INTERVAL_MS
                    ) {
                        consecutiveOffRoutePositions++;
                        lastOffRouteConfirmationTimestamp = timestamp;

                        console.log(
                            `Écart à l'itinéraire : ${Math.round(closestRouteDistance)} m`,
                            `(${consecutiveOffRoutePositions}/${OFF_ROUTE_CONFIRMATIONS})`,
                        );

                        if (
                            consecutiveOffRoutePositions >=
                            OFF_ROUTE_CONFIRMATIONS
                        ) {
                            console.warn('Sortie d’itinéraire confirmée.');

                            // Évite de compter indéfiniment les positions
                            // pendant que le recalcul est en cours.
                            resetOffRouteConfirmations();

                            recalculateNavigationRoute(position);
                        }
                    }

                    // Une position hors itinéraire ne doit pas
                    // faire avancer artificiellement la progression.
                    if (isNewCameraFix) {
                        updateNavigationPosition(position, position);
                    }
                    return;
                }

                // Une mesure fiable revenue dans la marge remet la série à zéro.
                resetOffRouteConfirmations();
            }
        }

        // Conserve le comportement existant : une position au-delà de 30 m
        // ne fait pas avancer la progression si elle ne peut pas confirmer
        // une sortie fiable.
        if (
            !closestProgressCandidate ||
            closestProgressCandidate.distance > OFF_ROUTE_THRESHOLD
        ) {
            if (isNewCameraFix) {
                updateNavigationPosition(position, position);
            }
            return;
        }

        // La progression est monotone et bornée par le temps écoulé depuis
        // la dernière mesure GPS acceptée.
        lastAcceptedRouteProgress = Math.max(
            lastAcceptedRouteProgress,
            closestProgressCandidate.progress,
        );
        lastAcceptedProgressTimestamp = timestamp;
        lastRouteProgressIndex = Math.max(
            lastRouteProgressIndex,
            closestProgressCandidate.segmentIndex,
        );

        // Le tracé restant commence à la projection acceptée.
        const remainingCoordinates = closestProgressCandidate.coordinate
            ? [
                  closestProgressCandidate.coordinate,
                  ...currentRouteCoordinates.slice(
                      closestProgressCandidate.segmentIndex + 1,
                  ),
              ]
            : currentRouteCoordinates.slice(lastRouteProgressIndex);

        if (remainingCoordinates.length >= 2) {
            updateWalkingRoute(remainingCoordinates, currentRouteMode);
        }

        const accuracy = position.accuracy;
        const hasValidAccuracy =
            Number.isFinite(accuracy) && accuracy >= 0;
        const maxSnapDistance = Math.min(20, Math.max(8, accuracy));
        const canDisplayProjection =
            isFreshAndDistinct &&
            hasValidAccuracy &&
            accuracy <= 25 &&
            closestProgressCandidate.distance <= maxSnapDistance &&
            !isRecalculatingRoute;
        const displayedPosition = canDisplayProjection
            ? {
                  ...position,
                  longitude: closestProgressCandidate.coordinate[0],
                  latitude: closestProgressCandidate.coordinate[1],
              }
            : position;

        if (isNewCameraFix) {
            updateNavigationPosition(position, displayedPosition);
        }

        if (
            typeof onProgress === 'function' ||
            progressListeners.size > 0
        ) {
            const finalRouteDistance =
                cumulativeRouteDistances[cumulativeRouteDistances.length - 1];
            const progressEvent = {
                position: { ...position },
                destination: navigationDestination
                    ? { ...navigationDestination }
                    : null,
                // Mètres le long de la géométrie routée, pas une distance GPS.
                distanceRemaining: Math.max(
                    0,
                    finalRouteDistance - lastAcceptedRouteProgress,
                ),
                mode: currentRouteMode,
                routeGeneration,
            };

            if (typeof onProgress === 'function') {
                notifyProgressListener(onProgress, progressEvent);
            }

            for (const listener of [...progressListeners]) {
                if (listener !== onProgress) {
                    notifyProgressListener(listener, progressEvent);
                }
            }
        }
    }

    /**
     * Arrête les traitements internes de navigation.
     */
    function stopNavigationProcessing() {
        // Invalide les recalculs déjà lancés.
        navigationSessionId++;

        // Réinitialise les états de navigation.
        currentRouteCoordinates = [];
        cumulativeRouteDistances = [];
        lastRouteProgressIndex = 0;
        lastAcceptedRouteProgress = 0;
        lastAcceptedProgressTimestamp = null;
        lastCameraGpsTimestamp = null;
        navigationDestination = null;
        currentRouteMode = null;
        routeGeneration++;
        isRecalculatingRoute = false;
        isReplacingRoute = false;
        resetOffRouteConfirmations();
        lastProcessedGpsTimestamp = null;

        console.log('🛑 Traitements de navigation arrêtés.');
    }

    return {
        setNavigationRoute,
        getNavigationMode,
        getRouteGeneration,
        subscribeToProgress,
        subscribeToRouteRecalculation,
        beginRouteReplacement,
        cancelRouteReplacement,
        commitRouteReplacement,
        updateNavigationProgress,
        stopNavigationProcessing,
    };
}
