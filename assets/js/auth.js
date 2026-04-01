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
    } catch (error) {
      console.error(error);
      alert("Não foi possível entrar com Google.");
    }
  });
  if (logoutBtn) logoutBtn.addEventListener("click", async () => logout());
  if (openFichaBtn) openFichaBtn.addEventListener("click", () => window.location.href = "./pages/ficha.html");
  if (openAdminBtn) openAdminBtn.addEventListener("click", () => window.location.href = "./pages/admin.html");

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (loginBtn) loginBtn.style.display = "inline-block";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (openFichaBtn) openFichaBtn.style.display = "none";
      if (openAdminBtn) openAdminBtn.style.display = "none";
      if (userInfo) userInfo.textContent = "Faça login com Google para abrir sua ficha.";
      if (adminHint) adminHint.textContent = "Para liberar o painel do mestre, troque ADMIN_EMAILS no arquivo assets/js/firebase-config.js.";
      return;
    }

    await upsertUserProfile(user);
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "inline-block";
    if (openFichaBtn) openFichaBtn.style.display = "inline-block";
    if (userInfo) userInfo.textContent = `${user.displayName || "Usuário"} • ${user.email || ""}`;

    const admin = isAdminUser(user);
    if (openAdminBtn) openAdminBtn.style.display = admin ? "inline-block" : "none";
    if (adminHint) adminHint.textContent = admin
      ? "Seu e-mail está cadastrado como administrador."
      : "Seu e-mail ainda não está cadastrado como administrador.";
  });
}