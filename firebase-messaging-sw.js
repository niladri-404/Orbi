importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCgrjFJBMGns3qizxGogAiq8CCbQP9lyX4",
  authDomain: "orbi-77b43.firebaseapp.com",
  projectId: "orbi-77b43",
  storageBucket: "orbi-77b43.firebasestorage.app",
  messagingSenderId: "677933088390",
  appId: "1:677933088390:web:7feb80f06257114c469b07",
  measurementId: "G-9D5CCFWQLL"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();
console.log('[SW] Firebase Messaging service worker initialized');

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Received background message', payload);

  const notificationTitle = payload.notification?.title || 'New Message';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'orbi-message',
    requireInteraction: true,
    actions: [
      {
        action: 'open',
        title: 'Open Chat'
      }
    ]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'open') {
    event.waitUntil(clients.openWindow('/'));
  } else {
    event.waitUntil(clients.openWindow('/'));
  }
});