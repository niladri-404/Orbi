/*
  chat.js
  --------
  Real-time one-to-one chat dashboard using Firebase Firestore.
  - users collection stores profiles
  - chats collection stores chat metadata and unread counts
  - messages subcollection stores the conversation history
*/

import { auth, db, storage, messaging, isFirebaseConfigured } from "./firebase-config.js";

console.log("Chat JS loaded successfully");
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-storage.js";
import {
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const state = {
  currentUser: null,
  currentProfile: null,
  contacts: [],
  chats: new Map(),
  activeChatId: "",
  activePeer: null,
  roomKeys: new Map(),
  typingTimer: null,
  typingDebounce: null,
  isTyping: false,
  peerTyping: false,
  presenceListenersAttached: false,
  incomingRequests: [],
  outgoingRequests: [],
  unsubChats: null,
  unsubMessages: null,
  unsubContacts: null,
  unsubIncoming: null,
  unsubPeerStatus: null,
  unsubPeerTyping: null,
  // Media recording state
  mediaRecorder: null,
  recordedChunks: [],
  recordingStartTime: null,
  recordingTimer: null,
  voicePreviewBlob: null,
  // Notification state
  fcmToken: null
};


const els = {
  sidebar: $("[data-sidebar]"),
  sidebarBackdrop: $("[data-sidebar-backdrop]"),
  sidebarToggleButtons: $$('[data-sidebar-toggle]'),
  contactList: $("[data-contact-list]"),
  conversationList: $("#chatList"),
  userSearch: $("#chatSearchInput"),
  inviteButton: $("[data-invite-button]"),
  requestsToggle: $("[data-requests-toggle]"),
  requestsPanel: $("[data-requests-panel]"),
  requestForm: $("[data-request-form]"),
  requestEmail: $("#searchInput"),
  searchBtn: $("#searchBtn"),
  searchResult: $("#searchResult"),
  requestList: $("#requestList"),
  sentRequestList: $("[data-sent-request-list]"),
  removeContactBtn: $("[data-remove-contact]"),
  blockContactBtn: $("[data-block-contact]"),
  chatTitle: $("[data-chat-title]"),
  chatSubtitle: $("[data-chat-subtitle]"),
  chatAvatar: $("[data-chat-avatar]"),
  userStatus: $("#userStatus"),
  typingIndicator: $("#typingIndicator"),
  chatStream: $("#messages"),
  composer: $("[data-composer]"),
  messageInput: $("#messageInput"),
  sendButton: $("#sendBtn"),
  pageMessage: $("[data-page-message]"),
  userName: $("#userName"),
  userAvatar: $("[data-user-avatar]"),
  themeToggle: $("#themeToggle"),
  // New media elements
  attachBtn: $("#attachBtn"),
  attachButton: $("[data-attach-button]"),
  fileInput: $("#fileInput"),
  imageInput: $("[data-image-input]"),
  voiceButton: $("[data-voice-button]"),
  // Modals
  imageModal: $("[data-image-modal]"),
  previewImage: $("[data-preview-image]"),
  sendImageBtn: $("[data-send-image]"),
  cancelImageBtn: $("[data-cancel-image]"),
  fullscreenModal: $("[data-fullscreen-modal]"),
  fullscreenImage: $("[data-fullscreen-image]"),
  voiceModal: $("[data-voice-modal]"),
  recordingIndicator: $("[data-recording-indicator]"),
  recordingTimer: $("[data-recording-timer]"),
  previewAudio: $("[data-preview-audio]"),
  sendVoiceBtn: $("[data-send-voice]"),
  cancelVoiceBtn: $("[data-cancel-voice]"),
  // Toast notifications
  toastContainer: $("[data-toast-container]")
};

// Helpers for safe text output and formatting timestamps for chat messages.

const statusIcons = {
  success: "✔",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️"
};

const showStatus = (message, type = "info", target = els.pageMessage) => {
  if (!target) return;
  const icon = document.createElement("span");
  icon.className = "status-icon";
  icon.textContent = statusIcons[type] || statusIcons.info;

  const text = document.createElement("span");
  text.textContent = message;

  target.innerHTML = "";
  target.appendChild(icon);
  target.appendChild(text);
  target.className = `auth-message ${type}`;
  target.hidden = false;
};

const showMessage = showStatus;

const hideMessage = () => {
  if (!els.pageMessage) return;
  els.pageMessage.textContent = "";
  els.pageMessage.hidden = true;
};

const openSidebar = () => {
  if (!els.sidebar) return;
  els.sidebar.classList.add("open");
  els.sidebarBackdrop?.classList.add("open");
  if (els.sidebarBackdrop) els.sidebarBackdrop.hidden = false;
  document.body.classList.add("sidebar-open");
};

const closeSidebar = () => {
  if (!els.sidebar) return;
  els.sidebar.classList.remove("open");
  els.sidebarBackdrop?.classList.remove("open");
  if (els.sidebarBackdrop) {
    window.setTimeout(() => {
      els.sidebarBackdrop.hidden = true;
    }, 260);
  }
  document.body.classList.remove("sidebar-open");
};

const toggleSidebar = () => {
  if (!els.sidebar) return;
  if (els.sidebar.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
};

const initials = (name = "", email = "") => {
  const source = name.trim() || email.trim();
  if (!source) return "OR";
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
};

const safeText = (value, fallback = "") => String(value || fallback);

const escapeHTML = (value) => safeText(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const toMillis = (timestamp) => {
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  if (timestamp.seconds) return timestamp.seconds * 1000;
  return 0;
};

const formatTime = (timestamp) => {
  const millis = toMillis(timestamp);
  if (!millis) return "Just now";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(millis));
};

const formatRelative = (timestamp) => {
  const millis = toMillis(timestamp);
  if (!millis) return "";
  const diff = Date.now() - millis;
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

const bufferToBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const base64ToBuffer = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const deriveChatKey = async (chatId) => {
  const secret = new TextEncoder().encode(`orbi-room:${chatId}`);
  const raw = await crypto.subtle.digest("SHA-256", secret);
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const getChatKey = async (chatId) => {
  if (state.roomKeys.has(chatId)) return state.roomKeys.get(chatId);
  const key = await deriveChatKey(chatId);
  state.roomKeys.set(chatId, key);
  return key;
};

const encryptText = async (plain, chatId) => {
  const key = await getChatKey(chatId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plain);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    ciphertext: bufferToBase64(encrypted),
    iv: bufferToBase64(iv)
  };
};

const decryptText = async (ciphertext, iv, chatId) => {
  const key = await getChatKey(chatId);
  const encryptedBuffer = base64ToBuffer(ciphertext);
  const ivBuffer = base64ToBuffer(iv);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuffer }, key, encryptedBuffer);
  return new TextDecoder().decode(decrypted);
};

const formatLastSeen = (timestamp) => {
  const millis = toMillis(timestamp);
  if (!millis) return "offline";
  const diff = Date.now() - millis;
  const minutes = Math.max(1, Math.floor(diff / 60000));

  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const date = new Date(millis);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return "yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
};

const formatPresenceLabel = (user) => {
  if (user?.status === "online") return "Online";
  if (user?.lastSeen) return `Last seen ${formatLastSeen(user.lastSeen)}`;
  return "Offline";
};

const updateOwnPresence = async (status) => {
  if (!state.currentUser) return;
  console.log("Presence updated:", status, "for", state.currentUser.uid);
  await setDoc(doc(db, "users", state.currentUser.uid), {
    status,
    lastSeen: serverTimestamp()
  }, { merge: true });
};

const setTypingState = async (chatId, isTyping) => {
  if (!chatId || !state.currentUser) return;
  const typingRef = doc(db, "typing", chatId);
  
  if (isTyping) {
    await setDoc(typingRef, {
      [state.currentUser.uid]: true
    }, { merge: true });
  } else {
    try {
      await updateDoc(typingRef, {
        [state.currentUser.uid]: deleteField()
      });
    } catch (e) {
      // Document might not exist or field already deleted, ignore
    }
  }
};

const listenUserStatus = (uid, callback) => {
  if (state.unsubPeerStatus) {
    state.unsubPeerStatus();
    state.unsubPeerStatus = null;
  }
  if (!uid) return;

  const userRef = doc(db, "users", uid);
  state.unsubPeerStatus = onSnapshot(userRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : { status: "offline", lastSeen: null });
  }, () => {});
};

