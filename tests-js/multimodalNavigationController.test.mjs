import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(
    new URL(
        '../assets/maplibre/navigation/multimodalNavigationController.js',
        import.meta.url,
    ),
    'utf8',
);
const { MultimodalNavigationController } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function station(id, longitude) {
    return { id, name: `Station ${id}`, longitude, latitude: 48.86, bikes: 4, docks: 3 };
}

function segment(mode, destination, transfer) {
    return {
        mode,
        origin: { longitude: destination.longitude - 0.002, latitude: destination.latitude },
        destination: { ...destination },
        geometry: [
            [destination.longitude - 0.002, destination.latitude],
            [destination.longitude, destination.latitude],
        ],
        distance: 1,
        duration: 300,
        ...(transfer ? { transfer } : {}),
    };
}

function threeSegmentPlan() {
    const pickup = station('pickup-1', 2.35);
    const dropoff = station('dropoff-1', 2.37);
    return {
        id: 'three-segments',
        alreadyOnVelib: false,
        pickupStation: pickup,
        dropoffStation: dropoff,
        origin: { longitude: 2.34, latitude: 48.86 },
        destination: { longitude: 2.38, latitude: 48.86, label: 'Destination' },
        segments: [
            segment('pedestrian', pickup, { type: 'pickup', stationId: pickup.id }),
            segment('bicycle', dropoff, { type: 'dropoff', stationId: dropoff.id }),
            segment('pedestrian', { longitude: 2.38, latitude: 48.86, label: 'Destination' }),
        ],
    };
}

function createHarness({ activateResults = [], activationGate = null } = {}) {
    const progressListeners = new Set();
    const routeRecalculationListeners = new Set();
    const sessionEvents = [];
    const events = [];
    let active = false;
    let routeGeneration = 0;
    let mode = null;
    let activationIndex = 0;
    const navigationEngine = {
        getRouteGeneration: () => routeGeneration,
        subscribeToProgress(listener) {
            progressListeners.add(listener);
            return () => progressListeners.delete(listener);
        },
        subscribeToRouteRecalculation(listener) {
            routeRecalculationListeners.add(listener);
            return () => routeRecalculationListeners.delete(listener);
        },
    };
    const navigationSession = {
        isActive: () => active,
        async start({ route }) {
            sessionEvents.push({ type: 'start', route });
            active = true;
            mode = route.segments[0].mode;
            routeGeneration++;
            return true;
        },
        async activateSegment(nextSegment, { isCurrent } = {}) {
            const index = activationIndex++;
            sessionEvents.push({ type: 'activate', segment: nextSegment });
            if (activationGate) {
                await activationGate.promise;
            }

            const result = activateResults[index] ?? true;
            if (!isCurrent?.() || !active || !result) {
                return false;
            }

            mode = nextSegment.mode;
            routeGeneration++;
            return true;
        },
        stop() {
            sessionEvents.push({ type: 'stop' });
            active = false;
            routeGeneration++;
            return true;
        },
    };
    const controller = new MultimodalNavigationController({
        navigationSession,
        navigationEngine,
    });
    controller.subscribe((event) => events.push(event));

    return {
        controller,
        events,
        sessionEvents,
        navigationEngine,
        publishProgress({
            segment: activeSegment,
            distanceRemaining = 20,
            timestamp = Date.now(),
            accuracy = 5,
            generation = routeGeneration,
            eventMode = activeSegment.mode,
        }) {
            const event = {
                position: {
                    longitude: activeSegment.destination.longitude,
                    latitude: activeSegment.destination.latitude,
                    timestamp,
                    accuracy,
                },
                destination: {
                    latitude: activeSegment.destination.latitude,
                    longitude: activeSegment.destination.longitude,
                },
                distanceRemaining,
                mode: eventMode,
                routeGeneration: generation,
            };
            for (const listener of [...progressListeners]) {
                listener(event);
            }
        },
        publishRouteRecalculation({
            previousRouteGeneration = routeGeneration,
            generation = routeGeneration + 1,
            segment: activeSegment,
        }) {
            routeGeneration = generation;
            const event = {
                sessionId: 1,
                previousRouteGeneration,
                routeGeneration: generation,
                mode: activeSegment.mode,
                destination: { ...activeSegment.destination },
            };
            for (const listener of [...routeRecalculationListeners]) {
                listener(event);
            }
        },
        progressListenerCount: () => progressListeners.size,
        routeRecalculationListenerCount: () => routeRecalculationListeners.size,
        currentMode: () => mode,
    };
}

