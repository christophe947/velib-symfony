import L from 'leaflet';
import { getAvailabilityLegend } from './availability.js';

let legend = null;
let displayMode =
    localStorage.getItem('mapMode') || 'bikes';


function getLegendTitle(displayMode) {

    return displayMode === 'bikes'
        ? 'Disponibilité vélos'
        : 'Places disponibles';
}


function getModeLabel(displayMode) {

    return displayMode === 'bikes'
        ? 'vélos disponibles'
        : 'places disponibles';
}


export function updateLegend(map, displayMode) {

    if (!map) {
        return;
    }

    if (legend) {
        legend.remove();
    }

    legend = L.control({
        position: 'bottomright'
    });


    legend.onAdd = function () {

        const div = L.DomUtil.create(
            'div',
            'map-legend'
        );

        const items = getAvailabilityLegend();


        div.innerHTML = items.map(item => `

            <div class="legend-item">

                <span 
                    class="legend-color"
                    style="background:${item.color}"
                ></span>

                ${item.label}

            </div>

        `).join('');


        return div;
    };

    legend.addTo(map);
}