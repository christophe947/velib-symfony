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

function createSessionHarness() {
    const watches = [];
    const clearedWatchIds = [];
    const progressedPositions = [];
    let nextWatchId = 1;

    const session = new NavigationSession({
        navigationEngine: {
            updateNavigationProgress(position) {
                progressedPositions.push(position);
            },
        },
        startWatchingPosition(onPosition, onError) {
            const watch = { id: nextWatchId++, onPosition, onError };
            watches.push(watch);
            return watch.id;
        },
        clearWatch(watchId) {
            clearedWatchIds.push(watchId);
        },
    });

    return { session, watches, clearedWatchIds, progressedPositions };
}

function position({ timestamp = Date.now(), accuracy = 8, latitude = 48.86 } = {}) {
    return {
        longitude: 2.35,
        latitude,
        accuracy,
        timestamp,
    };
}

function withFixedNow(now, callback) {
    const originalNow = Date.now;
    Date.now = () => now;

    try {
        return callback();
    } finally {
        Date.now = originalNow;
    }
}

test('stores the first fresh GPS fix as raw and reliable position', () => {
    const { session } = createSessionHarness();
    const fix = position();

    assert.equal(session.rememberPosition(fix), true);
    assert.equal(session.getLastKnownPosition(), fix);
    assert.equal(session.getLastReliablePosition(), fix);
    assert.equal(session.isFreshPosition(fix), true);
    assert.equal(session.isReliablePosition(fix), true);
});

test('does not let older fixes replace the latest cached positions', () => {
    const { session } = createSessionHarness();
    const newest = position();
    const older = position({ timestamp: newest.timestamp - 1000 });

    session.rememberPosition(newest);
    session.rememberPosition(older);

    assert.equal(session.getLastKnownPosition(), newest);
    assert.equal(session.getLastReliablePosition(), newest);
});

test('keeps an imprecise fix as raw only and rejects a stale fix', () => {
    withFixedNow(100_000, () => {
        const { session } = createSessionHarness();
        const reliable = position({ timestamp: 99_998 });
        const imprecise = position({ timestamp: 99_999, accuracy: 40 });
        const stale = position({ timestamp: 88_999 });

        session.rememberPosition(reliable);
        session.rememberPosition(imprecise);

        assert.equal(session.getLastKnownPosition(), imprecise);
        assert.equal(session.getLastReliablePosition(), reliable);
        assert.equal(session.rememberPosition(stale), false);
        assert.equal(session.getLastKnownPosition(), imprecise);
    });
});

test('creates one watch, clears it once, and ignores its late callback', () => {
    const { session, watches, clearedWatchIds, progressedPositions } =
        createSessionHarness();

    assert.equal(session.startPositionWatch(), true);
    assert.equal(session.startPositionWatch(), false);
    assert.equal(watches.length, 1);
    assert.equal(session.isWatching(), true);

    const watch = watches[0];
    assert.equal(session.stopPositionWatch(), true);
    assert.equal(session.stopPositionWatch(), false);
    assert.deepEqual(clearedWatchIds, [watch.id]);

    watch.onPosition(position());
    assert.equal(progressedPositions.length, 0);
    assert.equal(session.getLastKnownPosition(), null);
});

test('an old watch cannot update a newer session', () => {
    const { session, watches, progressedPositions } = createSessionHarness();

    session.startPositionWatch();
    const oldWatch = watches[0];
    session.stopPositionWatch();
    session.startPositionWatch();
    const currentWatch = watches[1];

    oldWatch.onPosition(position());
    assert.equal(progressedPositions.length, 0);

    const currentFix = position();
    currentWatch.onPosition(currentFix);
    assert.deepEqual(progressedPositions, [currentFix]);
});

test('retains a reliable fix for destination changes when a newer fix is imprecise', () => {
    withFixedNow(100_000, () => {
        const { session, watches } = createSessionHarness();
        const reliableFix = position({ timestamp: 99_997 });
        const impreciseFix = position({ timestamp: 99_998, accuracy: 35 });
        const nextReliableFix = position({ timestamp: 99_999, accuracy: 10 });
        let deliveredReliablePosition = null;

        session.rememberPosition(reliableFix);
        session.startPositionWatch({
            onPosition: (_position, state) => {
                if (state.reliablePositionUpdated) {
                    deliveredReliablePosition = state.reliablePosition;
                }
            },
        });

        watches[0].onPosition(impreciseFix);
        assert.equal(deliveredReliablePosition, null);

        watches[0].onPosition(nextReliableFix);

        assert.equal(session.getLastReliablePosition(), nextReliableFix);
        assert.equal(deliveredReliablePosition, nextReliableFix);
    });
});
