// ui/components/network-status.js — глобальный индикатор состояния сети

import { State } from '../../core/auth.js';

// Состояние сети
let isOnline = navigator.onLine;
let hasShownOffline = false;
let hasShownOnline = false;
let notificationTimeout = null;

// Элемент уведомления
function createNotification() {
  const notification = document.createElement('div');
  notification.className = 'network-status-notification';
  notification.setAttribute('role', 'status');
  notification.setAttribute('aria-live', 'polite');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${isOnline ? '#4CAF50' : '#f44336'};
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    max-width: 90%;
    text-align: center;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
    pointer-events: none;
  `;
  
  // Добавляем safe-area для мобильных устройств
  if ('visualViewport' in window) {
    notification.style.top = `${window.visualViewport.offsetTop + 20}px`;
  }
  
  return notification;
}

// Показать уведомление
function showNotification(message) {
  // Удаляем предыдущее уведомление, если есть
  const existing = document.querySelector('.network-status-notification');
  if (existing) {
    existing.remove();
  }
  
  // Создаем и показываем новое
  const notification = createNotification();
  notification.textContent = message;
  notification.style.opacity = '1';
  
  document.body.appendChild(notification);
  
  // Автоматически скрываем через 3 секунды
  notificationTimeout = setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 300);
  }, 3000);
}

// Обработчики событий
function handleOnline() {
  isOnline = true;
  
  // Показываем уведомление только один раз после восстановления
  if (!hasShownOnline) {
    hasShownOnline = true;
    hasShownOffline = false; // Сбрасываем флаг offline
    showNotification('Соединение восстановлено');
  }
}

function handleOffline() {
  isOnline = false;
  
  // Показываем уведомление только один раз при потере соединения
  if (!hasShownOffline) {
    hasShownOffline = true;
    hasShownOnline = false; // Сбрасываем флаг online
    showNotification('Нет подключения к интернету');
  }
}

// Инициализация
export function initNetworkStatus() {
  // Проверяем текущее состояние
  isOnline = navigator.onLine;
  
  // Вешаем обработчики
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  
  // Обновляем позицию при изменении viewport (мобильные устройства)
  if ('visualViewport' in window) {
    window.visualViewport.addEventListener('resize', () => {
      const notification = document.querySelector('.network-status-notification');
      if (notification) {
        notification.style.top = `${window.visualViewport.offsetTop + 20}px`;
      }
    });
  }
  
  // Возвращаем функцию очистки
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    if (notificationTimeout) {
      clearTimeout(notificationTimeout);
    }
    const notification = document.querySelector('.network-status-notification');
    if (notification) {
      notification.remove();
    }
  };
}

// Проверка состояния сети (для использования в других компонентах)
export function isNetworkOnline() {
  return isOnline;
}

// Проверка, доступен ли Firebase (дополнительно к интернет-соединению)
export async function isFirebaseAvailable() {
  if (!isOnline) return false;
  
  try {
    // Простая проверка доступности Firebase
    await State.auth.currentUser?.getIdToken(true);
    return true;
  } catch (error) {
    console.warn('Firebase недоступен:', error);
    return false;
  }
}