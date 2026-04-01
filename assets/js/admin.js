import {
  auth,
  logout,
  onAuthStateChanged,
  isAdminUser,
  upsertUserProfile,
  listUsers,
  listSheetsByOwnerUid,
  createSheetForUser
} from "./firebase-config.js";

const adminStatus = document.getElementById('adminStatus');
const usersList = document.getElementById('usersList');
const sheetsList = document.getElementById('sheetsList');
const selectedUserBox = document.getElementById('selectedUserBox');
const userSearchInput = document.getElementById('userSearchInput');
const createMySheetBtn = document.getElementById('createMySheetBtn');
const createSelectedUserSheetBtn = document.getElementById('createSelectedUserSheetBtn');

document.getElementById('goHomeBtn').addEventListener('click', () => window.location.href = '../index.html');
document.getElementById('goMySheetBtn').addEventListener('click', () => window.location.href = './ficha.html');
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await logout();
  window.location.href = '../index.html';
});
document.getElementById('refreshBtn').addEventListener('click', () => loadAdmin());

let allUsers = [];
let selectedUser = null;

function formatDate(value) {
  if (!value) return 'sem alteração';
  try {
    if (typeof value.toDate === 'function') return value.toDate().toLocaleString('pt-BR');
    if (value.seconds) return new Date(value.seconds * 1000).toLocaleString('pt-BR');
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return 'sem alteração';
  }
}

function renderUsers(items) {
  const term = (userSearchInput.value || '').trim().toLowerCase();
  const filtered = items.filter(item => {
    const name = (item.name || '').toLowerCase();
    const email = (item.email || '').toLowerCase();
    return name.includes(term) || email.includes(term);
  });

  usersList.innerHTML = '';

  if (!filtered.length) {
    usersList.innerHTML = '<div class="notice">Nenhum usuário encontrado.</div>';
    return;
  }

  for (const item of filtered) {
    const div = document.createElement('div');
    div.className = 'user-item' + (selectedUser?.uid === item.uid ? ' active' : '');
    div.innerHTML = `
      <div class="user-item-meta">
        <strong>${item.name || 'Sem nome'}</strong>
        <span class="muted">${item.email || 'Sem e-mail'}</span>
        <span class="muted">UID: ${item.uid}</span>
      </div>
    `;
    div.addEventListener('click', async () => {
      selectedUser = item;
      createSelectedUserSheetBtn.disabled = false;
      selectedUserBox.innerHTML = `
        <strong>${item.name || 'Sem nome'}</strong><br>
        <span class="muted">${item.email || 'Sem e-mail'}</span><br>
        <span class="muted">UID: ${item.uid}</span>
      `;
      renderUsers(allUsers);
      await loadSheetsForSelectedUser();
    });
    usersList.appendChild(div);
  }
}

function renderSheets(items) {
  sheetsList.innerHTML = '';

  if (!items.length) {
    sheetsList.innerHTML = '<div class="notice">Nenhuma ficha encontrada para este usuário.</div>';
    return;
  }

  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'sheet-item';
    div.innerHTML = `
      <div class="sheet-item-meta">
        <strong>${item.name || 'Ficha sem nome'}</strong>
        <span class="muted">${item.ownerEmail || ''}</span>
        <span class="muted">Última alteração: ${formatDate(item.updatedAt)}</span>
      </div>
      <div class="sheet-item-actions">
        <button type="button" data-open="${item.id}">Abrir ficha</button>
      </div>
    `;
    sheetsList.appendChild(div);
  }

  sheetsList.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.location.href = `./ficha.html?sheetId=${encodeURIComponent(btn.dataset.open)}&admin=1`;
    });
  });
}

async function loadSheetsForSelectedUser() {
  if (!selectedUser) {
    sheetsList.innerHTML = '<div class="notice">Selecione um usuário.</div>';
    return;
  }
  const sheets = await listSheetsByOwnerUid(selectedUser.uid);
  renderSheets(sheets);
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
  allUsers = await listUsers();
  renderUsers(allUsers);

  if (selectedUser) {
    await loadSheetsForSelectedUser();
  }
}

createMySheetBtn.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;

  const nome = prompt('Nome da nova ficha:');
  if (!nome) return;

  const sheetId = await createSheetForUser({
    ownerUid: user.uid,
    ownerEmail: user.email || '',
    ownerName: user.displayName || '',
    name: nome
  });

  window.location.href = `./ficha.html?sheetId=${encodeURIComponent(sheetId)}&admin=1`;
});

createSelectedUserSheetBtn.addEventListener('click', async () => {
  if (!selectedUser) return;

  const nome = prompt('Nome da nova ficha para este usuário:');
  if (!nome) return;

  const sheetId = await createSheetForUser({
    ownerUid: selectedUser.uid,
    ownerEmail: selectedUser.email || '',
    ownerName: selectedUser.name || '',
    name: nome
  });

  window.location.href = `./ficha.html?sheetId=${encodeURIComponent(sheetId)}&admin=1`;
});

userSearchInput.addEventListener('input', () => {
  renderUsers(allUsers);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = '../index.html';
    return;
  }
  await loadAdmin();
});
