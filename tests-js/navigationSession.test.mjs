import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(
    new URL('../assets/maplibre/navigation/navigationSession.js', import.meta.url),
    'utf8',
);
const { NavigationSession } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

function createSessionHarness({
    requestPosition = async () => position(),
    watchReturnsNull = false,
    followingAfterClear = true,
    compassActivationPromise = Promise.resolve(),
    failures = {},
} = {}) {
    const events = [];
    const watches = [];
    const clearedWatchIds = [];
    const progressedPositions = [];
    const compassControlPredicates = [];
    let nextWatchId = 1;
    let nextReplacementId = 1;
    let activeReplacementId = null;
    let navigationMode = null;
    let activeMapSegmentIndex = 0;
    const fail = (name) => {
        if (failures[name]) {
            throw failures[name];
        }
    };

    const navigationEngine = {
        getNavigationMode: () => navigationMode,
        setNavigationRoute(_coordinates, _destination, mode = 'pedestrian') {
            events.push('engine:route:set');
            fail('setNavigationRoute');
            navigationMode = mode;
        },
        beginRouteReplacement() {
            events.push('engine:replacement:begin');
            activeReplacementId = nextReplacementId++;
            return activeReplacementId;
        },
        cancelRouteReplacement(replacementId) {
            events.push(`engine:replacement:cancel:${replacementId}`);
            if (activeReplacementId !== replacementId) {
                return false;
            }

            activeReplacementId = null;
            return true;
        },
        commitRouteReplacement(replacementId, _coordinates, _destination, mode) {
            events.push(
                `engine:replacement:commit:${replacementId}:${mode}:${activeMapSegmentIndex}`,
            );
            fail('commitRouteReplacement');
            if (activeReplacementId !== replacementId) {
                return false;
            }

            activeReplacementId = null;
            navigationMode = mode;
            return true;
        },
        updateNavigationProgress(positionValue) {
            events.push('engine:progress');
            progressedPositions.push(positionValue);
        },
        stopNavigationProcessing() {
            events.push('engine:stop');
            fail('stopNavigationProcessing');
        },
    };
    const session = new NavigationSession({
        navigationEngine,
        gps: {
            requestPosition(options) {
                events.push('gps:request');
                return requestPosition(options);
            },
            startWatchingPosition(onPosition, onError) {
                events.push('gps:watch:start');
                fail('startWatchingPosition');
                if (watchReturnsNull) {
                    onError?.(new Error('Geolocation unavailable'));
                    return null;
                }

                const watch = { id: nextWatchId++, onPosition, onError };
                watches.push(watch);
                return watch.id;
            },
            clearWatch(watchId) {
                clearedWatchIds.push(watchId);
                events.push('gps:watch:clear');
            },
        },
        mapEffects: {
            stopBackgroundTracking() {
                events.push('map:background:stop');
                fail('stopBackgroundTracking');
            },
            setNavigationActive(initialPosition, mode) {
                events.push(`map:navigation:${mode}:${Boolean(initialPosition)}`);
                fail('setNavigationActive');
            },
            setNavigationMode(mode) {
                events.push(`map:mode:${mode}`);
                fail('setNavigationMode');
            },
            showNavigationDestination(destination) {
                events.push(
                    `map:destination:${destination.latitude}:${destination.longitude}`,
                );
                fail('showNavigationDestination');
            },
            setUserFollowing(enabled) {
                events.push(`map:following:${enabled}`);
            },
            showUserPosition() {
                events.push('map:user-position');
                fail('showUserPosition');
            },
            drawNavigationRoute(route) {
                events.push('map:route:draw');
                if (route?.type === 'multimodal') {
                    activeMapSegmentIndex = 0;
                }
                fail('drawNavigationRoute');
            },
            setActiveNavigationSegment(segmentIndex) {
                events.push(`map:segment:${segmentIndex}`);
                const previousIndex = activeMapSegmentIndex;
                if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
                    return false;
                }

                activeMapSegmentIndex = segmentIndex;
                return previousIndex;
            },
            clearPlannerRoutePreview() {
                events.push('map:preview:clear');
            },
            clearNavigation() {
                events.push('map:navigation:clear');
                fail('clearNavigation');
                return followingAfterClear;
            },
            startBackgroundTracking() {
                events.push('map:background:start');
                fail('startBackgroundTracking');
            },
        },
        compass: {
            activate(canControlCamera) {
                events.push('compass:activate');
                compassControlPredicates.push(canControlCamera);
                return compassActivationPromise;
            },
            stop() {
                events.push('compass:stop');
                fail('compassStop');
            },
            reactivateIfEligible() {
                events.push('compass:reactivate');
                return Promise.resolve();
            },
        },
        wakeLock: {
            start() {
                events.push('wake:start');
                fail('wakeStart');
            },
            stop() {
                events.push('wake:stop');
                fail('wakeStop');
            },
        },
    });

    return {
        session,
        events,
        watches,
        clearedWatchIds,
        progressedPositions,
        compassControlPredicates,
        failures,
    };
}

