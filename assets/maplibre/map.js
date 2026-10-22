import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';

import { stationsToGeoJSON } from './stations.js';
import { addStationLayer } from './stationLayer.js';
import {
    loadArrondissements,
    loadCommunes,
    countStationsByZone,
    filterZonesWithStations
} from './zones.js';
import { addZoneLayer } from './zoneLayer.js';
import { addCommuneLayer } from './communeLayer.js';

//let destinationMarker = null;

// État du mode d'affichage de la carte.
let is3D = false;

// État de la navigation.
let isNavigationActive = false;

// État du suivi automatique de la caméra.
let isFollowingUser = false;

let lastKnownUserPosition = null;

// Dernier cap GPS filtré pour l'orientation de la caméra.
let lastStableHeading = null;

// Vitesse minimale pour considérer le cap GPS comme fiable.
const MIN_HEADING_SPEED = 0.8;

// Intensité du lissage : plus la valeur est faible,
// plus les rotations sont progressives.
const HEADING_SMOOTHING_FACTOR = 0.25;

let destinationMarker = null;

let isChangingView = false;

let pendingUserPosition = null;


/**
 * Contrôle permettant de basculer entre les vues 2D et 3D.
 */
class ViewModeControl {

    onAdd(map) {

        this.map = map;
        //this.is3D = false;

        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl map-view-control';

        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'map-view-button';
        this.button.textContent = '3D';
        this.button.setAttribute('aria-label', 'Passer en vue 3D');
        this.button.title = 'Passer en vue 3D';

        this.button.addEventListener('click', () => {
            this.toggleView();
        });

        this.container.appendChild(this.button);

        return this.container;
    }

    async toggleView() {

        // Empêche les transitions successives de se chevaucher.
        if (isChangingView) {
            return;
        }

        isChangingView = true;

        is3D = !is3D;

        const targetPitch = is3D ? 55 : 0;

        this.button.textContent = is3D ? '2D' : '3D';

        this.button.setAttribute(
            'aria-label',
            is3D
                ? 'Revenir en vue 2D'
                : 'Passer en vue 3D'
        );

        this.button.title = is3D
            ? 'Revenir en vue 2D'
            : 'Passer en vue 3D';

        try {
            await new Promise(resolve => {
                this.map.easeTo({
                    pitch: targetPitch,
                    bearing: is3D ? this.map.getBearing() : 0,
                    duration: 700,
                    essential: true
                });

                this.map.once('moveend', resolve);
            });
        } finally {
            isChangingView = false;

            if (pendingUserPosition) {
                const position = pendingUserPosition;
                pendingUserPosition = null;

                followUserPosition(this.map, position);
            }
        }
    }

    onRemove() {

        this.container.remove();
        this.map = undefined;
    }
}


class RecenterControl {


onAdd(map) {
    this.map = map;

    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl map-recenter-control';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'map-recenter-button';
    this.button.textContent = '◎';
    this.button.title = 'Recentrer sur ma position';
    this.button.setAttribute(
        'aria-label',
        'Recentrer sur ma position'
    );

    this.button.addEventListener('click', () => {
        recenterOnUser(this.map, lastKnownUserPosition);
    });

    this.container.appendChild(this.button);

    return this.container;
}

onRemove() {
    this.container.remove();
    this.map = undefined;
}


}

function smoothHeading(currentHeading, targetHeading) {
    // Normalise les angles entre 0 et 360 degrés.
    const normalize = angle => ((angle % 360) + 360) % 360;

    const current = normalize(currentHeading);
    const target = normalize(targetHeading);

    // Calcule le plus court chemin entre les deux angles.
    const difference = ((target - current + 540) % 360) - 180;

    // Applique un lissage progressif.
    return normalize(
        current + difference * HEADING_SMOOTHING_FACTOR
    );
}


/**
 * Détecte les interactions manuelles avec la carte.
 */
function initManualCameraControl(map) {

    map.on('dragstart', () => {
        isFollowingUser = false;
    });
}



