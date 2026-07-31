export function initMapEvents(
    map,
    navigation,
    actions
) {

    map.on('moveend', () => {

        console.log(actions.isSearching?.());

        if (navigation.isProgrammatic()) {

            const saveAfter =
                navigation.saveAfterProgrammaticMove;

            navigation.endProgrammaticMove();


            if (actions.isSearching?.()) {
                console.log("move pendant recherche");
                return;
            }


            if (saveAfter) {
                navigation.saveUserView();
            }

            console.log("move from code");
            return;
        }


        if (actions.isSearching?.()) {
            console.log("move manuel pendant recherche");
            return;
        }


        navigation.saveUserView();

        console.log("move from user");

    });

}