import {
  logout,
  isAdminUser,
  getWorkspace,
  saveWorkspace,
  upsertUserProfile,
  listAllUsers,
  waitForAuth,
  normalizeSharedViewers,
  userCanViewWorkspace
} from "./firebase-config.js";

const statusEl = document.getElementById('dashboardStatus');
const subtitleEl = document.getElementById('dashboardSubtitle');
const cardsEl = document.getElementById('dashboardCards');
const createModal = document.getElementById('createCreatureModal');
const transferModal = document.getElementById('transferCreatureModal');
const shareModal = document.getElementById('shareWorkspaceModal');
const templateSelect = document.getElementById('newCreatureTemplate');
const transferTargetUser = document.getElementById('transferTargetUser');
const shareTargetUser = document.getElementById('shareTargetUser');
const manageShareBtn = document.getElementById('manageShareBtn');
const sharedViewerList = document.getElementById('sharedViewerList');

const TEMPLATES = [
  { key: 'lobo', label: 'Lobo', baseVida: 100, baseDano: 12, baseMovimento: 7, basePeso: 45, pontosPorNivel: 5 },
  { key: 'urso', label: 'Urso', baseVida: 180, baseDano: 20, baseMovimento: 6, basePeso: 120, pontosPorNivel: 5 },
  { key: 'raptor', label: 'Raptor', baseVida: 120, baseDano: 16, baseMovimento: 8, basePeso: 60, pontosPorNivel: 5 },
  { key: 'escorpiao', label: 'Escorpião', baseVida: 110, baseDano: 14, baseMovimento: 6, basePeso: 35, pontosPorNivel: 5 },
  { key: 'aranha', label: 'Aranha', baseVida: 90, baseDano: 11, baseMovimento: 7, basePeso: 25, pontosPorNivel: 5 },
  { key: 'custom', label: 'Template customizado', baseVida: 100, baseDano: 0, baseMovimento: 5, basePeso: 50, pontosPorNivel: 5 }
];

let currentUser = null;
let targetUid = null;
let workspace = null;
let workspaceOwner = null;
let allUsers = [];
let pendingTransferCreatureId = null;
let accessMode = 'owner';

const qp = (name) => new URLSearchParams(window.location.search).get(name);
const clone = (value) => JSON.parse(JSON.stringify(value));
const closeModal = (modal) => { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); };
const openModal = (modal) => { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); };
const canManageWorkspace = () => accessMode === 'owner' || accessMode === 'admin';

function ensureWorkspaceShape(data) {
  return {
    ownerUid: targetUid,
    ownerName: data?.ownerName || workspaceOwner?.displayName || '',
    ownerEmail: data?.ownerEmail || workspaceOwner?.email || '',
    sheetStore: data?.sheetStore || null,
    creatures: Array.isArray(data?.creatures) ? data.creatures : [],
    sharedViewers: normalizeSharedViewers(data?.sharedViewers),
    sharedViewerUids: Array.isArray(data?.sharedViewerUids) ? data.sharedViewerUids : normalizeSharedViewers(data?.sharedViewers).map((item) => item.uid)
  };
}

function creatureTemplate(key) {
  return TEMPLATES.find((item) => item.key === key) || TEMPLATES[0];
}

async function loadUsers() {
  allUsers = await listAllUsers();
  transferTargetUser.innerHTML = allUsers
    .filter((user) => user.uid !== targetUid)
    .map((user) => `<option value="${user.uid}">${user.name || 'Sem nome'} • ${user.email || 'Sem e-mail'}</option>`)
    .join('');
  if (shareTargetUser) {
    shareTargetUser.innerHTML = allUsers
      .filter((user) => user.uid !== targetUid)
      .map((user) => `<option value="${user.uid}">${user.name || 'Sem nome'} • ${user.email || 'Sem e-mail'}</option>`)
      .join('');
  }
}

function viewerLinkBase() {
  return `./dashboard.html?uid=${encodeURIComponent(targetUid)}&view=1`;
}

