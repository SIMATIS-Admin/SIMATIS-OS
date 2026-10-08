/* Noyau de la maquette : état, navigation, interface commune. */

const STORE_KEY = 'simatis-os-maquette-v5';
const VIEWS = {};
const ACTIONS = {};
let S;

/* Favoris propres à l'utilisateur, pas à l'instance : ils suivent Marc d'un mandat à l'autre. */
const FAVS_DEFAUT = ['pipeline', 'brief', 'prospection'];
function freshState() { return { inst: 'simatis', view: 'brief', data: SEED(), vqFilter: 'tout', vqSel: null, pipeMode: 'board', menuOpen: false, favs: FAVS_DEFAUT.slice() }; }
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch (e) { /* stockage indisponible : on repart des données de démo */ }
  return freshState();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* idem */ } }

/* ---------- Utilitaires ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = () => S.data[S.inst];
const INST = () => INSTANCES.find(i => i.id === S.inst);
const byId = (arr, id) => arr.find(x => x.id === id);
const soc = id => byId(D().societes, id) || { nom: '?' };
const contact = id => byId(D().contacts, id) || { nom: '?' };
const eur = n => n == null ? '<span class="muted">à fixer</span>' : `<span class="num">${Math.round(n).toLocaleString('fr-FR')} €</span>`;
const eurTxt = n => Math.round(n).toLocaleString('fr-FR') + ' €';
const fdate = s => { if (!s) return ''; const d = new Date(s + 'T12:00:00'); return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); };
const diffDays = s => Math.round((new Date(s + 'T12:00:00') - TODAY) / 864e5);
const rel = s => { const n = diffDays(s); if (n === 0) return "aujourd'hui"; if (n === 1) return 'demain'; if (n === -1) return 'hier'; return n < 0 ? `il y a ${-n} j` : `dans ${n} j`; };
const total = sc => Object.values(sc).reduce((a, b) => a + b, 0);
function cat(t) {
  if (t >= 12) return { k: 'chaude', nom: 'Chaude', prio: 'Priorité 1', action: 'Visite ou rendez-vous de cadrage, pré-proposition, décideurs impliqués tôt.' };
  if (t >= 8) return { k: 'tiede', nom: 'Tiède', prio: 'Priorité 2', action: 'Nourrir (cas clients, contenus), élargir aux autres interlocuteurs, attendre un signal fort avant de proposer.' };
  if (t >= 4) return { k: 'faible', nom: 'Faible', prio: 'Priorité 3', action: 'Garder au radar : veille, relance trimestrielle.' };
  return { k: 'froid', nom: 'Non prioritaire', prio: 'Hors priorité', action: 'Classer en froid, se concentrer ailleurs.' };
}
const MATRICE = {
  'eleve-forte': { k: 'prio', nom: 'Prioriser', d: 'Temps humain, personnalisation, rendez-vous.' },
  'eleve-faible': { k: 'secu', nom: 'Sécuriser', d: 'Qualification complémentaire, réseau, influence sur les décideurs.' },
  'limite-forte': { k: 'expl', nom: 'Exploiter', d: 'Séquence standardisée ou semi-automatisée.' },
  'limite-faible': { k: 'ecart', nom: 'Écarter', d: 'Automatisation minimale ou abandon assumé.' }
};
const scoreBadge = sc => { const t = total(sc), c = cat(t); return `<span class="score ${c.k}" title="${c.nom}">${t}<small>/15</small></span>`; };
const gauge = niv => {
  if (niv === 'interdit') return `<span class="badge red">Interdit</span>`;
  const n = +niv.slice(1);
  return `<span class="gauge l${n}" title="${esc(NIVEAUX[niv].d)}"><i>${[0, 1, 2, 3].map(k => `<b class="${k <= n ? 'on' : ''}"></b>`).join('')}</i><strong>${niv}</strong> ${NIVEAUX[niv].nom}</span>`;
};
const tip = txt => `<span class="tip" tabindex="0" role="img" aria-label="${esc(txt)}" data-tip="${esc(txt)}">${ic('info')}</span>`;
const who = (par) => par === 'os' ? `<span class="who"><span class="dot"></span>Préparé par l'OS</span>` : `<span class="who pilote"><span class="dot"></span>Décidé par vous</span>`;
const pending = () => D().validations.filter(v => !v.statut).length;

function logAction(action, niv, par = 'pilote') { D().journal.unshift({ date: dp(0), par, action, niv }); }

/* ---------- Icônes ---------- */
const IC = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v7H2v-7z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  kanban: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  brain: '<path d="M9 3a3 3 0 00-3 3v.5A3 3 0 004 9.5 3 3 0 005 14a3 3 0 003 4 3 3 0 004 0V5a2 2 0 00-3-2z"/><path d="M15 3a3 3 0 013 3v.5a3 3 0 012 3 3 3 0 01-1 4.5 3 3 0 01-3 4 3 3 0 01-4 0"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/>'
};
const ic = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