function position({ timestamp = Date.now(), accuracy = 8, latitude = 48.86 } = {}) {
    return {
        longitude: 2.35,
        latitude,
        accuracy,
        timestamp,
    };
}

function segment(mode, longitude) {
    return {
        mode,
        geometry: [
            [longitude - 0.001, 48.86],
            [longitude, 48.86],
        ],
        destination: { latitude: 48.86, longitude, type: 'station' },
    };
}

function routeFor(mode, longitude = 2.35) {
    return { segments: [segment(mode, longitude)] };
}

async function withFixedNow(now, callback) {
    const originalNow = Date.now;
    Date.now = () => now;

    try {
        return await callback();
    } finally {
        Date.now = originalNow;
    }
}

async function withMutableNow(initialNow, callback) {
    const originalNow = Date.now;
    let currentNow = initialNow;
    Date.now = () => currentNow;

    try {
        return await callback((nextNow) => {
            currentNow = nextNow;
        });
    } finally {
        Date.now = originalNow;
    }
}

async function allowPendingStartToContinue() {
    await Promise.resolve();
    await Promise.resolve();
}

async function withQuietConsole(action) {
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};

    try {
        return await action();
    } finally {
        console.error = originalError;
        console.warn = originalWarn;
    }
}

async function assertFailedStartIsCleanAndRetryable({
    failureName,
    failure,
    mode = 'bicycle',
    route = null,
    compassActivation = Promise.resolve(),
    prepareCamera,
    requestPosition,
}) {
    const failures = failureName ? { [failureName]: failure } : {};
    const harness = createSessionHarness({ failures, requestPosition });
    const { session, events, watches, clearedWatchIds } = harness;
    if (!requestPosition) {
        session.rememberPosition(position());
    }

    await withQuietConsole(async () => {
        await assert.rejects(
            session.start({
                mode,
                route,
                compassActivation,
                prepareCamera,
            }),
            (error) => error === failure,
        );
    });

    assert.equal(session.isActive(), false);
    assert.equal(watches.length, 0);
    assert.equal(events.filter((event) => event === 'wake:stop').length, 1);
    assert.equal(events.filter((event) => event === 'engine:stop').length, 1);
    assert.equal(
        events.filter((event) => event === 'map:navigation:clear').length,
        1,
    );
    assert.equal(
        events.filter((event) => event === 'map:background:start').length,
        1,
    );
    assert.deepEqual(clearedWatchIds, []);

    failures[failureName] = null;
    assert.equal(
        await session.start({
            mode,
            route,
            compassActivation: Promise.resolve(),
        }),
        true,
    );
    assert.equal(session.isActive(), true);
    assert.equal(watches.length, 1);
    session.stop();
}

function plannerRoute(mode = 'bicycle') {
    return {
        segments: [
            {
                mode,
                geometry: [
                    [2.35, 48.86],
                    [2.36, 48.87],
                ],
                destination: { latitude: 48.87, longitude: 2.36 },
            },
        ],
    };
}

test('preserves walking startup order and stops all session resources', async () => {
    const { session, events, watches, clearedWatchIds } = createSessionHarness();
    session.rememberPosition(position());

    assert.equal(
        await session.start({
            mode: 'pedestrian',
            onPreparing: () => events.push('ui:preparing'),
            prepareCamera: () => events.push('camera:prepare'),
            onCameraReady: () => events.push('camera:ready'),
            onStarted: () => events.push('ui:started'),
        }),
        true,
    );

    assert.equal(session.isActive(), true);
    assert.deepEqual(events.slice(0, 6), [
        'map:background:stop',
        'map:navigation:pedestrian:true',
        'map:following:true',
        'wake:start',
        'compass:activate',
        'ui:preparing',
    ]);
    assert.ok(events.indexOf('camera:prepare') < events.indexOf('gps:watch:start'));
    assert.ok(events.indexOf('camera:ready') < events.indexOf('gps:watch:start'));
    assert.equal(events.includes('gps:request'), false);
    assert.equal(watches.length, 1);

    session.stop({
        afterNavigationClear: () => events.push('map:planner-preview:clear'),
    });

    assert.equal(session.isActive(), false);
    assert.deepEqual(clearedWatchIds, [watches[0].id]);
    assert.deepEqual(events.slice(-10), [
        'wake:stop',
        'gps:watch:clear',
        'compass:stop',
        'engine:stop',
        'map:navigation:clear',
        'map:planner-preview:clear',
        'map:user-position',
        'map:following:true',
        'map:background:start',
        'compass:reactivate',
    ]);
    assert.equal(session.getLastKnownPosition(), null);

    session.stop();
    assert.equal(events.filter((event) => event === 'wake:stop').length, 1);
    assert.equal(events.filter((event) => event === 'engine:stop').length, 1);
    assert.equal(
        events.filter((event) => event === 'map:navigation:clear').length,
        1,
    );
    assert.equal(
        events.filter((event) => event === 'map:background:start').length,
        1,
    );
    assert.equal(clearedWatchIds.length, 1);
});

