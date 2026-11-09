export function createScreenWakeLock() {
    let isNavigationActive = false;
    let wakeLockSentinel = null;
    let pendingRequest = null;
    let navigationGeneration = 0;
    let visibilityGeneration = 0;
    let requestFailed = false;
    let releaseRetryUsed = false;
    let wasVisible = document.visibilityState === 'visible';

    async function releaseSentinel(sentinel) {
        try {
            await sentinel.release();
        } catch {
            // Le navigateur peut avoir déjà libéré le verrou.
        }
    }

    function handleSentinelRelease(sentinel) {
        if (wakeLockSentinel !== sentinel) {
            return;
        }

        wakeLockSentinel = null;

        if (
            isNavigationActive &&
            document.visibilityState === 'visible' &&
            !releaseRetryUsed &&
            !requestFailed
        ) {
            releaseRetryUsed = true;
            void requestWakeLock();
        }
    }

    function requestWakeLock() {
        if (
            !isNavigationActive ||
            document.visibilityState !== 'visible' ||
            wakeLockSentinel ||
            requestFailed
        ) {
            return pendingRequest ?? Promise.resolve();
        }

        if (pendingRequest) {
            return pendingRequest;
        }

        const wakeLock = navigator.wakeLock;

        if (!wakeLock || typeof wakeLock.request !== 'function') {
            requestFailed = true;
            return Promise.resolve();
        }

        const requestNavigationGeneration = navigationGeneration;
        const requestVisibilityGeneration = visibilityGeneration;
        let request;

        try {
            // Appelé directement depuis start(), encore dans le geste utilisateur.
            request = wakeLock.request('screen');
        } catch {
            requestFailed = true;
            return Promise.resolve();
        }

        const pending = Promise.resolve(request)
            .then(async (sentinel) => {
                if (
                    !isNavigationActive ||
                    requestNavigationGeneration !== navigationGeneration ||
                    requestVisibilityGeneration !== visibilityGeneration ||
                    document.visibilityState !== 'visible'
                ) {
                    await releaseSentinel(sentinel);
                    return;
                }

                wakeLockSentinel = sentinel;
                sentinel.addEventListener('release', () => {
                    handleSentinelRelease(sentinel);
                }, { once: true });

                if (sentinel.released) {
                    handleSentinelRelease(sentinel);
                }
            })
            .catch(() => {
                if (
                    requestNavigationGeneration === navigationGeneration &&
                    requestVisibilityGeneration === visibilityGeneration
                ) {
                    requestFailed = true;
                }
            })
            .finally(() => {
                if (pendingRequest === pending) {
                    pendingRequest = null;
                }

                // Repart après une résolution tardive d'une ancienne session
                // ou d'une période où la page était masquée.
                if (
                    isNavigationActive &&
                    document.visibilityState === 'visible' &&
                    !requestFailed &&
                    (requestNavigationGeneration !== navigationGeneration ||
                        requestVisibilityGeneration !== visibilityGeneration)
                ) {
                    void requestWakeLock();
                }
            });

        pendingRequest = pending;
        return pending;
    }

    function releaseCurrentWakeLock() {
        const sentinel = wakeLockSentinel;
        wakeLockSentinel = null;

        if (sentinel) {
            void releaseSentinel(sentinel);
        }
    }

    function start() {
        if (isNavigationActive) {
            return;
        }

        isNavigationActive = true;
        navigationGeneration++;
        requestFailed = false;
        releaseRetryUsed = false;
        void requestWakeLock();
    }

    function stop() {
        isNavigationActive = false;
        navigationGeneration++;
        requestFailed = false;
        releaseRetryUsed = false;
        releaseCurrentWakeLock();
    }

    document.addEventListener('visibilitychange', () => {
        const isVisible = document.visibilityState === 'visible';

        if (isVisible === wasVisible) {
            return;
        }

        wasVisible = isVisible;
        visibilityGeneration++;

        if (!isVisible) {
            releaseRetryUsed = false;
            releaseCurrentWakeLock();
            return;
        }

        requestFailed = false;
        releaseRetryUsed = false;
        void requestWakeLock();
    });

    return { start, stop };
}
