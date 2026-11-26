import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const sourceRoot = new URL('../assets/maplibre/', import.meta.url);
const moduleDirectory = await mkdtemp(join(tmpdir(), 'velib-navigation-test-'));

await writeFile(join(moduleDirectory, 'package.json'), '{"type":"module"}');
await mkdir(join(moduleDirectory, 'navigation'), { recursive: true });
await mkdir(join(moduleDirectory, 'geography'), { recursive: true });
await Promise.all([
    cp(new URL('navigation/navigation.js', sourceRoot), join(moduleDirectory, 'navigation/navigation.js')),
    cp(new URL('navigation/routing.js', sourceRoot), join(moduleDirectory, 'navigation/routing.js')),
    cp(new URL('navigation/routeFormatting.js', sourceRoot), join(moduleDirectory, 'navigation/routeFormatting.js')),
    cp(new URL('geography/geometry.js', sourceRoot), join(moduleDirectory, 'geography/geometry.js')),
]);

const { createNavigationEngine } = await import(
    `${pathToFileURL(join(moduleDirectory, 'navigation/navigation.js')).href}?test=${Date.now()}`
);
const controllerSource = await readFile(
    new URL('../assets/maplibre/navigation/multimodalNavigationController.js', import.meta.url),
    'utf8',
);
const { MultimodalNavigationController } = await import(
    `data:text/javascript;base64,${Buffer.from(controllerSource).toString('base64')}`
);

function createEngine(onProgress = null) {
    const effects = {
        updateNavigationPosition() {},
        updateWalkingRoute() {},
        updateRouteSummary() {},
    };

    if (onProgress) {
        effects.onProgress = onProgress;
    }

    return createNavigationEngine(effects);
}

function routeCoordinates(startLongitude = 0, endLongitude = 0.001) {
    return [
        [startLongitude, 0],
        [endLongitude, 0],
    ];
}

function gpsPosition(longitude, timestamp = Date.now(), accuracy = 5) {
    return { longitude, latitude: 0, timestamp, accuracy, speed: 2 };
}