test('starts bicycle guidance without activating the compass and installs its route', async () => {
    const { session, events } = createSessionHarness();
    const route = {
        segments: [{
            mode: 'bicycle',
            geometry: [[2.35, 48.86], [2.36, 48.87]],
            destination: { latitude: 48.87, longitude: 2.36 },
        }],
    };

    assert.equal(
        await session.start({
            route,
            compassActivation: Promise.resolve(),
            prepareCamera: () => events.push('camera:prepare'),
        }),
        true,
    );

    assert.ok(events.includes('map:navigation:bicycle:false'));
    assert.ok(events.includes('compass:stop'));
    assert.equal(events.includes('compass:activate'), false);
    assert.ok(events.indexOf('map:route:draw') < events.indexOf('engine:route:set'));
    assert.ok(events.indexOf('engine:route:set') < events.indexOf('map:preview:clear'));
    assert.ok(events.indexOf('map:preview:clear') < events.indexOf('camera:prepare'));
    assert.ok(events.indexOf('camera:prepare') < events.indexOf('gps:watch:start'));
    session.stop();
});

test('rejects a concurrent start while the first session awaits compass activation', async () => {
    const { session, events, watches } = createSessionHarness();
    session.rememberPosition(position());
    const compassActivation = createDeferred();

    const firstStart = session.start({
        mode: 'pedestrian',
        compassActivation: compassActivation.promise,
    });
    assert.equal(session.isActive(), true);
    assert.equal(await session.start({ mode: 'bicycle' }), false);

    compassActivation.resolve();
    assert.equal(await firstStart, true);
    assert.equal(watches.length, 1);
    assert.equal(events.filter((event) => event === 'map:background:stop').length, 1);
    session.stop();
});

test('an abort during compass activation prevents GPS, camera, and watch startup', async () => {
    const compassActivation = createDeferred();
    const { session, events, watches } = createSessionHarness({
        compassActivationPromise: compassActivation.promise,
    });
    const start = session.start({
        mode: 'pedestrian',
        prepareCamera: () => events.push('camera:prepare'),
    });

    session.stop();
    compassActivation.resolve();

    assert.equal(await start, false);
    assert.equal(events.includes('gps:request'), false);
    assert.equal(events.includes('camera:prepare'), false);
    assert.equal(watches.length, 0);
    assert.equal(events.filter((event) => event === 'compass:stop').length, 1);
});

test('a navigation activation failure is cleaned and can be retried', async () => {
    await assertFailedStartIsCleanAndRetryable({
        failureName: 'setNavigationActive',
        failure: new Error('Map navigation activation failed'),
    });
});

test('a rejected asynchronous compass activation is cleaned and retryable', async () => {
    const failure = new Error('Compass activation rejected');

    await assertFailedStartIsCleanAndRetryable({
        mode: 'pedestrian',
        failure,
        compassActivation: Promise.reject(failure),
    });
});

test('a wake lock startup failure is cleaned and can be retried', async () => {
    await assertFailedStartIsCleanAndRetryable({
        failureName: 'wakeStart',
        failure: new Error('Wake lock failed'),
    });
});

test('a camera preparation failure is cleaned and can be retried', async () => {
    const failure = new Error('Camera preparation failed');
    let shouldFail = true;

    await assertFailedStartIsCleanAndRetryable({
        failure,
        prepareCamera: async () => {
            if (shouldFail) {
                shouldFail = false;
                throw failure;
            }
        },
    });
});

test('a planner route installation failure is cleaned and can be retried', async () => {
    await assertFailedStartIsCleanAndRetryable({
        failureName: 'setNavigationRoute',
        failure: new Error('Route installation failed'),
        route: plannerRoute(),
    });
});

test('a watch creation failure is cleaned and can be retried', async () => {
    await assertFailedStartIsCleanAndRetryable({
        failureName: 'startWatchingPosition',
        failure: new Error('GPS watch failed'),
    });
});