const listenTyping = (chatId, callback) => {
  if (state.unsubPeerTyping) {
    state.unsubPeerTyping();
    state.unsubPeerTyping = null;
  }
  if (!chatId || !state.currentUser) return;

  state.unsubPeerTyping = onSnapshot(doc(db, "typing", chatId), (docSnap) => {
    const data = docSnap.data();
    const isSomeoneTyping = Object.keys(data || {})
      .some(uid => uid !== state.currentUser.uid);
    callback(isSomeoneTyping);
  }, () => {});
};

const contactDocRef = (userId, contactUid) => doc(db, "contacts", userId, "list", contactUid);
const incomingRequestsRef = (uid) => collection(db, "requests", uid, "incoming");
const outgoingRequestsRef = (uid) => collection(db, "requests", uid, "outgoing");
const inviteDocRef = (inviteId) => doc(db, "invites", inviteId);

const isContact = (uid) => state.contacts.some((contact) => contact.uid === uid);

const createContactPayload = (profile) => ({
  uid: profile.uid,
  name: profile.name || "Orbi User",
  email: profile.email || "",
  photoURL: profile.photoURL || "",
  addedAt: serverTimestamp(),
  status: profile.status || "offline",
  lastSeen: profile.lastSeen || serverTimestamp()
});

const addContact = async (ownerUid, profile) => {
  if (!ownerUid || !profile?.uid) return;
  await setDoc(contactDocRef(ownerUid, profile.uid), createContactPayload(profile), { merge: true });
};

const addMutualContacts = async (peer) => {
  if (!state.currentUser || !peer?.uid || peer.uid === state.currentUser.uid) return;

  const currentPayload = {
    uid: state.currentUser.uid,
    name: state.currentProfile?.name || state.currentUser.displayName || "Orbi User",
    email: state.currentProfile?.email || state.currentUser.email || "",
    photoURL: state.currentProfile?.photoURL || state.currentUser.photoURL || "",
    status: state.currentProfile?.status || "offline",
    lastSeen: state.currentProfile?.lastSeen || serverTimestamp()
  };

  await Promise.all([
    addContact(state.currentUser.uid, peer),
    addContact(peer.uid, currentPayload)
  ]);
};

const createInviteLink = async () => {
  if (!state.currentUser) return "";
  const inviteId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await setDoc(inviteDocRef(inviteId), {
    id: inviteId,
    createdBy: state.currentUser.uid,
    createdByEmail: state.currentUser.email || "",
    createdAt: serverTimestamp(),
    expiresAt: expiry,
    used: false
  });

  return `${window.location.origin}${window.location.pathname}?invite=${inviteId}`;
};

const acceptInvite = async (inviteId) => {
  if (!state.currentUser) return;
  const snapshot = await getDoc(inviteDocRef(inviteId));
  if (!snapshot.exists()) throw new Error("Invite not found.");

  const invite = snapshot.data();
  if (invite.used) throw new Error("This invite has already been used.");
  if (invite.createdBy === state.currentUser.uid) throw new Error("You cannot accept your own invite.");
  if (invite.expiresAt && toMillis(invite.expiresAt) < Date.now()) throw new Error("This invite has expired.");

  const inviterSnapshot = await getDoc(doc(db, "users", invite.createdBy));
  if (!inviterSnapshot.exists()) throw new Error("Inviter profile is unavailable.");

  await addMutualContacts({ uid: invite.createdBy, ...inviterSnapshot.data() });
  await updateDoc(inviteDocRef(inviteId), {
    used: true,
    usedBy: state.currentUser.uid,
    usedAt: serverTimestamp()
  });
};

const findUserByEmail = async (email) => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Enter an email to search.");
  if (!normalizedEmail.includes("@")) throw new Error("Please enter a valid email address.");

  console.log("[Search] Searching for email:", normalizedEmail);

  const usersRef = collection(db, "users");
  const queryRef = query(usersRef, where("emailLower", "==", normalizedEmail));
  const snapshot = await getDocs(queryRef);
  
  console.log("[Search] Query returned", snapshot.docs.length, "result(s)");

  if (snapshot.empty) {
    console.log("[Search] No user found with email:", normalizedEmail);
    throw new Error(`No user found with email ${email}. Make sure they are registered.`);
  }

  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();
  
  console.log("[Search] Found user:", { uid: userDoc.id, name: userData.name, email: userData.email });

  if (userDoc.id === state.currentUser?.uid) {
    console.log("[Search] User tried to search themselves:", state.currentUser.uid);
    throw new Error("You cannot send a request to yourself.");
  }

  return { uid: userDoc.id, ...userData };
};

const searchUserByEmail = findUserByEmail;

const showSearchResult = (user, errorMessage = null) => {
  const resultEl = els.searchResult;
  if (!resultEl) return;

  if (errorMessage || !user) {
    resultEl.innerHTML = `
      <div class="search-error">
        <strong>User not found</strong>
        <span>${errorMessage || "No user found with this email address."}</span>
      </div>
    `;
  } else {
    const alreadyConnected = isContact(user.uid);
    const requestPending = state.outgoingRequests.some((request) => request.toUid === user.uid);
    const buttonLabel = alreadyConnected ? "Already connected" : requestPending ? "Request pending" : "Send Request";
    const buttonDisabled = alreadyConnected || requestPending ? "disabled" : "";
    const statusNote = alreadyConnected
      ? "You are already connected with this user."
      : requestPending
        ? "A connection request is already pending."
        : "";

    resultEl.innerHTML = `
      <div class="search-user-card">
        <div class="avatar">${initials(user.name, user.email)}</div>
        <div class="user-info">
          <h4>${escapeHTML(user.name || "Orbi User")}</h4>
          <span>${escapeHTML(user.email)}</span>
        </div>
        <button class="button primary send-request-btn" ${buttonDisabled}>${buttonLabel}</button>
      </div>
      ${statusNote ? `<p class="search-user-status">${escapeHTML(statusNote)}</p>` : ""}
    `;

    const sendBtn = resultEl.querySelector(".send-request-btn");
    sendBtn?.addEventListener("click", async () => {
      if (alreadyConnected) {
        showMessage("You are already connected with this user.", "info");
        return;
      }
      if (requestPending) {
        showMessage("A request is already pending.", "info");
        return;
      }

      try {
        await sendConnectionRequest(user.email);
        showMessage("Request sent. Waiting for the other user to accept.", "success");
        resultEl.hidden = true;
        els.requestEmail.value = "";
      } catch (error) {
        showMessage(error.message || "Unable to send request.", "error");
      }
    });
  }

  resultEl.hidden = false;
};

