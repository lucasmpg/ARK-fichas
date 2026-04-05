import {
  logout,
  isAdminUser,
  getWorkspace,
  saveWorkspace,
  upsertUserProfile,
  waitForAuth,
  listAllUsers
} from "./firebase-config.js";

const attrs = [
  { id: 'forca', nome: 'Força', sub: '+2% dano físico / ponto' },
  { id: 'constituicao', nome: 'Constituição', sub: '+10 HP / ponto' },
  { id: 'destreza', nome: 'Destreza', sub: 'movimento, esquiva e distância' },
  { id: 'inteligencia', nome: 'Inteligência', sub: 'crafting' },
  { id: 'sabedoria', nome: 'Sabedoria', sub: 'percepção e oxigênio' },
  { id: 'carisma', nome: 'Carisma', sub: 'bônus narrativo' },
  { id: 'peso', nome: 'Peso', sub: '+10 kg / ponto' },
  { id: 'resistencia', nome: 'Resistência', sub: 'stamina e regen' }
];

let currentUser = null;
let workspaceUid = null;
let creatureId = null;
let workspace = null;
let creature = null;
let canEdit = false;
let canAdminEdit = false;
let isViewerMode = false;
let skipPointConfirmation = false;
let pendingAttributeIncrement = null;
let allUsers = [];

const qp = (name) => new URLSearchParams(window.location.search).get(name);
const byId = (id) => document.getElementById(id);
const num = (id) => parseFloat(byId(id)?.value || 0) || 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clone = (value) => JSON.parse(JSON.stringify(value));
const feedbackTimers = {};
function showActionFeedback(id, text) {
  const el = byId(id);
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(feedbackTimers[id]);
  feedbackTimers[id] = setTimeout(() => {
    el.classList.remove('show');
    el.textContent = '';
  }, 5000);
}
const closeModal = (modal) => { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); closeAllCustomSelects(); };
const openModal = (modal) => { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); };

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
  const select = byId ? byId(selectId) : document.getElementById(selectId);
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


