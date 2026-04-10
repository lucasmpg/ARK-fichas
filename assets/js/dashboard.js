import {
  logout,
  isAdminUser,
  getWorkspace,
  saveWorkspace,
  upsertUserProfile,
  listAllUsers,
  waitForAuth
} from "./firebase-config.js";

const statusEl = document.getElementById("dashboardStatus");
const subtitleEl = document.getElementById("dashboardSubtitle");
const topCardsEl = document.getElementById("dashboardTopCards");
const creatureListEl = document.getElementById("dashboardCreatureList");
const quickStatsEl = document.getElementById("dashboardQuickStats");

const createModal = document.getElementById("createCreatureModal");
const transferModal = document.getElementById("transferCreatureModal");

const templateSelect = document.getElementById("newCreatureTemplate");
const transferTargetUser = document.getElementById("transferTargetUser");

const goPlayerSheetBtn = document.getElementById("goPlayerSheetBtn");
const goAdminBtn = document.getElementById("goAdminBtn");
const logoutBtn = document.getElementById("logoutBtn");

const cancelCreateCreatureBtn = document.getElementById("cancelCreateCreatureBtn");
const confirmCreateCreatureBtn = document.getElementById("confirmCreateCreatureBtn");
const cancelTransferCreatureBtn = document.getElementById("cancelTransferCreatureBtn");
const confirmTransferCreatureBtn = document.getElementById("confirmTransferCreatureBtn");

const TEMPLATES = [
  { key: "lobo", label: "Lobo", baseVida: 100, baseDano: 12, baseMovimento: 7, basePeso: 45, pontosPorNivel: 5 },
  { key: "urso", label: "Urso", baseVida: 180, baseDano: 20, baseMovimento: 6, basePeso: 120, pontosPorNivel: 5 },
  { key: "raptor", label: "Raptor", baseVida: 120, baseDano: 16, baseMovimento: 8, basePeso: 60, pontosPorNivel: 5 },
  { key: "escorpiao", label: "Escorpião", baseVida: 110, baseDano: 14, baseMovimento: 6, basePeso: 35, pontosPorNivel: 5 },
  { key: "aranha", label: "Aranha", baseVida: 90, baseDano: 11, baseMovimento: 7, basePeso: 25, pontosPorNivel: 5 },
  { key: "custom", label: "Template customizado", baseVida: 100, baseDano: 0, baseMovimento: 5, basePeso: 50, pontosPorNivel: 5 }
];

let currentUser = null;
let targetUid = null;
let workspace = null;
let workspaceOwner = null;
let allUsers = [];
let pendingTransferCreatureId = null;
let accessMode = "owner";

const qp = (name) => new URLSearchParams(window.location.search).get(name);
const clone = (value) => JSON.parse(JSON.stringify(value));
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function openModal(modal) {
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  closeAllCustomSelects();
}

function closeAllCustomSelects(exceptSelect = null) {
  document.querySelectorAll(".custom-select.open").forEach((host) => {
    const nativeSelect = host.querySelector("select");
    if (!exceptSelect || nativeSelect !== exceptSelect) {
      host.classList.remove("open");
    }
  });
}

function refreshCustomSelect(select) {
  if (!select) return;

  const host = select.closest(".custom-select");
  if (!host) return;

  const trigger = host.querySelector(".custom-select-trigger");
  const menu = host.querySelector(".custom-select-menu");
  if (!trigger || !menu) return;

  const placeholder = select.dataset.placeholder || "Selecione";
  const options = [...select.options];
  const selectedOption =
    options.find((option) => option.value === select.value) || options[0] || null;

  trigger.textContent = selectedOption ? selectedOption.textContent : placeholder;
  menu.innerHTML = "";

  options.forEach((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "custom-select-option";
    item.textContent = option.textContent || placeholder;
    item.disabled = option.disabled;

    if (option.value === select.value) {
      item.classList.add("active");
    }

    item.addEventListener("click", () => {
      if (option.disabled) return;
      select.value = option.value;
      refreshCustomSelect(select);
      host.classList.remove("open");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    menu.appendChild(item);
  });
}

function initCustomSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const host = select.closest(".custom-select");
  if (!host) return;

  const trigger = host.querySelector(".custom-select-trigger");

  if (host.dataset.bound === "1") {
    refreshCustomSelect(select);
    return;
  }

  host.dataset.bound = "1";

  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    const willOpen = !host.classList.contains("open");
    closeAllCustomSelects(select);
    if (willOpen) host.classList.add("open");
  });

  select.addEventListener("change", () => refreshCustomSelect(select));
  refreshCustomSelect(select);
}

