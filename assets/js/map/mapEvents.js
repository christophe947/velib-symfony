export function initMapEvents(
    map,
    navigation,
    actions
) {

    map.on('moveend', () => {

        if (navigation.isProgrammatic()) {

            const saveAfter = navigation.saveAfterProgrammaticMove;

            navigation.endProgrammaticMove();

            if (actions.isSearching?.()) {
                return;
            }

            if (saveAfter) {
                navigation.saveUserView();
            }

            return;
        }

        if (actions.isSearching?.()) {
            return;
        }

        navigation.saveUserView();
    });
}