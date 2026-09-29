const GEOCODING_URL = 'https://data.geopf.fr/geocodage/search/';
const cache = new Map();

function normalizeText(value = '') {
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function uniqueRequests(requests) {
    const unique = new Map();

    requests.forEach(request => {
        const key = [
            normalizeText(request.query),
            request.index,
            request.category ?? '',
        ].join('|');

        if (!unique.has(key)) {
            unique.set(key, request);
        }
    });

    return [...unique.values()];
}

function removeTransportWords(query) {
    return query
        .replace(/\b(rer|metro|métro|gare|station|train)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function removePlacePrefix(query) {
    return query
        .replace(
            /^place\s+(?:(?:de|du|des)\s+)?(?:la\s+)?/i,
            ''
        )
        .replace(/\s+/g, ' ')
        .trim();
}

function buildRequests(query, type) {
    if (type === 'address') {
        return [{
            query,
            index: 'address',
        }];
    }

    const hasRer = /\brer\b/i.test(query);
    const hasMetro = /\b(metro|métro)\b/i.test(query);
    const hasGare = /\b(gare|station|train)\b/i.test(query);
    const requests = [];

    if (hasRer || hasMetro || hasGare) {
        // Essai avec la saisie d'origine et avec le nom du lieu seul.
        requests.push({
            query,
            index: 'poi',
            category: 'transport',
        });

        const destination = removeTransportWords(query);

        if (destination) {
            requests.push({
                query: `${destination}, Paris`,
                index: 'poi',
                category: 'transport',
            });

            requests.push({
                query: `Gare de ${destination}, Paris`,
                index: 'poi',
                category: 'transport',
            });

            requests.push({
                query: `Station de métro ${destination}, Paris`,
                index: 'poi',
                category: 'transport',
            });
        }

        return uniqueRequests(requests);
    }

    // Recherche de POI avec et sans le préfixe « Place ».
    requests.push({
        query,
        index: 'poi',
    });

    requests.push({
        query: `${query}, Paris`,
        index: 'poi',
    });

    const placeName = removePlacePrefix(query);

    if (placeName && normalizeText(placeName) !== normalizeText(query)) {
        requests.push({
            query: `${placeName}, Paris`,
            index: 'poi',
        });

        requests.push({
            query: `Station de métro ${placeName}, Paris`,
            index: 'poi',
            category: 'transport',
        });
    } else if (placeName) {
        requests.push({
            query: `Station de métro ${placeName}, Paris`,
            index: 'poi',
            category: 'transport',
        });
    }

    return uniqueRequests(requests);
}

async function fetchCandidates(request) {
    const url = new URL(GEOCODING_URL);

    url.searchParams.set('q', request.query);
    url.searchParams.set('index', request.index);
    url.searchParams.set('limit', '10');

    if (request.category) {
        url.searchParams.set('category', request.category);
    }

    const response = await fetch(url);

    if (!response.ok) {
        return [];
    }

    const data = await response.json();

    return (data.features ?? [])
        .filter(feature => {
            const coordinates = feature.geometry?.coordinates;

            return Array.isArray(coordinates)
                && coordinates.length >= 2
                && Number.isFinite(coordinates[0])
                && Number.isFinite(coordinates[1]);
        })
        .map(feature => {
            const properties = feature.properties ?? {};
            const [longitude, latitude] =
                feature.geometry.coordinates;

            return {
                latitude,
                longitude,
                label:
                    properties.toponyme
                    ?? properties.label
                    ?? properties.name
                    ?? request.query,
                city: properties.city ?? '',
                category: properties.category ?? '',
                score: Number(properties.score ?? 0),
            };
        });
}

export async function geocodeCandidates(query, type) {
    const cleanQuery = String(query)
        .replace(/\s+/g, ' ')
        .trim();

    if (cleanQuery.length < 3) {
        return [];
    }

    const cacheKey =
        `${type}|${normalizeText(cleanQuery)}`;

    if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
    }

    const requests = buildRequests(cleanQuery, type);

    const pending = Promise.all(
        requests.map(request =>
            fetchCandidates(request).catch(error => {
                console.warn(
                    `Échec du géocodage pour « ${request.query} ».`,
                    error
                );

                return [];
            })
        )
    ).then(resultSets => {
        const candidates = new Map();

        resultSets.flat().forEach(candidate => {
            const key = [
                normalizeText(candidate.label),
                normalizeText(candidate.city),
                candidate.latitude.toFixed(5),
                candidate.longitude.toFixed(5),
            ].join('|');

            const existing = candidates.get(key);

            if (!existing || candidate.score > existing.score) {
                candidates.set(key, candidate);
            }
        });

        return [...candidates.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
    });

    cache.set(cacheKey, pending);

    return pending;
}






















/*


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

*/