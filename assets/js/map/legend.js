import L from 'leaflet';

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


        div.innerHTML = `

            <strong>
                ${getLegendTitle(displayMode)}
            </strong><br>


            🟢 10 ${getModeLabel(displayMode)} ou plus<br>

            🟠 1 à 9 ${getModeLabel(displayMode)}<br>

            🔴 Pas de ${getModeLabel(displayMode)}

        `;


        return div;
    };


    legend.addTo(map);
}