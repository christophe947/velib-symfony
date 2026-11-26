import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function importBrowserModule(path, replacements = []) {
    let source = await readFile(new URL(path, import.meta.url), 'utf8');

    for (const [search, replacement] of replacements) {
        source = source.replace(search, replacement);
    }

    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const [{ MultimodalRoutePlanner }, { findNearbyStations }, eligibility] =
    await Promise.all([
        importBrowserModule('../assets/maplibre/navigation/multimodalRoutePlanner.js'),
        importBrowserModule('../assets/maplibre/search/nearbyStations.js'),
        importBrowserModule('../assets/maplibre/shared/availability.js', [
            [
                "import { AVAILABILITY } from './constants.js';",
                'const AVAILABILITY = {};',
            ],
        ]),
    ]);

const place = (id, latitude, longitude, type = 'address') => ({
    id,
    type,
    label: id,
    latitude,
    longitude,
});

const pickup = (id, latitude, longitude, overrides = {}) => ({
    ...place(id, latitude, longitude, 'station'),
    isInstalled: true,
    isRenting: true,
    isReturning: true,
    bikes: 5,
    mechanicalBikes: 3,
    electricBikes: 2,
    docks: 5,
    ...overrides,
});

function makePlanner({
    stations,
    getRoute,
    getStationSnapshot = () => ({
        stations,
        fetchedAt: '2026-11-26T10:00:00Z',
        stale: false,
    }),
    candidateLimit = 3,
    maxConcurrentRoutes = 3,
} = {}) {
    return new MultimodalRoutePlanner({
        getStationSnapshot,
        findNearbyStations,
        getRoute,
        isStationEligibleForPickup: eligibility.isStationEligibleForPickup,
        isStationEligibleForDropoff: eligibility.isStationEligibleForDropoff,
        candidateLimit,
        maxConcurrentRoutes,
    });
}

function routeDouble(durationFor, { onCall } = {}) {
    return async (from, to, mode, { signal } = {}) => {
        onCall?.(from, to, mode);

        if (signal?.aborted) {
            throw signal.reason;
        }

        return {
            mode,
            origin: { ...from },
            destination: { ...to },
            geometry: [
                [from.longitude, from.latitude],
                [to.longitude, to.latitude],
            ],
            distance: durationFor(from, to, mode) / 1000,
            duration: durationFor(from, to, mode),
        };
    };
}

test('calcule et normalise marche → vélo → marche avec les unités des segments', async () => {
    const stations = [pickup('pickup-1', 0, 0.001), pickup('drop-1', 0, 0.999)];
    const origin = place('origin', 0, 0);
    const destination = place('destination', 0, 1);
    const planner = makePlanner({
        stations,
        getRoute: routeDouble((from, to, mode) =>
            mode === 'bicycle' ? 600 : from.id === 'origin' ? 120 : 180,
        ),
    });

    const result = await planner.calculate({ origin, destination });
    const [plan] = result.plans;

    assert.equal(result.reason, null);
    assert.deepEqual(plan.segments.map(({ mode }) => mode), [
        'pedestrian',
        'bicycle',
        'pedestrian',
    ]);
    assert.equal(plan.duration, 900);
    assert.ok(Math.abs(plan.distance - 0.9) < 1e-12);
    assert.equal(plan.walkingDuration, 300);
    assert.equal(plan.pickupStation.id, 'pickup-1');
    assert.equal(plan.dropoffStation.id, 'drop-1');
    assert.deepEqual(plan.availability, {
        fetchedAt: '2026-11-26T10:00:00Z',
        stale: false,
    });
});

test('déjà sur un Vélib : calcule vélo puis marche sans chercher de prise', async () => {
    const stations = [pickup('drop-1', 0, 0.999)];
    const calls = [];
    const planner = makePlanner({
        stations,
        getRoute: routeDouble(() => 250, {
            onCall: (_from, _to, mode) => calls.push(mode),
        }),
    });
    const result = await planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
        alreadyOnVelib: true,
    });

    assert.equal(result.plans.length, 1);
    assert.deepEqual(result.plans[0].segments.map(({ mode }) => mode), [
        'bicycle',
        'pedestrian',
    ]);
    assert.equal(result.plans[0].pickupStation, null);
    assert.deepEqual(calls.sort(), ['bicycle', 'pedestrian']);
});

