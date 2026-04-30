# Orbi Frontend

Premium dark-mode frontend prototype for **Orbi**: Secure Conversations, Seamlessly Connected.

## Pages

- `index.html` - Landing page
- `register.html` - Register page
- `login.html` - Login page
- `chat.html` - Chat dashboard with responsive sidebar
- `settings.html` - Profile and settings page

## Structure

```text
orbi/
|-- index.html
|-- register.html
|-- login.html
|-- chat.html
|-- settings.html
|-- README.md
`-- assets/
    |-- css/
    |   `-- styles.css
    `-- js/
        |-- app.js
        |-- firebase-auth.js
        |-- firebase-chat.js
        `-- firebase-config.js
```

## Features

- Dark mode default with optional light mode toggle
- Responsive mobile and desktop layouts
- Sidebar chat dashboard
- Firebase email/password registration and login
- Forgot password email flow
- Email verification send and resend flow
- Hackathon demo OTP step before account creation
- Strong password validation with Weak / Medium / Strong feedback
- Show/hide password controls with eye state
- Logout and auth redirects
- Protected chat and settings pages
- Firestore user profile document at `users/{uid}`
- Firestore one-to-one real-time chat
- User search, contact sidebar, unread counts, timestamps, and instant message listeners
- Profile, privacy, notification, and trusted-device settings UI
- Reusable CSS classes and shared JavaScript behavior

## Firebase Setup

1. Open the Firebase Console and create a project.
2. Add a Web app in Project settings.
3. Copy the Firebase config object into `assets/js/firebase-config.js`.
4. Open Authentication > Sign-in method and enable Email/Password.
5. Optional but recommended: enable a password policy that requires lowercase, uppercase, number, symbol, and at least 8 characters.
6. Open Firestore Database and create a database.
7. Add `localhost` to Authentication > Settings > Authorized domains if it is not already present.
8. Use these Firestore rules for the profile and chat documents:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isSelf(userId) {
      return signedIn() && request.auth.uid == userId;
    }

    function isChatParticipant(chatId) {
      return signedIn()
        && request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participantIds;
    }

    match /users/{userId} {
      allow read: if signedIn();
      allow create, update: if isSelf(userId)
        && request.resource.data.uid == request.auth.uid;
      allow delete: if false;
    }

    match /chats/{chatId} {
      allow read, update: if signedIn()
        && request.auth.uid in resource.data.participantIds;
      allow create: if signedIn()
        && request.auth.uid in request.resource.data.participantIds
        && request.resource.data.participantIds.size() == 2;
      allow delete: if false;

      match /messages/{messageId} {
        allow read: if isChatParticipant(chatId);
        allow create: if isChatParticipant(chatId)
          && request.resource.data.senderId == request.auth.uid
          && request.resource.data.text is string
          && request.resource.data.text.size() > 0
          && request.resource.data.text.size() <= 4000;
        allow update, delete: if false;
      }
    }
  }
}
```

These rules are suitable for a demo build. For production, tighten chat updates so users can only modify allowed fields such as their own unread counter and chat metadata produced by trusted server code.

## OTP Note

Firebase client-only Authentication does not send custom numeric OTP emails without a backend or Cloud Function. Orbi uses a hackathon-friendly simulated OTP modal before creating the Firebase account, then sends the normal Firebase email verification link after account creation.

For production, replace the simulated OTP in `assets/js/firebase-auth.js` with a backend endpoint or Firebase Cloud Function that emails the generated code and verifies it server-side.

## Stored Profile

On registration, Orbi creates `users/{uid}` with:

```js
{
  uid,
  name,
  email,
  nameLower,
  emailLower,
  photoURL,
  bio,
  createdAt
}
```

## Firestore Chat Schema

Orbi uses deterministic one-to-one chat IDs so the same two users always open the same chat:

```text
chatId = [currentUid, peerUid].sort().join("_")
```

Collections:

```text
users/{uid}
chats/{chatId}
chats/{chatId}/messages/{messageId}
```

`chats/{chatId}`:

```js
{
  id,
  participantIds: [uidA, uidB],
  participants: {
    [uidA]: { uid, name, email, photoURL },
    [uidB]: { uid, name, email, photoURL }
  },
  unreadCounts: {
    [uidA]: 0,
    [uidB]: 2
  },
  lastMessage,
  lastMessageAt,
  lastMessageSenderId,
  createdAt,
  updatedAt
}
```

`chats/{chatId}/messages/{messageId}`:

```js
{
  chatId,
  senderId,
  receiverId,
  text,
  createdAt,
  readBy: [senderUid]
}
```

Real-time listeners are implemented in `assets/js/firebase-chat.js`:

- `onSnapshot(collection(db, "users"))` for the searchable contact list
- `onSnapshot(query(collection(db, "chats"), where("participantIds", "array-contains", uid)))` for sidebar conversations and unread counts
- `onSnapshot(query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc")))` for instant message updates

## Run Locally

Firebase Auth and ES modules should be served from localhost:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4173/index.html
```

## Firebase Docs

- Web setup: https://firebase.google.com/docs/web/setup
- Password authentication: https://firebase.google.com/docs/auth/web/password-auth
- Manage users and auth state: https://firebase.google.com/docs/auth/web/manage-users
- Firestore real-time listeners: https://firebase.google.com/docs/firestore/query-data/listen
- Firestore add/update data: https://firebase.google.com/docs/firestore/manage-data/add-data
- Firestore query ordering: https://firebase.google.com/docs/firestore/query-data/order-limit-data
- Security rules with auth: https://firebase.google.com/docs/rules/rules-and-auth
