import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsSupported } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-analytics.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = window.__ARK_FIREBASE_CONFIG__;

if (!firebaseConfig?.apiKey || !firebaseConfig?.projectId || !firebaseConfig?.appId) {
  throw new Error(
    "Configuração Firebase ausente. Crie o arquivo assets/js/runtime-config.js a partir de assets/js/runtime-config.example.js antes de publicar o projeto."
  );
}

export const ADMIN_EMAILS = Array.isArray(window.__ARK_ADMIN_EMAILS__)
  ? window.__ARK_ADMIN_EMAILS__
  : ["moisslucas3@gmail.com"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
analyticsSupported().then((ok) => {
  if (ok) getAnalytics(app);
}).catch(() => {});

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isAdminEmail(email) {
  return ADMIN_EMAILS.map(normalizeEmail).includes(normalizeEmail(email));
}

export function isAdminUser(user) {
  return !!user && isAdminEmail(user.email);
}

export async function loginWithGoogle() {
  return signInWithPopup(auth, provider);
}

export async function logout() {
  return signOut(auth);
}

export function waitForAuth() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user || null);
    });
  });
}

export async function upsertUserProfile(user) {
  if (!user) return;
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    name: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    isAdmin: isAdminUser(user),
    lastLoginAt: serverTimestamp()
  }, { merge: true });
}

export async function getWorkspace(uid) {
  const snap = await getDoc(doc(db, "workspaces", uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveWorkspace(uid, payload) {
  await setDoc(doc(db, "workspaces", uid), {
    ...payload,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function listAllUsers() {
  const snap = await getDocs(query(collection(db, "users"), orderBy("name", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function normalizeSharedViewers(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const uid = String(item?.uid || "").trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push({
      uid,
      name: String(item?.name || "").trim(),
      email: String(item?.email || "").trim()
    });
  }
  return out;
}

export function userCanViewWorkspace(user, workspace) {
  if (!user || !workspace) return false;
  if (isAdminUser(user)) return true;
  if (workspace.ownerUid && workspace.ownerUid === user.uid) return true;
  const viewers = normalizeSharedViewers(workspace.sharedViewers);
  return viewers.some((item) => item.uid === user.uid);
}

export { app, auth, db, doc, getDoc, setDoc, updateDoc, serverTimestamp, onAuthStateChanged };
