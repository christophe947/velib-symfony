import * as maplibregl from '/maplibre-assets/maplibre-gl.mjs';

import { stationsToGeoJSON } from './map/stations.js';
import { addStationLayer } from './map/layers/stationLayer.js';
import { loadGeographicData } from './geography/zones.js';
import { addZoneLayer } from './map/layers/zoneLayer.js';
import { addCommuneLayer } from './map/layers/communeLayer.js';
import {
    showUserMarker,
    showUserMarkerCompass,
    hideUserMarkerCompass,
    requestUserPosition,
} from './location/geolocation.js';
import * as userTracking from './location/userTracking.js';
import {
    canReactivateCompass,
    startCompass,
} from './navigation/compass.js';
import { createCameraController } from './map/cameraController.js';
import {
    clearRouteLayer,
    drawWalkingRoute,
    fitWalkingRoute,
    showDestinationMarker,
    updateWalkingRoute,
} from './map/layers/routeLayer.js';

const STYLE_URL =
    'https://openmaptiles.data.gouv.fr/styles/osm-bright/style.json';

export {
    drawWalkingRoute,
    fitWalkingRoute,
    showDestinationMarker,
    updateWalkingRoute,
};

let isNavigationActive = false;

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

                recenterOnUser(this.map, userPosition);

                startBackgroundUserTracking(this.map);

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
        style: STYLE_URL,
        center: [2.3522, 48.8566],
        zoom: 11,
        maxZoom: 18,
        minZoom: 10.5,
    });

    const styleReady = new Promise((resolve, reject) => {
        let timeoutId;
        let settled = false;

        const cleanup = () => {
            clearTimeout(timeoutId);
            map.off('style.load', onStyleLoad);
            map.off('error', onMapError);
        };

        const onStyleLoad = () => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            resolve();
        };

        const onMapError = (event) => {
            if (settled || event.error?.url !== STYLE_URL) {
                return;
            }

            settled = true;
            cleanup();
            reject(
                new Error(
                    'Le chargement du style cartographique initial a échoué.',
                    { cause: event.error },
                ),
            );
        };

        timeoutId = setTimeout(() => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            reject(
                new Error(
                    'Le chargement du style MapLibre a dépassé le délai autorisé de 30 secondes.',
                ),
            );
        }, 30_000);

        map.on('style.load', onStyleLoad);
        map.on('error', onMapError);
    });

    // Prevent an unhandled rejection if the style fails before navigation is requested.
    styleReady.catch(() => {});

    const cameraController = createCameraController(map, {
        onViewModeChange: (is3D) => {
            viewModeControl?.updateMode(is3D);
        },
        onCompassControlSuspended: () => {
            hideUserMarkerCompass(map);
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

        let geographicData;

        try {
            geographicData = await loadGeographicData(window.stations ?? []);
        } catch (error) {
            console.error(
                'Impossible d’initialiser les couches géographiques de la carte :',
                error,
            );
            return;
        }

        const { communes, arrondissementsWithStationCount } = geographicData;

        addCommuneLayer(map, communes);

        addZoneLayer(map, arrondissementsWithStationCount);

        addStationLayer(map, 'bikes');

    });

    return { map, styleReady };
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

function updateCameraFromCompass(map, reading) {
    if (!map || !reading) {
        return false;
    }

    return getCameraController()?.updateFromCompass(reading) === true;
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
    if (!map || isNavigationActive) {
        return;
    }

    userTracking.start(
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
    userTracking.stop();
}

/**
 * Nettoie les éléments de navigation sur la carte.
 */
export function clearNavigationMap(map) {
    const cameraController = getCameraController();
    const wasFollowingUser = cameraController?.isFollowing() ?? false;

    cameraController?.setFollowing(false);
    isNavigationActive = false;
    cameraController?.clearPendingPosition();

    // Supprime le tracé et le marqueur de destination.
    clearRouteLayer(map);

    return wasFollowingUser;
}

export async function activateCompass(
    map,
    onReading,
    onError,
    canControlCamera = () => true,
) {
    await startCompass((reading) => {
        const isReadingAccepted =
            canControlCamera() && updateCameraFromCompass(map, reading);

        if (isReadingAccepted) {
            showUserMarkerCompass(
                map,
                reading.compassHeading,
                reading.timestamp,
            );
        } else {
            hideUserMarkerCompass(map);
        }

        onReading?.(reading);
    }, (error) => {
        hideUserMarkerCompass(map);
        onError?.(error);
    });
}

export async function reactivateCompassIfEligible(map) {
    const cameraController = getCameraController();

    if (
        !map ||
        isNavigationActive ||
        !canReactivateCompass() ||
        !cameraController?.canUseCompass()
    ) {
        return;
    }

    await activateCompass(map);
}
