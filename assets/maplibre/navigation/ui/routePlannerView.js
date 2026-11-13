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
}) {
    const actions = navigationActive
        ? `
            <button type="button" class="route-preview-start" disabled>
                Navigation en cours
            </button>
            <button
                type="button"
                class="route-preview-stop"
                data-route-stop-navigation
                aria-label="Arrêter la navigation"
                title="Arrêter la navigation"
            >
                ✕
            </button>
        `
        : `
            <button type="button" class="route-preview-start" ${starting ? 'disabled' : ''}>
                ${starting ? 'Vérification GPS…' : 'Démarrer'}
            </button>
            <button type="button" class="route-preview-edit" data-edit-route-planner>
                Modifier
            </button>
        `;
    const note = message ||
        'Pour démarrer, ta position doit se trouver près du départ choisi.';

    return `
        <section class="route-preview-panel" aria-labelledby="route-preview-title">
            <h2 id="route-preview-title">${navigationActive ? 'Navigation en cours' : 'Aperçu d’itinéraire'}</h2>
            <p class="route-preview-mode">🚶 À pied</p>
            <div class="route-preview-summary">
                <span data-route-preview-distance>📍 ${escapeHtml(distance)}</span>
                <span data-route-preview-duration>⏱️ ${escapeHtml(duration)}</span>
            </div>
            <p class="route-preview-start-note ${isError ? 'is-error' : ''}" data-route-preview-message role="status" aria-live="polite" ${navigationActive ? 'hidden' : ''}>
                ${escapeHtml(note)}
            </p>
            <div class="route-preview-actions">
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
