/**
 * sw.js — ZaloCRM Service Worker
 * Xử lý Web Push notifications và cache cơ bản.
 */

const CACHE_NAME = 'zalocrm-v1';

// ── Install & Activate ───────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Push Event — nhận notification từ server ─────────────────────────────────

self.addEventListener('push', (event) => {
  let payload = {
    title: 'ZaloCRM',
    body: 'Có tin nhắn mới',
    icon: '/pwa-192x192.svg',
    badge: '/pwa-192x192.svg',
    tag: 'default',
    data: { url: '/chat' },
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    tag: payload.tag,           // nhóm notifications cùng conversation vào 1 cụm
    renotify: true,             // rung/âm thanh dù cùng tag
    requireInteraction: false,  // tự tắt sau vài giây (không bắt phải click)
    data: payload.data,
    actions: [
      { action: 'open', title: '📩 Mở chat' },
      { action: 'dismiss', title: 'Bỏ qua' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// ── Notification Click — mở tab app khi user click vào notification ──────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/chat';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Nếu app đang mở ở tab nào đó → focus tab đó và navigate
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'PUSH_CLICKED', url: targetUrl });
          return;
        }
      }
      // Không có tab nào đang mở → mở tab mới
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ── Push Subscription Change — tự động re-subscribe khi browser refresh key ──

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
    }).then((newSub) => {
      // Gửi subscription mới lên server
      return fetch('/api/v1/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: newSub.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(newSub.getKey('p256dh')))),
            auth: btoa(String.fromCharCode(...new Uint8Array(newSub.getKey('auth')))),
          },
        }),
      });
    })
  );
});
