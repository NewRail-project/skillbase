// shared/utils.js — утилиты.
//
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&nbsp;')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ');
}

export function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date.seconds * 1000 + date.nanoseconds / 1000);
  return d.toLocaleString();
}