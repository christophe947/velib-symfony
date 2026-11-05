import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';

import { stationsToGeoJSON } from './stations.js';
import { addStationLayer } from './stationLayer.js';
import {
    loadArrondissements,
    loadCommunes,
    countStationsByZone,
    //filterZonesWithStations
} from './zones.js';
import { addZoneLayer } from './zoneLayer.js';
import { addCommuneLayer } from './communeLayer.js';
import {
    showUserMarker,
    requestUserPosition,
    startWatchingPosition,
} from './geolocation.js';
import { startCompass } from './compass.js';
import { createCameraController } from './cameraController.js';
import {
    clearRouteLayer,
    drawWalkingRoute,
    fitWalkingRoute,
    showDestinationMarker,
    updateWalkingRoute,
} from './routeLayer.js';

export {
    drawWalkingRoute,
    fitWalkingRoute,
    showDestinationMarker,
    updateWalkingRoute,
};
//import { getLastCompassReading } from './compass.js';

let isNavigationActive = false;

let backgroundPositionWatchId = null;

let viewModeControl = null;

/**
 * Contrôle permettant de basculer entre les vues 2D et 3D.
 */
class ViewModeControl {
    constructor(cameraController) {
        this.cameraController = cameraController;
    }

    onAdd(map) {
        viewModeControl = this;

        this.map = map;

        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl map-view-control';

        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'map-view-button';
        this.updateMode(false);

        this.button.addEventListener('click', () => {
            this.toggleView();
        });

        this.container.appendChild(this.button);

        return this.container;
    }

    toggleView() {
        return this.cameraController.toggleView();
    }

    updateMode(is3D) {
        this.button.textContent = is3D ? '2D' : '3D';

        this.button.setAttribute(
            'aria-label',
            is3D ? 'Revenir en vue 2D' : 'Passer en vue 3D',
        );

        this.button.title = is3D ? 'Revenir en vue 2D' : 'Passer en vue 3D';
    }

    onRemove() {
        this.container.remove();
        this.map = undefined;
    }
}

function getCameraController() {
    return viewModeControl?.cameraController ?? null;
}

/**
 * Garantit que la carte est en vue 2D.
 * Attend la fin de la transition si un changement est nécessaire.
 */
export async function ensure2DView() {
    await getCameraController()?.ensure2DView();
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
        this.button.setAttribute('aria-label', 'Recentrer sur ma position');

        this.button.addEventListener('click', async () => {
            this.button.disabled = true;

            try {
                // Récupère la position avec la fonction déjà utilisée
                // par le système de navigation.
                const userPosition = await requestUserPosition();

                // Affiche le marqueur de position.
                showUserMarker(this.map, userPosition);

                // Si la navigation est active, réactive le suivi.
                //if (isNavigationActive) {
                recenterOnUser(this.map, userPosition);

                startBackgroundUserTracking(this.map);
                //} else {
                // Sinon, recentrage ponctuel sans démarrer la navigation.
                /*this.map.easeTo({
                center: [
                    userPosition.longitude,
                    userPosition.latitude
                ],
                zoom: 17,
                duration: 500,
                essential: true
            });
        }*/
            } catch (error) {
                console.error(
                    'Impossible de récupérer la position GPS :',
                    error,
                );

                alert(
                    'Impossible de te localiser. Vérifie que la géolocalisation est autorisée.',
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

export function createMap() {
    const map = new maplibregl.Map({
        container: 'maplibre-map',
        style: 'https://openmaptiles.data.gouv.fr/styles/osm-bright/style.json',
        center: [2.3522, 48.8566],
        zoom: 11,
        maxZoom: 18,
        minZoom: 10.5,
    });

    const cameraController = createCameraController(map, {
        onViewModeChange: (is3D) => {
            viewModeControl?.updateMode(is3D);
        },
        onCompassActivationRequested: async () => {
            if (!isNavigationActive) {
                await activateCompass(map);
            }
        },
        shouldUseGpsHeading: () => !isNavigationActive,
    });

    // Bouton de changement de vue 2D / 3D.
    map.addControl(new ViewModeControl(cameraController), 'top-right');

    const recenterControl = new RecenterControl();

    map.addControl(recenterControl, 'top-right');

    cameraController.initManualCameraControl();

    const stations = window.stations ?? [];

    const geoJSON = stationsToGeoJSON(stations);

    map.on('load', async () => {
        //map.resize();

        map.addSource('stations', {
            type: 'geojson',
            data: geoJSON,
        });

        const communes = await loadCommunes();

        addCommuneLayer(map, communes);

        const zones = await loadArrondissements();

        const zonesWithStations = countStationsByZone(
            zones,
            window.stations ?? [],
        );

        addZoneLayer(map, zonesWithStations);

        addStationLayer(map, 'bikes');

        //map.resize();
    });

    return map;
}

/**

* Active ou désactive le suivi automatique de la caméra.
*/
export function setUserFollowing(enabled) {
    getCameraController()?.setFollowing(enabled);
}

export function setNavigationActive(enabled) {
    isNavigationActive = enabled;
}

export function updateCameraFromCompass(map, reading) {
    if (!map || !reading) {
        return;
    }

    getCameraController()?.updateFromCompass(reading);
}

export function recenterOnUser(map, position) {
    if (!map || !position) {
        return;
    }

    getCameraController()?.recenter(position);
}

export function followUserPosition(map, position) {
    if (!map || !position) return;

    getCameraController()?.followPosition(position);
}

export function startBackgroundUserTracking(map) {
    if (!map || backgroundPositionWatchId !== null || isNavigationActive) {
        return;
    }

    backgroundPositionWatchId = startWatchingPosition(
        (position) => {
            showUserMarker(map, position);
            followUserPosition(map, position);
        },
        (error) => {
            console.error('Erreur du suivi GPS :', error);
        },
    );
}

export function stopBackgroundUserTracking() {
    if (backgroundPositionWatchId === null) {
        return;
    }

    navigator.geolocation.clearWatch(backgroundPositionWatchId);
    backgroundPositionWatchId = null;
}

/**
 * Nettoie les éléments de navigation sur la carte.
 */
export function clearNavigationMap(map) {
    const cameraController = getCameraController();

    cameraController?.setFollowing(false);
    isNavigationActive = false;
    cameraController?.clearPendingPosition();

    // Supprime le tracé et le marqueur de destination.
    clearRouteLayer(map);
}

export async function activateCompass(
    map,
    onReading,
    onError,
    canControlCamera = () => true,
) {
    await startCompass((reading) => {
        if (canControlCamera()) {
            updateCameraFromCompass(map, reading);
        }

        onReading?.(reading);
    }, onError);
}
