import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  onAuthStateChanged,
  reload,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const page = document.body.dataset.page;
const authOnlyPages = new Set(["chat", "settings"]);
const guestOnlyPages = new Set(["login", "register"]);
let currentUser = null;
let currentProfile = null;
let pendingRegistration = null;
let activeOtp = "";
let otpExpiresAt = 0;
let registrationInProgress = false;

const firebaseSetupMessage =
  "Firebase is not configured yet. Paste your project values into assets/js/firebase-config.js.";

const showMessage = (target, message, type = "info") => {
  if (!target) return;
  target.textContent = message;
  target.className = `auth-message ${type}`;
  target.hidden = false;
};

const hideMessage = (target) => {
  if (!target) return;
  target.textContent = "";
  target.hidden = true;
};

const setLoading = (button, isLoading, loadingText = "Please wait...") => {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
    return;
  }
  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
};

const setDisabled = (elements, disabled) => {
  elements.filter(Boolean).forEach((element) => {
    element.disabled = disabled;
  });
};

const getActionUrl = (fileName) => {
  if (window.location.origin === "null") return undefined;
  return `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, fileName)}`;
};

const getActionSettings = (fileName) => {
  const url = getActionUrl(fileName);
  return url ? { url } : undefined;
};

const friendlyError = (error) => {
  const code = error?.code || "";
  const messages = {
    "auth/configuration-not-found": firebaseSetupMessage,
    "auth/invalid-api-key": firebaseSetupMessage,
    "auth/email-already-in-use": "Account already exists. Please login.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/missing-email": "Please enter your email address.",
    "auth/missing-password": "Please enter your password.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-not-found": "No account found with this email. Please register first.",
    "auth/wrong-password": "Wrong password. Please try again.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your connection and Firebase authorized domains.",
    "auth/weak-password": "Password is too weak. Use uppercase, lowercase, number, symbol, and at least 8 characters.",
    "permission-denied": "Firestore rules blocked this action. Check the rules in README.md."
  };
  return messages[code] || error?.message || "Something went wrong. Please try again.";
};

// EmailJS configuration: replace these values with your own EmailJS public key, service ID, and template ID.
const EMAILJS_CONFIG = {
  serviceId: "service_8s4jxf3",
  templateId: "template_hw14wvn",
  publicKey: "2LNq7UK8e78pHPk-_"
};

const initEmailJs = () => {
  const emailjs = globalThis.emailjs;
  if (!emailjs) return;
  emailjs.init({
    publicKey: EMAILJS_CONFIG.publicKey
  });
};

const requireEmailJs = (target) => {
  const emailjs = globalThis.emailjs;
  if (!emailjs) {
    showMessage(target, "EmailJS failed to load. Refresh and try again.", "error");
    return false;
  }
  return true;
};

const sendOtpEmail = async (emailAddress) => {
  const emailjs = globalThis.emailjs;
  if (!emailjs) throw new Error("EmailJS SDK not found.");
  initEmailJs();

  return emailjs.send(
    EMAILJS_CONFIG.serviceId,
    EMAILJS_CONFIG.templateId,
    {
      to_email: emailAddress,
      otp_code: activeOtp
    }
  );
};

let resendTimer = null;
const startOtpCooldown = (button, seconds) => {
  if (!button) return;
  clearInterval(resendTimer);
  let countdown = seconds;
  button.disabled = true;
  button.textContent = `Resend OTP (${countdown}s)`;

  resendTimer = window.setInterval(() => {
    countdown -= 1;
    if (countdown <= 0) {
      clearInterval(resendTimer);
      button.disabled = false;
      button.textContent = "Resend OTP";
      return;
    }
    button.textContent = `Resend OTP (${countdown}s)`;
  }, 1000);
};

const passwordChecks = [
  { key: "length", test: (value) => value.length >= 8 },
  { key: "lower", test: (value) => /[a-z]/.test(value) },
  { key: "upper", test: (value) => /[A-Z]/.test(value) },
  { key: "number", test: (value) => /\d/.test(value) },
  { key: "special", test: (value) => /[^A-Za-z0-9]/.test(value) }
];

const getPasswordStatus = (password) => {
  const failed = passwordChecks.filter((check) => !check.test(password));
  const passedCount = passwordChecks.length - failed.length;
  const strength = passedCount >= 5 ? "strong" : passedCount >= 3 ? "medium" : "weak";
  return {
    isValid: failed.length === 0,
    failed,
    passedCount,
    strength
  };
};