const normalizeSharedViewers = (value) => Array.isArray(value) ? value.filter((item, index, arr) => item && item.uid && arr.findIndex((x) => x.uid === item.uid) === index) : [];
const creatureCanView = (user, currentCreature) => !!(user && currentCreature && normalizeSharedViewers(currentCreature.sharedViewers).some((item) => item.uid === user.uid));
function computeWorkspaceSharedViewerUids() {
  const set = new Set();
  (workspace?.creatures || []).forEach((item) => normalizeSharedViewers(item.sharedViewers).forEach((viewer) => set.add(viewer.uid)));
  return [...set];
}
let currentInventorySlots = 0;
function inventoryKey(slot, field) { return `creature_inventory_${slot}_${field}`; }
function inventorySlotCount() { return Math.max(0, Math.round(num('inventorySlotsBase')) || 0); }
function createInventoryRows(force=false) {
  const totalSlots = inventorySlotCount();
  const body = byId('creatureInventoryBody');
  if (!body) return;
  if (!force && totalSlots === currentInventorySlots) return;
  currentInventorySlots = totalSlots;
  const previous = {};
  body.querySelectorAll('[data-creature-inventory]').forEach((el) => { previous[el.dataset.key] = el.value; });
  body.innerHTML = '';
  for (let i = 1; i <= totalSlots; i += 1) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="slot-badge">${i}</span></td><td><input data-creature-inventory data-key="${inventoryKey(i,'desc')}" id="${inventoryKey(i,'desc')}" placeholder="Nome do item" /></td><td><input data-creature-inventory data-key="${inventoryKey(i,'qty')}" id="${inventoryKey(i,'qty')}" type="number" min="0" step="1" value="0" /></td><td><input data-creature-inventory data-key="${inventoryKey(i,'unit')}" id="${inventoryKey(i,'unit')}" type="number" min="0" step="0.01" value="0" /></td><td><input id="${inventoryKey(i,'total')}" readonly /></td>`;
    body.appendChild(tr);
  }
  Object.entries(previous).forEach(([key, value]) => { const el = byId(key); if (el) el.value = value; });
}
function inventoryTotals() {
  const totalSlots = inventorySlotCount();
  let used = 0;
  let totalWeight = 0;
  for (let i = 1; i <= totalSlots; i += 1) {
    const desc = byId(inventoryKey(i,'desc'))?.value?.trim() || '';
    const qty = Math.max(0, parseFloat(byId(inventoryKey(i,'qty'))?.value || 0) || 0);
    const unit = Math.max(0, parseFloat(byId(inventoryKey(i,'unit'))?.value || 0) || 0);
    const line = qty * unit;
    const totalInput = byId(inventoryKey(i,'total'));
    if (totalInput) totalInput.value = line.toFixed(2).replace(/\.00$/, '');
    if (desc) used += 1;
    totalWeight += line;
  }
  return { totalSlots, used, free: Math.max(0, totalSlots - used), totalWeight };
}

function ensureWorkspaceShape(data) {
  return {
    ownerUid: workspaceUid,
    ownerName: data?.ownerName || '',
    ownerEmail: data?.ownerEmail || '',
    sharedViewers: Array.isArray(data?.sharedViewers) ? data.sharedViewers : [],
    sharedViewerUids: Array.isArray(data?.sharedViewerUids) ? data.sharedViewerUids : [],
    creatures: Array.isArray(data?.creatures) ? data.creatures : []
  };
}

function attrCost(value) {
  let total = 0;
  for (let i = 1; i <= value; i += 1) total += i > 80 ? 3 : i > 50 ? 2 : 1;
  return total;
}

function d20Multiplier(roll) {
  if (roll >= 20) return 2;
  if (roll >= 18) return 1.5;
  if (roll >= 11) return 1;
  if (roll >= 4) return 0.5;
  return 0.3;
}

function saveCreatureToWorkspace() {
  if (!workspace || !creature) return;
  creature.nome = byId('nome').value.trim();
  creature.especie = byId('especie').value.trim();
  creature.nivel = Math.max(1, Math.round(num('nivel')) || 1);
  creature.baseVida = Math.max(0, num('baseVida'));
  creature.baseDano = Math.max(0, num('baseDano'));
  creature.baseMovimento = Math.max(0, num('baseMovimento'));
  creature.basePeso = Math.max(0, num('basePeso'));
  creature.sexo = byId('sexo').value.trim();
  creature.pontosPorNivel = Math.max(0, num('pontosPorNivel'));
  creature.bonusPontos = num('bonusPontos');
  creature.danoEscalaAttr = byId('danoEscalaAttr')?.value || creature.danoEscalaAttr || 'forca';
  creature.stats = creature.stats || {};
  attrs.forEach((attr) => { creature.stats[attr.id] = clamp(Math.round(num(attr.id)), 0, 100); });
  creature.inventory = creature.inventory || { slotsBase: 5, items: [] };
  creature.inventory.slotsBase = Math.max(0, Math.round(num('inventorySlotsBase')) || 0);
  creature.inventory.items = [];
  for (let i = 1; i <= inventorySlotCount(); i += 1) {
    creature.inventory.items.push({
      desc: byId(inventoryKey(i,'desc'))?.value || '',
      qty: parseFloat(byId(inventoryKey(i,'qty'))?.value || 0) || 0,
      unit: parseFloat(byId(inventoryKey(i,'unit'))?.value || 0) || 0
    });
  }
  creature.sharedViewers = normalizeSharedViewers(creature.sharedViewers);
  creature.current = {
    vidaAtual: clamp(num('vidaAtual'), 0, Math.max(0, parseFloat(byId('vidaAtualMax').value || 0))),
    torporAtual: clamp(num('torporAtual'), 0, Math.max(0, parseFloat(byId('torporAtualMax').value || 0))),
    staminaAtual: clamp(num('staminaAtual'), 0, Math.max(0, parseFloat(byId('staminaAtualMax').value || 0)))
  };
  creature.notes = byId('notas').value;
  creature.adminNotas = byId('adminNotas').value;
}

async function persistCreature() {
  if (!canEdit && !canAdminEdit) return;
  saveCreatureToWorkspace();
  workspace.creatures = workspace.creatures.map((item) => (item.id === creature.id ? creature : item));
  workspace.sharedViewerUids = computeWorkspaceSharedViewerUids();
  await saveWorkspace(workspaceUid, { creatures: clone(workspace.creatures), sharedViewerUids: clone(workspace.sharedViewerUids) });
}

function renderAttributeCards() {
  const host = byId('creatureAttributes');
  host.innerHTML = '';
  attrs.forEach((attr) => {
    const box = document.createElement('div');
    box.className = 'attr';
    box.innerHTML = `
      <div class="attr-head attr-head-center"><strong>${attr.nome}</strong><div class="attr-sub">${attr.sub}</div></div>
      <div class="attr-input-wrap">
        <button type="button" class="attr-step-btn attr-minus-btn" data-action="minus" data-attr="${attr.id}">−</button>
        <input id="${attr.id}" class="attr-input" type="number" min="0" max="100" value="0" />
        <button type="button" class="attr-step-btn attr-plus-btn" data-action="plus" data-attr="${attr.id}">+</button>
      </div>
      <div class="mini"><div><label>Custo total</label><input id="${attr.id}Cost" readonly /></div><div><label>Bônus</label><input id="${attr.id}Info" readonly /></div></div>
    `;
    host.appendChild(box);
  });
}

function applyCreatureToForm() {
  byId('nome').value = creature.nome || '';
  byId('especie').value = creature.especie || '';
  byId('donoNome').value = creature.ownerName || workspace.ownerName || '';
  byId('sexo').value = creature.sexo || '';
  byId('nivel').value = creature.nivel || 1;
  byId('baseVida').value = creature.baseVida ?? 100;
  byId('baseDano').value = creature.baseDano ?? 0;
  byId('baseMovimento').value = creature.baseMovimento ?? 5;
  byId('basePeso').value = creature.basePeso ?? 50;
  byId('pontosPorNivel').value = creature.pontosPorNivel ?? 5;
  byId('bonusPontos').value = creature.bonusPontos ?? 0;
  if (byId('danoEscalaAttr')) byId('danoEscalaAttr').value = creature.danoEscalaAttr || 'forca';
  attrs.forEach((attr) => { byId(attr.id).value = creature.stats?.[attr.id] ?? 0; });
  byId('vidaAtual').value = creature.current?.vidaAtual ?? creature.baseVida ?? 100;
  byId('torporAtual').value = creature.current?.torporAtual ?? 0;
  byId('staminaAtual').value = creature.current?.staminaAtual ?? 100;
  byId('notas').value = creature.notes || '';
  byId('adminNotas').value = creature.adminNotas || '';
  byId('inventorySlotsBase').value = creature.inventory?.slotsBase || 5;
  createInventoryRows(true);
  const items = Array.isArray(creature.inventory?.items) ? creature.inventory.items : [];
  items.forEach((item, index) => {
    const slot = index + 1;
    const desc = byId(inventoryKey(slot,'desc')); if (desc) desc.value = item.desc || '';
    const qty = byId(inventoryKey(slot,'qty')); if (qty) qty.value = item.qty ?? 0;
    const unit = byId(inventoryKey(slot,'unit')); if (unit) unit.value = item.unit ?? 0;
  });
}

function remainingPointBudget() {
  const total = Math.max(1, Math.round(num('nivel')) || 1) * Math.max(0, num('pontosPorNivel')) + num('bonusPontos');
  const spent = attrs.reduce((sum, attr) => sum + attrCost(clamp(Math.round(num(attr.id)), 0, 100)), 0);
  return total - spent;
}

function setEditableState() {
  ['especie', 'sexo', 'baseVida', 'baseDano', 'baseMovimento', 'basePeso', 'pontosPorNivel', 'bonusPontos'].forEach((id) => {
    byId(id).readOnly = !canAdminEdit;
    byId(id).disabled = !canAdminEdit;
  });
  byId('nome').readOnly = !canEdit;
  byId('sexo').readOnly = !canAdminEdit;
  byId('sexo').disabled = !canAdminEdit;
  byId('nivel').readOnly = !canEdit && !canAdminEdit;
  byId('adminNotas').readOnly = !canAdminEdit;
  byId('notas').readOnly = !canEdit;

  attrs.forEach((attr) => {
    const input = byId(attr.id);
    input.readOnly = !canAdminEdit;
    input.disabled = false;
    input.closest('.attr-input-wrap').querySelector('.attr-minus-btn').style.display = canAdminEdit ? 'inline-flex' : 'none';
    input.closest('.attr-input-wrap').querySelector('.attr-plus-btn').disabled = !canEdit;
  });

  if (!canEdit) {
    document.querySelectorAll('button[data-action="plus"],button[data-action="minus"]').forEach((button) => { button.disabled = true; });
  }

  byId('deleteCreatureBtn').disabled = !canEdit;
  byId('transferCreatureBtn').disabled = !canEdit;
  byId('shareCreatureBtn').style.display = canEdit || canAdminEdit ? 'inline-flex' : 'none';
  byId('inventorySlotsBase').disabled = !canAdminEdit;
  document.querySelectorAll('[data-creature-inventory]').forEach((field) => { field.readOnly = !canEdit && !canAdminEdit; });
  if (isViewerMode) {
    byId('transferCreatureBtn').title = 'Modo compartilhado: somente leitura';
    byId('deleteCreatureBtn').title = 'Modo compartilhado: somente leitura';
  }
}

function openPointConfirm(attrId) {
  pendingAttributeIncrement = attrId;
  const current = clamp(Math.round(num(attrId)), 0, 100);
  const nextCost = attrCost(current + 1) - attrCost(current);
  byId('pointConfirmText').textContent = `Deseja adicionar 1 ponto em ${attrs.find((attr) => attr.id === attrId)?.nome || attrId}? Este clique consumirá ${nextCost} ponto(s).`;
  byId('skipPointConfirmCheckbox').checked = skipPointConfirmation;
  openModal(byId('pointConfirmModal'));
}

function applyAttributeIncrement(attrId) {
  const current = clamp(Math.round(num(attrId)), 0, 100);
  if (current >= 100) return;
  const nextCost = attrCost(current + 1) - attrCost(current);
  if (!canAdminEdit && remainingPointBudget() < nextCost) {
    alert('Você não tem pontos suficientes para aumentar este atributo.');
    return;
  }
  byId(attrId).value = current + 1;
  updateAll();
}

function applyAttributeDeltaAdmin(attrId, delta) {
  if (!canAdminEdit) return;
  byId(attrId).value = clamp(clamp(Math.round(num(attrId)), 0, 100) + delta, 0, 100);
  updateAll();
}

function updateBars(currentId, max, barId) {
  const current = clamp(num(currentId), 0, Math.max(0, max));
  byId(currentId).value = current;
  byId(barId).style.width = `${max <= 0 ? 0 : clamp((current / max) * 100, 0, 100)}%`;
}

function updateAll() {
  attrs.forEach((attr) => {
    const value = clamp(Math.round(num(attr.id)), 0, 100);
    byId(attr.id).value = value;
    byId(`${attr.id}Cost`).value = attrCost(value);
  });

  const forca = num('forca');
  const constituicao = num('constituicao');
  const destreza = num('destreza');
  const inteligencia = num('inteligencia');
  const sabedoria = num('sabedoria');
  const peso = num('peso');
  const resistencia = num('resistencia');
  const nivel = Math.max(1, Math.round(num('nivel')) || 1);
  const pontosTotais = nivel * Math.max(0, num('pontosPorNivel')) + num('bonusPontos');
  const pontosGastos = attrs.reduce((sum, attr) => sum + attrCost(num(attr.id)), 0);
  const pontosRestantes = pontosTotais - pontosGastos;

  byId('pontosTotais').textContent = pontosTotais;
  byId('pontosGastos').textContent = pontosGastos;
  byId('pontosRestantes').textContent = pontosRestantes;
  byId('pontosStatus').textContent = pontosRestantes < 0 ? 'ultrapassou o limite' : 'disponível';
  byId('pontosStatus').className = pontosRestantes < 0 ? 'sub status-danger' : 'sub status-ok';

  const baseVida = Math.max(0, num('baseVida'));
  const baseDano = Math.max(0, num('baseDano'));
  const baseMovimento = Math.max(0, num('baseMovimento'));
  const basePeso = Math.max(0, num('basePeso'));

  const vidaMax = baseVida + constituicao * 10;
  const torporMax = 100 + constituicao * 5;
  const staminaMax = 100 + resistencia * 10;
  const vidaRegenPct = 2 + Math.floor(constituicao / 10);
  const staminaRegenPct = 5 + Math.floor(resistencia / 10);
  const andar = baseMovimento + Math.floor(destreza / 5) * 1.5;
  const correr = andar * 2;
  const capacidade = basePeso + peso * 10;
  createInventoryRows();
  const inventory = inventoryTotals();
  const pesoAtual = inventory.totalWeight;
  const danoFisicoPercent = forca * 2;
  const danoFisicoTotal = baseDano + Math.round(baseDano * (danoFisicoPercent / 100));
  const danoDistancia = destreza * 2;
  const percepcao = 10 + sabedoria;
  const furtividade = destreza;
  const esquiva = destreza;
  const oxigenio = 60 + sabedoria * 5;

  let andarFinal = andar;
  let correrFinal = correr;
  let pesoPenaltyText = 'sem penalidade';
  const cargaPct = capacidade <= 0 ? 0 : (pesoAtual / capacidade) * 100;
  if (cargaPct > 100) {
    andarFinal = 0;
    correrFinal = 0;
    pesoPenaltyText = 'imóvel por excesso de carga';
  } else if (cargaPct > 80) {
    andarFinal *= 0.7;
    correrFinal *= 0.7;
    pesoPenaltyText = 'deslocamento reduzido em 30% acima de 80% de carga';
  }

  byId('forcaInfo').value = `+${danoFisicoPercent}% dano`;
  byId('constituicaoInfo').value = `HP +${constituicao * 10}`;
  byId('destrezaInfo').value = `mov. e distância +${destreza * 2}%`;
  byId('inteligenciaInfo').value = `criação +${inteligencia * 2}%`;
  byId('sabedoriaInfo').value = `percepção +${sabedoria}`;
  byId('carismaInfo').value = 'bônus narrativo';
  byId('pesoInfo').value = `+${peso * 10} kg`;
  byId('resistenciaInfo').value = `stamina +${resistencia * 10}`;

  byId('vidaMax').textContent = vidaMax;
  byId('vidaRegen').textContent = `regen: ${vidaRegenPct}% por turno`;
  byId('torporMax').textContent = torporMax;
  byId('torporInfo').textContent = 'resistência natural pela constituição';
  byId('staminaMax').textContent = staminaMax;
  byId('staminaRegen').textContent = `regen: ${staminaRegenPct}% por turno`;
  byId('andarVal').textContent = `${andarFinal.toFixed(1).replace('.0', '')} m`;
  byId('correrVal').textContent = `${correrFinal.toFixed(1).replace('.0', '')} m`;
  byId('esquivaVal').textContent = `${esquiva}`;
  byId('furtividadeVal').textContent = `${furtividade}`;
  byId('percepcaoVal').textContent = `${percepcao}`;
  byId('zonaPercepcao').textContent = `zona passiva: ${(percepcao / 2).toFixed(1).replace('.0', '')}`;
  byId('capacidadeVal').textContent = `${capacidade} kg`;
byId('capacidadePesoVisual').value = `${capacidade} kg`;
byId('danoFisicoVal').textContent = `${danoFisicoTotal}`;
  byId('danoDistVal').textContent = `+${danoDistancia}%`;
  byId('oxigenioVal').textContent = `${oxigenio} s`;
  byId('pesoPenalty').textContent = pesoPenaltyText;
  byId('creaturePesoAtual').value = pesoAtual.toFixed(2).replace(/\.00$/, '');
  byId('creaturePesoUso').value = `${cargaPct.toFixed(1)}%`;
  const weightBar = byId('creaturePesoBar');
  if (weightBar) weightBar.style.width = `${Math.min(100, Math.max(0, cargaPct))}%`;
  byId('creatureSlotsTotal').textContent = inventory.totalSlots;
  byId('creatureSlotsUsed').textContent = inventory.used;
  byId('creatureSlotsFree').textContent = inventory.free;
  byId('vidaAtualMax').value = vidaMax;
  byId('torporAtualMax').value = torporMax;
  byId('staminaAtualMax').value = staminaMax;
  updateBars('vidaAtual', vidaMax, 'vidaBar');
  updateBars('torporAtual', torporMax, 'torporBar');
  updateBars('staminaAtual', staminaMax, 'staminaBar');

  const danoEscalaAttr = byId('danoEscalaAttr')?.value || creature?.danoEscalaAttr || 'forca';
  const danoEscalonadoPct = danoEscalaAttr === 'destreza' ? danoDistancia : danoFisicoPercent;
  const rollRaw = String(byId('rolagemD20')?.value || '').trim();
  const roll = rollRaw ? clamp(Math.round(num('rolagemD20')), 1, 20) : null;
  const multiplier = roll == null ? 1 : d20Multiplier(roll);
  const danoBaseRolado = Math.max(0, num('danoBaseRolado'));
  const extraPct = num('bonusPercentualExtra');
  const danoBruto = (danoBaseRolado + baseDano) * (1 + (danoEscalonadoPct + extraPct) / 100) * multiplier;
  byId('multiD20').textContent = roll == null ? '—' : `${Math.round(multiplier * 100)}%`;
  byId('danoBruto').textContent = danoBruto.toFixed(2).replace(/\.00$/, '');
  byId('danoFinal').textContent = danoBruto.toFixed(2).replace(/\.00$/, '');

  const danoRecebidoBruto = Math.max(0, num('danoRecebidoBruto'));
  const reducao = clamp(num('reducaoArmadura'), 0, 100);
  const danoRecebidoFinal = danoRecebidoBruto * (1 - reducao / 100);
  byId('danoRecebidoFinal').value = danoRecebidoFinal.toFixed(2).replace(/\.00$/, '');
  byId('vidaAposDanoRecebido').value = Math.max(0, num('vidaAtual') - danoRecebidoFinal).toFixed(2).replace(/\.00$/, '');
}

async function transferCreature() {
  if (!canEdit) return;
  const newOwnerUid = byId('transferTargetUser').value;
  if (!newOwnerUid) return;
  const targetUser = allUsers.find((user) => user.uid === newOwnerUid);
  const targetRaw = await getWorkspace(newOwnerUid);
  const targetWorkspace = {
    ownerUid: newOwnerUid,
    ownerName: targetRaw?.ownerName || targetUser?.name || '',
    ownerEmail: targetRaw?.ownerEmail || targetUser?.email || '',
    creatures: Array.isArray(targetRaw?.creatures) ? targetRaw.creatures : [],
    sharedViewerUids: Array.isArray(targetRaw?.sharedViewerUids) ? targetRaw.sharedViewerUids : []
  };
  saveCreatureToWorkspace();
  workspace.creatures = workspace.creatures.filter((item) => item.id !== creature.id);
  creature.ownerUid = newOwnerUid;
  creature.ownerName = targetUser?.name || '';
  creature.ownerEmail = targetUser?.email || '';
  targetWorkspace.creatures.push(creature);
  workspace.sharedViewerUids = computeWorkspaceSharedViewerUids();
  await saveWorkspace(workspaceUid, { creatures: clone(workspace.creatures), sharedViewerUids: clone(workspace.sharedViewerUids) });
  await saveWorkspace(newOwnerUid, {
    ownerUid: newOwnerUid,
    ownerName: targetWorkspace.ownerName,
    ownerEmail: targetWorkspace.ownerEmail,
    creatures: clone(targetWorkspace.creatures),
    sharedViewerUids: clone(targetWorkspace.sharedViewerUids)
  });
  window.location.href = './dashboard.html';
}

function goBackToDashboard() {
  const qs = new URLSearchParams({ uid: workspaceUid });
  if (canAdminEdit && workspaceUid !== currentUser.uid) qs.set('admin', '1');
  if (isViewerMode) qs.set('view', '1');
  window.location.href = `./dashboard.html?${qs.toString()}`;
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
  workspaceUid = admin && requestedUid ? requestedUid : (requestedUid || currentUser.uid);
  creatureId = qp('cid');
  if (!creatureId) {
    goBackToDashboard();
    return;
  }

  const raw = await getWorkspace(workspaceUid);
  workspace = ensureWorkspaceShape(raw);
  if (!workspace) { window.location.href = './dashboard.html'; return; }

  creature = workspace.creatures.find((item) => item.id === creatureId);
  if (!creature) {
    alert('Criatura não encontrada.');
    goBackToDashboard();
    return;
  }

  canAdminEdit = admin;
  canEdit = admin || currentUser.uid === creature.ownerUid;
  isViewerMode = !canEdit && creatureCanView(currentUser, creature);
  if (!canEdit && !isViewerMode) { window.location.href = './dashboard.html'; return; }

  renderAttributeCards();
  applyCreatureToForm();
  createInventoryRows(true);
  setEditableState();
  updateAll();

  byId('authStatus').textContent = canAdminEdit && workspaceUid !== currentUser.uid
    ? 'Admin editando criatura'
    : isViewerMode
      ? 'Visualização compartilhada da criatura'
      : 'Ficha da criatura';
  byId('authUserInfo').textContent = `${currentUser.displayName || 'Usuário'} • ${currentUser.email || ''}`;
  byId('goAdminBtn').style.display = admin ? 'inline-block' : 'none';
  byId('goDashboardBtn').setAttribute('href', `./dashboard.html?${new URLSearchParams({ uid: workspaceUid, ...(canAdminEdit && workspaceUid !== currentUser.uid ? { admin: '1' } : {}), ...(isViewerMode ? { view: '1' } : {}) }).toString()}`);
  byId('goAdminBtn').setAttribute('href', './admin.html');
  byId('logoutBtn').addEventListener('click', async () => { await logout(); window.location.href = '../index.html'; });

  document.addEventListener('input', () => {
    updateAll();
    if (canEdit || canAdminEdit) persistCreature();
  });
  document.addEventListener('change', () => {
    updateAll();
    if (canEdit || canAdminEdit) persistCreature();
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !canEdit) return;
    const attrId = button.dataset.attr;
    if (button.dataset.action === 'minus') {
      applyAttributeDeltaAdmin(attrId, -1);
      return;
    }
    if (canAdminEdit) {
      applyAttributeDeltaAdmin(attrId, 1);
      return;
    }
    if (skipPointConfirmation) {
      applyAttributeIncrement(attrId);
      return;
    }
    openPointConfirm(attrId);
  });

  byId('cancelPointConfirmBtn').addEventListener('click', () => {
    pendingAttributeIncrement = null;
    closeModal(byId('pointConfirmModal'));
  });
  byId('confirmPointConfirmBtn').addEventListener('click', () => {
    skipPointConfirmation = !!byId('skipPointConfirmCheckbox').checked;
    if (pendingAttributeIncrement) applyAttributeIncrement(pendingAttributeIncrement);
    pendingAttributeIncrement = null;
    closeModal(byId('pointConfirmModal'));
    persistCreature();
  });

  byId('applyVidaBtn').addEventListener('click', () => {
    byId('vidaAtual').value = clamp(num('vidaAtual') + num('vidaDelta'), 0, parseFloat(byId('vidaAtualMax').value || 0));
    byId('vidaDelta').value = 0;
    updateAll();
    showActionFeedback('creatureVidaFeedback', 'Vida aplicada com sucesso.');
    if (canEdit || canAdminEdit) persistCreature();
  });
  byId('applyTorporBtn').addEventListener('click', () => {
    byId('torporAtual').value = clamp(num('torporAtual') + num('torporDelta'), 0, parseFloat(byId('torporAtualMax').value || 0));
    byId('torporDelta').value = 0;
    updateAll();
    showActionFeedback('creatureTorporFeedback', 'Variação aplicada com sucesso.');
    if (canEdit || canAdminEdit) persistCreature();
  });
  byId('applyStaminaBtn').addEventListener('click', () => {
    byId('staminaAtual').value = clamp(num('staminaAtual') + num('staminaDelta'), 0, parseFloat(byId('staminaAtualMax').value || 0));
    byId('staminaDelta').value = 0;
    updateAll();
    showActionFeedback('creatureStaminaFeedback', 'Stamina aplicada com sucesso.');
    if (canEdit || canAdminEdit) persistCreature();
  });
  byId('recoverHpBtn').addEventListener('click', () => {
    byId('vidaAtual').value = clamp(num('vidaAtual') + Math.round(parseFloat(byId('vidaAtualMax').value || 0) * ((2 + Math.floor(num('constituicao') / 10)) / 100)), 0, parseFloat(byId('vidaAtualMax').value || 0));
    updateAll();
    showActionFeedback('creatureVidaFeedback', 'Vida regenerada com sucesso.');
    if (canEdit || canAdminEdit) persistCreature();
  });
  byId('recoverStaminaBtn').addEventListener('click', () => {
    byId('staminaAtual').value = clamp(num('staminaAtual') + Math.round(parseFloat(byId('staminaAtualMax').value || 0) * ((5 + Math.floor(num('resistencia') / 10)) / 100)), 0, parseFloat(byId('staminaAtualMax').value || 0));
    updateAll();
    showActionFeedback('creatureStaminaFeedback', 'Stamina regenerada com sucesso.');
    if (canEdit || canAdminEdit) persistCreature();
  });
  byId('dropTorporBtn').addEventListener('click', () => {
    byId('torporAtual').value = Math.max(0, num('torporAtual') - Math.round(parseFloat(byId('torporAtualMax').value || 0) * 0.05));
    updateAll();
    showActionFeedback('creatureTorporFeedback', 'Torpor reduzido com sucesso.');
    if (canEdit || canAdminEdit) persistCreature();
  });
  byId('applyReceivedDamageBtn').addEventListener('click', () => {
    byId('vidaAtual').value = Math.max(0, num('vidaAtual') - parseFloat(byId('danoRecebidoFinal').value || 0));
    updateAll();
    showActionFeedback('creatureReceivedDamageFeedback', 'Dano recebido foi aplicado na vida com sucesso.');
    if (canEdit || canAdminEdit) persistCreature();
  });
  byId('applyDamageToTargetBtn').addEventListener('click', () => {
    byId('danoAplicadoAlvo').value = Math.max(0, num('danoAplicadoAlvo') - parseFloat(byId('danoFinal').textContent || 0)).toFixed(2).replace(/\.00$/, '');
    showActionFeedback('creatureTargetDamageFeedback', 'Dano aplicado com sucesso.');
  });

  [['creatureLightAttackBtn', 10, 'leve'], ['creatureMediumAttackBtn', 15, 'médio'], ['creatureHeavyAttackBtn', 25, 'pesado']].forEach(([id, cost, label]) => {
    byId(id)?.addEventListener('click', async () => {
      byId('staminaAtual').value = Math.max(0, num('staminaAtual') - cost);
      updateAll();
      showActionFeedback('creatureAttackFeedback', `Stamina foi reduzida com sucesso no ataque ${label}.`);
      if (canEdit || canAdminEdit) await persistCreature();
    });
  });

  byId('deleteCreatureBtn').addEventListener('click', async () => {
    if (!canEdit) return;
    if (!confirm(`Apagar a criatura ${creature.nome || 'sem nome'}?`)) return;
    workspace.creatures = workspace.creatures.filter((item) => item.id !== creature.id);
    workspace.sharedViewerUids = computeWorkspaceSharedViewerUids();
  await saveWorkspace(workspaceUid, { creatures: clone(workspace.creatures), sharedViewerUids: clone(workspace.sharedViewerUids) });
    goBackToDashboard();
  });

  allUsers = await listAllUsers();
  byId('transferTargetUser').innerHTML = allUsers
    .filter((user) => user.uid !== creature.ownerUid)
    .map((user) => `<option value="${user.uid}">${user.name || 'Sem nome'} • ${user.email || 'Sem e-mail'}</option>`)
    .join('');

  const shareTargetUser = byId('shareTargetUser');
  shareTargetUser.innerHTML = allUsers
    .filter((user) => user.uid !== creature.ownerUid)
    .map((user) => `<option value="${user.uid}">${user.name || 'Sem nome'} • ${user.email || 'Sem e-mail'}</option>`)
    .join('');

  initCustomSelect('transferTargetUser');
  initCustomSelect('shareTargetUser');

  const renderSharedViewers = () => {
    const host = byId('sharedViewerList');
    host.innerHTML = '';
    const viewers = normalizeSharedViewers(creature.sharedViewers);
    if (!viewers.length) { host.innerHTML = '<div class="notice">Nenhum usuário com acesso de visualização.</div>'; return; }
    viewers.forEach((viewer) => {
      const item = document.createElement('div');
      item.className = 'card-mini';
      item.innerHTML = `<h2>${viewer.name || 'Sem nome'}</h2><div class="meta-stack"><div><strong>E-mail:</strong> ${viewer.email || 'Sem e-mail'}</div><div><strong>Link:</strong> ./criatura.html?uid=${encodeURIComponent(workspaceUid)}&cid=${encodeURIComponent(creature.id)}&view=1</div></div><div class="card-actions"><button type="button" data-remove-share>Remover acesso</button></div>`;
      item.querySelector('[data-remove-share]').disabled = !(canEdit || canAdminEdit);
      item.querySelector('[data-remove-share]').addEventListener('click', async () => {
        if (!(canEdit || canAdminEdit)) return;
        creature.sharedViewers = normalizeSharedViewers(creature.sharedViewers).filter((entry) => entry.uid !== viewer.uid);
        updateAll();
        await persistCreature();
        renderSharedViewers();
      });
      host.appendChild(item);
    });
  };
  renderSharedViewers();

  byId('shareCreatureBtn').addEventListener('click', () => { if (canEdit || canAdminEdit) openModal(byId('shareCreatureModal')); });
  byId('cancelShareCreatureBtn').addEventListener('click', () => closeModal(byId('shareCreatureModal')));
  byId('addShareCreatureBtn').addEventListener('click', async () => {
    if (!(canEdit || canAdminEdit)) return;
    const uid = shareTargetUser.value;
    const target = allUsers.find((user) => user.uid === uid);
    if (!target) return;
    creature.sharedViewers = normalizeSharedViewers([...(creature.sharedViewers || []), { uid: target.uid, name: target.name || '', email: target.email || '' }]);
    await persistCreature();
    renderSharedViewers();
    closeModal(byId('shareCreatureModal'));
  });
  byId('transferCreatureBtn').addEventListener('click', () => openModal(byId('transferCreatureModal')));
  byId('cancelTransferCreatureBtn').addEventListener('click', () => closeModal(byId('transferCreatureModal')));
  byId('confirmTransferCreatureBtn').addEventListener('click', transferCreature);
  [byId('pointConfirmModal'), byId('transferCreatureModal'), byId('shareCreatureModal')].forEach((modal) => modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(modal);
  }));
}

init();
