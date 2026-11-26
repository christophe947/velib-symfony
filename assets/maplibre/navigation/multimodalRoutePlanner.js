function isValidPlace(place) {
    return (
        Number.isFinite(place?.latitude) &&
        place.latitude >= -90 &&
        place.latitude <= 90 &&
        Number.isFinite(place?.longitude) &&
        place.longitude >= -180 &&
        place.longitude <= 180
    );
}

function createAbortError() {
    const error = new Error('The multimodal route calculation was aborted.');
    error.name = 'AbortError';

    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw signal.reason ?? createAbortError();
    }
}

function stationKey(station) {
    if (station?.id !== undefined && station.id !== null) {
        return String(station.id);
    }

    return `${station?.latitude},${station?.longitude}`;
}

function isSamePlace(a, b) {
    if (
        a?.type === 'station' &&
        a.stationId !== undefined &&
        b?.id !== undefined &&
        String(a.stationId) === String(b.id)
    ) {
        return true;
    }

    return (
        a?.latitude === b?.latitude &&
        a?.longitude === b?.longitude
    );
}

function selectedStationId(place) {
    return place?.type === 'station' && place.stationId !== undefined
        ? String(place.stationId)
        : null;
}

function countSelectedStations(plan, origin, destination) {
    let matches = 0;

    if (
        plan.pickupStation &&
        selectedStationId(origin) === String(plan.pickupStation.id)
    ) {
        matches += 1;
    }

    if (
        plan.dropoffStation &&
        selectedStationId(destination) === String(plan.dropoffStation.id)
    ) {
        matches += 1;
    }

    return matches;
}

function normalizeSnapshotMetadata(snapshot) {
    const fetchedAt =
        typeof snapshot?.fetchedAt === 'string' &&
        Number.isFinite(Date.parse(snapshot.fetchedAt))
            ? snapshot.fetchedAt
            : null;

    return {
        fetchedAt,
        stale: typeof snapshot?.stale === 'boolean' ? snapshot.stale : null,
    };
}

async function mapWithConcurrency(items, concurrency, mapper, signal) {
    const results = new Array(items.length);
    let nextIndex = 0;
    let abortListener;
    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
            while (true) {
                throwIfAborted(signal);

                const index = nextIndex;

                if (index >= items.length) {
                    return;
                }

                nextIndex += 1;
                results[index] = await mapper(items[index], index);
            }
        },
    );
    const work = Promise.all(workers).then(() => results);

    if (!signal) {
        return work;
    }

    const aborted = new Promise((_, reject) => {
        abortListener = () => reject(signal.reason ?? createAbortError());
        signal.addEventListener('abort', abortListener, { once: true });

        if (signal.aborted) {
            abortListener();
        }
    });

    try {
        return await Promise.race([work, aborted]);
    } finally {
        signal.removeEventListener('abort', abortListener);
    }
}

function comparePlans(a, b, origin, destination) {
    return (
        a.duration - b.duration ||
        countSelectedStations(b, origin, destination) -
            countSelectedStations(a, origin, destination) ||
        a.walkingDuration - b.walkingDuration ||
        (b.pickupStation?.bikes ?? 0) - (a.pickupStation?.bikes ?? 0) ||
        (b.dropoffStation?.docks ?? 0) - (a.dropoffStation?.docks ?? 0) ||
        String(a.pickupStation ? stationKey(a.pickupStation) : '').localeCompare(
            String(b.pickupStation ? stationKey(b.pickupStation) : ''),
        ) ||
        stationKey(a.dropoffStation).localeCompare(stationKey(b.dropoffStation))
    );
}

/**
 * Computes complete walking / Vélib / walking plans from one captured station
 * snapshot. It has no browser, DOM, map, or GPS-device dependencies.
 */
export class MultimodalRoutePlanner {
    #getStationSnapshot;
    #findNearbyStations;
    #getRoute;
    #isStationEligibleForPickup;
    #isStationEligibleForDropoff;
    #candidateLimit;
    #searchRadiusMeters;
    #maxConcurrentRoutes;

