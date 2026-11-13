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
