import { getAvailabilityColor } from './availability.js';

const GENERIC_WORDS = new Set([
    'a',
    'au',
    'aux',
    'de',
    'des',
    'du',
    'la',
    'le',
    'les',
    'metro',
    'rer',
    'station',
    'gare',
    'place',
    'paris',
]);

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

function getMeaningfulWords(value) {
    return normalizeText(value)
        .split(' ')
        .filter(word =>
            word.length >= 3
            && !GENERIC_WORDS.has(word)
        );
}

function editDistance(a, b) {
    const row = Array.from(
        { length: b.length + 1 },
        (_, index) => index
    );

    for (let i = 1; i <= a.length; i += 1) {
        let diagonal = row[0];
        row[0] = i;

        for (let j = 1; j <= b.length; j += 1) {
            const oldValue = row[j];

            row[j] = Math.min(
                row[j] + 1,
                row[j - 1] + 1,
                diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
            );

            diagonal = oldValue;
        }
    }

    return row[b.length];
}

function stationMatchesMeaningfulWord(station, queryWords) {
    const stationText = normalizeText(
        `${station.name ?? ''} ${station.address ?? ''}`
    );

    const stationWords = stationText.split(' ');

    return queryWords.some(queryWord =>
        stationWords.some(stationWord =>
            stationWord === queryWord
            || (
                queryWord.length >= 5
                && stationWord.length >= 5
                && Math.abs(stationWord.length - queryWord.length) <= 1
                && editDistance(stationWord, queryWord) <= 1
            )
        )
    );
}

export function rankStationResults(
    fuse,
    stations,
    query,
    limit = 8
) {
    const normalizedQuery = normalizeText(query);
    const queryWords = getMeaningfulWords(query);

    if (!normalizedQuery || queryWords.length === 0) {
        return [];
    }

    // Les noms qui contiennent la recherche complète passent en premier.
    const exactNameMatches = stations.filter(station =>
        normalizeText(station.name).includes(normalizedQuery)
    );

    // Puis les noms contenant un mot important de la recherche.
    const meaningfulNameMatches = stations.filter(station => {
        const name = normalizeText(station.name);

        return queryWords.some(word => name.includes(word));
    });

    // Fuse aide pour les petites fautes, mais on vérifie les mots nous-mêmes
    // pour éviter les faux positifs entre des lieux sans rapport.
    const fuzzyMatches = fuse.search(normalizedQuery)
        .filter(result => result.score <= 0.22)
        .map(result => result.item.station)
        .filter(station =>
            stationMatchesMeaningfulWord(station, queryWords)
        );

    const uniqueStations = new Map();

    [
        ...exactNameMatches,
        ...meaningfulNameMatches,
        ...fuzzyMatches,
    ].forEach(station => {
        const id = String(station.id);

        if (!uniqueStations.has(id)) {
            uniqueStations.set(id, station);
        }
    });

    return [...uniqueStations.values()].slice(0, limit);
}

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character]);
}

function renderStation(station, index, className) {
    const color = getAvailabilityColor(station, 'bikes');

    const distanceLabel = Number.isFinite(station.distance)
        ? `À ${Math.round(station.distance)} m`
        : escapeHtml(station.address ?? '');

    return `
        <div
            class="search-result ${className}"
            data-station-index="${index}"
        >
            <div class="search-nearby-station-main">
                <span class="search-availability-dot search-availability-${color}"></span>
                <strong>${escapeHtml(station.name)}</strong>
                <span class="search-nearby-bikes">
                    ${station.bikes ?? 0}
                </span>
            </div>

            <small class="search-nearby-distance">
                ${distanceLabel}
            </small>
        </div>
    `;
}

export function renderAreaResults(
    container,
    label,
    stations
) {
    container.innerHTML = `
        <div class="search-result search-zone-result">
            <strong>📍 ${escapeHtml(label)}</strong>
            <small>${stations.length} stations Vélib'</small>
        </div>

        <div class="search-zone-stations">
            ${stations.map((station, index) =>
                renderStation(
                    station,
                    index,
                    'search-direct-station'
                )
            ).join('')}
        </div>
    `;

    container.style.display = 'block';

    return stations;
}

export function renderSearchResults(
    container,
    directStations,
    locationGroups
) {
    let stationIndex = 0;
    const displayedStations = [];

    const directHtml = directStations.map(station => {
        const index = stationIndex;
        stationIndex += 1;
        displayedStations.push(station);

        return renderStation(
            station,
            index,
            'search-direct-station'
        );
    }).join('');

    const nearbyHtml = locationGroups.map(group => {
        const groupTitle = [
            group.label,
            group.city,
        ].filter(Boolean).join(' · ');

        const stationHtml = group.stations.map(station => {
            const index = stationIndex;
            stationIndex += 1;
            displayedStations.push(station);

            return renderStation(
                station,
                index,
                'search-nearby-station'
            );
        }).join('');

        return `
            <div class="search-results-section-title">
                📍 Autour de ${escapeHtml(groupTitle)}
            </div>
            ${stationHtml}
        `;
    }).join('');

    if (!directHtml && !nearbyHtml) {
        container.innerHTML = `
            <div class="search-results-section-title">
                Aucun lieu trouvé. Essaie avec une adresse,
                un nom de gare, de métro ou de commune.
            </div>
        `;

        container.style.display = 'block';

        return [];
    }

    container.innerHTML = `
        <div class="search-standard-results">
            ${
                directHtml
                    ? `
                        <div class="search-results-section-title">
                            Stations correspondantes
                        </div>
                        ${directHtml}
                    `
                    : ''
            }

            ${
                nearbyHtml
                    ? `
                        <div class="search-results-section-title">
                            Stations à proximité
                        </div>
                        ${nearbyHtml}
                    `
                    : ''
            }
        </div>
    `;

    container.style.display = 'block';

    return displayedStations;
}