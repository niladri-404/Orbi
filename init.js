import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.currentUser = null;

onAuthStateChanged(auth, async (user) => {
  console.log("🔥 AUTH STATE:", user);

  if (!user) {
    alert("User not logged in");
    return;
  }

  window.currentUser = user;

  await loadUser(user);
  loadChats(user.uid);
  loadContacts(user.uid);
});

async function loadUser(user) {
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      console.error("User doc missing");
      return;
    }

    const data = snap.data();

    document.getElementById("username").innerText = data.name || "No Name";
    document.getElementById("userEmail").innerText = data.email || "";

  } catch (e) {
    console.error("User load error:", e);
  }
}

function loadChats(uid) {
  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", uid)
  );

  onSnapshot(q, (snap) => {
    console.log("Chats:", snap.size);

    const list = document.getElementById("chatList");
    list.innerHTML = "";

    snap.forEach(doc => {
      const d = doc.data();

      const el = document.createElement("div");
      el.innerText = d.lastMessage || "Chat";

      list.appendChild(el);
    });
  });
}

function loadContacts(uid) {
  const q = collection(db, "users");

  onSnapshot(q, (snap) => {
    const list = document.getElementById("contactList");
    list.innerHTML = "";

    snap.forEach(doc => {
      if (doc.id === uid) return;

      const d = doc.data();

      const el = document.createElement("div");
      el.innerText = d.name || "User";

      list.appendChild(el);
    });
  });
}
