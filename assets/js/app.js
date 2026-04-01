import { auth, logout, isAdminUser, getWorkspace, saveWorkspace, upsertUserProfile } from "./firebase-config.js";
import { requireAuth } from "./auth.js";

const CLOUD_WORKSPACE_VERSION = 1;
let firebaseUser = null;
let targetWorkspaceUid = null;
let remoteWorkspaceSeed = null;
let remoteReady = false;
let suppressCloudSave = false;
let cloudSaveTimer = null;

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

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

function cloneWorkspaceStore(store) {
  return JSON.parse(JSON.stringify(store || { activeId: null, tabs: [] }));
}

function scheduleCloudSave() {
  if (!remoteReady || suppressCloudSave || !firebaseUser || !targetWorkspaceUid) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    try {
      const payload = {
        ownerUid: targetWorkspaceUid,
        ownerEmail: targetWorkspaceUid === firebaseUser.uid ? (firebaseUser.email || '') : (window.__workspaceOwnerEmail || ''),
        ownerName: targetWorkspaceUid === firebaseUser.uid ? (firebaseUser.displayName || '') : (window.__workspaceOwnerName || ''),
        version: CLOUD_WORKSPACE_VERSION,
        sheetStore: cloneWorkspaceStore(sheetStore)
      };
      await saveWorkspace(targetWorkspaceUid, payload);
      const status = document.getElementById('cloudStatus');
      if (status) status.textContent = 'Salvo na nuvem agora';
    } catch (error) {
      console.error(error);
      const status = document.getElementById('cloudStatus');
      if (status) status.textContent = 'Falha ao salvar na nuvem';
    }
  }, 500);
}