test('a start failure clears a previously cached fix', async () => {
    const freshFix = position();
    const failure = new Error('User marker update failed');
    const harness = createSessionHarness({
        failures: { showUserPosition: failure },
    });
    harness.session.rememberPosition(freshFix);

    await withQuietConsole(() =>
        assert.rejects(
            harness.session.start({
                mode: 'bicycle',
                compassActivation: Promise.resolve(),
            }),
            (error) => error === failure,
        ),
    );

    assert.equal(harness.session.isActive(), false);
    assert.equal(harness.session.getLastKnownPosition(), null);
    assert.equal(harness.events.includes('gps:request'), false);
    assert.ok(harness.events.includes('map:background:start'));
});

test('cleanup failures do not replace the original start error or block later cleanup', async () => {
    const startFailure = new Error('Navigation activation failed');
    const cleanupFailure = new Error('Wake lock release failed');
    const harness = createSessionHarness({
        failures: {
            setNavigationActive: startFailure,
            wakeStop: cleanupFailure,
        },
    });

    await withQuietConsole(() =>
        assert.rejects(
            harness.session.start({ mode: 'bicycle' }),
            (error) => error === startFailure,
        ),
    );

    assert.equal(harness.session.isActive(), false);
    assert.ok(harness.events.includes('compass:stop'));
    assert.ok(harness.events.includes('engine:stop'));
    assert.ok(harness.events.includes('map:navigation:clear'));
    assert.ok(harness.events.includes('map:background:start'));
});

test('a rejected old start cannot clean up a newer session', async () => {
    const oldCameraWait = createDeferred();
    const failure = new Error('Old camera operation failed');
    const { session, events, watches } = createSessionHarness();
    session.rememberPosition(position());

    const oldStart = session.start({
        mode: 'bicycle',
        compassActivation: Promise.resolve(),
        prepareCamera: () => oldCameraWait.promise,
    });
    await allowPendingStartToContinue();

    session.stop();
    session.rememberPosition(position());
    assert.equal(
        await session.start({
            mode: 'bicycle',
            compassActivation: Promise.resolve(),
        }),
        true,
    );
    const eventsBeforeOldRejection = events.slice();

    oldCameraWait.reject(failure);
    await assert.rejects(oldStart, (error) => error === failure);

    assert.equal(session.isActive(), true);
    assert.equal(watches.length, 1);
    assert.equal(
        events.filter((event) => event === 'engine:stop').length,
        eventsBeforeOldRejection.filter((event) => event === 'engine:stop')
            .length,
    );
    session.stop();
});

test('stopping without active resources is safe and idempotent', () => {
    const { session, events } = createSessionHarness();

    assert.doesNotThrow(() => session.stop());
    assert.doesNotThrow(() => session.stop());
    assert.equal(events.length, 0);
});

test('a late compass reading cannot control the camera after the session stops', async () => {
    const compassActivation = createDeferred();
    const { session, compassControlPredicates, watches } = createSessionHarness({
        compassActivationPromise: compassActivation.promise,
    });
    session.rememberPosition(position());
    const start = session.start({
        mode: 'pedestrian',
        prepareCamera: () => Promise.resolve(),
    });

    await allowPendingStartToContinue();
    assert.equal(compassControlPredicates.length, 1);
    compassActivation.resolve();
    assert.equal(await start, true);
    assert.equal(compassControlPredicates[0](), true);

    session.stop();

    assert.equal(compassControlPredicates[0](), false);
    assert.equal(watches.length, 1);
});

test('starts without a cached fix and uses the first navigation-watch fix', async () => {
    const { session, events, watches, progressedPositions } =
        createSessionHarness({
            requestPosition: async () => {
                throw new Error('Start must not request a one-shot position');
            },
        });
    const route = plannerRoute('pedestrian');
    const start = session.start({
        mode: 'pedestrian',
        route,
        compassActivation: Promise.resolve(),
        prepareCamera: () => events.push('camera:prepare'),
    });

    assert.equal(await start, true);
    assert.equal(events.includes('gps:request'), false);
    assert.equal(events.includes('map:navigation:pedestrian:false'), true);
    assert.equal(events.includes('map:user-position'), false);
    assert.ok(events.indexOf('engine:route:set') < events.indexOf('gps:watch:start'));
    assert.equal(watches.length, 1);

    const firstFix = position();
    watches[0].onPosition(firstFix);
    assert.equal(session.getLastKnownPosition(), firstFix);
    assert.deepEqual(progressedPositions, [firstFix]);
    session.stop();
});

