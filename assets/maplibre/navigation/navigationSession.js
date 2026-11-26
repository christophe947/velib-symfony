/**
 * Owns the raw GPS positions and watch used by the active navigation session.
 * Route progression itself remains owned by the navigation engine.
 */
export class NavigationSession {
    #navigationEngine;
    #gps;
    #mapEffects;
    #compass;
    #wakeLock;
    #positionWatchId = null;
    #isWatchingPosition = false;
    #lastKnownPosition = null;
    #lastReliablePosition = null;
    #sessionGeneration = 0;
    #isActive = false;
    #compassExpected = false;

    constructor({ navigationEngine, gps, mapEffects, compass, wakeLock }) {
        if (
            !navigationEngine ||
            typeof gps?.requestPosition !== 'function' ||
            typeof gps?.startWatchingPosition !== 'function' ||
            typeof gps?.clearWatch !== 'function' ||
            !mapEffects ||
            typeof mapEffects.drawNavigationRoute !== 'function' ||
            typeof mapEffects.clearPlannerRoutePreview !== 'function' ||
            typeof mapEffects.clearNavigation !== 'function' ||
            typeof mapEffects.showUserPosition !== 'function' ||
            typeof mapEffects.setUserFollowing !== 'function' ||
            typeof mapEffects.startBackgroundTracking !== 'function' ||
            typeof mapEffects.stopBackgroundTracking !== 'function' ||
            typeof mapEffects.setNavigationActive !== 'function' ||
            !compass ||
            typeof compass.activate !== 'function' ||
            typeof compass.stop !== 'function' ||
            typeof compass.reactivateIfEligible !== 'function' ||
            typeof wakeLock?.start !== 'function' ||
            typeof wakeLock?.stop !== 'function' ||
            typeof navigationEngine.setNavigationRoute !== 'function' ||
            typeof navigationEngine.updateNavigationProgress !== 'function' ||
            typeof navigationEngine.stopNavigationProcessing !== 'function' ||
            typeof navigationEngine.getNavigationMode !== 'function'
        ) {
            throw new TypeError('NavigationSession dependencies are required.');
        }

        this.#navigationEngine = navigationEngine;
        this.#gps = gps;
        this.#mapEffects = mapEffects;
        this.#compass = compass;
        this.#wakeLock = wakeLock;
    }

    isActive() {
        return this.#isActive;
    }

    isFreshPosition(position) {
        if (
            !position ||
            !Number.isFinite(position.longitude) ||
            position.longitude < -180 ||
            position.longitude > 180 ||
            !Number.isFinite(position.latitude) ||
            position.latitude < -90 ||
            position.latitude > 90 ||
            !Number.isFinite(position.timestamp) ||
            position.timestamp <= 0
        ) {
            return false;
        }

        const age = Date.now() - position.timestamp;

        return age >= 0 && age <= 10_000;
    }

    isReliablePosition(position) {
        return (
            this.isFreshPosition(position) &&
            Number.isFinite(position.accuracy) &&
            position.accuracy >= 0 &&
            position.accuracy <= 25
        );
    }

