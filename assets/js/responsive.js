const navbar = document.querySelector('.navbar');
const stationPanel = document.getElementById('station-panel');
const map = document.getElementById('map');


function updateNavbarHeight() {

    if (!navbar) {
        return;
    }

    document.documentElement.style.setProperty(
        '--navbar-height',
        `${navbar.offsetHeight}px`
    );
}
//calcule de map pour positionner attribution sous nav
function getMapHeight() {

    if (!map) {
        return;
    }

     document.documentElement.style.setProperty(
        '--map-height',
        `${map.offsetHeight}px`
    );
}


export function updateStationPanelDimensions() {

    if (!stationPanel) {
        return;
    }

    const header = stationPanel.querySelector(
        '.station-panel-header'
    );

    const body = stationPanel.querySelector(
        '.station-panel-body'
    );

    if (!header || !body) {
        return;
    }

    /*
     * Demande au navigateur la hauteur calculée
     * réellement par le CSS.
     */
    const panelHeight =
        parseFloat(
            getComputedStyle(stationPanel).height
        );

    const contentHeight =
        header.offsetHeight +
        body.offsetHeight;

    document.documentElement.style.setProperty(
        '--station-panel-height',
        `${panelHeight}px`
    );

    document.documentElement.style.setProperty(
        '--station-panel-content-height',
        `${contentHeight}px`
    );
}


function updateResponsiveLayout() {

    updateNavbarHeight();
    updateStationPanelDimensions();
    getMapHeight();

   
}

updateResponsiveLayout();

window.addEventListener(
    'resize',
    updateResponsiveLayout
);