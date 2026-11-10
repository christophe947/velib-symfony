export async function recalculateMiddleBreakpoint(pane, height) {
    if (!pane) {
        return;
    }

    pane.settings.breaks.middle.height = height;

    // Recalcule réellement les breakpoints internes.
    await pane.breakpoints.buildBreakpoints(pane.settings.breaks, 0, false);
}

export async function recalculateBottomBreakpoint(pane, height) {
    if (!pane) {
        return;
    }

    pane.settings.breaks.bottom.height = height;

    await pane.breakpoints.buildBreakpoints(pane.settings.breaks, 0, false);
}
