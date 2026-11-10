export function initModeSelector(element, { onModeChange }) {
    const selector = element.querySelector('.station-panel-mode-selector');

    if (!selector) {
        return;
    }

    const buttons = selector.querySelectorAll('button');
    const indicator = selector.querySelector('.station-panel-mode-indicator');

    function updateIndicator() {
        const activeButton = selector.querySelector('button.active');

        if (!activeButton || !indicator) {
            return;
        }

        indicator.style.width = `${activeButton.offsetWidth}px`;
        indicator.style.transform = `translateX(${activeButton.offsetLeft}px)`;
    }

    buttons.forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();

            const mode = button.dataset.mode;

            if (!mode) {
                return;
            }

            onModeChange(mode);

            buttons.forEach((item) => {
                item.classList.toggle('active', item.dataset.mode === mode);
            });

            updateIndicator();
        });
    });

    updateIndicator();
}
