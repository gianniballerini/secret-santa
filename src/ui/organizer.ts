import { draw } from '../domain/draw';
import { buildLinksMarkdown, LINKS_FILE_NAME, type GiverLink } from '../domain/linksFile';
import { defaultAvatar, type Participant } from '../domain/participant';
import { encodeToken } from '../domain/token';
import { byId, el } from './dom';

const STORAGE_KEY = 'secret-santa:participants';
const MIN_PARTICIPANTS = 3;

function loadParticipants(): Participant[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.flatMap((item): Participant[] => {
      const { name, avatar } = (item ?? {}) as Record<string, unknown>;
      if (typeof name !== 'string' || !name.trim()) return [];
      // Avatars are gone from the UI, but the token still carries one; keep what was saved or use the default.
      return [{ name: name.trim(), avatar: typeof avatar === 'string' ? avatar.trim() : defaultAvatar(name) }];
    });
  } catch {
    return [];
  }
}

function saveParticipants(list: Participant[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the app keeps working in memory */
  }
}

function buildLink(p: Participant, recipient: Participant): string {
  const token = encodeToken({ g: p.name, r: recipient.name, a: recipient.avatar });
  return `${location.origin}${location.pathname}#${token}`;
}

async function copyText(text: string, fallbackInput: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallbackInput.hidden = false;
    fallbackInput.focus();
    fallbackInput.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

function downloadMarkdown(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initOrganizer(): void {
  let participants = loadParticipants();
  let editing = -1;
  let drawnLinks: GiverLink[] = [];

  const form = byId<HTMLFormElement>('add-form');
  const nameInput = byId<HTMLInputElement>('name-input');
  const formError = byId('form-error');
  const list = byId('participant-list');
  const emptyState = byId('empty-state');
  const drawBtn = byId<HTMLButtonElement>('draw-btn');
  const drawHint = byId('draw-hint');
  const results = byId('results');
  const resultsList = byId('results-list');
  const redrawBtn = byId<HTMLButtonElement>('redraw-btn');
  const downloadBtn = byId<HTMLButtonElement>('download-btn');

  const isDuplicate = (name: string, ignoreIndex = -1) =>
    participants.some(
      (p, i) => i !== ignoreIndex && p.name.toLowerCase() === name.trim().toLowerCase(),
    );

  function validateName(name: string, ignoreIndex = -1): string {
    if (!name.trim()) return 'Escribí un nombre.';
    if (isDuplicate(name, ignoreIndex)) return `"${name.trim()}" ya está en la lista.`;
    return '';
  }

  function showFormError(message: string): void {
    formError.textContent = message;
    formError.hidden = !message;
    nameInput.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (message) nameInput.setAttribute('aria-describedby', 'form-error');
    else nameInput.removeAttribute('aria-describedby');
  }

  function changed(): void {
    saveParticipants(participants);
    results.hidden = true;
    resultsList.replaceChildren();
    renderList();
  }

  function renderRow(p: Participant, index: number): HTMLElement {
    if (index === editing) return renderEditRow(p, index);
    const actions = el('div', { class: 'row__actions' });
    const editBtn = el('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Editar');
    editBtn.setAttribute('aria-label', `Editar a ${p.name}`);
    editBtn.addEventListener('click', () => {
      editing = index;
      renderList();
    });
    const removeBtn = el('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--danger' }, 'Quitar');
    removeBtn.setAttribute('aria-label', `Quitar a ${p.name}`);
    removeBtn.addEventListener('click', () => {
      participants = participants.filter((_, i) => i !== index);
      editing = -1;
      changed();
    });
    actions.append(editBtn, removeBtn);
    return el('li', { class: 'row' }, el('div', { class: 'row__main' }, el('span', { class: 'row__name' }, p.name)), actions);
  }

  function renderEditRow(p: Participant, index: number): HTMLElement {
    const nameField = el('input', { class: 'input', type: 'text', maxlength: '40', 'aria-label': 'Nombre' });
    nameField.value = p.name;
    const error = el('p', { class: 'field__error', role: 'alert', hidden: true });
    const save = el('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Guardá');
    const cancel = el('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Cancelar');
    cancel.addEventListener('click', () => {
      editing = -1;
      renderList();
    });
    const row = el(
      'li',
      { class: 'row row--editing' },
      el(
        'form',
        { class: 'row__edit', novalidate: true },
        nameField,
        error,
        el('div', { class: 'row__actions' }, save, cancel),
      ),
    );
    row.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const message = validateName(nameField.value, index);
      if (message) {
        error.textContent = message;
        error.hidden = false;
        nameField.focus();
        return;
      }
      const name = nameField.value.trim();
      participants[index] = { name, avatar: defaultAvatar(name) };
      editing = -1;
      changed();
    });
    queueMicrotask(() => nameField.focus());
    return row;
  }

  function renderList(): void {
    list.replaceChildren(...participants.map(renderRow));
    emptyState.hidden = participants.length > 0;
    const ready = participants.length >= MIN_PARTICIPANTS;
    drawBtn.disabled = !ready;
    drawHint.hidden = ready;
  }

  function renderResults(): void {
    const pairs = draw(participants);
    drawnLinks = pairs.map(({ giver, recipient }) => ({ name: giver.name, link: buildLink(giver, recipient) }));
    resultsList.replaceChildren(
      ...drawnLinks.map(({ name, link }) => {
        const hidden = el('input', {
          class: 'input link__input',
          type: 'text',
          readonly: true,
          hidden: true,
          'aria-label': `Enlace para ${name}`,
        });
        hidden.value = link;
        const status = el('span', { class: 'link__status', role: 'status' });
        const btn = el('button', { type: 'button', class: 'btn btn--secondary btn--sm' }, 'Copiá el enlace');
        btn.setAttribute('aria-label', `Copiar enlace para ${name}`);
        btn.addEventListener('click', async () => {
          const ok = await copyText(link, hidden);
          status.textContent = ok ? '¡Copiado!' : 'Apretá Ctrl/Cmd+C para copiar';
          status.classList.toggle('is-ok', ok);
          window.setTimeout(() => (status.textContent = ''), 2500);
        });
        return el(
          'li',
          { class: 'row link' },
          el(
            'div',
            { class: 'row__main' },
            el('span', { class: 'row__name' }, name),
            status,
            hidden,
          ),
          btn,
        );
      }),
    );
    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  nameInput.addEventListener('input', () => {
    if (formError.hidden === false) showFormError('');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = validateName(nameInput.value);
    showFormError(message);
    if (message) {
      nameInput.focus();
      return;
    }
    const name = nameInput.value.trim();
    participants.push({ name, avatar: defaultAvatar(name) });
    form.reset();
    changed();
    nameInput.focus();
  });

  drawBtn.addEventListener('click', () => {
    if (participants.length >= MIN_PARTICIPANTS) renderResults();
  });
  redrawBtn.addEventListener('click', () => {
    if (participants.length >= MIN_PARTICIPANTS) renderResults();
  });
  downloadBtn.addEventListener('click', () => {
    downloadMarkdown(LINKS_FILE_NAME, buildLinksMarkdown(drawnLinks));
  });

  renderList();
}