test('does not display an expired cached fix while waiting for the watch', async () => {
    await withMutableNow(100_000, async (setNow) => {
        const { session, events, watches } = createSessionHarness({
            requestPosition: async () => {
                throw new Error('Start must not request a one-shot position');
            },
        });
        session.rememberPosition(position({ timestamp: 99_999 }));
        setNow(110_001);

        assert.equal(
            await session.start({
                mode: 'pedestrian',
                compassActivation: Promise.resolve(),
            }),
            true,
        );
        assert.equal(events.includes('map:navigation:pedestrian:false'), true);
        assert.equal(events.includes('map:user-position'), false);
        assert.equal(events.includes('gps:request'), false);

        const firstFreshFix = position({ timestamp: 110_001 });
        watches[0].onPosition(firstFreshFix);
        assert.equal(session.getLastKnownPosition(), firstFreshFix);
        session.stop();
    });
});

test('stopping before the first fix clears the watch and ignores its late callback', async () => {
    const { session, events, watches, clearedWatchIds, progressedPositions } =
        createSessionHarness();

    assert.equal(
        await session.start({
            mode: 'bicycle',
            route: plannerRoute('bicycle'),
            compassActivation: Promise.resolve(),
        }),
        true,
    );
    assert.equal(events.includes('gps:request'), false);
    assert.equal(watches.length, 1);

    const lateFix = position();
    session.stop();
    watches[0].onPosition(lateFix);

    assert.deepEqual(clearedWatchIds, [watches[0].id]);
    assert.equal(session.getLastKnownPosition(), null);
    assert.deepEqual(progressedPositions, []);
    assert.ok(events.includes('map:background:start'));
});

test('an abort during camera preparation prevents a navigation watch', async () => {
    const cameraReady = createDeferred();
    const { session, watches } = createSessionHarness();
    session.rememberPosition(position());
    const start = session.start({
        mode: 'bicycle',
        compassActivation: Promise.resolve(),
        prepareCamera: () => cameraReady.promise,
    });

    await allowPendingStartToContinue();
    session.stop();
    cameraReady.resolve();

    assert.equal(await start, false);
    assert.equal(watches.length, 0);
});

test('does not wait for a one-shot position and resumes background tracking on stop', async () => {
    const { session, events, watches } = createSessionHarness({
        requestPosition: async () => {
            throw new Error('Start must not request a one-shot position');
        },
    });

    assert.equal(
        await session.start({
            mode: 'pedestrian',
            compassActivation: Promise.resolve(),
        }),
        true,
    );
    assert.equal(events.includes('gps:request'), false);
    assert.equal(watches.length, 1);

    session.stop();
    assert.ok(events.includes('map:background:start'));
    assert.equal(session.getLastKnownPosition(), null);
});

test('a missing navigation watch fails startup and cleans the session', async () => {
    const { session, events, watches } = createSessionHarness({
        watchReturnsNull: true,
    });

    await withQuietConsole(() =>
        assert.rejects(
            session.start({
                mode: 'bicycle',
                route: plannerRoute('bicycle'),
                compassActivation: Promise.resolve(),
            }),
            /suivi GPS de navigation n’a pas démarré/,
        ),
    );

    assert.equal(session.isActive(), false);
    assert.equal(watches.length, 0);
    assert.equal(events.includes('gps:request'), false);
    assert.equal(events.filter((event) => event === 'map:navigation:clear').length, 1);
    assert.ok(events.includes('map:background:start'));
});

test('retains only the newest fresh raw fix and newest reliable fix', async () => {
    await withFixedNow(100_000, async () => {
        const { session } = createSessionHarness();
        const reliable = position({ timestamp: 99_997 });
        const imprecise = position({ timestamp: 99_998, accuracy: 35 });
        const stale = position({ timestamp: 88_999 });

        session.rememberPosition(reliable);
        session.rememberPosition(imprecise);

        assert.equal(session.getLastKnownPosition(), imprecise);
        assert.equal(await session.getReliablePosition(), reliable);
        assert.equal(session.rememberPosition(stale), false);
        assert.equal(session.getLastKnownPosition(), imprecise);
        assert.equal(await session.getReliablePosition(), reliable);
    });
});

test('clearing an old watch prevents it from progressing a later session', async () => {
    const { session, watches, clearedWatchIds, progressedPositions } =
        createSessionHarness();
    session.rememberPosition(position());

    await session.start({
        mode: 'pedestrian',
        compassActivation: Promise.resolve(),
    });
    const oldWatch = watches[0];
    session.stop();
    session.rememberPosition(position());

    await session.start({
        mode: 'bicycle',
        compassActivation: Promise.resolve(),
    });
    const currentWatch = watches[1];

    oldWatch.onPosition(position());
    assert.equal(progressedPositions.length, 0);

    const currentFix = position();
    currentWatch.onPosition(currentFix);
    assert.deepEqual(progressedPositions, [currentFix]);
    assert.deepEqual(clearedWatchIds, [oldWatch.id]);
    session.stop();
});

