// ui/pages/results.js
import { useState, useEffect } from 'https://unpkg.com/react@18/umd/react.development.js';
import { getTeacherResults } from '../../core/assign.js';

export default function ResultsComponent({ testId }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadResults = async () => {
      const data = await getTeacherResults(testId);
      setResults(data);
      setLoading(false);
    };
    loadResults();
  }, [testId]);

  if (loading) {
    return <div>Загрузка...</div>;
  }

  return (
    <div className="results">
      <h2>Результаты теста</h2>
      <table>
        <thead>
          <tr>
            <th>Ученик</th>
            <th>Баллы</th>
            <th>Дата</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.id}>
              <td>{r.userId}</td>
              <td>{r.score}</td>
              <td>{r.finishedAt?.toDate().toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => exportToCSV(results)}>Экспорт в CSV</button>
    </div>
  );
}

function exportToCSV(results) {
  const csv = "Ученик,Баллы,Дата\n" + results.map(r => `${r.userId},${r.score},${r.finishedAt?.toDate().toLocaleDateString()}`).join("\n");
  const blob = new Blob([csv], {type: 'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `results_${testId}.csv`;
  a.click();
}