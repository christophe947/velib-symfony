/**
 * Owns the raw GPS positions and watch used by the active navigation session.
 * Route progression itself remains owned by the navigation engine.
 */
export class NavigationSession {
    #navigationEngine;
    #startWatchingPosition;
    #clearWatch;
    #positionWatchId = null;
    #isWatchingPosition = false;
    #watchGeneration = 0;
    #lastKnownPosition = null;
    #lastReliablePosition = null;

    constructor({ navigationEngine, startWatchingPosition, clearWatch }) {
        if (
            !navigationEngine ||
            typeof startWatchingPosition !== 'function' ||
            typeof clearWatch !== 'function'
        ) {
            throw new TypeError('NavigationSession dependencies are required.');
        }

        this.#navigationEngine = navigationEngine;
        this.#startWatchingPosition = startWatchingPosition;
        this.#clearWatch = clearWatch;
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

    startPositionWatch({ onPosition, onError } = {}) {
        if (this.#isWatchingPosition) {
            return false;
        }

        const generation = ++this.#watchGeneration;
        this.#isWatchingPosition = true;

        let watchId;

        try {
            watchId = this.#startWatchingPosition(
                (position) => {
                    if (
                        !this.#isWatchingPosition ||
                        generation !== this.#watchGeneration
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
                        generation !== this.#watchGeneration
                    ) {
                        return;
                    }

                    this.#navigationEngine.updateNavigationProgress(position);
                },
                (error) => {
                    if (
                        this.#isWatchingPosition &&
                        generation === this.#watchGeneration
                    ) {
                        onError?.(error);
                    }
                },
            );
        } catch (error) {
            if (generation === this.#watchGeneration) {
                this.#watchGeneration++;
                this.#isWatchingPosition = false;
            }

            throw error;
        }

        if (generation !== this.#watchGeneration || !this.#isWatchingPosition) {
            if (watchId !== null && watchId !== undefined) {
                this.#clearWatch(watchId);
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

    stopPositionWatch() {
        if (!this.#isWatchingPosition) {
            return false;
        }

        this.#watchGeneration++;
        this.#isWatchingPosition = false;
        const watchId = this.#positionWatchId;
        this.#positionWatchId = null;

        if (watchId !== null && watchId !== undefined) {
            this.#clearWatch(watchId);
        }

        return true;
    }

    clearPositions() {
        this.#lastKnownPosition = null;
        this.#lastReliablePosition = null;
    }
}
