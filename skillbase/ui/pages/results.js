import { renderTeacherResults, toCsv } from './teacher-results.js';

export default function ResultsPage() {
  const page = document.createElement('div');
  renderTeacherResults(page, {
    rows: [],
    onExport: (rows) => {
      const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'results.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
    onGrade: () => {} // TODO: проверка преподавателем (этап 3)
  });
  return page;
}