const updatePasswordRules = (password) => {
  const status = getPasswordStatus(password);
  $$(".password-rules [data-rule]").forEach((item) => {
    const check = passwordChecks.find((rule) => rule.key === item.dataset.rule);
    const passed = check?.test(password);
    item.classList.toggle("valid", Boolean(passed));
    item.classList.toggle("invalid", !passed);
  });
  const strength = $("[data-password-strength]");
  const label = $("[data-strength-label]", strength || document);
  const bar = $("[data-strength-bar]", strength || document);
  if (strength && label && bar) {
    strength.classList.remove("weak", "medium", "strong");
    strength.classList.add(status.strength);
    label.textContent = status.strength[0].toUpperCase() + status.strength.slice(1);
    bar.style.width = status.strength === "strong" ? "100%" : status.strength === "medium" ? "62%" : `${Math.max(20, status.passedCount * 18)}%`;
  }
  return status;
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const showOtpModal = (registration) => {
  pendingRegistration = registration;
  const modal = $("[data-otp-modal]");
  const emailTarget = $("[data-otp-email]");
  const demoTarget = $("[data-demo-otp]");
  const otpInput = $("#otpCode");
  const otpMessage = $("[data-otp-message]");

  if (emailTarget) emailTarget.textContent = registration.email;
  if (demoTarget) {
    demoTarget.hidden = true;
  }
  if (otpInput) otpInput.value = "";
  hideMessage(otpMessage);
  if (modal) modal.hidden = false;
  otpInput?.focus();
};

const sendOtpForRegistration = async (registration, message, button) => {
  if (!requireEmailJs(message)) return false;
  pendingRegistration = registration;
  activeOtp = generateOtp();
  otpExpiresAt = Date.now() + 5 * 60 * 1000;

  if (button) setLoading(button, true, "Sending OTP...");
  try {
    await sendOtpEmail(registration.email);
    showOtpModal(registration);
    const resendButton = $("[data-resend-otp]");
    startOtpCooldown(resendButton, 60);
    showMessage(message, "OTP sent to your email. Enter it to finish registration.", "success");
    return true;
  } catch (error) {
    console.error("EmailJS OTP send error:", error);
    showMessage(message, `OTP send failed: ${error?.text || error?.message || error}`, "error");
    return false;
  } finally {
    if (button) setLoading(button, false);
  }
};

const closeOtpModal = () => {
  const modal = $("[data-otp-modal]");
  if (modal) modal.hidden = true;
  activeOtp = "";
  otpExpiresAt = 0;
};

const initials = (name = "", email = "") => {
  const source = name.trim() || email.trim();
  if (!source) return "OR";
  const parts = source.split(/\s+|@/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
};

const userDocRef = (uid) => doc(db, "users", uid);

const getUserProfile = async (user) => {
  const snap = await getDoc(userDocRef(user.uid));
  if (snap.exists()) return snap.data();

  const profile = {
    uid: user.uid,
    name: user.displayName || "",
    email: user.email || "",
    nameLower: (user.displayName || "").toLowerCase(),
    emailLower: (user.email || "").toLowerCase(),
    photoURL: user.photoURL || "",
    bio: "",
    status: "offline",
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp()
  };
  await setDoc(userDocRef(user.uid), profile, { merge: true });
  return profile;
};

const setUserOnline = async (user) => {
  if (!user || !user.uid) return;
  await setDoc(userDocRef(user.uid), {
    status: "online",
    lastSeen: serverTimestamp()
  }, { merge: true });
};

const setUserOffline = async (user) => {
  if (!user || !user.uid) return;
  await setDoc(userDocRef(user.uid), {
    status: "offline",
    lastSeen: serverTimestamp()
  }, { merge: true });
};

const syncUserUI = async (user) => {
  if (!user) return;
  currentProfile = await getUserProfile(user);
  const name = currentProfile.name || user.displayName || user.email || "Orbi User";
  const photoURL = currentProfile.photoURL || user.photoURL || "";
  const bio = currentProfile.bio || "";

  $$("[data-user-name]").forEach((node) => {
    node.textContent = name;
  });
  $$("[data-user-email]").forEach((node) => {
    node.textContent = user.email || "";
  });
  $$("[data-user-avatar]").forEach((node) => {
    node.textContent = initials(name, user.email || "");
  });
  $$("[data-email-status]").forEach((node) => {
    node.textContent = "Active";
  });

  const displayName = $("#displayName");
  const photo = $("#photoURL");
  const bioField = $("#bio");
  if (displayName) displayName.value = name;
  if (photo) photo.value = photoURL;
  if (bioField) bioField.value = bio;

  const banner = $("[data-verification-banner]");
  if (banner) banner.hidden = true;
};

const requireFirebaseConfig = (messageTarget) => {
  if (isFirebaseConfigured) return true;
  showMessage(messageTarget, firebaseSetupMessage, "error");
  return false;
};

const initPasswordToggles = () => {
  $$("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input) return;
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      button.classList.toggle("is-visible", isHidden);
      button.setAttribute("aria-label", `${isHidden ? "Hide" : "Show"} password`);
    });
  });
};

