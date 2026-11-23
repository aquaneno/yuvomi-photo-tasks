const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5000;
const MAX_TASKS = 30;
const LIST_MARKER = /^(?:[-*•◦▪☐☑]\s*|\[[ xX]\]\s*|\d{1,3}[.)]\s+)+/u;

function draft(title, description = '') {
  let shortTitle = title;
  if (title.length > MAX_TITLE) {
    shortTitle = title.slice(0, MAX_TITLE).replace(/[\uD800-\uDBFF]$/u, '');
    if (!description) description = title;
  }
  return { title: shortTitle.trim(), description, visibility: 'assignees' };
}

export function draftTasks(text, mode) {
  const lines = text.split(/\r\n?|\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { error: 'noDrafts' };

  if (mode === 'single') return { drafts: [draft(lines[0], text.trim())] };

  const titles = lines.map((line) => line.replace(LIST_MARKER, '').trim()).filter(Boolean);
  if (titles.length > MAX_TASKS) return { error: 'tooMany' };
  if (titles.length === 0) return { error: 'noDrafts' };
  return { drafts: titles.map((title) => draft(title)) };
}

export { MAX_TITLE, MAX_DESCRIPTION, MAX_TASKS };