/* ---------- Navigation ---------- */
/* Le groupe « later » regroupe les écrans reportés : encore accessibles, mais repliés par défaut. */
const NAV = [
  { g: 'Pilotage', items: [['routines', 'Routines Claude', 'clock'], ['brief', 'Brief du jour', 'sun'], ['validations', 'À valider', 'inbox'], ['tableau', 'Tableau de bord', 'chart']] },
  { g: 'Stratégie', items: [['demarrage', 'Démarrage du mandat', 'flag', 'demarrage']] },
  { g: 'Générer la demande', items: [['prospection', 'Prospection', 'send'], ['bases', 'Bases vivantes', 'db']] },
  { g: 'Convertir', items: [['pipeline', 'Pipeline', 'kanban'], ['entreprises', 'Entreprises', 'building'], ['contacts', 'Contacts', 'users'], ['agenda', 'Rendez-vous', 'cal'], ['devis', 'Devis', 'file', 'devis'], ['relais', 'Relais internes', 'users', 'relais']] },
  { g: 'Réglages', items: [['parametres', 'Paramètres', 'gear']] },
  { g: 'Plus tard', later: true, items: [['plan', "Plan d'action", 'map'], ['diagnostic', 'Diagnostic', 'radar', 'diagnostic'], ['detection', 'Détection', 'pulse'], ['autonomie', 'Autonomie', 'sliders'], ['journal', "Journal d'audit", 'list'], ['cerveau', 'Second cerveau', 'brain']] }
];
const NAV_ITEMS = NAV.flatMap(g => g.items);
const navItem = id => NAV_ITEMS.find(([v]) => v === id);
/* Un écran réservé à un module (Devis : brique propre à Marc) n'existe pas dans les autres instances. */
const allowed = (id, inst = INST()) => { const it = navItem(id); return !it || !it[3] || inst.modules.includes(it[3]); };
const isFav = id => (S.favs || []).includes(id);

