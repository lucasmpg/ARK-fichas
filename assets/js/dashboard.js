import {
  logout,
  isAdminUser,
  getWorkspace,
  saveWorkspace,
  upsertUserProfile,
  listAllUsers,
  waitForAuth
} from "./firebase-config.js";

const statusEl = document.getElementById('dashboardStatus');
const subtitleEl = document.getElementById('dashboardSubtitle');
const cardsEl = document.getElementById('dashboardCards');
const createModal = document.getElementById('createCreatureModal');
const transferModal = document.getElementById('transferCreatureModal');
const templateSelect = document.getElementById('newCreatureTemplate');
const transferTargetUser = document.getElementById('transferTargetUser');

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
const closeModal = (modal) => { if (!modal) return; modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); closeAllCustomSelects(); };
const openModal = (modal) => { if (!modal) return; modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); };

function closeAllCustomSelects(exceptSelect = null) {
  document.querySelectorAll('.custom-select.open').forEach((host) => {
    const nativeSelect = host.querySelector('select');
    if (!exceptSelect || nativeSelect !== exceptSelect) host.classList.remove('open');
  });
}

function refreshCustomSelect(select) {
  if (!select) return;
  const host = select.closest('.custom-select');
  if (!host) return;
  const trigger = host.querySelector('.custom-select-trigger');
  const menu = host.querySelector('.custom-select-menu');
  if (!trigger || !menu) return;

  const placeholder = select.dataset.placeholder || 'Selecione';
  const options = [...select.options];
  const selectedOption = options.find((option) => option.value === select.value) || options[0] || null;

  trigger.textContent = selectedOption ? selectedOption.textContent : placeholder;
  menu.innerHTML = '';

  options.forEach((option) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'custom-select-option';
    if (option.value === select.value) item.classList.add('active');
    item.textContent = option.textContent || placeholder;
    item.disabled = option.disabled;
    item.addEventListener('click', () => {
      select.value = option.value;
      refreshCustomSelect(select);
      host.classList.remove('open');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    menu.appendChild(item);
  });
}

function initCustomSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const host = select.closest('.custom-select');
  if (!host || host.dataset.bound === '1') {
    refreshCustomSelect(select);
    return;
  }
  const trigger = host.querySelector('.custom-select-trigger');
  host.dataset.bound = '1';

  trigger?.addEventListener('click', (event) => {
    event.preventDefault();
    const willOpen = !host.classList.contains('open');
    closeAllCustomSelects(select);
    if (willOpen) host.classList.add('open');
  });

  select.addEventListener('change', () => refreshCustomSelect(select));
  refreshCustomSelect(select);
}

const canManageWorkspace = () => accessMode === 'owner' || accessMode === 'admin';

function ensureWorkspaceShape(data) {
  return {
    ownerUid: targetUid,
    ownerName: data?.ownerName || workspaceOwner?.displayName || '',
    ownerEmail: data?.ownerEmail || workspaceOwner?.email || '',
    sheetStore: data?.sheetStore || null,
    creatures: Array.isArray(data?.creatures) ? data.creatures : [],
    sharedViewerUids: Array.isArray(data?.sharedViewerUids) ? data.sharedViewerUids : []
  };
}

function creatureTemplate(key) {
  return TEMPLATES.find((item) => item.key === key) || TEMPLATES[0];
}

function computeWorkspaceSharedViewerUids(creatures) {
  const set = new Set();
  (creatures || []).forEach((creature) => {
    (creature.sharedViewers || []).forEach((viewer) => {
      const uid = String(viewer?.uid || '').trim();
      if (uid) set.add(uid);
    });
  });
  return [...set];
}

async function loadUsers() {
  allUsers = await listAllUsers();
  transferTargetUser.innerHTML = allUsers
    .filter((user) => user.uid !== targetUid)
    .map((user) => `<option value="${user.uid}">${user.name || 'Sem nome'} • ${user.email || 'Sem e-mail'}</option>`)
    .join('');
  initCustomSelect('transferTargetUser');
}

