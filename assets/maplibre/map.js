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
import { showUserMarker, requestUserPosition } from './geolocation.js';
//import { getLastCompassReading } from './compass.js';

//let destinationMarker = null;

// État du mode d'affichage de la carte.
let is3D = false;

// État de la navigation.
let isNavigationActive = false;

// État du suivi automatique de la caméra.
let isFollowingUser = false;

// Suspension temporaire du pilotage de la caméra par la boussole.
let isCompassCameraPaused = false;

// Gestion temporaire des interactions manuelles avec la carte
let isCameraInteractionActive = false;
let cameraResumeTimeout = null;

let viewModeControl = null;

let lastKnownUserPosition = null;

// Dernier cap GPS filtré pour l'orientation de la caméra.
let lastStableHeading = null;

// Vitesse minimale pour considérer le cap GPS comme fiable.
const MIN_HEADING_SPEED = 0.8;

// Intensité du lissage : plus la valeur est faible,
// plus les rotations sont progressives.
const HEADING_SMOOTHING_FACTOR = 0.6;

let destinationMarker = null;

let isChangingView = false;

let pendingUserPosition = null;


/**
 * Contrôle permettant de basculer entre les vues 2D et 3D.
 */
class ViewModeControl {

    onAdd(map) {

        viewModeControl = this;

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

        // Empêche la boussole de perturber la transition 2D / 3D.
        isCompassCameraPaused = true;

        // Termine les éventuelles animations précédentes.
        this.map.stop();
        
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
                // On écoute la fin du mouvement avant de lancer l'animation.
                this.map.once('moveend', resolve);

                this.map.easeTo({
                    pitch: targetPitch,
                    bearing: is3D ? this.map.getBearing() : 0,
                    duration: 700,
                    essential: true
                });
            });
        } finally {
            // La transition est terminée : on autorise de nouveau
            // les mises à jour de la caméra par la boussole.
            isChangingView = false;
            isCompassCameraPaused = false;

            // On récupère la dernière position reçue pendant la transition.
            if (pendingUserPosition) {
                const position = pendingUserPosition;
                pendingUserPosition = null;

                // On reprend le suivi GPS après la transition.
                followUserPosition(this.map, position);
            }
        }


    }

    onRemove() {

        this.container.remove();
        this.map = undefined;
    }
}

/**
 * Garantit que la carte est en vue 2D.
 * Attend la fin de la transition si un changement est nécessaire.
 */
