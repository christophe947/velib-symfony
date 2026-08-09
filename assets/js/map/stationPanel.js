import { Offcanvas } from 'bootstrap';
import { 
    setOpenedStation,
    setStationPanelClosed
 } from './state.js';


export function updateStationPanel(station) {

    const panel = document.getElementById('station-panel');

    if (!panel) {
        return;
    }

    // Initialisation unique du comportement responsive du panneau.
     
    if (!panel.dataset.responsiveInitialized) {

        const mediaQuery = window.matchMedia('(min-width: 990px)');

        function handleMediaQueryChange(e) {

            if (e.matches) {
                // Grand écran
                panel.classList.remove('offcanvas', 'offcanvas-bottom', 'station-offcanvas');
            } 
        }

        // État initial
        handleMediaQueryChange(mediaQuery);

        // Si la fenêtre change de taille
        mediaQuery.addEventListener('change', handleMediaQueryChange);

        panel.dataset.responsiveInitialized = 'true';
    }

    // Initialisation unique des événements Bootstrap Offcanvas.
    
    if (!panel.dataset.initialized) {

        panel.addEventListener('show.bs.offcanvas', () => {

            document.body.classList.add('station-panel-open');
        });


        panel.addEventListener('hidden.bs.offcanvas', () => {

            document.body.classList.remove('station-panel-open');
            //document.activeElement?.blur();
        });

        const closeButton = panel.querySelector('.btn-close');

        if (closeButton) {

            closeButton.addEventListener('click', () => {
                setStationPanelClosed(true);
            });
        }
        panel.dataset.initialized = 'true';
    }


    // Éléments du panneau.
     
    const title = document.getElementById('station-panel-title');

    const body = panel.querySelector('.offcanvas-body');


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

        const offcanvas = Offcanvas.getOrCreateInstance(panel, { focus: false });

        offcanvas.show();
    }
}

