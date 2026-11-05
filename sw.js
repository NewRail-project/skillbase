// sw.js — Service Worker Skillbase.
//
// Стратегии:
//   - навигация (HTML)          — сеть прежде всего, офлайн-фолбэк из кэша;
//   - статика того же источника — stale-while-revalidate (мгновенно из кэша,
//                                 фоновое обновление);
//   - всё кросс-доменное        — обход (Firebase, CDN gstatic не трогаем);
//   - приватные запросы         — обход (см. PRIVATE_PATTERNS).
//
// Версия кэша меняется централизованно скриптом scripts/bump-version.mjs
// при каждой публикации: старый кэш удаляется целиком на активации, поэтому
// старые и новые JS-модули не смешиваются.

const CACHE_VERSION = 'v1.0.0.20261105123206';
const CACHE_NAME = `skillbase-${CACHE_VERSION}`;
const OFFLINE_URL = './index.html';

// Оболочка приложения и критические модули первого запуска.
// Пути относительные — резолвятся от каталога сворка (/skillbase/),
// поэтому работают и на GitHub Pages, и локально.
// Список содержит только существующие файлы; установка не падает целиком,
// если один из ресурсов недоступен (см. install).
const PRECACHE_URLS = [
  './index.html',
  './ui/brand/manifest.webmanifest',
  './ui/brand/favicon.svg',
  './ui/css/tokens.css',
  './ui/css/themes/education.css',
  './ui/css/themes/operations.css',
  './ui/css/themes/depot.css',
  './ui/css/base.css',
  './ui/css/components.css',
  './ui/css/brand.css',
  './ui/css/fonts.css',
  './ui/fonts/inter-cyrillic.woff2',
  './ui/fonts/inter-latin.woff2',
  './shared/main.js',
  './shared/app.js',
  './shared/theme.js',
  './shared/icons.js',
  './shared/dom.js',
  './shared/return-to.js',
  './core/auth.js',
  './core/registration.js',
  './core/guest.js',
  './configs/firebase.js',
  './configs/organization.js',
  './ui/components/skeleton.js',
  './ui/components/sidebar.js',
  './ui/components/footer.js',
  './ui/components/loading.js',
  './ui/components/confirm.js',
  './ui/components/brand.js',
  './ui/pages/home.js',
  './ui/pages/404.js'
];

// Установка: кэшируем каждый ресурс отдельно. cache.addAll() атомарен —
// один отсутствующий файл отменял бы установку целиком, и весь кэш
// оставался пустым. Здесь недоступный ресурс просто пропускается.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(
      PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    // Офлайн-страница обязательна: без неё офлайн-фолбэк бессмыслен.
    await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
  })());
});

// Активация: удаляем кэши прошлых версий. Без skipWaiting: новый SW
// ждёт закрытия старых вкладок, чтобы старая страница не осталась работать
// поверх новых модулей (смешивание версий JS недопустимо).
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name !== CACHE_NAME && name.startsWith('skillbase-'))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

// Приватные маршруты того же источника, которые кэшировать нельзя даже
// случайно. Firestore и Auth — кросс-доменные и так обходятся SW,
// паттерны — страховка на случай будущих серверных эндпоинтов.
const PRIVATE_PATTERNS = [
  /testKeys/,
  /attempts/,
  /results/,
  /consents/,
  /rooms/,
  /publicProfiles/,
  /analytics/
];

function shouldBypass(request) {
  if (request.method !== 'GET') return true;
  const url = new URL(request.url);
  // Firebase (firestore/auth/gstatic) и любой другой сторонний домен:
  // SW не вмешивается, браузерный HTTP-кэш и SDK разбираются сами.
  if (url.origin !== self.location.origin) return true;
  if (PRIVATE_PATTERNS.some((re) => re.test(url.pathname))) return true;
  return false;
}

// Статические типы того же источника, которые можно отдавать из кэша.
const STATIC_EXT = /\.(?:css|js|mjs|svg|png|jpg|jpeg|webp|ico|woff2?|webmanifest|json)$/i;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (shouldBypass(request)) return;

  const url = new URL(request.url);

  // HTML: сеть прежде всего (свежая версия и новые ?v= у ресурсов),
  // при отсутствии сети — кэш, затем офлайн-страница.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (_) {
        const cached = await caches.match(request, { ignoreSearch: true });
        return cached || caches.match(OFFLINE_URL);
      }
    })());
    return;
  }

  // Статика: stale-while-revalidate. Повторные визиты и навигация получают
  // ресурс мгновенно из кэша, свежая копия тихо догружается в фон.
  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
  // Прочие запросы того же источника (например, динамические import() уже
  // покрыты .js-веткой) — отдаём браузеру без участия SW.
});

// Сообщения от клиента. Автоматический skipWaiting не используем:
// обновление применяется после закрытия старых вкладок.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