const checkExistingRequest = async (targetUid) => {
  if (!state.currentUser) return false;

  try {
    const outgoingRef = collection(db, "requests", state.currentUser.uid, "outgoing");
    const requestQuery = query(outgoingRef, where("toUid", "==", targetUid));
    const snapshot = await getDocs(requestQuery);
    return !snapshot.empty;
  } catch (error) {
    console.log("[Request] Error checking existing request:", error.message);
    return false;
  }
};

const sendConnectionRequest = async (email) => {
  if (!state.currentUser) {
    throw new Error("You must be logged in to send a request.");
  }

  console.log("[Request] Sending request from:", state.currentUser.uid);

  const target = await searchUserByEmail(email);

  if (isContact(target.uid)) {
    console.log("[Request] User already in contacts:", target.uid);
    throw new Error(`${target.email} is already in your contacts.`);
  }

  const alreadyRequested = await checkExistingRequest(target.uid);
  if (alreadyRequested) {
    console.log("[Request] Request already sent to:", target.uid);
    throw new Error(`Request already sent to ${target.email}. Please wait for them to accept.`);
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    fromUid: state.currentUser.uid,
    fromEmail: state.currentUser.email || "",
    fromName: state.currentProfile?.name || state.currentUser.displayName || "Orbi User",
    toUid: target.uid,
    toEmail: target.email || "",
    toName: target.name || target.email || "Orbi User",
    status: "pending",
    createdAt: serverTimestamp()
  };

  console.log("[Request] Creating request payload:", payload, "requestId:", requestId);

  try {
    const outgoingDoc = doc(db, "requests", state.currentUser.uid, "outgoing", requestId);
    const incomingDoc = doc(db, "requests", target.uid, "incoming", requestId);

    await Promise.all([
      setDoc(outgoingDoc, {
        toUid: payload.toUid,
        toEmail: payload.toEmail,
        toName: payload.toName,
        status: payload.status,
        createdAt: payload.createdAt
      }, { merge: true }),
      setDoc(incomingDoc, {
        fromUid: payload.fromUid,
        fromEmail: payload.fromEmail,
        fromName: payload.fromName,
        status: payload.status,
        createdAt: payload.createdAt
      }, { merge: true })
    ]);

    console.log("[Request] Successfully sent request with id:", requestId);
  } catch (writeError) {
    console.error("[Request] Firestore write failed:", writeError);
    throw new Error(`Failed to send request: ${writeError.message}`);
  }
};

const sendRequest = sendConnectionRequest;

window.sendRequest = async (targetUid, targetEmail) => {
  console.log("[Search] sendRequest called:", targetUid, targetEmail);
  if (!targetEmail) {
    throw new Error("Invalid target email.");
  }
  return sendConnectionRequest(targetEmail);
};

const listenIncomingRequests = () => {
  if (!state.currentUser) return;

  const requestsRef = incomingRequestsRef(state.currentUser.uid);
  state.unsubIncoming = onSnapshot(requestsRef, (snapshot) => {
    state.incomingRequests = snapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));
    renderIncomingRequests();
  }, (error) => {
    console.error("[Request] Incoming snapshot failed:", error);
    renderIncomingRequests();
  });
};

const listenOutgoingRequests = () => {
  if (!state.currentUser) return;

  const requestsRef = outgoingRequestsRef(state.currentUser.uid);
  state.unsubOutgoing = onSnapshot(requestsRef, (snapshot) => {
    state.outgoingRequests = snapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));
    renderOutgoingRequests();
  }, (error) => {
    console.error("[Request] Outgoing snapshot failed:", error);
    renderOutgoingRequests();
  });
};

const renderIncomingRequests = () => {
  if (!els.requestList) return;
  if (!state.incomingRequests.length) {
    els.requestList.innerHTML = `
      <div class="empty-state">
        <strong>No incoming requests</strong>
        <span>Incoming connection requests will appear here.</span>
      </div>
    `;
    return;
  }

  els.requestList.innerHTML = state.incomingRequests.map((request) => `
    <div class="request-card" data-request-id="${request.id}" data-request-from="${request.fromUid}">
      <div class="request-copy">
        <strong>${escapeHTML(request.fromName)}</strong>
        <span>${escapeHTML(request.fromEmail)}</span>
      </div>
      <div class="request-actions">
        <button class="button secondary" type="button" data-reject-request="${request.id}">Reject</button>
        <button class="button primary" type="button" data-accept-request="${request.id}">Accept</button>
      </div>
    </div>
  `).join("");
};

const renderOutgoingRequests = () => {
  if (!els.sentRequestList) return;
  if (!state.outgoingRequests?.length) {
    els.sentRequestList.innerHTML = `
      <div class="empty-state">
        <strong>No sent requests</strong>
        <span>Requests you send will appear here.</span>
      </div>
    `;
    return;
  }

  els.sentRequestList.innerHTML = state.outgoingRequests.map((request) => `
    <div class="request-card outgoing" data-request-id="${request.id}" data-request-to="${request.toUid}">
      <div class="request-copy">
        <strong>${escapeHTML(request.toName)}</strong>
        <span>${escapeHTML(request.toEmail)}</span>
      </div>
      <div class="request-actions">
        <span class="request-status">${escapeHTML(request.status || "pending")}</span>
        <button class="button secondary" type="button" data-cancel-request="${request.id}">Cancel</button>
      </div>
    </div>
  `).join("");
};

const acceptConnectionRequest = async (requestId, request) => {
  if (!state.currentUser || !request) return;

  console.log("[Request] Accepting request:", requestId, request);
  await addMutualContacts({ uid: request.fromUid, name: request.fromName, email: request.fromEmail });

  await Promise.all([
    deleteDoc(doc(db, "requests", state.currentUser.uid, "incoming", requestId)),
    deleteDoc(doc(db, "requests", request.fromUid, "outgoing", requestId))
  ]);

  const chatPeer = {
    uid: request.fromUid,
    name: request.fromName,
    email: request.fromEmail
  };

  if (!state.contacts.some((contact) => contact.uid === chatPeer.uid)) {
    state.contacts.push({
      uid: chatPeer.uid,
      name: chatPeer.name,
      email: chatPeer.email,
      status: "online",
      addedAt: Date.now()
    });
    renderContacts();
  }

  const chatId = await ensureChat(chatPeer);
  await openConversation(chatPeer, chatId);
  showStatus("Request accepted.", "success");
  return chatId;
};

const rejectConnectionRequest = async (requestId, request) => {
  if (!state.currentUser || !request) return;

  console.log("[Request] Rejecting request:", requestId, request);
  await Promise.all([
    deleteDoc(doc(db, "requests", state.currentUser.uid, "incoming", requestId)),
    deleteDoc(doc(db, "requests", request.fromUid, "outgoing", requestId))
  ]);
  showStatus("Request rejected.", "warning");
};

