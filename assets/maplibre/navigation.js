import { updateWalkingRoute } from './map.js';
import { showUserMarker } from './geolocation.js';
import {
    getWalkingRoute,
    decodePolyline
} from './routing.js';
import {
    updateRouteSummary
} from './routeSummary.js';
import {
    formatDistance,
    formatDuration
} from './routeFormatting.js';

let currentRouteCoordinates = [];
let lastRouteProgressIndex = 0;
let simulationIntervalId = null;

let navigationDestination = null;

let isRecalculatingRoute = false;

// Paramètres de détection des sorties d'itinéraire.
const OFF_ROUTE_THRESHOLD = 30;
const OFF_ROUTE_CONFIRMATIONS = 3;

let consecutiveOffRoutePositions = 0;

/**
 * Enregistre l'itinéraire et sa destination.
 */
export function setNavigationRoute(coordinates, destination) {
    currentRouteCoordinates = coordinates;
    lastRouteProgressIndex = 0;
    navigationDestination = destination;
}


/**
 * Recalcule l'itinéraire depuis la position actuelle
 * jusqu'à la destination initiale.
 */
async function recalculateNavigationRoute(position, map) {

    if (isRecalculatingRoute) {
        return;
    }

    if (!navigationDestination) {
        console.warn(
            'Impossible de recalculer : destination inconnue.'
        );
        return;
    }

    isRecalculatingRoute = true;

    console.log('🔄 Recalcul de l’itinéraire en cours…');

    try {

        // Demande un nouvel itinéraire à Valhalla.
        const route = await getWalkingRoute(
            position,
            navigationDestination
        );

        // Décode la géométrie du nouvel itinéraire.
        const coordinates = decodePolyline(
            route.legs[0].shape
        );

        if (coordinates.length < 2) {
            throw new Error(
                'Le nouvel itinéraire est invalide.'
            );
        }

        // Remplace l'itinéraire actuel.
        currentRouteCoordinates = coordinates;

        // La progression repart du début du nouvel itinéraire.
        lastRouteProgressIndex = 0;

        // Réinitialise la détection de déviation.
        consecutiveOffRoutePositions = 0;

        // Met à jour la ligne sur la carte.
        updateWalkingRoute(map, coordinates);
        // Actualise la distance et la durée dans le panneau.
        updateRouteSummary(
            formatDistance(route.summary.length),
            formatDuration(route.summary.time)
        );

        console.log(
            '✅ Nouvel itinéraire calculé !',
            `Distance : ${route.summary.length.toFixed(2)} km`
        );

    } catch (error) {

        console.error(
            '❌ Échec du recalcul de l’itinéraire :',
            error
        );

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
function calculateDistanceToSegment(
    position,
    start,
    end
) {
    const earthRadius = 6371000;

    const toRadians = degrees =>
        degrees * Math.PI / 180;

    // On utilise la latitude de la position GPS
    // pour obtenir une projection locale en mètres.
    const referenceLatitude = toRadians(
        position.latitude
    );

    const project = coordinate => {
        const [longitude, latitude] = coordinate;

        return {
            x:
                toRadians(longitude - position.longitude) *
                earthRadius *
                Math.cos(referenceLatitude),

            y:
                toRadians(latitude - position.latitude) *
                earthRadius
        };
    };

    // La position GPS devient l'origine (0, 0).
    const a = project(start);
    const b = project(end);

    // Vecteur représentant le segment AB.
    const abX = b.x - a.x;
    const abY = b.y - a.y;

    // Longueur au carré du segment.
    const segmentLengthSquared =
        abX * abX + abY * abY;

    let t = 0;

    if (segmentLengthSquared > 0) {
        // Projection de l'origine sur le segment AB.
        t = -(
            a.x * abX +
            a.y * abY
        ) / segmentLengthSquared;

        // On limite la projection aux extrémités du segment.
        t = Math.max(0, Math.min(1, t));
    }

    // Coordonnées du point le plus proche sur le segment.
    const closestX = a.x + t * abX;
    const closestY = a.y + t * abY;

    return Math.hypot(
        closestX,
        closestY
    );
}

/**
 * Met à jour la progression de l'utilisateur
 * et détecte les sorties d'itinéraire.
 */
export function updateNavigationProgress(position, map) {

    if (currentRouteCoordinates.length < 2) {
        return;
    }

    let closestSegmentIndex = lastRouteProgressIndex;
    let closestDistance = Infinity;

    // On cherche le segment le plus proche,
    // sans revenir en arrière sur l'itinéraire.
    for (
        let i = lastRouteProgressIndex;
        i < currentRouteCoordinates.length - 1;
        i++
    ) {
        const start = currentRouteCoordinates[i];
        const end = currentRouteCoordinates[i + 1];

        const distance = calculateDistanceToSegment(
            position,
            start,
            end
        );

        if (distance < closestDistance) {
            closestDistance = distance;
            closestSegmentIndex = i;
        }
    }

    // Détection d'une éventuelle sortie d'itinéraire.
    if (closestDistance > OFF_ROUTE_THRESHOLD) {

        consecutiveOffRoutePositions++;

        console.log(
            `Écart à l'itinéraire : ${Math.round(closestDistance)} m`,
            `(${consecutiveOffRoutePositions}/${OFF_ROUTE_CONFIRMATIONS})`
        );

        if (
            consecutiveOffRoutePositions >=
            OFF_ROUTE_CONFIRMATIONS
        ) {
            console.warn(
                'Sortie d’itinéraire confirmée.'
            );

            // Évite de compter indéfiniment les positions
            // pendant que le recalcul est en cours.
            consecutiveOffRoutePositions = 0;

            recalculateNavigationRoute(
                position,
                map
            );
        }
        // Une position hors itinéraire ne doit pas
        // faire avancer artificiellement la progression.
        return;
    }

    // La position est revenue suffisamment près du tracé.
    consecutiveOffRoutePositions = 0;

    // La progression ne peut jamais reculer.
    lastRouteProgressIndex = Math.max(
        lastRouteProgressIndex,
        closestSegmentIndex
    );

    // On conserve uniquement la portion restante.
    const remainingCoordinates =
        currentRouteCoordinates.slice(
            lastRouteProgressIndex
        );

    if (remainingCoordinates.length >= 2) {
        updateWalkingRoute(
            map,
            remainingCoordinates
        );
    }
}


/**
 * Simule le déplacement de l'utilisateur le long de l'itinéraire.
 */
export function startNavigationSimulation(map, onFinish) {

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

        const [longitude, latitude] =
            currentRouteCoordinates[index];

        const position = { longitude, latitude };
        
        showUserMarker(map, position);
        updateNavigationProgress(position, map);

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
export function startOffRouteSimulation(map) {

    if (currentRouteCoordinates.length < 2) {
        console.warn('Aucun itinéraire à tester.');
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
        currentRouteCoordinates.length - 1
    );

    const [longitude, latitude] =
        currentRouteCoordinates[index];

    // Décalage artificiel d'environ 50 mètres vers l'est.
    const longitudeOffset =
        50 / (
            111320 *
            Math.cos(latitude * Math.PI / 180)
        );

    const simulatedPosition = {
        longitude: longitude + longitudeOffset,
        latitude
    };

    let count = 0;

    const intervalId = setInterval(() => {

        count++;

        console.log(
            `🧪 Position artificielle hors itinéraire : ${count}/3`
        );

        showUserMarker(map, simulatedPosition);

        updateNavigationProgress(
            simulatedPosition,
            map
        );

        if (count >= 3) {
            clearInterval(intervalId);

            console.log(
                '✅ Test terminé : consulte les messages de détection ci-dessus.'
            );
        }

    }, 1000);
}