const initRegister = () => {
  const form = $("[data-register-form]");
  if (!form) return;

  const message = $("[data-auth-message]", form);
  const password = $("#password", form);
  const submit = $("button[type='submit']", form);

  updatePasswordRules(password?.value || "");
  password?.addEventListener("input", () => updatePasswordRules(password.value));

  if (submit) {
    submit.addEventListener("click", () => {
      if (form.checkValidity()) return;
      // If browser invalidity prevents submit, show the browser hint.
      form.reportValidity();
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(message);

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const nameInput = $("#name", form);
    const emailInput = $("#email", form);
    const photoInput = $("#photoURL", form);
    const confirmInput = $("#confirmPassword", form);

    if (!nameInput || !emailInput || !password || !confirmInput) {
      showMessage(message, "The registration form is incomplete. Refresh and try again.", "error");
      return;
    }

    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const photoURL = photoInput.value.trim();
    const passwordValue = password.value;
    const confirmPassword = confirmInput.value;
    const status = getPasswordStatus(passwordValue);

    updatePasswordRules(passwordValue);

    if (!name) {
      showMessage(message, "Enter your name.", "error");
      return;
    }

    if (!status.isValid) {
      showMessage(message, "Password must include 8+ characters, uppercase, lowercase, number, and symbol.", "error");
      return;
    }

    if (passwordValue !== confirmPassword) {
      showMessage(message, "Passwords do not match.", "error");
      return;
    }

    if (!requireFirebaseConfig(message)) {
      return;
    }

    if (submit) setLoading(submit, true, "Checking account...");

    try {
      const existingMethods = await fetchSignInMethodsForEmail(auth, email);
      if (existingMethods.length > 0) {
        showMessage(message, "Account already exists. Please login.", "error");
        return;
      }

      await sendOtpForRegistration({ name, email, photoURL, password: passwordValue }, message, submit);
    } catch (error) {
      showMessage(message, friendlyError(error), "error");
    } finally {
      if (submit) setLoading(submit, false);
    }
  });
};

const createAccountFromOtp = async (message, submit) => {
  if (!pendingRegistration) {
    showMessage(message, "Registration session expired. Please submit the form again.", "error");
    return;
  }

  try {
    registrationInProgress = true;
    setLoading(submit, true, "Creating account...");
    const { name, email, photoURL, password } = pendingRegistration;
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(user, { displayName: name, photoURL: photoURL || null });
    await setDoc(userDocRef(user.uid), {
      uid: user.uid,
      name,
      email: user.email || email,
      nameLower: name.toLowerCase(),
      emailLower: (user.email || email).toLowerCase(),
      photoURL,
      bio: "",
      status: "online",
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp()
    });
    showMessage(message, "OTP verified. Account created.", "success");
    pendingRegistration = null;
    window.setTimeout(() => {
      window.location.href = "chat.html";
    }, 1100);
  } catch (error) {
    registrationInProgress = false;
    showMessage(message, friendlyError(error), "error");
  } finally {
    setLoading(submit, false);
  }
};

const initOtpVerification = () => {
  const form = $("[data-otp-form]");
  if (!form) return;

  const message = $("[data-otp-message]", form);
  const otpInput = $("#otpCode", form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(message);
    const submit = $("button[type='submit']", form);
    const code = otpInput.value.trim();

    if (!activeOtp || Date.now() > otpExpiresAt) {
      showMessage(message, "OTP expired. Please request a new code.", "error");
      return;
    }

    if (code !== activeOtp) {
      showMessage(message, "Invalid OTP. Please check the 6-digit code and try again.", "error");
      return;
    }

    await createAccountFromOtp(message, submit);
  });

  $("[data-close-otp]")?.addEventListener("click", () => {
    closeOtpModal();
    showMessage($("[data-auth-message]"), "OTP verification cancelled. Your account was not created.", "warning");
  });

  $("[data-resend-otp]")?.addEventListener("click", async (event) => {
    if (!pendingRegistration) return;
    const button = event.currentTarget;
    await sendOtpForRegistration(pendingRegistration, message, button);
  });
};

