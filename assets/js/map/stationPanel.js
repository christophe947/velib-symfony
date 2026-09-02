import { setStationPanelClosed } from './state.js';
import {
    updateStationPanelDimensions
} from '../responsive.js';


export function updateStationPanel(station) {

    const panel = document.getElementById('station-panel');

    if (!panel) {
        return;
    }

    // Initialisation unique du comportement responsive du panneau.
          
    if (!panel.dataset.initialized) {

        panel.addEventListener('pointerdown', event => {
            event.stopPropagation();
        });

        panel.addEventListener('pointermove', event => {
            event.stopPropagation();
        });

        const closeButton = panel.querySelector('.btn-close');

        if (closeButton) {

            closeButton.addEventListener('click', () => {

                panel.classList.remove('is-open');
                document.body.classList.remove('station-panel-open');

                setStationPanelClosed(true);
            });
        }


        const handle = panel.querySelector('.station-panel-handle');

        if (handle) {

    let startY = 0;
    let startOffset = 0;
    let hasDragged = false;
    let wasOpen = false;
    let isDragging = false;

    handle.addEventListener('pointerdown', (event) => {

        isDragging = true;

        wasOpen = panel.classList.contains('is-open');

        hasDragged = false;

        handle.setPointerCapture(event.pointerId);

        startY = event.clientY;

        startOffset =
            parseFloat(
                getComputedStyle(panel)
                    .getPropertyValue('--drag-offset')
            ) || 0;

        panel.classList.add('is-dragging');
    });


    handle.addEventListener('pointermove', (event) => {

        if (!isDragging) {
            return;
        }

        const deltaY = event.clientY - startY;

        if (Math.abs(deltaY) > 5) {
            hasDragged = true;
        }

        const panelHeight =
            panel.getBoundingClientRect().height;

        // Limite haute
        const maxUp =
            -(panelHeight - 24 + 500);

        // Si le panneau était ouvert,
        // on autorise la descente.
        const maxDown =
            wasOpen
                ? panelHeight - 24
                : 0;

        const newOffset =
            Math.max(
                maxUp,
                Math.min(
                    maxDown,
                    startOffset + deltaY
                )
            );

        panel.style.setProperty(
            '--drag-offset',
            `${newOffset}px`
        );
    });

    handle.addEventListener('pointerup', () => {

        if (!isDragging) {
            return;
        }

    isDragging = false;

    if (!hasDragged) {
        panel.classList.remove('is-dragging');
        return;
    }

    const offset =
        parseFloat(
            getComputedStyle(panel)
                .getPropertyValue('--drag-offset')
        ) || 0;

    const panelHeight =
        panel.getBoundingClientRect().height;

    const closeThreshold =
        (panelHeight - 24) * 0.05;

    if (Math.abs(offset) < closeThreshold) {

        panel.style.setProperty(
            '--drag-offset',
            '0px'
        );

        return;
    }


    /*
     * Si on a suffisamment tiré vers le bas,
     * on ferme le panneau.
     */

    if (offset > closeThreshold) {

        panel.classList.remove('is-open');

        document.body.classList.remove(
            'station-panel-open'
        );

        setStationPanelClosed(true);

    } else {

        /*
         * Sinon, le panneau reste ouvert.
         */

        panel.classList.add('is-open');

        requestAnimationFrame(() => {
    updateStationPanelDimensions();
});

        document.body.classList.add(
            'station-panel-open'
        );

        setStationPanelClosed(false);
    }


    /*
     * Retour à la position normale.
     * La transition CSS s'occupe de l'animation.
     */

    panel.classList.remove('is-dragging');

    

    panel.style.setProperty(
        '--drag-offset',
        '0px'
    );


    panel.addEventListener(
        'transitionend',
        () => {

            panel.style.removeProperty(
                '--drag-offset'
            );

        },
        { once: true }
    );

});

handle.addEventListener('pointercancel', () => {

    isDragging = false;

    panel.classList.remove('is-dragging');

    panel.style.setProperty(
        '--drag-offset',
        '0px'
    );
});

/*
    handle.addEventListener('pointerup', () => {

        if (!hasDragged) {
            panel.classList.remove('is-dragging');
            return;
        }

        const offset =
            parseFloat(
                getComputedStyle(panel)
                    .getPropertyValue('--drag-offset')
            ) || 0;

        const panelHeight =
            panel.getBoundingClientRect().height;

        const totalDistance =
            panelHeight - 24;

        const progress =
            Math.abs(offset) / totalDistance;


        if (progress > 0.5) {

            panel.classList.add('is-open');

            document.body.classList.add(
                'station-panel-open'
            );

            setStationPanelClosed(false);

        } else {

            panel.classList.remove('is-open');

            document.body.classList.remove(
                'station-panel-open'
            );

            setStationPanelClosed(true);
        }


        // On remet l'offset à zéro :
        // le CSS prend ensuite le relais
        // pour aller à la position ouverte/fermée.
        panel.classList.remove('is-dragging');
        panel.style.setProperty(
            '--drag-offset',
            '0px'
        );

        panel.addEventListener(
            'transitionend',
            () => {

                panel.style.removeProperty(
                    '--drag-offset'
                );

                panel.classList.remove(
                    'is-dragging'
                );

            },
            { once: true }
        );
    });*/
}

        panel.dataset.initialized = 'true';
    }


    // Éléments du panneau.

    const title =
        document.getElementById('station-panel-title');

    const body =
        panel.querySelector('.station-panel-body');


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
                ⚡ <strong>${station.electricBikes}</strong>
                vélos électriques
            </p>

            <p>
                🔧 <strong>${station.mechanicalBikes}</strong>
                vélos mécaniques
            </p>

            <p>
                🅿️ <strong>${station.docks}</strong>
                places libres
            </p>

        </div>
    `;
}