function go(view, inst) {
  if (inst) S.inst = inst;
  if (S.view !== view) S.crmQ = '';
  S.view = view; S.menuOpen = false; S.instMenu = false;
  location.hash = `#/${S.inst}/${view}`;
  render(); window.scrollTo(0, 0);
}
function fromHash() {
  const m = location.hash.match(/^#\/([\w-]+)\/([\w-]+)/);
  if (m && S.data[m[1]]) { S.inst = m[1]; if (VIEWS[m[2]] || m[2] === 'portefeuille') S.view = m[2]; }
}

/* ---------- Rendu ---------- */
function shell(body, v) {
  const inst = INST();
  const link = ([id, l, i], fav) => {
    const n = id === 'validations' ? pending() : 0;
    return `<a href="#/${inst.id}/${id}" data-act="go" data-v="${id}" class="${S.view === id ? 'on' : ''}"${fav === true ? ` draggable="true" data-fav="${id}" title="Glisser pour réordonner"` : ''}>${ic(i)}<span class="lbl">${l}</span>${n ? `<span class="badge">${n}</span>` : ''}<span class="fav ${isFav(id) ? 'on' : ''}" data-act="fav" data-v="${id}" role="button" title="${isFav(id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${ic('star')}</span></a>`;
  };
  const favs = (S.favs || []).map(navItem).filter(it => it && allowed(it[0], inst));
  const laterOpen = S.navLater || NAV.find(g => g.later).items.some(([id]) => id === S.view);
  const nav = (favs.length ? `<div class="nav-group favs"><span>${ic('star')}Favoris</span>${favs.map(it => link(it, true)).join('')}</div>` : '') + NAV.map(g => {
    const items = g.items.filter(([id]) => allowed(id, inst));
    if (!items.length) return '';
    if (g.later) return `<div class="nav-group later"><button class="later-btn" data-act="nav-later" aria-expanded="${!!laterOpen}">${g.g}<span class="chev ${laterOpen ? 'open' : ''}">${ic('down')}</span></button>${laterOpen ? items.map(link).join('') : ''}</div>`;
    return `<div class="nav-group"><span>${g.g}</span>${items.map(link).join('')}</div>`;
  }).join('');
  const menu = S.instMenu ? `<div class="inst-menu" role="menu">${INSTANCES.map(i => `<button data-act="inst" data-id="${i.id}" class="${i.id === S.inst ? 'on' : ''}"><span class="inst-dot" style="background:${i.c}"></span><span><b>${esc(i.nom)}</b><small>${esc(i.sous)}</small></span></button>`).join('')}<hr><button data-act="go" data-v="portefeuille"><span class="inst-dot" style="background:var(--navy)"></span><span><b>Portefeuille</b><small>Vue transversale, métadonnées seulement</small></span></button></div>` : '';
  const demo = inst.demo ? `<div class="demo-band"><b>Démonstration.</b> Données fictives, aucun envoi possible.<div class="scenario">${DEMO_SCENARIO.map((s, k) => `<a href="#/demo/${s.v}" data-act="go" data-v="${s.v}" class="${S.view === s.v ? 'on' : ''}" title="${esc(s.d)}">${k + 1}. ${s.t}</a>`).join('')}</div><button class="btn sm" data-act="reset-demo">Réinitialiser la démo</button></div>` : '';
  return `<div class="app">
    <aside class="side ${S.menuOpen ? 'open' : ''}">
      <div class="brand"><div class="brand-mark">S</div><div class="brand-name">SIMATIS <span>OS</span></div></div>
      <button class="inst-btn" data-act="inst-menu" aria-expanded="${!!S.instMenu}"><span class="inst-dot" style="background:${S.view === 'portefeuille' ? 'var(--mint)' : inst.c}"></span><span>${S.view === 'portefeuille' ? '<b>Portefeuille</b><small>Toutes les instances</small>' : `<b>${esc(inst.nom)}</b><small>${esc(inst.sous)}</small>`}</span><span class="chev">${ic('down')}</span></button>
      ${menu}
      <nav class="nav">${nav}</nav>
      <div class="side-foot">Maquette, données fictives.<br>Outil connecté : ${esc(inst.outil)}.<br><button data-act="reset-all">Tout réinitialiser</button></div>
    </aside>
    <main class="main">${demo}
      <div class="top"><div><button class="btn ghost menu-btn" data-act="menu" aria-label="Menu">${ic('menu')}</button><h1>${v.title}</h1>${navItem(S.view) ? `<button class="fav-top ${isFav(S.view) ? 'on' : ''}" data-act="fav" data-v="${S.view}" title="${isFav(S.view) ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-pressed="${isFav(S.view)}">${ic('star')}</button>` : ''}</div><div class="top-actions">${v.actions || ''}</div></div>
      <div class="content">${body}</div>
    </main>
  </div>`;
}

function render() {
  const root = document.getElementById('root');
  if (S.view !== 'portefeuille' && !allowed(S.view)) { S.view = 'brief'; history.replaceState(null, '', `#/${S.inst}/brief`); }
  const viewId = S.view === 'portefeuille' ? 'portefeuille' : S.view;
  const V = VIEWS[viewId] || VIEWS.brief;
  const out = V();
  root.innerHTML = shell(out.body, out) + overlay();
  if (out.after) out.after();
  bindFavDrag();
  save();
}

/* Réordonner les favoris par glisser-déposer. Type MIME propre, pour ne pas être pris pour une carte du pipeline. */
const FAV_MIME = 'application/x-simatis-fav';
function bindFavDrag() {
  document.querySelectorAll('[data-fav]').forEach(a => {
    a.addEventListener('dragstart', e => { e.dataTransfer.setData(FAV_MIME, a.dataset.fav); e.dataTransfer.effectAllowed = 'move'; a.classList.add('dragging'); });
    a.addEventListener('dragend', () => a.classList.remove('dragging'));
    a.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes(FAV_MIME)) return;
      e.preventDefault(); const r = a.getBoundingClientRect(), apres = e.clientY > r.top + r.height / 2;
      a.classList.toggle('drop-before', !apres); a.classList.toggle('drop-after', apres);
    });
    a.addEventListener('dragleave', () => a.classList.remove('drop-before', 'drop-after'));
    a.addEventListener('drop', e => {
      const id = e.dataTransfer.getData(FAV_MIME); if (!id) return;
      e.preventDefault(); const apres = a.classList.contains('drop-after');
      const list = S.favs.filter(x => x !== id), k = list.indexOf(a.dataset.fav);
      list.splice(apres ? k + 1 : k, 0, id); S.favs = list; render();
    });
  });
}

