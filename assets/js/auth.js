import { auth, loginWithGoogle, logout, onAuthStateChanged, upsertUserProfile, isAdminUser } from "./firebase-config.js";

export async function requireAuth() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        stop();
        window.location.href = "../index.html";
        return;
      }
      await upsertUserProfile(user);
      stop();
      resolve(user);
    });
  });
}

export async function bindLandingAuth() {
  const loginBtn = document.getElementById("loginGoogleBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const openFichaBtn = document.getElementById("openFichaBtn");
  const openAdminBtn = document.getElementById("openAdminBtn");
  const userInfo = document.getElementById("userInfo");
  const adminHint = document.getElementById("adminHint");

  if (loginBtn) loginBtn.addEventListener("click", async () => {
    try {
      await loginWithGoogle();
      window.location.href = "./pages/dashboard.html";
    } catch (error) {
      console.error(error);
      alert("Não foi possível entrar com Google.");
    }
  });
  if (logoutBtn) logoutBtn.addEventListener("click", async () => logout());

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (loginBtn) loginBtn.style.display = "inline-flex";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (openFichaBtn) openFichaBtn.style.display = "none";
      if (openAdminBtn) openAdminBtn.style.display = "none";
      return;
    }

    await upsertUserProfile(user);
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "inline-flex";
    if (openFichaBtn) openFichaBtn.style.display = "inline-flex";
    if (userInfo) userInfo.textContent = `${user.displayName || "Usuário"} • ${user.email || ""}`;

    const admin = isAdminUser(user);
    if (openAdminBtn) openAdminBtn.style.display = admin ? "inline-flex" : "none";
    if (adminHint) adminHint.textContent = admin
      ? "Seu e-mail está cadastrado como administrador."
      : "Seu e-mail ainda não está cadastrado como administrador.";

    if (window.location.pathname.endsWith("/index.html") || window.location.pathname === "/") {
      window.location.href = "./pages/dashboard.html";
      return;
    }
  });
}