async function bootstrapCloud() {
  firebaseUser = await requireAuth();
  await upsertUserProfile(firebaseUser);

  const requestedUid = getQueryParam('uid');
  const admin = isAdminUser(firebaseUser);
  targetWorkspaceUid = admin && requestedUid ? requestedUid : firebaseUser.uid;

  if (!admin && requestedUid && requestedUid !== firebaseUser.uid) {
    window.location.href = './ficha.html';
    return;
  }

  const authStatus = document.getElementById('authStatus');
  const authUserInfo = document.getElementById('authUserInfo');
  const goAdminBtn = document.getElementById('goAdminBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const goHomeBtn = document.getElementById('goHomeBtn');
  const cloudStatus = document.createElement('span');
  cloudStatus.id = 'cloudStatus';
  cloudStatus.className = 'muted';
  cloudStatus.textContent = 'Carregando ficha da nuvem...';
  authUserInfo?.insertAdjacentElement('afterend', cloudStatus);

  if (authStatus) authStatus.textContent = admin && targetWorkspaceUid !== firebaseUser.uid ? 'Editando ficha de outro jogador' : 'Minha ficha';
  if (authUserInfo) authUserInfo.textContent = `${firebaseUser.displayName || 'Usuário'} • ${firebaseUser.email || ''}`;
  if (goAdminBtn) goAdminBtn.style.display = admin ? 'inline-block' : 'none';
  if (logoutBtn) logoutBtn.addEventListener('click', async () => { await logout(); window.location.href = '../index.html'; });
  if (goHomeBtn) goHomeBtn.addEventListener('click', () => window.location.href = '../index.html');
  if (goAdminBtn) goAdminBtn.addEventListener('click', () => window.location.href = './admin.html');

  const workspace = await getWorkspace(targetWorkspaceUid);
  if (workspace?.sheetStore) {
    remoteWorkspaceSeed = cloneWorkspaceStore(workspace.sheetStore);
    window.__workspaceOwnerEmail = workspace.ownerEmail || '';
    window.__workspaceOwnerName = workspace.ownerName || '';
    if (cloudStatus) cloudStatus.textContent = `Última alteração: ${formatDate(workspace.updatedAt)}`;
  } else {
    remoteWorkspaceSeed = null;
    window.__workspaceOwnerEmail = targetWorkspaceUid === firebaseUser.uid ? (firebaseUser.email || '') : '';
    window.__workspaceOwnerName = targetWorkspaceUid === firebaseUser.uid ? (firebaseUser.displayName || '') : '';
    if (cloudStatus) cloudStatus.textContent = 'Primeira ficha: será criada ao salvar';
  }

  remoteReady = true;
}

const STORAGE_KEY = 'ark-rpg-ficha-tabs-v1';
    const LEGACY_STORAGE_KEYS = ['ark-rpg-ficha-v5'];
    const DEFAULT_TAB_NAME = 'Nova ficha';
    let sheetStore = { activeId: null, tabs: [] };
    let pendingCloseTabId = null;

    const closeTabModal = document.getElementById('closeTabModal');
    const closeTabMessage = document.getElementById('closeTabMessage');
    const cancelCloseTabBtn = document.getElementById('cancelCloseTabBtn');
    const confirmCloseTabBtn = document.getElementById('confirmCloseTabBtn');

    const exportModal = document.getElementById('exportModal');
    const importModal = document.getElementById('importModal');
    const replaceImportModal = document.getElementById('replaceImportModal');
    const exportTabsChecklist = document.getElementById('exportTabsChecklist');
    const cancelExportBtn = document.getElementById('cancelExportBtn');
    const confirmExportBtn = document.getElementById('confirmExportBtn');
    const cancelImportBtn = document.getElementById('cancelImportBtn');
    const chooseImportFileBtn = document.getElementById('chooseImportFileBtn');
    const cancelReplaceImportBtn = document.getElementById('cancelReplaceImportBtn');
    const confirmReplaceImportBtn = document.getElementById('confirmReplaceImportBtn');

    let pendingImportMode = 'append';

    function uniqueId() {
      return `ficha_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function defaultTabName(index = 1) {
      return `${DEFAULT_TAB_NAME} ${index}`;
    }

    function makeBlankState() {
      return {};
    }

    function getActiveTab() {
      return sheetStore.tabs.find(tab => tab.id === sheetStore.activeId) || null;
    }

    function persistSheetStore() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sheetStore));
      scheduleCloudSave();
    }

    function normalizeTabName(name, fallbackIndex = 1) {
      const clean = String(name || '').trim();
      return clean || defaultTabName(fallbackIndex);
    }


    function sanitizeFilename(name, fallback = 'ficha_ark_rpg') {
      return (String(name || fallback)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || fallback);
    }

    function buildWorkspaceExport(tabs) {
      return {
        exportType: 'ark-rpg-workspace',
        version: 1,
        activeId: tabs[0]?.id || null,
        tabs: tabs.map((tab, index) => ({
          id: tab.id || uniqueId(),
          name: normalizeTabName(tab.name, index + 1),
          data: { ...makeBlankState(), ...(tab.data || {}) }
        }))
      };
    }

    function downloadJson(filenameBase, payload) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `${sanitizeFilename(filenameBase)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }

    function getSelectedExportTabs() {
      return [...document.querySelectorAll('[data-export-tab]:checked')]
        .map(box => sheetStore.tabs.find(tab => tab.id === box.value))
        .filter(Boolean);
    }

    function renderExportChecklist() {
      if (!exportTabsChecklist) return;
      exportTabsChecklist.innerHTML = '';
      sheetStore.tabs.forEach((tab, index) => {
        const label = document.createElement('label');
        label.className = 'checklist-item';
        label.innerHTML = `
          <input type="checkbox" data-export-tab value="${tab.id}" checked />
          <span>${normalizeTabName(tab.name, index + 1)}</span>
        `;
        exportTabsChecklist.appendChild(label);
      });
      syncExportChecklistState();
    }

    function syncExportChecklistState() {
      const separateMode = document.querySelector('input[name="exportMode"]:checked')?.value === 'selected-separate';
      document.querySelectorAll('.checklist-item').forEach(item => {
        item.classList.toggle('disabled', !separateMode);
      });
      document.querySelectorAll('[data-export-tab]').forEach(box => {
        box.disabled = !separateMode;
      });
    }

    function openModal(modal) {
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal(modal) {
      if (!modal) return;
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }

    function closeAllSecondaryModals() {
      closeModal(exportModal);
      closeModal(importModal);
      closeModal(replaceImportModal);
    }

    function normalizeImportedTabs(parsed, fileName = '') {
      if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
        return parsed.tabs.map((tab, index) => ({
          id: uniqueId(),
          name: normalizeTabName(tab?.name || tab?.data?.nome, index + 1),
          data: { ...makeBlankState(), ...(tab?.data || {}) }
        }));
      }
      const fallbackName = fileName.replace(/\.json$/i, '') || parsed?.nome || defaultTabName(sheetStore.tabs.length + 1);
      return [{
        id: uniqueId(),
        name: normalizeTabName(parsed?.nome || fallbackName, sheetStore.tabs.length + 1),
        data: { ...makeBlankState(), ...(parsed || {}) }
      }];
    }

    function appendImportedTabs(tabs) {
      if (!tabs.length) return;
      saveState();
      tabs.forEach((tab, index) => {
        sheetStore.tabs.push({
          id: uniqueId(),
          name: normalizeTabName(tab.name, sheetStore.tabs.length + 1 + index),
          data: { ...makeBlankState(), ...(tab.data || {}) }
        });
      });
      sheetStore.activeId = sheetStore.tabs[sheetStore.tabs.length - 1].id;
      persistSheetStore();
      renderTabs();
      const active = getActiveTab();
      applyStateToForm(active ? active.data : {});
      createInventoryRows(true);
      updateAll();
    }

    function replaceWorkspaceWithImportedTabs(tabs) {
      if (!tabs.length) return;
      sheetStore = {
        activeId: tabs[0].id,
        tabs: tabs.map((tab, index) => ({
          id: tab.id || uniqueId(),
          name: normalizeTabName(tab.name, index + 1),
          data: { ...makeBlankState(), ...(tab.data || {}) }
        }))
      };
      persistSheetStore();
      renderTabs();
      applyStateToForm(sheetStore.tabs[0].data || {});
      createInventoryRows(true);
      updateAll();
    }

    function captureCurrentState() {
      const data = {};
      document.querySelectorAll('[data-save]').forEach(el => {
        if (el.type === 'checkbox') data[el.id || el.dataset.perk] = el.checked;
        else data[el.id] = el.value;
      });
      return data;
    }

    function resetFormToBlank() {
      document.querySelectorAll('[data-save]').forEach(el => {
        if (el.type === 'checkbox') el.checked = false;
        else if (el.type === 'number') el.value = el.defaultValue || '0';
        else el.value = el.defaultValue || '';
      });
      createInventoryRows(true);
    }

    function applyStateToForm(data = {}) {
      resetFormToBlank();
      document.querySelectorAll('[data-save]').forEach(el => {
        const key = el.id || el.dataset.perk;
        if (!(key in data)) return;
        if (el.type === 'checkbox') el.checked = !!data[key];
        else if (!el.hasAttribute('data-inventory')) el.value = data[key];
      });
      createInventoryRows(true);
      document.querySelectorAll('[data-save][data-inventory]').forEach(el => {
        const key = el.id || el.dataset.perk;
        if (!(key in data)) return;
        el.value = data[key];
      });
    }

    function saveActiveTabState() {
      const active = getActiveTab();
      if (!active) return;
      active.data = captureCurrentState();
      active.name = normalizeTabName(active.data.nome, sheetStore.tabs.indexOf(active) + 1);
      persistSheetStore();
      renderTabs();
    }

    function renderTabs() {
      const bar = byId('tabsBar');
      if (!bar) return;
      bar.innerHTML = '';
      sheetStore.tabs.forEach((tab, index) => {
        const btn = document.createElement('div');
        btn.className = `tab-btn${tab.id === sheetStore.activeId ? ' active' : ''}`;
        btn.dataset.tabId = tab.id;
        btn.innerHTML = `
          <span class="tab-name">${normalizeTabName(tab.name, index + 1)}</span>
          <button type="button" class="tab-close" data-close-tab="${tab.id}" title="Fechar ficha">×</button>
        `;
        bar.appendChild(btn);
      });
    }

    function createTab(initialData = {}, preferredName = '') {
      const tab = {
        id: uniqueId(),
        name: normalizeTabName(preferredName || initialData.nome, sheetStore.tabs.length + 1),
        data: { ...makeBlankState(), ...initialData }
      };
      sheetStore.tabs.push(tab);
      sheetStore.activeId = tab.id;
      persistSheetStore();
      renderTabs();
      applyStateToForm(tab.data);
      createInventoryRows(true);
      updateAll();
    }

    function switchTab(tabId) {
      if (tabId === sheetStore.activeId) return;
      saveActiveTabState();
      sheetStore.activeId = tabId;
      const active = getActiveTab();
      if (!active) return;
      persistSheetStore();
      renderTabs();
      applyStateToForm(active.data || {});
      createInventoryRows(true);
      updateAll();
    }

    function openCloseTabModal(tabId) {
      const tab = sheetStore.tabs.find(item => item.id === tabId);
      if (!tab) return;
      pendingCloseTabId = tabId;
      closeTabMessage.innerHTML = `Você tem certeza que quer fechar a aba <strong>${normalizeTabName(tab.name)}</strong>?<br><br>Os dados da aba serão perdidos e não poderão ser recuperados.`;
      closeTabModal.classList.remove('hidden');
      closeTabModal.setAttribute('aria-hidden', 'false');
    }

    function closeCloseTabModal() {
      pendingCloseTabId = null;
      closeTabModal.classList.add('hidden');
      closeTabModal.setAttribute('aria-hidden', 'true');
    }

    function closeTab(tabId) {
      const index = sheetStore.tabs.findIndex(tab => tab.id === tabId);
      if (index === -1) return;
      sheetStore.tabs.splice(index, 1);
      if (!sheetStore.tabs.length) {
        const tab = { id: uniqueId(), name: defaultTabName(1), data: makeBlankState() };
        sheetStore.tabs = [tab];
      }
      if (!sheetStore.tabs.some(tab => tab.id === sheetStore.activeId)) {
        sheetStore.activeId = sheetStore.tabs[Math.max(0, index - 1)].id;
      }
      persistSheetStore();
      renderTabs();
      const active = getActiveTab();
      applyStateToForm(active ? active.data : {});
      createInventoryRows(true);
      updateAll();
    }

    function loadWorkspace() {
      if (remoteWorkspaceSeed && Array.isArray(remoteWorkspaceSeed.tabs) && remoteWorkspaceSeed.tabs.length) {
        sheetStore = cloneWorkspaceStore(remoteWorkspaceSeed);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sheetStore));
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
            sheetStore = parsed;
            if (!sheetStore.tabs.some(tab => tab.id === sheetStore.activeId)) {
              sheetStore.activeId = sheetStore.tabs[0].id;
            }
            return;
          }
        } catch (e) {}
      }
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacyRaw = localStorage.getItem(legacyKey);
        if (!legacyRaw) continue;
        try {
          const legacyData = JSON.parse(legacyRaw);
          sheetStore = {
            activeId: uniqueId(),
            tabs: []
          };
          sheetStore.tabs.push({ id: sheetStore.activeId, name: normalizeTabName(legacyData.nome, 1), data: legacyData });
          persistSheetStore();
          return;
        } catch (e) {}
      }
      const firstId = uniqueId();
      sheetStore = { activeId: firstId, tabs: [{ id: firstId, name: defaultTabName(1), data: makeBlankState() }] };
      persistSheetStore();
    }

    function hydrateActiveTab() {
      const active = getActiveTab();
      renderTabs();
      applyStateToForm(active ? active.data : {});
    }

    const perkData = {
      forca: [
        { id: 'golpe_firme', nome: 'Golpe Firme', efeito: '+10% de dano em ataques corpo a corpo' },
        { id: 'impacto_pesado', nome: 'Impacto Pesado', efeito: '+10% de dano com armas pesadas' },
        { id: 'derrubar_gigantes', nome: 'Derrubar Gigantes', efeito: '+10% de dano contra criaturas grandes' }
      ],
      destreza: [
        { id: 'passo_leve', nome: 'Passo Leve', efeito: '+1,5 m de movimento' },
        { id: 'reflexo', nome: 'Reflexo', efeito: '+5% redução de dano' },
        { id: 'agilidade', nome: 'Agilidade', efeito: '-10% custo de stamina em ataques leves' }
      ],
      inteligencia: [
        { id: 'oficio_inicial', nome: 'Ofício Inicial', efeito: '+10% velocidade de criação' },
        { id: 'mao_economica', nome: 'Mão Econômica', efeito: '-10% custo de materiais' },
        { id: 'ajuste_mestre', nome: 'Ajuste de Mestre', efeito: '+5% na qualidade de itens' }
      ],
      peso: [
        { id: 'mulinha', nome: 'Mulinha', efeito: '+25 kg de capacidade' },
        { id: 'organizacao_basica', nome: 'Organização Básica', efeito: '-10% em peso dos itens' },
        { id: 'costas_de_ferro', nome: 'Costas de Ferro', efeito: 'Penalidade de movimento só começa em 90%' }
      ],
      resistencia: [
        { id: 'tourinho', nome: 'Tourinho', efeito: '+20 stamina' },
        { id: 'senta_e_respira', nome: 'Senta e Respira', efeito: '+2% regen stamina' },
        { id: 'trabalho_consciente', nome: 'Trabalho Consciente', efeito: '-10% custo de ações' }
      ],
      constituicao: [
        { id: 'corpo_forte', nome: 'Corpo Forte', efeito: '+5% resistência a dano' },
        { id: 'tolerancia_basica', nome: 'Tolerância Básica', efeito: '-10% torpor recebido' }
      ]
    };

    function byId(id) { return document.getElementById(id); }
    function num(id) {
      const v = parseFloat(byId(id).value);
      return Number.isFinite(v) ? v : 0;
    }
    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

    function inventorySlotCount() {
      return 5 + Math.max(0, Math.round(num('peso')));
    }

    function backpackEnabled() {
      const field = byId('mochilaAtiva');
      return !!field && field.value === 'sim';
    }

    function backpackSlotCount() {
      if (!backpackEnabled()) return 0;
      return Math.max(0, Math.round(num('mochilaSlots')));
    }

    function inventoryValueKey(slot, field) {
      return `inventory_${slot}_${field}`;
    }

    function backpackValueKey(slot, field) {
      return `backpack_${slot}_${field}`;
    }

    let currentInventorySlots = 0;
    let currentBackpackSlots = 0;

    function createStorageRows(bodyId, totalSlots, keyBuilder, dataAttr) {
      const body = byId(bodyId);
      if (!body) return;
      const previousValues = {};
      body.querySelectorAll(`[${dataAttr}]`).forEach(el => {
        previousValues[el.dataset.key] = el.value;
      });
      body.innerHTML = '';
      for (let i = 1; i <= totalSlots; i++) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="slot-badge">${i}</span></td>
          <td><input data-save ${dataAttr} data-key="${keyBuilder(i,'desc')}" id="${keyBuilder(i,'desc')}" placeholder="Nome do item" /></td>
          <td><input data-save ${dataAttr} data-key="${keyBuilder(i,'qty')}" id="${keyBuilder(i,'qty')}" type="number" min="0" step="1" value="0" /></td>
          <td><input data-save ${dataAttr} data-key="${keyBuilder(i,'unit')}" id="${keyBuilder(i,'unit')}" type="number" min="0" step="0.01" value="0" /></td>
          <td><input id="${keyBuilder(i,'total')}" readonly /></td>
        `;
        body.appendChild(tr);
      }
      for (const [key, value] of Object.entries(previousValues)) {
        const el = byId(key);
        if (el) el.value = value;
      }
    }

    function createInventoryRows(force = false) {
      const totalSlots = inventorySlotCount();
      if (force || totalSlots !== currentInventorySlots) {
        currentInventorySlots = totalSlots;
        createStorageRows('inventoryBody', totalSlots, inventoryValueKey, 'data-inventory');
      }

      const totalBackpackSlots = backpackSlotCount();
      const mochilaSection = byId('mochilaSection');
      const mochilaSlotsBox = byId('mochilaSlotsBox');
      if (mochilaSection) mochilaSection.style.display = backpackEnabled() ? '' : 'none';
      if (mochilaSlotsBox) mochilaSlotsBox.style.display = backpackEnabled() ? '' : 'none';

      if (force || totalBackpackSlots !== currentBackpackSlots) {
        currentBackpackSlots = totalBackpackSlots;
        createStorageRows('backpackBody', totalBackpackSlots, backpackValueKey, 'data-backpack');
      }
    }

    function collectStorageTotals(totalSlots, keyBuilder) {
      let used = 0;
      let totalWeight = 0;
      for (let i = 1; i <= totalSlots; i++) {
        const descEl = byId(keyBuilder(i,'desc'));
        const qtyEl = byId(keyBuilder(i,'qty'));
        const unitEl = byId(keyBuilder(i,'unit'));
        const totalEl = byId(keyBuilder(i,'total'));
        if (!descEl || !qtyEl || !unitEl || !totalEl) continue;
        const desc = (descEl.value || '').trim();
        const qty = Math.max(0, parseFloat(qtyEl.value) || 0);
        const unit = Math.max(0, parseFloat(unitEl.value) || 0);
        const rowTotal = qty * unit;
        totalEl.value = rowTotal.toFixed(2).replace(/\.00$/, '');
        if (desc) used += 1;
        totalWeight += rowTotal;
      }
      return { used, totalWeight, totalSlots, free: Math.max(0, totalSlots - used) };
    }

    function inventoryTotals() {
      const character = collectStorageTotals(inventorySlotCount(), inventoryValueKey);
      const backpack = backpackEnabled() ? collectStorageTotals(backpackSlotCount(), backpackValueKey) : { used: 0, totalWeight: 0, totalSlots: 0, free: 0 };
      return {
        character,
        backpack,
        used: character.used + backpack.used,
        totalWeight: character.totalWeight + backpack.totalWeight,
        totalSlots: character.totalSlots + backpack.totalSlots,
        free: character.free + backpack.free
      };
    }

    function attrCost(value) {
      let total = 0;
      for (let i = 1; i <= value; i++) {
        total += i > 80 ? 3 : i > 50 ? 2 : 1;
      }
      return total;
    }

    function d20Multiplier(roll) {
      if (roll >= 20) return 2;
      if (roll >= 18) return 1.5;
      if (roll >= 11) return 1;
      if (roll >= 4) return 0.5;
      return 0.3;
    }

    function createPerks() {
      const host = byId('perkGrid');
      const labels = {
        forca: 'Força', destreza: 'Destreza', inteligencia: 'Inteligência', peso: 'Peso', resistencia: 'Resistência', constituicao: 'Constituição'
      };
      host.innerHTML = '';
      for (const [attr, list] of Object.entries(perkData)) {
        const group = document.createElement('div');
        group.className = 'perk-group';
        group.innerHTML = `<div class="attr-head"><strong>${labels[attr]}</strong><span class="pill">requer pelo menos 1 ponto</span></div>`;
        list.forEach(perk => {
          const item = document.createElement('label');
          item.className = 'perk-item';
          item.innerHTML = `
            <input type="checkbox" data-perk="${perk.id}" data-attrreq="${attr}" data-save />
            <div>
              <div class="perk-title">${perk.nome}</div>
              <div class="small">${perk.efeito}</div>
            </div>
          `;
          group.appendChild(item);
        });
        host.appendChild(group);
      }
    }

    function saveState() {
      saveActiveTabState();
    }

    function loadState() {
      loadWorkspace();
      hydrateActiveTab();
    }

    function selectedPerks() {
      return [...document.querySelectorAll('[data-perk]:checked')].map(el => el.dataset.perk);
    }

    function hasPerk(id) {
      return selectedPerks().includes(id);
    }


    function updatePerkLocks() {
      const perkTotal = Math.floor(Math.max(1, Math.round(num('nivel')) || 1) / 5) + num('perkBonus');
      const used = selectedPerks().length;
      const noSlotsLeft = used >= perkTotal;
      document.querySelectorAll('[data-perk]').forEach(box => {
        const attr = box.dataset.attrreq;
        const attrVal = num(attr);
        const attrBlocked = attrVal < 1;
        const slotBlocked = !box.checked && noSlotsLeft;
        box.disabled = attrBlocked || slotBlocked;
        if (attrBlocked) box.checked = false;
      });
    }

    function updateBars(currentId, max, barId, inverse = false) {
      const current = clamp(num(currentId), 0, Math.max(0, max));
      byId(currentId).value = current;
      const pct = max <= 0 ? 0 : (current / max) * 100;
      byId(barId).style.width = `${clamp(pct, 0, 100)}%`;
      if (inverse) byId(barId).style.width = `${clamp(pct, 0, 100)}%`;
    }

    function updateAll() {
      createInventoryRows();
      updatePerkLocks();

      const attrs = ['forca','constituicao','destreza','inteligencia','sabedoria','carisma','peso','resistencia'];
      attrs.forEach(id => {
        let v = clamp(Math.round(num(id)), 0, 100);
        byId(id).value = v;
        byId(id + 'Cost').value = attrCost(v);
      });

      const forca = num('forca');
      const constituicao = num('constituicao');
      const destreza = num('destreza');
      const inteligencia = num('inteligencia');
      const sabedoria = num('sabedoria');
      const peso = num('peso');
      const resistencia = num('resistencia');
      const nivel = Math.max(1, Math.round(num('nivel')) || 1);
      const pontosPorNivel = Math.max(0, num('pontosPorNivel'));
      const bonusPontos = num('bonusPontos');
      const perkBonus = num('perkBonus');

      const pontosTotais = nivel * pontosPorNivel + bonusPontos;
      const custos = attrs.reduce((sum, id) => sum + attrCost(num(id)), 0);
      const pontosRestantes = pontosTotais - custos;
      byId('pontosTotais').textContent = pontosTotais;
      byId('pontosGastos').textContent = custos;
      byId('pontosRestantes').textContent = pontosRestantes;
      byId('pontosStatus').textContent = pontosRestantes < 0 ? 'ultrapassou o limite' : 'disponível';
      byId('pontosStatus').className = pontosRestantes < 0 ? 'sub status-danger' : 'sub status-ok';

      const perkTotal = Math.floor(nivel / 5) + perkBonus;
      const perkUsed = selectedPerks().length;
      const perkLeft = perkTotal - perkUsed;
      byId('perkTotal').textContent = perkTotal;
      byId('perkUsed').textContent = perkUsed;
      byId('perkLeft').textContent = perkLeft;
      byId('perkStatus').textContent = perkLeft < 0 ? 'perks excedidas' : 'disponível';
      byId('perkStatus').className = perkLeft < 0 ? 'sub status-danger' : 'sub status-ok';

      const vidaMax = 100 + constituicao * 10;
      let vidaRegenPct = 2 + Math.floor(constituicao / 10);
      if (hasPerk('corpo_forte')) {}
      const vidaRegenTurno = Math.round(vidaMax * (vidaRegenPct / 100));
      const torporMax = 100 + constituicao * 5;
      let torporResist = Math.floor(constituicao / 10) * 5;
      if (hasPerk('tolerancia_basica')) torporResist += 10;

      let andar = 5 + Math.floor(destreza / 5) * 1.5;
      if (hasPerk('passo_leve')) andar += 1.5;
      let esquivaBase = destreza;
      let furtividade = destreza;

      const percepcao = 10 + sabedoria;
      const zonaPercepcao = percepcao / 2;
      const oxigenio = 60 + sabedoria * 5;

      let capacidade = 50 + peso * 10;
      if (hasPerk('mulinha')) capacidade += 25;

      let staminaMax = 100 + resistencia * 10;
      if (hasPerk('tourinho')) staminaMax += 20;
      let staminaRegenPct = 5 + Math.floor(resistencia / 10);
      if (hasPerk('senta_e_respira')) staminaRegenPct += 2;
      const staminaRegenTurno = Math.round(staminaMax * (staminaRegenPct / 100));

      const danoFisico = forca * 2 + (hasPerk('golpe_firme') ? 10 : 0);
      const danoDistancia = destreza * 2;
      const craftVel = inteligencia * 2 + (hasPerk('oficio_inicial') ? 10 : 0);
      const craftQual = inteligencia + (hasPerk('ajuste_mestre') ? 5 : 0);
      let reducaoDanoExtra = 0;
      if (hasPerk('reflexo')) reducaoDanoExtra += 5;
      if (hasPerk('corpo_forte')) reducaoDanoExtra += 5;

      const inventory = inventoryTotals();
      const pesoAtual = inventory.totalWeight;
      const threshold = hasPerk('costas_de_ferro') ? 90 : 80;
      const cargaPct = capacidade <= 0 ? 0 : (pesoAtual / capacidade) * 100;
      let correr = andar * 2;
      let pesoPenaltyText = 'sem penalidade';
      if (cargaPct > 100) {
        andar = 0;
        correr = 0;
        pesoPenaltyText = 'imóvel por excesso de carga';
      } else if (cargaPct > threshold) {
        andar *= 0.7;
        correr *= 0.7;
        pesoPenaltyText = `deslocamento reduzido em 30% acima de ${threshold}% de carga`;
      }

      byId('forcaInfo').value = `+${forca * 2}% dano físico`;
      byId('constituicaoInfo').value = `HP +${constituicao * 10}`;
      byId('destrezaInfo').value = `+${destreza * 2}% distância`;
      byId('inteligenciaInfo').value = `criação +${inteligencia * 2}%`;
      byId('sabedoriaInfo').value = `percepção +${sabedoria}`;
      byId('carismaInfo').value = 'bônus narrativo';
      byId('pesoInfo').value = `+${peso * 10} kg`;
      byId('resistenciaInfo').value = `stamina +${resistencia * 10}`;

      byId('vidaMax').textContent = vidaMax;
      byId('vidaRegen').textContent = `regen: ${vidaRegenPct}% por turno (${vidaRegenTurno})`;
      byId('torporMax').textContent = torporMax;
      byId('torporInfo').textContent = `resistência a torpor: -${torporResist}% | queda natural: 5% por turno`;
      byId('staminaMax').textContent = staminaMax;
      byId('staminaRegen').textContent = `regen: ${staminaRegenPct}% por turno (${staminaRegenTurno})`;
      byId('andarVal').textContent = `${andar.toFixed(1).replace('.0','')} m`;
      byId('correrVal').textContent = `${correr.toFixed(1).replace('.0','')} m`;
      byId('esquivaVal').textContent = esquivaBase;
      byId('furtividadeVal').textContent = furtividade;
      byId('percepcaoVal').textContent = percepcao;
      byId('zonaPercepcao').textContent = `zona passiva: ${zonaPercepcao.toFixed(1).replace('.0','')}`;
      byId('oxigenioVal').textContent = `${oxigenio} s`;
      byId('capacidadeVal').textContent = `${capacidade} kg`;
      byId('pesoPenalty').textContent = pesoPenaltyText;
      byId('danoFisicoVal').textContent = `+${danoFisico}%`;
      byId('danoDistVal').textContent = `+${danoDistancia}%`;
      byId('craftVelVal').textContent = `+${craftVel}%`;
      byId('craftQualVal').textContent = `qualidade +${craftQual}%`;

      byId('vidaAtualMax').value = vidaMax;
      byId('torporAtualMax').value = torporMax;
      byId('staminaAtualMax').value = staminaMax;
      byId('pesoAtual').value = pesoAtual.toFixed(2).replace(/\.00$/, '');
      byId('pesoAtualMax').value = capacidade;
      byId('pesoUso').value = `${cargaPct.toFixed(1)}%`;
      byId('inventarioSlotsTotal').textContent = inventory.character.totalSlots;
      byId('inventarioSlotsUsados').textContent = inventory.character.used;
      byId('inventarioSlotsLivres').textContent = inventory.character.free;
      if (byId('mochilaSlotsTotalLabel')) byId('mochilaSlotsTotalLabel').textContent = inventory.backpack.totalSlots;
      if (byId('mochilaSlotsUsados')) byId('mochilaSlotsUsados').textContent = inventory.backpack.used;
      if (byId('mochilaSlotsLivres')) byId('mochilaSlotsLivres').textContent = inventory.backpack.free;

      updateBars('vidaAtual', vidaMax, 'vidaBar');
      updateBars('torporAtual', torporMax, 'torporBar');
      updateBars('staminaAtual', staminaMax, 'staminaBar');
      const pesoBarPct = capacidade <= 0 ? 0 : clamp((pesoAtual / capacidade) * 100, 0, 100);
      byId('pesoBar').style.width = `${pesoBarPct}%`;

      const postura = byId('postura').value;
      const armadura = byId('armadura').value;
      let posturaResumo = 'Postura ofensiva: funcionamento normal, sem custo.';
      if (postura === 'defensiva') posturaResumo = 'Postura defensiva: reduz o dano do personagem em 50%, aumenta a defesa em 50% e custa 10 de stamina.';
      if (postura === 'esquiva') posturaResumo = 'Postura de esquiva: custa 10 de stamina e depende da armadura. Leve usa d100/2 + destreza/2. Média usa d100/4 + destreza/4. Pesada não desvia.';
      if (armadura === 'media') posturaResumo += ' Armadura média: usa a fórmula reduzida de esquiva.';
      if (armadura === 'pesada') posturaResumo += ' Armadura pesada: não permite desvio.';
      byId('posturaResumo').textContent = posturaResumo;

      const armaEscala = byId('armaEscala').value;
      const escalaBonus = armaEscala === 'forca' ? Math.round(forca * 0.02 * 100) / 100 : armaEscala === 'destreza' ? Math.round(destreza * 0.02 * 100) / 100 : 0;
      const escalaPercentual = armaEscala === 'forca' ? danoFisico : armaEscala === 'destreza' ? danoDistancia : 0;
      byId('armaScaleValue').textContent = `+${escalaPercentual}%`;
      byId('armaScaleText').textContent = armaEscala === 'forca' ? 'escala por Força' : armaEscala === 'destreza' ? 'escala por Destreza' : 'sem escalonamento';

      const roll = clamp(Math.round(num('rolagemD20')), 1, 20);
      byId('rolagemD20').value = roll;
      const mult = d20Multiplier(roll);
      byId('multiD20').textContent = `${Math.round(mult * 100)}%`;

      const dadoBase = Math.max(0, num('danoBaseRolado'));
      const bonusArma = num('armaBonus');
      const extra = num('efeitoExtra');
      const bonusPercentualExtra = num('bonusPercentualExtra');
      let perkDamageBonus = 0;
      if (hasPerk('impacto_pesado')) perkDamageBonus += 10;
      if (hasPerk('derrubar_gigantes') && byId('tamanhoAlvo').value === 'grande') perkDamageBonus += 10;
      const percentualTotal = escalaPercentual + bonusPercentualExtra + perkDamageBonus;
      const baseSemMult = dadoBase + bonusArma + extra;
      const multiplicadorPosturaAtaque = postura === 'defensiva' ? 0.5 : 1;
      const danoBruto = baseSemMult * (1 + percentualTotal / 100) * mult * multiplicadorPosturaAtaque;
      const reducaoAlvo = clamp(num('reducaoArmaduraAlvo'), 0, 95);
      const danoFinal = danoBruto * (1 - reducaoAlvo / 100);
      const alvoAntes = Math.max(0, num('danoAplicadoAlvo'));
      const vidaRestanteAlvo = Math.max(0, alvoAntes - danoFinal);

      let damageReduction = clamp(num('reducaoArmadura') + reducaoDanoExtra, 0, 95);
      if (postura === 'defensiva') damageReduction = clamp(damageReduction + 50, 0, 95);

      const danoRecebidoBruto = Math.max(0, num('danoRecebidoBruto'));
      const rolagemEsquiva = clamp(Math.round(num('rolagemEsquiva') || 1), 1, 100);
      byId('rolagemEsquiva').value = rolagemEsquiva;
      const penalidadeEsquiva = num('penalidadeEsquiva');
      const esquivaAtiva = postura === 'esquiva';
      let formulaEsquivaValor = 0;
      if (esquivaAtiva) {
        if (armadura === 'leve') {
          formulaEsquivaValor = (rolagemEsquiva / 2) + (destreza / 2);
        } else if (armadura === 'media') {
          formulaEsquivaValor = (rolagemEsquiva / 4) + (destreza / 4);
        } else {
          formulaEsquivaValor = 0;
        }
      }
      const danoEsquivado = clamp(formulaEsquivaValor - penalidadeEsquiva, 0, danoRecebidoBruto);
      const danoAposEsquiva = Math.max(0, danoRecebidoBruto - danoEsquivado);
      const danoRecebidoFinal = danoAposEsquiva * (1 - damageReduction / 100);
      const vidaAposDanoRecebido = Math.max(0, num('vidaAtual') - danoRecebidoFinal);

      let esquivaCalcValor = 0;
      if (armadura === 'leve') esquivaCalcValor = 50 + destreza / 2;
      else if (armadura === 'media') esquivaCalcValor = 25 + destreza / 4;
      else esquivaCalcValor = 0;
      const esquivaCalc = esquivaCalcValor.toFixed(1).replace('.0','');

      byId('percentualTotalDano').textContent = `${percentualTotal >= 0 ? '+' : ''}${percentualTotal}%`;
      byId('danoBruto').textContent = danoBruto.toFixed(2).replace(/\.00$/, '');
      byId('danoFinal').textContent = danoFinal.toFixed(2).replace(/\.00$/, '');
      byId('vidaRestanteAlvo').value = alvoAntes > 0 ? vidaRestanteAlvo.toFixed(2).replace(/\.00$/, '') : '';
      byId('reducaoArmaduraRecebida').value = `${damageReduction}%`;
      byId('danoRecebidoFinal').value = danoRecebidoFinal.toFixed(2).replace(/\.00$/, '');
      byId('vidaAposDanoRecebido').value = vidaAposDanoRecebido.toFixed(2).replace(/\.00$/, '');
      byId('esquivaCalc').textContent = esquivaCalc;
      byId('esquivaBox').style.display = esquivaAtiva ? 'block' : 'none';
      byId('formulaEsquiva').value = formulaEsquivaValor.toFixed(2).replace(/\.00$/, '');
      byId('danoEsquivado').value = danoEsquivado.toFixed(2).replace(/\.00$/, '');
      byId('applyReceivedDamageBtn').disabled = danoRecebidoBruto <= 0;
      byId('ataqueResumo').textContent = `${byId('armaNome').value || 'Arma'} (${byId('armaDado').value || '-'})`;

      saveState();
    }

    window.applyDelta = function(type) {
      const currentId = `${type}Atual`;
      const deltaId = `${type}Delta`;
      const maxId = `${type}AtualMax`;
      const current = num(currentId);
      const delta = num(deltaId);
      const max = num(maxId);
      byId(currentId).value = clamp(current + delta, 0, max);
      byId(deltaId).value = 0;
      updateAll();
    }

    function actionCost() {
      let cost = parseFloat(byId('acaoRapida').value) || 0;
      if (hasPerk('trabalho_consciente')) cost *= 0.9;
      if (hasPerk('agilidade') && byId('acaoRapida').selectedOptions[0].text.toLowerCase().includes('ataque leve')) cost *= 0.9;
      return Math.round(cost * 100) / 100;
    }

    byId('useActionBtn').addEventListener('click', () => {
      const current = num('staminaAtual');
      byId('staminaAtual').value = Math.max(0, current - actionCost());
      updateAll();
    });

    byId('recoverStaminaBtn').addEventListener('click', () => {
      const max = num('staminaAtualMax');
      const resistencia = num('resistencia');
      let regenPct = 5 + Math.floor(resistencia / 10);
      if (hasPerk('senta_e_respira')) regenPct += 2;
      const amount = Math.round(max * regenPct / 100);
      byId('staminaAtual').value = clamp(num('staminaAtual') + amount, 0, max);
      updateAll();
    });

    byId('recoverHpBtn').addEventListener('click', () => {
      const max = num('vidaAtualMax');
      const constituicao = num('constituicao');
      let regenPct = 2 + Math.floor(constituicao / 10);
      const amount = Math.round(max * regenPct / 100);
      byId('vidaAtual').value = clamp(num('vidaAtual') + amount, 0, max);
      updateAll();
    });

    byId('dropTorporBtn').addEventListener('click', () => {
      const current = num('torporAtual');
      const drop = Math.round(num('torporAtualMax') * 0.05);
      byId('torporAtual').value = Math.max(0, current - drop);
      updateAll();
    });

    byId('applyReceivedDamageBtn').addEventListener('click', () => {
      const vidaAtual = num('vidaAtual');
      const danoFinal = Math.max(0, parseFloat(byId('danoRecebidoFinal').value) || 0);
      byId('vidaAtual').value = Math.max(0, vidaAtual - danoFinal);
      updateAll();
    });

    byId('applyDamageToTargetBtn').addEventListener('click', () => {
      const vidaAlvoAtual = Math.max(0, num('danoAplicadoAlvo'));
      const danoFinal = Math.max(0, parseFloat(byId('danoFinal').textContent.replace(',', '.')) || 0);
      byId('danoAplicadoAlvo').value = Math.max(0, vidaAlvoAtual - danoFinal).toFixed(2).replace(/\.00$/, '');
      updateAll();
    });

    byId('exportBtn').addEventListener('click', () => {
      saveState();
      renderExportChecklist();
      openModal(exportModal);
    });

    byId('importBtn').addEventListener('click', () => {
      pendingImportMode = 'append';
      const defaultOption = document.querySelector('input[name="importMode"][value="append"]');
      if (defaultOption) defaultOption.checked = true;
      openModal(importModal);
    });

    confirmExportBtn.addEventListener('click', () => {
      saveState();
      const mode = document.querySelector('input[name="exportMode"]:checked')?.value || 'active';
      const active = getActiveTab();
      if (mode === 'workspace') {
        downloadJson('ficha_ark_rpg_completa', buildWorkspaceExport(sheetStore.tabs));
      } else if (mode === 'selected-separate') {
        const selectedTabs = getSelectedExportTabs();
        if (!selectedTabs.length) {
          alert('Selecione pelo menos uma aba para exportar separadamente.');
          return;
        }
        selectedTabs.forEach((tab, index) => {
          setTimeout(() => downloadJson(normalizeTabName(tab.name, index + 1), tab.data || {}), index * 150);
        });
      } else {
        downloadJson(active?.name || 'ficha_ark_rpg', active?.data || {});
      }
      closeModal(exportModal);
    });

    cancelExportBtn.addEventListener('click', () => closeModal(exportModal));

    document.querySelectorAll('input[name="exportMode"]').forEach(radio => {
      radio.addEventListener('change', syncExportChecklistState);
    });

    chooseImportFileBtn.addEventListener('click', () => {
      pendingImportMode = document.querySelector('input[name="importMode"]:checked')?.value || 'append';
      closeModal(importModal);
      if (pendingImportMode === 'replace') {
        openModal(replaceImportModal);
        return;
      }
      byId('fileInput').click();
    });

    cancelImportBtn.addEventListener('click', () => closeModal(importModal));
    cancelReplaceImportBtn.addEventListener('click', () => closeModal(replaceImportModal));
    confirmReplaceImportBtn.addEventListener('click', () => {
      closeModal(replaceImportModal);
      byId('fileInput').click();
    });

    byId('fileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const importedTabs = normalizeImportedTabs(parsed, file.name);
        if (!importedTabs.length) throw new Error('empty');
        if (pendingImportMode === 'replace') {
          replaceWorkspaceWithImportedTabs(importedTabs);
        } else {
          appendImportedTabs(importedTabs);
        }
      } catch (err) {
        alert('Não foi possível importar o arquivo JSON.');
      } finally {
        pendingImportMode = 'append';
        e.target.value = '';
      }
    });

    byId('printBtn').addEventListener('click', () => window.print());
    byId('resetBtn').addEventListener('click', () => {
      const active = getActiveTab();
      if (!active) return;
      if (!confirm('Isso vai limpar apenas a ficha atual. Deseja continuar?')) return;
      active.data = makeBlankState();
      active.name = defaultTabName(sheetStore.tabs.indexOf(active) + 1);
      persistSheetStore();
      renderTabs();
      applyStateToForm(active.data);
      createInventoryRows(true);
      updateAll();
    });

    byId('addTabBtn').addEventListener('click', () => {
      saveState();
      createTab({}, defaultTabName(sheetStore.tabs.length + 1));
    });

    byId('tabsBar').addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-tab]');
      if (closeBtn) {
        e.stopPropagation();
        openCloseTabModal(closeBtn.dataset.closeTab);
        return;
      }
      const tabBtn = e.target.closest('[data-tab-id]');
      if (tabBtn) {
        switchTab(tabBtn.dataset.tabId);
      }
    });

    cancelCloseTabBtn.addEventListener('click', () => {
      closeCloseTabModal();
    });

    confirmCloseTabBtn.addEventListener('click', () => {
      if (pendingCloseTabId) {
        closeTab(pendingCloseTabId);
      }
      closeCloseTabModal();
    });

    closeTabModal.addEventListener('click', (e) => {
      if (e.target === closeTabModal) {
        closeCloseTabModal();
      }
    });

    [exportModal, importModal, replaceImportModal].forEach(modal => {
      if (!modal) return;
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !closeTabModal.classList.contains('hidden')) {
        closeCloseTabModal();
        return;
      }
      if (e.key === 'Escape') {
        closeAllSecondaryModals();
      }
    });

    document.addEventListener('input', (e) => {
      if (e.target.matches('input, select, textarea')) updateAll();
    });
    document.addEventListener('change', (e) => {
      if (e.target.matches('input, select, textarea')) updateAll();
    });

    async function startApp() {
      await bootstrapCloud();
      suppressCloudSave = true;
      createPerks();
      loadState();
      createInventoryRows(true);
      updateAll();
      suppressCloudSave = false;
      scheduleCloudSave();
    }

    startApp();