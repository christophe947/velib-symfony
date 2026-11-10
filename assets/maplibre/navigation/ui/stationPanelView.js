function renderModeSelector(mode) {
    return `
        <div class="station-panel-mode-selector">

            <button
                type="button"
                class="${mode === 'bikes' ? 'active' : ''}"
                data-mode="bikes"
            >
                🚲 Vélos
            </button>

            <button
                type="button"
                class="${mode === 'electric' ? 'active' : ''}"
                data-mode="electric"
            >
                🔋 Électriques
            </button>

            <button
                type="button"
                class="${mode === 'docks' ? 'active' : ''}"
                data-mode="docks"
            >
                🅿️ Places
            </button>

            <span class="station-panel-mode-indicator"></span>

        </div>
    `;
}

export function renderEmptyPanel(mode) {
    return `
        <div class="station-panel-empty">

            ${renderModeSelector(mode)}

        </div>
    `;
}

export function renderStationPanel({ station, mode, navigationState }) {
    const { isActiveNavigationPanel, isNavigationContextPanel } =
        navigationState;

    let navigationControls = `
        <div class="station-panel-navigation-controls">
            <button type="button" class="station-panel-join">
                Rejoindre
            </button>
        </div>
    `;

    if (isActiveNavigationPanel) {
        navigationControls = `
            <div class="station-panel-navigation-controls">
                <button type="button" class="station-panel-join" disabled>
                    Navigation en cours
                </button>
                <button
                    type="button"
                    class="station-panel-stop"
                    aria-label="Arrêter la navigation"
                    title="Arrêter la navigation"
                >
                    ✕
                </button>
            </div>
        `;
    } else if (isNavigationContextPanel) {
        navigationControls = `
            <div class="station-panel-navigation-active" role="status">
                Navigation en cours
            </div>
            <div class="station-panel-navigation-controls station-panel-navigation-controls--context">
                <div class="station-panel-context-actions">
                    <button
                        type="button"
                        class="station-panel-join station-panel-context-resume"
                    >
                        Reprendre l'itinéraire
                    </button>
                    <button
                        type="button"
                        class="station-panel-stop"
                        aria-label="Arrêter la navigation"
                        title="Arrêter la navigation"
                    >
                        ✕
                    </button>
                </div>
                <button
                    type="button"
                    class="station-panel-join station-panel-context-replace"
                    title="Calculer un itinéraire vers cette station"
                >
                    Naviguer vers cette station
                </button>
            </div>
        `;
    }

    return `
        <div class="station-panel-content">

            <h2 class="station-panel-title">
                ${station.name ?? 'Station Vélib'}
            </h2>

            <p class="station-panel-address">
                ${station.address ?? ''}
            </p>

            <div class="station-panel-stats">

                <div class="station-panel-stat">
                    <span class="station-panel-stat-icon">🚲</span>
                    <strong data-station-availability="bikes">${station.bikes ?? 0}</strong>
                    <span>vélos</span>
                </div>

                <div class="station-panel-stat">
                    <span class="station-panel-stat-icon">🔋</span>
                    <strong data-station-availability="electricBikes">${station.electricBikes ?? 0}</strong>
                    <span>électriques</span>
                </div>

                <div class="station-panel-stat">
                    <span class="station-panel-stat-icon">🅿️</span>
                    <strong data-station-availability="docks">${station.docks ?? 0}</strong>
                    <span>places</span>
                </div>

            </div>

            <div class="station-panel-route-summary"></div>

            <div class="station-panel-message" role="status" aria-live="polite" hidden></div>

            ${navigationControls}

            ${renderModeSelector(mode)}

        </div>
    `;
}
