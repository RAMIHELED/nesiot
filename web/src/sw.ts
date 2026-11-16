/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope;

// Offline cache of the app files (filled in at build time)
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// New versions take over right away (registerType: autoUpdate)
self.skipWaiting();
clientsClaim();

type PushPayload = { title: string; body: string; url?: string; tag?: string };

self.addEventListener("push", (event) => {
  let data: PushPayload = { title: "נסיעות", body: "" };
  try {
    data = event.data?.json() ?? data;
  } catch {
    data.body = event.data?.text() ?? "";
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icon.svg",
      badge: "/icon.svg",
      dir: "rtl",
      lang: "he",
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data?.url as string) ?? "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          await (w as WindowClient).navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