    constructor({
        getStationSnapshot,
        findNearbyStations,
        getRoute,
        isStationEligibleForPickup,
        isStationEligibleForDropoff,
        candidateLimit = 3,
        searchRadiusMeters = 1000,
        maxConcurrentRoutes = 3,
    }) {
        if (
            typeof getStationSnapshot !== 'function' ||
            typeof findNearbyStations !== 'function' ||
            typeof getRoute !== 'function' ||
            typeof isStationEligibleForPickup !== 'function' ||
            typeof isStationEligibleForDropoff !== 'function'
        ) {
            throw new TypeError('MultimodalRoutePlanner requires all domain dependencies.');
        }

        if (
            !Number.isInteger(candidateLimit) ||
            candidateLimit < 1 ||
            !Number.isFinite(searchRadiusMeters) ||
            searchRadiusMeters < 0 ||
            !Number.isInteger(maxConcurrentRoutes) ||
            maxConcurrentRoutes < 1
        ) {
            throw new RangeError('MultimodalRoutePlanner limits must be positive.');
        }

        this.#getStationSnapshot = getStationSnapshot;
        this.#findNearbyStations = findNearbyStations;
        this.#getRoute = getRoute;
        this.#isStationEligibleForPickup = isStationEligibleForPickup;
        this.#isStationEligibleForDropoff = isStationEligibleForDropoff;
        this.#candidateLimit = candidateLimit;
        this.#searchRadiusMeters = searchRadiusMeters;
        this.#maxConcurrentRoutes = maxConcurrentRoutes;
    }