function renderCards() {
  const isAdmin = accessMode === 'admin';
  cardsEl.innerHTML = '';

  const player = document.createElement('div');
  player.className = 'card-mini';
  const playerQs = new URLSearchParams({ uid: targetUid });
  if (accessMode === 'admin') playerQs.set('admin', '1');
  player.innerHTML = `
    <h2>Minha ficha</h2>
    <div class="meta-stack">
      <div><strong>Jogador:</strong> ${workspace.ownerName || workspaceOwner?.displayName || 'Sem nome'}</div>
      <div><strong>E-mail:</strong> ${workspace.ownerEmail || workspaceOwner?.email || 'Sem e-mail'}</div>
      <div><strong>Criaturas:</strong> ${workspace.creatures.length}</div>
      <div><strong>Modo:</strong> ${isAdmin ? 'Admin' : 'Dono'}</div>
    </div>
    <div class="card-actions"><a class="card-action-link" data-open-sheet href="./ficha.html?${playerQs.toString()}">Abrir ficha</a></div>
  `;
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
        <a class="card-action-link" data-open href="./criatura.html?${(() => { const qs = new URLSearchParams({ uid: targetUid, cid: creature.id }); if (accessMode === 'admin') qs.set('admin', '1'); return qs.toString(); })()}">Abrir ficha</a>
        <button type="button" data-transfer>Transferir</button>
        <button type="button" data-delete>Apagar</button>
      </div>
    `;

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
      if (!window.confirm(`Apagar a criatura ${creature.nome || 'sem nome'}?`)) return;
      workspace.creatures = workspace.creatures.filter((item) => item.id !== creature.id);
      workspace.sharedViewerUids = computeWorkspaceSharedViewerUids(workspace.creatures);
      await saveWorkspace(targetUid, { creatures: clone(workspace.creatures), sharedViewerUids: clone(workspace.sharedViewerUids) });
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
      <div>Criação liberada para dono e admin.</div>
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
    inventory: { slotsBase: 5, slotsExtra: 0, items: [] },
    damageScaling: 'forca',
    sharedViewers: [],
    notes: '',
    adminNotas: ''
  };
  workspace.creatures.push(creature);
  workspace.sharedViewerUids = computeWorkspaceSharedViewerUids(workspace.creatures);
  await saveWorkspace(targetUid, { creatures: clone(workspace.creatures), sharedViewerUids: clone(workspace.sharedViewerUids) });
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
    creatures: Array.isArray(raw?.creatures) ? raw.creatures : [],
    sharedViewerUids: Array.isArray(raw?.sharedViewerUids) ? raw.sharedViewerUids : []
  };
  workspace.creatures = workspace.creatures.filter((item) => item.id !== pendingTransferCreatureId);
  creature.ownerUid = newUid;
  creature.ownerName = targetUser?.name || '';
  creature.ownerEmail = targetUser?.email || '';
  targetWorkspace.creatures.push(creature);
  workspace.sharedViewerUids = computeWorkspaceSharedViewerUids(workspace.creatures);
  targetWorkspace.sharedViewerUids = computeWorkspaceSharedViewerUids(targetWorkspace.creatures);
  await saveWorkspace(targetUid, { creatures: clone(workspace.creatures), sharedViewerUids: clone(workspace.sharedViewerUids) });
  await saveWorkspace(newUid, {
    ownerUid: newUid,
    ownerName: targetWorkspace.ownerName,
    ownerEmail: targetWorkspace.ownerEmail,
    creatures: clone(targetWorkspace.creatures),
    sharedViewerUids: clone(targetWorkspace.sharedViewerUids)
  });
  pendingTransferCreatureId = null;
  closeModal(transferModal);
  renderCards();
  statusEl.textContent = 'Criatura transferida.';
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
  targetUid = admin && requestedUid ? requestedUid : currentUser.uid;

  if (!admin && requestedUid && requestedUid !== currentUser.uid) {
    window.location.href = './dashboard.html';
    return;
  }

  const raw = await getWorkspace(targetUid);
  workspaceOwner = targetUid === currentUser.uid ? currentUser : { displayName: raw?.ownerName || 'Usuário', email: raw?.ownerEmail || '' };
  workspace = ensureWorkspaceShape(raw);
  accessMode = admin && targetUid !== currentUser.uid ? 'admin' : 'owner';

  subtitleEl.textContent = accessMode === 'admin'
    ? `Admin visualizando o dashboard de ${workspace.ownerName || workspace.ownerEmail || targetUid}`
    : `Dashboard de ${workspace.ownerName || currentUser.displayName || 'Jogador'}`;

  statusEl.textContent = `Workspace pronto. ${workspace.creatures.length} criatura(s) encontrada(s).`;
  templateSelect.innerHTML = TEMPLATES.map((item) => `<option value="${item.key}">${item.label}</option>`).join('');
  initCustomSelect('newCreatureTemplate');
  await loadUsers();
  renderCards();

  document.getElementById('goHomeBtn').setAttribute('href', '../index.html');
  const topSheetQs = new URLSearchParams({ uid: targetUid });
  if (accessMode === 'admin') topSheetQs.set('admin', '1');
  document.getElementById('goPlayerSheetBtn').setAttribute('href', `./ficha.html?${topSheetQs.toString()}`);
  document.getElementById('goAdminBtn').style.display = admin ? 'inline-flex' : 'none';
  document.getElementById('goAdminBtn').setAttribute('href', './admin.html');
  document.getElementById('logoutBtn').addEventListener('click', async () => { await logout(); window.location.href = '../index.html'; });

  document.getElementById('cancelCreateCreatureBtn').addEventListener('click', () => closeModal(createModal));
  document.getElementById('confirmCreateCreatureBtn').addEventListener('click', createCreature);
  document.getElementById('cancelTransferCreatureBtn').addEventListener('click', () => {
    pendingTransferCreatureId = null;
    closeModal(transferModal);
  });
  document.getElementById('confirmTransferCreatureBtn').addEventListener('click', transferCreature);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.custom-select')) closeAllCustomSelects();
  });

  [createModal, transferModal].forEach((modal) => {
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });
}

init();
