// Простая генерация QR-кода (SVG)
export function toQR(text, size = 150) {
  // Для простоты — заглушка, возвращающая SVG-элемент с текстом,
  // так как нет доступа к npm-пакетам qrcode
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 100 100");
  
  const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
  textEl.setAttribute("x", "50%");
  textEl.setAttribute("y", "50%");
  textEl.setAttribute("text-anchor", "middle");
  textEl.textContent = "QR:" + text.substring(text.lastIndexOf('/') + 1);
  
  svg.appendChild(textEl);
  return svg;
}
