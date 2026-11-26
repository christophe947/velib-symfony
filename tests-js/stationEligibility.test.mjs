import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// The app's browser modules are ES modules, while package.json marks .js as
// CommonJS for Node. Load this module as a data URL and retain its pure rules.
const source = await readFile(
    new URL('../assets/maplibre/shared/availability.js', import.meta.url),
    'utf8',
);
const moduleSource = source.replace(
    "import { AVAILABILITY } from './constants.js';",
    'const AVAILABILITY = {};',
);
const {
    isStationEligibleForPickup,
    isStationEligibleForDropoff,
} = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

const pickupStation = (overrides = {}) => ({
    isInstalled: true,
    isRenting: true,
    bikes: 4,
    mechanicalBikes: 2,
    electricBikes: 2,
    ...overrides,
});

const dropoffStation = (overrides = {}) => ({
    isInstalled: true,
    isReturning: true,
    docks: 4,
    ...overrides,
});

test('pickup requires installed, renting station and positive total bikes', () => {
    assert.equal(isStationEligibleForPickup(pickupStation()), true);
    assert.equal(isStationEligibleForPickup(pickupStation({ bikes: 0 })), false);
    assert.equal(isStationEligibleForPickup(pickupStation({ isRenting: false })), false);
    assert.equal(isStationEligibleForPickup(pickupStation({ isInstalled: false })), false);
});

test('pickup rejects unknown statuses and invalid or missing bike counts', () => {
    for (const status of [null, undefined, 1, 'true']) {
        assert.equal(
            isStationEligibleForPickup(pickupStation({ isInstalled: status })),
            false,
        );
        assert.equal(
            isStationEligibleForPickup(pickupStation({ isRenting: status })),
            false,
        );
    }

    for (const bikes of [undefined, null, '3', NaN, Infinity, -1, 0]) {
        assert.equal(isStationEligibleForPickup(pickupStation({ bikes })), false);
    }
});

test('mechanical-only and electric-only inventory remains eligible for pickup', () => {
    assert.equal(
        isStationEligibleForPickup(
            pickupStation({ bikes: 3, mechanicalBikes: 3, electricBikes: 0 }),
        ),
        true,
    );
    assert.equal(
        isStationEligibleForPickup(
            pickupStation({ bikes: 2, mechanicalBikes: 0, electricBikes: 2 }),
        ),
        true,
    );
});

test('dropoff requires installed, returning station and positive docks', () => {
    assert.equal(isStationEligibleForDropoff(dropoffStation()), true);
    assert.equal(isStationEligibleForDropoff(dropoffStation({ docks: 0 })), false);
    assert.equal(isStationEligibleForDropoff(dropoffStation({ isReturning: false })), false);
    assert.equal(isStationEligibleForDropoff(dropoffStation({ isInstalled: false })), false);
});

test('dropoff rejects unknown statuses and invalid or missing dock counts', () => {
    for (const status of [null, undefined, 1, 'true']) {
        assert.equal(
            isStationEligibleForDropoff(dropoffStation({ isInstalled: status })),
            false,
        );
        assert.equal(
            isStationEligibleForDropoff(dropoffStation({ isReturning: status })),
            false,
        );
    }

    for (const docks of [undefined, null, '3', NaN, Infinity, -1, 0]) {
        assert.equal(isStationEligibleForDropoff(dropoffStation({ docks })), false);
    }
});

test('legacy availability labels do not override GBFS operational statuses', () => {
    assert.equal(
        isStationEligibleForPickup(
            pickupStation({ isRenting: false, rentalStatus: 'Disponible' }),
        ),
        false,
    );
    assert.equal(
        isStationEligibleForDropoff(
            dropoffStation({ isReturning: false, returnStatus: 'Places disponibles' }),
        ),
        false,
    );
});

test('eligibility checks do not mutate station records or detailed bike counts', () => {
    const station = Object.freeze(pickupStation());
    const before = { ...station };

    assert.equal(isStationEligibleForPickup(station), true);
    assert.deepEqual(station, before);
    assert.equal(station.mechanicalBikes, 2);
    assert.equal(station.electricBikes, 2);
});
