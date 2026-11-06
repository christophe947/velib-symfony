import { startWatchingPosition } from './geolocation.js';

let backgroundPositionWatchId = null;

export function start(onPosition, onError) {
    if (backgroundPositionWatchId !== null) {
        return;
    }

    backgroundPositionWatchId = startWatchingPosition(onPosition, onError);
}

export function stop() {
    if (backgroundPositionWatchId === null) {
        return;
    }

    navigator.geolocation.clearWatch(backgroundPositionWatchId);
    backgroundPositionWatchId = null;
}