test('returns a fresh reliable cached position without requesting another fix', async () => {
    const { session, events } = createSessionHarness();
    const cachedPosition = position();
    session.rememberPosition(cachedPosition);

    assert.equal(await session.getReliablePosition(), cachedPosition);
    assert.equal(events.includes('gps:request'), false);
});

test('replaces an imprecise cache with a reliable one-shot position', async () => {
    const requestedPosition = position();
    const { session, events } = createSessionHarness({
        requestPosition: async () => requestedPosition,
    });
    session.rememberPosition(position({ accuracy: 40 }));

    assert.equal(await session.getReliablePosition(), requestedPosition);
    assert.equal(events.filter((event) => event === 'gps:request').length, 1);
});

test('waits for a newer reliable watch fix when the cached fix becomes stale', async () => {
    await withMutableNow(100_000, async (setNow) => {
        const { session, watches } = createSessionHarness();
        const cachedPosition = position({ timestamp: 99_997 });
        session.rememberPosition(cachedPosition);
        await session.start({
            mode: 'pedestrian',
            compassActivation: Promise.resolve(),
        });

        setNow(110_001);
        const result = session.getReliablePosition({ timeoutMs: 1000 });
        const impreciseFix = position({ timestamp: 110_001, accuracy: 35 });
        watches[0].onPosition(impreciseFix);

        let hasSettled = false;
        void result.then(() => {
            hasSettled = true;
        });
        await Promise.resolve();
        assert.equal(hasSettled, false);

        const reliableFix = position({ timestamp: 110_002, accuracy: 10 });
        setNow(110_003);
        watches[0].onPosition(reliableFix);
        assert.equal(await result, reliableFix);
        session.stop();
    });
});

test('uses the existing one-shot request when no navigation watch exists', async () => {
    const requestedPosition = position();
    const { session, events } = createSessionHarness({
        requestPosition: async () => requestedPosition,
        failures: { startWatchingPosition: new Error('watch unavailable') },
    });

    await withQuietConsole(() =>
        assert.rejects(
            session.start({
                mode: 'bicycle',
                compassActivation: Promise.resolve(),
            }),
        ),
    );

    // Start failure cleanup leaves the session inactive; the explicit reliable
    // position API still uses one-shot geolocation when no watch is active.
    assert.equal(await session.getReliablePosition(), requestedPosition);
    assert.equal(events.filter((event) => event === 'gps:request').length, 1);
    assert.equal(events.filter((event) => event === 'gps:watch:start').length, 1);
});

test('aborts and times out one-shot requests without accepting their late fixes', async () => {
    const request = createDeferred();
    const { session } = createSessionHarness({
        requestPosition: () => request.promise,
    });
    const controller = new AbortController();
    const abortedRequest = session.getReliablePosition({
        timeoutMs: 1000,
        signal: controller.signal,
    });

    controller.abort();
    await assert.rejects(abortedRequest, { name: 'AbortError' });

    await assert.rejects(
        session.getReliablePosition({ timeoutMs: 5 }),
        (error) => error.code === 'POSITION_REQUEST_TIMEOUT',
    );
    request.resolve(position());
    await Promise.resolve();
    assert.equal(session.getLastKnownPosition(), null);
});

test('times out while waiting for a reliable watch fix and permits another request', async () => {
    await withMutableNow(100_000, async (setNow) => {
        const { session, watches } = createSessionHarness();
        session.rememberPosition(position({ timestamp: 99_997 }));
        await session.start({
            mode: 'pedestrian',
            compassActivation: Promise.resolve(),
        });

        setNow(110_000);
        await assert.rejects(
            session.getReliablePosition({ timeoutMs: 5 }),
            (error) => error.code === 'POSITION_WAIT_TIMEOUT',
        );

        const retry = session.getReliablePosition({ timeoutMs: 1000 });
        const reliableFix = position({ timestamp: 110_001 });
        setNow(110_002);
        watches[0].onPosition(reliableFix);
        assert.equal(await retry, reliableFix);
        session.stop();
    });
});

