import { api } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { draftTasks, MAX_TITLE, MAX_DESCRIPTION, MAX_TASKS } from './drafts.js';

const EXTENSION = 'foto-aufgaben';
const OCR_PATH = '/api/extensions/' + EXTENSION;
const FILE_LIMIT = 30 * 1024 * 1024;
const EDGE_LIMIT = 2200;
const tr = (key, vars) => t('extensions.' + EXTENSION + '.' + key, vars);
const label = (key, vars) => esc(tr(key, vars));

async function preparePhoto(file, signal) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (signal.aborted) return null;

  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  if (signal.aborted) return null;

  const scale = Math.min(1, EDGE_LIMIT / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL('image/jpeg', 0.6);
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!jpeg) throw new Error('JPEG encoding failed');
  return { jpeg, preview };
}

async function callOcr(path, options) {
  const response = await fetch(OCR_PATH + path, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    ...options,
  });
  if (!response.ok) {
    const message = { 401: 'readDenied', 403: 'readDenied', 429: 'readBusy', 504: 'readSlow' };
    throw Object.assign(new Error('OCR request failed'), { label: message[response.status] });
  }
  return response.json();
}

function option(value, text) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = text;
  return element;
}

function idempotencyKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function render(container, { signal }) {
  if (signal.aborted) return;
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <div class="page-toolbar"><h1 class="page-toolbar__title">${label('menu')}</h1></div>
    <div class="app-page__body foto-aufgaben">
      <section class="page-section page-measure photo-fields" data-intake>
        <div class="photo-actions">
          <input type="file" accept="image/*" capture="environment" data-camera hidden>
          <input type="file" accept="image/*" data-gallery hidden>
          <button type="button" class="btn btn--primary" data-take>${label('camera')}</button>
          <button type="button" class="btn btn--secondary" data-choose>${label('gallery')}</button>
          <button type="button" class="btn btn--secondary" data-read disabled>${label('read')}</button>
        </div>
        <img class="photo-preview" alt="${label('imageAlt')}" hidden>
        <p role="status" data-ocr-status></p>
        <label>${label('text')}
          <textarea class="form-input" rows="6" maxlength="${MAX_DESCRIPTION}" aria-describedby="foto-aufgaben-text-help"></textarea>
        </label>
        <p class="form-hint" id="foto-aufgaben-text-help">${label('textHelp')}</p>
        <label>${label('mode')}
          <select class="form-input" data-mode>
            <option value="single">${label('single')}</option>
            <option value="list">${label('list')}</option>
          </select>
        </label>
        <div class="photo-actions">
          <button type="button" class="btn btn--secondary" data-review>${label('review')}</button>
        </div>
      </section>
      <section class="page-section page-measure photo-fields" data-review-section hidden>
        <h2>${label('drafts')}</h2>
        <p role="status" data-members-status></p>
        <form class="photo-fields">
          <div class="photo-drafts"></div>
          <div class="photo-actions">
            <button class="btn btn--primary" type="submit">${label('save')}</button>
          </div>
        </form>
      </section>
      <section class="page-section page-measure photo-fields">
        <p role="status" data-save-status></p>
        <div data-tasks-link hidden><a href="/tasks">${label('openTasks')}</a></div>
      </section>
    </div>`);

  const find = (selector) => container.querySelector(selector);
  const on = (element, event, listener) => element.addEventListener(event, listener, { signal });
  const intake = find('[data-intake]');
  const camera = find('[data-camera]');
  const gallery = find('[data-gallery]');
  const take = find('[data-take]');
  const choose = find('[data-choose]');
  const recognize = find('[data-read]');
  const preview = find('.photo-preview');
  const text = intake.querySelector('textarea');
  const mode = find('[data-mode]');
  const review = find('[data-review]');
  const reviewSection = find('[data-review-section]');
  const form = reviewSection.querySelector('form');
  const list = find('.photo-drafts');
  const save = form.querySelector('button[type="submit"]');
  const ocrStatus = find('[data-ocr-status]');
  const saveStatus = find('[data-save-status]');
  // Draft labels are escaped before the markup is inserted.
  const draftMarkup = `
    <fieldset class="photo-draft photo-fields">
      <legend></legend>
      <label>${label('title')}<input class="form-input" name="title" maxlength="${MAX_TITLE}" required></label>
      <label>${label('description')}<textarea class="form-input" name="description" rows="3" maxlength="${MAX_DESCRIPTION}"></textarea></label>
      <label>${label('due')}<input class="form-input" name="due_date" type="date"></label>
      <label>${label('assignee')}<select class="form-input" name="assigned_to"></select></label>
      <label>${label('visibility')}
        <select class="form-input" name="visibility">
          <option value="assignees">${label('assignees')}</option>
          <option value="private">${label('private')}</option>
          <option value="all">${label('all')}</option>
        </select>
      </label>
      <p role="status"></p>
      <div class="photo-actions">
        <button type="button" class="btn btn--secondary">${label('remove')}</button>
      </div>
    </fieldset>`;

  intake.inert = true;
  let permissions;
  try {
    ({ permissions } = await api.get('/auth/me', { signal }));
  } catch (error) {
    if (!signal.aborted) throw error;
    return;
  }
  if (signal.aborted) return;
  if (permissions?.modules?.tasks !== 'write' || permissions?.modules?.['ext:' + EXTENSION] !== 'write') {
    intake.hidden = true;
    saveStatus.textContent = tr('accessDenied');
    return;
  }
  intake.inert = false;

  let jpeg = null;
  let busy = false;
  let saving = false;
  let saved = 0;
  let nextNumber = 0;
  const rows = new Set();
  let users = [];
  const membersReady = api.get('/tasks/meta/options', { signal }).then((result) => {
    if (!signal.aborted) users = result.users || [];
  }).catch(() => {
    if (!signal.aborted) find('[data-members-status]').textContent = tr('noMembers');
  });

  function refreshControls() {
    take.disabled = choose.disabled = busy || saving;
    recognize.disabled = busy || saving || !jpeg;
    review.disabled = busy || saving;
    text.readOnly = busy || saving;
    mode.disabled = saving;
    save.disabled = busy || saving || !Array.from(rows).some((row) => !row.done);
  }

  async function usePhoto(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    input.value = '';
    if (!file || busy || saving) return;
    jpeg = null;
    preview.hidden = true;
    preview.removeAttribute('src');
    if (file.size > FILE_LIMIT) {
      ocrStatus.textContent = tr('imageLimit');
      refreshControls();
      return;
    }
    busy = true;
    refreshControls();
    ocrStatus.textContent = tr('processing');
    try {
      const photo = await preparePhoto(file, signal);
      if (signal.aborted) return;
      jpeg = photo.jpeg;
      preview.src = photo.preview;
      preview.hidden = false;
      ocrStatus.textContent = '';
    } catch {
      if (!signal.aborted) ocrStatus.textContent = tr('imageError');
    } finally {
      busy = false;
      if (!signal.aborted) refreshControls();
    }
  }

  on(take, 'click', () => camera.click());
  on(choose, 'click', () => gallery.click());
  on(camera, 'change', usePhoto);
  on(gallery, 'change', usePhoto);

  on(recognize, 'click', async () => {
    if (!jpeg || busy || saving) return;
    busy = true;
    refreshControls();
    ocrStatus.textContent = tr('reading');
    try {
      const { token } = await callOcr('/csrf', { signal });
      if (signal.aborted) return;
      const result = await callOcr('/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'X-Photo-CSRF': token },
        body: jpeg,
        signal,
      });
      if (signal.aborted) return;
      if (result.text) {
        const combined = [text.value.trim(), result.text].filter(Boolean).join('\n');
        text.value = combined.slice(0, MAX_DESCRIPTION).replace(/[\uD800-\uDBFF]$/u, '');
        jpeg = null;
        ocrStatus.textContent = result.truncated || combined.length > MAX_DESCRIPTION ? tr('truncated') : '';
        text.focus();
      } else {
        ocrStatus.textContent = tr('noText');
      }
    } catch (error) {
      if (!signal.aborted) ocrStatus.textContent = tr(error.label || 'readError');
    } finally {
      busy = false;
      if (!signal.aborted) refreshControls();
    }
  });

  function appendDraft(draft) {
    list.insertAdjacentHTML('beforeend', draftMarkup);
    const fieldset = list.lastElementChild;
    const get = (name) => fieldset.querySelector('[name="' + name + '"]');
    const title = get('title');
    const description = get('description');
    const due = get('due_date');
    const assignee = get('assigned_to');
    const visibility = get('visibility');

    title.value = draft.title;
    description.value = draft.description;
    visibility.value = draft.visibility;
    assignee.append(option('', tr('unassigned')), ...users.map((user) => option(user.id, user.display_name)));
    fieldset.querySelector('legend').textContent = tr('draft', { number: ++nextNumber });

    const remove = fieldset.querySelector('button');
    const row = { fieldset, title, description, due, assignee, visibility, remove, status: fieldset.querySelector('[role="status"]') };
    rows.add(row);
    on(title, 'input', () => title.setCustomValidity(''));
    on(remove, 'click', () => {
      const nextFocus = fieldset.nextElementSibling?.querySelector('input:not(:disabled)')
        || fieldset.previousElementSibling?.querySelector('input:not(:disabled)') || review;
      rows.delete(row);
      fieldset.remove();
      reviewSection.hidden = rows.size === 0;
      refreshControls();
      nextFocus.focus();
    });
    return title;
  }

  on(review, 'click', async () => {
    if (busy || saving) return;
    const result = draftTasks(text.value, mode.value);
    if (result.error) {
      ocrStatus.textContent = tr(result.error);
      return;
    }
    const pending = Array.from(rows).filter((row) => !row.done).length;
    if (pending + result.drafts.length > MAX_TASKS) {
      ocrStatus.textContent = tr('tooManyPending');
      return;
    }
    busy = true;
    refreshControls();
    await membersReady;
    if (signal.aborted) return;
    const titles = result.drafts.map(appendDraft);
    text.value = '';
    ocrStatus.textContent = '';
    reviewSection.hidden = false;
    busy = false;
    refreshControls();
    titles[0].focus();
  });

  function lockRow(row, locked) {
    for (const field of [row.title, row.description, row.due, row.assignee, row.visibility, row.remove]) {
      field.disabled = locked;
    }
  }

  on(form, 'submit', async (event) => {
    event.preventDefault();
    if (saving || busy) return;
    const pending = Array.from(rows).filter((row) => !row.done);
    if (!pending.length) return;
    const invalid = pending.find((row) => !row.attempt && !row.title.value.trim());
    if (invalid) {
      invalid.title.setCustomValidity(tr('invalidTitle'));
      invalid.title.reportValidity();
      return;
    }

    saving = true;
    refreshControls();
    saveStatus.textContent = tr('saving');
    pending.forEach((row) => lockRow(row, true));
    for (const row of pending) {
      if (!row.attempt) {
        row.attempt = {
          key: idempotencyKey(),
          body: {
            title: row.title.value.trim(),
            description: row.description.value.trim() || null,
            due_date: row.due.value || null,
            assigned_to: row.assignee.value ? Number(row.assignee.value) : null,
            visibility: row.visibility.value,
          },
        };
      }
      try {
        await api.post('/tasks', row.attempt.body, {
          headers: { 'Idempotency-Key': row.attempt.key },
          signal,
        });
        if (signal.aborted) return;
        row.done = true;
        row.remove.hidden = true;
        row.status.textContent = tr('savedRow');
        saved += 1;
        find('[data-tasks-link]').hidden = false;
      } catch (error) {
        if (signal.aborted) return;
        const uncertain = row.uncertain || !error.status || error.status >= 500 || error.status === 409;
        row.uncertain = uncertain;
        if (!uncertain) row.attempt = null;
        row.status.textContent = uncertain ? tr('verifySave') : tr('saveError');
        if ([401, 403, 429].includes(error.status)) break;
      }
    }
    if (signal.aborted) return;
    pending.filter((row) => !row.done && !row.uncertain).forEach((row) => lockRow(row, false));
    saving = false;
    refreshControls();
    const incomplete = Array.from(rows).some((row) => !row.done);
    const summary = incomplete ? (saved ? 'partial' : 'saveError') : 'saved';
    saveStatus.textContent = tr(summary, { count: saved });
  });
}
