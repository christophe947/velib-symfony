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
            <div
                class="route-planner-calculation-message"
                data-route-calculation-message
                role="status"
                aria-live="polite"
                hidden
            ></div>
        </section>
    `;
}

export function renderStationPanel({ station, mode, navigationState }) {
    const {
        isActiveNavigationPanel,
        isNavigationContextPanel,
        navigationMode = 'pedestrian',
    } = navigationState;

    let navigationControls = `
        <div class="station-panel-navigation-controls station-panel-navigation-controls--join">
            <div class="station-panel-join-options">
                <button
                    type="button"
                    class="station-panel-join station-panel-join-option"
                    data-route-mode="pedestrian"
                    aria-label="Rejoindre à pied"
                >
                    <!-- Font Awesome Free 6.0.0 by Fonticons, Inc. (https://fontawesome.com), CC BY 4.0 (https://fontawesome.com/license/free). -->
                    <svg
                        width="22"
                        height="22"
                        viewBox="0 0 320 512"
                        fill="currentColor"
                        aria-hidden="true"
                        focusable="false"
                        class="station-panel-join-icon"
                    >
                        <path d="M207.9 95.99c26.5 0 47.1-21.49 47.1-47.99S234.4 0 207.9 0S159.1 21.49 159.1 47.99S181.4 95.99 207.9 95.99zM73.61 385.7c-3.25 8.125-7.998 15.5-14.25 21.49l-49.99 50.12c-6.249 6.246-9.373 14.46-9.373 22.68C-.0003 505.1 22.93 512 31.99 512c8.186 0 16.37-3.125 22.62-9.375l59.36-59.48c6.125-6 10.87-13.37 14.25-21.49l13.5-33.74c-55.36-60.23-38.74-41.74-47.49-53.74L73.61 385.7zM320 273.9c0-11.77-6.392-23.15-17.57-28.74l-23.24-11.88L269.4 203.9c-5.552-16.8-33.04-75.89-102.9-75.89c-35.58 0-55.44 10.22-92.58 25.26C52.36 161.9 34.74 178.4 24.24 199.4L17.62 213C15.33 217.6 14.24 222.5 14.24 227.3c0 17.25 13.78 31.97 31.63 31.97c11.6 0 22.78-6.455 28.37-17.63l6.748-13.62c3.5-7 9.248-12.5 16.5-15.38L124.2 201.8L109.1 262.5C107.8 267.6 107.2 272.9 107.2 278c0 15.79 5.886 31.29 16.8 43.24l59.86 65.51c7.25 7.875 12.37 17.38 14.87 27.62l18.37 73.39c3.609 14.45 16.69 24.2 31.04 24.2c19.31 0 32.01-16.13 32.01-32.05c0-2.531-.3053-5.097-.9435-7.652l-22.25-89.01c-2.625-10.38-7.748-20.01-14.87-27.76l-45.49-49.76l17.12-68.63l5.498 16.5c5.375 16.13 16.75 29.38 31.74 37.01l23.24 11.75c4.543 2.29 9.371 3.375 14.13 3.375C304.8 305.8 320 292.5 320 273.9z"></path>
                    </svg>
                    <span>Rejoindre</span>
                </button>
                <button
                    type="button"
                    class="station-panel-join station-panel-join-option"
                    data-route-mode="bicycle"
                    aria-label="Rejoindre à vélo"
                >
                    <svg
                        width="26"
                        height="26"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        aria-hidden="true"
                        focusable="false"
                        class="station-panel-join-icon station-panel-join-icon--bicycle"
                    >
                        <path d="M4 4.5a.5.5 0 0 1 .5-.5H6a.5.5 0 0 1 0 1v.5h4.14l.386-1.158A.5.5 0 0 1 11 4h1a.5.5 0 0 1 0 1h-.64l-.311.935.807 1.29a3 3 0 1 1-.848.53l-.508-.812-2.076 3.322A.5.5 0 0 1 8 10.5H5.959a3 3 0 1 1-1.815-3.274L5 5.856V5h-.5a.5.5 0 0 1-.5-.5m1.5 2.443-.508.814c.5.444.85 1.054.967 1.743h1.139zM8 9.057 9.598 6.5H6.402zM4.937 9.5a2 2 0 0 0-.487-.877l-.548.877zM3.603 8.092A2 2 0 1 0 4.937 10.5H3a.5.5 0 0 1-.424-.765zm7.947.53a2 2 0 1 0 .848-.53l1.026 1.643a.5.5 0 1 1-.848.53z"></path>
                    </svg>
                    <span>Rejoindre</span>
                </button>
            </div>
            <button
                type="button"
                class="station-panel-join station-panel-join-start"
                data-route-action="start"
                hidden
            >
                Démarrer
            </button>
            <button
                type="button"
                class="station-panel-change-mode"
                data-route-action="change-mode"
                hidden
            >
                Changer de mode
            </button>
        </div>
    `;

    if (isActiveNavigationPanel) {
        navigationControls = `
            <div class="station-panel-navigation-controls">
                <button type="button" class="station-panel-join" data-route-mode="${navigationMode}" disabled>
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
                        data-route-mode="${navigationMode}"
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
                    data-route-mode="${navigationMode}"
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
