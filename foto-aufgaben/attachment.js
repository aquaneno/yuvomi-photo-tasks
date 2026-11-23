import { api } from '/api.js';
import { t } from '/i18n.js';
import { MAX_TITLE } from './drafts.js';

const IMAGE_EXTENSIONS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function photoMime(file) {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  return IMAGE_EXTENSIONS[file.name.split('.').at(-1).toLowerCase()] || '';
}

export async function attachPhoto(taskId, task, photo, makeKey, signal) {
  // Share a single document across tasks only when both have the same audience.
  const visibility = { all: 'family', assignees: 'restricted', private: 'private' }[task.visibility];
  const members = visibility === 'restricted' && task.assigned_to ? [task.assigned_to] : [];
  const audience = visibility + ':' + members.join(',');
  let upload = photo.uploads.get(audience);
  if (!upload) {
    upload = { key: makeKey() };
    photo.uploads.set(audience, upload);
  }

  if (!upload.id) {
    const fileName = photo.file.name.slice(0, MAX_TITLE).replace(/[\uD800-\uDBFF]$/u, '');
    const dataUrl = await readFileAsDataUrl(photo.file);
    signal.throwIfAborted();
    const { data } = await api.post('/documents', {
      name: fileName,
      original_name: fileName,
      content_data: dataUrl.replace(/^data:[^;]*/, 'data:' + photoMime(photo.file)),
      folder_key: 'tasks',
      folder_name: t('documents.tasksFolder'),
      visibility,
      allowed_member_ids: members,
    }, { headers: { 'Idempotency-Key': upload.key }, signal });
    if (!data?.id) throw new Error('Document upload returned no ID');
    upload.id = data.id;
  }

  const path = '/tasks/' + taskId + '/documents';
  const { data: existing } = await api.get(path, { signal });
  if (existing.some((document) => document.id === upload.id)) return;
  const { data: linked } = await api.put(path, {
    document_ids: [...existing.map((document) => document.id), upload.id],
  }, { signal });
  if (!linked?.some((document) => document.id === upload.id)) {
    throw new Error('Document was not linked to the task');
  }
}
