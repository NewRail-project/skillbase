export function loading() {
  const div = document.createElement("div");
  div.className = "card skeleton-loading";
  div.innerHTML = `
    <div class="skeleton-line title" style="height:24px;width:60%;margin-bottom:16px;background:var(--border);border-radius:var(--radius-s);animation:skeleton-pulse 1.2s ease-in-out infinite;"></div>
    <div class="skeleton-line" style="height:16px;width:90%;margin-bottom:8px;background:var(--border);border-radius:var(--radius-s);animation:skeleton-pulse 1.2s ease-in-out infinite;"></div>
    <div class="skeleton-line" style="height:16px;width:75%;margin-bottom:8px;background:var(--border);border-radius:var(--radius-s);animation:skeleton-pulse 1.2s ease-in-out infinite;"></div>
    <div class="skeleton-line" style="height:16px;width:40%;background:var(--border);border-radius:var(--radius-s);animation:skeleton-pulse 1.2s ease-in-out infinite;"></div>
  `;
  return div;
}