test('abort signal cancels only its own waiters and allows a retry', async () => {
    await withMutableNow(100_000, async (setNow) => {
        const { session, watches } = createSessionHarness();
        session.rememberPosition(position({ timestamp: 99_997 }));
        await session.start({
            mode: 'pedestrian',
            compassActivation: Promise.resolve(),
        });
        setNow(110_000);
        const controller = new AbortController();
        const cancelled = session.getReliablePosition({
            timeoutMs: 1000,
            signal: controller.signal,
        });
        const stillWaiting = session.getReliablePosition({
            timeoutMs: 1000,
        });

        controller.abort();
        await assert.rejects(cancelled, { name: 'AbortError' });

        const retry = session.getReliablePosition({ timeoutMs: 1000 });
        const reliableFix = position({ timestamp: 110_001 });
        setNow(110_002);
        watches[0].onPosition(reliableFix);

        assert.equal(await stillWaiting, reliableFix);
        assert.equal(await retry, reliableFix);
        session.stop();
    });
});

test('session stop resolves watch and one-shot waits without accepting late fixes', async () => {
    const oneShot = createDeferred();
    const { session, watches, events } = createSessionHarness({
        requestPosition: () => oneShot.promise,
    });
    await withMutableNow(100_000, async (setNow) => {
        session.rememberPosition(position({ timestamp: 99_997 }));
        await session.start({
            mode: 'bicycle',
            compassActivation: Promise.resolve(),
        });

        setNow(110_000);
        const watchWait = session.getReliablePosition({ timeoutMs: 1000 });
        session.stop();
        assert.equal(await watchWait, null);
        const oldWatch = watches[0];
        oldWatch.onPosition(position({ timestamp: 110_001 }));
        assert.equal(events.includes('engine:progress'), false);
    });

    const noWatchHarness = createSessionHarness({
        requestPosition: () => oneShot.promise,
        failures: { startWatchingPosition: new Error('watch unavailable') },
    });
    noWatchHarness.session.rememberPosition(position());
    await withQuietConsole(() =>
        assert.rejects(
            noWatchHarness.session.start({
                mode: 'bicycle',
                compassActivation: Promise.resolve(),
            }),
        ),
    );
    const oneShotWait = noWatchHarness.session.getReliablePosition({
        timeoutMs: 1000,
    });
    noWatchHarness.session.stop();
    assert.equal(await oneShotWait, null);
    oneShot.resolve(position());
    assert.equal(noWatchHarness.session.getLastKnownPosition(), null);
});

test('enforces afterTimestamp as a strict floor for cached and watched fixes', async () => {
    await withMutableNow(100_000, async (setNow) => {
        const { session, watches } = createSessionHarness();
        const cachedPosition = position({ timestamp: 99_999 });
        session.rememberPosition(cachedPosition);
        await session.start({
            mode: 'bicycle',
            compassActivation: Promise.resolve(),
        });

        setNow(110_000);
        const wait = session.getReliablePosition({
            timeoutMs: 1000,
            afterTimestamp: cachedPosition.timestamp,
        });
        const newerPosition = position({ timestamp: 110_001 });
        setNow(110_002);
        watches[0].onPosition(newerPosition);
        assert.equal(await wait, newerPosition);
        session.stop();
    });
});

test('activates a bicycle segment without restarting GPS or the wake lock', async () => {
    const harness = createSessionHarness();
    await harness.session.start({ route: routeFor('pedestrian') });

    assert.equal(
        await harness.session.activateSegment(segment('bicycle', 2.36)),
        true,
    );

    assert.equal(harness.watches.length, 1);
    assert.equal(harness.events.filter((event) => event === 'gps:watch:start').length, 1);
    assert.equal(harness.events.filter((event) => event === 'wake:start').length, 1);
    assert.ok(harness.events.includes('engine:replacement:commit:1:bicycle:0'));
    assert.ok(harness.events.includes('map:mode:bicycle'));
    assert.ok(harness.events.includes('map:destination:48.86:2.36'));
    assert.ok(harness.events.includes('compass:stop'));
});

test('activates pedestrian mode from the transition call when compass permission is granted', async () => {
    const activation = createDeferred();
    const harness = createSessionHarness({
        compassActivationPromise: activation.promise,
    });
    await harness.session.start({ route: routeFor('bicycle') });

    const transition = harness.session.activateSegment(
        segment('pedestrian', 2.37),
    );
    assert.ok(harness.events.includes('compass:activate'));
    activation.resolve();

    assert.equal(await transition, true);
    assert.equal(harness.watches.length, 1);
    assert.equal(harness.events.filter((event) => event === 'wake:start').length, 1);
    assert.ok(harness.events.includes('map:mode:pedestrian'));
    assert.ok(harness.events.includes('map:destination:48.86:2.37'));
    assert.equal(harness.compassControlPredicates.at(-1)(), true);
});

