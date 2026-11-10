const DEFAULT_INTERVAL_MS = 30_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

function serializeForComparison(value) {
    if (Array.isArray(value)) {
        return `[${value.map(serializeForComparison).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map(
            (key) =>
                `${JSON.stringify(key)}:${serializeForComparison(value[key])}`,
        )
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function fingerprintStations(stations) {
    return serializeForComparison(
        [...stations].sort((first, second) =>
            String(first?.id).localeCompare(String(second?.id)),
        ),
    );
}

function validateSnapshot(snapshot) {
    if (
        !snapshot ||
        !Array.isArray(snapshot.stations) ||
        typeof snapshot.fetchedAt !== 'string' ||
        !Number.isFinite(Date.parse(snapshot.fetchedAt)) ||
        typeof snapshot.stale !== 'boolean'
    ) {
        throw new TypeError('Invalid Vélib stations snapshot.');
    }

    return {
        stations: snapshot.stations,
        fetchedAt: snapshot.fetchedAt,
        stale: snapshot.stale,
    };
}

/**
 * Polls the Symfony stations endpoint while the page is visible.
 * The first request is delayed by one interval because Twig already supplied
 * the initial station list to the page.
 */
export function startStationRefresh({
    onSnapshot,
    onError = (error) => console.warn('Vélib station refresh failed:', error),
    initialStations = [],
    endpoint = '/api/velib/stations',
    fetchImpl = globalThis.fetch,
    documentRef = globalThis.document,
} = {}) {
    if (typeof onSnapshot !== 'function') {
        throw new TypeError('onSnapshot must be a function.');
    }

    if (typeof fetchImpl !== 'function') {
        throw new TypeError('The Fetch API is unavailable.');
    }

    if (!documentRef?.addEventListener || !documentRef?.removeEventListener) {
        throw new TypeError('A document with visibility events is required.');
    }

    let stopped = false;
    let inFlight = false;
    let timerId = null;
    let nextAttemptAt = Date.now() + DEFAULT_INTERVAL_MS;
    let failureCount = 0;
    let hasReportedFailure = false;
    let latestFetchedAt = null;
    let latestFetchedAtMs = null;
    let latestStationsFingerprint = fingerprintStations(initialStations);
    let latestStale = null;

    const clearScheduledAttempt = () => {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    };

    const scheduleAttempt = (delay) => {
        clearScheduledAttempt();
        nextAttemptAt = Date.now() + delay;

        if (stopped || documentRef.visibilityState === 'hidden') {
            return;
        }

        timerId = setTimeout(() => {
            timerId = null;
            void refresh();
        }, delay);
    };

    const reportFailure = (error) => {
        failureCount += 1;

        if (!hasReportedFailure) {
            hasReportedFailure = true;
            try {
                onError(error);
            } catch (callbackError) {
                console.error(
                    'Vélib station refresh error handler failed:',
                    callbackError,
                );
            }
        }

        const retryDelay = Math.min(
            DEFAULT_INTERVAL_MS * 2 ** failureCount,
            MAX_RETRY_DELAY_MS,
        );

        scheduleAttempt(retryDelay);
    };

    async function refresh() {
        if (
            stopped ||
            inFlight ||
            documentRef.visibilityState === 'hidden'
        ) {
            return;
        }

        inFlight = true;

        try {
            const response = await fetchImpl(endpoint, { cache: 'no-store' });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            let payload;

            try {
                payload = await response.json();
            } catch (error) {
                throw new TypeError('Invalid JSON in Vélib stations response.', {
                    cause: error,
                });
            }

            const snapshot = validateSnapshot(payload);
            const fetchedAtMs = Date.parse(snapshot.fetchedAt);

            if (
                latestFetchedAtMs !== null &&
                fetchedAtMs < latestFetchedAtMs
            ) {
                throw new Error('Received an older Vélib stations snapshot.');
            }

            if (stopped) {
                return;
            }

            const stationsFingerprint = fingerprintStations(snapshot.stations);
            const dataChanged =
                stationsFingerprint !== latestStationsFingerprint;
            const metadataChanged =
                snapshot.fetchedAt !== latestFetchedAt ||
                snapshot.stale !== latestStale;

            latestFetchedAt = snapshot.fetchedAt;
            latestFetchedAtMs = fetchedAtMs;
            latestStationsFingerprint = stationsFingerprint;
            latestStale = snapshot.stale;
            failureCount = 0;
            hasReportedFailure = false;

            if (dataChanged || metadataChanged) {
                try {
                    onSnapshot(snapshot, { dataChanged, metadataChanged });
                } catch (error) {
                    try {
                        onError(error);
                    } catch (callbackError) {
                        console.error(
                            'Vélib station refresh error handler failed:',
                            callbackError,
                        );
                    }
                }
            }

            scheduleAttempt(DEFAULT_INTERVAL_MS);
        } catch (error) {
            if (!stopped) {
                reportFailure(error);
            }
        } finally {
            inFlight = false;
        }
    }

    const onVisibilityChange = () => {
        if (documentRef.visibilityState === 'hidden') {
            clearScheduledAttempt();
            return;
        }

        if (inFlight || stopped) {
            return;
        }

        const remainingDelay = Math.max(0, nextAttemptAt - Date.now());
        scheduleAttempt(remainingDelay);
    };

    documentRef.addEventListener('visibilitychange', onVisibilityChange);

    // Do not immediately repeat the stations already embedded by Symfony/Twig.
    scheduleAttempt(DEFAULT_INTERVAL_MS);

    return () => {
        if (stopped) {
            return;
        }

        stopped = true;
        clearScheduledAttempt();
        documentRef.removeEventListener(
            'visibilitychange',
            onVisibilityChange,
        );
    };
}
