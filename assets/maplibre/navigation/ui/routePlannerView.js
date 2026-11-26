function escapeHtml(value = '') {
    return String(value).replace(
        /[&<>"']/g,
        (character) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[character],
    );
}

export function renderRoutePreview({
    distance,
    duration,
    navigationActive = false,
    starting = false,
    message = '',
    isError = false,
    modeLabel = '🚶 À pied',
    steps = [],
    transfers = [],
    availabilityWarning = '',
    alternativeWarning = '',
    canStart = true,
    journey = null,
    navigationMode = 'pedestrian',
}) {
    const journeyActive = journey && [
        'starting',
        'navigating',
        'awaiting-pickup-confirmation',
        'awaiting-dropoff-confirmation',
        'transitioning',
        'transition-error',
    ].includes(journey.phase);
    const journeyCompleted = journey?.phase === 'completed';
    const journeyAction = journeyActive
        ? journey.phase === 'awaiting-pickup-confirmation'
            ? '<button type="button" class="route-preview-journey-action" data-multimodal-action="confirm-pickup">J’ai pris mon Vélib</button>'
            : journey.phase === 'awaiting-dropoff-confirmation'
              ? '<button type="button" class="route-preview-journey-action" data-multimodal-action="confirm-dropoff">J’ai rendu mon Vélib</button>'
              : journey.phase === 'transitioning'
                ? '<button type="button" class="route-preview-journey-action" disabled aria-busy="true">Passage au tronçon suivant…</button>'
                : journey.phase === 'transition-error'
                  ? '<button type="button" class="route-preview-journey-action" data-multimodal-action="retry-transition">Réessayer le changement de tronçon</button>'
                  : journey.phase === 'navigating' && journey.activeSegment?.transfer
                    ? '<button type="button" class="route-preview-journey-action" data-multimodal-action="report-arrival">Je suis arrivé à la station</button>'
                    : ''
        : '';
    const actions = journeyActive
        ? `
            <div class="route-preview-actions station-panel-navigation-controls">
                <button type="button" class="route-preview-start station-panel-join" data-route-mode="${journey.activeSegment?.mode ?? navigationMode}" disabled>
                    Navigation en cours
                </button>
                <button
                    type="button"
                    class="route-preview-stop station-panel-stop"
                    data-route-stop-navigation
                    aria-label="Arrêter la navigation"
                    title="Arrêter la navigation"
                >
                    ✕
                </button>
            </div>
            ${journey.status ? `<p class="route-preview-journey-message ${journey.isError ? 'is-error' : ''}" role="status" aria-live="polite">${escapeHtml(journey.status)}</p>` : ''}
            ${journeyAction}
        `
        : journeyCompleted
          ? `
            <p class="route-preview-journey-message" role="status" aria-live="polite">${escapeHtml(journey.status || 'Destination atteinte.')}</p>
            <button type="button" class="route-preview-edit" data-edit-route-planner>
                Modifier
            </button>
          `
        : navigationActive
        ? `
            <button type="button" class="route-preview-start station-panel-join" data-route-mode="${navigationMode}" disabled>
                Navigation en cours
            </button>
            <button
                type="button"
                class="route-preview-stop station-panel-stop"
                data-route-stop-navigation
                aria-label="Arrêter la navigation"
                title="Arrêter la navigation"
            >
                ✕
            </button>
        `
          : canStart
          ? `
            <button type="button" class="route-preview-start" data-route-mode="${navigationMode}" ${starting ? 'disabled' : ''}>
                ${starting ? 'Vérification GPS…' : 'Démarrer'}
            </button>
            <button type="button" class="route-preview-edit" data-edit-route-planner>
                Modifier
            </button>
        `
          : `
            <p class="route-preview-unavailable" role="status">
                La navigation multimodale n’est pas encore disponible.
            </p>
            <button type="button" class="route-preview-edit" data-edit-route-planner>
                Modifier
            </button>
        `;
    const actionsClass = journeyActive
        ? 'route-preview-journey-controls'
        : navigationActive
        ? 'route-preview-actions station-panel-navigation-controls'
        : canStart
          ? 'route-preview-actions'
          : 'route-preview-actions route-preview-actions--unavailable';
    const note = message ||
        (canStart ? 'Pour démarrer, ta position doit se trouver près du départ choisi.' : '');
    const stepsHtml = steps.length
        ? `
            <ol class="route-preview-steps">
                ${steps
                    .map(
                        ({ label, detail }, index) => `
                            <li class="${journeyActive && journey.segmentIndex === index ? 'is-active' : ''}" ${journeyActive && journey.segmentIndex === index ? 'aria-current="step"' : ''}>
                                <span>${escapeHtml(label)}</span>
                                ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
                            </li>
                        `,
                    )
                    .join('')}
            </ol>
        `
        : '';
    const transfersHtml = transfers.length
        ? `
            <ul class="route-preview-transfers">
                ${transfers
                    .map(
                        ({ label, detail }) => `
                            <li>
                                <strong>${escapeHtml(label)}</strong>
                                ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
                            </li>
                        `,
                    )
                    .join('')}
            </ul>
        `
        : '';

    return `
        <section class="route-preview-panel" aria-labelledby="route-preview-title">
            <h2 id="route-preview-title">${journeyCompleted ? 'Destination atteinte' : navigationActive ? 'Navigation en cours' : 'Aperçu d’itinéraire'}</h2>
            <p class="route-preview-mode">${escapeHtml(modeLabel)}</p>
            <div class="route-preview-summary">
                <span data-route-preview-distance>📍 ${escapeHtml(distance)}</span>
                <span data-route-preview-duration>⏱️ ${escapeHtml(duration)}</span>
            </div>
            ${stepsHtml}
            ${transfersHtml}
            ${availabilityWarning ? `<p class="route-preview-warning" role="status">${escapeHtml(availabilityWarning)}</p>` : ''}
            ${alternativeWarning ? `<p class="route-preview-warning" role="status">${escapeHtml(alternativeWarning)}</p>` : ''}
            <p class="route-preview-start-note ${isError ? 'is-error' : ''}" data-route-preview-message role="status" aria-live="polite" ${navigationActive || journeyActive || journeyCompleted || !note ? 'hidden' : ''}>
                ${escapeHtml(note)}
            </p>
            <div class="${actionsClass}">
                ${actions}
            </div>
        </section>
    `;
}

const CANDIDATE_TYPE_LABELS = {
    station: 'Station Vélib',
    address: 'Adresse',
    place: 'Lieu',
};

export function renderRoutePlaceSuggestions({
    candidates = [],
    loading = false,
    error = false,
    errorMessage = 'La recherche de lieux a échoué. Réessaie.',
    showCurrentLocation = false,
    showNoResults = true,
} = {}) {
    const currentLocationOption = showCurrentLocation
        ? `
            <button
                type="button"
                class="route-planner-suggestion"
                role="option"
                aria-selected="false"
                data-route-current-location
            >
                <span class="route-planner-suggestion-type">Position</span>
                <span class="route-planner-suggestion-label">Ma position actuelle</span>
            </button>
        `
        : '';

    const candidateOptions = candidates
        .map(
            (candidate, index) => `
                <button
                    type="button"
                    class="route-planner-suggestion"
                    role="option"
                    aria-selected="false"
                    data-route-candidate-index="${index}"
                >
                    <span class="route-planner-suggestion-type">
                        ${escapeHtml(CANDIDATE_TYPE_LABELS[candidate.type] ?? 'Lieu')}
                    </span>
                    <span class="route-planner-suggestion-label">
                        ${escapeHtml(candidate.label)}
                    </span>
                    ${candidate.detail ? `<small>${escapeHtml(candidate.detail)}</small>` : ''}
                </button>
            `,
        )
        .join('');

    const status = loading
        ? '<div class="route-planner-suggestion-status" role="status">Recherche en cours…</div>'
        : error
          ? `<div class="route-planner-suggestion-status" role="status">${escapeHtml(errorMessage)}</div>`
          : showNoResults && !candidateOptions
            ? '<div class="route-planner-suggestion-status" role="status">Aucun résultat. Essaie une autre recherche.</div>'
            : '';

    return `
        <div class="route-planner-suggestions-list" role="listbox">
            ${currentLocationOption}
            ${candidateOptions}
            ${status}
        </div>
    `;
}