const initLogin = () => {
  const form = $("[data-login-form]");
  if (!form) return;

  const message = $("[data-auth-message]", form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(message);
    if (!requireFirebaseConfig(message)) return;

    const submit = $("button[type='submit']", form);
    const email = $("#email", form).value.trim();
    const password = $("#password", form).value;

    try {
      setLoading(submit, true, "Signing in...");
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      await reload(user);
      showMessage(message, "Signed in. Redirecting...", "success");
      window.setTimeout(() => {
        window.location.href = "chat.html";
      }, 900);
    } catch (error) {
      let messageText = friendlyError(error);
      if (error?.code === "auth/invalid-credential") {
        try {
          const methods = await fetchSignInMethodsForEmail(auth, email);
          messageText = methods.length > 0
            ? "Wrong password. Please try again."
            : "No account found with this email. Please register first.";
        } catch {
          messageText = "Wrong password or no account found. Please check your details.";
        }
      }
      showMessage(message, messageText, "error");
    } finally {
      setLoading(submit, false);
    }
  });

  const resetButton = $("[data-reset-password]", form);
  resetButton?.addEventListener("click", async () => {
    hideMessage(message);
    if (!requireFirebaseConfig(message)) return;
    const email = $("#email", form).value.trim();
    if (!email) {
      showMessage(message, "Enter your email first, then request a reset link.", "error");
      return;
    }

    try {
      setLoading(resetButton, true, "Sending...");
      await sendPasswordResetEmail(auth, email, getActionSettings("login.html"));
      showMessage(message, "Password reset email sent. Check your inbox.", "success");
    } catch (error) {
      showMessage(message, friendlyError(error), "error");
    } finally {
      setLoading(resetButton, false);
    }
  });
};

const initLogout = () => {
  $$("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await setUserOffline(currentUser);
        await signOut(auth);
        window.location.href = "login.html";
      } catch (error) {
        showMessage($("[data-page-message]"), friendlyError(error), "error");
      }
    });
  });
};

const initProfileForm = () => {
  const form = $("[data-profile-form]");
  if (!form) return;

  const message = $("[data-auth-message]", form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) return;
    hideMessage(message);

    const submit = $("button[type='submit']", form);
    const name = $("#displayName", form).value.trim();
    const photoURL = $("#photoURL", form).value.trim();
    const bio = $("#bio", form).value.trim();

    if (!name) {
      showMessage(message, "Display name is required.", "error");
      return;
    }

    try {
      setLoading(submit, true, "Saving...");
      await updateProfile(currentUser, { displayName: name, photoURL: photoURL || null });
      await setDoc(userDocRef(currentUser.uid), {
        uid: currentUser.uid,
        name,
        email: currentUser.email || currentProfile?.email || "",
        nameLower: name.toLowerCase(),
        emailLower: (currentUser.email || currentProfile?.email || "").toLowerCase(),
        photoURL,
        bio
      }, { merge: true });
      await syncUserUI(currentUser);
      showMessage(message, "Profile saved.", "success");
    } catch (error) {
      showMessage(message, friendlyError(error), "error");
    } finally {
      setLoading(submit, false);
    }
  });
};

const initAuthGuards = () => {
  if (!authOnlyPages.has(page) && !guestOnlyPages.has(page)) return;

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (authOnlyPages.has(page) && !user) {
      window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname.split("/").pop() || "chat.html")}`;
      return;
    }

    if (guestOnlyPages.has(page) && user && !registrationInProgress) {
      window.location.href = "chat.html";
      return;
    }

    if (user) {
      try {
        await reload(user);
        await syncUserUI(user);
        setUserOnline(user).catch(() => {});
      } catch (error) {
        showMessage($("[data-page-message]"), friendlyError(error), "error");
      }
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  initPasswordToggles();
  initRegister();
  initOtpVerification();
  initLogin();
  initLogout();
  initProfileForm();
  initAuthGuards();

  window.addEventListener("beforeunload", () => {
    if (!currentUser) return;
    setUserOffline(currentUser).catch(() => {});
  });
});
