export function createCameraController(
    map,
    {
        onViewModeChange = () => {},
        onCompassActivationRequested = async () => {},
        onCompassControlSuspended = () => {},
        onNavigationPositionFrame = () => {},
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
    let navigationVisualPosition = null;
    let navigationVisualStartPosition = null;
    let navigationVisualTargetPosition = null;
    let navigationVisualStartTime = null;
    let navigationVisualDuration = 0;
    let lastNavigationVisualGpsTimestamp = null;

    const MIN_HEADING_SPEED = 0.8;
    const HEADING_SMOOTHING_FACTOR = 0.6;
    const NAVIGATION_BEARING_SMOOTHING_MS = 90;
    const NAVIGATION_CENTER_TOLERANCE_METERS = 0.5;
    const NAVIGATION_BEARING_TOLERANCE_DEGREES = 0.5;
    const MAX_NAVIGATION_FRAME_DELTA_MS = 64;
    const MIN_NAVIGATION_POSITION_DURATION_MS = 80;
    const MAX_NAVIGATION_POSITION_DURATION_MS = 350;
    const MAX_NAVIGATION_POSITION_AGE_MS = 10_000;
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
        requestNavigationCameraFrame();

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

        requestNavigationCameraFrame();
    }

    function isFollowing() {
        return isFollowingUser;
    }

    function canUseCompass() {
        return is3D && isFollowingUser;
    }

    function canFollowNavigationPosition() {
        return (
            !shouldUseGpsHeading() &&
            isFollowingUser &&
            !isChangingView &&
            !isCameraInteractionActive &&
            !isMouseCameraGestureActive &&
            !isCompassCameraPaused
        );
    }

    function canCoordinateNavigationCamera() {
        return is3D && canFollowNavigationPosition();
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
        const position = navigationVisualPosition ?? lastGpsPosition;
        const targetCenter = position
            ? [position.longitude, position.latitude]
            : map.getCenter();
        const targetBearing =
            is3D && navigationCompassHeading !== null
                ? navigationCompassHeading
                : map.getBearing();

        return { targetCenter, targetBearing };
    }

    function isNavigationVisualPositionAnimating() {
        return navigationVisualStartTime !== null;
    }

    function hasNavigationCameraWork() {
        if (!canFollowNavigationPosition()) {
            return false;
        }

        const { targetCenter, targetBearing } = getNavigationCameraTargets();
        const centerDistance = map.getCenter().distanceTo(targetCenter);
        const bearingDifference =
            ((targetBearing - map.getBearing() + 540) % 360) - 180;

        return (
            centerDistance > NAVIGATION_CENTER_TOLERANCE_METERS ||
            Math.abs(bearingDifference) > NAVIGATION_BEARING_TOLERANCE_DEGREES
        );
    }

    function updateNavigationVisualPosition(gpsPosition, displayedPosition) {
        if (!gpsPosition || !displayedPosition || shouldUseGpsHeading()) {
            return false;
        }

        const timestamp = gpsPosition.timestamp;
        const age = Date.now() - timestamp;
        const hasValidGpsPosition =
            Number.isFinite(timestamp) &&
            timestamp > 0 &&
            age >= 0 &&
            age <= MAX_NAVIGATION_POSITION_AGE_MS &&
            Number.isFinite(gpsPosition.longitude) &&
            gpsPosition.longitude >= -180 &&
            gpsPosition.longitude <= 180 &&
            Number.isFinite(gpsPosition.latitude) &&
            gpsPosition.latitude >= -90 &&
            gpsPosition.latitude <= 90 &&
            Number.isFinite(displayedPosition.longitude) &&
            displayedPosition.longitude >= -180 &&
            displayedPosition.longitude <= 180 &&
            Number.isFinite(displayedPosition.latitude) &&
            displayedPosition.latitude >= -90 &&
            displayedPosition.latitude <= 90;

        if (
            !hasValidGpsPosition ||
            (lastNavigationVisualGpsTimestamp !== null &&
                timestamp <= lastNavigationVisualGpsTimestamp)
        ) {
            return false;
        }

        const previousTimestamp = lastNavigationVisualGpsTimestamp;
        lastNavigationVisualGpsTimestamp = timestamp;
        lastGpsPosition = gpsPosition;

        const nextTarget = { ...displayedPosition };

        if (!navigationVisualPosition) {
            navigationVisualPosition = nextTarget;
            navigationVisualStartPosition = null;
            navigationVisualTargetPosition = null;
            navigationVisualStartTime = null;
            onNavigationPositionFrame(navigationVisualPosition);
            requestNavigationCameraFrame();
            return true;
        }

        navigationVisualStartPosition = navigationVisualPosition;
        navigationVisualTargetPosition = nextTarget;
        navigationVisualStartTime = performance.now();
        navigationVisualDuration = Math.max(
            MIN_NAVIGATION_POSITION_DURATION_MS,
            Math.min(
                MAX_NAVIGATION_POSITION_DURATION_MS,
                (previousTimestamp === null
                    ? MIN_NAVIGATION_POSITION_DURATION_MS * 2
                    : timestamp - previousTimestamp) *
                    0.4,
            ),
        );

        if (
            navigationVisualStartPosition.longitude === nextTarget.longitude &&
            navigationVisualStartPosition.latitude === nextTarget.latitude
        ) {
            navigationVisualPosition = nextTarget;
            navigationVisualStartPosition = null;
            navigationVisualTargetPosition = null;
            navigationVisualStartTime = null;
            onNavigationPositionFrame(navigationVisualPosition);
        }

        requestNavigationCameraFrame();
        return true;
    }

    function updateVisualPositionForFrame(timestamp) {
        if (!isNavigationVisualPositionAnimating()) {
            return navigationVisualPosition;
        }

        const progress = Math.min(
            1,
            Math.max(
                0,
                (timestamp - navigationVisualStartTime) /
                    navigationVisualDuration,
            ),
        );

        navigationVisualPosition = {
            ...navigationVisualTargetPosition,
            longitude:
                navigationVisualStartPosition.longitude +
                (navigationVisualTargetPosition.longitude -
                    navigationVisualStartPosition.longitude) *
                    progress,
            latitude:
                navigationVisualStartPosition.latitude +
                (navigationVisualTargetPosition.latitude -
                    navigationVisualStartPosition.latitude) *
                    progress,
        };

        onNavigationPositionFrame(navigationVisualPosition);

        if (progress >= 1) {
            navigationVisualStartPosition = null;
            navigationVisualTargetPosition = null;
            navigationVisualStartTime = null;
        }

        return navigationVisualPosition;
    }

    function requestNavigationCameraFrame() {
        if (
            !isNavigationVisualPositionAnimating() &&
            !hasNavigationCameraWork()
        ) {
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

            const visualPosition = updateVisualPositionForFrame(timestamp);

            const elapsed =
                lastNavigationCameraFrameTime === null
                    ? 1000 / 60
                    : timestamp - lastNavigationCameraFrameTime;
            const frameDelta = Math.min(
                Math.max(elapsed, 0),
                MAX_NAVIGATION_FRAME_DELTA_MS,
            );

            lastNavigationCameraFrameTime = timestamp;

            const bearingAlpha =
                1 - Math.exp(-frameDelta / NAVIGATION_BEARING_SMOOTHING_MS);
            if (canFollowNavigationPosition()) {
                const { targetCenter, targetBearing } =
                    getNavigationCameraTargets();
                const currentCenter = map.getCenter();
                const currentBearing = map.getBearing();
                const centerDistance = currentCenter.distanceTo(targetCenter);
                const bearingDifference =
                    ((targetBearing - currentBearing + 540) % 360) - 180;

                if (
                    centerDistance > NAVIGATION_CENTER_TOLERANCE_METERS ||
                    Math.abs(bearingDifference) >
                        NAVIGATION_BEARING_TOLERANCE_DEGREES
                ) {
                    const nextBearing =
                        Math.abs(bearingDifference) <=
                        NAVIGATION_BEARING_TOLERANCE_DEGREES
                            ? currentBearing
                            : ((currentBearing +
                                  bearingDifference * bearingAlpha) %
                                  360 +
                                  360) %
                              360;

                    map.jumpTo(
                        {
                            center: visualPosition
                                ? [
                                      visualPosition.longitude,
                                      visualPosition.latitude,
                                  ]
                                : targetCenter,
                            bearing: nextBearing,
                        },
                        { navigationCamera: true },
                    );
                }
            }

            if (
                frameGeneration === navigationCameraFrameGeneration &&
                (isNavigationVisualPositionAnimating() ||
                    hasNavigationCameraWork())
            ) {
                requestNavigationCameraFrame();
            } else {
                lastNavigationCameraFrameTime = null;
            }
        });
    }

    function beginNavigationPositionTracking(initialPosition = null) {
        cancelNavigationCameraFrames();
        navigationVisualStartPosition = null;
        navigationVisualTargetPosition = null;
        navigationVisualStartTime = null;
        navigationVisualDuration = 0;
        navigationVisualPosition = null;
        lastNavigationVisualGpsTimestamp = null;
        navigationCompassHeading = null;

        lastGpsPosition = null;

        const age = Date.now() - initialPosition?.timestamp;

        if (
            Number.isFinite(initialPosition?.timestamp) &&
            initialPosition.timestamp > 0 &&
            age >= 0 &&
            age <= MAX_NAVIGATION_POSITION_AGE_MS &&
            Number.isFinite(initialPosition.longitude) &&
            initialPosition.longitude >= -180 &&
            initialPosition.longitude <= 180 &&
            Number.isFinite(initialPosition.latitude) &&
            initialPosition.latitude >= -90 &&
            initialPosition.latitude <= 90
        ) {
            navigationVisualPosition = { ...initialPosition };
            lastGpsPosition = initialPosition;
            lastNavigationVisualGpsTimestamp = initialPosition.timestamp;
        }
    }

    function clearNavigationVisualPosition() {
        navigationVisualStartPosition = null;
        navigationVisualTargetPosition = null;
        navigationVisualStartTime = null;
        navigationVisualDuration = 0;
        navigationVisualPosition = null;
        lastNavigationVisualGpsTimestamp = null;
        cancelNavigationCameraFrames();
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
        if (!shouldUseGpsHeading()) {
            const age = Date.now() - position.timestamp;
            const isFreshNavigationPosition =
                Number.isFinite(position.timestamp) &&
                position.timestamp > 0 &&
                age >= 0 &&
                age <= MAX_NAVIGATION_POSITION_AGE_MS &&
                (lastNavigationVisualGpsTimestamp === null ||
                    position.timestamp >= lastNavigationVisualGpsTimestamp);

            if (isFreshNavigationPosition) {
                navigationVisualPosition = { ...position };
                navigationVisualStartPosition = null;
                navigationVisualTargetPosition = null;
                navigationVisualStartTime = null;
                navigationVisualDuration = 0;
                lastNavigationVisualGpsTimestamp = position.timestamp;
                onNavigationPositionFrame(navigationVisualPosition);
            }
        }
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
            requestNavigationCameraFrame();
        }

        function scheduleCameraResume() {
            clearTimeout(cameraResumeTimeout);

            cameraResumeTimeout = setTimeout(() => {
                isCameraInteractionActive = false;
                requestNavigationCameraFrame();
            }, 500);
        }

        function pauseNavigationCameraForMouseDown() {
            isMouseCameraGestureActive = true;
            cancelNavigationCameraFrames();
            onCompassControlSuspended();
            requestNavigationCameraFrame();
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
        navigationVisualPosition = null;
        navigationVisualStartPosition = null;
        navigationVisualTargetPosition = null;
        navigationVisualStartTime = null;
        navigationVisualDuration = 0;
        lastNavigationVisualGpsTimestamp = null;
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
        beginNavigationPositionTracking,
        updateNavigationVisualPosition,
        clearNavigationVisualPosition,
        recenter,
        followPosition,
        initManualCameraControl,
        clearPendingPosition,
    };
}
