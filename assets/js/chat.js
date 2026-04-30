/*
  chat.js
  --------
  Real-time one-to-one chat dashboard using Firebase Firestore.
  - users collection stores profiles
  - chats collection stores chat metadata and unread counts
  - messages subcollection stores the conversation history
*/

import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
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
  unsubChats: null,
  unsubMessages: null,
  unsubContacts: null,
  unsubIncoming: null,
  unsubPeerStatus: null,
  unsubPeerTyping: null
};


const els = {
  contactList: $("[data-contact-list]"),
  conversationList: $("[data-conversation-list]"),
  userSearch: $("[data-user-search]"),
  inviteButton: $("[data-invite-button]"),
  requestForm: $("[data-request-form]"),
  requestEmail: $("[data-request-email]"),
  requestList: $("[data-request-list]"),
  chatTitle: $("[data-chat-title]"),
  chatSubtitle: $("[data-chat-subtitle]"),
  chatAvatar: $("[data-chat-avatar]"),
  userStatus: $("#user-status"),
  typingIndicator: $("#typing-indicator"),
  chatStream: $("[data-chat-stream]"),
  composer: $("[data-composer]"),
  messageInput: $("[data-message-input]"),
  sendButton: $("[data-send-message]"),
  pageMessage: $("[data-page-message]")
};

// Helpers for safe text output and formatting timestamps for chat messages.


const showMessage = (message, type = "info") => {
  if (!els.pageMessage) return;
  els.pageMessage.textContent = message;
  els.pageMessage.className = `auth-message ${type}`;
  els.pageMessage.hidden = false;
};

const hideMessage = () => {
  if (!els.pageMessage) return;
  els.pageMessage.textContent = "";
  els.pageMessage.hidden = true;
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
  await setDoc(doc(db, "users", state.currentUser.uid), {
    status,
    lastSeen: serverTimestamp()
  }, { merge: true });
};

const typingDocRef = (chatId, uid) => doc(db, "typing", chatId, "users", uid);

