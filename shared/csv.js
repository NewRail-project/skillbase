// shared/csv.js — корректный CSV-экспорт.
// Правила: поля с запятой/переводом строки/кавычкой заключаются в кавычки, кавычки удваиваются.
// Значения, начинающиеся с = + - @ или табуляции, получают префикс апострофа ( защита от формул).
// BOM \uFEFF в начале для Excel.

function needsQuote(field) {
  return /[",\r\n]/.test(field);
}

export function toCsv(rows, headers) {
  const head = headers || (rows.length ? Object.keys(rows[0]) : []);
  const escapeField = (value) => {
    let s = value == null ? '' : String(value);
    // защита от формул: = + - @ или табуляция в начале
    if (/^[=+\-@\t]/.test(s)) s = "'" + s;
    if (needsQuote(s)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [head.map(escapeField).join(',')];
  for (const row of rows) {
    lines.push(head.map(k => escapeField(row[k])).join(','));
  }
  return '\uFEFF' + lines.join('\n');
}