test('un départ station éligible est inclus et évite la marche vers lui-même', async () => {
    const stations = [
        pickup('selected-pickup', 0, 0),
        pickup('nearby-pickup', 0, 0.001),
        pickup('dropoff', 0, 0.999),
    ];
    const calls = [];
    const planner = makePlanner({
        stations,
        getRoute: routeDouble(() => 100, {
            onCall: (from, to, mode) => calls.push({ from: from.id, to: to.id, mode }),
        }),
    });
    const result = await planner.calculate({
        origin: {
            ...place('selected-pickup', 0, 0, 'station'),
            stationId: 'selected-pickup',
        },
        destination: place('destination', 0, 1),
    });
    const selectedPlan = result.plans.find(
        (plan) => plan.pickupStation.id === 'selected-pickup',
    );

    assert.ok(selectedPlan);
    assert.equal(selectedPlan.segments[0].mode, 'bicycle');
    assert.equal(
        calls.some(
            (call) =>
                call.mode === 'pedestrian' &&
                call.from === 'selected-pickup' &&
                call.to === 'selected-pickup',
        ),
        false,
    );
});

test('une arrivée station éligible est incluse et omet la marche finale nulle', async () => {
    const stations = [
        pickup('pickup', 0, 0.001),
        pickup('selected-dropoff', 0, 1),
        pickup('nearby-dropoff', 0, 0.999),
    ];
    const calls = [];
    const planner = makePlanner({
        stations,
        getRoute: routeDouble(() => 100, {
            onCall: (from, to, mode) => calls.push({ from: from.id, to: to.id, mode }),
        }),
    });
    const result = await planner.calculate({
        origin: place('origin', 0, 0),
        destination: {
            ...place('selected-dropoff', 0, 1, 'station'),
            stationId: 'selected-dropoff',
        },
    });
    const selectedPlan = result.plans.find(
        (plan) => plan.dropoffStation.id === 'selected-dropoff',
    );

    assert.ok(selectedPlan);
    assert.equal(selectedPlan.segments.at(-1).mode, 'bicycle');
    assert.equal(
        calls.some(
            (call) =>
                call.mode === 'pedestrian' &&
                call.from === 'selected-dropoff' &&
                call.to === 'selected-dropoff',
        ),
        false,
    );
});

test('deux stations choisies éligibles forment un seul segment vélo sans géométrie artificielle', async () => {
    const stations = [pickup('start', 0, 0), pickup('end', 0, 1)];
    const calls = [];
    const planner = makePlanner({
        stations,
        getRoute: routeDouble(() => 600, {
            onCall: (from, to, mode) => calls.push({ from: from.id, to: to.id, mode }),
        }),
    });
    const result = await planner.calculate({
        origin: { ...place('start', 0, 0, 'station'), stationId: 'start' },
        destination: { ...place('end', 0, 1, 'station'), stationId: 'end' },
    });
    const [plan] = result.plans;

    assert.equal(result.plans.length, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { from: 'start', to: 'end', mode: 'bicycle' });
    assert.deepEqual(plan.segments.map(({ mode }) => mode), ['bicycle']);
    assert.equal(plan.distance, 0.6);
    assert.equal(plan.duration, 600);
    assert.deepEqual(plan.segments[0].origin, stations[0]);
    assert.deepEqual(plan.segments[0].destination, stations[1]);
    assert.ok(plan.segments.every((segment) => segment.geometry.length >= 2));
});

