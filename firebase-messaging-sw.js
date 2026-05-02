importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging.js');

// Replace these placeholders with your Firebase web app config from:
// Firebase Console > Project settings > General > Your apps > SDK setup and configuration.
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

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message ', payload);

  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico', // Add your app icon
    badge: '/favicon.ico',
    tag: 'orbi-message', // Group notifications
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

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'open') {
    // Open the app
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});