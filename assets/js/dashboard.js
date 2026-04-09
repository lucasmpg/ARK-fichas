// ============================
// IMPORTS
// ============================

import {
  logout,
  getWorkspace,
  saveWorkspace,
  upsertUserProfile,
  waitForAuth
} from "./firebase-config.js";

// ============================
// ELEMENTOS
// ============================

const statusEl = document.getElementById('dashboardStatus');
const subtitleEl = document.getElementById('dashboardSubtitle');
const topCardsEl = document.getElementById('dashboardTopCards');
const creatureListEl = document.getElementById('dashboardCreatureList');

const createModal = document.getElementById('createCreatureModal');
const templateSelect = document.getElementById('newCreatureTemplate');

// ============================
// DATA
// ============================

let currentUser = null;
let workspace = null;

// ============================
// TEMPLATES
// ============================

const TEMPLATES = [
  { key: 'lobo', label: 'Lobo', baseVida: 100 },
  { key: 'urso', label: 'Urso', baseVida: 180 },
  { key: 'raptor', label: 'Raptor', baseVida: 120 },
  { key: 'custom', label: 'Custom', baseVida: 100 }
];

// ============================
// HELPERS
// ============================

const clone = (v) => JSON.parse(JSON.stringify(v));

function openModal(m){ m.classList.remove('hidden'); }
function closeModal(m){ m.classList.add('hidden'); }

function getCreatureImage(creature){
  return (
    creature.imageUrl ||
    creature.avatarUrl ||
    creature.fotoUrl ||
    creature.portraitUrl ||
    null
  );
}

// ============================
// RENDER TOPO
// ============================

function renderTopCards(){

  topCardsEl.innerHTML = "";

  // MINHA FICHA
  const player = document.createElement('div');
  player.className = "hud-card hud-card-small";

  player.innerHTML = `
    <div class="hud-card-frame"></div>
    <div class="hud-card-inner">
      <h2>Minha ficha</h2>

      <div class="meta-stack">
        <div><strong>Jogador:</strong> ${workspace.ownerName || '---'}</div>
        <div><strong>Criaturas:</strong> ${workspace.creatures.length}</div>
      </div>

      <button class="ark-btn ark-btn-blue">
        <span>Abrir ficha</span>
      </button>
    </div>
  `;

  topCardsEl.appendChild(player);

  // CRIATURA PRINCIPAL
  const main = workspace.creatures[0];

  if(main){

    const card = document.createElement('div');
    card.className = "hud-card hud-card-small";

    card.innerHTML = `
      <div class="hud-card-frame"></div>

      <div class="hud-card-inner">
        <h2>${main.nome}</h2>

        <div class="meta-stack">
          <div>${main.especie}</div>
          <div>Nível ${main.nivel}</div>
        </div>

        <div class="btn-row">
          <button class="ark-btn ark-btn-blue"><span>Abrir</span></button>
          <button class="ark-btn ark-btn-orange"><span>Transferir</span></button>
          <button class="ark-btn ark-btn-red"><span>Apagar</span></button>
        </div>
      </div>
    `;

    topCardsEl.appendChild(card);
  }

  // NOVA CRIATURA
  const add = document.createElement('div');
  add.className = "hud-card hud-card-small";

  add.innerHTML = `
    <div class="hud-card-frame"></div>

    <div class="hud-card-inner">
      <h2>Nova criatura</h2>

      <div class="meta-stack">
        <div>Criar nova criatura</div>
      </div>

      <button class="ark-btn ark-btn-green" id="btnCreate">
        <span>Criar</span>
      </button>
    </div>
  `;

  topCardsEl.appendChild(add);

  document.getElementById("btnCreate").onclick = () => openModal(createModal);
}

// ============================
// RENDER CRIATURAS
// ============================

function renderCreatures(){

  creatureListEl.innerHTML = "";

  workspace.creatures.forEach(c => {

    const img = getCreatureImage(c);

    const el = document.createElement('div');
    el.className = "creature-card";

    el.innerHTML = `
      <div class="hud-card-frame"></div>

      <div class="creature-inner">

        <div class="creature-img">
          ${
            img
            ? `<img src="${img}">`
            : `<div class="placeholder">${c.nome.charAt(0)}</div>`
          }
        </div>

        <div class="creature-info">

          <div class="creature-name">${c.nome}</div>

          <div class="bar">
            <div class="fill vida" style="width:80%"></div>
          </div>

          <div class="bar">
            <div class="fill stamina" style="width:60%"></div>
          </div>

          <div class="bar">
            <div class="fill peso" style="width:40%"></div>
          </div>

          <div class="btn-row">
            <button class="ark-btn ark-btn-blue"><span>Abrir</span></button>
            <button class="ark-btn ark-btn-orange"><span>Liberar</span></button>
          </div>

        </div>
      </div>
    `;

    creatureListEl.appendChild(el);
  });
}

// ============================
// CREATE
// ============================

async function createCreature(){

  const name = document.getElementById('newCreatureName').value || "Criatura";
  const template = TEMPLATES.find(t => t.key === templateSelect.value);

  const creature = {
    id: Date.now(),
    nome: name,
    especie: template.label,
    nivel: 1,
    baseVida: template.baseVida
  };

  workspace.creatures.push(creature);

  await saveWorkspace(currentUser.uid, {
    creatures: clone(workspace.creatures)
  });

  closeModal(createModal);
  renderAll();
}

// ============================
// INIT
// ============================

async function init(){

  currentUser = await waitForAuth();

  if(!currentUser){
    location.href = "../index.html";
    return;
  }

  await upsertUserProfile(currentUser);

  workspace = await getWorkspace(currentUser.uid) || {
    ownerName: currentUser.displayName,
    creatures: []
  };

  subtitleEl.textContent = `Bem-vindo ${workspace.ownerName}`;
  statusEl.textContent = `${workspace.creatures.length} criatura(s)`;

  renderAll();

  document.getElementById("logoutBtn").onclick = async () => {
    await logout();
    location.href = "../index.html";
  };

  document.getElementById("confirmCreateCreatureBtn")
    .onclick = createCreature;

  document.getElementById("cancelCreateCreatureBtn")
    .onclick = () => closeModal(createModal);
}

// ============================
// MASTER
// ============================

function renderAll(){
  renderTopCards();
  renderCreatures();
}

init();
