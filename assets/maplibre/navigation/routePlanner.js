import {
    getUserPositionErrorMessage,
    requestUserPosition,
} from '../location/geolocation.js';
import { renderRoutePlaceSuggestions } from './ui/routePlannerView.js';

const MIN_QUERY_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 250;
const MAX_POSITION_AGE_MS = 10_000;

function isValidPosition(position) {
    const age = Date.now() - position?.timestamp;

    return (
        Number.isFinite(position?.latitude) &&
        position.latitude >= -90 &&
        position.latitude <= 90 &&
        Number.isFinite(position?.longitude) &&
        position.longitude >= -180 &&
        position.longitude <= 180 &&
        Number.isFinite(position?.timestamp) &&
        age >= 0 &&
        age <= MAX_POSITION_AGE_MS
    );
}

function invalidPositionError(position) {
    const hasValidCoordinates =
        Number.isFinite(position?.latitude) &&
        position.latitude >= -90 &&
        position.latitude <= 90 &&
        Number.isFinite(position?.longitude) &&
        position.longitude >= -180 &&
        position.longitude <= 180;
    const error = new Error('The GPS position is invalid or stale.');

    error.code = hasValidCoordinates ? 'POSITION_STALE' : 'POSITION_INVALID';

    return error;
}

export function createRoutePlannerController(element, { onChange } = {}) {
    if (!element) {
        return null;
    }

    const fields = new Map(
        ['origin', 'destination'].map((name) => {
            const input = element.querySelector(`[data-route-field="${name}"]`);
            const suggestions = element.querySelector(
                `[data-route-suggestions="${name}"]`,
            );

            return [
                name,
                {
                    input,
                    suggestions,
                    selected: null,
                    candidates: [],
                    requestId: 0,
                    debounceId: null,
                },
            ];
        }),
    );

    if ([...fields.values()].some(({ input, suggestions }) => !input || !suggestions)) {
        return null;
    }

    let searchApi = null;
    let destroyed = false;
    let isCalculating = false;
    const eventController = new AbortController();

    function getSelections() {
        const getLatestSelection = (field) => {
            if (
                field.selected?.type === 'station' &&
                searchApi?.resolveRouteCandidate
            ) {
                return searchApi.resolveRouteCandidate(field.selected);
            }

            return field.selected;
        };

        return {
            origin: getLatestSelection(fields.get('origin')),
            destination: getLatestSelection(fields.get('destination')),
            mode: element.querySelector('[name="route-type"]:checked')?.value ?? 'walking',
        };
    }

    function notifyChange() {
        onChange?.(getSelections());
    }

    function isResolvedPlace(place) {
        return (
            Number.isFinite(place?.latitude) &&
            place.latitude >= -90 &&
            place.latitude <= 90 &&
            Number.isFinite(place?.longitude) &&
            place.longitude >= -180 &&
            place.longitude <= 180
        );
    }

    function updateCalculateButton() {
        const button = element.querySelector('.route-planner-calculate');
        const { origin, destination, mode } = getSelections();

        if (button) {
            button.disabled =
                isCalculating ||
                mode !== 'walking' ||
                !isResolvedPlace(origin) ||
                !isResolvedPlace(destination);

            if (isCalculating) {
                button.setAttribute('aria-busy', 'true');
            } else {
                button.removeAttribute('aria-busy');
            }
        }
    }

    function stateChanged() {
        updateCalculateButton();
        notifyChange();
    }

    function hideSuggestions(field) {
        clearTimeout(field.debounceId);
        field.debounceId = null;
        field.requestId += 1;
        field.suggestions.hidden = true;
        field.input.setAttribute('aria-expanded', 'false');
    }

    function renderSuggestions(
        field,
        {
            loading = false,
            error = false,
            errorMessage,
            showCurrentLocation = false,
            showNoResults = true,
        } = {},
    ) {
        field.suggestions.innerHTML = renderRoutePlaceSuggestions({
            candidates: field.candidates,
            loading,
            error,
            errorMessage,
            showCurrentLocation,
            showNoResults,
        });
        field.suggestions.hidden = false;
        field.input.setAttribute('aria-expanded', 'true');
    }

    async function runSearch(name, field, requestId, query) {
        if (!searchApi?.searchRouteCandidates || destroyed) {
            renderSuggestions(field, {
                error: true,
                errorMessage: 'La recherche est momentanément indisponible.',
                showCurrentLocation: name === 'origin',
            });
            return;
        }

        try {
            const result = await searchApi.searchRouteCandidates(query);

            if (
                destroyed ||
                field.requestId !== requestId ||
                field.input.value.trim() !== query
            ) {
                return;
            }

            field.candidates = result.candidates;
            renderSuggestions(field, {
                error: result.error,
                showCurrentLocation: name === 'origin',
                showNoResults: true,
            });
            stateChanged();
        } catch (error) {
            if (destroyed || field.requestId !== requestId) {
                return;
            }

            console.warn('Échec de la recherche du planificateur :', error);
            field.candidates = error.candidates ?? [];
            renderSuggestions(field, {
                error: true,
                showCurrentLocation: name === 'origin',
            });
            stateChanged();
        }
    }

    function handleInput(name, field) {
        field.selected = null;
        field.candidates = [];
        field.requestId += 1;
        const requestId = field.requestId;
        clearTimeout(field.debounceId);
        field.debounceId = null;

        const query = field.input.value.replace(/\s+/g, ' ').trim();
        stateChanged();

        if (query.length < MIN_QUERY_LENGTH) {
            if (name === 'origin' && query.length === 0) {
                renderSuggestions(field, {
                    showCurrentLocation: true,
                    showNoResults: false,
                });
            } else if (name === 'origin' && query.length === 1) {
                renderSuggestions(field, {
                    showCurrentLocation: true,
                    showNoResults: false,
                });
            } else {
                hideSuggestions(field);
            }

            return;
        }

        renderSuggestions(field, {
            loading: true,
            showCurrentLocation: name === 'origin',
        });
        field.debounceId = setTimeout(() => {
            field.debounceId = null;
            void runSearch(name, field, requestId, query);
        }, SEARCH_DEBOUNCE_MS);
    }

    function selectCandidate(field, candidate) {
        field.requestId += 1;
        clearTimeout(field.debounceId);
        field.debounceId = null;
        field.selected = {
            type: candidate.type,
            label: candidate.label,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            ...(candidate.stationId !== undefined
                ? { stationId: candidate.stationId }
                : {}),
        };
        field.input.value = candidate.label;
        hideSuggestions(field);
    }

    async function selectCurrentLocation(field) {
        field.requestId += 1;
        const requestId = field.requestId;
        const inputValue = field.input.value;
        field.selected = null;
        field.candidates = [];
        stateChanged();
        renderSuggestions(field, { loading: true });

        try {
            const position = await requestUserPosition({ maximumAge: 0 });

            if (
                destroyed ||
                field.requestId !== requestId ||
                field.input.value !== inputValue
            ) {
                return;
            }

            if (!isValidPosition(position)) {
                throw invalidPositionError(position);
            }

            field.selected = {
                type: 'current-location',
                label: 'Ma position actuelle',
                latitude: position.latitude,
                longitude: position.longitude,
                timestamp: position.timestamp,
                accuracy: position.accuracy,
            };
            field.input.value = field.selected.label;
            hideSuggestions(field);
            stateChanged();
        } catch (error) {
            if (destroyed || field.requestId !== requestId) {
                return;
            }

            console.warn('Impossible de récupérer la position de départ :', error);
            renderSuggestions(field, {
                error: true,
                errorMessage: getUserPositionErrorMessage(error),
                showCurrentLocation: true,
            });
            stateChanged();
        }
    }

    fields.forEach((field, name) => {
        field.input.addEventListener('focus', () => {
            fields.forEach((otherField) => {
                if (otherField !== field) {
                    hideSuggestions(otherField);
                }
            });

            if (name === 'origin' && field.input.value.trim() === '') {
                field.candidates = [];
                renderSuggestions(field, {
                    showCurrentLocation: true,
                    showNoResults: false,
                });
            } else if (
                !field.selected &&
                field.input.value.trim().length >= MIN_QUERY_LENGTH
            ) {
                handleInput(name, field);
            }
        }, { signal: eventController.signal });
        field.input.addEventListener('input', () => handleInput(name, field), {
            signal: eventController.signal,
        });
    });

    element.querySelectorAll('[name="route-type"]').forEach((input) => {
        input.addEventListener('change', stateChanged, {
            signal: eventController.signal,
        });
    });

    element.addEventListener('click', (event) => {
        event.stopPropagation();

        const currentLocationButton = event.target.closest(
            '[data-route-current-location]',
        );

        if (currentLocationButton) {
            event.preventDefault();
            const field = fields.get('origin');
            void selectCurrentLocation(field);
            return;
        }

        const candidateButton = event.target.closest(
            '[data-route-candidate-index]',
        );

        if (!candidateButton) {
            return;
        }

        event.preventDefault();
        const fieldElement = candidateButton.closest('[data-route-suggestions]');
        const field = fields.get(fieldElement?.dataset.routeSuggestions);
        const candidate = field?.candidates[
            Number(candidateButton.dataset.routeCandidateIndex)
        ];

        if (field && candidate) {
            const latestCandidate = searchApi?.resolveRouteCandidate
                ? searchApi.resolveRouteCandidate(candidate)
                : candidate;

            if (!latestCandidate) {
                field.candidates = [];
                renderSuggestions(field, {
                    error: true,
                    errorMessage:
                        'Cette station n’est plus disponible. Relance la recherche.',
                });
                return;
            }

            selectCandidate(field, latestCandidate);
            stateChanged();
        }

        if (
            !event.target.closest(
                '[data-route-field], [data-route-suggestions]',
            )
        ) {
            fields.forEach(hideSuggestions);
        }
    }, { signal: eventController.signal });

    element.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            const fieldName =
                event.target.closest('[data-route-field]')?.dataset.routeField ??
                event.target
                    .closest('[data-route-suggestions]')
                    ?.dataset.routeSuggestions;
            const field = fields.get(fieldName);

            if (field) {
                event.preventDefault();
                hideSuggestions(field);
                field.input.focus();
            }

            return;
        }

        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }

        const options = [
            ...element.querySelectorAll(
                '.route-planner-suggestions:not([hidden]) .route-planner-suggestion',
            ),
        ];

        if (options.length === 0) {
            return;
        }

        event.preventDefault();
        const currentIndex = options.indexOf(document.activeElement);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex =
            currentIndex === -1
                ? direction > 0
                    ? 0
                    : options.length - 1
                : (currentIndex + direction + options.length) % options.length;

        options[nextIndex].focus();
    }, { signal: eventController.signal });

    document.addEventListener('click', (event) => {
        if (element.contains(event.target)) {
            if (
                !event.target.closest(
                    '[data-route-field], [data-route-suggestions]',
                )
            ) {
                fields.forEach(hideSuggestions);
            }

            return;
        }

        fields.forEach(hideSuggestions);
    }, { signal: eventController.signal });

    return {
        setSearchApi(api) {
            searchApi =
                typeof api?.searchRouteCandidates === 'function' ? api : null;
        },
        hideSuggestions() {
            fields.forEach(hideSuggestions);
        },
        setCalculating(value) {
            isCalculating = value === true;
            updateCalculateButton();
        },
        updateCurrentLocation(position) {
            const origin = fields.get('origin');

            if (origin.selected?.type !== 'current-location') {
                return false;
            }

            origin.selected = {
                ...origin.selected,
                latitude: position.latitude,
                longitude: position.longitude,
                timestamp: position.timestamp,
                accuracy: position.accuracy,
            };
            updateCalculateButton();

            return true;
        },
        getSelections() {
            return getSelections();
        },
        destroy() {
            destroyed = true;
            eventController.abort();
            fields.forEach((field) => {
                clearTimeout(field.debounceId);
                field.requestId += 1;
            });
        },
    };
}