function encodePolyline(coordinates) {
    let previousLatitude = 0;
    let previousLongitude = 0;
    let encoded = '';

    const encodeValue = (value) => {
        let remaining = value < 0 ? ~(value << 1) : value << 1;
        let result = '';

        while (remaining >= 0x20) {
            result += String.fromCharCode((0x20 | (remaining & 0x1f)) + 63);
            remaining >>= 5;
        }

        return result + String.fromCharCode(remaining + 63);
    };

    for (const [longitude, latitude] of coordinates) {
        const scaledLatitude = Math.round(latitude * 1e6);
        const scaledLongitude = Math.round(longitude * 1e6);
        encoded += encodeValue(scaledLatitude - previousLatitude);
        encoded += encodeValue(scaledLongitude - previousLongitude);
        previousLatitude = scaledLatitude;
        previousLongitude = scaledLongitude;
    }

    return encoded;
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

test.after(async () => {
    await rm(moduleDirectory, { recursive: true, force: true });
});

test('publishes a detached event only after accepting route progress', () => {
    const events = [];
    const engine = createEngine((event) => events.push(event));
    const destination = { longitude: 0.001, latitude: 0, stationId: 'destination' };
    engine.setNavigationRoute(routeCoordinates(), destination, 'bicycle');

    const acceptedPosition = gpsPosition(0.0005);
    engine.updateNavigationProgress(acceptedPosition);

    assert.equal(events.length, 1);
    assert.deepEqual(events[0].position, acceptedPosition);
    assert.deepEqual(events[0].destination, destination);
    assert.equal(events[0].mode, 'bicycle');
    assert.ok(events[0].distanceRemaining > 45 && events[0].distanceRemaining < 65);
    assert.equal(events[0].routeGeneration, 1);

    acceptedPosition.longitude = 42;
    destination.stationId = 'mutated';
    assert.equal(events[0].position.longitude, 0.0005);
    assert.equal(events[0].destination.stationId, 'destination');
});

test('does not publish rejected stale or off-route GPS fixes', () => {
    const events = [];
    const engine = createEngine((event) => events.push(event));
    engine.setNavigationRoute(routeCoordinates(), { longitude: 0.001, latitude: 0 });

    engine.updateNavigationProgress(gpsPosition(0.0005, Date.now() - 11_000));
    engine.updateNavigationProgress(gpsPosition(0.0005, Date.now(), 5));
    engine.updateNavigationProgress(gpsPosition(0.01, Date.now() + 1));

    assert.equal(events.length, 1);
    assert.equal(events[0].position.longitude, 0.0005);
});

test('route replacement advances the event generation and old timestamps emit nothing', () => {
    const events = [];
    const engine = createEngine((event) => events.push(event));
    const destinationA = { longitude: 0.001, latitude: 0 };
    engine.setNavigationRoute(routeCoordinates(), destinationA, 'pedestrian');
    engine.updateNavigationProgress(gpsPosition(0.0003));
    const oldGeneration = events[0].routeGeneration;

    const replacementId = engine.beginRouteReplacement();
    assert.ok(replacementId !== null);
    assert.equal(
        engine.commitRouteReplacement(
            replacementId,
            routeCoordinates(0.001, 0.002),
            { longitude: 0.002, latitude: 0 },
            'bicycle',
        ),
        true,
    );
    engine.updateNavigationProgress(gpsPosition(0.0015, Date.now() - 11_000));
    assert.equal(events.length, 1);

    engine.updateNavigationProgress(gpsPosition(0.0015));
    assert.equal(events.length, 2);
    assert.equal(events[1].mode, 'bicycle');
    assert.deepEqual(events[1].destination, { longitude: 0.002, latitude: 0 });
    assert.ok(events[1].routeGeneration > oldGeneration);
});

test('stop invalidates later callbacks and observers cannot break the engine', (t) => {
    const originalConsoleError = console.error;
    console.error = () => {};
    t.after(() => {
        console.error = originalConsoleError;
    });

    const events = [];
    const engine = createEngine((event) => events.push(event));
    engine.setNavigationRoute(routeCoordinates(), { longitude: 0.001, latitude: 0 });
    engine.stopNavigationProcessing();
    engine.updateNavigationProgress(gpsPosition(0.0005));
    assert.equal(events.length, 0);

    const resilientEngine = createEngine(() => {
        throw new Error('observer failure');
    });
    resilientEngine.setNavigationRoute(routeCoordinates(), {
        longitude: 0.001,
        latitude: 0,
    });
    assert.doesNotThrow(() =>
        resilientEngine.updateNavigationProgress(gpsPosition(0.0005)),
    );
});

test('recalculation retains the event contract for the newly installed route', async (t) => {
    const originalFetch = globalThis.fetch;
    const events = [];
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
            trip: {
                legs: [{
                    shape: encodePolyline([
                        [0.01, 0],
                        [0.02, 0],
                    ]),
                }],
                summary: { length: 1, time: 300 },
            },
        }),
    });
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const engine = createEngine((event) => events.push(event));
    const routeEvents = [];
    engine.subscribeToRouteRecalculation((event) => routeEvents.push(event));
    engine.setNavigationRoute(routeCoordinates(), {
        longitude: 0.001,
        latitude: 0,
    });

    const firstTime = Date.now() - 2200;
    engine.updateNavigationProgress(gpsPosition(0.0002, firstTime));
    engine.updateNavigationProgress(gpsPosition(0.01, firstTime + 550));
    engine.updateNavigationProgress(gpsPosition(0.01, firstTime + 1100));
    engine.updateNavigationProgress(gpsPosition(0.01, firstTime + 1650));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const generationBeforeRecalculation = events[0].routeGeneration;
    engine.updateNavigationProgress(gpsPosition(0.0105, Date.now()));

    assert.equal(events.at(-1).mode, 'pedestrian');
    assert.ok(events.at(-1).routeGeneration > generationBeforeRecalculation);
    assert.deepEqual(events.at(-1).destination, {
        longitude: 0.001,
        latitude: 0,
    });
    assert.equal(routeEvents.length, 1);
    assert.equal(routeEvents[0].previousRouteGeneration, 1);
    assert.equal(routeEvents[0].routeGeneration, 2);
    assert.equal(routeEvents[0].mode, 'pedestrian');
    assert.deepEqual(routeEvents[0].destination, {
        longitude: 0.001,
        latitude: 0,
    });
});

