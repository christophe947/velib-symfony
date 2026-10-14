let updateCallback = null;

/**
 * Enregistre la fonction chargée de mettre à jour
 * les informations de l'itinéraire dans le panneau.
 */
export function setRouteSummaryCallback(callback) {
    updateCallback = callback;
}

/**
 * Transmet les nouvelles informations au panneau.
 */
export function updateRouteSummary(distance, duration) {
    updateCallback?.(distance, duration);
}