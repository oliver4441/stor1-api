// Custom service worker for push notifications
// This script is loaded by Workbox via importScripts

// Listen for messages from the page
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Listen for push events from the server
self.addEventListener('push', function(event) {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Omix Store', body: event.data.text() };
  }

  const options = {
    body: data.body || '',
    icon: '/logo.jpg',
    badge: '/logo.jpg',
    image: data.image || null,
    data: data.data || {},
    actions: data.actions || [],
    tag: data.tag || 'omix-notification',
    renotify: data.renotify !== false,
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Omix Store', options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // If a window is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Handle notification close (dismiss)
self.addEventListener('notificationclose', function(event) {
  // Could track dismissed notifications via analytics
});