const setTypingState = async (chatId, isTyping) => {
  if (!chatId || !state.currentUser) return;
  const typingRef = typingDocRef(chatId, state.currentUser.uid);
  await setDoc(typingRef, {
    isTyping,
    updatedAt: serverTimestamp()
  }, { merge: true });
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

const listenTyping = (chatId, otherUserId, callback) => {
  if (state.unsubPeerTyping) {
    state.unsubPeerTyping();
    state.unsubPeerTyping = null;
  }
  if (!chatId || !otherUserId) return;

  const typingRef = typingDocRef(chatId, otherUserId);
  state.unsubPeerTyping = onSnapshot(typingRef, (snapshot) => {
    const data = snapshot.exists() ? snapshot.data() : null;
    callback(Boolean(data?.isTyping));
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

const searchUserByEmail = async (email) => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Enter an email to search.");

  const usersRef = collection(db, "users");
  const queryRef = query(usersRef, where("emailLower", "==", normalizedEmail));
  const snapshot = await getDocs(queryRef);
  if (snapshot.empty) throw new Error("No user found with that email.");

  const userDoc = snapshot.docs[0];
  if (userDoc.id === state.currentUser.uid) throw new Error("You cannot request yourself.");

  return { uid: userDoc.id, ...userDoc.data() };
};

const sendConnectionRequest = async (email) => {
  if (!state.currentUser) return;
  const target = await searchUserByEmail(email);
  if (isContact(target.uid)) throw new Error("This user is already in your contacts.");

  const outgoingDoc = doc(db, "requests", state.currentUser.uid, "outgoing", target.uid);
  const incomingDoc = doc(db, "requests", target.uid, "incoming", state.currentUser.uid);
  const payload = {
    fromUid: state.currentUser.uid,
    fromName: state.currentProfile?.name || state.currentUser.displayName || "Orbi User",
    fromEmail: state.currentUser.email || "",
    toUid: target.uid,
    toName: target.name || target.email || "Orbi User",
    toEmail: target.email || "",
    createdAt: serverTimestamp()
  };

  await Promise.all([
    setDoc(outgoingDoc, payload, { merge: true }),
    setDoc(incomingDoc, payload, { merge: true })
  ]);
};

const listenIncomingRequests = () => {
  if (!state.currentUser) return;

  const requestsRef = incomingRequestsRef(state.currentUser.uid);
  state.unsubIncoming = onSnapshot(requestsRef, (snapshot) => {
    state.incomingRequests = snapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));
    renderRequests();
  }, () => {
    renderRequests();
  });
};

const renderRequests = () => {
  if (!els.requestList) return;
  if (!state.incomingRequests.length) {
    els.requestList.innerHTML = `
      <div class="empty-state">
        <strong>No requests</strong>
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

const acceptConnectionRequest = async (requestId, request) => {
  if (!state.currentUser || !request) return;
  await addMutualContacts({ uid: request.fromUid, name: request.fromName, email: request.fromEmail });
  await Promise.all([
    deleteDoc(doc(db, "requests", state.currentUser.uid, "incoming", requestId)),
    deleteDoc(doc(db, "requests", request.fromUid, "outgoing", state.currentUser.uid))
  ]);
};

const rejectConnectionRequest = async (requestId, request) => {
  if (!state.currentUser || !request) return;
  await Promise.all([
    deleteDoc(doc(db, "requests", state.currentUser.uid, "incoming", requestId)),
    deleteDoc(doc(db, "requests", request.fromUid, "outgoing", state.currentUser.uid))
  ]);
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
    setTypingState(state.activeChatId, true).catch(() => {});
  }

  state.typingTimer = window.setTimeout(() => {
    state.isTyping = false;
    setTypingState(state.activeChatId, false).catch(() => {});
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
  if (snap.exists()) return snap.data();
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
  await setDoc(doc(db, "users", user.uid), profile, { merge: true });
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
    const statusClass = contact.status === "online" ? "online" : "offline";
    return `
      <button class="thread contact-thread" type="button" data-open-user="${contact.uid}">
        <div class="thread-avatar">${initials(contact.name, contact.email)}</div>
        <div class="thread-copy">
          <div class="thread-head">
            <h3>${escapeHTML(contact.name || "Orbi User")}</h3>
            <span class="thread-time">${escapeHTML(statusLabel)}</span>
          </div>
          <p>${escapeHTML(contact.email)}</p>
        </div>
        <span class="status-dot ${statusClass}"></span>
      </button>
    `;
  }).join("");
};


// Render the conversation list with unread counts and last message previews.
const renderConversations = () => {
  const chats = [...state.chats.values()]
    .filter((chat) => {
      const peer = peerFromChat(chat);
      return peer && isContact(peer.uid);
    })
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
      <button class="thread conversation-thread${active}" type="button" data-open-chat="${chat.id}">
        <div class="thread-avatar">${initials(peer?.name, peer?.email)}</div>
        <div class="thread-copy">
          <div class="thread-head">
            <h3>${escapeHTML(peer?.name || "Unknown user")}</h3>
            <span class="thread-time">${formatRelative(chat.lastMessageAt || chat.updatedAt)}</span>
          </div>
          <p>${escapeHTML(preview)}</p>
        </div>
        ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ""}
      </button>
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
    els.messageInput.disabled = true;
    els.sendButton.disabled = true;
    return;
  }

  const isTyping = Boolean(state.peerTyping);
  const presenceText = formatPresenceLabel(peer);

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

const markMessagesDelivered = async (messages) => {
  if (!state.activeChatId || !state.currentUser) return;
  const updates = messages
    .filter((message) => message.senderId !== state.currentUser.uid && !message.deliveredAt)
    .map((message) => updateDoc(doc(db, "chats", state.activeChatId, "messages", message.id), {
      deliveredAt: serverTimestamp()
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
    const outgoing = message.senderId === state.currentUser.uid;
    const statusText = outgoing
      ? message.readBy?.includes(state.activePeer?.uid)
        ? "Seen"
        : message.deliveredAt
          ? "Delivered"
          : "Sending"
      : "";

    return `
      <article class="chat-message ${outgoing ? "outgoing" : ""}">
        <div class="avatar ${outgoing ? "" : "purple"}">${outgoing ? "You" : initials(state.activePeer?.name, state.activePeer?.email)}</div>
        <div class="message-content">
          <p>${escapeHTML(message.text)}</p>
          <span class="message-time">${formatTime(message.createdAt)}</span>
          ${statusText ? `<span class="message-status">${statusText}</span>` : ""}
        </div>
      </article>
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
  if (!peer || !isContact(peer.uid)) {
    showMessage("You can only chat with users in your contacts.", "warning");
    return;
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
  listenUserStatus(peer.uid, (peerStatus) => {
    if (!state.activePeer || state.activePeer.uid !== peer.uid) return;
    state.activePeer = { ...state.activePeer, ...peerStatus };
    setChatHeader(state.activePeer);
  });
  listenTyping(state.activeChatId, peer.uid, (isTyping) => {
    state.peerTyping = isTyping;
    setChatHeader(state.activePeer);
  });
  await markChatRead(state.activeChatId);
  $("[data-sidebar]")?.classList.remove("open");
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
    setTypingState(state.activeChatId, false).catch(() => {});
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
        showMessage("Request accepted.", "success");
      }
    }
    if (rejectButton) {
      const requestId = rejectButton.dataset.rejectRequest;
      const request = state.incomingRequests.find((item) => item.id === requestId);
      if (request) {
        await rejectConnectionRequest(requestId, request);
        showMessage("Request rejected.", "warning");
      }
    }
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
};

// Initialize the chat dashboard after the user is authenticated.
// This function loads the current user's profile, starts real-time listeners,
// and prepares the UI for direct messaging.
const initChat = async (user) => {
  if (!isFirebaseConfigured) {
    showMessage("Firebase is not configured yet. Paste your project values into assets/js/firebase-config.js.", "error");
    return;
  }

  state.currentUser = user;
  state.currentProfile = await profileFromUser(user);
  setChatHeader(null);
  renderEmpty(els.contactList, "Loading contacts", "Loading your secure connections...");
  renderEmpty(els.conversationList, "Loading chats", "Listening for recent conversations...");
  listenContacts();
  listenChats();
  listenIncomingRequests();
  await processInviteLink();
  await updateOwnPresence("online");

  if (!state.presenceListenersAttached) {
    state.presenceListenersAttached = true;

    window.addEventListener("visibilitychange", () => {
      if (!state.currentUser) return;
      if (document.hidden) {
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
  bindEvents();

  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    initChat(user).catch((error) => {
      showMessage(`Chat failed to start: ${error.message}`, "error");
    });
  });
});
