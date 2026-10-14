export function formatDistance(kilometers) {
    const meters = Math.round(kilometers * 1000);

    if (meters < 1000) {
        return `${meters} m`;
    }

    return `${kilometers.toFixed(1)} km`;
}

export function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);

    if (minutes < 60) {
        return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return remainingMinutes > 0
        ? `${hours} h ${remainingMinutes}`
        : `${hours} h`;
}