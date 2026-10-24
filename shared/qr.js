import QRCode from './vendor/qr.js';

export async function generateQRDataUrl(url) {
  try {
    return await QRCode.toDataURL(url);
  } catch (error) {
    console.error('QR generation failed:', error);
    return null;
  }
}