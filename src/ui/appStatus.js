// One line at the foot of the title about the game as an app: a new version ready to load,
// how to put it on the Home Screen, that it's saved for offline play, or that there's no
// signal. Fed by offline.js; only the most useful line shows.

const TIP_KEY = 'crypt-skirmish:install-tip';
const $ = (s) => document.querySelector(s);
const state = { update: false, saved: false, offline: !navigator.onLine, prompt: null };
const installed = () => navigator.standalone === true
  || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
const ios = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const tipHidden = () => { try { return localStorage.getItem(TIP_KEY) === 'hidden'; } catch { return false; } };

function render() {
  const $line = $('#title-app');
  if (!$line) return;
  let text = '', act = '', close = false;
  if (state.update) [text, act] = ['A new version is ready.', 'Reload'];
  else if (state.offline && state.saved) text = 'No signal: playing the saved copy.';
  else if (state.saved && !installed() && !tipHidden() && (state.prompt || ios())) {
    text = 'Saved for offline play.';
    if (state.prompt) act = 'Install';
    else text += ' To keep it on your Home Screen, tap Share, then Add to Home Screen.';
    close = true;
  } else if (state.saved) text = 'Saved for offline play.';
  $line.hidden = !text;
  $line.querySelector('.title-app-text').textContent = text;
  const $act = $('#title-app-act');
  $act.hidden = !act;
  $act.textContent = act;
  $('#title-app-close').hidden = !close;
}

export const appStatus = {
  set(change) {
    Object.assign(state, change);
    render();
  },
};

// Chrome and Edge offer their own install prompt; keep it for the Install button.
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  appStatus.set({ prompt: ev });
});
window.addEventListener('appinstalled', () => appStatus.set({ prompt: null }));
window.addEventListener('online', () => appStatus.set({ offline: false }));
window.addEventListener('offline', () => appStatus.set({ offline: true }));

$('#title-app-act')?.addEventListener('click', () => {
  if (state.update) return location.reload();
  state.prompt?.prompt();
  state.prompt?.userChoice.finally(() => appStatus.set({ prompt: null }));
});
$('#title-app-close')?.addEventListener('click', () => {
  try { localStorage.setItem(TIP_KEY, 'hidden'); } catch { /* shown again next time */ }
  render();
});
