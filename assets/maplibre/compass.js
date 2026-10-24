let isCompassActive = false;

let lastReading = null;

let orientationHandler = null;

/**
 * Démarre l'écoute du capteur d'orientation.
 */
export async function startCompass(onReading, onError) {

    if (isCompassActive) {
        return;
    }

    if (!('DeviceOrientationEvent' in window)) {
        onError?.(
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

                // Cap magnétique fourni notamment par iOS Safari.
                compassHeading:
                    Number.isFinite(event.webkitCompassHeading)
                        ? event.webkitCompassHeading
                        : null,

                screenOrientation:
                    screen.orientation?.angle ??
                    window.orientation ??
                    0,

                timestamp: Date.now()
            };

            lastReading = reading;

            onReading?.(reading);
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

        onError?.(error);
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