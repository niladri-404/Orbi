const qs = (selector, scope = document) => scope.querySelector(selector);
const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const setTheme = (mode) => {
  document.body.classList.toggle("light-mode", mode === "light");
  localStorage.setItem("orbi-theme", mode);
  qsa("[data-theme-label]").forEach((label) => {
    label.textContent = mode === "light" ? "Dark mode" : "Light mode";
  });
};

const savedTheme = localStorage.getItem("orbi-theme");
if (savedTheme === "light") {
  document.addEventListener("DOMContentLoaded", () => setTheme("light"));
}

document.addEventListener("DOMContentLoaded", () => {
  const mobileMenu = qs("[data-mobile-menu]");
  const navInner = qs("[data-nav-inner]");

  if (mobileMenu && navInner) {
    mobileMenu.addEventListener("click", () => {
      const isOpen = navInner.classList.toggle("nav-open");
      mobileMenu.setAttribute("aria-expanded", String(isOpen));
    });
  }

  qsa("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = document.body.classList.contains("light-mode") ? "dark" : "light";
      setTheme(next);
    });
  });

  qsa("[data-demo-form]").forEach((form) => {
    if (form.matches("[data-register-form], [data-login-form], [data-profile-form]")) return;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const button = qs("button[type='submit']", form);
      const original = button ? button.textContent : "";

      if (button) {
        button.textContent = "Ready to connect";
        button.disabled = true;
      }

      setTimeout(() => {
        if (button) {
          button.textContent = original;
          button.disabled = false;
        }
      }, 1600);
    });
  });

  const sidebar = qs("[data-sidebar]");
  qsa("[data-sidebar-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      sidebar?.classList.toggle("open");
    });
  });

  qsa("[data-thread]").forEach((thread) => {
    thread.addEventListener("click", () => {
      qsa("[data-thread]").forEach((item) => item.classList.remove("active"));
      thread.classList.add("active");

      const title = thread.dataset.thread || "Design Partners";
      const subtitle = thread.dataset.subtitle || "Online now";
      const headerTitle = qs("[data-chat-title]");
      const headerSubtitle = qs("[data-chat-subtitle]");

      if (headerTitle) headerTitle.textContent = title;
      if (headerSubtitle) headerSubtitle.textContent = subtitle;
      sidebar?.classList.remove("open");
    });
  });

  const composer = qs("[data-composer]");
  const stream = qs("[data-chat-stream]");

  if (composer && stream && !composer.matches("[data-realtime-composer]")) {
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = qs("[data-message-input]", composer);
      const value = input?.value.trim();
      if (!value) return;

      const message = document.createElement("article");
      message.className = "chat-message outgoing";
      message.innerHTML = `
        <div class="avatar">You</div>
        <div class="message-content">
          <p></p>
          <span class="message-time">Just now</span>
        </div>
      `;
      qs("p", message).textContent = value;
      stream.appendChild(message);
      input.value = "";
      stream.scrollTop = stream.scrollHeight;
    });
  }

  const year = qs("[data-year]");
  if (year) {
    year.textContent = new Date().getFullYear();
  }
});
