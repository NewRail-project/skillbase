// ui/pages/loading.js
export default function LoadingComponent() {
  const div = document.createElement("div");
  div.className = "card loading";
  div.innerHTML = `
    <div class="spinner"></div>
    <p>Загрузка...</p>
  `;
  return div;
}