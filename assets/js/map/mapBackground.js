import L from 'leaflet';

import {
    setMapBackground,
    getMapBackground
} from './state.js';


export function initMapBackground(options) {

    const {
        map,
        standardLayer,
        watercolorLayer,
        labelsLayer
    } = options;


    const backgroundControl = L.control({
        position: 'topright'
    });


    backgroundControl.onAdd = function () {

        const container = L.DomUtil.create(
            'div',
            'map-background-control leaflet-bar'
        );


        const button = L.DomUtil.create(
            'button',
            'map-background-button',
            container
        );


        button.type = 'button';


        L.DomEvent.disableClickPropagation(container);


        function updateButton() {

            const background = getMapBackground();

            button.textContent =
                background === 'watercolor'
                    ? '🎨'
                    : '🗺️';

            button.setAttribute(
                'aria-label',
                background === 'watercolor'
                    ? 'Passer au fond standard'
                    : 'Passer au fond watercolor'
            );
        }


        button.addEventListener('click', () => {

            const background = getMapBackground();


            if (background === 'watercolor') {

                setMapBackground('standard');

                map.removeLayer(watercolorLayer);
                map.removeLayer(labelsLayer);

                map.addLayer(standardLayer);

            } else {

                setMapBackground('watercolor');

                map.removeLayer(standardLayer);

                map.addLayer(watercolorLayer);
                map.addLayer(labelsLayer);
            }


            updateButton();
        });


        updateButton();


        return container;
    };


    backgroundControl.addTo(map);
}