function renderSharedViewers() {
  if (!sharedViewerList) return;
  sharedViewerList.innerHTML = '';
  const viewers = normalizeSharedViewers(workspace.sharedViewers);
  if (!viewers.length) {
    sharedViewerList.innerHTML = '<div class="notice">Nenhum usuário com acesso de visualização.</div>';
    return;
  }
  viewers.forEach((viewer) => {
    const item = document.createElement('div');
    item.className = 'card-mini';
    item.innerHTML = `
      <h2>${viewer.name || 'Sem nome'}</h2>
      <div class="meta-stack">
        <div><strong>E-mail:</strong> ${viewer.email || 'Sem e-mail'}</div>
        <div><strong>Link base:</strong> ${viewerLinkBase()}</div>
      </div>
      <div class="card-actions">
        <button type="button" data-remove-share>Remover acesso</button>
      </div>
    `;
    item.querySelector('[data-remove-share]').disabled = !canManageWorkspace();
    item.querySelector('[data-remove-share]').addEventListener('click', async () => {
      if (!canManageWorkspace()) return;
      workspace.sharedViewers = normalizeSharedViewers(workspace.sharedViewers).filter((entry) => entry.uid !== viewer.uid);
      workspace.sharedViewerUids = workspace.sharedViewers.map((entry) => entry.uid);
      await saveWorkspace(targetUid, {
        sharedViewers: clone(workspace.sharedViewers),
        sharedViewerUids: clone(workspace.sharedViewerUids)
      });
      renderSharedViewers();
      statusEl.textContent = 'Acesso removido.';
    });
    sharedViewerList.appendChild(item);
  });
}

function renderCards() {
  const isAdmin = accessMode === 'admin';
  const isReadOnly = accessMode === 'viewer';
  cardsEl.innerHTML = '';

  const player = document.createElement('div');
  player.className = 'card-mini';
  player.innerHTML = `
    <h2>Minha ficha</h2>
    <div class="meta-stack">
      <div><strong>Jogador:</strong> ${workspace.ownerName || workspaceOwner?.displayName || 'Sem nome'}</div>
      <div><strong>E-mail:</strong> ${workspace.ownerEmail || workspaceOwner?.email || 'Sem e-mail'}</div>
      <div><strong>Criaturas:</strong> ${workspace.creatures.length}</div>
      <div><strong>Modo:</strong> ${isReadOnly ? 'Somente leitura + calculadora' : (isAdmin ? 'Admin' : 'Dono')}</div>
    </div>
    <div class="card-actions"><button type="button" data-open-sheet>Abrir ficha</button></div>
  `;
  player.querySelector('[data-open-sheet]').addEventListener('click', () => {
    const qs = new URLSearchParams({ uid: targetUid });
    if (accessMode === 'admin') qs.set('admin', '1');
    if (accessMode === 'viewer') qs.set('view', '1');
    window.location.href = `./ficha.html?${qs.toString()}`;
  });
  cardsEl.appendChild(player);

  workspace.creatures.forEach((creature) => {
    const card = document.createElement('div');
    card.className = 'card-mini';
    card.innerHTML = `
      <h2>${creature.nome || 'Criatura sem nome'}</h2>
      <div class="meta-stack">
        <div><strong>Espécie:</strong> ${creature.especie || 'Sem espécie'}</div>
        <div><strong>Nível:</strong> ${creature.nivel || 1}</div>
        <div><strong>Dono:</strong> ${creature.ownerName || workspace.ownerName || 'Sem dono'}</div>
      </div>
      <div class="card-actions">
        <button type="button" data-open>Abrir ficha</button>
        <button type="button" data-transfer>Transferir</button>
        <button type="button" data-delete>Apagar</button>
      </div>
    `;

    card.querySelector('[data-open]').addEventListener('click', () => {
      const qs = new URLSearchParams({ uid: targetUid, cid: creature.id });
      if (accessMode === 'admin') qs.set('admin', '1');
      if (accessMode === 'viewer') qs.set('view', '1');
      window.location.href = `./criatura.html?${qs.toString()}`;
    });

    const canManageCreature = canManageWorkspace() || currentUser.uid === creature.ownerUid;
    card.querySelector('[data-transfer]').disabled = !canManageCreature;
    card.querySelector('[data-delete]').disabled = !canManageCreature;

    card.querySelector('[data-transfer]').addEventListener('click', () => {
      if (!canManageCreature) return;
      pendingTransferCreatureId = creature.id;
      openModal(transferModal);
    });

    card.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!canManageCreature) return;
      if (!confirm(`Apagar a criatura ${creature.nome || 'sem nome'}?`)) return;
      workspace.creatures = workspace.creatures.filter((item) => item.id !== creature.id);
      await saveWorkspace(targetUid, { creatures: clone(workspace.creatures) });
      renderCards();
      statusEl.textContent = 'Criatura apagada.';
    });

    cardsEl.appendChild(card);
  });

  const add = document.createElement('div');
  add.className = 'card-mini card-accent';
  add.innerHTML = `
    <h2>Nova criatura</h2>
    <div class="meta-stack">
      <div>Criação por template com valores base automáticos.</div>
      <div>Depois disso, o dono distribui pontos com o botão +.</div>
      <div>${isReadOnly ? 'Modo visualização: criação bloqueada.' : 'Criação liberada para dono e admin.'}</div>
    </div>
    <div class="card-actions"><button type="button" data-new>Criar criatura</button></div>
  `;
  add.querySelector('[data-new]').disabled = !canManageWorkspace();
  add.querySelector('[data-new]').addEventListener('click', () => {
    if (!canManageWorkspace()) return;
    openModal(createModal);
  });
  cardsEl.appendChild(add);
}