test('continues pedestrian navigation when compass permission is denied', async () => {
    const activation = createDeferred();
    const harness = createSessionHarness({
        compassActivationPromise: activation.promise,
    });
    await harness.session.start({ route: routeFor('bicycle') });

    const transition = harness.session.activateSegment(
        segment('pedestrian', 2.37),
        { onCompassError() {} },
    );
    assert.ok(harness.events.includes('compass:activate'));
    activation.reject(new Error('permission denied'));

    assert.equal(await transition, true);
    assert.equal(harness.watches.length, 1);
    assert.equal(harness.events.filter((event) => event === 'wake:start').length, 1);
    assert.ok(harness.events.includes('map:mode:pedestrian'));
    assert.ok(harness.events.includes('map:destination:48.86:2.37'));
});

test('a failed route commit cancels its transaction without changing mode or marker', async () => {
    const harness = createSessionHarness({
        failures: {
            commitRouteReplacement: new Error('route source unavailable'),
        },
    });
    await harness.session.start({ route: routeFor('bicycle') });

    await assert.rejects(
        harness.session.activateSegment(segment('bicycle', 2.375)),
        /route source unavailable/,
    );

    assert.ok(harness.events.includes('engine:replacement:cancel:1'));
    assert.ok(!harness.events.includes('map:mode:bicycle'));
    assert.ok(!harness.events.includes('map:destination:48.86:2.375'));
    assert.equal(harness.watches.length, 1);
});

test('selects the next map segment before route commit and preserves the current watch', async () => {
    const harness = createSessionHarness();
    const plan = {
        type: 'multimodal',
        segments: [segment('pedestrian', 2.36), segment('bicycle', 2.38)],
    };
    await harness.session.start({ route: plan });

    assert.equal(
        await harness.session.activateSegment(segment('bicycle', 2.38), {
            segmentIndex: 1,
        }),
        true,
    );

    const selectIndex = harness.events.indexOf('map:segment:1');
    const commit = harness.events.indexOf('engine:replacement:commit:1:bicycle:1');
    assert.ok(selectIndex >= 0);
    assert.ok(commit > selectIndex);
    assert.equal(harness.watches.length, 1);
    assert.equal(harness.events.filter((event) => event === 'wake:start').length, 1);
});

test('restores the previous map segment if route commit fails', async () => {
    const harness = createSessionHarness({
        failures: { commitRouteReplacement: new Error('commit failed') },
    });
    await harness.session.start({
        route: {
            type: 'multimodal',
            segments: [segment('pedestrian', 2.36), segment('bicycle', 2.38)],
        },
    });

    await assert.rejects(
        harness.session.activateSegment(segment('bicycle', 2.38), {
            segmentIndex: 1,
        }),
        /commit failed/,
    );

    assert.deepEqual(
        harness.events.filter((event) => event.startsWith('map:segment:')),
        ['map:segment:1', 'map:segment:0'],
    );
    assert.ok(harness.events.includes('engine:replacement:cancel:1'));
});

test('stopping during a compass transition prevents a late segment installation', async () => {
    const activation = createDeferred();
    const harness = createSessionHarness({
        compassActivationPromise: activation.promise,
    });
    await harness.session.start({ route: routeFor('bicycle') });

    const transition = harness.session.activateSegment(
        segment('pedestrian', 2.38),
    );
    harness.session.stop();
    activation.resolve();

    assert.equal(await transition, false);
    assert.equal(
        harness.events.filter((event) => event.startsWith('engine:replacement:commit:')).length,
        0,
    );
    assert.equal(harness.events.filter((event) => event === 'gps:watch:start').length, 1);
    assert.equal(harness.clearedWatchIds.length, 1);
    assert.equal(harness.events.filter((event) => event === 'wake:start').length, 1);
    assert.equal(harness.events.filter((event) => event === 'wake:stop').length, 1);
});

test('a newer segment transition supersedes an older permission wait', async () => {
    const activation = createDeferred();
    const harness = createSessionHarness({
        compassActivationPromise: activation.promise,
    });
    await harness.session.start({ route: routeFor('bicycle') });

    const obsoleteTransition = harness.session.activateSegment(
        segment('pedestrian', 2.39),
    );
    const currentTransition = harness.session.activateSegment(
        segment('bicycle', 2.4),
    );

    assert.equal(await currentTransition, true);
    activation.resolve();
    assert.equal(await obsoleteTransition, false);

    assert.equal(harness.watches.length, 1);
    assert.equal(harness.events.filter((event) => event === 'gps:watch:start').length, 1);
    assert.equal(harness.events.filter((event) => event === 'wake:start').length, 1);
    assert.ok(harness.events.includes('map:destination:48.86:2.4'));
    assert.ok(!harness.events.includes('map:destination:48.86:2.39'));
});
