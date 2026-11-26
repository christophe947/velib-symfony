import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(
    new URL('../assets/maplibre/navigation/ui/routePlannerView.js', import.meta.url),
    'utf8',
);
const { renderRoutePreview } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const stationPanelSource = await readFile(
    new URL('../assets/maplibre/navigation/ui/stationPanelView.js', import.meta.url),
    'utf8',
);
const { renderStationPanel } = await import(
    `data:text/javascript;base64,${Buffer.from(stationPanelSource).toString('base64')}`
);

test('aperçu multimodal présente ses étapes, transferts, disponibilité et ne permet pas de démarrer', () => {
    const html = renderRoutePreview({
        distance: '3,2 km',
        duration: '18 min',
        modeLabel: 'À pied → Vélib → marche',
        steps: [
            { label: 'À pied : Départ → Station <prise>' },
            { label: 'À vélo : Station prise → Station dépôt' },
            { label: 'À pied : Station dépôt → Arrivée' },
        ],
        transfers: [
            { label: 'Prise : Station prise', detail: '2 vélos disponibles (1 mécaniques · 1 électriques)' },
            { label: 'Dépôt : Station dépôt', detail: '3 places disponibles' },
        ],
        availabilityWarning: 'La fraîcheur des disponibilités n’est pas connue.',
        alternativeWarning: 'Station demandée remplacée par une alternative.',
        canStart: false,
    });

    assert.match(html, /3,2 km/);
    assert.match(html, /18 min/);
    assert.match(html, /&lt;prise&gt;/);
    assert.match(html, /Station prise/);
    assert.match(html, /2 vélos disponibles/);
    assert.match(html, /3 places disponibles/);
    assert.match(html, /fraîcheur des disponibilités/);
    assert.match(html, /remplacée par une alternative/);
    assert.match(html, /navigation multimodale n’est pas encore disponible/);
    assert.match(html, /data-edit-route-planner/);
    assert.doesNotMatch(html, /class="route-preview-start"/);
});

test('aperçu piéton conserve son bouton Démarrer et le comportement de départ', () => {
    const html = renderRoutePreview({ distance: '1 km', duration: '5 min' });

    assert.match(html, /🚶 À pied/);
    assert.match(html, /class="route-preview-start"/);
    assert.match(html, />\s*Démarrer\s*</);
    assert.match(html, /Pour démarrer, ta position doit se trouver près du départ choisi/);
});

test('navigation multimodale demande une confirmation explicite à la prise', () => {
    const html = renderRoutePreview({
        distance: '1,2 km',
        duration: '8 min',
        navigationActive: true,
        canStart: false,
        journey: {
            phase: 'awaiting-pickup-confirmation',
            segmentIndex: 0,
            activeSegment: { transfer: { type: 'pickup' } },
            status: 'Station de prise atteinte',
        },
        steps: [{ label: 'À pied vers la station' }, { label: 'À vélo' }],
    });

    assert.match(html, /Station de prise atteinte/);
    assert.match(html, /data-multimodal-action="confirm-pickup"/);
    assert.match(html, /J’ai pris mon Vélib/);
    assert.match(html, /data-route-stop-navigation/);
    assert.doesNotMatch(html, /data-multimodal-action="confirm-dropoff"/);
});

test('navigation multimodale propose une arrivée manuelle puis une confirmation de dépôt distincte', () => {
    const arrivalHtml = renderRoutePreview({
        distance: '4 km',
        duration: '12 min',
        navigationActive: true,
        journey: {
            phase: 'navigating',
            segmentIndex: 1,
            activeSegment: { transfer: { type: 'dropoff' } },
        },
        steps: [{ label: 'À pied' }, { label: 'À vélo' }, { label: 'À pied' }],
    });

    assert.match(arrivalHtml, /data-multimodal-action="report-arrival"/);
    assert.match(arrivalHtml, /Je suis arrivé à la station/);
    assert.match(arrivalHtml, /aria-current="step"/);

    const dropoffHtml = renderRoutePreview({
        distance: '4 km',
        duration: '12 min',
        navigationActive: true,
        journey: { phase: 'awaiting-dropoff-confirmation' },
    });

    assert.match(dropoffHtml, /data-multimodal-action="confirm-dropoff"/);
    assert.match(dropoffHtml, /J’ai rendu mon Vélib/);
});

test('transition multimodale désactive la répétition, et une erreur offre une reprise', () => {
    const transitioningHtml = renderRoutePreview({
        distance: '2 km',
        duration: '6 min',
        navigationActive: true,
        journey: { phase: 'transitioning' },
    });
    assert.match(transitioningHtml, /disabled aria-busy="true"/);
    assert.match(transitioningHtml, /Passage au tronçon suivant/);

    const failedHtml = renderRoutePreview({
        distance: '2 km',
        duration: '6 min',
        navigationActive: true,
        journey: { phase: 'transition-error', status: 'Échec' },
    });
    assert.match(failedHtml, /data-multimodal-action="retry-transition"/);
    assert.match(failedHtml, /Échec/);
});

test('arrivée finale affiche un état terminé sans bouton de démarrage', () => {
    const html = renderRoutePreview({
        distance: '5 km',
        duration: '20 min',
        canStart: false,
        journey: { phase: 'completed', status: 'Destination atteinte.' },
    });

    assert.match(html, /Destination atteinte/);
    assert.match(html, /data-edit-route-planner/);
    assert.doesNotMatch(html, /class="route-preview-start"/);
});

test('le changement de destination est désactivé uniquement pendant un parcours multimodal actif', () => {
    const station = { id: 'station-1', name: 'Station', bikes: 2, docks: 3 };
    const multimodalHtml = renderStationPanel({
        station,
        mode: 'bikes',
        navigationState: {
            isActiveNavigationPanel: false,
            isNavigationContextPanel: true,
            canChangeDestination: false,
            navigationMode: 'bicycle',
        },
    });
    assert.match(multimodalHtml, /class="station-panel-join station-panel-context-replace"[^>]*disabled aria-disabled="true"/);
    assert.match(multimodalHtml, /Arrête le parcours multimodal avant de changer de destination/);

    const simpleNavigationHtml = renderStationPanel({
        station,
        mode: 'bikes',
        navigationState: {
            isActiveNavigationPanel: false,
            isNavigationContextPanel: true,
            canChangeDestination: true,
            navigationMode: 'pedestrian',
        },
    });
    assert.match(simpleNavigationHtml, /class="station-panel-join station-panel-context-replace"/);
    assert.doesNotMatch(simpleNavigationHtml, /station-panel-context-replace"[^>]*disabled/);
});