test('garde la durée totale prioritaire et favorise le choix explicite à durée égale', async () => {
    const stations = [
        pickup('selected-pickup', 0, 0),
        pickup('alternative-pickup', 0, 0.001),
        pickup('dropoff', 0, 0.999),
    ];
    let alternativeBikeDuration = 400;
    const planner = makePlanner({
        stations,
        getRoute: routeDouble((from, to, mode) => {
            if (mode === 'pedestrian') {
                return to.id === 'alternative-pickup' ? 100 : 0;
            }

            return from.id === 'selected-pickup' ? 500 : alternativeBikeDuration;
        }),
    });
    const result = await planner.calculate({
        origin: {
            ...place('selected-pickup', 0, 0, 'station'),
            stationId: 'selected-pickup',
        },
        destination: place('destination', 0, 1),
    });

    assert.equal(result.plans[0].duration, 500);
    assert.equal(result.plans[0].pickupStation.id, 'selected-pickup');
    assert.equal(result.plans[1].duration, 500);
    assert.equal(result.plans[1].pickupStation.id, 'alternative-pickup');

    alternativeBikeDuration = 300;
    const fasterAlternative = await planner.calculate({
        origin: {
            ...place('selected-pickup', 0, 0, 'station'),
            stationId: 'selected-pickup',
        },
        destination: place('destination', 0, 1),
    });

    assert.equal(fasterAlternative.plans[0].duration, 400);
    assert.equal(fasterAlternative.plans[0].pickupStation.id, 'alternative-pickup');
});

test('station de départ non éligible : propose des prises alternatives', async () => {
    const stations = [
        pickup('selected-closed', 0, 0, { isRenting: false }),
        pickup('alternative-pickup', 0, 0.001),
        pickup('dropoff', 0, 0.999),
    ];
    const planner = makePlanner({ stations, getRoute: routeDouble(() => 100) });
    const result = await planner.calculate({
        origin: {
            ...place('selected-closed', 0, 0, 'station'),
            stationId: 'selected-closed',
        },
        destination: place('destination', 0, 1),
    });

    assert.ok(result.plans.length > 0);
    assert.ok(result.plans.every((plan) => plan.pickupStation.id !== 'selected-closed'));
    assert.ok(result.plans.some((plan) => plan.pickupStation.id === 'alternative-pickup'));
});

test('station d’arrivée non éligible : propose des dépôts alternatifs', async () => {
    const stations = [
        pickup('pickup', 0, 0.001),
        pickup('selected-closed', 0, 1, { isReturning: false }),
        pickup('alternative-dropoff', 0, 0.999),
    ];
    const planner = makePlanner({ stations, getRoute: routeDouble(() => 100) });
    const result = await planner.calculate({
        origin: place('origin', 0, 0),
        destination: {
            ...place('selected-closed', 0, 1, 'station'),
            stationId: 'selected-closed',
        },
    });

    assert.ok(result.plans.length > 0);
    assert.ok(result.plans.every((plan) => plan.dropoffStation.id !== 'selected-closed'));
    assert.ok(result.plans.some((plan) => plan.dropoffStation.id === 'alternative-dropoff'));
});

test('départ station avec alreadyOnVelib ne crée jamais de station de prise', async () => {
    const stations = [
        pickup('selected-origin', 0, 0),
        pickup('nearby-pickup', 0, 0.001),
        pickup('dropoff', 0, 0.999),
    ];
    const calls = [];
    const planner = makePlanner({
        stations,
        getRoute: routeDouble(() => 100, {
            onCall: (from, to, mode) => calls.push({ from: from.id, to: to.id, mode }),
        }),
    });
    const result = await planner.calculate({
        origin: {
            ...place('selected-origin', 0, 0, 'station'),
            stationId: 'selected-origin',
        },
        destination: place('destination', 0, 1),
        alreadyOnVelib: true,
    });

    assert.ok(result.plans.length > 0);
    assert.ok(result.plans.every((plan) => plan.pickupStation === null));
    assert.ok(calls.every((call) => call.mode !== 'pedestrian' || call.from !== 'selected-origin'));
    assert.ok(calls.some((call) => call.mode === 'bicycle' && call.from === 'selected-origin'));
});

