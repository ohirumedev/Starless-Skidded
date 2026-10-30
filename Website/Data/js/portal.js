(function () {
  const STORAGE_KEY = "phoenix_portal_session";
  const GOOGLE_PENDING_KEY = "phoenix_google_pending";

  let apiBase = "http://45.92.217.130:3551";
  let googleRedirect = "http://45.92.217.130:8080/oauth2/google/callback";
  let discordRedirect = "http://45.92.217.130:8080/oauth2/callback";

  const authPanel = document.getElementById("auth-panel");
  const dashboardPanel = document.getElementById("dashboard-panel");
  const googleCompletePanel = document.getElementById("google-complete-panel");
  const messageEl = document.getElementById("message");

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = "message " + (type || "");
    messageEl.classList.remove("hidden");
  }

  function hideMessage() {
    messageEl.classList.add("hidden");
  }

  function saveSession(data) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        username: data.username,
        email: data.email,
        accountId: data.accountId,
        accessToken: data.accessToken,
      }),
    );
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(GOOGLE_PENDING_KEY);
  }

  function showDashboard(session) {
    authPanel.classList.add("hidden");
    googleCompletePanel.classList.add("hidden");
    dashboardPanel.classList.remove("hidden");
    document.getElementById("dash-username").textContent = session.username;
    document.getElementById("dash-email").textContent = session.email;
    document.getElementById("dash-account").textContent = session.accountId;
  }

  function showAuth() {
    authPanel.classList.remove("hidden");
    dashboardPanel.classList.add("hidden");
    googleCompletePanel.classList.add("hidden");
  }

  async function api(path, options) {
    const res = await fetch(apiBase + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || "Request failed");
    }
    return data;
  }

  async function loadConfig() {
    try {
      const cfg = await fetch("/api/website/config").then((r) => r.json());
      if (cfg.apiBase) apiBase = cfg.apiBase;
      if (cfg.googleRedirectUri) googleRedirect = cfg.googleRedirectUri;
      if (cfg.discordRedirectUri) discordRedirect = cfg.discordRedirectUri;
    } catch {
      /* defaults */
    }
  }

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab + "-tab").classList.add("active");
      hideMessage();
    });
  });

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMessage();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    try {
      const data = await api("/phoenix/api/launcher/login", {
        method: "POST",
        body: JSON.stringify({ email, password, hwid: "web-portal" }),
      });
      saveSession(data);
      showDashboard(data);
      showMessage("Signed in successfully.", "success");
    } catch (err) {
      showMessage(err.message, "error");
    }
  });

  document.getElementById("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMessage();
    const username = document.getElementById("reg-username").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const discordId = document.getElementById("reg-discord").value.trim();
    try {
      const data = await api("/phoenix/api/launcher/register", {
        method: "POST",
        body: JSON.stringify({
          username,
          email,
          password,
          hwid: "web-portal",
          discordId: discordId || undefined,
        }),
      });
      saveSession(data);
      showDashboard(data);
      showMessage(data.message || "Account created.", "success");
    } catch (err) {
      showMessage(err.message, "error");
    }
  });

  document.getElementById("btn-discord-login").addEventListener("click", () => {
    window.location.href = "/login";
  });

  document.getElementById("btn-discord-register").addEventListener("click", () => {
    window.location.href = "/login";
  });

  async function startGoogleOAuth() {
    hideMessage();
    try {
      const cfg = await api(
        "/phoenix/api/launcher/google/config?redirectUri=" +
          encodeURIComponent(googleRedirect),
      );
      if (!cfg.enabled || !cfg.clientId) {
        throw new Error("Google OAuth is not configured on the backend.");
      }
      const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: googleRedirect,
        response_type: "code",
        scope: "openid email profile",
        access_type: "offline",
        prompt: "consent",
      });
      window.location.href =
        "https://accounts.google.com/o/oauth2/v2/auth?" + params;
    } catch (err) {
      showMessage(err.message, "error");
    }
  }

  document.getElementById("btn-google-login").addEventListener("click", startGoogleOAuth);
  document.getElementById("btn-google-register").addEventListener("click", startGoogleOAuth);

  document.getElementById("google-complete-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMessage();
    const pending = JSON.parse(localStorage.getItem(GOOGLE_PENDING_KEY) || "null");
    if (!pending) {
      showMessage("Google session expired. Try again.", "error");
      showAuth();
      return;
    }
    const username = document.getElementById("google-username").value.trim();
    try {
      const data = await api("/phoenix/api/launcher/google/register", {
        method: "POST",
        body: JSON.stringify({
          googleId: pending.id,
          email: pending.email,
          username,
          hwid: "web-portal",
        }),
      });
      localStorage.removeItem(GOOGLE_PENDING_KEY);
      saveSession(data);
      showDashboard(data);
      showMessage("Account created with Google.", "success");
    } catch (err) {
      showMessage(err.message, "error");
    }
  });

  document.getElementById("btn-signout").addEventListener("click", () => {
    clearSession();
    showAuth();
    hideMessage();
  });

  async function handleGoogleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return false;

    try {
      const data = await api("/phoenix/api/launcher/google/exchange", {
        method: "POST",
        body: JSON.stringify({
          code,
          redirectUri: googleRedirect,
          hwid: "web-portal",
        }),
      });

      if (data.accountExists && data.accessToken) {
        saveSession(data);
        showDashboard(data);
        showMessage("Signed in with Google.", "success");
        window.history.replaceState({}, "", "/portal");
        return true;
      }

      localStorage.setItem(
        GOOGLE_PENDING_KEY,
        JSON.stringify(data.google),
      );
      authPanel.classList.add("hidden");
      googleCompletePanel.classList.remove("hidden");
      document.getElementById("google-email-label").textContent = data.google.email;
      document.getElementById("google-username").value =
        (data.google.name || "player").replace(/\s+/g, "").slice(0, 16);
      window.history.replaceState({}, "", "/portal");
      return true;
    } catch (err) {
      showMessage(err.message, "error");
      window.history.replaceState({}, "", "/portal");
      return true;
    }
  }

  (async function init() {
    await loadConfig();
    const session = loadSession();
    if (session && session.accessToken) {
      showDashboard(session);
    } else {
      showAuth();
    }
    await handleGoogleCallback();
  })();
})();
