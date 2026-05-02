# Orbi - Advanced Chat App

A modern, WhatsApp-style chat application with voice messages, image sharing, push notifications, and smooth animations.

## ✨ Features

- **Real-time Messaging**: Instant messaging with Firebase Firestore
- **Voice Messages**: Record and send audio messages
- **Image Sharing**: Upload and share images with preview
- **Push Notifications**: Foreground and background notifications
- **WhatsApp-style UI**: Modern dark theme with smooth animations
- **Firebase Auth**: Secure authentication with email/OTP
- **End-to-end Encryption**: Message encryption (text messages)
- **Contact Management**: Send connection requests
- **Presence Indicators**: Online/offline status
- **Typing Indicators**: See when others are typing
- **Read Receipts**: Message delivery and read status

## 🚀 Quick Start

### Prerequisites
- Node.js (for local server)
- Firebase project with Firestore, Storage, and Messaging enabled

### Setup

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd orbi-chat-app
   ```

2. **Firebase Configuration**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project or use existing
   - Enable Firestore, Storage, and Cloud Messaging
   - Generate a VAPID key for push notifications

3. **Update Firebase Config**
   Edit `assets/js/firebase-config.js` with your Firebase config:
   ```javascript
   const firebaseConfig = {
     apiKey: "your-api-key",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "your-app-id"
   };
   ```

4. **VAPID Key Setup**
   - In Firebase Console > Project Settings > Cloud Messaging
   - Generate a new key pair
   - Update the VAPID key in `assets/js/chat.js` in the `requestNotificationPermission` function

5. **Run Locally**
   ```bash
   python -m http.server 8000
   # or
   npx serve .
   ```
   Open `http://localhost:8000` in your browser

## 📱 Usage

### Authentication
- Register with email
- Verify with OTP sent to email
- Login with existing account

### Chatting
- Search users by email
- Send connection requests
- Start conversations
- Send text, voice, or image messages

### Voice Messages
- Click the microphone button
- Record your message
- Preview and send

### Image Sharing
- Click the attachment button
- Select an image file
- Preview and send

### Notifications
- Grant notification permission when prompted
- Receive notifications for new messages

## 🛠️ Technical Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Firebase (Auth, Firestore, Storage, Messaging)
- **Real-time**: Firestore listeners
- **Media**: MediaRecorder API, Firebase Storage
- **Notifications**: Firebase Cloud Messaging
- **Styling**: CSS Grid, Flexbox, CSS Animations

## 📁 Project Structure

```
orbi-chat-app/
├── index.html              # Landing page
├── login.html              # Login page
├── register.html           # Registration page
├── chat.html               # Main chat interface
├── settings.html           # Settings page
├── firebase-messaging-sw.js # Service worker for notifications
├── assets/
│   ├── css/
│   │   └── styles.css      # Main styles with animations
│   └── js/
│       ├── firebase-config.js  # Firebase configuration
│       ├── auth.js         # Authentication logic
│       └── chat.js         # Chat functionality
└── README.md
```

## 🔧 Firebase Setup

### 1. Firestore Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Chat access rules
    match /chats/{chatId} {
      allow read, write: if request.auth != null &&
        request.auth.uid in resource.data.participantIds;
    }

    // Message rules
    match /chats/{chatId}/messages/{messageId} {
      allow read, write: if request.auth != null &&
        request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participantIds;
    }

    // Request rules
    match /requests/{userId}/{type}/{requestId} {
      allow read, write: if request.auth != null &&
        (request.auth.uid == userId || request.auth.uid == resource.data.fromUid);
    }
  }
}
```

### 2. Storage Rules
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /images/{chatId}/{fileName} {
      allow read, write: if request.auth != null &&
        request.auth.uid in firestore.get(/databases/(default)/documents/chats/$(chatId)).data.participantIds;
    }
    match /audio/{chatId}/{fileName} {
      allow read, write: if request.auth != null &&
        request.auth.uid in firestore.get(/databases/(default)/documents/chats/$(chatId)).data.participantIds;
    }
  }
}
```

## 🎨 Customization

### Themes
- Currently supports dark theme
- Light theme support can be added by modifying CSS variables

### Animations
- Message slide-in animations
- Typing indicator dots
- Button hover effects
- Modal transitions

### Media Constraints
- Voice: WebM format, max 5MB
- Images: JPEG/PNG, max 10MB
- Automatic compression and optimization

## 🔒 Security

- Firebase Authentication for user management
- Firestore security rules for data access
- Storage security rules for file access
- Message encryption for text content
- HTTPS required for service worker

## 📊 Performance

- Lazy loading of messages
- Image optimization
- Efficient real-time listeners
- Service worker for offline capabilities

## 🐛 Troubleshooting

### Common Issues

1. **Notifications not working**
   - Check VAPID key configuration
   - Ensure HTTPS in production
   - Verify service worker registration

2. **Media upload fails**
   - Check Firebase Storage rules
   - Verify file size limits
   - Check network connectivity

3. **Messages not appearing**
   - Check Firestore security rules
   - Verify user authentication
   - Check browser console for errors

### Debug Mode
Enable debug logging in browser console:
```javascript
localStorage.setItem('debug', 'true');
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Firebase for the amazing backend services
- WhatsApp for UI inspiration
- The web development community for best practices

---

Built with ❤️ using modern web technologies