test('a delayed recalculation cannot replace a newer installed route', async (t) => {
    const originalFetch = globalThis.fetch;
    const routeResponse = deferred();
    const events = [];
    const routeEvents = [];
    globalThis.fetch = () => routeResponse.promise;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const engine = createEngine((event) => events.push(event));
    engine.subscribeToRouteRecalculation((event) => routeEvents.push(event));
    engine.setNavigationRoute(routeCoordinates(), {
        longitude: 0.001,
        latitude: 0,
    });
    const baseTimestamp = Date.now() - 2200;
    engine.updateNavigationProgress(gpsPosition(0.0002, baseTimestamp));
    engine.updateNavigationProgress(gpsPosition(0.01, baseTimestamp + 550));
    engine.updateNavigationProgress(gpsPosition(0.01, baseTimestamp + 1100));
    engine.updateNavigationProgress(gpsPosition(0.01, baseTimestamp + 1650));

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(routeEvents.length, 0);
    engine.setNavigationRoute(
        routeCoordinates(0.1, 0.101),
        { longitude: 0.101, latitude: 0, label: 'new route' },
        'bicycle',
    );

    routeResponse.resolve({
        ok: true,
        json: async () => ({
            trip: {
                legs: [{ shape: encodePolyline([[0.01, 0], [0.02, 0]]) }],
                summary: { length: 1, time: 300 },
            },
        }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(routeEvents.length, 0);
    engine.updateNavigationProgress(gpsPosition(0.1005));
    assert.equal(events.at(-1).mode, 'bicycle');
    assert.equal(events.at(-1).destination.label, 'new route');
    assert.equal(events.at(-1).routeGeneration, 2);
});

test('progress subscriptions are removable and receive the same accepted event contract', () => {
    const engine = createEngine();
    const events = [];
    const unsubscribe = engine.subscribeToProgress((event) => events.push(event));
    const destination = { longitude: 0.001, latitude: 0 };
    engine.setNavigationRoute(routeCoordinates(), destination, 'pedestrian');
    assert.equal(engine.getRouteGeneration(), 1);

    engine.updateNavigationProgress(gpsPosition(0.0005));
    assert.equal(events.length, 1);
    assert.equal(events[0].mode, 'pedestrian');
    assert.equal(events[0].routeGeneration, engine.getRouteGeneration());
    assert.deepEqual(events[0].destination, destination);

    unsubscribe();
    engine.updateNavigationProgress(gpsPosition(0.0006));
    assert.equal(events.length, 1);
});

test('failed recalculation emits no route-generation event and keeps the active generation', async (t) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const progressEvents = [];
    const routeEvents = [];
    const engine = createEngine((event) => progressEvents.push(event));
    engine.subscribeToRouteRecalculation((event) => routeEvents.push(event));
    engine.setNavigationRoute(routeCoordinates(), { longitude: 0.001, latitude: 0 });
    const baseTimestamp = Date.now() - 2200;
    engine.updateNavigationProgress(gpsPosition(0.0002, baseTimestamp));
    for (let index = 1; index <= 3; index++) {
        engine.updateNavigationProgress(
            gpsPosition(0.01, baseTimestamp + index * 550),
        );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(engine.getRouteGeneration(), 1);
    assert.equal(routeEvents.length, 0);
    engine.updateNavigationProgress(gpsPosition(0.0005, Date.now()));
    assert.equal(progressEvents.at(-1).routeGeneration, 1);
});

test('stopping while Valhalla is pending suppresses the recalculation event', async (t) => {
    const originalFetch = globalThis.fetch;
    const routeResponse = deferred();
    globalThis.fetch = () => routeResponse.promise;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const routeEvents = [];
    const engine = createEngine();
    engine.subscribeToRouteRecalculation((event) => routeEvents.push(event));
    engine.setNavigationRoute(routeCoordinates(), { longitude: 0.001, latitude: 0 });
    const baseTimestamp = Date.now() - 2200;
    engine.updateNavigationProgress(gpsPosition(0.0002, baseTimestamp));
    for (let index = 1; index <= 3; index++) {
        engine.updateNavigationProgress(
            gpsPosition(0.01, baseTimestamp + index * 550),
        );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    engine.stopNavigationProcessing();
    routeResponse.resolve({
        ok: true,
        json: async () => ({
            trip: {
                legs: [{ shape: encodePolyline([[0.01, 0], [0.02, 0]]) }],
                summary: { length: 1, time: 300 },
            },
        }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(routeEvents.length, 0);
    assert.equal(engine.getNavigationMode(), null);
});

test('multimodal arrival detection resumes on the real engine after successful recalculation', async (t) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
            trip: {
                legs: [{ shape: encodePolyline([[0.01, 0], [0.0101, 0]]) }],
                summary: { length: 0.011, time: 10 },
            },
        }),
    });
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const engine = createEngine();
    let active = false;
    let controllerProgressListener = null;
    const engineFacade = {
        getRouteGeneration: () => engine.getRouteGeneration(),
        subscribeToProgress(listener) {
            controllerProgressListener = listener;
            return engine.subscribeToProgress(listener);
        },
        subscribeToRouteRecalculation: (listener) =>
            engine.subscribeToRouteRecalculation(listener),
    };
    const navigationSession = {
        isActive: () => active,
        async start({ route }) {
            const segment = route.segments[0];
            active = true;
            engine.setNavigationRoute(
                segment.geometry,
                segment.destination,
                segment.mode,
            );
            return true;
        },
        async activateSegment(segment) {
            engine.setNavigationRoute(
                segment.geometry,
                segment.destination,
                segment.mode,
            );
            return true;
        },
        stop() {
            active = false;
            engine.stopNavigationProcessing();
            return true;
        },
    };
    const controller = new MultimodalNavigationController({
        navigationSession,
        navigationEngine: engineFacade,
    });
    const controllerEvents = [];
    controller.subscribe((event) => controllerEvents.push(event));
    const station = { id: 'destination', longitude: 0.0101, latitude: 0 };
    const plan = {
        id: 'recalculated-dropoff',
        alreadyOnVelib: true,
        dropoffStation: station,
        segments: [{
            mode: 'bicycle',
            origin: { longitude: 0, latitude: 0 },
            destination: station,
            geometry: routeCoordinates(),
            transfer: { type: 'dropoff', stationId: station.id },
        }],
    };

    assert.equal(await controller.start(plan), true);
    const initialGeneration = engine.getRouteGeneration();
    const initialTimestamp = Date.now() - 2200;
    engine.updateNavigationProgress(gpsPosition(0.0005, initialTimestamp));
    assert.equal(controller.getState().phase, 'navigating');

    for (let index = 1; index <= 3; index++) {
        engine.updateNavigationProgress(
            gpsPosition(0.01, initialTimestamp + index * 550),
        );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(engine.getRouteGeneration(), initialGeneration + 1);
    assert.equal(
        controllerEvents.filter((event) => event.type === 'segment-route-recalculated').length,
        1,
    );

    controllerProgressListener({
        position: gpsPosition(0.01002),
        destination: station,
        distanceRemaining: 0,
        mode: 'bicycle',
        routeGeneration: initialGeneration,
    });
    assert.equal(controller.getState().phase, 'navigating');

    const arrivalTimestamp = Date.now() - 1800;
    for (let index = 0; index < 3; index++) {
        engine.updateNavigationProgress(
            gpsPosition(0.01002 + index * 0.00002, arrivalTimestamp + index * 600),
        );
    }

    assert.equal(controller.getState().phase, 'awaiting-dropoff-confirmation');
    assert.equal(controllerEvents.at(-1).type, 'dropoff-reached');
    assert.equal(await controller.confirmDropoff(), true);
    assert.equal(controller.getState().phase, 'completed');
});
