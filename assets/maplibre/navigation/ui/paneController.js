import { CupertinoPane } from 'cupertino-pane';

export function createPaneController(
    element,
    { onUserBreakChange, shouldIgnoreSearchEvents } = {},
) {
    const mobileQuery = window.matchMedia('(max-width: 767px)');

    let pane = null;
    let panelManuallyAtBottom = true;
    let paneDragActive = false;
    let paneInteractionId = 0;
    let paneCollapseTimeoutId = null;
    let searchEventsBound = false;

    if (mobileQuery.matches) {
        pane = new CupertinoPane(element, {
            parentElement: 'body',
            initialBreak: 'bottom',

            showCloseButton: false,
            dragByCursor: true,
            clickBottomOpen: false,
            //animationDuration: 500,

            breaks: {
                top: {
                    enabled: true,
                    height: window.innerHeight - 80,
                    bounce: true,
                },

                middle: {
                    enabled: true,
                    height: 270,
                    bounce: true,
                },

                bottom: {
                    enabled: true,
                    height: 100,
                },
            },
        });

        pane.present({
            animate: false,
        });
        pane.on('onDragStart', () => {
            paneDragActive = true;
            paneInteractionId++;
        });
        pane.on('onDragEnd', () => {
            paneDragActive = false;
            paneInteractionId++;
            const currentBreak = pane.currentBreak();
            panelManuallyAtBottom = currentBreak === 'bottom';
            onUserBreakChange?.(currentBreak);
        });
    }

    function clearCollapse() {
        clearTimeout(paneCollapseTimeoutId);
        paneCollapseTimeoutId = null;
    }

    function moveToBreak(name) {
        if (!pane || !mobileQuery.matches) {
            return;
        }

        return pane.moveToBreak(name);
    }

    function openPlanner() {
        if (!pane || !mobileQuery.matches) {
            return;
        }

        panelManuallyAtBottom = false;
        return moveToBreak('top');
    }

    function closePlanner(returnToBreak = 'bottom') {
        if (!pane || !mobileQuery.matches) {
            return;
        }

        clearCollapse();
        panelManuallyAtBottom = returnToBreak === 'bottom';
        return moveToBreak(returnToBreak);
    }

    async function updateMiddleHeight(height, movePane = true) {
        if (!pane) {
            return;
        }

        pane.settings.breaks.middle.height = height;

        // Recalcule réellement les breakpoints internes.
        await pane.breakpoints.buildBreakpoints(pane.settings.breaks, 0, false);

        if (!movePane) {
            return;
        }

        // Le nouveau middle devient le breakpoint courant.
        pane.breakpoints.currentBreakpoint = pane.breakpoints.breaks.middle;
        pane.breakpoints.prevBreakpoint = 'middle';
        panelManuallyAtBottom = false;

        // Position visuelle.
        await pane.moveToHeight(height);
    }

    async function updateBottomHeight(height) {
        if (!pane) {
            return;
        }

        pane.settings.breaks.bottom.height = height;

        await pane.breakpoints.buildBreakpoints(pane.settings.breaks, 0, false);
    }

    function scheduleCollapse(canCollapse) {
        clearCollapse();

        if (!pane || !mobileQuery.matches) {
            return;
        }

        const interactionId = paneInteractionId;

        paneCollapseTimeoutId = setTimeout(() => {
            paneCollapseTimeoutId = null;

            if (
                !pane ||
                paneDragActive ||
                paneInteractionId !== interactionId ||
                !canCollapse()
            ) {
                return;
            }

            moveToBreak('bottom');
        }, 750);
    }

    function lowerSearchPanel() {
        if (!pane || !mobileQuery.matches) return;
        if (shouldIgnoreSearchEvents?.()) return;
        if (panelManuallyAtBottom === true) return;

        //panelManuallyAtBottom = false;
        moveToBreak('bottom');
    }

    function restoreSearchPanel() {
        if (!pane || !mobileQuery.matches) return;
        if (shouldIgnoreSearchEvents?.()) return;
        if (panelManuallyAtBottom === true) {
            return;
        }
        const searchResults = document.getElementById('map-search-results');

        const planner = document.getElementById('route-planner');
        const isPlanning = planner?.hidden === false;
        if (
            searchResults &&
            getComputedStyle(searchResults).display !== 'none' &&
            searchResults.querySelector('[data-station-index]')
        ) {
            return;
        }
        if (panelManuallyAtBottom === false) {
            moveToBreak(isPlanning ? 'top' : 'middle');
        }
    }

    function bindSearchEvents() {
        if (searchEventsBound) {
            return;
        }

        searchEventsBound = true;
        document.addEventListener('search:focus', lowerSearchPanel);
        document.addEventListener('search:results', lowerSearchPanel);
        document.addEventListener('search:blur', restoreSearchPanel);
        document.addEventListener('search:results:close', restoreSearchPanel);
    }

    return {
        isAvailable: () => Boolean(pane && mobileQuery.matches),
        present: (options) => pane?.present(options),
        openPlanner,
        closePlanner,
        updateMiddleHeight,
        updateBottomHeight,
        clearCollapse,
        scheduleCollapse,
        bindSearchEvents,
    };
}
