import { getWalkingRoute, decodePolyline } from './routing.js';
import { formatDistance, formatDuration } from './routeFormatting.js';

export function createNavigationEngine(effects) {
    const {
        showUserMarker,
        followUserPosition,
        updateWalkingRoute,
        updateRouteSummary,
    } = effects;

    let currentRouteCoordinates = [];
    let cumulativeRouteDistances = [];
    let lastRouteProgressIndex = 0;
    let lastAcceptedRouteProgress = 0;
    let lastAcceptedProgressTimestamp = null;
    let lastCameraGpsTimestamp = null;
    let simulationIntervalId = null;

    let navigationDestination = null;

    let isRecalculatingRoute = false;

    let navigationSessionId = 0;
    let offRouteSimulationIntervalId = null;

    // Paramètres de détection des sorties d'itinéraire.
    const OFF_ROUTE_THRESHOLD = 30;
    const OFF_ROUTE_CONFIRMATIONS = 3;
    const MAX_GPS_FIX_AGE_MS = 10_000;
    // Écarte les rafales sub-seconde tout en gardant la cadence de la simulation.
    const MIN_OFF_ROUTE_CONFIRMATION_INTERVAL_MS = 500;

    let consecutiveOffRoutePositions = 0;
    let lastProcessedGpsTimestamp = null;
    let lastOffRouteConfirmationTimestamp = null;

    const MAX_PLAUSIBLE_WALKING_SPEED = 3;
    const ROUTE_PROGRESS_MARGIN_METERS = 15;
    // Un écart inférieur au bruit GPS courant ne suffit pas à préférer une branche future.
    const ROUTE_BRANCH_DISTANCE_ADVANTAGE_METERS = 8;

    function calculateDistanceBetweenCoordinates(start, end) {
        const earthRadius = 6371000;
        const toRadians = (degrees) => (degrees * Math.PI) / 180;
        const latitude1 = toRadians(start[1]);
        const latitude2 = toRadians(end[1]);
        const latitudeDifference = latitude2 - latitude1;
        const longitudeDifference = toRadians(end[0] - start[0]);
        const haversine =
            Math.sin(latitudeDifference / 2) ** 2 +
            Math.cos(latitude1) *
                Math.cos(latitude2) *
                Math.sin(longitudeDifference / 2) ** 2;

        return (
            2 *
            earthRadius *
            Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
        );
    }

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

    /**
     * Recalcule l'itinéraire depuis la position actuelle
     * jusqu'à la destination initiale.
     */
    async function recalculateNavigationRoute(position) {
        if (isRecalculatingRoute) {
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
            isRecalculatingRoute = false;
        }
    }

    /**
     * Calcule la distance minimale entre une position GPS
     * et un segment de l'itinéraire.
     *
     * Les coordonnées sont au format [longitude, latitude].
     * Le résultat est exprimé en mètres.
     */
    /**
     * Calcule la projection d'une position GPS sur un segment.
     *
     * Retourne :
     * - la distance minimale en mètres ;
     * - les coordonnées du point le plus proche sur le segment.
     */
    function calculateProjectionOnSegment(
        position,
        start,
        end,
        minT = 0,
        maxT = 1,
    ) {
        const earthRadius = 6371000;

        const toRadians = (degrees) => (degrees * Math.PI) / 180;

        const referenceLatitude = toRadians(position.latitude);

        const project = (coordinate) => {
            const [longitude, latitude] = coordinate;

            return {
                x:
                    toRadians(longitude - position.longitude) *
                    earthRadius *
                    Math.cos(referenceLatitude),

                y: toRadians(latitude - position.latitude) * earthRadius,
            };
        };

        // Projection locale du segment en mètres.
        const a = project(start);
        const b = project(end);

        const abX = b.x - a.x;
        const abY = b.y - a.y;

        const segmentLengthSquared = abX * abX + abY * abY;

        let t = 0;

        if (segmentLengthSquared > 0) {
            t = -(a.x * abX + a.y * abY) / segmentLengthSquared;

            t = Math.max(minT, Math.min(maxT, t));
        }

        // Point le plus proche de la position GPS.
        const closestX = a.x + t * abX;
        const closestY = a.y + t * abY;

        // Coordonnées géographiques de ce point.
        const coordinate = [
            start[0] + t * (end[0] - start[0]),
            start[1] + t * (end[1] - start[1]),
        ];

        return {
            distance: Math.hypot(closestX, closestY),
            coordinate,
            factor: t,
        };
    }

    /**
     * Met à jour la progression de l'utilisateur
     * et détecte les sorties d'itinéraire.
     */
    function updateNavigationProgress(position, options = {}) {
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

        if (isNewCameraFix) {
            followUserPosition(position);
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
            options.maxForwardProgress ??
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
                    showUserMarker(position);
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
            showUserMarker(position);
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

        showUserMarker(displayedPosition);
    }

    /**
     * Calcule le cap entre deux coordonnées géographiques.
     *
     * Les coordonnées sont au format [longitude, latitude].
     * Le résultat est exprimé en degrés, entre 0 et 360.
     */
    function calculateHeading(start, end) {
        const toRadians = (degrees) => (degrees * Math.PI) / 180;

        const [longitude1, latitude1] = start;
        const [longitude2, latitude2] = end;

        const lat1 = toRadians(latitude1);
        const lat2 = toRadians(latitude2);
        const deltaLongitude = toRadians(longitude2 - longitude1);

        const y = Math.sin(deltaLongitude) * Math.cos(lat2);

        const x =
            Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude);

        const heading = (Math.atan2(y, x) * 180) / Math.PI;

        return (heading + 360) % 360;
    }

    /**
     * Simule le déplacement de l'utilisateur le long de l'itinéraire.
     */
    function startNavigationSimulation(onFinish) {
        if (currentRouteCoordinates.length < 2) {
            console.warn('Aucun itinéraire à simuler.');
            return;
        }

        let index = lastRouteProgressIndex;
        //let simulationIntervalId = null;
        if (simulationIntervalId !== null) {
            return;
        }

        simulationIntervalId = setInterval(() => {
            index += 3;

            if (index >= currentRouteCoordinates.length - 1) {
                index = currentRouteCoordinates.length - 1;
            }

            const [longitude, latitude] = currentRouteCoordinates[index];

            // Point suivant sur l'itinéraire pour calculer la direction.
            const nextIndex = Math.min(
                index + 1,
                currentRouteCoordinates.length - 1,
            );

            const heading = calculateHeading(
                currentRouteCoordinates[index],
                currentRouteCoordinates[nextIndex],
            );

            const position = {
                longitude,
                latitude,
                heading,
                speed: 1.4,
                accuracy: 5,
                timestamp: Date.now(),
            };

            updateNavigationProgress(position, {
                maxForwardProgress: cumulativeRouteDistances[index],
            });

            // On arrête et on replace le marqueur à la fin de l'itinéraire.
            if (index >= currentRouteCoordinates.length - 1) {
                clearInterval(simulationIntervalId);
                simulationIntervalId = null;
                onFinish?.();
            }
        }, 500);
    }

    /**
     * Arrête la simulation normale si elle est en cours.
     */
    function stopNavigationSimulation() {
        if (simulationIntervalId !== null) {
            clearInterval(simulationIntervalId);
            simulationIntervalId = null;

            console.log('⏸️ Simulation normale suspendue pour le test.');
        }
    }

    /**
     * Simule trois positions consécutives hors itinéraire.
     */
    function startOffRouteSimulation() {
        if (currentRouteCoordinates.length < 2) {
            console.warn('Aucun itinéraire à tester.');
            return;
        }

        if (offRouteSimulationIntervalId !== null) {
            return;
        }

        // Évite que deux simulations envoient des positions simultanément.
        stopNavigationSimulation();

        // Chaque nouveau test repart avec un compteur propre.
        consecutiveOffRoutePositions = 0;

        console.log('🧪 Début du test de sortie d’itinéraire.');

        // On choisit un point suffisamment loin du début
        // pour ne pas perturber le démarrage du parcours.
        const index = Math.min(
            lastRouteProgressIndex + 10,
            currentRouteCoordinates.length - 1,
        );

        const [longitude, latitude] = currentRouteCoordinates[index];

        // Décalage artificiel d'environ 50 mètres vers l'est.
        const longitudeOffset =
            50 / (111320 * Math.cos((latitude * Math.PI) / 180));

        const simulatedPosition = {
            longitude: longitude + longitudeOffset,
            latitude,
        };

        let count = 0;

        const intervalId = setInterval(() => {
            count++;

            console.log(`🧪 Position artificielle hors itinéraire : ${count}/3`);

            const position = {
                ...simulatedPosition,
                accuracy: 5,
                timestamp: Date.now(),
            };

            updateNavigationProgress(position);

            if (count >= 3) {
                clearInterval(intervalId);
                offRouteSimulationIntervalId = null;

                console.log(
                    '✅ Test terminé : consulte les messages de détection ci-dessus.',
                );
            }
        }, 1000);

        offRouteSimulationIntervalId = intervalId;
    }

    /**
     * Arrête les traitements internes de navigation.
     */
    function stopNavigationProcessing() {
        // Invalide les recalculs déjà lancés.
        navigationSessionId++;

        // Arrête la simulation normale.
        if (simulationIntervalId !== null) {
            clearInterval(simulationIntervalId);
            simulationIntervalId = null;
        }

        // Arrête la simulation de déviation.
        if (offRouteSimulationIntervalId !== null) {
            clearInterval(offRouteSimulationIntervalId);
            offRouteSimulationIntervalId = null;
        }

        // Réinitialise les états de navigation.
        currentRouteCoordinates = [];
        cumulativeRouteDistances = [];
        lastRouteProgressIndex = 0;
        lastAcceptedRouteProgress = 0;
        lastAcceptedProgressTimestamp = null;
        lastCameraGpsTimestamp = null;
        navigationDestination = null;
        isRecalculatingRoute = false;
        resetOffRouteConfirmations();
        lastProcessedGpsTimestamp = null;

        console.log('🛑 Traitements de navigation arrêtés.');
    }

    return {
        setNavigationRoute,
        updateNavigationProgress,
        startNavigationSimulation,
        startOffRouteSimulation,
        stopNavigationProcessing,
    };
}
