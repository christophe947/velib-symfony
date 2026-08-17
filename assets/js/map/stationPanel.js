import { setStationPanelClosed } from './state.js';


export function updateStationPanel(station) {

    const panel = document.getElementById('station-panel');

    if (!panel) {
        return;
    }

    // Initialisation unique du comportement responsive du panneau.
      

    // Initialisation unique des événements Bootstrap Offcanvas.
    
    if (!panel.dataset.initialized) {

        const closeButton = panel.querySelector('.btn-close');

        if (closeButton) {

            closeButton.addEventListener('click', () => {

                panel.classList.remove('is-open');
                document.body.classList.remove('station-panel-open');
                setStationPanelClosed(true);
            });
        }
        panel.dataset.initialized = 'true';
    }


    // Éléments du panneau.
     
    const title = document.getElementById('station-panel-title');

    const body = panel.querySelector('.station-panel-body');

    if (!title || !body) {
        return;
    }

    
    // Mise à jour des informations.
     
    title.textContent = station.name;


    body.innerHTML = `
        <div class="station-info">

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


    // Sur mobile uniquement : ouverture du panneau Bootstrap.
    
    const mediaQuery = window.matchMedia('(min-width: 990px)');

    if (!mediaQuery.matches) {
        document.body.classList.add('station-panel-open');
        panel.classList.add('is-open');
    }
}

