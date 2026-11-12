// shared/qr.js — QR-коды для ссылок на тесты и комнаты.
// Генерация локальная (shared/qrcode.js), без внешних сервисов и сети.
import { qrToDataUrl, qrToSvg } from "./qrcode.js";

// Возвращает data:-URL SVG-картинки или null, если ссылку закодировать нельзя.
export async function generateQRDataUrl(url, options = {}) {
  try {
    return qrToDataUrl(url, options);
  } catch (error) {
    console.error("QR generation failed:", error);
    return null;
  }
}

export function generateQRSvg(url, options = {}) {
  try {
    return qrToSvg(url, options);
  } catch (error) {
    console.error("QR generation failed:", error);
    return null;
  }
}
