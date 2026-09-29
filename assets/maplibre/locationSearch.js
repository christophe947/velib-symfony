import { geocodeCandidates } from './geocoding.js';

import {
    findNearbyStations,
} from './nearbyStations.js';

function normalizeText(value = '') {
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, ' ')
        .replace(/[^a-zA-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function isTransportSearch(query) {
    return /\b(rer|metro|métro|gare|station|train)\b/i.test(query);
}

function getDestination(query) {
    return normalizeText(query)
        .replace(/\b(rer|metro|métro|gare|station|train)\b/g, ' ')
        .replace(/\b(de|du|des|la|le|les|d)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getDestinationWords(destination) {
    return destination
        .split(' ')
        .filter(word => word.length >= 3);
}

function isParking(candidate) {
    const label = normalizeText(candidate.label);

    return /\bparking\b|\bparc de stationnement\b/.test(label);
}

function matchesDestination(candidate, destination) {
    const label = normalizeText(candidate.label);
    const words = getDestinationWords(destination);

    return words.length > 0
        && words.every(word => label.includes(word));
}

function looksLikeTransport(candidate) {
    const label = normalizeText(candidate.label);
    const category = normalizeText(candidate.category);

    return (
        /\bgare\b|\brer\b|\bstation\b|\bmetro\b/.test(label)
        || /\btransport\b|\bgare\b|\brer\b|\bmetro\b/.test(category)
    );
}

function relevanceScore(candidate, destination) {
    const label = normalizeText(candidate.label);
    const words = getDestinationWords(destination);
    const allWordsMatch = words.length > 0
        && words.every(word => label.includes(word));

    return (
        (allWordsMatch ? 1000 : 0)
        + (looksLikeTransport(candidate) ? 200 : 0)
        + (label === destination ? 100 : 0)
        + (Number(candidate.score) || 0)
    );
}

function selectOneTransportLocation(locations, destination) {
    const withoutParking = locations.filter(candidate =>
        !isParking(candidate)
    );

    // Priorité aux résultats qui correspondent au nom recherché
    // et qui sont identifiés comme une gare ou un transport.
    const preciseMatches = withoutParking
        .filter(candidate =>
            matchesDestination(candidate, destination)
            && looksLikeTransport(candidate)
        )
        .sort((a, b) =>
            relevanceScore(b, destination)
            - relevanceScore(a, destination)
        );

    if (preciseMatches.length > 0) {
        return preciseMatches.slice(0, 1);
    }

    // Certains résultats du géocodeur ne sont pas classés comme
    // transports. On garde alors le meilleur résultat sans parking.
    const destinationMatches = withoutParking
        .filter(candidate =>
            matchesDestination(candidate, destination)
        )
        .sort((a, b) =>
            relevanceScore(b, destination)
            - relevanceScore(a, destination)
        );

    if (destinationMatches.length > 0) {
        return destinationMatches.slice(0, 1);
    }

    // Dernier recours : éviter une liste vide si le géocodeur a renvoyé
    // un libellé inattendu.
    return withoutParking
        .sort((a, b) =>
            relevanceScore(b, destination)
            - relevanceScore(a, destination)
        )
        .slice(0, 1);
}

function selectOnePlaceLocation(locations, destination) {
    const nonIncidentalLocations = locations.filter(candidate => {
        const label = normalizeText(candidate.label);

        return !(
            /\bbanque\b|\bparking\b|\bparc de stationnement\b/.test(label)
        );
    });

    const matchingLocations = nonIncidentalLocations
        .filter(candidate =>
            matchesDestination(candidate, destination)
        )
        .sort((a, b) =>
            relevanceScore(b, destination)
            - relevanceScore(a, destination)
        );

    if (matchingLocations.length > 0) {
        return matchingLocations.slice(0, 1);
    }

    if (nonIncidentalLocations.length > 0) {
        return [...nonIncidentalLocations]
            .sort((a, b) => b.score - a.score)
            .slice(0, 1);
    }

    return [...locations]
        .sort((a, b) => b.score - a.score)
        .slice(0, 1);
}

export async function searchNearbyStations(
    query,
    type,
    stations
) {
    const locations = await geocodeCandidates(query, type);
    let relevantLocations = locations;

    if (isTransportSearch(query)) {
        relevantLocations = selectOneTransportLocation(
            locations,
            getDestination(query)
        );
    } else if (type === 'place') {
        relevantLocations = selectOnePlaceLocation(
            locations,
            getDestination(query)
        );
    }

    return relevantLocations
        .map(location => ({
            label: location.label,
            city: location.city,
            score: location.score,
            stations: findNearbyStations(
                location.latitude,
                location.longitude,
                stations,
                8,
                3000
            ),
        }))
        .filter(group => group.stations.length > 0);
}












/*



import { geocode } from './geocoding.js';

import {
    findNearbyStations
} from './nearbyStations.js';

export async function searchNearbyStations(
    query,
    stations
) {
    const coordinates = await geocode(query);

    if (!coordinates) {
        return [];
    }

    return findNearbyStations(
        coordinates.latitude,
        coordinates.longitude,
        stations
    );
}

*/