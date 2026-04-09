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
const topCardsEl = document.getElementById('dashboardTopCards');
const creatureListEl = document.getElementById('dashboardCreatureList');

const createModal = document.getElementById('createCreatureModal');
const transferModal = document.getElementById('transferCreatureModal');

const templateSelect = document.getElementById('newCreatureTemplate');
const transferTargetUser = document.getElementById('transferTargetUser');

const TEMPLATES = [
  { key: 'lobo', label: 'Lobo', baseVida: 100 },
  { key: 'urso', label: 'Urso', baseVida: 180 },
  { key: 'raptor', label: 'Raptor', baseVida: 120 },
  { key: 'custom', label: 'Custom', baseVida: 100 }
];

let currentUser = null;
let targetUid = null;
let workspace = null;
let allUsers = [];
let pendingTransferCreatureId = null;
let accessMode = 'owner';

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

/* ============================
   RENDER TOPO (CARDS DE CIMA)
============================ */

function renderTopCards(){

  topCardsEl.innerHTML = "";

  // Minha ficha
  const player = document.createElement('div');
  player.className = "card-small";

  player.innerHTML = `
    <div class="card-content">
      <h2>Minha ficha</h2>
      <div class="meta-stack">
        <div><strong>Jogador:</strong> ${workspace.ownerName || '---'}</div>
        <div><strong>Criaturas:</strong> ${workspace.creatures.length}</div>
      </div>
      <div class="card-actions">
        <button class="btn"><img src="../img/btn_blue.png"></button>
      </div>
    </div>
  `;

  topCardsEl.appendChild(player);

  // Criatura principal
  const main = workspace.creatures[0];

  if(main){
    const card = document.createElement('div');
    card.className = "card-small";

    const img = getCreatureImage(main);

    card.innerHTML = `
      <div class="card-content">
        <h2>${main.nome}</h2>
        <div class="meta-stack">
          <div>${main.especie}</div>
          <div>Nível ${main.nivel}</div>
        </div>
        <div class="card-actions">
          <button class="btn"><img src="../img/btn_blue.png"></button>
          <button class="btn"><img src="../img/btn_orange.png"></button>
          <button class="btn"><img src="../img/btn_red.png"></button>
        </div>
      </div>
    `;

    topCardsEl.appendChild(card);
  }

  // Nova criatura
  const add = document.createElement('div');
  add.className = "card-small";

  add.innerHTML = `
    <div class="card-content">
      <h2>Nova criatura</h2>
      <div class="meta-stack">
        <div>Criar nova criatura</div>
      </div>
      <div class="card-actions">
        <button class="btn" id="btnCreate">
          <img src="../img/btn_green.png">
        </button>
      </div>
    </div>
  `;

  topCardsEl.appendChild(add);

  document.getElementById("btnCreate").onclick = () => openModal(createModal);
}

/* ============================
   RENDER LISTA DE CRIATURAS
============================ */

function renderCreatures(){

  creatureListEl.innerHTML = "";

  workspace.creatures.forEach(c => {

    const img = getCreatureImage(c);

    const el = document.createElement('div');
    el.className = "creature-card";

    el.innerHTML = `
      <div class="creature-img">
        ${
          img
          ? `<img src="${img}">`
          : `<span>${c.nome.charAt(0)}</span>`
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

        <div class="actions">
          <button class="btn"><img src="../img/btn_blue.png"></button>
          <button class="btn"><img src="../img/btn_orange.png"></button>
        </div>
      </div>
    `;

    creatureListEl.appendChild(el);
  });
}

/* ============================
   CREATE
============================ */

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

  await saveWorkspace(targetUid, {
    creatures: clone(workspace.creatures)
  });

  closeModal(createModal);

  renderAll();
}

/* ============================
   INIT
============================ */

async function init(){

  currentUser = await waitForAuth();

  if(!currentUser){
    location.href = "../index.html";
    return;
  }

  await upsertUserProfile(currentUser);

  targetUid = currentUser.uid;

  workspace = await getWorkspace(targetUid) || {
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

/* ============================
   MASTER RENDER
============================ */

function renderAll(){
  renderTopCards();
  renderCreatures();
}

init();
