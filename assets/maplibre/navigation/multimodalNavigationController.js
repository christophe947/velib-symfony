const DEFAULT_PROGRESS_THRESHOLDS = Object.freeze({
    proximityMeters: 35,
    requiredSamples: 3,
    minimumSampleIntervalMs: 500,
    maximumSampleGapMs: 5000,
    maximumPositionAgeMs: 10_000,
    maximumAccuracyMeters: 25,
});

/**
 * Coordinates the business steps of one multimodal journey. GPS progression
 * and session resources remain owned by NavigationSession and the engine.
 */
export class MultimodalNavigationController {
    #navigationSession;
    #navigationEngine;
    #thresholds;
    #listeners = new Set();
    #unsubscribeProgress = null;
    #unsubscribeRouteRecalculation = null;
    #plan = null;
    #segmentIndex = -1;
    #phase = 'idle';
    #generation = 0;
    #routeGeneration = null;
    #lastProgressTimestamp = null;
    #lastEvidenceTimestamp = null;
    #arrivalEvidenceCount = 0;
    #initialPickupPending = false;
    #sessionStartOptions = {};
    #pendingTransition = null;

    constructor({
        navigationSession,
        navigationEngine,
        progressThresholds = {},
    } = {}) {
        if (
            typeof navigationSession?.isActive !== 'function' ||
            typeof navigationSession?.start !== 'function' ||
            typeof navigationSession?.activateSegment !== 'function' ||
            typeof navigationSession?.stop !== 'function' ||
            typeof navigationEngine?.subscribeToProgress !== 'function' ||
            typeof navigationEngine?.subscribeToRouteRecalculation !== 'function' ||
            typeof navigationEngine?.getRouteGeneration !== 'function'
        ) {
            throw new TypeError(
                'MultimodalNavigationController requires a session and progress source.',
            );
        }

        this.#navigationSession = navigationSession;
        this.#navigationEngine = navigationEngine;
        this.#thresholds = validateThresholds(progressThresholds);
    }

    subscribe(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('Journey listener must be a function.');
        }

        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    getState() {
        const activeSegment = this.#plan?.segments[this.#segmentIndex] ?? null;

        return {
            phase: this.#phase,
            planId: this.#plan?.id ?? null,
            segmentIndex: this.#segmentIndex,
            segmentCount: this.#plan?.segments.length ?? 0,
            activeSegment: activeSegment ? cloneValue(activeSegment) : null,
            awaitingConfirmation:
                this.#phase === 'awaiting-pickup-confirmation' ||
                this.#phase === 'awaiting-dropoff-confirmation',
            transitionTargetIndex:
                this.#pendingTransition?.kind === 'segment'
                    ? this.#pendingTransition.segmentIndex
                    : null,
        };
    }

    async start(plan, sessionOptions = {}) {
        if (
            this.#navigationSession.isActive() ||
            !['idle', 'stopped', 'completed', 'error'].includes(this.#phase)
        ) {
            return false;
        }

        if (!isValidPlan(plan)) {
            throw new TypeError('The multimodal journey plan is invalid.');
        }

        this.#generation++;
        const generation = this.#generation;
        this.#plan = cloneValue(plan);
        this.#segmentIndex = 0;
        this.#routeGeneration = null;
        this.#pendingTransition = null;
        this.#resetArrivalEvidence();
        this.#sessionStartOptions = { ...sessionOptions };
        this.#initialPickupPending = needsInitialPickupConfirmation(this.#plan);

        if (this.#initialPickupPending) {
            this.#phase = 'awaiting-pickup-confirmation';
            this.#emit('pickup-reached', {
                ...this.#transferPayload('pickup', 'selected-origin'),
            });
            return true;
        }

