export function initMobileModeSelector() {

    const selector =
        document.getElementById('mobile-mode-selector');

    const trigger =
        selector?.querySelector('.mobile-mode-trigger');

    const options =
        selector?.querySelectorAll('.mobile-mode-option');


    if (!selector || !trigger || !options) {
        return;
    }

    trigger.addEventListener('click', () => {

        console.log('MODE CLICK');

        selector.classList.toggle('is-open');

    });

    options.forEach(option => {

        option.addEventListener('click', () => {

            const mode =
                option.dataset.mode;

            const desktopButton =
                document.getElementById(`mode-${mode}`);

            desktopButton?.click();

            selector.classList.remove('is-open');

        });

    });

}