const removeContact = async (contactUid) => {
  if (!state.currentUser) return;
  await Promise.all([
    deleteDoc(doc(db, "contacts", state.currentUser.uid, "list", contactUid)),
    deleteDoc(doc(db, "contacts", contactUid, "list", state.currentUser.uid))
  ]);
  state.activePeer = null;
  state.activeChatId = "";
  setChatHeader(null);
  renderContacts();
  renderConversations();
  els.chatStream.innerHTML = `
    <div class="chat-empty">
      <strong>Your chats will appear here</strong>
      <span>Select a user from the sidebar to start a one-to-one conversation.</span>
    </div>
  `;
  showMessage("Contact removed. You can still reconnect with an invite.", "info");
};

const blockContact = async (contactUid) => {
  if (!state.currentUser) return;
  await setDoc(doc(db, "blocks", state.currentUser.uid, "blocked", contactUid), {
    blockedAt: serverTimestamp()
  });
  await removeContact(contactUid);
  showMessage("Contact blocked and removed from your list.", "warning");
};

const processInviteLink = async () => {
  const params = new URLSearchParams(window.location.search);
  const inviteId = params.get("invite");
  if (!inviteId || !state.currentUser) return;

  try {
    await acceptInvite(inviteId);
    showMessage("Invite accepted. You are now connected.", "success");
    params.delete("invite");
    const cleanUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  } catch (error) {
    showMessage(error.message, "error");
  }
};

const resetPeerListeners = () => {
  if (state.unsubPeerStatus) {
    state.unsubPeerStatus();
    state.unsubPeerStatus = null;
  }
  if (state.unsubPeerTyping) {
    state.unsubPeerTyping();
    state.unsubPeerTyping = null;
  }
};

const handleTyping = () => {
  if (!state.activeChatId || !state.currentUser) return;
  if (state.typingTimer) {
    clearTimeout(state.typingTimer);
  }

  if (!state.isTyping) {
    state.isTyping = true;
    startTyping(state.activeChatId).catch(() => {});
  }

  state.typingTimer = window.setTimeout(() => {
    state.isTyping = false;
    stopTyping(state.activeChatId).catch(() => {});
  }, 2000);
};

const getTypingStatus = () => state.peerTyping;

const decryptMessages = async (chatId, messages) => {
  return await Promise.all(messages.map(async (message) => {
    if (!message.encrypted || !message.ciphertext || !message.iv) return message;
    try {
      return { ...message, text: await decryptText(message.ciphertext, message.iv, chatId) };
    } catch {
      return { ...message, text: "Unable to decrypt message" };
    }
  }));
};

const chatIdFor = (uidA, uidB) => [uidA, uidB].sort().join("_");

const peerFromChat = (chat) => {
  const peerId = (chat.participantIds || []).find((uid) => uid !== state.currentUser?.uid);
  return chat.participants?.[peerId] || state.contacts.find((contact) => contact.uid === peerId) || null;
};

const profileFromUser = async (user) => {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) {
    console.log("[Chat] User profile loaded from Firestore:", snap.data());
    return snap.data();
  }

  console.log("[Chat] Creating user profile from Auth object:", user.uid);

  const profile = {
    uid: user.uid,
    name: user.displayName || user.email || "Orbi User",
    email: user.email || "",
    nameLower: (user.displayName || user.email || "Orbi User").toLowerCase(),
    emailLower: (user.email || "").toLowerCase(),
    photoURL: user.photoURL || "",
    bio: "",
    status: "offline",
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp()
  };

  console.log("[Chat] Saving profile to Firestore:", profile);

  try {
    await setDoc(doc(db, "users", user.uid), profile, { merge: true });
    console.log("[Chat] Profile saved successfully");
  } catch (error) {
    console.error("[Chat] Failed to save profile:", error);
    throw error;
  }

  return profile;
};

const participantPayload = (profile, userFallback = {}) => ({
  uid: profile.uid || userFallback.uid || "",
  name: profile.name || userFallback.displayName || userFallback.email || "Orbi User",
  email: profile.email || userFallback.email || "",
  photoURL: profile.photoURL || userFallback.photoURL || ""
});

const renderEmpty = (target, title, detail) => {
  if (!target) return;
  target.innerHTML = `
    <div class="empty-state">
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(detail)}</span>
    </div>
  `;
};

