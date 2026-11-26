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
    #reliablePositionWaiters = new Set();
    #positionRequestCancellers = new Set();
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

    #isReliablePosition(position) {
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
            this.#isReliablePosition(position) &&
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

    async getReliablePosition({
        timeoutMs = 10_000,
        signal,
        afterTimestamp,
    } = {}) {
        if (signal?.aborted) {
            throw createAbortError();
        }

        const generation = this.#sessionGeneration;
        const hasTimestampFloor = Number.isFinite(afterTimestamp);
        const cachedPosition = this.#lastReliablePosition;

        if (
            this.#isReliablePosition(cachedPosition) &&
            (!hasTimestampFloor || cachedPosition.timestamp > afterTimestamp)
        ) {
            return cachedPosition;
        }

        // Keep the former panel semantics: while waiting on the active watch,
        // accept only a reliable fix strictly newer than the cached one.
        const waitAfterTimestamp = hasTimestampFloor
            ? afterTimestamp
            : Number.isFinite(cachedPosition?.timestamp)
              ? cachedPosition.timestamp
              : null;

        if (this.#isActive && this.#isWatchingPosition) {
            return this.#waitForReliableWatchPosition({
                timeoutMs,
                signal,
                afterTimestamp: waitAfterTimestamp,
                sessionGeneration: generation,
            });
        }

        const position = await this.#requestPosition({
            timeoutMs,
            signal,
            sessionGeneration: generation,
        });

        if (!position) {
            return null;
        }

        this.rememberPosition(position);

        const latestReliablePosition = this.#lastReliablePosition;
        const reliablePosition = this.#isReliablePosition(position)
            ? position
            : null;
        const newestPosition =
            this.#isReliablePosition(latestReliablePosition) &&
            (!reliablePosition ||
                latestReliablePosition.timestamp > reliablePosition.timestamp)
                ? latestReliablePosition
                : reliablePosition;

        if (
            !newestPosition ||
            (hasTimestampFloor &&
                newestPosition.timestamp <= afterTimestamp)
        ) {
            return null;
        }

        return newestPosition;
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
        if (
            !this.#isActive &&
            !this.#isWatchingPosition &&
            this.#reliablePositionWaiters.size === 0 &&
            this.#positionRequestCancellers.size === 0
        ) {
            return false;
        }

        this.#sessionGeneration++;
        this.#isActive = false;
        this.#compassExpected = false;
        this.#finishReliablePositionWaiters(null);
        this.#finishPositionRequests();
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

    #startPositionWatch({ sessionGeneration, onError } = {}) {
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
                        this.#isReliablePosition(position) &&
                        latestReliablePosition?.timestamp ===
                            position.timestamp &&
                        (!Number.isFinite(previousReliableTimestamp) ||
                            position.timestamp > previousReliableTimestamp);

                    this.#resolveReliablePositionWaiters(
                        latestReliablePosition,
                        reliablePositionUpdated,
                        sessionGeneration,
                    );

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

    #waitForReliableWatchPosition({
        timeoutMs,
        signal,
        afterTimestamp,
        sessionGeneration,
    }) {
        return new Promise((resolve, reject) => {
            const waiter = {
                afterTimestamp,
                sessionGeneration,
                resolve: (position) => finish(resolve, position),
                reject: (error) => finish(reject, error),
                timeoutId: null,
                signal,
                abortHandler: null,
            };
            let isSettled = false;

            const finish = (settle, value) => {
                if (isSettled) {
                    return;
                }

                isSettled = true;
                clearTimeout(waiter.timeoutId);
                signal?.removeEventListener('abort', waiter.abortHandler);
                this.#reliablePositionWaiters.delete(waiter);
                settle(value);
            };

            if (signal?.aborted) {
                waiter.reject(createAbortError());
                return;
            }

            waiter.abortHandler = () => waiter.reject(createAbortError());
            signal?.addEventListener('abort', waiter.abortHandler, {
                once: true,
            });
            waiter.timeoutId = setTimeout(
                () => waiter.reject(createPositionTimeoutError()),
                Math.max(0, timeoutMs),
            );
            this.#reliablePositionWaiters.add(waiter);
        });
    }

    #resolveReliablePositionWaiters(
        position,
        reliablePositionUpdated,
        sessionGeneration,
    ) {
        if (!reliablePositionUpdated || !position) {
            return;
        }

        for (const waiter of this.#reliablePositionWaiters) {
            if (
                waiter.sessionGeneration === sessionGeneration &&
                (!Number.isFinite(waiter.afterTimestamp) ||
                    position.timestamp > waiter.afterTimestamp)
            ) {
                waiter.resolve(position);
            }
        }
    }

    #finishReliablePositionWaiters(position) {
        for (const waiter of this.#reliablePositionWaiters) {
            waiter.resolve(position);
        }
    }

    #finishPositionRequests() {
        for (const cancelRequest of this.#positionRequestCancellers) {
            cancelRequest();
        }
    }

    #requestPosition({ timeoutMs, signal, sessionGeneration }) {
        return new Promise((resolve, reject) => {
            let timeoutId = null;
            let isSettled = false;
            const finish = (settle, value) => {
                if (isSettled) {
                    return;
                }

                isSettled = true;
                clearTimeout(timeoutId);
                signal?.removeEventListener('abort', abortHandler);
                this.#positionRequestCancellers.delete(cancelOnStop);
                settle(value);
            };
            const abortHandler = () => finish(reject, createAbortError());
            const cancelOnStop = () => finish(resolve, null);

            if (signal?.aborted) {
                abortHandler();
                return;
            }

            signal?.addEventListener('abort', abortHandler, { once: true });
            this.#positionRequestCancellers.add(cancelOnStop);
            timeoutId = setTimeout(
                () =>
                    finish(
                        reject,
                        createPositionTimeoutError('POSITION_REQUEST_TIMEOUT'),
                    ),
                Math.max(0, timeoutMs),
            );

            let positionRequest;

            try {
                positionRequest = this.#gps.requestPosition({ maximumAge: 0 });
            } catch (error) {
                finish(reject, error);
                return;
            }

            Promise.resolve(positionRequest).then(
                (position) => {
                    if (sessionGeneration !== this.#sessionGeneration) {
                        finish(resolve, null);
                        return;
                    }

                    finish(resolve, position);
                },
                (error) => finish(reject, error),
            );
        });
    }
}

function createAbortError() {
    if (typeof DOMException === 'function') {
        return new DOMException('The operation was aborted.', 'AbortError');
    }

    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function createPositionTimeoutError(code = 'POSITION_WAIT_TIMEOUT') {
    const error = new Error('Timed out while waiting for a reliable position.');
    error.code = code;
    return error;
}
