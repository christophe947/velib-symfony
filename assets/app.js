/*
 * Welcome to your app's main JavaScript file!
 *
 * This file will be included onto the page via the importmap() Twig function,
 * which should already be in your base.html.twig.
 */
import './styles/app.css';
import 'bootstrap';
import 'leaflet';
import 'leaflet/dist/leaflet.min.css';
import './map.js';

document.addEventListener('DOMContentLoaded', () => {

    const searchInput = document.getElementById('station-search');

    if (!searchInput) {
        return;
    }

    searchInput.addEventListener('input', () => {

        const search = searchInput.value.toLowerCase();

        document
            .querySelectorAll('.station-card')
            .forEach(card => {

                const stationName =
                    card.dataset.stationName;

                card.style.display =
                    stationName.includes(search)
                        ? ''
                        : 'none';
            });
    });
});


//console.log('This log comes from assets/app.js - welcome to AssetMapper! 🎉');
