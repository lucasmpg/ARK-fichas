import {
  auth,
  logout,
  onAuthStateChanged,
  isAdminUser,
  upsertUserProfile,
  listAllUsers,
  getWorkspace,
  saveWorkspace
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
      await loadSelectedUserWorkspace();
    });
    usersList.appendChild(div);
  }
}

function renderWorkspaceCard(user, workspaceExists) {
  sheetsList.innerHTML = '';

  const div = document.createElement('div');
  div.className = 'sheet-item';
  div.innerHTML = `
    <div class="sheet-item-meta">
      <strong>${user.name || 'Sem nome'}</strong>
      <span class="muted">${user.email || 'Sem e-mail'}</span>
      <span class="muted">${workspaceExists ? 'Ficha encontrada' : 'Esse usuário ainda não tem ficha criada'}</span>
    </div>
    <div class="sheet-item-actions">
      <button type="button" id="openSelectedSheetBtn">Abrir ficha</button>
      ${workspaceExists ? '' : '<button type="button" id="createSelectedSheetBtn">Criar ficha vazia</button>'}
    </div>
  `;

  sheetsList.appendChild(div);

  document.getElementById('openSelectedSheetBtn').addEventListener('click', () => {
    window.location.href = `./ficha.html?uid=${encodeURIComponent(user.uid)}&admin=1`;
  });

  if (!workspaceExists) {
    document.getElementById('createSelectedSheetBtn').addEventListener('click', async () => {
      await saveWorkspace(user.uid, {
        ownerName: user.name || '',
        ownerEmail: user.email || '',
        createdAt: new Date().toISOString()
      });
      await loadSelectedUserWorkspace();
    });
  }
}

async function loadSelectedUserWorkspace() {
  if (!selectedUser) {
    sheetsList.innerHTML = '<div class="notice">Selecione um usuário.</div>';
    return;
  }

  const workspace = await getWorkspace(selectedUser.uid);
  renderWorkspaceCard(selectedUser, !!workspace);
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
  allUsers = await listAllUsers();
  renderUsers(allUsers);

  if (selectedUser) {
    await loadSelectedUserWorkspace();
  }
}

createMySheetBtn.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;

  const workspace = await getWorkspace(user.uid);

  if (!workspace) {
    await saveWorkspace(user.uid, {
      ownerName: user.displayName || '',
      ownerEmail: user.email || '',
      createdAt: new Date().toISOString()
    });
  }

  window.location.href = `./ficha.html?uid=${encodeURIComponent(user.uid)}&admin=1`;
});

createSelectedUserSheetBtn.addEventListener('click', async () => {
  if (!selectedUser) return;

  const workspace = await getWorkspace(selectedUser.uid);

  if (!workspace) {
    await saveWorkspace(selectedUser.uid, {
      ownerName: selectedUser.name || '',
      ownerEmail: selectedUser.email || '',
      createdAt: new Date().toISOString()
    });
  }

  window.location.href = `./ficha.html?uid=${encodeURIComponent(selectedUser.uid)}&admin=1`;
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
