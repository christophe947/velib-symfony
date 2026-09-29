function normalizeText(value = '') {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, ' ')
        .replace(/[^a-zA-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
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

function findArrondissement(query, zones) {
    const compactQuery = normalizeText(query)
        .replace(/\s+/g, '');

    const match = compactQuery.match(
        /^(?:paris)?(\d{1,2})(?:er|e|eme)?(?:arrondissement|ardt|arrt|ar)?$/
    );

    if (!match) {
        return null;
    }

    const number = Number(match[1]);

    if (number < 1 || number > 20) {
        return null;
    }

    return zones.find(zone =>
        Number(zone.properties?.c_ar) === number
    ) ?? null;
}

function findCommune(query, communes) {
    const normalizedQuery = normalizeText(query);

    if (!normalizedQuery) {
        return null;
    }

    const queryWords = normalizedQuery.split(' ');

    return communes.find(commune => {
        const communeName = normalizeText(
            commune.properties?.nom ?? ''
        );

        if (!communeName) {
            return false;
        }

        if (communeName === normalizedQuery) {
            return true;
        }

        const communeWords = communeName.split(' ');

        return communeWords.every(communeWord =>
            queryWords.some(queryWord =>
                queryWord === communeWord
                || (
                    communeWord.length >= 5
                    && Math.abs(
                        communeWord.length - queryWord.length
                    ) <= 1
                    && editDistance(communeWord, queryWord) <= 1
                )
            )
        );
    }) ?? null;
}

export function classifySearch(query, zones, communes) {
    const normalizedQuery = query
        .replace(/\s+/g, ' ')
        .trim();

    const arrondissement = findArrondissement(
        normalizedQuery,
        zones
    );

    if (arrondissement) {
        return {
            type: 'area',
            label:
                arrondissement.properties?.l_ar
                ?? `Paris ${arrondissement.properties?.c_ar}e`,
            area: arrondissement,
        };
    }

    const isTransportSearch =
        /\b(rer|metro|métro|gare|station|train)\b/i.test(
            normalizedQuery
        );

    // Une commune seule affiche toutes ses stations.
    // « Vincennes RER » reste une recherche de gare.
    if (!isTransportSearch) {
        const commune = findCommune(
            normalizedQuery,
            communes
        );

        if (commune) {
            return {
                type: 'area',
                label: commune.properties?.nom ?? 'Commune',
                area: commune,
            };
        }
    }

    const isAddress =
        /^\d+\s/.test(normalizedQuery)
        || /\b(rue|avenue|boulevard|quai|impasse|allée|allee|passage|route|cours)\b/i
            .test(normalizedQuery);

    return {
        type: isAddress ? 'address' : 'place',
        query: normalizedQuery,
    };
}