    rememberPosition(position) {
        if (!this.isFreshPosition(position)) {
            return false;
        }

        if (
            !Number.isFinite(this.#lastKnownPosition?.timestamp) ||
            position.timestamp > this.#lastKnownPosition.timestamp
        ) {
            this.#lastKnownPosition = position;
        }

        if (
            this.isReliablePosition(position) &&
            (!Number.isFinite(this.#lastReliablePosition?.timestamp) ||
                position.timestamp > this.#lastReliablePosition.timestamp)
        ) {
            this.#lastReliablePosition = position;
        }

        return true;
    }

    getLastKnownPosition() {
        return this.#lastKnownPosition;
    }

    getLastReliablePosition() {
        return this.#lastReliablePosition;
    }

    isWatching() {
        return this.#isWatchingPosition;
    }

    async start({
        mode,
        route = null,
        compassActivation,
        isCurrent = () => true,
        onActivating,
        onPreparing,
        prepareCamera,
        onCameraReady,
        onPosition,
    } = {}) {
        if (this.#isActive) {
            return false;
        }

        const generation = ++this.#sessionGeneration;
        try {
            this.#mapEffects.stopBackgroundTracking();
            const navigationMode =
                mode ?? route?.segments?.[0]?.mode ??
                this.#navigationEngine.getNavigationMode() ??
                'pedestrian';
            onActivating?.(navigationMode);
            this.#isActive = true;
            const isSessionCurrent = () =>
                this.#isActive &&
                generation === this.#sessionGeneration &&
                isCurrent();

            const initialPosition = this.#lastKnownPosition;
            this.#mapEffects.setNavigationActive(
                this.isFreshPosition(initialPosition)
                    ? initialPosition
                    : null,
                navigationMode,
            );
            this.#mapEffects.setUserFollowing(true);
            this.#wakeLock.start();
            this.#compassExpected = navigationMode !== 'bicycle';

            if (navigationMode === 'bicycle') {
                this.#compass.stop();
            }

            let isInitialCameraSetup = true;
            const compassPromise =
                navigationMode === 'bicycle'
                    ? (compassActivation ?? Promise.resolve())
                    : (compassActivation ??
                      this.#compass.activate(
                          () =>
                              !isInitialCameraSetup && isSessionCurrent(),
                          (error) => {
                              console.error(
                                  'Boussole indisponible :',
                                  error,
                              );
                          },
                      ));

            onPreparing?.();
            await compassPromise;

            if (!isSessionCurrent()) {
                this.#cleanupAbortedStart(generation);
                return false;
            }

            if (!this.isFreshPosition(this.#lastKnownPosition)) {
                try {
                    const userPosition = await this.#gps.requestPosition({
                        maximumAge: 0,
                    });

                    if (!isSessionCurrent()) {
                        this.#cleanupAbortedStart(generation);
                        return false;
                    }

                    this.rememberPosition(userPosition);
                } catch (error) {
                    if (!isSessionCurrent()) {
                        this.#cleanupAbortedStart(generation);
                        return false;
                    }

                    console.warn(
                        'Impossible d’obtenir une position GPS récente au démarrage :',
                        error,
                    );
                }
            }

            if (route) {
                const segment = route.segments[0];

                this.#mapEffects.drawNavigationRoute(route);
                this.#navigationEngine.setNavigationRoute(
                    segment.geometry,
                    {
                        latitude: segment.destination.latitude,
                        longitude: segment.destination.longitude,
                    },
                    segment.mode,
                );
                this.#mapEffects.clearPlannerRoutePreview();
            }

            if (this.#lastKnownPosition) {
                this.#mapEffects.showUserPosition(this.#lastKnownPosition);
            }

            await prepareCamera?.();

            if (!isSessionCurrent()) {
                this.#cleanupAbortedStart(generation);
                return false;
            }

            isInitialCameraSetup = false;
            onCameraReady?.();
            this.#startPositionWatch({
                sessionGeneration: generation,
                onPosition,
                onError: (error) => console.error('Erreur GPS :', error),
            });

            return true;
        } catch (error) {
            if (generation === this.#sessionGeneration) {
                // Include failures before #isActive is set (for example while
                // stopping background tracking) in the same rollback path.
                this.#isActive = true;
                this.#cleanupAbortedStart(generation);
            }

            throw error;
        }
    }

    stop({ afterNavigationClear } = {}) {
        if (!this.#isActive && !this.#isWatchingPosition) {
            return false;
        }

        this.#sessionGeneration++;
        this.#isActive = false;
        this.#compassExpected = false;
        let firstError = null;
        let wasFollowingUser = false;
        const attemptCleanup = (cleanup) => {
            try {
                return cleanup();
            } catch (error) {
                firstError ??= error;
                return undefined;
            }
        };

        attemptCleanup(() => this.#wakeLock.stop());
        attemptCleanup(() => this.#stopPositionWatch());
        attemptCleanup(() => this.#compass.stop());
        attemptCleanup(() => this.#navigationEngine.stopNavigationProcessing());

        wasFollowingUser =
            attemptCleanup(() => this.#mapEffects.clearNavigation()) === true;
        attemptCleanup(() => afterNavigationClear?.());

        if (this.isFreshPosition(this.#lastKnownPosition)) {
            attemptCleanup(() =>
                this.#mapEffects.showUserPosition(this.#lastKnownPosition),
            );
        }

        attemptCleanup(() => this.#mapEffects.setUserFollowing(wasFollowingUser));
        attemptCleanup(() => this.#mapEffects.startBackgroundTracking());

        if (wasFollowingUser) {
            try {
                Promise.resolve(this.#compass.reactivateIfEligible()).catch(
                    (error) =>
                        console.error(
                            'Impossible de réactiver la boussole :',
                            error,
                        ),
                );
            } catch (error) {
                firstError ??= error;
            }
        }

        this.#clearPositions();

        if (firstError) {
            throw firstError;
        }

        return true;
    }

    #cleanupAbortedStart(generation) {
        if (generation !== this.#sessionGeneration || !this.#isActive) {
            return false;
        }

        try {
            this.stop();
        } catch (cleanupError) {
            console.error(
                'Erreur pendant le nettoyage du démarrage de navigation :',
                cleanupError,
            );
        }

        return true;
    }

    #startPositionWatch({ sessionGeneration, onPosition, onError } = {}) {
        if (this.#isWatchingPosition) {
            return false;
        }

        this.#isWatchingPosition = true;

        let watchId;

        try {
            watchId = this.#gps.startWatchingPosition(
                (position) => {
                    if (
                        !this.#isWatchingPosition ||
                        sessionGeneration !== this.#sessionGeneration ||
                        !this.#isActive
                    ) {
                        return;
                    }

                    const previousReliableTimestamp =
                        this.#lastReliablePosition?.timestamp;
                    this.rememberPosition(position);
                    const latestReliablePosition = this.#lastReliablePosition;
                    const reliablePositionUpdated =
                        this.isReliablePosition(position) &&
                        latestReliablePosition?.timestamp ===
                            position.timestamp &&
                        (!Number.isFinite(previousReliableTimestamp) ||
                            position.timestamp > previousReliableTimestamp);

                    // Preserve the current callback order: destination-change waiters
                    // see a reliable fix before it is passed to route progression.
                    onPosition?.(position, {
                        reliablePosition: latestReliablePosition,
                        reliablePositionUpdated,
                    });

                    if (
                        !this.#isWatchingPosition ||
                        sessionGeneration !== this.#sessionGeneration ||
                        !this.#isActive
                    ) {
                        return;
                    }

                    this.#navigationEngine.updateNavigationProgress(position);
                },
                (error) => {
                    if (
                        this.#isWatchingPosition &&
                        sessionGeneration === this.#sessionGeneration &&
                        this.#isActive
                    ) {
                        onError?.(error);
                    }
                },
            );
        } catch (error) {
            if (sessionGeneration === this.#sessionGeneration) {
                this.#isWatchingPosition = false;
            }

            throw error;
        }

        if (
            sessionGeneration !== this.#sessionGeneration ||
            !this.#isWatchingPosition ||
            !this.#isActive
        ) {
            if (watchId !== null && watchId !== undefined) {
                this.#gps.clearWatch(watchId);
            }

            return false;
        }

        if (watchId === null || watchId === undefined) {
            this.#isWatchingPosition = false;
            return false;
        }

        this.#positionWatchId = watchId;
        return true;
    }

    #stopPositionWatch() {
        if (!this.#isWatchingPosition) {
            return false;
        }

        this.#isWatchingPosition = false;
        const watchId = this.#positionWatchId;
        this.#positionWatchId = null;

        if (watchId !== null && watchId !== undefined) {
            this.#gps.clearWatch(watchId);
        }

        return true;
    }

    #clearPositions() {
        this.#lastKnownPosition = null;
        this.#lastReliablePosition = null;
    }
}
