import { getAvailabilityColor } from './availability.js';


export function filterSearchResults(matches, query) {

    const normalizedQuery = query
        .toLowerCase()
        .trim();

    const exactMatches = matches.filter(result => {

        const name = result.item.name?.toLowerCase() ?? '';
        const address = result.item.address?.toLowerCase() ?? '';

        return (
            name.includes(normalizedQuery) ||
            address.includes(normalizedQuery)
        );
    });

    return exactMatches.length
        ? exactMatches
        : matches;
}

export function renderNearbyStations(
    stations
) {
    return stations
        .map(station => {

            const availabilityColor =
                getAvailabilityColor(
                    station,
                    'bikes'
                );

            return `
                <div
                    class="search-result search-nearby-station"
                    data-station-id="${station.id}"
                >
                    <div class="search-nearby-station-main">

                        <span
                            class="search-availability-dot search-availability-${availabilityColor}"
                        ></span>

                        <strong>
                            ${station.name}
                        </strong>

                        <span class="search-nearby-bikes">
                            ${station.bikes ?? 0}
                        </span>

                    </div>

                    <small class="search-nearby-distance">
                        ${Math.round(station.distance)} m
                    </small>
                </div>
            `;
        })
        .join('');
}