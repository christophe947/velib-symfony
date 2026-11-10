export function showConfirmationDialog({
    title,
    message,
    cancelLabel,
    confirmLabel,
    onConfirm,
}) {
    // Évite d'afficher plusieurs fenêtres.
    if (document.querySelector('.navigation-confirmation-overlay')) {
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'navigation-confirmation-overlay';

    overlay.innerHTML = `
        <div
            class="navigation-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="navigation-confirmation-title"
        >
            <h3 id="navigation-confirmation-title">${title}</h3>

            <p>${message}</p>

            <div class="navigation-confirmation-actions">
                <button
                    type="button"
                    class="navigation-confirmation-cancel"
                >
                    ${cancelLabel}
                </button>

                <button
                    type="button"
                    class="navigation-confirmation-stop"
                >
                    ${confirmLabel}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const cancelButton = overlay.querySelector(
        '.navigation-confirmation-cancel',
    );

    const confirmButton = overlay.querySelector(
        '.navigation-confirmation-stop',
    );

    // Ferme la fenêtre sans interrompre la navigation.
    cancelButton.addEventListener('click', () => {
        overlay.remove();
    });

    // Confirme l'action demandée par le panneau.
    confirmButton.addEventListener('click', () => {
        overlay.remove();
        onConfirm();
    });

    // Ferme aussi la fenêtre en cliquant sur le fond.
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            overlay.remove();
        }
    });

    cancelButton.focus();
}
