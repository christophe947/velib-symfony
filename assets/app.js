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

    searchInput.focus();

searchInput.setSelectionRange(
    searchInput.value.length,
    searchInput.value.length
);

    let timer = null;

    searchInput.addEventListener('input', () => {

        clearTimeout(timer);

        timer = setTimeout(() => {

            const search = searchInput.value.trim();

            window.location.href =
                `/stations?search=${encodeURIComponent(search)}`;

        }, 800);

    });

});