const header = document.querySelector('.wm-header');
const toggle = document.querySelector('.wm-header__toggle');

if (header && toggle) {
  toggle.addEventListener('click', () => {
    const open = header.classList.toggle('wm-header--open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  header.querySelectorAll('.wm-header__menu a').forEach((link) => {
    link.addEventListener('click', () => {
      header.classList.remove('wm-header--open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

document.querySelectorAll('[data-copy]').forEach((button) => {
  const status = button.querySelector('.wm-copy-status');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
      return;
    }
    button.classList.add('is-copied');
    if (status) status.textContent = 'Copied to clipboard';
    window.setTimeout(() => {
      button.classList.remove('is-copied');
      if (status) status.textContent = '';
    }, 2000);
  });
});

document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.cookie = 'wm_theme=' + next + '; max-age=31536000; path=/; SameSite=Lax';
  });
});
