let isCompassActive = false;

let lastReading = null;

let orientationHandler = null;

let onReadingCallback = null;

let onErrorCallback = null;

function normalizeHeading(heading) {
    return ((heading % 360) + 360) % 360;
}

/** Lit le cap natif de Safari ou le calcule depuis l'orientation absolue. */
function getCompassHeading(event) {
    if (Number.isFinite(event.webkitCompassHeading)) {
        return normalizeHeading(event.webkitCompassHeading);
    }

    if (
        event.absolute !== true ||
        !Number.isFinite(event.alpha) ||
        !Number.isFinite(event.beta) ||
        !Number.isFinite(event.gamma)
    ) {
        return null;
    }

    const toRadians = Math.PI / 180;
    const alpha = event.alpha * toRadians;
    const beta = event.beta * toRadians;
    const gamma = event.gamma * toRadians;

    const cosAlpha = Math.cos(alpha);
    const sinAlpha = Math.sin(alpha);
    const sinBeta = Math.sin(beta);
    const cosGamma = Math.cos(gamma);
    const sinGamma = Math.sin(gamma);

    const horizontalX =
        -cosAlpha * sinGamma - sinAlpha * sinBeta * cosGamma;
    const horizontalY =
        -sinAlpha * sinGamma + cosAlpha * sinBeta * cosGamma;

    if (Math.hypot(horizontalX, horizontalY) < 0.001) {
        return null;
    }

    const heading = Math.atan2(horizontalX, horizontalY) / toRadians;
    return normalizeHeading(heading);
}

/**
 * Démarre l'écoute du capteur d'orientation.
 */
export async function startCompass(onReading, onError) {

    // Actualise les callbacks à chaque appel.
    onReadingCallback = onReading;
    onErrorCallback = onError;

    if (isCompassActive) {
        return;
    }

    if (!('DeviceOrientationEvent' in window)) {
        onErrorCallback?.(
            new Error(
                'Le capteur d’orientation n’est pas disponible.'
            )
        );

        return;
    }

    try {

        // Demande la permission si le navigateur l'exige.
        if (
            typeof DeviceOrientationEvent.requestPermission ===
            'function'
        ) {

            const permission =
                await DeviceOrientationEvent.requestPermission();

            if (permission !== 'granted') {
                throw new Error(
                    'L’autorisation du capteur a été refusée.'
                );
            }
        }

        // Fonction appelée à chaque nouvelle mesure.
        orientationHandler = event => {

            const reading = {
                alpha: event.alpha,
                beta: event.beta,
                gamma: event.gamma,
                absolute: event.absolute,

                // Safari fournit un cap natif; les autres navigateurs
                // peuvent fournir l'orientation absolue via alpha/beta/gamma.
                compassHeading: getCompassHeading(event),

                screenOrientation:
                    screen.orientation?.angle ??
                    window.orientation ??
                    0,

                timestamp: Date.now()
            };

            lastReading = reading;

            //?.(reading);
            onReadingCallback?.(reading);
        };

        // Écoute les mesures d'orientation.
        window.addEventListener(
            'deviceorientation',
            orientationHandler
        );

        // Certains navigateurs proposent aussi
        // un événement dédié à l'orientation absolue.
        window.addEventListener(
            'deviceorientationabsolute',
            orientationHandler
        );

        isCompassActive = true;

        console.log('🧭 Écoute du capteur démarrée.');

    } catch (error) {

        console.error(
            'Impossible de démarrer le capteur :',
            error
        );

        //onError?.(error);
        onErrorCallback?.(error);
    }
}


/**
 * Arrête l'écoute du capteur d'orientation.
 */
export function stopCompass() {

    if (!isCompassActive || !orientationHandler) {
        return;
    }

    window.removeEventListener(
        'deviceorientation',
        orientationHandler
    );

    window.removeEventListener(
        'deviceorientationabsolute',
        orientationHandler
    );

    orientationHandler = null;

    isCompassActive = false;

    console.log('🧭 Écoute du capteur arrêtée.');
}


/**
 * Retourne la dernière mesure reçue.
 */
export function getLastCompassReading() {
    return lastReading;
}