async function emitArrival(harness, activeSegment, startTimestamp = Date.now() - 1400) {
    for (let index = 0; index < 3; index++) {
        harness.publishProgress({
            segment: activeSegment,
            timestamp: startTimestamp + index * 600,
        });
    }
}

test('starts one-, two-, and three-segment plans using the real segment order', async () => {
    const oneSegment = createHarness();
    const dropoff = station('d1', 2.37);
    const singlePlan = {
        id: 'bike-only',
        alreadyOnVelib: true,
        dropoffStation: dropoff,
        segments: [segment('bicycle', dropoff, { type: 'dropoff', stationId: 'd1' })],
    };
    assert.equal(await oneSegment.controller.start(singlePlan), true);
    assert.equal(oneSegment.controller.getState().segmentCount, 1);
    assert.equal(oneSegment.currentMode(), 'bicycle');

    const twoSegment = createHarness();
    const twoPlan = {
        id: 'bike-walk',
        alreadyOnVelib: true,
        dropoffStation: dropoff,
        segments: [
            segment('bicycle', dropoff, { type: 'dropoff', stationId: 'd1' }),
            segment('pedestrian', { longitude: 2.38, latitude: 48.86 }),
        ],
    };
    assert.equal(await twoSegment.controller.start(twoPlan), true);
    assert.equal(twoSegment.controller.getState().segmentCount, 2);

    const threeSegment = createHarness();
    assert.equal(await threeSegment.controller.start(threeSegmentPlan()), true);
    assert.equal(threeSegment.controller.getState().segmentCount, 3);
});

test('walk → bicycle → walk requires explicit pickup and dropoff confirmations', async () => {
    const harness = createHarness();
    const plan = threeSegmentPlan();
    await harness.controller.start(plan);

    await emitArrival(harness, plan.segments[0]);
    assert.equal(harness.controller.getState().phase, 'awaiting-pickup-confirmation');
    assert.equal(harness.sessionEvents.filter((event) => event.type === 'activate').length, 0);
    assert.equal(harness.events.some((event) => event.type === 'pickup-confirmed'), false);

    assert.equal(await harness.controller.confirmPickup(), true);
    assert.equal(harness.controller.getState().segmentIndex, 1);
    assert.equal(harness.currentMode(), 'bicycle');

    await emitArrival(harness, plan.segments[1]);
    assert.equal(harness.controller.getState().phase, 'awaiting-dropoff-confirmation');
    assert.equal(harness.controller.getState().segmentIndex, 1);
    assert.equal(await harness.controller.confirmDropoff(), true);
    assert.equal(harness.controller.getState().segmentIndex, 2);
    assert.equal(harness.currentMode(), 'pedestrian');

    await emitArrival(harness, plan.segments[2]);
    assert.equal(harness.controller.getState().phase, 'completed');
    assert.equal(harness.events.filter((event) => event.type === 'destination-reached').length, 1);
    assert.equal(harness.sessionEvents.filter((event) => event.type === 'stop').length, 1);
});