export function createMap() {

    const map = new maplibregl.Map({
        container: 'maplibre-map',
        style: 'https://openmaptiles.data.gouv.fr/styles/osm-bright/style.json',
        center: [2.3522, 48.8566],
        zoom: 11,
        maxZoom: 18,
        minZoom: 10.5,
    });

    // Bouton de changement de vue 2D / 3D.
    map.addControl(
        new ViewModeControl(),
        'top-right'
    );

    const recenterControl = new RecenterControl();

    map.addControl(
        recenterControl,
        'top-right'
    );

    initManualCameraControl(map);

    const stations = window.stations ?? [];


    const geoJSON = stationsToGeoJSON(stations);



    
    map.on('load', async () => {

    map.addSource('stations', {
        type: 'geojson',
        data: geoJSON
    });

    const communes = await loadCommunes();

    addCommuneLayer(
        map,
        communes
    );

    const zones = await loadArrondissements();

    const zonesWithStations = countStationsByZone(
        zones,
        window.stations ?? []
    );

    addZoneLayer(
        map,
        zonesWithStations
    );

    addStationLayer(
        map,
        'bikes'
    );
});


    return map;

}




export function drawWalkingRoute(map, coordinates) {

    const sourceId = 'walking-route';
    const layerId = 'walking-route';

    if (map.getSource(sourceId)) {
        map.removeLayer(layerId);
        map.removeSource(sourceId);
    }

    map.addSource(sourceId, {
        type: 'geojson',

        data: {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates
            }
        }
    });

    map.addLayer({
        id: layerId,
        type: 'line',

        source: sourceId,

        paint: {
            'line-color': '#198754',
            'line-width': 5,
            'line-opacity': 0.9
        }
    });
}


export function updateWalkingRoute(map, coordinates) {

    const source = map.getSource('walking-route');

    if (!source || !coordinates?.length) {
        return;
    }

    source.setData({
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates
        },
        properties: {}
    });
}


export function fitWalkingRoute(map, coordinates) {

    if (!coordinates?.length) {
        return;
    }

    const bounds = new maplibregl.LngLatBounds();

    coordinates.forEach(coordinate => {
        bounds.extend(coordinate);
    });

    map.fitBounds(bounds, {
        padding: {
            top: 120,
            bottom: 310,
            left: 40,
            right: 40
        },
        duration: 800,
        maxZoom: 17
    });
}


export function showDestinationMarker(map, position) {

    destinationMarker?.remove();

    const element = document.createElement('div');

    element.className = 'destination-marker';

    element.innerHTML = `
        <span>🚲</span>
    `;

    destinationMarker = new maplibregl.Marker({
        element
    })
        .setLngLat([
            position.longitude,
            position.latitude
        ])
        .setPopup(
            new maplibregl.Popup({ offset: 25 })
                .setText('Station Vélib')
        )
        .addTo(map);
}


/**

* Active ou désactive le suivi automatique de la caméra.
*/
export function setUserFollowing(enabled) {
  isFollowingUser = enabled;
}


export function recenterOnUser(map, position) {
    if (!map || !position) {
        return;
    }

    setUserFollowing(true);

    followUserPosition(map, position);
}

/**
 * Centre progressivement la carte sur la position de l'utilisateur.
 */
/*export function followUserPosition(map, position) {
    if (!map || !position) {
        return;
    }

    lastKnownUserPosition = position;

    if (!isFollowingUser) {
        return;
    }

    // Pendant une transition 2D/3D, mémorise la dernière position
    // sans lancer un mouvement de caméra concurrent.
    if (isChangingView) {
        pendingUserPosition = position;
        return;
    }

    map.easeTo({
        center: [
            position.longitude,
            position.latitude
        ],
        duration: 450,
        essential: true
    });
}*/


export function followUserPosition(map, position) {
    if (!map || !position) {
        return;
    }

    lastKnownUserPosition = position;

    // Si l'utilisateur déplace manuellement la carte,
    // on conserve sa liberté de mouvement.
    if (!isFollowingUser) {
        return;
    }

    // Si une transition 2D/3D est en cours,
    // on attend qu'elle se termine.
    if (isChangingView) {
        pendingUserPosition = position;
        return;
    }

    // Prépare les paramètres de déplacement de la caméra.
    const cameraOptions = {
        center: [position.longitude, position.latitude],
        duration: 450,
        essential: true
    };
    console.log('Orientation GPS :', {
        is3D,
        heading: position.heading,
        speed: position.speed
    });
    // L'orientation GPS est utilisée uniquement en vue 3D,
    // lorsque l'utilisateur se déplace suffisamment.
    if (
        is3D &&
        Number.isFinite(position.heading) &&
        Number.isFinite(position.speed) &&
        position.speed >= MIN_HEADING_SPEED
    ) {
        const currentBearing = lastStableHeading ?? map.getBearing();

        lastStableHeading = smoothHeading(
            currentBearing,
            position.heading
        );

        cameraOptions.bearing = lastStableHeading;
    }

    // Déplace la caméra sans modifier le zoom ni l'inclinaison.
    map.easeTo(cameraOptions);
}