import { getWalkingRoute, decodePolyline } from './routing.js';
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
    } = effects;

    let currentRouteCoordinates = [];
    let cumulativeRouteDistances = [];
    let lastRouteProgressIndex = 0;
    let lastAcceptedRouteProgress = 0;
    let lastAcceptedProgressTimestamp = null;
    let lastCameraGpsTimestamp = null;
    let navigationDestination = null;

    let isRecalculatingRoute = false;
    let isReplacingRoute = false;

    let navigationSessionId = 0;
    // Paramètres de détection des sorties d'itinéraire.
    const OFF_ROUTE_THRESHOLD = 30;
    const OFF_ROUTE_CONFIRMATIONS = 3;
    const MAX_GPS_FIX_AGE_MS = 10_000;
    // Écarte les rafales sub-seconde pour compter des fixes distincts.
    const MIN_OFF_ROUTE_CONFIRMATION_INTERVAL_MS = 500;

    let consecutiveOffRoutePositions = 0;
    let lastProcessedGpsTimestamp = null;
    let lastOffRouteConfirmationTimestamp = null;

    const MAX_PLAUSIBLE_WALKING_SPEED = 3;
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
     * Enregistre l'itinéraire et sa destination.
     */
    function setNavigationRoute(coordinates, destination) {
        setRouteProgressGeometry(coordinates);
        navigationDestination = destination;
        resetOffRouteConfirmations();
        lastProcessedGpsTimestamp = null;
        lastCameraGpsTimestamp = null;
    }

    function beginRouteReplacement() {
        if (isReplacingRoute || !navigationDestination) {
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

    function commitRouteReplacement(replacementId, coordinates, destination) {
        if (
            !isReplacingRoute ||
            replacementId !== navigationSessionId ||
            !Array.isArray(coordinates) ||
            coordinates.length < 2
        ) {
            return false;
        }

        // Garde la géométrie A si sa source cartographique n'est plus disponible.
        if (updateWalkingRoute(coordinates) === false) {
            return false;
        }

        setRouteProgressGeometry(coordinates);
        navigationDestination = destination;
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

        console.log('🔄 Recalcul de l’itinéraire en cours…');

        try {
            // Demande un nouvel itinéraire à Valhalla.
            const route = await getWalkingRoute(position, navigationDestination);

            // Décode la géométrie du nouvel itinéraire.
            const coordinates = decodePolyline(route.legs[0].shape);

            if (sessionId !== navigationSessionId) {
                return;
            }

            if (coordinates.length < 2) {
                throw new Error('Le nouvel itinéraire est invalide.');
            }

            // Remplace l'itinéraire actuel.
            // La progression repart du début du nouvel itinéraire.
            setRouteProgressGeometry(coordinates);

            // Réinitialise la détection de déviation.
            resetOffRouteConfirmations();

            // Met à jour la ligne sur la carte.
            updateWalkingRoute(coordinates);
            // Actualise la distance et la durée dans le panneau.
            updateRouteSummary(
                formatDistance(route.summary.length),
                formatDuration(route.summary.time),
            );

            console.log(
                '✅ Nouvel itinéraire calculé !',
                `Distance : ${route.summary.length.toFixed(2)} km`,
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
                : MAX_PLAUSIBLE_WALKING_SPEED * elapsedSeconds) +
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
            updateWalkingRoute(remainingCoordinates);
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
        isRecalculatingRoute = false;
        isReplacingRoute = false;
        resetOffRouteConfirmations();
        lastProcessedGpsTimestamp = null;

        console.log('🛑 Traitements de navigation arrêtés.');
    }

    return {
        setNavigationRoute,
        beginRouteReplacement,
        cancelRouteReplacement,
        commitRouteReplacement,
        updateNavigationProgress,
        stopNavigationProcessing,
    };
}
