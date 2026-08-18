import L from 'leaflet';
import { getAvailabilityLegend } from './availability.js';

let legend = null;




function getLegendTitle(displayMode) {

    return displayMode === 'bikes'
        ? '🚲 Disponibilité vélos'
        : displayMode === 'electric'
            ? '⚡ Disponibilité électrique'
            : '🅿️ Places disponibles';
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


        
        div.innerHTML = `

            <div class="legend-title">
                <strong>${getLegendTitle(displayMode)}</strong>
            </div>
            
            <hr>

            ${items.map(item => `

                <div class="legend-item">

                    <span
                        class="legend-color"
                        style="background:${item.color}"
                    ></span>

                    ${item.label}

                </div>

            `).join('')}
        `;

        return div;
    };

    legend.addTo(map);
}