        this.#phase = 'starting';
        return this.#startNavigationSession(generation);
    }

    confirmPickup() {
        if (this.#phase !== 'awaiting-pickup-confirmation') {
            return Promise.resolve(false);
        }

        const payload = this.#transferPayload(
            'pickup',
            this.#initialPickupPending ? 'selected-origin' : 'user-confirmation',
        );
        this.#phase = 'transitioning';
        const generation = ++this.#generation;
        this.#emit('pickup-confirmed', payload);

        if (this.#initialPickupPending) {
            this.#pendingTransition = { kind: 'initial-start' };
            return this.#startNavigationSession(generation);
        }

        return this.#activateNextSegment('pickup', generation);
    }

    confirmDropoff() {
        if (this.#phase !== 'awaiting-dropoff-confirmation') {
            return Promise.resolve(false);
        }

        const payload = this.#transferPayload('dropoff', 'user-confirmation');
        this.#phase = 'transitioning';
        const generation = ++this.#generation;
        this.#emit('dropoff-confirmed', payload);

        const nextIndex = this.#segmentIndex + 1;
        if (nextIndex >= this.#plan.segments.length) {
            this.#complete('confirmed-dropoff');
            return Promise.resolve(true);
        }

        return this.#activateNextSegment('dropoff', generation);
    }

    /** Manually reports arrival when GPS evidence cannot reach the threshold. */
    reportMilestoneReached() {
        if (this.#phase !== 'navigating') {
            return false;
        }

        this.#reachCurrentMilestone('manual');
        return true;
    }

    async retryTransition() {
        if (this.#phase !== 'transition-error' || !this.#pendingTransition) {
            return false;
        }

        const generation = ++this.#generation;
        this.#phase = 'transitioning';

        if (this.#pendingTransition.kind === 'initial-start') {
            return this.#startNavigationSession(generation, true);
        }

        return this.#activateNextSegment(
            this.#pendingTransition.transferType,
            generation,
            this.#pendingTransition.segmentIndex,
        );
    }

    stop() {
        if (['idle', 'stopped', 'completed'].includes(this.#phase)) {
            return false;
        }

        this.#generation++;
        this.#phase = 'stopped';
        this.#routeGeneration = null;
        this.#pendingTransition = null;
        this.#unsubscribeFromProgress();
        this.#emit('stopped', { planId: this.#plan?.id ?? null });
        this.#navigationSession.stop();
        return true;
    }

    #subscribeToProgress() {
        this.#unsubscribeFromProgress();
        this.#unsubscribeProgress = this.#navigationEngine.subscribeToProgress(
            (event) => this.#handleProgress(event),
        );
        this.#unsubscribeRouteRecalculation =
            this.#navigationEngine.subscribeToRouteRecalculation((event) =>
                this.#handleRouteRecalculated(event),
            );
    }

    #unsubscribeFromProgress() {
        this.#unsubscribeProgress?.();
        this.#unsubscribeProgress = null;
        this.#unsubscribeRouteRecalculation?.();
        this.#unsubscribeRouteRecalculation = null;
    }

    async #startNavigationSession(generation, isRetry = false) {
        const segment = this.#plan.segments[this.#segmentIndex];
        const callerIsCurrent = this.#sessionStartOptions.isCurrent;
        const isCurrent = () =>
            generation === this.#generation &&
            (typeof callerIsCurrent !== 'function' || callerIsCurrent());

        this.#subscribeToProgress();

        try {
            const started = await this.#navigationSession.start({
                ...this.#sessionStartOptions,
                mode: segment.mode,
                route: this.#plan,
                isCurrent,
            });

            if (generation !== this.#generation) {
                return false;
            }

            if (!started) {
                throw new Error('La session de navigation n’a pas démarré.');
            }

            this.#initialPickupPending = false;
            this.#pendingTransition = null;
            this.#routeGeneration = this.#navigationEngine.getRouteGeneration();
            this.#phase = 'navigating';
            this.#resetArrivalEvidence();
            this.#emit('segment-changed', {
                previousSegmentIndex: null,
                segmentIndex: this.#segmentIndex,
                segment: cloneValue(segment),
                routeGeneration: this.#routeGeneration,
                isRetry,
            });
            return true;
        } catch (error) {
            if (generation !== this.#generation) {
                return false;
            }

            this.#phase =
                isRetry || this.#initialPickupPending
                    ? 'transition-error'
                    : 'error';
            this.#pendingTransition = { kind: 'initial-start' };
            this.#unsubscribeFromProgress();
            this.#emit('start-failed', { error, isRetry });
            return false;
        }
    }

    async #activateNextSegment(transferType, generation, segmentIndex = null) {
        const nextIndex = segmentIndex ?? this.#segmentIndex + 1;
        const nextSegment = this.#plan.segments[nextIndex];

        if (!nextSegment) {
            this.#phase = 'transition-error';
            this.#pendingTransition = { kind: 'segment', transferType, segmentIndex: nextIndex };
            this.#emit('transition-failed', {
                transferType,
                segmentIndex: nextIndex,
                reason: 'missing-segment',
                retryable: false,
            });
            return false;
        }

        this.#pendingTransition = {
            kind: 'segment',
            transferType,
            segmentIndex: nextIndex,
        };
        const isCurrent = () =>
            generation === this.#generation && this.#phase === 'transitioning';

        try {
            const activated = await this.#navigationSession.activateSegment(
                nextSegment,
                {
                    isCurrent,
                    segmentIndex: nextIndex,
                    onCompassError: (error) =>
                        this.#emit('compass-unavailable', { error }),
                },
            );

            if (!isCurrent()) {
                return false;
            }

            if (!activated) {
                throw new Error('Le segment suivant n’a pas pu être activé.');
            }

            const previousSegmentIndex = this.#segmentIndex;
            this.#segmentIndex = nextIndex;
            this.#routeGeneration = this.#navigationEngine.getRouteGeneration();
            this.#pendingTransition = null;
            this.#phase = 'navigating';
            this.#resetArrivalEvidence();
            this.#emit('segment-changed', {
                transferType,
                previousSegmentIndex,
                segmentIndex: nextIndex,
                segment: cloneValue(nextSegment),
                routeGeneration: this.#routeGeneration,
            });
            return true;
        } catch (error) {
            if (!isCurrent()) {
                return false;
            }

            this.#phase = 'transition-error';
            this.#emit('transition-failed', {
                transferType,
                segmentIndex: nextIndex,
                error,
                retryable: true,
            });
            return false;
        }
    }

    #handleProgress(event) {
        if (
            this.#phase !== 'navigating' ||
            !this.#plan ||
            event?.routeGeneration !== this.#routeGeneration
        ) {
            return;
        }

        const segment = this.#plan.segments[this.#segmentIndex];
        const timestamp = event.position?.timestamp;

        if (
            event.mode !== segment.mode ||
            !matchesDestination(event.destination, segment.destination) ||
            !Number.isFinite(timestamp) ||
            timestamp <= (this.#lastProgressTimestamp ?? -Infinity)
        ) {
            return;
        }

        this.#lastProgressTimestamp = timestamp;
        const age = Date.now() - timestamp;
        const accuracy = event.position?.accuracy;
        const distanceRemaining = event.distanceRemaining;
        const isUsableFix =
            age >= 0 &&
            age <= this.#thresholds.maximumPositionAgeMs &&
            Number.isFinite(accuracy) &&
            accuracy >= 0 &&
            accuracy <= this.#thresholds.maximumAccuracyMeters &&
            Number.isFinite(distanceRemaining) &&
            distanceRemaining >= 0;

        if (!isUsableFix || distanceRemaining > this.#thresholds.proximityMeters) {
            this.#resetArrivalEvidence();
            return;
        }

        if (
            this.#lastEvidenceTimestamp !== null &&
            timestamp - this.#lastEvidenceTimestamp >
                this.#thresholds.maximumSampleGapMs
        ) {
            this.#arrivalEvidenceCount = 0;
        }

        if (
            this.#lastEvidenceTimestamp !== null &&
            timestamp - this.#lastEvidenceTimestamp <
                this.#thresholds.minimumSampleIntervalMs
        ) {
            return;
        }

        this.#arrivalEvidenceCount++;
        this.#lastEvidenceTimestamp = timestamp;

        if (this.#arrivalEvidenceCount >= this.#thresholds.requiredSamples) {
            this.#reachCurrentMilestone('gps');
        }
    }

    #handleRouteRecalculated(event) {
        if (
            this.#phase !== 'navigating' ||
            !this.#plan ||
            !this.#navigationSession.isActive() ||
            event?.previousRouteGeneration !== this.#routeGeneration ||
            event?.routeGeneration !==
                this.#navigationEngine.getRouteGeneration()
        ) {
            return;
        }

        const segment = this.#plan.segments[this.#segmentIndex];
        if (
            event.mode !== segment.mode ||
            !matchesDestination(event.destination, segment.destination)
        ) {
            return;
        }

        this.#routeGeneration = event.routeGeneration;
        this.#resetArrivalEvidence();
        this.#emit('segment-route-recalculated', {
            segmentIndex: this.#segmentIndex,
            mode: event.mode,
            destination: cloneValue(event.destination),
            previousRouteGeneration: event.previousRouteGeneration,
            routeGeneration: event.routeGeneration,
        });
    }

    #reachCurrentMilestone(source) {
        const segment = this.#plan.segments[this.#segmentIndex];
        const transfer = segment.transfer;

        this.#resetArrivalEvidence();

        if (transfer?.type === 'pickup') {
            this.#phase = 'awaiting-pickup-confirmation';
            this.#emit('pickup-reached', {
                ...this.#transferPayload('pickup', source),
            });
            return;
        }

        if (transfer?.type === 'dropoff') {
            this.#phase = 'awaiting-dropoff-confirmation';
            this.#emit('dropoff-reached', {
                ...this.#transferPayload('dropoff', source),
            });
            return;
        }

        if (this.#segmentIndex === this.#plan.segments.length - 1) {
            this.#complete(source);
            return;
        }

        this.#phase = 'error';
        this.#emit('journey-error', {
            reason: 'missing-transfer-marker',
            segmentIndex: this.#segmentIndex,
        });
    }

    #complete(source) {
        const segment = this.#plan.segments[this.#segmentIndex];
        const payload = {
            planId: this.#plan.id ?? null,
            segmentIndex: this.#segmentIndex,
            segment: cloneValue(segment),
            destination: cloneValue(this.#plan.destination ?? segment.destination),
            source,
        };

        this.#phase = 'completed';
        this.#generation++;
        this.#pendingTransition = null;
        this.#routeGeneration = null;
        this.#unsubscribeFromProgress();

        try {
            this.#navigationSession.stop();
        } catch (error) {
            this.#emit('session-stop-failed', { error });
        }

        this.#emit('destination-reached', payload);
    }

    #transferPayload(type, source) {
        const segment = this.#plan.segments[this.#segmentIndex];
        const transfer = segment.transfer;
        const station =
            type === 'pickup'
                ? this.#plan.pickupStation
                : this.#plan.dropoffStation;

        return {
            planId: this.#plan.id ?? null,
            segmentIndex: this.#segmentIndex,
            segment: cloneValue(segment),
            stationId:
                transfer?.type === type
                    ? transfer.stationId
                    : stationKey(station),
            station: station ? cloneValue(station) : null,
            source,
        };
    }

    #resetArrivalEvidence() {
        this.#lastProgressTimestamp = null;
        this.#lastEvidenceTimestamp = null;
        this.#arrivalEvidenceCount = 0;
    }

    #emit(type, payload = {}) {
        const event = {
            type,
            ...cloneValue(payload),
            state: this.getState(),
        };

        for (const listener of [...this.#listeners]) {
            try {
                listener(cloneValue(event));
            } catch (error) {
                console.error('Erreur d’un observateur du parcours multimodal :', error);
            }
        }
    }
}