async function createCreature() {
  if (!canManageWorkspace()) return;
  const name = document.getElementById('newCreatureName').value.trim();
  const template = creatureTemplate(templateSelect.value);
  const id = `criatura_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const creature = {
    id,
    nome: name || template.label,
    especie: template.label,
    ownerUid: targetUid,
    ownerName: workspace.ownerName || workspaceOwner?.displayName || '',
    ownerEmail: workspace.ownerEmail || workspaceOwner?.email || '',
    nivel: 1,
    baseVida: template.baseVida,
    baseDano: template.baseDano,
    baseMovimento: template.baseMovimento,
    basePeso: template.basePeso,
    pontosPorNivel: template.pontosPorNivel,
    bonusPontos: 0,
    stats: { forca: 0, constituicao: 0, destreza: 0, inteligencia: 0, sabedoria: 0, carisma: 0, peso: 0, resistencia: 0 },
    current: { vidaAtual: template.baseVida, torporAtual: 0, staminaAtual: 100 },
    notes: '',
    adminNotas: ''
  };
  workspace.creatures.push(creature);
  await saveWorkspace(targetUid, { creatures: clone(workspace.creatures) });
  closeModal(createModal);
  document.getElementById('newCreatureName').value = '';
  renderCards();
  statusEl.textContent = 'Criatura criada com sucesso.';
}

async function transferCreature() {
  const newUid = transferTargetUser.value;
  if (!pendingTransferCreatureId || !newUid) return;
  const creature = workspace.creatures.find((item) => item.id === pendingTransferCreatureId);
  if (!creature) return;
  const targetUser = allUsers.find((item) => item.uid === newUid);
  const raw = await getWorkspace(newUid);
  const targetWorkspace = {
    ownerUid: newUid,
    ownerName: raw?.ownerName || targetUser?.name || '',
    ownerEmail: raw?.ownerEmail || targetUser?.email || '',
    creatures: Array.isArray(raw?.creatures) ? raw.creatures : []
  };
  workspace.creatures = workspace.creatures.filter((item) => item.id !== pendingTransferCreatureId);
  creature.ownerUid = newUid;
  creature.ownerName = targetUser?.name || '';
  creature.ownerEmail = targetUser?.email || '';
  targetWorkspace.creatures.push(creature);
  await saveWorkspace(targetUid, { creatures: clone(workspace.creatures) });
  await saveWorkspace(newUid, {
    ownerUid: newUid,
    ownerName: targetWorkspace.ownerName,
    ownerEmail: targetWorkspace.ownerEmail,
    creatures: clone(targetWorkspace.creatures)
  });
  pendingTransferCreatureId = null;
  closeModal(transferModal);
  renderCards();
  statusEl.textContent = 'Criatura transferida.';
}

async function addSharedViewer() {
  if (!canManageWorkspace()) return;
  const uid = shareTargetUser.value;
  if (!uid) return;
  const user = allUsers.find((item) => item.uid === uid);
  if (!user) return;
  const current = normalizeSharedViewers(workspace.sharedViewers);
  if (current.some((item) => item.uid === uid)) {
    statusEl.textContent = 'Esse usuário já possui acesso.';
    return;
  }
  current.push({ uid: user.uid, name: user.name || '', email: user.email || '' });
  workspace.sharedViewers = normalizeSharedViewers(current);
  workspace.sharedViewerUids = workspace.sharedViewers.map((item) => item.uid);
  await saveWorkspace(targetUid, {
    sharedViewers: clone(workspace.sharedViewers),
    sharedViewerUids: clone(workspace.sharedViewerUids)
  });
  renderSharedViewers();
  statusEl.textContent = 'Acesso de visualização liberado.';
}

async function init() {
  currentUser = await waitForAuth();
  if (!currentUser) {
    window.location.href = '../index.html';
    return;
  }

  await upsertUserProfile(currentUser);
  const admin = isAdminUser(currentUser);
  const requestedUid = qp('uid');
  targetUid = admin && requestedUid ? requestedUid : (requestedUid || currentUser.uid);

  const raw = await getWorkspace(targetUid);
  if (!raw && targetUid !== currentUser.uid && !admin) {
    window.location.href = './dashboard.html';
    return;
  }

  workspaceOwner = targetUid === currentUser.uid ? currentUser : { displayName: raw?.ownerName || 'Usuário', email: raw?.ownerEmail || '' };
  workspace = ensureWorkspaceShape(raw);

  if (admin && targetUid !== currentUser.uid) {
    accessMode = 'admin';
  } else if (targetUid === currentUser.uid) {
    accessMode = 'owner';
  } else if (userCanViewWorkspace(currentUser, workspace)) {
    accessMode = 'viewer';
  } else {
    window.location.href = './dashboard.html';
    return;
  }

  subtitleEl.textContent = accessMode === 'admin'
    ? `Admin visualizando o dashboard de ${workspace.ownerName || workspace.ownerEmail || targetUid}`
    : accessMode === 'viewer'
      ? `Visualização compartilhada de ${workspace.ownerName || workspace.ownerEmail || targetUid}`
      : `Dashboard de ${workspace.ownerName || currentUser.displayName || 'Jogador'}`;

  statusEl.textContent = `Workspace pronto. ${workspace.creatures.length} criatura(s) encontrada(s).`;
  templateSelect.innerHTML = TEMPLATES.map((item) => `<option value="${item.key}">${item.label}</option>`).join('');
  await loadUsers();
  renderCards();
  renderSharedViewers();

  document.getElementById('goHomeBtn').addEventListener('click', () => window.location.href = '../index.html');
  document.getElementById('goPlayerSheetBtn').addEventListener('click', () => {
    const qs = new URLSearchParams({ uid: targetUid });
    if (accessMode === 'admin') qs.set('admin', '1');
    if (accessMode === 'viewer') qs.set('view', '1');
    window.location.href = `./ficha.html?${qs.toString()}`;
  });
  document.getElementById('goAdminBtn').style.display = admin ? 'inline-block' : 'none';
  document.getElementById('goAdminBtn').addEventListener('click', () => window.location.href = './admin.html');
  document.getElementById('logoutBtn').addEventListener('click', async () => { await logout(); window.location.href = '../index.html'; });

  if (manageShareBtn) {
    manageShareBtn.style.display = canManageWorkspace() ? 'inline-block' : 'none';
    manageShareBtn.addEventListener('click', () => {
      renderSharedViewers();
      openModal(shareModal);
    });
  }

  document.getElementById('cancelCreateCreatureBtn').addEventListener('click', () => closeModal(createModal));
  document.getElementById('confirmCreateCreatureBtn').addEventListener('click', createCreature);
  document.getElementById('cancelTransferCreatureBtn').addEventListener('click', () => {
    pendingTransferCreatureId = null;
    closeModal(transferModal);
  });
  document.getElementById('confirmTransferCreatureBtn').addEventListener('click', transferCreature);
  document.getElementById('cancelShareWorkspaceBtn')?.addEventListener('click', () => closeModal(shareModal));
  document.getElementById('addShareWorkspaceBtn')?.addEventListener('click', addSharedViewer);

  [createModal, transferModal, shareModal].forEach((modal) => {
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });
}

init();
