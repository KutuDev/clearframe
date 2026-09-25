const status = document.querySelector('#status');

async function recover() {
  const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? [];
  await Promise.all(registrations.map(registration => registration.unregister()));
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
  location.replace('/?recovered=1');
}

recover().catch(() => {
  status.textContent = 'Could not refresh automatically. Please clear this siteâ€™s storage and reload.';
});