test('an omitted pickup walking leg still requires pickup confirmation at a selected origin station', async () => {
    const harness = createHarness();
    const pickup = station('origin-station', 2.35);
    const dropoff = station('dropoff-station', 2.37);
    const plan = {
        id: 'station-origin',
        alreadyOnVelib: false,
        pickupStation: pickup,
        dropoffStation: dropoff,
        segments: [
            segment('bicycle', dropoff, {
                type: 'dropoff',
                stationId: dropoff.id,
            }),
        ],
    };

    assert.equal(await harness.controller.start(plan), true);
    assert.equal(harness.sessionEvents.length, 0);
    assert.equal(harness.controller.getState().phase, 'awaiting-pickup-confirmation');
    assert.equal(harness.events[0].type, 'pickup-reached');
    assert.equal(harness.events[0].stationId, pickup.id);

    assert.equal(await harness.controller.confirmPickup(), true);
    assert.equal(harness.sessionEvents[0].type, 'start');
    assert.equal(harness.currentMode(), 'bicycle');
});

test('a final bicycle segment waits for deposit confirmation before completing', async () => {
    const harness = createHarness();
    const dropoff = station('last-stop', 2.37);
    const plan = {
        id: 'final-bike',
        alreadyOnVelib: true,
        dropoffStation: dropoff,
        segments: [
            segment('bicycle', dropoff, { type: 'dropoff', stationId: dropoff.id }),
        ],
    };
    await harness.controller.start(plan);
    await emitArrival(harness, plan.segments[0]);

    assert.equal(harness.controller.getState().phase, 'awaiting-dropoff-confirmation');
    assert.equal(harness.controller.getState().segmentIndex, 0);
    assert.equal(harness.events.some((event) => event.type === 'destination-reached'), false);
    assert.equal(await harness.controller.confirmDropoff(), true);
    assert.equal(harness.controller.getState().phase, 'completed');
    assert.equal(harness.events.at(-2).type, 'dropoff-confirmed');
    assert.equal(harness.events.at(-1).type, 'destination-reached');
});

test('a final segment without a transfer emits destination-reached and stops the session', async () => {
    const harness = createHarness();
    const destination = { longitude: 2.38, latitude: 48.86, label: 'Finish' };
    const plan = {
        id: 'direct-final-leg',
        alreadyOnVelib: true,
        segments: [segment('bicycle', destination)],
    };
    await harness.controller.start(plan);
    await emitArrival(harness, plan.segments[0]);

    assert.equal(harness.controller.getState().phase, 'completed');
    assert.equal(harness.events.at(-1).type, 'destination-reached');
    assert.equal(harness.events.at(-1).source, 'gps');
    assert.equal(harness.sessionEvents.at(-1).type, 'stop');
});

test('manual milestone reporting is available without confirming a transfer', async () => {
    const harness = createHarness();
    const plan = threeSegmentPlan();
    await harness.controller.start(plan);

    assert.equal(harness.controller.reportMilestoneReached(), true);
    assert.equal(harness.controller.getState().phase, 'awaiting-pickup-confirmation');
    assert.equal(harness.events.at(-1).type, 'pickup-reached');
    assert.equal(harness.events.at(-1).source, 'manual');
    assert.equal(harness.events.some((event) => event.type === 'pickup-confirmed'), false);
});

test('GPS oscillation resets arrival evidence and requires distinct stable samples', async () => {
    const harness = createHarness();
    const plan = threeSegmentPlan();
    await harness.controller.start(plan);
    const segmentValue = plan.segments[0];
    const start = Date.now() - 2500;

    for (const [index, distanceRemaining] of [30, 36, 30, 30].entries()) {
        harness.publishProgress({
            segment: segmentValue,
            distanceRemaining,
            timestamp: start + index * 600,
        });
    }
    assert.equal(harness.controller.getState().phase, 'navigating');

    harness.publishProgress({
        segment: segmentValue,
        distanceRemaining: 30,
        timestamp: start + 2400,
    });
    assert.equal(harness.controller.getState().phase, 'awaiting-pickup-confirmation');
});

