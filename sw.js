// sw.js — Service Worker для базовой офлайн-поддержки

const CACHE_NAME = 'skillbase-v1';
const OFFLINE_URL = '/index.html';
const STATIC_CACHE_URLS = [
  '/',
  '/index.html',
  '/ui/css/brand.css',
  '/ui/css/tokens.css',
  '/ui/css/themes/education.css',
  '/ui/css/themes/operations.css',
  '/ui/css/themes/depot.css',
  '/shared/icons.js',
  '/shared/theme.js',
  '/shared/app.js',
  '/shared/main.js',
  '/core/auth.js',
  '/core/registration.js',
  '/ui/components/sidebar.js',
  '/ui/components/header.js',
  '/ui/components/footer.js',
  '/ui/components/loading.js',
  '/ui/components/confirm.js',
  '/ui/pages/home.js',
  '/ui/pages/404.js'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching app shell and content');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия кэширования: сначала сеть, затем кэш (fallback)
self.addEventListener('fetch', (event) => {
  // Не кэшируем запросы, содержащие персональные данные
  if (shouldBypassCache(event.request)) {
    return;
  }
  
  // Для HTML-страниц используем стратегию "сеть с fallback"
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match(OFFLINE_URL);
        })
    );
    return;
  }
  
  // Для остальных запросов используем стратегию "сеть с fallback"
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Проверка, нужно ли обходить кэш для запросов с персональными данными
function shouldBypassCache(request) {
  // URL-паттерны, которые не должны кэшироваться
  const bypassPatterns = [
    /\/testKeys\//,          // Правильные ответы
    /\/attempts\//,         // Результаты пользователей
    /\/results\//,          // Результаты тестов
    /\/consent\//,          // Согласия
    /\/rooms\//,           // Live-комнаты
    /\/materials\/.*\/page/, // Страницы материалов
    /\/users\//,           // Пользовательские данные
    /\/analytics\//,        // Аналитика
    /\/admin\//,           // Админ-данные
    /\/assignments\//,      // Задания
    /firebase/             // Firebase запросы
  ];
  
  const url = request.url;
  
  // Проверяем метод запроса
  if (request.method !== 'GET') {
    return true;
  }
  
  // Проверяем заголовки
  const headers = request.headers;
  if (headers.get('authorization') || headers.get('Authorization')) {
    return true;
  }
  
  // Проверяем URL на соответствие паттернам
  return bypassPatterns.some(pattern => pattern.test(url));
}

// Обработка сообщений от клиента
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_UPDATED') {
    // Можно добавить логику обновления кэша
    console.log('Cache update requested');
  }
});