function validateThresholds(thresholds) {
    const result = { ...DEFAULT_PROGRESS_THRESHOLDS, ...thresholds };
    if (
        !Number.isFinite(result.proximityMeters) ||
        result.proximityMeters <= 0 ||
        !Number.isInteger(result.requiredSamples) ||
        result.requiredSamples < 1 ||
        !Number.isFinite(result.minimumSampleIntervalMs) ||
        result.minimumSampleIntervalMs < 0 ||
        !Number.isFinite(result.maximumSampleGapMs) ||
        result.maximumSampleGapMs <= 0 ||
        !Number.isFinite(result.maximumPositionAgeMs) ||
        result.maximumPositionAgeMs <= 0 ||
        !Number.isFinite(result.maximumAccuracyMeters) ||
        result.maximumAccuracyMeters < 0
    ) {
        throw new RangeError('Progress thresholds are invalid.');
    }

    return result;
}

function isValidPlan(plan) {
    if (
        !plan ||
        !Array.isArray(plan.segments) ||
        plan.segments.length === 0 ||
        !plan.segments.every(isValidSegment)
    ) {
        return false;
    }

    if (plan.alreadyOnVelib && plan.pickupStation) {
        return false;
    }

    for (let index = 0; index < plan.segments.length; index++) {
        const segment = plan.segments[index];
        const transfer = segment.transfer;
        const hasNext = index < plan.segments.length - 1;

        if (!hasNext && !transfer) {
            continue;
        }

        if (!transfer || !['pickup', 'dropoff'].includes(transfer.type)) {
            return false;
        }

        const station =
            transfer.type === 'pickup'
                ? plan.pickupStation
                : plan.dropoffStation;
        if (!station || stationKey(station) !== String(transfer.stationId)) {
            return false;
        }

        if (transfer.type === 'pickup') {
            if (
                segment.mode !== 'pedestrian' ||
                !hasNext ||
                plan.segments[index + 1].mode !== 'bicycle'
            ) {
                return false;
            }
        } else if (
            segment.mode !== 'bicycle' ||
            (hasNext && plan.segments[index + 1].mode !== 'pedestrian')
        ) {
            return false;
        }
    }

    if (plan.alreadyOnVelib && plan.segments[0].mode !== 'bicycle') {
        return false;
    }

    if (
        !plan.alreadyOnVelib &&
        plan.segments[0].mode === 'bicycle' &&
        !plan.pickupStation
    ) {
        return false;
    }

    return true;
}

