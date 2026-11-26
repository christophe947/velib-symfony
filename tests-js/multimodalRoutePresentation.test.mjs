import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const mapSource = await readFile(
    new URL('../assets/maplibre/map.js', import.meta.url),
    'utf8',
);
const functionStart = mapSource.indexOf('export async function presentRoute(');
const functionEnd = mapSource.indexOf('\nclass RecenterControl', functionStart);
const routeFunction = mapSource
    .slice(functionStart, functionEnd)
    .replace('export async function presentRoute(', 'async function presentRoute(');

assert.notEqual(functionStart, -1, 'presentRoute must remain in map.js');
assert.notEqual(functionEnd, -1, 'presentRoute boundary must be found');

const presentationModule = `
const calls = [];
let isCurrentValue = true;
async function ensure2DView() {
    calls.push(['ensure2DView']);
    if (globalThis.__invalidatePresentation) isCurrentValue = false;
}
function setUserFollowing(value) { calls.push(['setUserFollowing', value]); }
function fitWalkingRoute(map, coordinates) { calls.push(['fitWalkingRoute', coordinates]); }
function drawRoutePreview(map, coordinates, mode) { calls.push(['drawRoutePreview', coordinates, mode]); }
function drawRoutePreviewSegments(map, segments) { calls.push(['drawRoutePreviewSegments', segments]); }
function drawWalkingRoute(map, coordinates, mode) { calls.push(['drawWalkingRoute', coordinates, mode]); }
function showDestinationMarker(map, position) { calls.push(['showDestinationMarker', position]); }
${routeFunction}
export { calls, presentRoute };
`;
const { calls, presentRoute } = await import(
    `data:text/javascript;base64,${Buffer.from(presentationModule).toString('base64')}`
);

const segment = (mode, coordinates) => ({
    mode,
    geometry: coordinates,
    destination: {
        latitude: coordinates.at(-1)[1],
        longitude: coordinates.at(-1)[0],
        type: 'address',
    },
});

test('présente tous les tronçons après le retour en 2D et cadre leurs coordonnées complètes', async () => {
    calls.length = 0;
    const segments = [
        segment('pedestrian', [[2, 48], [2.01, 48.01]]),
        segment('bicycle', [[2.01, 48.01], [2.04, 48.02]]),
        segment('pedestrian', [[2.04, 48.02], [2.05, 48.03]]),
    ];
    const map = {};

    assert.equal(
        await presentRoute(map, segments, {
            layer: 'preview',
            isCurrent: () => true,
        }),
        true,
    );
    assert.deepEqual(calls.map(([name]) => name), [
        'ensure2DView',
        'setUserFollowing',
        'fitWalkingRoute',
        'drawRoutePreviewSegments',
        'showDestinationMarker',
    ]);
    assert.deepEqual(calls[2][1], segments.flatMap(({ geometry }) => geometry));
    assert.equal(calls[3][1], segments);
    assert.equal(calls[4][1], segments.at(-1).destination);
});

test('une présentation devenue obsolète après la transition ne cadre ni ne dessine', async () => {
    calls.length = 0;
    globalThis.__invalidatePresentation = true;
    let validityChecks = 0;

    try {
        assert.equal(
            await presentRoute({}, [segment('bicycle', [[2, 48], [2.01, 48.01]])], {
                layer: 'preview',
                isCurrent: () => ++validityChecks === 1,
            }),
            false,
        );
        assert.deepEqual(calls.map(([name]) => name), ['ensure2DView']);
    } finally {
        delete globalThis.__invalidatePresentation;
    }
});

test('un trajet simple conserve le dessin piéton existant et une route active ne reçoit pas plusieurs tronçons', async () => {
    calls.length = 0;
    const walking = segment('pedestrian', [[2, 48], [2.01, 48.01]]);

    assert.equal(
        await presentRoute({}, walking, {
            layer: 'preview',
            isCurrent: () => true,
        }),
        true,
    );
    assert.equal(calls.some(([name]) => name === 'drawRoutePreview'), true);

    assert.equal(
        await presentRoute({}, [walking, walking], {
            layer: 'walking',
            isCurrent: () => true,
        }),
        false,
    );
});
