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
    let lastRouteProgressIndex = 0;
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

    function resetOffRouteConfirmations() {
        consecutiveOffRoutePositions = 0;
        lastOffRouteConfirmationTimestamp = null;
    }

    /**
     * Enregistre l'itinéraire et sa destination.
     */
    function setNavigationRoute(coordinates, destination) {
        currentRouteCoordinates = coordinates;
        lastRouteProgressIndex = 0;
        navigationDestination = destination;
        resetOffRouteConfirmations();
        lastProcessedGpsTimestamp = null;
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
            currentRouteCoordinates = coordinates;

            // La progression repart du début du nouvel itinéraire.
            lastRouteProgressIndex = 0;

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
    function calculateProjectionOnSegment(position, start, end) {
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

            t = Math.max(0, Math.min(1, t));
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
        };
    }

    /**
     * Met à jour la progression de l'utilisateur
     * et détecte les sorties d'itinéraire.
     */
    function updateNavigationProgress(position) {
        if (currentRouteCoordinates.length < 2) {
            return;
        }

        followUserPosition(position);

        let closestSegmentIndex = lastRouteProgressIndex;
        let closestDistance = Infinity;
        let closestCoordinate = null;

        // On cherche le segment le plus proche,
        // sans revenir en arrière sur l'itinéraire.
        for (
            let i = lastRouteProgressIndex;
            i < currentRouteCoordinates.length - 1;
            i++
        ) {
            const start = currentRouteCoordinates[i];
            const end = currentRouteCoordinates[i + 1];

            const projection = calculateProjectionOnSegment(position, start, end);

            if (projection.distance < closestDistance) {
                closestDistance = projection.distance;
                closestSegmentIndex = i;
                closestCoordinate = projection.coordinate;
            }
        }

        // Seules les mesures GPS fraîches, uniques et suffisamment précises
        // peuvent confirmer une sortie d'itinéraire.
        const timestamp = position.timestamp;
        const age = Date.now() - timestamp;
        const hasValidTimestamp =
            Number.isFinite(timestamp) && timestamp > 0;
        const isFreshAndDistinct =
            hasValidTimestamp &&
            age >= 0 &&
            age <= MAX_GPS_FIX_AGE_MS &&
            (lastProcessedGpsTimestamp === null ||
                timestamp > lastProcessedGpsTimestamp);

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

                if (closestDistance > reliableOffRouteThreshold) {
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
                            `Écart à l'itinéraire : ${Math.round(closestDistance)} m`,
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
                    return;
                }

                // Une mesure fiable revenue dans la marge remet la série à zéro.
                resetOffRouteConfirmations();
            }
        }

        // Conserve le comportement existant : une position au-delà de 30 m
        // ne fait pas avancer la progression si elle ne peut pas confirmer
        // une sortie fiable.
        if (closestDistance > OFF_ROUTE_THRESHOLD) {
            return;
        }

        // La progression ne peut jamais reculer.
        lastRouteProgressIndex = Math.max(
            lastRouteProgressIndex,
            closestSegmentIndex,
        );

        // Le tracé restant commence à la position projetée
        // sur le segment le plus proche.
        const remainingCoordinates = closestCoordinate
            ? [
                  closestCoordinate,
                  ...currentRouteCoordinates.slice(closestSegmentIndex + 1),
              ]
            : currentRouteCoordinates.slice(lastRouteProgressIndex);

        if (remainingCoordinates.length >= 2) {
            updateWalkingRoute(remainingCoordinates);
        }
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

            showUserMarker(position);
            updateNavigationProgress(position);

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

            showUserMarker(position);

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
        lastRouteProgressIndex = 0;
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
