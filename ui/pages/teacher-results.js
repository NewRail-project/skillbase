export function renderTeacherResults(container, { rows = [], onGrade, onExport } = {}) {
  container.innerHTML = `
    <section class="teacher-results">
      <header class="tr-header">
        <h2>Результаты</h2>
        <button type="button" class="tr-export">Экспорт CSV</button>
      </header>
      <div class="tr-table-wrap">
        <table class="tr-table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Тест</th>
              <th>Балл</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr data-index="${i}">
                <td>${escapeHtml(r.student ?? '')}</td>
                <td>${escapeHtml(r.test ?? '')}</td>
                <td>${r.score ?? '—'}</td>
                <td>${r.verified ? 'проверено' : 'ожидает'}</td>
                <td>
                  ${r.verified ? '' : `<button type="button" class="tr-grade" data-index="${i}">Проверить</button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`;

  container.querySelector('.tr-export')?.addEventListener('click', () => onExport?.(rows));
  container.querySelectorAll('.tr-grade').forEach(btn =>
    btn.addEventListener('click', () => onGrade?.(rows[Number(btn.dataset.index)])));
}

export function toCsv(rows) {
  const head = ['student', 'test', 'score', 'verified'];
  const lines = rows.map(r => head.map(k => JSON.stringify(r[k] ?? '')).join(','));
  return [head.join(','), ...lines].join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