/* ---------- Tiroir, fenêtre, notification ---------- */
let OVER = null;
function overlay() {
  if (!OVER) return '';
  if (OVER.kind === 'drawer') return `<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-label="${esc(OVER.title)}"><div class="drawer-h"><div>${OVER.head}</div><button class="btn ghost" data-act="close" aria-label="Fermer">${ic('x')}</button></div><div class="drawer-b">${OVER.body()}</div></aside>`;
  return `<div class="scrim" data-act="close"></div><div class="modal" role="dialog"><div class="panel-h"><h2>${OVER.title}</h2><button class="btn ghost" data-act="close" aria-label="Fermer">${ic('x')}</button></div><div class="panel-b">${OVER.body()}</div></div>`;
}
function openDrawer(head, body, title) { OVER = { kind: 'drawer', head, body, title: title || '' }; render(); }
function openModal(title, body) { OVER = { kind: 'modal', title, body }; render(); }
function closeOver() { OVER = null; render(); }
let toastT;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span class="dot"></span>${msg}`; document.body.appendChild(t);
  clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3200);
}

/* ---------- Actions communes ---------- */
Object.assign(ACTIONS, {
  go: (ds, el, e) => { e.preventDefault(); go(ds.v); },
  inst: ds => { S.instMenu = false; go(S.view === 'portefeuille' ? 'brief' : S.view, ds.id); },
  'inst-menu': () => { S.instMenu = !S.instMenu; render(); },
  fav: (ds, el, e) => {
    e.preventDefault(); e.stopPropagation();
    S.favs = isFav(ds.v) ? S.favs.filter(x => x !== ds.v) : [...(S.favs || []), ds.v];
    render(); toast(isFav(ds.v) ? 'Ajouté aux favoris' : 'Retiré des favoris');
  },
  'nav-later': () => { S.navLater = !S.navLater; render(); },
  menu: () => { S.menuOpen = !S.menuOpen; render(); },
  close: () => closeOver(),
  'reset-demo': () => { S.data.demo = SEED().demo; OVER = null; go('brief', 'demo'); toast('Démonstration réinitialisée'); },
  'reset-all': () => { if (confirm('Remettre toutes les données de la maquette à zéro ?')) { const keep = S.inst, favs = S.favs; S = freshState(); S.inst = keep; S.favs = favs; OVER = null; render(); toast('Maquette réinitialisée'); } }
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { if (S.instMenu && !e.target.closest('.inst-menu')) { S.instMenu = false; render(); } return; }
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el.dataset, el, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el && ACTIONS[el.dataset.change]) ACTIONS[el.dataset.change](el.dataset, el, e);
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]');
  if (el && ACTIONS[el.dataset.input]) ACTIONS[el.dataset.input](el.dataset, el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && OVER) closeOver();
  const el = e.target.closest('[data-act][tabindex]');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.click(); }
});
window.addEventListener('hashchange', () => { const before = S.inst + S.view; fromHash(); if (before !== S.inst + S.view) render(); });

function boot() { S = load(); if (!S.data || !S.data.demo) S = freshState(); if (!S.favs) S.favs = FAVS_DEFAUT.slice(); fromHash(); render(); }
