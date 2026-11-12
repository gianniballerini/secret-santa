import './styles/main.scss';
import { decodeToken } from './domain/token';
import { initMusic } from './audio/music';
import { initEffects } from './audio/sfx';
import { byId } from './ui/dom';
import { initOrganizer } from './ui/organizer';
import { showReveal } from './ui/reveal';
import { initSoundUi } from './ui/soundUi';

type View = 'organizer' | 'reveal' | 'error';

function show(view: View): void {
  for (const id of ['organizer', 'reveal', 'error'] as const) {
    byId(id).hidden = id !== view;
  }
  document.body.dataset.view = view;
}

function route(): void {
  const token = location.hash.replace(/^#/, '');
  if (!token) {
    show('organizer');
    return;
  }
  const payload = decodeToken(token);
  if (payload) {
    showReveal(payload);
    show('reveal');
  } else {
    show('error');
  }
  window.scrollTo(0, 0);
}

initOrganizer();
initMusic();
initEffects();
initSoundUi();
window.addEventListener('hashchange', route);
route();