test('compare plusieurs combinaisons par durée totale, puis départage de façon stable', async () => {
    const stations = [
        pickup('p1', 0, 0.001, { bikes: 3 }),
        pickup('p2', 0, 0.002, { bikes: 8 }),
        pickup('d1', 0, 0.998, { docks: 4 }),
        pickup('d2', 0, 0.999, { docks: 7 }),
    ];
    const times = new Map([
        ['pedestrian:origin>p1', 100],
        ['pedestrian:origin>p2', 100],
        ['pedestrian:d1>destination', 100],
        ['pedestrian:d2>destination', 100],
        ['bicycle:p1>d1', 900],
        ['bicycle:p1>d2', 800],
        ['bicycle:p2>d1', 800],
        ['bicycle:p2>d2', 800],
    ]);
    const planner = makePlanner({
        stations,
        getRoute: routeDouble((from, to, mode) =>
            times.get(`${mode}:${from.id}>${to.id}`),
        ),
    });
    const result = await planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
    });

    assert.equal(result.plans.length, 4);
    assert.equal(result.plans[0].duration, 1000);
    assert.deepEqual(
        result.plans.map((plan) => `${plan.pickupStation.id}>${plan.dropoffStation.id}`),
        ['p2>d2', 'p2>d1', 'p1>d2', 'p1>d1'],
    );
});

test('les statuts GBFS inconnus et les stations non opérationnelles sont exclus', async () => {
    const stations = [
        pickup('unknown-pickup', 0, 0.001, { isRenting: null }),
        pickup('offline', 0, 0.002, { isInstalled: false }),
        pickup('unknown-dropoff', 0, 0.999, { isReturning: undefined }),
    ];
    const planner = makePlanner({ stations, getRoute: routeDouble(() => 1) });
    const result = await planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
    });

    assert.deepEqual(result.plans, []);
    assert.equal(result.reason, 'no-pickup-station');
});

test('signale séparément l’absence de prise et l’absence de dépôt', async () => {
    const origin = place('origin', 0, 0);
    const destination = place('destination', 0, 1);

    const noPickup = makePlanner({
        stations: [pickup('drop', 0, 0.999)],
        getRoute: routeDouble(() => 1),
    });
    const noDropoff = makePlanner({
        stations: [pickup('pickup', 0, 0.001, { isReturning: false })],
        getRoute: routeDouble(() => 1),
    });

    assert.equal((await noPickup.calculate({ origin, destination })).reason, 'no-pickup-station');
    assert.equal((await noDropoff.calculate({ origin, destination })).reason, 'no-dropoff-station');
});

test('une erreur Valhalla isolée n’empêche pas les autres combinaisons', async () => {
    const stations = [
        pickup('p1', 0, 0.001),
        pickup('p2', 0, 0.002),
        pickup('d1', 0, 0.998),
    ];
    const planner = makePlanner({
        stations,
        getRoute: async (from, to, mode) => {
            if (mode === 'bicycle' && from.id === 'p1') {
                throw new Error('temporary Valhalla error');
            }

            return routeDouble(() => 100)(from, to, mode);
        },
    });
    const result = await planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
    });

    assert.equal(result.plans.length, 1);
    assert.equal(result.plans[0].pickupStation.id, 'p2');
});

test('abandonne rapidement le calcul lorsque le signal est annulé', async () => {
    const controller = new AbortController();
    const planner = makePlanner({
        stations: [pickup('p1', 0, 0.001), pickup('d1', 0, 0.999)],
        getRoute: (_from, _to, _mode, { signal }) =>
            new Promise((_resolve, reject) => {
                signal.addEventListener(
                    'abort',
                    () => reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })),
                    { once: true },
                );
            }),
    });
    const calculation = planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
        signal: controller.signal,
    });

    controller.abort();

    await assert.rejects(calculation, { name: 'AbortError' });
});

