// ui/pages/error.js
export default function ErrorComponent({ message }) {
  const div = document.createElement("div");
  div.className = "card error";
  div.innerHTML = `
    <h2>Ошибка</h2>
    <p>${message}</p>
    <button onclick="window.location.hash='#/'">Вернуться на главную</button>
  `;
  return div;
}