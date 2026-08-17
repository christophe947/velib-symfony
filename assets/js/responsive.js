const navbar = document.querySelector('.navbar');

function updateNavbarHeight() {

    if (!navbar) {
        return;
    }

    document.documentElement.style.setProperty(
        '--navbar-height',
        `${navbar.offsetHeight}px`
    );
}

updateNavbarHeight();

window.addEventListener('resize', updateNavbarHeight);