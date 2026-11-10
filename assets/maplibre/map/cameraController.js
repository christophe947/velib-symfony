export function createCameraController(
    map,
    {
        onViewModeChange = () => {},
        onCompassActivationRequested = async () => {},
        onCompassControlSuspended = () => {},
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
    let lastGpsPosition = null;
    let navigationCompassHeading = null;
    let navigationCameraFrameId = null;
    let navigationCameraFrameGeneration = 0;
    let lastNavigationCameraFrameTime = null;
    let isMouseCameraGestureActive = false;

    const MIN_HEADING_SPEED = 0.8;
    const HEADING_SMOOTHING_FACTOR = 0.6;
    const NAVIGATION_CENTER_SMOOTHING_MS = 180;
    const NAVIGATION_BEARING_SMOOTHING_MS = 90;
    const NAVIGATION_CENTER_TOLERANCE_METERS = 0.5;
    const NAVIGATION_BEARING_TOLERANCE_DEGREES = 0.5;
    const MAX_NAVIGATION_FRAME_DELTA_MS = 64;
    const THREE_D_PITCH_THRESHOLD = 30;

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
        cancelNavigationCameraFrames();
        onCompassControlSuspended();

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

            requestNavigationCameraFrame();
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

        if (!enabled) {
            onCompassControlSuspended();
        }
    }

    function isFollowing() {
        return isFollowingUser;
    }

    function canUseCompass() {
        return is3D && isFollowingUser;
    }

    function canCoordinateNavigationCamera() {
        return (
            is3D &&
            !shouldUseGpsHeading() &&
            isFollowingUser &&
            !isChangingView &&
            !isCameraInteractionActive &&
            !isMouseCameraGestureActive &&
            !isCompassCameraPaused
        );
    }

    function cancelNavigationCameraFrames() {
        navigationCameraFrameGeneration++;

        if (navigationCameraFrameId !== null) {
            cancelAnimationFrame(navigationCameraFrameId);
            navigationCameraFrameId = null;
        }

        lastNavigationCameraFrameTime = null;
    }

    function getNavigationCameraTargets() {
        const targetCenter = lastGpsPosition
            ? [lastGpsPosition.longitude, lastGpsPosition.latitude]
            : map.getCenter();
        const targetBearing = navigationCompassHeading ?? map.getBearing();

        return { targetCenter, targetBearing };
    }

    function requestNavigationCameraFrame() {
        if (!canCoordinateNavigationCamera()) {
            return;
        }

        if (navigationCameraFrameId !== null) {
            return;
        }

        const frameGeneration = navigationCameraFrameGeneration;

        navigationCameraFrameId = requestAnimationFrame((timestamp) => {
            if (frameGeneration !== navigationCameraFrameGeneration) {
                return;
            }

            navigationCameraFrameId = null;

            if (!canCoordinateNavigationCamera()) {
                lastNavigationCameraFrameTime = null;
                return;
            }

            const { targetCenter, targetBearing } = getNavigationCameraTargets();
            const currentCenter = map.getCenter();
            const currentBearing = map.getBearing();
            const centerDistance = currentCenter.distanceTo(targetCenter);
            const bearingDifference =
                ((targetBearing - currentBearing + 540) % 360) - 180;

            if (
                centerDistance <= NAVIGATION_CENTER_TOLERANCE_METERS &&
                Math.abs(bearingDifference) <= NAVIGATION_BEARING_TOLERANCE_DEGREES
            ) {
                lastNavigationCameraFrameTime = null;
                return;
            }

            const elapsed =
                lastNavigationCameraFrameTime === null
                    ? 1000 / 60
                    : timestamp - lastNavigationCameraFrameTime;
            const frameDelta = Math.min(
                Math.max(elapsed, 0),
                MAX_NAVIGATION_FRAME_DELTA_MS,
            );

            lastNavigationCameraFrameTime = timestamp;

            const centerAlpha =
                1 - Math.exp(-frameDelta / NAVIGATION_CENTER_SMOOTHING_MS);
            const bearingAlpha =
                1 - Math.exp(-frameDelta / NAVIGATION_BEARING_SMOOTHING_MS);
            const nextCenter =
                centerDistance <= NAVIGATION_CENTER_TOLERANCE_METERS
                    ? [currentCenter.lng, currentCenter.lat]
                    : [
                          currentCenter.lng +
                              (targetCenter[0] - currentCenter.lng) * centerAlpha,
                          currentCenter.lat +
                              (targetCenter[1] - currentCenter.lat) * centerAlpha,
                      ];
            const nextBearing =
                Math.abs(bearingDifference) <=
                NAVIGATION_BEARING_TOLERANCE_DEGREES
                    ? currentBearing
                    : ((currentBearing + bearingDifference * bearingAlpha) % 360 +
                          360) %
                      360;

            map.jumpTo(
                {
                    center: nextCenter,
                    bearing: nextBearing,
                },
                { navigationCamera: true },
            );

            if (frameGeneration === navigationCameraFrameGeneration) {
                const latestTargets = getNavigationCameraTargets();
                const centerStillMoving =
                    map.getCenter().distanceTo(latestTargets.targetCenter) >
                    NAVIGATION_CENTER_TOLERANCE_METERS;
                const bearingStillMoving =
                    Math.abs(
                        ((latestTargets.targetBearing - map.getBearing() + 540) %
                            360) -
                            180,
                    ) > NAVIGATION_BEARING_TOLERANCE_DEGREES;

                if (centerStillMoving || bearingStillMoving) {
                    requestNavigationCameraFrame();
                } else {
                    lastNavigationCameraFrameTime = null;
                }
            }
        });
    }

    function updateFromCompass(reading) {
        if (!reading) {
            return false;
        }

        // La boussole pilote la caméra uniquement en navigation 3D,
        // lorsque le suivi est actif et qu'aucune transition n'est en cours.
        if (
            !is3D ||
            !isFollowingUser ||
            isChangingView ||
            isCameraInteractionActive ||
            isCompassCameraPaused ||
            isMouseCameraGestureActive
        ) {
            return false;
        }

        // Vérifie que la mesure est récente.
        const readingAge = Date.now() - reading.timestamp;
        const isReadingFresh =
            Number.isFinite(reading.timestamp) &&
            readingAge >= 0 &&
            readingAge < 1500;

        if (!isReadingFresh) {
            return false;
        }

        const compassHeading = reading.compassHeading;

        if (!Number.isFinite(compassHeading)) {
            return false;
        }

        // Conserve le lissage du cap.
        const currentBearing = lastStableHeading ?? map.getBearing();

        lastStableHeading = smoothHeading(currentBearing, compassHeading);

        if (!shouldUseGpsHeading()) {
            navigationCompassHeading = lastStableHeading;
            requestNavigationCameraFrame();
            return true;
        }

        // Anime progressivement l'orientation de la caméra.
        map.easeTo({
            bearing: lastStableHeading,
            duration: 100,
            essential: true,
        });

        return true;
    }

    function recenter(position) {
        if (!position) {
            return;
        }

        lastGpsPosition = position;
        onCompassControlSuspended();
        clearTimeout(cameraResumeTimeout);
        cameraResumeTimeout = null;
        isCameraInteractionActive = false;

        // Suspend temporairement le contrôle automatique de la caméra.
        isCompassCameraPaused = true;

        // Réactive le suivi.
        setFollowing(true);

        cancelNavigationCameraFrames();

        // Termine les animations précédentes.
        map.stop();

        // Attend la fin du recentrage avant de réactiver la boussole.
        map.once('moveend', () => {
            isCompassCameraPaused = false;
            requestNavigationCameraFrame();
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

        lastGpsPosition = position;

        if (is3D && !shouldUseGpsHeading()) {
            requestNavigationCameraFrame();
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
            cancelNavigationCameraFrames();
            onCompassControlSuspended();

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

        function pauseNavigationCameraForMouseDown() {
            isMouseCameraGestureActive = true;
            cancelNavigationCameraFrames();
            onCompassControlSuspended();
        }

        function resumeNavigationCameraAfterMouseUp() {
            if (!isMouseCameraGestureActive) {
                return;
            }

            isMouseCameraGestureActive = false;
            scheduleCameraResume();
            requestNavigationCameraFrame();
        }

        const canvasContainer = map.getCanvasContainer();
        const ownerDocument = canvasContainer.ownerDocument;

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

        // Suspend le suivi si une autre action démarre un mouvement caméra.
        // Les mouvements du coordinateur portent un marqueur dans eventData.
        map.on('movestart', (event) => {
            if (
                !event.navigationCamera &&
                (canCoordinateNavigationCamera() ||
                    (isMouseCameraGestureActive &&
                        is3D &&
                        !shouldUseGpsHeading() &&
                        isFollowingUser &&
                        !isChangingView &&
                        !isCameraInteractionActive &&
                        !isCompassCameraPaused))
            ) {
                suspendCameraControl();
            }
        });

        // jumpTo() réinitialise les gestionnaires d'entrée MapLibre. Suspend
        // le rendu avant que ceux-ci commencent à traiter un geste souris.
        canvasContainer.addEventListener(
            'mousedown',
            pauseNavigationCameraForMouseDown,
            true,
        );
        ownerDocument.addEventListener(
            'mouseup',
            resumeNavigationCameraAfterMouseUp,
            true,
        );
    }

    function clearPendingPosition() {
        pendingUserPosition = null;
        lastGpsPosition = null;
        navigationCompassHeading = null;
        cancelNavigationCameraFrames();
    }

    map.on('pitch', () => {
        if (isChangingView) {
            return;
        }

        const pitchIndicates3D = map.getPitch() >= THREE_D_PITCH_THRESHOLD;

        if (pitchIndicates3D !== is3D) {
            is3D = pitchIndicates3D;
            onViewModeChange(is3D);
        }
    });

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
