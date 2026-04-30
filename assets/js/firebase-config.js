import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

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

export const isFirebaseConfigured = !Object.values(firebaseConfig).some((value) =>
  String(value).startsWith("PASTE_")
);

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