test('ne dépasse pas la concurrence configurée', async () => {
    const stations = [
        pickup('p1', 0, 0.001),
        pickup('p2', 0, 0.002),
        pickup('p3', 0, 0.003),
        pickup('d1', 0, 0.997),
        pickup('d2', 0, 0.998),
        pickup('d3', 0, 0.999),
    ];
    let active = 0;
    let maximum = 0;
    const planner = makePlanner({
        stations,
        maxConcurrentRoutes: 2,
        getRoute: async (from, to, mode) => {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            active -= 1;

            return routeDouble(() => 10)(from, to, mode);
        },
    });

    await planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
    });

    assert.equal(maximum, 2);
});

test('limite le préclassement géographique et le nombre de combinaisons', async () => {
    const stations = [
        ...Array.from({ length: 5 }, (_, index) =>
            pickup(`p${index}`, 0, (index + 1) * 0.001),
        ),
        ...Array.from({ length: 5 }, (_, index) =>
            pickup(`d${index}`, 0, 1 - (index + 1) * 0.001),
        ),
    ];
    let calls = 0;
    const planner = makePlanner({
        stations,
        candidateLimit: 2,
        getRoute: routeDouble(() => 10, {
            onCall: () => {
                calls += 1;
            },
        }),
    });
    const result = await planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
    });

    assert.equal(result.plans.length, 4);
    assert.equal(calls, 8); // 2 accès à pied + 2 marches finales + 4 liaisons vélo.
});

test('renvoie no-complete-route si les routes échouent et ne fabrique pas de métadonnées', async () => {
    const planner = makePlanner({
        stations: [pickup('p1', 0, 0.001), pickup('d1', 0, 0.999)],
        getStationSnapshot: () => ({
            stations: [pickup('p1', 0, 0.001), pickup('d1', 0, 0.999)],
        }),
        getRoute: async () => {
            throw new Error('Valhalla unavailable');
        },
    });
    const result = await planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
    });

    assert.deepEqual(result.plans, []);
    assert.equal(result.reason, 'no-complete-route');
    assert.deepEqual(result.availability, { fetchedAt: null, stale: null });
});

test('capture le snapshot une fois et conserve ses métadonnées stale sur les plans', async () => {
    const stations = [pickup('p1', 0, 0.001), pickup('d1', 0, 0.999)];
    let currentSnapshot = {
        stations,
        fetchedAt: '2026-11-26T09:00:00Z',
        stale: true,
    };
    let snapshotReads = 0;
    let releaseFirstRoute;
    const firstRoute = new Promise((resolve) => {
        releaseFirstRoute = resolve;
    });
    let first = true;
    const planner = makePlanner({
        stations,
        getStationSnapshot: () => {
            snapshotReads += 1;

            return currentSnapshot;
        },
        getRoute: async (from, to, mode) => {
            if (first) {
                first = false;
                await firstRoute;
            }

            return routeDouble(() => 10)(from, to, mode);
        },
    });
    const calculation = planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
    });

    currentSnapshot = {
        stations: [],
        fetchedAt: '2026-11-26T10:00:00Z',
        stale: false,
    };
    releaseFirstRoute();
    const result = await calculation;

    assert.equal(snapshotReads, 1);
    assert.equal(result.plans.length, 1);
    assert.deepEqual(result.plans[0].availability, {
        fetchedAt: '2026-11-26T09:00:00Z',
        stale: true,
    });
});

test('ne modifie pas les objets station du snapshot', async () => {
    const stations = [pickup('p1', 0, 0.001), pickup('d1', 0, 0.999)];
    const before = structuredClone(stations);
    const planner = makePlanner({ stations, getRoute: routeDouble(() => 10) });

    await planner.calculate({
        origin: place('origin', 0, 0),
        destination: place('destination', 0, 1),
    });

    assert.deepEqual(stations, before);
});

test('rejette les places invalides et un signal déjà annulé', async () => {
    const planner = makePlanner({ stations: [], getRoute: routeDouble(() => 1) });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
        planner.calculate({ origin: { latitude: 91, longitude: 0 }, destination: place('d', 0, 0) }),
        TypeError,
    );
    await assert.rejects(
        planner.calculate({ origin: place('o', 0, 0), destination: place('d', 0, 0), signal: controller.signal }),
        { name: 'AbortError' },
    );
});
