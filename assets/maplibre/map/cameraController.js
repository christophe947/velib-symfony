export function createCameraController(
    map,
    {
        onViewModeChange = () => {},
        onCompassActivationRequested = async () => {},
        shouldUseGpsHeading = () => true,
    } = {},
) {
    let is3D = false;
    let isFollowingUser = false;
    let isCompassCameraPaused = false;
    let isCameraInteractionActive = false;
    let cameraResumeTimeout = null;
    let lastStableHeading = null;
    let isChangingView = false;
    let pendingUserPosition = null;

    const MIN_HEADING_SPEED = 0.8;
    const HEADING_SMOOTHING_FACTOR = 0.6;

    function smoothHeading(currentHeading, targetHeading) {
        // Normalise les angles entre 0 et 360 degrés.
        const normalize = (angle) => ((angle % 360) + 360) % 360;

        const current = normalize(currentHeading);
        const target = normalize(targetHeading);

        // Calcule le plus court chemin entre les deux angles.
        const difference = ((target - current + 540) % 360) - 180;

        // Applique un lissage progressif.
        return normalize(current + difference * HEADING_SMOOTHING_FACTOR);
    }

    async function toggleView() {
        // Empêche les transitions successives de se chevaucher.
        if (isChangingView) {
            return;
        }

        isChangingView = true;

        // Empêche la boussole de perturber la transition 2D / 3D.
        isCompassCameraPaused = true;

        // Termine les éventuelles animations précédentes.
        map.stop();

        is3D = !is3D;

        const targetPitch = is3D ? 55 : 0;

        onViewModeChange(is3D);

        try {
            await new Promise((resolve) => {
                // On écoute la fin du mouvement avant de lancer l'animation.
                map.once('moveend', resolve);

                map.easeTo({
                    pitch: targetPitch,
                    bearing: is3D ? map.getBearing() : 0,
                    duration: 700,
                    essential: true,
                });
            });
        } finally {
            // La transition est terminée : on autorise de nouveau
            // les mises à jour de la caméra par la boussole.
            isChangingView = false;
            isCompassCameraPaused = false;

            // On récupère la dernière position reçue pendant la transition.
            if (pendingUserPosition) {
                const position = pendingUserPosition;
                pendingUserPosition = null;

                // On reprend le suivi GPS après la transition.
                followPosition(position);
            }

            // En 3D hors navigation, active la boussole
            // uniquement si le suivi GPS est actif.
            if (is3D && isFollowingUser) {
                await onCompassActivationRequested();
            }
        }
    }

    async function ensure2DView() {
        if (!is3D) {
            return;
        }

        await toggleView();
    }

    function setFollowing(enabled) {
        isFollowingUser = enabled;
    }

    function isFollowing() {
        return isFollowingUser;
    }

    function canUseCompass() {
        return is3D && isFollowingUser;
    }

    function updateFromCompass(reading) {
        if (!reading) {
            return;
        }

        // La boussole pilote la caméra uniquement en navigation 3D,
        // lorsque le suivi est actif et qu'aucune transition n'est en cours.
        if (
            !is3D ||
            !isFollowingUser ||
            isChangingView ||
            isCameraInteractionActive ||
            isCompassCameraPaused
        ) {
            return;
        }

        // Vérifie que la mesure est récente.
        const isReadingFresh =
            Number.isFinite(reading.timestamp) &&
            Date.now() - reading.timestamp < 1500;

        if (!isReadingFresh) {
            return;
        }

        const compassHeading = reading.compassHeading;

        if (!Number.isFinite(compassHeading)) {
            return;
        }

        // Conserve le lissage du cap.
        const currentBearing = lastStableHeading ?? map.getBearing();

        lastStableHeading = smoothHeading(currentBearing, compassHeading);

        // Anime progressivement l'orientation de la caméra.
        map.easeTo({
            bearing: lastStableHeading,
            duration: 100,
            essential: true,
        });
    }

    function recenter(position) {
        if (!position) {
            return;
        }

        // Suspend temporairement le contrôle automatique de la caméra.
        isCompassCameraPaused = true;

        // Réactive le suivi.
        setFollowing(true);

        // Termine les animations précédentes.
        map.stop();

        // Attend la fin du recentrage avant de réactiver la boussole.
        map.once('moveend', () => {
            isCompassCameraPaused = false;
        });

        // Une seule animation pour le recentrage et le zoom.
        map.easeTo({
            center: [position.longitude, position.latitude],
            zoom: 17,
            pitch: is3D ? 55 : 0,
            duration: 500,
            essential: true,
        });
    }

    function followPosition(position) {
        if (!position) return;

        if (!isFollowingUser) return;

        if (isChangingView) {
            pendingUserPosition = position;
            return;
        }

        if (isCompassCameraPaused) {
            return;
        }

        // Vérifie si le cap GPS est suffisamment fiable.
        const isGpsHeadingReliable =
            Number.isFinite(position.heading) &&
            Number.isFinite(position.speed) &&
            position.speed >= MIN_HEADING_SPEED;

        // Distance entre le centre de la carte et la position GPS.
        const distanceToUser = map
            .getCenter()
            .distanceTo([position.longitude, position.latitude]);

        /*
         * En 3D, lorsque le cap GPS n'est pas fiable
         * (notamment à l'arrêt), on ignore les petits déplacements GPS.
         *
         * Cela évite de relancer constamment l'animation de la caméra
         * à cause des imprécisions du GPS.
         */
        if (is3D && !isGpsHeadingReliable && distanceToUser < 3) {
            return;
        }

        const cameraOptions = {
            center: [position.longitude, position.latitude],
            duration: 450,
            essential: true,
        };

        // En 2D, on conserve le comportement actuel.
        // En 3D, le cap GPS ne pilote plus l'orientation de la caméra.
        // La boussole s'en charge.
        if (
            is3D &&
            isGpsHeadingReliable &&
            shouldUseGpsHeading()
        ) {
            const currentBearing = lastStableHeading ?? map.getBearing();

            lastStableHeading = smoothHeading(currentBearing, position.heading);

            cameraOptions.bearing = lastStableHeading;
        }

        map.easeTo(cameraOptions);
    }

    function initManualCameraControl() {
        function suspendCameraControl() {
            clearTimeout(cameraResumeTimeout);

            console.log('Suspension caméra déclenchée', {
                following: isFollowingUser,
                time: new Date().toLocaleTimeString(),
            });

            isCameraInteractionActive = true;
            isFollowingUser = false;
        }

        function scheduleCameraResume() {
            clearTimeout(cameraResumeTimeout);

            cameraResumeTimeout = setTimeout(() => {
                isCameraInteractionActive = false;
            }, 500);
        }

        // Début des interactions tactiles
        map.on('touchstart', suspendCameraControl);

        // Fin des interactions tactiles
        map.on('touchend', scheduleCameraResume);
        map.on('touchcancel', scheduleCameraResume);

        // Déplacement manuel
        map.on('dragstart', suspendCameraControl);
        map.on('dragend', scheduleCameraResume);

        // Zoom manuel à la molette. zoomstart se déclenche aussi pour les animations programmatiques.
        map.on('wheel', () => {
            suspendCameraControl();
            scheduleCameraResume();
        });
    }

    function clearPendingPosition() {
        pendingUserPosition = null;
    }

    return {
        toggleView,
        ensure2DView,
        setFollowing,
        isFollowing,
        canUseCompass,
        updateFromCompass,
        recenter,
        followPosition,
        initManualCameraControl,
        clearPendingPosition,
    };
}
