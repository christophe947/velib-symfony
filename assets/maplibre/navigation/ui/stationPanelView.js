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

            ${renderRoutePlannerTrigger()}

        </div>
    `;
}

function renderRoutePlannerTrigger() {
    return `
        <button
            type="button"
            class="route-planner-trigger"
            data-open-route-planner
            aria-label="Planifier un itinéraire"
        >
            <span aria-hidden="true">⌃</span>
            <span>Planifier un itinéraire</span>
        </button>
    `;
}

export function renderRoutePlanner() {
    return `
        <section class="route-planner-panel" aria-labelledby="route-planner-title">
            <header class="route-planner-header">
                <h2 id="route-planner-title">Planifier un itinéraire</h2>
                <button
                    type="button"
                    class="route-planner-close"
                    data-close-route-planner
                    aria-label="Fermer le planificateur"
                >
                    ×
                </button>
            </header>

            <div class="route-planner-fields">
                <div class="route-planner-field-group">
                    <label class="route-planner-field">
                        <span>Départ</span>
                        <input
                            type="text"
                            id="route-origin"
                            data-route-field="origin"
                            name="route-origin"
                            placeholder="Ma position actuelle"
                            autocomplete="off"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded="false"
                            aria-controls="route-origin-suggestions"
                        >
                    </label>
                    <div
                        id="route-origin-suggestions"
                        class="route-planner-suggestions"
                        data-route-suggestions="origin"
                        hidden
                    ></div>
                </div>

                <div class="route-planner-field-group">
                    <label class="route-planner-field">
                        <span>Arrivée</span>
                        <input
                            type="text"
                            id="route-destination"
                            data-route-field="destination"
                            name="route-destination"
                            placeholder="Adresse, lieu ou station"
                            autocomplete="off"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded="false"
                            aria-controls="route-destination-suggestions"
                        >
                    </label>
                    <div
                        id="route-destination-suggestions"
                        class="route-planner-suggestions"
                        data-route-suggestions="destination"
                        hidden
                    ></div>
                </div>
            </div>

            <fieldset class="route-planner-modes">
                <legend>Type de trajet</legend>

                <label>
                    <input type="radio" name="route-type" value="walking" checked>
                    <span>À pied</span>
                </label>

                <label>
                    <input type="radio" name="route-type" value="cycling">
                    <span>Je suis déjà en Vélib</span>
                </label>

                <label>
                    <input type="radio" name="route-type" value="velib-complete">
                    <span>Trajet complet Vélib</span>
                </label>
            </fieldset>

            <button type="button" class="route-planner-calculate" disabled>
                Calculer l’itinéraire
            </button>
        </section>
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

            ${renderRoutePlannerTrigger()}

        </div>
    `;
}