// Render the list of contacts in the sidebar.
// Contacts are loaded from the privacy-first contacts collection.
const renderContacts = () => {
  const search = els.userSearch?.value.trim().toLowerCase() || "";
  const contacts = state.contacts
    .filter((contact) => contact.uid !== state.currentUser?.uid)
    .filter((contact) => {
      const haystack = `${contact.name || ""} ${contact.email || ""}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => safeText(a.name, a.email).localeCompare(safeText(b.name, b.email)));

  if (!contacts.length) {
    renderEmpty(els.contactList, "No contacts yet", "Send a request or share an invite link to connect.");
    return;
  }

  els.contactList.innerHTML = contacts.map((contact) => {
    const statusLabel = formatPresenceLabel(contact);
    return `
      <div class="thread contact-thread" data-open-user="${contact.uid}">
        <div class="avatar">${initials(contact.name, contact.email)}</div>
        <div class="thread-copy">
          <div class="thread-head">
            <h3>${escapeHTML(contact.name || "Orbi User")}</h3>
            <span class="thread-time">${escapeHTML(statusLabel)}</span>
          </div>
          <p>${escapeHTML(contact.email)}</p>
        </div>
      </div>
    `;
  }).join("");
};


// Render the conversation list with unread counts and last message previews.
const renderConversations = () => {
  const chats = [...state.chats.values()]
    .filter((chat) => peerFromChat(chat))
    .sort((a, b) => toMillis(b.updatedAt || b.lastMessageAt) - toMillis(a.updatedAt || a.lastMessageAt));

  if (!chats.length) {
    renderEmpty(els.conversationList, "No conversations yet", "Select a contact above to start a secure chat.");
    return;
  }

  els.conversationList.innerHTML = chats.map((chat) => {
    const peer = peerFromChat(chat);
    const unread = chat.unreadCounts?.[state.currentUser.uid] || 0;
    const active = chat.id === state.activeChatId ? " active" : "";
    const preview = chat.lastMessageCiphertext ? "Encrypted message" : (chat.lastMessage || "No messages yet");
    return `
      <div class="thread conversation-thread${active}" data-open-chat="${chat.id}">
        <div class="avatar">${initials(peer?.name, peer?.email)}</div>
        <div class="thread-copy">
          <div class="thread-head">
            <h3>${escapeHTML(peer?.name || "Unknown user")}</h3>
            <span class="thread-time">${formatRelative(chat.lastMessageAt || chat.updatedAt)}</span>
          </div>
          <p>${escapeHTML(preview)}</p>
        </div>
        ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ""}
      </div>
    `;
  }).join("");
};


const setChatHeader = (peer) => {
  if (!peer) {
    els.chatTitle.textContent = "Select a conversation";
    els.chatSubtitle.textContent = "Search users or open a recent chat";
    els.chatAvatar.textContent = "OR";
    if (els.userStatus) {
      els.userStatus.textContent = "";
    }
    if (els.typingIndicator) {
      els.typingIndicator.textContent = "";
      els.typingIndicator.hidden = true;
    }
    if (els.removeContactBtn) els.removeContactBtn.hidden = true;
    els.messageInput.disabled = true;
    els.sendButton.disabled = true;
    return;
  }

  const isTyping = Boolean(state.peerTyping);
  const presenceText = formatPresenceLabel(peer);

  if (els.removeContactBtn) els.removeContactBtn.hidden = false;

  els.chatTitle.textContent = safeText(peer.name, "Orbi User");
  els.chatSubtitle.textContent = safeText(peer.email, "Secure one-to-one chat");
  els.chatAvatar.textContent = initials(peer.name, peer.email);
  if (els.userStatus) {
    els.userStatus.textContent = presenceText;
  }
  if (els.typingIndicator) {
    els.typingIndicator.textContent = isTyping ? "Typing..." : "";
    els.typingIndicator.hidden = !isTyping;
  }
  els.messageInput.disabled = false;
  els.sendButton.disabled = false;
  els.messageInput.focus();
};

const updateUserProfileUI = () => {
  if (!state.currentProfile) return;
  if (els.userName) {
    els.userName.textContent = safeText(state.currentProfile.name, "Orbi User");
  }
  if (els.userAvatar) {
    els.userAvatar.textContent = initials(state.currentProfile.name, state.currentProfile.email);
  }
  if (els.userStatus) {
    els.userStatus.textContent = formatPresenceLabel(state.currentProfile);
  }
};

// Media handling functions
const uploadFile = async (file, path) => {
  const storageRef = ref(storage, path);
  const snapshot = await uploadBytes(storageRef, file);
  return await getDownloadURL(snapshot.ref);
};

const sendImageMessage = async (imageUrl) => {
  if (!state.activeChatId || !state.currentUser) return;

  await addDoc(collection(db, "chats", state.activeChatId, "messages"), {
    type: "image",
    imageUrl,
    text: "📷 Image", // For display purposes
    senderId: state.currentUser.uid,
    createdAt: serverTimestamp(),
    deliveredTo: [state.currentUser.uid],
    readBy: [state.currentUser.uid]
  });

  await updateDoc(doc(db, "chats", state.activeChatId), {
    lastMessage: "📷 Image",
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: state.currentUser.uid
  });
};

const sendAudioMessage = async (audioUrl, duration) => {
  if (!state.activeChatId || !state.currentUser) return;

  await addDoc(collection(db, "chats", state.activeChatId, "messages"), {
    type: "audio",
    audioUrl,
    duration,
    text: "🎤 Voice message", // For display purposes
    senderId: state.currentUser.uid,
    createdAt: serverTimestamp(),
    deliveredTo: [state.currentUser.uid],
    readBy: [state.currentUser.uid]
  });

  await updateDoc(doc(db, "chats", state.activeChatId), {
    lastMessage: "🎤 Voice message",
    lastMessageAt: serverTimestamp(),
    lastMessageSenderId: state.currentUser.uid
  });
};

// Voice recording functions
const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaRecorder = new MediaRecorder(stream);
    state.recordedChunks = [];
    state.recordingStartTime = Date.now();
    state.voicePreviewBlob = null;

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    };

    state.mediaRecorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
    };

    state.mediaRecorder.start();
    updateRecordingTimer();
    if (els.previewAudio) {
      els.previewAudio.src = "";
      els.previewAudio.hidden = true;
      els.previewAudio.controls = false;
    }
    if (els.sendVoiceBtn) {
      els.sendVoiceBtn.textContent = "Stop recording";
    }
    els.voiceModal.hidden = false;
  } catch (error) {
    console.error("Recording failed:", error);
    showToast("Microphone access denied", "error");
  }
};

const stopRecording = () => {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    return new Promise((resolve) => {
      state.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(state.recordedChunks, { type: "audio/webm" });
        const duration = Math.floor((Date.now() - state.recordingStartTime) / 1000);
        state.voicePreviewBlob = audioBlob;
        state.mediaRecorder = null;
        clearInterval(state.recordingTimer);
        resolve({ blob: audioBlob, duration });
      };
      state.mediaRecorder.stop();
    });
  }
  return Promise.resolve(null);
};

const updateRecordingTimer = () => {
  const updateTimer = () => {
    const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    els.recordingTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  updateTimer();
  state.recordingTimer = setInterval(updateTimer, 1000);
};

// Image handling functions
const handleImageSelect = (file) => {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    els.previewImage.src = e.target.result;
    els.imageModal.hidden = false;
  };
  reader.readAsDataURL(file);
};

// Notification functions
const requestNotificationPermission = async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      const token = await getToken(messaging, {
        vapidKey: "YOUR_VAPID_KEY_HERE" // You'll need to generate this
      });
      if (token) {
        state.fcmToken = token;
        await saveFCMToken(token);
      }
    }
  } catch (error) {
    console.error("Notification permission failed:", error);
  }
};

const saveFCMToken = async (token) => {
  if (!state.currentUser) return;
  await setDoc(doc(db, "users", state.currentUser.uid), {
    fcmToken: token
  }, { merge: true });
};

const showToast = (message, type = "info") => {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 5000);
};

// Global functions for onclick handlers
window.openFullscreen = (url) => {
  els.fullscreenImage.src = url;
  els.fullscreenModal.hidden = false;
};

window.playAudio = (button, url) => {
  const audio = new Audio(url);
  audio.play();

  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
    </svg>
  `;

  audio.onended = () => {
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
    `;
  };
};

const markMessagesDelivered = async (messages) => {
  if (!state.activeChatId || !state.currentUser) return;
  const updates = messages
    .filter((message) => message.senderId !== state.currentUser.uid && !message.deliveredTo?.includes(state.currentUser.uid))
    .map((message) => updateDoc(doc(db, "chats", state.activeChatId, "messages", message.id), {
      deliveredTo: arrayUnion(state.currentUser.uid)
    }));
  if (!updates.length) return;
  await Promise.all(updates);
};

const markMessagesRead = async (messages) => {
  if (!state.activeChatId || !state.currentUser) return;
  const updates = messages
    .filter((message) => message.senderId !== state.currentUser.uid && !message.readBy?.includes(state.currentUser.uid))
    .map((message) => updateDoc(doc(db, "chats", state.activeChatId, "messages", message.id), {
      readBy: arrayUnion(state.currentUser.uid)
    }));
  if (!updates.length) return;
  await Promise.all(updates);
};

const startTyping = async (chatId) => {
  if (!chatId || !state.currentUser) return;
  await setDoc(doc(db, "typing", chatId), {
    [state.currentUser.uid]: true
  }, { merge: true });
};

const stopTyping = async (chatId) => {
  if (!chatId || !state.currentUser) return;
  await updateDoc(doc(db, "typing", chatId), {
    [state.currentUser.uid]: deleteField()
  });
};

const listenPresence = (uid, callback) => {
  if (!uid) return;
  const userRef = doc(db, "users", uid);
  return onSnapshot(userRef, (snap) => {
    const data = snap.data();
    callback(data?.status || "offline", data?.lastSeen);
  });
};

function getTicks(msg, otherUid) {
  if (msg.readBy?.includes(otherUid)) return "✔✔";
  if (msg.deliveredTo?.includes(otherUid)) return "✔✔";
  return "✔";
}

const renderMessages = (messages) => {
  if (!messages.length) {
    els.chatStream.innerHTML = `
      <div class="chat-empty">
        <strong>No messages yet</strong>
        <span>Send the first message to ${escapeHTML(state.activePeer?.name || "this user")}.</span>
      </div>
    `;
    return;
  }

  els.chatStream.innerHTML = messages.map((message) => {
    const currentUid = state.currentUser.uid;
    const currentEmail = state.currentUser.email;

    if (message.senderId === currentEmail) {
      message.senderId = currentUid;
    }

    const isMe =
      message.senderId &&
      (message.senderId === currentUid || message.senderId === currentEmail);

    const messageClass = `message ${isMe ? "sent" : "received"}`;
    console.log("CLASS:", messageClass);
    console.log("MSG sender:", message.senderId);
    console.log("ME:", currentUid);

    const tickStatus = getTicks(message, state.activePeer?.uid);
    const ticksClass = message.readBy?.includes(state.activePeer?.uid) ? "ticks seen" : "ticks";

    let content = "";
    if (message.type === "image") {
      content = `<img src="${escapeHTML(message.imageUrl)}" alt="Image" class="message-image" onclick="openFullscreen('${escapeHTML(message.imageUrl)}')" />
        <div class="meta">
          <span class="time">${formatTime(message.createdAt)}</span>
          ${isMe ? `<span class="${ticksClass}">${tickStatus}</span>` : ""}
        </div>`;
    } else if (message.type === "audio") {
      content = `
        <div class="message-audio">
          <button class="audio-play" onclick="playAudio(this, '${escapeHTML(message.audioUrl)}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
          <span class="audio-duration">${message.duration || "0:00"}</span>
        </div>
        <div class="meta">
          <span class="time">${formatTime(message.createdAt)}</span>
          ${isMe ? `<span class="${ticksClass}">${tickStatus}</span>` : ""}
        </div>
      `;
    } else {
      content = `
        <span class="text">${escapeHTML(message.text)}</span>
        <div class="meta">
          <span class="time">${formatTime(message.createdAt)}</span>
          ${isMe ? `<span class="${ticksClass}">${tickStatus}</span>` : ""}
        </div>
      `;
    }

    return `
      <div class="message ${isMe ? "sent" : "received"}">
        <div class="bubble">
          ${content}
        </div>
      </div>
    `;
  }).join("");
  els.chatStream.scrollTop = els.chatStream.scrollHeight;
};

const markChatRead = async (chatId) => {
  if (!chatId || !state.currentUser) return;
  await updateDoc(doc(db, "chats", chatId), new FieldPath("unreadCounts", state.currentUser.uid), 0);
};

const listenMessages = (chatId) => {
  if (state.unsubMessages) state.unsubMessages();
  const messagesRef = collection(db, "chats", chatId, "messages");
  const messagesQuery = query(messagesRef, orderBy("createdAt", "asc"));

  state.unsubMessages = onSnapshot(messagesQuery, async (snapshot) => {
    const rawMessages = snapshot.docs
      .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }))
      .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
    const messages = await decryptMessages(chatId, rawMessages);
    renderMessages(messages);
    await markChatRead(chatId);
    await markMessagesDelivered(messages);
    await markMessagesRead(messages);
  }, (error) => {
    showMessage(`Could not load messages: ${error.message}`, "error");
  });
};

const ensureChat = async (peer) => {
  const chatId = chatIdFor(state.currentUser.uid, peer.uid);
  const chatRef = doc(db, "chats", chatId);
  const existing = await getDoc(chatRef);
  const existingData = existing.exists() ? existing.data() : {};
  const currentParticipant = participantPayload(state.currentProfile, state.currentUser);
  const peerParticipant = participantPayload(peer);
  const unreadCounts = {
    [state.currentUser.uid]: 0,
    [peer.uid]: 0,
    ...(existingData.unreadCounts || {})
  };

  await setDoc(chatRef, {
    id: chatId,
    participantIds: [state.currentUser.uid, peer.uid].sort(),
    participants: {
      [state.currentUser.uid]: currentParticipant,
      [peer.uid]: peerParticipant
    },
    unreadCounts,
    createdAt: existingData.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  return chatId;
};

const openConversation = async (peer, chatId = "") => {
  if (!peer) return;

  if (window.innerWidth <= 768) {
    document.querySelector(".sidebar")?.classList.add("hidden-mobile");
  }

  if (state.typingTimer) clearTimeout(state.typingTimer);
  if (state.isTyping) {
    state.isTyping = false;
    await setTypingState(state.activeChatId, false).catch(() => {});
  }

  resetPeerListeners();
  hideMessage();
  state.activePeer = peer;
  state.activeChatId = chatId || await ensureChat(peer);
  setChatHeader(peer);
  renderConversations();
  listenMessages(state.activeChatId);
  listenPresence(peer.uid, (status, lastSeen) => {
    if (!state.activePeer || state.activePeer.uid !== peer.uid) return;
    state.activePeer = { ...state.activePeer, status, lastSeen };
    setChatHeader(state.activePeer);
  });
  listenTyping(state.activeChatId, (isTyping) => {
    state.peerTyping = isTyping;
    setChatHeader(state.activePeer);
  });
  await markChatRead(state.activeChatId);
  closeSidebar();
};

// Send a message for the active chat and update the chat document for unread counts.
const sendMessage = async (event) => {
  event.preventDefault();
  hideMessage();
  if (!state.activeChatId || !state.activePeer) {
    showMessage("Choose a user before sending a message.", "warning");
    return;
  }

  const text = els.messageInput.value.trim();
  if (!text) return;

  els.sendButton.disabled = true;

  try {
    const encrypted = await encryptText(text, state.activeChatId);
    const messagesRef = collection(db, "chats", state.activeChatId, "messages");
    await addDoc(messagesRef, {
      chatId: state.activeChatId,
      senderId: state.currentUser.uid,
      receiverId: state.activePeer.uid,
      encrypted: true,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      createdAt: serverTimestamp(),
      deliveredTo: [state.currentUser.uid],
      readBy: [state.currentUser.uid]
    });

    const chatRef = doc(db, "chats", state.activeChatId);
    await updateDoc(chatRef, {
      lastMessage: "Encrypted message",
      lastMessageCiphertext: encrypted.ciphertext,
      lastMessageIv: encrypted.iv,
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: state.currentUser.uid,
      updatedAt: serverTimestamp()
    });
    await updateDoc(chatRef, new FieldPath("unreadCounts", state.activePeer.uid), increment(1));

    els.messageInput.value = "";
  } catch (error) {
    showMessage(`Message not sent: ${error.message}`, "error");
  } finally {
    els.sendButton.disabled = false;
    els.messageInput.focus();
  }
};


const listenContacts = () => {
  const contactsRef = collection(db, "contacts", state.currentUser.uid, "list");
  state.unsubContacts = onSnapshot(contactsRef, (snapshot) => {
    state.contacts = snapshot.docs.map((contactDoc) => ({
      uid: contactDoc.id,
      ...contactDoc.data()
    }));
    renderContacts();
    if (state.activePeer) {
      const freshPeer = state.contacts.find((contact) => contact.uid === state.activePeer.uid);
      if (freshPeer) {
        state.activePeer = { ...state.activePeer, ...freshPeer };
        setChatHeader(state.activePeer);
      }
    }
  }, (error) => {
    renderEmpty(els.contactList, "Contacts unavailable", error.message);
  });
};

const listenChats = () => {
  const chatsRef = collection(db, "chats");
  const chatsQuery = query(chatsRef, where("participantIds", "array-contains", state.currentUser.uid));

  state.unsubChats = onSnapshot(chatsQuery, (snapshot) => {
    state.chats.clear();
    snapshot.docs.forEach((chatDoc) => {
      state.chats.set(chatDoc.id, {
        id: chatDoc.id,
        ...chatDoc.data()
      });
    });
    renderConversations();
  }, (error) => {
    renderEmpty(els.conversationList, "Conversations unavailable", error.message);
  });
};

const bindEvents = () => {
  els.userSearch?.addEventListener("input", renderContacts);
  els.composer?.addEventListener("submit", sendMessage);
  els.messageInput?.addEventListener("input", () => {
    if (!state.activeChatId || !state.currentUser) return;
    handleTyping();
  });

  els.messageInput?.addEventListener("blur", () => {
    if (!state.activeChatId || !state.currentUser) return;
    if (state.typingTimer) clearTimeout(state.typingTimer);
    state.isTyping = false;
    stopTyping(state.activeChatId).catch(() => {});
  });

  els.inviteButton?.addEventListener("click", async () => {
    try {
      const inviteLink = await createInviteLink();
      await navigator.clipboard.writeText(inviteLink);
      showMessage("Invite link copied to clipboard.", "success");
    } catch (error) {
      showMessage(error.message || "Unable to generate invite link.", "error");
    }
  });

  els.requestsToggle?.addEventListener("click", () => {
    els.requestsPanel.classList.toggle("open");
    els.requestsPanel.hidden = !els.requestsPanel.classList.contains("open");
  });

  // Theme toggle
  const toggle = els.themeToggle;
  if (toggle) {
    toggle.onclick = () => {
      document.body.classList.toggle("dark-mode");
      localStorage.setItem(
        "theme",
        document.body.classList.contains("dark-mode") ? "dark" : "light"
      );
    };
  }

  const sidebarEl = document.querySelector(".sidebar");
  const backBtn = document.querySelector(".mobile-sidebar-toggle");
  if (backBtn && sidebarEl) {
    backBtn.addEventListener("click", () => {
      sidebarEl.classList.remove("hidden-mobile");
    });
  }

  // Load saved theme on page load
  if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark-mode");
  }

  els.searchBtn?.addEventListener("click", async () => {
    const email = els.requestEmail?.value.trim();
    console.log("Search input:", email);
    if (!email) {
      showMessage("Enter an email address to search.", "error");
      return;
    }

    try {
      const user = await searchUserByEmail(email);
      console.log("User found:", user);
      showSearchResult(user);
    } catch (error) {
      console.log("Search error:", error.message);
      showSearchResult(null, error.message);
    }
  });

  // Also allow Enter key in email input to trigger search
  els.requestEmail?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.searchBtn?.click();
    }
  });

  els.requestForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = els.requestEmail?.value.trim();
    if (!email) {
      showMessage("Enter an email address to request a connection.", "error");
      return;
    }

    try {
      await sendConnectionRequest(email);
      showMessage("Request sent. Waiting for the other user to accept.", "success");
      els.requestEmail.value = "";
    } catch (error) {
      showMessage(error.message || "Unable to send request.", "error");
    }
  });

  els.requestList?.addEventListener("click", async (event) => {
    const acceptButton = event.target.closest("[data-accept-request]");
    const rejectButton = event.target.closest("[data-reject-request]");
    if (acceptButton) {
      const requestId = acceptButton.dataset.acceptRequest;
      const request = state.incomingRequests.find((item) => item.id === requestId);
      if (request) {
        await acceptConnectionRequest(requestId, request);
      }
    }
    if (rejectButton) {
      const requestId = rejectButton.dataset.rejectRequest;
      const request = state.incomingRequests.find((item) => item.id === requestId);
      if (request) {
        await rejectConnectionRequest(requestId, request);
      }
    }
  });

  els.sentRequestList?.addEventListener("click", async (event) => {
    const cancelButton = event.target.closest("[data-cancel-request]");
    if (!cancelButton) return;
    const requestId = cancelButton.dataset.cancelRequest;
    const request = state.outgoingRequests.find((item) => item.id === requestId);
    if (!request) return;

    try {
      await Promise.all([
        deleteDoc(doc(db, "requests", state.currentUser.uid, "outgoing", requestId)),
        deleteDoc(doc(db, "requests", request.toUid, "incoming", requestId))
      ]);
      showMessage("Request canceled.", "info");
    } catch (error) {
      console.error("[Request] Cancel failed:", error);
      showMessage(`Unable to cancel request: ${error.message}`, "error");
    }
  });

  els.sidebarToggleButtons?.forEach((button) => {
    button.addEventListener("click", toggleSidebar);
  });

  els.sidebarBackdrop?.addEventListener("click", closeSidebar);

  els.removeContactBtn?.addEventListener("click", async () => {
    if (!state.activePeer) return;
    const confirmed = window.confirm(`Remove ${state.activePeer.name || state.activePeer.email || 'this contact'}?`);
    if (!confirmed) return;
    await removeContact(state.activePeer.uid);
  });

  els.blockContactBtn?.addEventListener("click", async () => {
    if (!state.activePeer) return;
    const confirmed = window.confirm(`Block ${state.activePeer.name || state.activePeer.email || 'this contact'}?`);
    if (!confirmed) return;
    await blockContact(state.activePeer.uid);
  });

  els.contactList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-open-user]");
    if (!button) return;
    const peer = state.contacts.find((contact) => contact.uid === button.dataset.openUser);
    if (peer) await openConversation(peer);
  });

  els.conversationList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-open-chat]");
    if (!button) return;
    const chat = state.chats.get(button.dataset.openChat);
    const peer = chat ? peerFromChat(chat) : null;
    if (peer) await openConversation(peer, chat.id);
  });

  // Media event listeners
  els.attachBtn?.addEventListener("click", () => {
    els.fileInput?.click();
  });

  els.fileInput?.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) handleImageSelect(file);
    event.target.value = "";
  });

  els.voiceButton?.addEventListener("click", startRecording);

  // Modal event listeners
  els.cancelImageBtn?.addEventListener("click", () => {
    els.imageModal.hidden = true;
  });

  els.sendImageBtn?.addEventListener("click", async () => {
    if (!els.previewImage.src) return;
    
    els.sendImageBtn.disabled = true;
    try {
      const response = await fetch(els.previewImage.src);
      const blob = await response.blob();
      const fileName = `image_${Date.now()}.jpg`;
      const path = `images/${state.activeChatId}/${fileName}`;
      const imageUrl = await uploadFile(blob, path);
      await sendImageMessage(imageUrl);
      els.imageModal.hidden = true;
      showToast("Image sent!", "success");
    } catch (error) {
      console.error("Image upload failed:", error);
      showToast("Failed to send image", "error");
    } finally {
      els.sendImageBtn.disabled = false;
    }
  });

  els.cancelVoiceBtn?.addEventListener("click", () => {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      state.mediaRecorder.stop();
    }
    clearInterval(state.recordingTimer);
    state.voicePreviewBlob = null;
    if (els.previewAudio) {
      els.previewAudio.hidden = true;
      els.previewAudio.src = "";
    }
    if (els.sendVoiceBtn) {
      els.sendVoiceBtn.textContent = "Send voice";
    }
    els.voiceModal.hidden = true;
  });

  els.sendVoiceBtn?.addEventListener("click", async () => {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      els.sendVoiceBtn.disabled = true;
      const result = await stopRecording();
      els.sendVoiceBtn.disabled = false;
      if (!result || !result.blob) {
        showToast("No audio was recorded.", "warning");
        return;
      }
      if (els.previewAudio) {
        els.previewAudio.src = URL.createObjectURL(result.blob);
        els.previewAudio.hidden = false;
        els.previewAudio.controls = true;
      }
      if (els.sendVoiceBtn) {
        els.sendVoiceBtn.textContent = "Send voice";
      }
      return;
    }

    if (!state.voicePreviewBlob || !state.voicePreviewBlob.size) {
      showToast("Record a voice message first.", "warning");
      return;
    }

    els.sendVoiceBtn.disabled = true;
    try {
      const fileName = `audio_${Date.now()}.webm`;
      const path = `audio/${state.activeChatId}/${fileName}`;
      const audioUrl = await uploadFile(state.voicePreviewBlob, path);
      const duration = Math.floor((Date.now() - state.recordingStartTime) / 1000);
      const durationStr = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
      await sendAudioMessage(audioUrl, durationStr);
      els.voiceModal.hidden = true;
      state.voicePreviewBlob = null;
      showToast("Voice message sent!", "success");
    } catch (error) {
      console.error("Voice upload failed:", error);
      showToast("Failed to send voice message", "error");
    } finally {
      els.sendVoiceBtn.disabled = false;
    }
  });

  // Modal close handlers
  document.addEventListener("click", (event) => {
    if (event.target.matches("[data-modal-close], [data-modal-backdrop]")) {
      els.imageModal.hidden = true;
    }
    if (event.target.matches("[data-voice-close], [data-voice-backdrop]")) {
      if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
        state.mediaRecorder.stop();
      }
      clearInterval(state.recordingTimer);
      state.voicePreviewBlob = null;
      if (els.previewAudio) {
        els.previewAudio.hidden = true;
        els.previewAudio.src = "";
      }
      if (els.sendVoiceBtn) {
        els.sendVoiceBtn.textContent = "Send voice";
      }
      els.voiceModal.hidden = true;
    }
    if (event.target.matches("[data-fullscreen-close], [data-fullscreen-backdrop]")) {
      els.fullscreenModal.hidden = true;
    }
  });
};

// Initialize the chat dashboard after the user is authenticated.
// This function loads the current user's profile, starts real-time listeners,
// and prepares the UI for direct messaging.
const initChat = async (user) => {
  console.log("[Init] Starting chat initialization for user:", user.uid);
  
  if (!isFirebaseConfigured) {
    showMessage("Firebase is not configured yet. Paste your project values into assets/js/firebase-config.js.", "error");
    console.error("[Init] Firebase not configured");
    return;
  }

  state.currentUser = user;
  state.currentProfile = await profileFromUser(user);
  console.log("[Init] User profile loaded:", state.currentProfile);
  
  updateUserProfileUI();
  setChatHeader(null);
  renderEmpty(els.contactList, "Loading contacts", "Loading your secure connections...");
  renderEmpty(els.conversationList, "Loading chats", "Listening for recent conversations...");
  
  console.log("[Init] Listening to real-time data...");
  listenContacts();
  listenChats();
  listenIncomingRequests();
  listenOutgoingRequests();
  
  await processInviteLink();
  await updateOwnPresence("online");
  console.log("[Init] Presence set to online");

  // Presence listeners
  window.addEventListener("focus", () => updateOwnPresence("online"));
  window.addEventListener("blur", () => updateOwnPresence("away"));

  // Setup notifications
  if ("Notification" in window) {
    await requestNotificationPermission();
    console.log("[Init] Notification permission requested");
  }

  // Register service worker for background notifications
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      console.log("[Init] Service worker registered successfully");
    } catch (error) {
      console.error("[Init] Service worker registration failed:", error);
    }
  }

  // Listen for foreground messages
  onMessage(messaging, (payload) => {
    if (document.hidden) return; // Background messages handled by service worker
    console.log("[Messaging] Foreground message received");
    showToast(`${payload.notification.title}: ${payload.notification.body}`, "info");
  });

  if (!state.presenceListenersAttached) {
    state.presenceListenersAttached = true;

    window.addEventListener("visibilitychange", () => {
      if (!state.currentUser) return;
      if (document.hidden) {
        console.log("[Presence] User went offline");
        setTypingState(state.activeChatId, false).catch(() => {});
        updateDoc(doc(db, "users", state.currentUser.uid), {
          status: "offline",
          lastSeen: serverTimestamp()
        }).catch(() => {});
      } else {
        updateOwnPresence("online").catch(() => {});
      }
    });

    window.addEventListener("beforeunload", () => {
      if (!state.currentUser) return;
      setTypingState(state.activeChatId, false).catch(() => {});
      updateDoc(doc(db, "users", state.currentUser.uid), {
        status: "offline",
        lastSeen: serverTimestamp()
      }).catch(() => {});
    });
  }
};


document.addEventListener("DOMContentLoaded", () => {
  if (!els.composer) return;
  
  // Debugging: Log all required IDs
  console.log("[Init] Checking required elements:");
  console.log("[Init] chatList:", els.conversationList);
  console.log("[Init] messages:", els.chatStream);
  console.log("[Init] messageInput:", els.messageInput);
  console.log("[Init] sendBtn:", els.sendButton);
  console.log("[Init] searchInput:", els.userSearch);
  console.log("[Init] requestList:", els.requestList);
  console.log("[Init] emailSearchInput:", els.requestEmail);
  console.log("[Init] themeToggle:", els.themeToggle);
  
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = "login.html";
      } catch (error) {
        console.error("Logout error:", error);
        alert("Failed to logout. Try again.");
      }
    });
  }
  
  bindEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      console.log("[Auth] No user found, redirecting to login");
      window.location.href = "login.html";
      return;
    }

    console.log("[Auth] User logged in:", user.uid);

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        const nameEl = document.getElementById("userName");
        if (nameEl) {
          nameEl.innerText = data.name || user.email || "Orbi User";
        }
      }
    } catch (error) {
      console.error("[Auth] Failed to load user profile:", error);
    }

    initChat(user).catch((error) => {
      console.error("[Chat] Failed to start:", error);
      showMessage(`Chat failed to start: ${error.message}`, "error");
    });
  });
});
