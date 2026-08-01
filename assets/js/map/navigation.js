class NavigationManager {

    constructor() {

        this.map = null;

        this.mode = "default";

        this.defaultZoom = 13;
        this.comfortZoom = 14;

        this.defaultView = {
            center: [48.8566, 2.3522],
            zoom: this.defaultZoom
        };

        this.userView = null;

        this.focusView = null;

        this.isProgrammaticMove = false;

        this.saveAfterProgrammaticMove = false;
    }


    startProgrammaticMove(saveAfter = false) {

        this.isProgrammaticMove = true;
        this.saveAfterProgrammaticMove = saveAfter;
    }


    endProgrammaticMove() {
        this.isProgrammaticMove = false;
        this.saveAfterProgrammaticMove = false;
    }


    isProgrammatic() {
        return this.isProgrammaticMove;
    }

    
    init(map) {
        this.map = map;
    }


    initDefaultView() {

        this.startProgrammaticMove();
        
        return this.map.setView(
            this.defaultView.center,
            this.defaultView.zoom,
            {
                duration: 0.8
            }
        );
    }


    saveUserView() {

        this.userView = {
            center: [
                this.map.getCenter().lat,
                this.map.getCenter().lng
            ],
            zoom: this.map.getZoom()
        };
        this.mode = "savedView";
    }


    restoreUserView() {

        if (!this.userView) {
            this.initDefaultView();
        
            return;
        }

        this.startProgrammaticMove();

        this.map.flyTo(
            this.userView.center,
            this.userView.zoom,
            {
                duration: 0.8
            }
        );
    }


    focusStation(station) {

        this.focusView = {
            center: [
                station.latitude,
                station.longitude
            ],
            zoom: 16
        };

        this.mode = "focus";

        this.startProgrammaticMove(true);

        this.map.flyTo(
            this.focusView.center,
            this.focusView.zoom,
            {
            duration: 0.8
            }
        );
    }

    //click sur un marker après une recherche on centre et ajuste le zoom changer le nom de fonction ex adapt zoom after click station
    restoreAfterSearch(station) {

        const currentZoom = this.map.getZoom();

        this.focusView = {
            center: [
                station.latitude,
                station.longitude
            ],
            zoom: this.defaultZoom
        };

        this.startProgrammaticMove(true);

        if (currentZoom <= this.defaultView.zoom) {

        this.map.flyTo(
            this.focusView.center,
            this.comfortZoom,
            {
                duration: 0.8
            }
        );

        return;

    } else {

        this.map.flyTo(
            this.focusView.center,
            currentZoom,
            {
                duration: 0.8
            }
        );
        
        return;
    }
}
}

export const navigation = new NavigationManager();