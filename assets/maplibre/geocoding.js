const GEOCODING_URL =
    'https://data.geopf.fr/geocodage/search/';

export async function geocode(query) {

    const url = new URL(GEOCODING_URL);

    url.searchParams.set('q', query);
    url.searchParams.set('limit', '1');

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `Erreur de géocodage : ${response.status}`
        );
    }

    const data = await response.json();
        
    if (!data.features?.length) {
        return null;
    }

    const feature = data.features[0];

    if (
        !feature.geometry?.coordinates ||
        feature.geometry.coordinates.length < 2
    ) {
        return null;
    }
    
    return {
        latitude: feature.geometry.coordinates[1],
        longitude: feature.geometry.coordinates[0]
    };
}