test('stale route generations and poor fixes cannot trigger a milestone', async () => {
    const harness = createHarness();
    const plan = threeSegmentPlan();
    await harness.controller.start(plan);
    const currentGeneration = harness.navigationEngine.getRouteGeneration();

    harness.publishProgress({
        segment: plan.segments[0],
        generation: currentGeneration - 1,
        timestamp: Date.now(),
    });
    harness.publishProgress({
        segment: plan.segments[0],
        accuracy: 80,
        timestamp: Date.now(),
    });
    assert.equal(harness.controller.getState().phase, 'navigating');
});

test('a confirmed segment accepts only its explicit recalculation generation', async () => {
    const harness = createHarness();
    const plan = threeSegmentPlan();
    await harness.controller.start(plan);
    await emitArrival(harness, plan.segments[0]);
    await harness.controller.confirmPickup();

    const activeSegment = plan.segments[1];
    const oldGeneration = harness.navigationEngine.getRouteGeneration();
    harness.publishRouteRecalculation({
        previousRouteGeneration: oldGeneration - 1,
        generation: oldGeneration + 1,
        segment: activeSegment,
    });
    assert.equal(harness.controller.getState().phase, 'navigating');
    assert.equal(
        harness.events.some((event) => event.type === 'segment-route-recalculated'),
        false,
    );

    harness.publishRouteRecalculation({
        previousRouteGeneration: oldGeneration,
        generation: oldGeneration + 1,
        segment: activeSegment,
    });
    assert.equal(harness.events.at(-1).type, 'segment-route-recalculated');
    assert.equal(harness.events.at(-1).routeGeneration, oldGeneration + 1);
    await emitArrival(harness, activeSegment);
    assert.equal(harness.controller.getState().phase, 'awaiting-dropoff-confirmation');
});

test('stop during a pending segment activation invalidates its late result', async () => {
    const activationGate = deferred();
    const harness = createHarness({ activationGate });
    const plan = threeSegmentPlan();
    await harness.controller.start(plan);
    await emitArrival(harness, plan.segments[0]);

    const confirmation = harness.controller.confirmPickup();
    assert.equal(harness.controller.getState().phase, 'transitioning');
    harness.controller.stop();
    activationGate.resolve();

    assert.equal(await confirmation, false);
    assert.equal(harness.controller.getState().phase, 'stopped');
    assert.equal(harness.controller.getState().segmentIndex, 0);
    assert.equal(harness.progressListenerCount(), 0);
    assert.equal(harness.routeRecalculationListenerCount(), 0);
});

test('a failed segment activation keeps the old index and can be retried', async () => {
    const harness = createHarness({ activateResults: [false, true] });
    const plan = threeSegmentPlan();
    await harness.controller.start(plan);
    await emitArrival(harness, plan.segments[0]);

    assert.equal(await harness.controller.confirmPickup(), false);
    assert.equal(harness.controller.getState().phase, 'transition-error');
    assert.equal(harness.controller.getState().segmentIndex, 0);
    assert.equal(harness.events.some((event) => event.type === 'pickup-confirmed'), true);
    assert.equal(harness.events.at(-1).type, 'transition-failed');

    assert.equal(await harness.controller.retryTransition(), true);
    assert.equal(harness.controller.getState().segmentIndex, 1);
    assert.equal(harness.controller.getState().phase, 'navigating');
});

test('duplicate confirmations do not launch duplicate segment transitions', async () => {
    const activationGate = deferred();
    const harness = createHarness({ activationGate });
    const plan = threeSegmentPlan();
    await harness.controller.start(plan);
    await emitArrival(harness, plan.segments[0]);

    const first = harness.controller.confirmPickup();
    assert.equal(await harness.controller.confirmPickup(), false);
    assert.equal(harness.sessionEvents.filter((event) => event.type === 'activate').length, 1);
    activationGate.resolve();
    assert.equal(await first, true);
    assert.equal(harness.controller.getState().segmentIndex, 1);
});
