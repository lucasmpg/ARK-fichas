import { auth, logout, onAuthStateChanged, isAdminUser, listAllWorkspaces, upsertUserProfile } from "./firebase-config.js";

const adminStatus = document.getElementById('adminStatus');
const workspaceList = document.getElementById('workspaceList');
document.getElementById('goHomeBtn').addEventListener('click', () => window.location.href = '../index.html');
document.getElementById('goMySheetBtn').addEventListener('click', () => window.location.href = './ficha.html');
document.getElementById('logoutBtn').addEventListener('click', async () => { await logout(); window.location.href = '../index.html'; });
document.getElementById('refreshBtn').addEventListener('click', () => loadAdmin());

function formatDate(value) {
  if (!value) return 'sem alteração';
  try {
    if (typeof value.toDate === 'function') return value.toDate().toLocaleString('pt-BR');
    if (value.seconds) return new Date(value.seconds * 1000).toLocaleString('pt-BR');
    return new Date(value).toLocaleString('pt-BR');
  } catch (e) {
    return 'sem alteração';
  }
}

function renderWorkspaces(items) {
  workspaceList.innerHTML = '';
  if (!items.length) {
    workspaceList.innerHTML = '<div class="notice">Nenhuma ficha encontrada.</div>';
    return;
  }
  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'sheet-item';
    div.innerHTML = `
      <div class="sheet-item-meta">
        <strong>${item.ownerName || 'Sem nome'}</strong>
        <span class="muted">${item.ownerEmail || item.id}</span>
        <span class="muted">Última alteração: ${formatDate(item.updatedAt)}</span>
      </div>
      <div class="sheet-item-actions">
        <button type="button" data-open="${item.id}">Abrir ficha</button>
      </div>
    `;
    workspaceList.appendChild(div);
  }
  workspaceList.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.location.href = `./ficha.html?uid=${encodeURIComponent(btn.dataset.open)}`;
    });
  });
}

async function loadAdmin() {
  const user = auth.currentUser;
  if (!user) return;
  await upsertUserProfile(user);
  if (!isAdminUser(user)) {
    window.location.href = './ficha.html';
    return;
  }
  adminStatus.textContent = `Painel liberado para ${user.email}`;
  const items = await listAllWorkspaces();
  renderWorkspaces(items);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = '../index.html';
    return;
  }
  await loadAdmin();
});
