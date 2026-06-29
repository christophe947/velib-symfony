export function updateStationPanel(station) {

    const panel =
        document.getElementById('station-panel');

    if (!panel) {
        return;
    }

    panel.innerHTML = `
        <div class="station-info">

            <h4>${station.name}</h4>

            <hr>

            <p>
                🚲 <strong>${station.bikes}</strong>
                vélos disponibles
            </p>

            <p>
                🅿️ <strong>${station.docks}</strong>
                places libres
            </p>

        </div>

    `;
}