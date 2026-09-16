import Fuse from '/maplibre-assets/fuse.mjs';
import { filterSearchResults } from './searchResults.js';

export function initSearch() {

    const input = document.getElementById('map-search-input');
    const results = document.getElementById('map-search-results');

    if (!input || !results) {
        return;
    }

    const stations = window.stations ?? [];

    const fuse = new Fuse(
        stations,
        {
            keys: [
                'name',
                'address'
            ],

            threshold: 0.35
        }
    );

    input.addEventListener('input', () => {

        const query = input.value.trim();

        if (!query) {
            results.innerHTML = '';
            results.style.display = 'none';

            return;
        }

        const matches = fuse.search(query);

        const filteredMatches = filterSearchResults(
            matches,
            query
        );

        results.innerHTML = filteredMatches
            .slice(0, 8)
            .map((result, index) => {

                const station = result.item;

                return `
                    <div
                        class="search-result"
                        data-result-index="${index}"
                    >
                        <strong>${station.name}</strong>
                        <small>${station.address ?? ''}</small>
                    </div>
                `;
            })
            .join('');

        results.style.display = filteredMatches.length
            ? 'block'
            : 'none';

        results
            .querySelectorAll('.search-result')
            .forEach(resultElement => {

                resultElement.addEventListener('click', () => {

                    const index = Number(
                        resultElement.dataset.resultIndex
                    );

                    const station = filteredMatches[index].item;

                    results.innerHTML = '';
                    results.style.display = 'none';

                    document.dispatchEvent(
                        new CustomEvent(
                            'station:selected',
                            {
                                detail: station
                            }
                        )
                    );
                });
            });
    });

}