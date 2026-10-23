// ui/pages/404.js
export default function NotFoundComponent() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>404</h2>
    <p>Страница не найдена</p>
    <button onclick="window.location.hash='#/'">Вернуться на главную</button>
  `;
  return div;
}