const canManageWorkspace = () => accessMode === "owner" || accessMode === "admin";

function ensureWorkspaceShape(data) {
  return {
    ownerUid: targetUid,
    ownerName: data?.ownerName || workspaceOwner?.displayName || "",
    ownerEmail: data?.ownerEmail || workspaceOwner?.email || "",
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
      const uid = String(viewer?.uid || "").trim();
      if (uid) set.add(uid);
    });
  });

  return [...set];
}

function getCreatureImage(creature) {
  return (
    creature?.imageUrl ||
    creature?.avatarUrl ||
    creature?.fotoUrl ||
    creature?.portraitUrl ||
    creature?.image ||
    creature?.photoUrl ||
    ""
  );
}

function getInitials(text) {
  const safe = String(text || "").trim();
  if (!safe) return "?";
  return safe.charAt(0).toUpperCase();
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function getVidaMax(creature) {
  return Number(creature?.baseVida) || 100;
}

function getVidaAtual(creature) {
  const atual = Number(creature?.current?.vidaAtual);
  return Number.isFinite(atual) ? atual : getVidaMax(creature);
}

function getVidaPercent(creature) {
  const atual = getVidaAtual(creature);
  const max = getVidaMax(creature);
  if (max > 0) return clampPercent((atual / max) * 100);
  return 100;
}

function getStaminaAtual(creature) {
  const atual = Number(creature?.current?.staminaAtual);
  return Number.isFinite(atual) ? atual : 100;
}

function getStaminaPercent(creature) {
  return clampPercent(getStaminaAtual(creature));
}

function getPesoAtual(creature) {
  return (
    Number(creature?.stats?.peso) ||
    Number(creature?.pesoAtual) ||
    Number(creature?.inventory?.pesoAtual) ||
    0
  );
}

function getPesoMax(creature) {
  return (
    Number(creature?.basePeso) ||
    Number(creature?.pesoMaximo) ||
    Number(creature?.inventory?.pesoMaximo) ||
    100
  );
}

function getPesoPercent(creature) {
  const maxPeso = getPesoMax(creature);
  if (maxPeso > 0) return clampPercent((getPesoAtual(creature) / maxPeso) * 100);
  return 0;
}

function buildArkButton({
  label,
  color = "blue",
  href = "",
  small = false,
  attrs = "",
  disabled = false
}) {
  const className = `ark-btn ark-btn-${color}${small ? " ark-btn-sm" : ""}${disabled ? " is-disabled" : ""}`;
  const disabledAttr = disabled ? ' aria-disabled="true" tabindex="-1"' : "";

  if (href) {
    return `<a class="${className}" href="${disabled ? "#" : href}" ${attrs}${disabledAttr}><span>${escapeHtml(label)}</span></a>`;
  }

  return `<button type="button" class="${className}" ${attrs}${disabled ? " disabled" : ""}><span>${escapeHtml(label)}</span></button>`;
}

function buildMetricRow(label, current, max, percent, fillClass) {
  return `
    <div class="status-row">
      <div class="status-label">${escapeHtml(label)}</div>
      <div class="status-bar">
        <div class="status-bar-frame" aria-hidden="true"></div>
        <div class="status-bar-fill-track">
          <div class="status-bar-fill ${fillClass}" style="width:${percent}%"></div>
        </div>
      </div>
      <div class="metric-caption">${escapeHtml(current)}${max !== null ? ` / ${escapeHtml(max)}` : "%"}</div>
    </div>
  `;
}

function loadUsers() {
  return listAllUsers().then((users) => {
    allUsers = users;

    if (!transferTargetUser) return;

    transferTargetUser.innerHTML = allUsers
      .filter((user) => user.uid !== targetUid)
      .map(
        (user) =>
          `<option value="${escapeHtml(user.uid)}">${escapeHtml(user.name || "Sem nome")} • ${escapeHtml(user.email || "Sem e-mail")}</option>`
      )
      .join("");

    initCustomSelect("transferTargetUser");
  });
}

function renderQuickStats() {
  if (!quickStatsEl) return;

  const creatures = workspace?.creatures || [];
  const total = creatures.length;
  const totalVida = creatures.reduce((sum, creature) => sum + getVidaAtual(creature), 0);
  const avgStamina = total
    ? Math.round(creatures.reduce((sum, creature) => sum + getStaminaAtual(creature), 0) / total)
    : 0;
  const ocupacaoAlta = creatures.filter((creature) => getPesoPercent(creature) >= 70).length;

  const stats = [
    { value: total, label: "Criaturas" },
    { value: totalVida, label: "Vida total" },
    { value: `${avgStamina}%`, label: "Estamina média" },
    { value: ocupacaoAlta, label: "Peso alto" }
  ];

  quickStatsEl.innerHTML = stats
    .map(
      (item) => `
        <article class="stat-pill">
          <div class="stat-pill-value">${escapeHtml(item.value)}</div>
          <div class="stat-pill-label">${escapeHtml(item.label)}</div>
        </article>
      `
    )
    .join("");
}

function renderTopCards() {
  topCardsEl.innerHTML = "";

  const isAdmin = accessMode === "admin";
  const playerQs = new URLSearchParams({ uid: targetUid });
  if (isAdmin) playerQs.set("admin", "1");

  const playerCard = document.createElement("article");
  playerCard.className = "hud-card hud-card-small";
  playerCard.innerHTML = `
    <div class="hud-card-frame" aria-hidden="true"></div>
    <div class="hud-card-inner">
      <div class="hud-card-header">
        <h2>Minha ficha</h2>
      </div>

      <div class="meta-stack">
        <div><strong>Jogador:</strong> ${escapeHtml(workspace.ownerName || workspaceOwner?.displayName || "Sem nome")}</div>
        <div><strong>E-mail:</strong> ${escapeHtml(workspace.ownerEmail || workspaceOwner?.email || "Sem e-mail")}</div>
        <div><strong>Criaturas:</strong> ${escapeHtml(workspace.creatures.length)}</div>
        <div><strong>Modo:</strong> ${escapeHtml(isAdmin ? "Admin" : "Dono")}</div>
      </div>

      <div class="card-actions">
        ${buildArkButton({
          label: "Abrir ficha",
          color: "blue",
          href: `./ficha.html?${playerQs.toString()}`
        })}
      </div>
    </div>
  `;
  topCardsEl.appendChild(playerCard);

  if (workspace.creatures.length > 0) {
    const main = workspace.creatures[0];
    const mainQs = new URLSearchParams({ uid: targetUid, cid: main.id });
    if (isAdmin) mainQs.set("admin", "1");

    const canManageCreature = canManageWorkspace() || currentUser.uid === main.ownerUid;
    const mainCard = document.createElement("article");
    mainCard.className = "hud-card hud-card-small";
    mainCard.innerHTML = `
      <div class="hud-card-frame" aria-hidden="true"></div>
      <div class="hud-card-inner">
        <div class="hud-card-header">
          <h2>${escapeHtml(main.nome || "Criatura sem nome")}</h2>
        </div>

        <div class="quick-inline-meta">
          <div><strong>Espécie:</strong> ${escapeHtml(main.especie || "Sem espécie")}</div>
          <div><strong>Nível:</strong> ${escapeHtml(main.nivel || 1)}</div>
          <div><strong>Vida:</strong> ${escapeHtml(getVidaAtual(main))} / ${escapeHtml(getVidaMax(main))}</div>
          <div><strong>Dono:</strong> ${escapeHtml(main.ownerName || workspace.ownerName || "Sem dono")}</div>
        </div>

        <div class="card-actions">
          ${buildArkButton({
            label: "Abrir",
            color: "blue",
            href: `./criatura.html?${mainQs.toString()}`,
            small: true
          })}
          ${buildArkButton({
            label: "Transferir",
            color: "orange",
            small: true,
            attrs: 'data-transfer-main="1"',
            disabled: !canManageCreature
          })}
          ${buildArkButton({
            label: "Apagar",
            color: "red",
            small: true,
            attrs: 'data-delete-main="1"',
            disabled: !canManageCreature
          })}
        </div>
      </div>
    `;

    mainCard.querySelector('[data-transfer-main="1"]')?.addEventListener("click", () => {
      if (!canManageCreature) return;
      pendingTransferCreatureId = main.id;
      openModal(transferModal);
    });

    mainCard.querySelector('[data-delete-main="1"]')?.addEventListener("click", async () => {
      if (!canManageCreature) return;
      if (!window.confirm(`Apagar a criatura ${main.nome || "sem nome"}?`)) return;

      workspace.creatures = workspace.creatures.filter((item) => item.id !== main.id);
      workspace.sharedViewerUids = computeWorkspaceSharedViewerUids(workspace.creatures);

      await saveWorkspace(targetUid, {
        creatures: clone(workspace.creatures),
        sharedViewerUids: clone(workspace.sharedViewerUids)
      });

      renderAll();
      statusEl.textContent = "Criatura apagada.";
    });

    topCardsEl.appendChild(mainCard);
  } else {
    const emptyHighlight = document.createElement("article");
    emptyHighlight.className = "hud-card hud-card-small";
    emptyHighlight.innerHTML = `
      <div class="hud-card-frame" aria-hidden="true"></div>
      <div class="hud-card-inner">
        <div class="hud-card-header">
          <h2>Nenhuma criatura</h2>
        </div>

        <p class="empty-text">Você ainda não possui criaturas cadastradas. Crie a primeira para começar.</p>

        <div class="card-actions">
          ${buildArkButton({
            label: "Criar agora",
            color: "green",
            attrs: 'data-open-create-empty="1"'
          })}
        </div>
      </div>
    `;

    emptyHighlight
      .querySelector('[data-open-create-empty="1"]')
      ?.addEventListener("click", () => openModal(createModal));

    topCardsEl.appendChild(emptyHighlight);
  }

  const addCard = document.createElement("article");
  addCard.className = "hud-card hud-card-small hud-card-accent";
  addCard.innerHTML = `
    <div class="hud-card-frame" aria-hidden="true"></div>
    <div class="hud-card-inner">
      <div class="hud-card-header">
        <h2>Nova criatura</h2>
      </div>

      <div class="meta-stack">
        <div>Criação por template com valores base automáticos.</div>
        <div>Depois disso, o dono distribui pontos com o botão +.</div>
        <div>Criação liberada para dono e admin.</div>
      </div>

      <div class="card-actions">
        ${buildArkButton({
          label: "Criar",
          color: "green",
          attrs: 'data-open-create="1"',
          disabled: !canManageWorkspace()
        })}
      </div>
    </div>
  `;

  addCard
    .querySelector('[data-open-create="1"]')
    ?.addEventListener("click", () => {
      if (!canManageWorkspace()) return;
      openModal(createModal);
    });

  topCardsEl.appendChild(addCard);
}

function renderCreatureList() {
  creatureListEl.innerHTML = "";

  if (!workspace.creatures.length) {
    const emptyState = document.createElement("article");
    emptyState.className = "creature-card empty-state";
    emptyState.innerHTML = `
      <div class="hud-creature-frame" aria-hidden="true"></div>
      <div class="creature-card-inner">
        <div class="creature-info">
          <div class="creature-top-row">
            <h3 class="hud-creature-title">Sem criaturas no momento</h3>
          </div>

          <p class="empty-text">Crie uma nova criatura para preencher esta área.</p>

          <div class="creature-actions">
            ${buildArkButton({
              label: "Criar criatura",
              color: "green",
              attrs: 'data-open-create-empty-list="1"'
            })}
          </div>
        </div>
      </div>
    `;

    emptyState
      .querySelector('[data-open-create-empty-list="1"]')
      ?.addEventListener("click", () => openModal(createModal));

    creatureListEl.appendChild(emptyState);
    return;
  }

  workspace.creatures.forEach((creature) => {
    const img = getCreatureImage(creature);
    const isAdmin = accessMode === "admin";
    const canManageCreature = canManageWorkspace() || currentUser.uid === creature.ownerUid;

    const creatureQs = new URLSearchParams({ uid: targetUid, cid: creature.id });
    if (isAdmin) creatureQs.set("admin", "1");

    const vidaAtual = getVidaAtual(creature);
    const vidaMax = getVidaMax(creature);
    const vidaPercent = getVidaPercent(creature);
    const staminaAtual = getStaminaAtual(creature);
    const staminaPercent = getStaminaPercent(creature);
    const pesoAtual = getPesoAtual(creature);
    const pesoMax = getPesoMax(creature);
    const pesoPercent = getPesoPercent(creature);

    const card = document.createElement("article");
    card.className = "creature-card";
    card.innerHTML = `
      <div class="hud-creature-frame" aria-hidden="true"></div>
      <div class="creature-card-inner">
        <div class="creature-portrait-wrap">
          <div class="portrait-frame" aria-hidden="true"></div>
          <div class="creature-portrait">
            ${
              img
                ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(creature.nome || "Criatura")}" />`
                : `<div class="creature-portrait-fallback">${escapeHtml(getInitials(creature.nome))}</div>`
            }
          </div>
          <div class="portrait-badge">${escapeHtml(creature.especie || "Sem espécie")}</div>
        </div>

        <div class="creature-info">
          <div class="creature-top-row">
            <h3 class="hud-creature-title">${escapeHtml(creature.nome || "Criatura sem nome")}</h3>
          </div>

          <div class="creature-meta">
            <div><strong>Espécie:</strong> ${escapeHtml(creature.especie || "Sem espécie")}</div>
            <div><strong>Nível:</strong> ${escapeHtml(creature.nivel || 1)}</div>
            <div><strong>Dono:</strong> ${escapeHtml(creature.ownerName || workspace.ownerName || "Sem dono")}</div>
            <div><strong>Escalonamento:</strong> ${escapeHtml(creature.damageScaling || "forca")}</div>
          </div>

          <div class="creature-bars">
            ${buildMetricRow("Vida", vidaAtual, vidaMax, vidaPercent, "fill-vida")}
            ${buildMetricRow("Estamina", staminaAtual, null, staminaPercent, "fill-stamina")}
            ${buildMetricRow("Peso", pesoAtual, pesoMax, pesoPercent, "fill-peso")}
          </div>

          <div class="creature-actions">
            ${buildArkButton({
              label: "Abrir",
              color: "blue",
              href: `./criatura.html?${creatureQs.toString()}`,
              small: true
            })}
            ${buildArkButton({
              label: "Transferir",
              color: "orange",
              small: true,
              attrs: `data-transfer-id="${escapeHtml(creature.id)}"`,
              disabled: !canManageCreature
            })}
            ${buildArkButton({
              label: "Apagar",
              color: "red",
              small: true,
              attrs: `data-delete-id="${escapeHtml(creature.id)}"`,
              disabled: !canManageCreature
            })}
          </div>
        </div>
      </div>
    `;

    card.querySelector(`[data-transfer-id="${CSS.escape(creature.id)}"]`)?.addEventListener("click", () => {
      if (!canManageCreature) return;
      pendingTransferCreatureId = creature.id;
      openModal(transferModal);
    });

    card.querySelector(`[data-delete-id="${CSS.escape(creature.id)}"]`)?.addEventListener("click", async () => {
      if (!canManageCreature) return;
      if (!window.confirm(`Apagar a criatura ${creature.nome || "sem nome"}?`)) return;

      workspace.creatures = workspace.creatures.filter((item) => item.id !== creature.id);
      workspace.sharedViewerUids = computeWorkspaceSharedViewerUids(workspace.creatures);

      await saveWorkspace(targetUid, {
        creatures: clone(workspace.creatures),
        sharedViewerUids: clone(workspace.sharedViewerUids)
      });

      renderAll();
      statusEl.textContent = "Criatura apagada.";
    });

    creatureListEl.appendChild(card);
  });
}

function renderAll() {
  renderQuickStats();
  renderTopCards();
  renderCreatureList();
}

async function createCreature() {
  if (!canManageWorkspace()) return;

  const name = document.getElementById("newCreatureName")?.value.trim() || "";
  const template = creatureTemplate(templateSelect?.value);

  const id = `criatura_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const creature = {
    id,
    nome: name || template.label,
    especie: template.label,
    ownerUid: targetUid,
    ownerName: workspace.ownerName || workspaceOwner?.displayName || "",
    ownerEmail: workspace.ownerEmail || workspaceOwner?.email || "",
    nivel: 1,
    baseVida: template.baseVida,
    baseDano: template.baseDano,
    baseMovimento: template.baseMovimento,
    basePeso: template.basePeso,
    pontosPorNivel: template.pontosPorNivel,
    bonusPontos: 0,
    stats: {
      forca: 0,
      constituicao: 0,
      destreza: 0,
      inteligencia: 0,
      sabedoria: 0,
      carisma: 0,
      peso: 0,
      resistencia: 0
    },
    current: {
      vidaAtual: template.baseVida,
      torporAtual: 0,
      staminaAtual: 100
    },
    inventory: {
      slotsBase: 5,
      slotsExtra: 0,
      items: []
    },
    damageScaling: "forca",
    sharedViewers: [],
    notes: "",
    adminNotas: ""
  };

  workspace.creatures.push(creature);
  workspace.sharedViewerUids = computeWorkspaceSharedViewerUids(workspace.creatures);

  await saveWorkspace(targetUid, {
    creatures: clone(workspace.creatures),
    sharedViewerUids: clone(workspace.sharedViewerUids)
  });

  closeModal(createModal);

  const newCreatureName = document.getElementById("newCreatureName");
  if (newCreatureName) newCreatureName.value = "";

  renderAll();
  statusEl.textContent = "Criatura criada com sucesso.";
}

async function transferCreature() {
  const newUid = transferTargetUser?.value;
  if (!pendingTransferCreatureId || !newUid) return;

  const creature = workspace.creatures.find((item) => item.id === pendingTransferCreatureId);
  if (!creature) return;

  const targetUser = allUsers.find((item) => item.uid === newUid);
  const raw = await getWorkspace(newUid);

  const targetWorkspace = {
    ownerUid: newUid,
    ownerName: raw?.ownerName || targetUser?.name || "",
    ownerEmail: raw?.ownerEmail || targetUser?.email || "",
    creatures: Array.isArray(raw?.creatures) ? raw.creatures : [],
    sharedViewerUids: Array.isArray(raw?.sharedViewerUids) ? raw.sharedViewerUids : []
  };

  workspace.creatures = workspace.creatures.filter((item) => item.id !== pendingTransferCreatureId);

  creature.ownerUid = newUid;
  creature.ownerName = targetUser?.name || "";
  creature.ownerEmail = targetUser?.email || "";

  targetWorkspace.creatures.push(creature);

  workspace.sharedViewerUids = computeWorkspaceSharedViewerUids(workspace.creatures);
  targetWorkspace.sharedViewerUids = computeWorkspaceSharedViewerUids(targetWorkspace.creatures);

  await saveWorkspace(targetUid, {
    creatures: clone(workspace.creatures),
    sharedViewerUids: clone(workspace.sharedViewerUids)
  });

  await saveWorkspace(newUid, {
    ownerUid: newUid,
    ownerName: targetWorkspace.ownerName,
    ownerEmail: targetWorkspace.ownerEmail,
    creatures: clone(targetWorkspace.creatures),
    sharedViewerUids: clone(targetWorkspace.sharedViewerUids)
  });

  pendingTransferCreatureId = null;
  closeModal(transferModal);
  renderAll();
  statusEl.textContent = "Criatura transferida.";
}

async function init() {
  currentUser = await waitForAuth();

  if (!currentUser) {
    window.location.href = "../index.html";
    return;
  }

  await upsertUserProfile(currentUser);

  const admin = isAdminUser(currentUser);
  const requestedUid = qp("uid");
  targetUid = admin && requestedUid ? requestedUid : currentUser.uid;

  if (!admin && requestedUid && requestedUid !== currentUser.uid) {
    window.location.href = "./dashboard.html";
    return;
  }

  const raw = await getWorkspace(targetUid);

  workspaceOwner =
    targetUid === currentUser.uid
      ? currentUser
      : {
          displayName: raw?.ownerName || "Usuário",
          email: raw?.ownerEmail || ""
        };

  workspace = ensureWorkspaceShape(raw);
  accessMode = admin && targetUid !== currentUser.uid ? "admin" : "owner";

  subtitleEl.textContent =
    accessMode === "admin"
      ? `Admin visualizando o dashboard de ${workspace.ownerName || workspace.ownerEmail || targetUid}`
      : `Bem-vindo ${workspace.ownerName || currentUser.displayName || "Jogador"}`;

  statusEl.textContent = `${workspace.creatures.length} criatura(s)`;

  if (templateSelect) {
    templateSelect.innerHTML = TEMPLATES.map(
      (item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`
    ).join("");
    initCustomSelect("newCreatureTemplate");
  }

  await loadUsers();
  renderAll();

  const topSheetQs = new URLSearchParams({ uid: targetUid });
  if (accessMode === "admin") topSheetQs.set("admin", "1");

  if (goPlayerSheetBtn) {
    goPlayerSheetBtn.setAttribute("href", `./ficha.html?${topSheetQs.toString()}`);
  }

  if (goAdminBtn) {
    goAdminBtn.style.display = admin ? "inline-flex" : "none";
    goAdminBtn.setAttribute("href", "./admin.html");
  }

  logoutBtn?.addEventListener("click", async () => {
    try {
      await logout();
    } finally {
      window.location.href = "../index.html";
    }
  });

  cancelCreateCreatureBtn?.addEventListener("click", () => closeModal(createModal));
  confirmCreateCreatureBtn?.addEventListener("click", createCreature);

  cancelTransferCreatureBtn?.addEventListener("click", () => {
    pendingTransferCreatureId = null;
    closeModal(transferModal);
  });

  confirmTransferCreatureBtn?.addEventListener("click", transferCreature);

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".custom-select")) closeAllCustomSelects();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal(createModal);
      closeModal(transferModal);
    }
  });

  [createModal, transferModal].forEach((modal) => {
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });
}

init();
