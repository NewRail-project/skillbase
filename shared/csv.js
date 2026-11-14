// shared/csv.js — корректный CSV-экспорт.
// Правила (RFC 4180): поля с разделителем/переводом строки/кавычкой
// заключаются в кавычки, кавычки удваиваются. Значения, начинающиеся
// с = + - @ или табуляции, получают префикс апострофа (защита от формул).
// BOM \uFEFF в начале для Excel. Строки разделяет CRLF.
// Разделитель по умолчанию «,» (совместимость с прежним экспортом);
// для русскоязычных табличных редакторов передавайте «;» — их локальный
// Excel открывает без мастера импорта.

function needsQuote(field, separator) {
  return field.includes('"') || field.includes("\r") || field.includes("\n")
    || field.includes(separator);
}

export function toCsv(rows, headers, { separator = ",", lineEnd = "\r\n" } = {}) {
  const head = headers || (rows.length ? Object.keys(rows[0]) : []);
  const escapeField = (value) => {
    let s = value == null ? '' : String(value);
    // защита от формул: = + - @ или табуляция в начале
    if (/^[=+\-@\t]/.test(s)) s = "'" + s;
    if (needsQuote(s, separator)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [head.map(escapeField).join(separator)];
  for (const row of rows) {
    lines.push(head.map(k => escapeField(row[k])).join(separator));
  }
  return '\uFEFF' + lines.join(lineEnd);
}

// Безопасное имя файла: убирает недопустимые символы файловой системы
// (Windows-запрещённые, управляющие) и схлопывает пробелы. Пустое имя
// заменяется на запасное — файл всегда downloadable.
export function safeFileName(name, fallback = "журнал") {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

// Скачивание CSV без перезагрузки и без зависимостей (как в results.js).
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