    async calculate({ origin, destination, alreadyOnVelib = false, signal } = {}) {
        if (!isValidPlace(origin) || !isValidPlace(destination)) {
            throw new TypeError('Origin and destination must have valid coordinates.');
        }

        throwIfAborted(signal);

        // Polling replaces this reference; capturing it here keeps one
        // calculation internally consistent while a later snapshot arrives.
        const snapshot = this.#getStationSnapshot();
        const availability = normalizeSnapshotMetadata(snapshot);
        const stations = Array.isArray(snapshot?.stations) ? snapshot.stations : [];
        const pickupStations = alreadyOnVelib
            ? []
            : this.#getCandidates(
                  origin,
                  stations,
                  this.#isStationEligibleForPickup,
                  selectedStationId(origin),
              );
        const dropoffStations = this.#getCandidates(
            destination,
            stations,
            this.#isStationEligibleForDropoff,
            selectedStationId(destination),
        );

        if (!alreadyOnVelib && pickupStations.length === 0) {
            return { plans: [], reason: 'no-pickup-station', availability };
        }

        if (dropoffStations.length === 0) {
            return { plans: [], reason: 'no-dropoff-station', availability };
        }

        const walkingLegs = [
            ...pickupStations
                .filter((station) => !isSamePlace(origin, station))
                .map((station) => ({
                kind: 'pickup-walk',
                station,
                from: origin,
                to: station,
                mode: 'pedestrian',
                })),
            ...dropoffStations
                .filter((station) => !isSamePlace(station, destination))
                .map((station) => ({
                kind: 'destination-walk',
                station,
                from: station,
                to: destination,
                mode: 'pedestrian',
                })),
        ];
        const walkingRoutes = await this.#calculateLegs(walkingLegs, signal);
        const pickupWalks = new Map();
        const destinationWalks = new Map();

        walkingRoutes.forEach((entry) => {
            if (entry.route) {
                const target =
                    entry.leg.kind === 'pickup-walk'
                        ? pickupWalks
                        : destinationWalks;
                target.set(stationKey(entry.leg.station), entry.route);
            }
        });

        const combinations = [];

        for (const pickupStation of alreadyOnVelib ? [null] : pickupStations) {
                if (
                    pickupStation &&
                    !isSamePlace(origin, pickupStation) &&
                    !pickupWalks.has(stationKey(pickupStation))
                ) {
                continue;
            }

            for (const dropoffStation of dropoffStations) {
                if (
                    pickupStation &&
                    stationKey(pickupStation) === stationKey(dropoffStation)
                ) {
                    continue;
                }

                if (
                    !isSamePlace(dropoffStation, destination) &&
                    !destinationWalks.has(stationKey(dropoffStation))
                ) {
                    continue;
                }

                combinations.push({ pickupStation, dropoffStation });
            }
        }

        const bicycleLegs = [];
        const bicycleCombinationIndexes = [];

        combinations.forEach(({ pickupStation, dropoffStation }, index) => {
            const from = pickupStation ?? origin;

            if (!isSamePlace(from, dropoffStation)) {
                bicycleCombinationIndexes.push(index);
                bicycleLegs.push({
                    kind: 'bicycle',
                    pickupStation,
                    station: dropoffStation,
                    from,
                    to: dropoffStation,
                    mode: 'bicycle',
                });
            }
        });
        const bicycleRoutes = await this.#calculateLegs(bicycleLegs, signal);
        const bicycleRoutesByCombination = new Map(
            bicycleRoutes.map((entry, index) => [
                bicycleCombinationIndexes[index],
                entry.route,
            ]),
        );
        const plans = [];

        for (const [index, { pickupStation, dropoffStation }] of combinations.entries()) {
            const bicycleRoute = isSamePlace(
                pickupStation ?? origin,
                dropoffStation,
            )
                ? null
                : bicycleRoutesByCombination.get(index);

            if (!bicycleRoute && !isSamePlace(pickupStation ?? origin, dropoffStation)) {
                continue;
            }

            const segments = [];

            const pickupWalk = pickupStation
                ? pickupWalks.get(stationKey(pickupStation))
                : null;

            if (pickupWalk) {
                segments.push({
                    ...pickupWalk,
                    transfer: {
                        type: 'pickup',
                        stationId: stationKey(pickupStation),
                    },
                });
            }

            if (bicycleRoute) {
                segments.push({
                    ...bicycleRoute,
                    transfer: {
                        type: 'dropoff',
                        stationId: stationKey(dropoffStation),
                    },
                });
            }

            const destinationWalk = destinationWalks.get(
                stationKey(dropoffStation),
            );

            if (destinationWalk) {
                segments.push(destinationWalk);
            }

            if (segments.length === 0) {
                continue;
            }

            const walkingDuration = segments.reduce(
                (total, segment) =>
                    total + (segment.mode === 'pedestrian' ? segment.duration : 0),
                0,
            );

            plans.push({
                id: `${pickupStation ? stationKey(pickupStation) : 'already-on-velib'}>${stationKey(dropoffStation)}`,
                origin: { ...origin },
                destination: { ...destination },
                alreadyOnVelib,
                pickupStation,
                dropoffStation,
                segments,
                distance: segments.reduce(
                    (total, segment) => total + segment.distance,
                    0,
                ),
                duration: segments.reduce((total, segment) => total + segment.duration, 0),
                walkingDuration,
                availability,
            });
        }

        plans.sort((a, b) => comparePlans(a, b, origin, destination));

        return {
            plans,
            reason: plans.length > 0 ? null : 'no-complete-route',
            availability,
        };
    }

    #getCandidates(place, stations, isEligible, preferredStationId = null) {
        const eligibleStations = stations.filter(
            (station) => isEligible(station) && isValidPlace(station),
        );
        const nearby = this.#findNearbyStations(
            place.latitude,
            place.longitude,
            eligibleStations,
            this.#candidateLimit,
            this.#searchRadiusMeters,
        );
        const preferredStation = preferredStationId
            ? eligibleStations.find(
                  (station) => String(station.id) === preferredStationId,
              )
            : null;
        const candidates = preferredStation
            ? [
                  preferredStation,
                  ...nearby.filter(
                      (station) =>
                          stationKey(station) !== stationKey(preferredStation),
                  ),
              ]
            : nearby;
        const seen = new Set();

        return candidates.filter((station) => {
            const key = stationKey(station);

            if (
                !isValidPlace(station) ||
                !isEligible(station) ||
                seen.has(key)
            ) {
                return false;
            }

            seen.add(key);

            return true;
        }).slice(0, this.#candidateLimit);
    }

    async #calculateLegs(legs, signal) {
        return mapWithConcurrency(
            legs,
            this.#maxConcurrentRoutes,
            async (leg) => {
                throwIfAborted(signal);

                try {
                    const route = await this.#getRoute(leg.from, leg.to, leg.mode, {
                        signal,
                    });

                    throwIfAborted(signal);

                    if (
                        route?.mode !== leg.mode ||
                        !Array.isArray(route.geometry) ||
                        !Number.isFinite(route.distance) ||
                        !Number.isFinite(route.duration)
                    ) {
                        return { leg, route: null };
                    }

                    return { leg, route };
                } catch (error) {
                    if (signal?.aborted || error?.name === 'AbortError') {
                        throw error;
                    }

                    return { leg, route: null };
                }
            },
            signal,
        );
    }
}