function isValidSegment(segment) {
    return (
        segment &&
        ['pedestrian', 'bicycle'].includes(segment.mode) &&
        Array.isArray(segment.geometry) &&
        segment.geometry.length >= 2 &&
        segment.geometry.every(
            (coordinate) =>
                Array.isArray(coordinate) &&
                Number.isFinite(coordinate[0]) &&
                coordinate[0] >= -180 &&
                coordinate[0] <= 180 &&
                Number.isFinite(coordinate[1]) &&
                coordinate[1] >= -90 &&
                coordinate[1] <= 90,
        ) &&
        Number.isFinite(segment.destination?.latitude) &&
        Number.isFinite(segment.destination?.longitude) &&
        (segment.transfer === undefined ||
            (segment.transfer &&
                ['pickup', 'dropoff'].includes(segment.transfer.type) &&
                (typeof segment.transfer.stationId === 'string' ||
                    typeof segment.transfer.stationId === 'number')))
    );
}

function needsInitialPickupConfirmation(plan) {
    return (
        !plan.alreadyOnVelib &&
        plan.segments[0].mode === 'bicycle' &&
        Boolean(plan.pickupStation) &&
        !plan.segments.some((segment) => segment.transfer?.type === 'pickup')
    );
}

function matchesDestination(eventDestination, segmentDestination) {
    return (
        Number.isFinite(eventDestination?.latitude) &&
        Number.isFinite(eventDestination?.longitude) &&
        Math.abs(eventDestination.latitude - segmentDestination.latitude) <= 1e-6 &&
        Math.abs(eventDestination.longitude - segmentDestination.longitude) <= 1e-6
    );
}

function stationKey(station) {
    if (station?.id !== undefined && station.id !== null) {
        return String(station.id);
    }

    return `${station?.latitude},${station?.longitude}`;
}

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }

    if (value && typeof value === 'object' && !(value instanceof Error)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => [
                key,
                cloneValue(nestedValue),
            ]),
        );
    }

    return value;
}