export async function ensure2DView() {
    if (!is3D) {
        return;
    }

    await viewModeControl?.toggleView();
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

    this.button.addEventListener('click', async () => {
    this.button.disabled = true;

    try {
        // Récupère la position avec la fonction déjà utilisée
        // par le système de navigation.
        const userPosition = await requestUserPosition();

        // Affiche le marqueur de position.
        showUserMarker(this.map, userPosition);

        // Si la navigation est active, réactive le suivi.
        if (isNavigationActive) {
            recenterOnUser(this.map, userPosition);
        } else {
            // Sinon, recentrage ponctuel sans démarrer la navigation.
            this.map.easeTo({
                center: [
                    userPosition.longitude,
                    userPosition.latitude
                ],
                zoom: 17,
                duration: 500,
                essential: true
            });
        }

    } catch (error) {
        console.error('Impossible de récupérer la position GPS :', error);

        alert(
            'Impossible de te localiser. Vérifie que la géolocalisation est autorisée.'
        );
    } finally {
        this.button.disabled = false;
    }
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

* Actualise directement l'orientation de la caméra
* à partir des nouvelles mesures de la boussole.
  */
  export function updateCameraFromCompass(map, reading) {
    if (!map || !reading) {
        return;
    }

    // La boussole pilote la caméra uniquement en navigation 3D,
    // lorsque le suivi est actif et qu'aucune transition n'est en cours.
    if (
        !is3D ||
        !isFollowingUser ||
        isChangingView ||
        isCameraInteractionActive ||
        isCompassCameraPaused
    ) {
        return;
    }

    // Vérifie que la mesure est récente.
    const isReadingFresh =
        Number.isFinite(reading.timestamp) &&
        Date.now() - reading.timestamp < 1500;

    if (!isReadingFresh) {
        return;
    }

    const compassHeading = reading.compassHeading;

    if (!Number.isFinite(compassHeading)) {
        return;
    }

    // Conserve le lissage du cap.
    const currentBearing =
        lastStableHeading ?? map.getBearing();

    lastStableHeading = smoothHeading(
        currentBearing,
        compassHeading
    );

    
    // Anime progressivement l'orientation de la caméra. 
    map.easeTo({ 
        bearing: lastStableHeading, 
        duration: 100, 
        essential: true 
    });
}


/**
 * Détecte les interactions manuelles avec la carte.
 */
/**
 * Suspend temporairement le contrôle automatique de la caméra
 * pendant les interactions manuelles avec la carte.
 */
function initManualCameraControl(map) {

    function suspendCameraControl() {
        clearTimeout(cameraResumeTimeout);

        console.log('Suspension caméra déclenchée', {
        following: isFollowingUser,
        time: new Date().toLocaleTimeString()
    });

        isCameraInteractionActive = true;
        isFollowingUser = false;
    }

    function scheduleCameraResume() {
        clearTimeout(cameraResumeTimeout);

        cameraResumeTimeout = setTimeout(() => {
            isCameraInteractionActive = false;
        }, 500);
    }

    // Début des interactions tactiles
    map.on('touchstart', suspendCameraControl);

    // Fin des interactions tactiles
    map.on('touchend', scheduleCameraResume);
    map.on('touchcancel', scheduleCameraResume);

    // Déplacement manuel
    map.on('dragstart', suspendCameraControl);
    map.on('dragend', scheduleCameraResume);

    // Zoom manuel à la molette. zoomstart se déclenche aussi pour les animations programmatiques.
    map.on('wheel', () => {
        suspendCameraControl();
        scheduleCameraResume();
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

    //map.resize();

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

    //map.resize();
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

export function setNavigationActive(enabled) {
    isNavigationActive = enabled;
}

export function recenterOnUser(map, position) {
    if (!map || !position) {
        return;
    }

    // Suspend temporairement le contrôle automatique de la caméra.
    isCompassCameraPaused = true;

    // Réactive le suivi et mémorise la position GPS.
    setUserFollowing(true);
    lastKnownUserPosition = position;

    // Termine les animations précédentes.
    map.stop();

    // Attend la fin du recentrage avant de réactiver la boussole.
    map.once('moveend', () => {
        isCompassCameraPaused = false;
    });

    // Une seule animation pour le recentrage et le zoom.
    map.easeTo({
        center: [
            position.longitude,
            position.latitude
        ],
        zoom: 17,
        pitch: is3D ? 55 : 0,
        duration: 500,
        essential: true
    });
}




export function followUserPosition(map, position) {
    if (!map || !position) return;

    lastKnownUserPosition = position;

    if (!isFollowingUser) return;

    if (isChangingView) {
        pendingUserPosition = position;
        return;
    }

    if (isCompassCameraPaused) {
        return;
    }

    // Vérifie si le cap GPS est suffisamment fiable.
    const isGpsHeadingReliable =
        Number.isFinite(position.heading) &&
        Number.isFinite(position.speed) &&
        position.speed >= MIN_HEADING_SPEED;

    // Distance entre le centre de la carte et la position GPS.
    const distanceToUser = map.getCenter().distanceTo([
        position.longitude,
        position.latitude
    ]);

    /*
     * En 3D, lorsque le cap GPS n'est pas fiable
     * (notamment à l'arrêt), on ignore les petits déplacements GPS.
     *
     * Cela évite de relancer constamment l'animation de la caméra
     * à cause des imprécisions du GPS.
     */
    if (
        is3D &&
        !isGpsHeadingReliable &&
        distanceToUser < 3
    ) {
        return;
    }

    const cameraOptions = {
        center: [position.longitude, position.latitude],
        duration: 450,
        essential: true
    };

    // En 2D, on conserve le comportement actuel.
    if (is3D && isGpsHeadingReliable) {
        const currentBearing = lastStableHeading ?? map.getBearing();

        lastStableHeading = smoothHeading(
            currentBearing,
            position.heading
        );

        cameraOptions.bearing = lastStableHeading;
    }

    map.easeTo(cameraOptions);
}


/**
 * Nettoie les éléments de navigation sur la carte.
 */
export function clearNavigationMap(map) {
    // Désactive le suivi automatique de la caméra.
    isFollowingUser = false;
    isNavigationActive = false;

    // Annule une éventuelle position en attente.
    pendingUserPosition = null;

    // Supprime le tracé de navigation.
    if (map.getLayer('walking-route')) {
        map.removeLayer('walking-route');
    }

    if (map.getSource('walking-route')) {
        map.removeSource('walking-route');
    }

    // Supprime le marqueur de destination.
    destinationMarker?.remove();
    destinationMarker = null;
}