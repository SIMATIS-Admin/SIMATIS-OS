/* Stratégie et génération de la demande : plan d'action, démarrage, diagnostic, détection, prospection, bases. */

/* ---------- Plan d'action en 7 blocs ---------- */
const PLAN_SUGG = {
  'Information et outillage': 'Pipeline natif tenu dans l\'OS, liste de prescripteurs dans une base vivante, veille sur les appels à projets.',
  'Message': 'Enjeu : sécuriser la ressource et réduire les coûts d\'exploitation. Leviers dominants : Argent, Sécurité. Accroche par les aides mobilisables.',
  'Règles de qualification': 'Grille sur 15, avec un critère budget lu « aide obtenue ou en cours ». Au-dessus de 12 : visite. Entre 8 et 11 : nourrir.',
  'Plan de canaux': 'Prescripteurs institutionnels et salons régionaux d\'abord, puis appels ciblés. Pas d\'automatisation tant que le message n\'est pas éprouvé.',
  'Pilotage': 'Clients pilotes signés, rendez-vous obtenus, opportunités qualifiées, pipeline par score. Revue hebdomadaire avec l\'exécutant.'
};
VIEWS.plan = () => {
  const p = D().plan, ok = p.filter(b => b.ok).length;
  return {
    title: "Plan d'action commercial",
    actions: `<span class="badge ${ok === 7 ? 'green' : 'amber'}">${ok} blocs validés sur 7</span>`,
    body: `<div class="panel"><div class="panel-b">${p.map((b, k) => `<div class="plan-b ${b.ok ? 'ok' : ''}">
      <span class="k">${b.ok ? ic('check').replace('stroke-width="1.8"', 'stroke-width="3" width="14" height="14"') : k + 1}</span>
      <div><h3>${esc(b.b)}</h3>${S.planEdit === k
        ? `<textarea class="input" id="plan-txt" style="margin-top:6px">${esc(b.txt)}</textarea><div style="margin-top:8px;display:flex;gap:8px"><button class="btn primary sm" data-act="plan-save" data-k="${k}">Enregistrer</button><button class="btn ghost sm" data-act="plan-cancel">Annuler</button></div>`
        : b.txt ? `<p style="margin-top:4px;color:var(--ink-2)">${esc(b.txt)}</p>${b.propose ? who('os') + ' <span class="small muted">à relire</span>' : ''}` : `<p class="muted" style="margin-top:4px">À rédiger.</p>`}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${S.planEdit === k ? '' : `
        ${!b.txt && PLAN_SUGG[b.b] ? `<button class="btn sm" data-act="plan-sugg" data-k="${k}">Proposer une rédaction</button>` : ''}
        <button class="btn ghost sm" data-act="plan-edit" data-k="${k}">Modifier</button>
        ${b.txt && !b.ok ? `<button class="btn go sm" data-act="plan-ok" data-k="${k}">Valider</button>` : ''}`}</div>
    </div>`).join('')}</div></div>
    <p class="small muted" style="margin-top:12px">Les propositions de l'OS partent du socle commercial et des méthodes du second cerveau. Elles restent des brouillons tant que vous ne les validez pas.</p>`
  };
};
Object.assign(ACTIONS, {
  'plan-edit': ds => { S.planEdit = +ds.k; render(); document.getElementById('plan-txt')?.focus(); },
  'plan-cancel': () => { S.planEdit = null; render(); },
  'plan-save': ds => { const b = D().plan[+ds.k]; b.txt = document.getElementById('plan-txt').value.trim(); b.propose = false; S.planEdit = null; logAction(`Plan d'action modifié : ${b.b}`, 'L1'); render(); toast('Bloc enregistré'); },
  'plan-sugg': ds => { const b = D().plan[+ds.k]; b.txt = PLAN_SUGG[b.b]; b.propose = true; logAction(`Rédaction proposée : ${b.b}`, 'L1', 'os'); render(); toast("Proposition de l'OS ajoutée, à relire"); },
  'plan-ok': ds => { const b = D().plan[+ds.k]; b.ok = true; b.propose = false; logAction(`Bloc validé : ${b.b}`, 'L1'); render(); toast('Bloc validé'); }
});

/* ---------- Démarrage d'un mandat ---------- */
VIEWS.demarrage = () => {
  const inst = INST();
  const sits = [
    ['Système à structurer', 'Des outils et une équipe existent, il faut les organiser et les piloter.'],
    ['Système à créer', 'Pas de processus commercial : on construit, puis un exécutant côté client fait tourner.'],
    ['Structure à positionner', 'Une structure jeune : offre, contenus et premiers canaux à poser.']
  ];
  const D0 = D(); D0.demarrage = D0.demarrage || [true, true, false, false, false, false, false, false];
  const steps = ['Entretien de démarrage avec le dirigeant', 'Fiche d\'instance créée (comptes, règles, autonomie)', 'Socle commercial validé : offres, cas clients, aides, critères', 'Cible et segments prioritaires', 'Plan d\'action en sept blocs', 'Pipeline natif ou CRM léger mis en place avec le client', 'Liste des prescripteurs institutionnels', 'Programme de clients pilotes'];
  const n = D0.demarrage.filter(Boolean).length;
  return {
    title: 'Démarrage du mandat',
    body: `<div class="grid g3">${sits.map(([t, d]) => `<div class="panel panel-b" style="${t === inst.situation ? 'border-color:var(--teal);box-shadow:inset 0 0 0 1px var(--teal)' : ''}"><h3>${t}</h3><p class="small" style="margin-top:6px;color:var(--ink-2)">${d}</p>${t === inst.situation ? '<span class="badge green">Situation de ce mandat</span>' : ''}</div>`).join('')}</div>
    <div class="panel" style="margin-top:18px"><div class="panel-h"><h2>Étapes</h2><span class="badge">${n} sur ${steps.length}</span></div><div class="panel-b">
      ${steps.map((s, k) => `<label class="check"><input type="checkbox" ${D0.demarrage[k] ? 'checked' : ''} data-change="dem" data-k="${k}"><span>${s}${k === 2 && pending() ? ' <a href="#" data-act="go" data-v="validations" class="small">proposition à valider</a>' : ''}${k === 4 ? ' <a href="#" data-act="go" data-v="plan" class="small">ouvrir le plan</a>' : ''}</span></label>`).join('')}
    </div></div>`
  };
};
ACTIONS.dem = (ds, el) => { D().demarrage[+ds.k] = el.checked; render(); };

/* ---------- Diagnostic d'Endurance Commerciale ---------- */
const DIMS = [['outils', 'Outils et méthode'], ['strategie', 'Stratégie, régularité, endurance'], ['polyvalence', 'Polyvalence']];
const PROFILS = [
  { nom: 'Joggeur', d: 'Pas encore d\'outils, de méthode ni de stratégie. Fonctionne tant que la concurrence est faible.' },
  { nom: 'Sprinteur', d: 'Outils et méthode en place, mais l\'effort se fait par à-coups et s\'épuise sur les ventes longues.' },
  { nom: 'Marathonien', d: 'Stratégie et régularité sur le temps long, mais spécialisé sur son marché.' },
  { nom: 'Ultra-endurant', d: 'Le profil complet : en plus, polyvalent sur d\'autres marchés.' }
];
const SEUIL = 6;
function profil(dims) { let k = 0; for (const [id] of DIMS) { if (dims[id] >= SEUIL) k++; else break; } return PROFILS[k]; }
function radar(dims) {
  const cx = 160, cy = 140, R = 105, ang = k => -Math.PI / 2 + k * 2 * Math.PI / 3;
  const pt = (k, v) => [cx + Math.cos(ang(k)) * R * v / 10, cy + Math.sin(ang(k)) * R * v / 10];
  const ring = v => DIMS.map((_, k) => pt(k, v).join(',')).join(' ');
  const poly = DIMS.map(([id], k) => pt(k, dims[id]).join(',')).join(' ');
  return `<svg class="radar" viewBox="0 0 320 280" width="320" height="280" style="max-width:100%" role="img" aria-label="Radar des trois dimensions">
    ${[2.5, 5, 7.5, 10].map(v => `<polygon points="${ring(v)}" fill="none" stroke="#DCE3EC"/>`).join('')}
    <polygon points="${ring(SEUIL)}" fill="none" stroke="#C98A12" stroke-dasharray="4 3"/>
    <polygon points="${poly}" fill="rgba(65,165,148,.25)" stroke="#41A594" stroke-width="2"/>
    ${DIMS.map(([id, l], k) => { const [x, y] = pt(k, 12.2); return `<text x="${x}" y="${y}" text-anchor="middle">${l.split(',')[0]}</text>`; }).join('')}
  </svg>`;
}
const ETAPES_DIAG = ['Préparer la présentation', 'Entretien et rapport d\'outil', 'Analyser et produire le rapport'];
const libelle = (liste, v) => (liste.find(([k]) => k === v) || [, v])[1];

/* Résultat d'un diagnostic : radar, profil et barres. Repris par l'étape 3 du projet et par le mandat. */
function diagResultat(x) {
  const p = profil(x.dims);
  return `<div class="profil">${radar(x.dims)}<div style="flex:1;min-width:220px"><div class="small muted">Profil</div><div style="font:800 30px var(--f-title);color:var(--navy)">${p.nom}</div><p style="color:var(--ink-2)">${p.d}</p>
      <div class="bars">${DIMS.map(([id, l]) => `<div class="row"><span>${l}</span><div class="bar" style="width:${x.dims[id] * 10}%;background:${x.dims[id] >= SEUIL ? 'var(--teal)' : 'var(--ink-3)'}"></div><span class="v">${x.dims[id].toFixed(1)}</span></div>`).join('')}</div>
      <p class="small muted">Lecture en cascade : une dimension ne compte que si la précédente atteint le seuil (pointillés).</p></div></div>`;
}

/* Un projet porte son activité (modèle fictif), son contexte, son étape, le diagnostic importé, le mandat créé et,
   pour chaque étape, la conversation avec l'assistant (modèle et effort choisis). */
const activiteDe = p => byId(SECTEURS, p.activite) || SECTEURS[SECTEURS.length - 1];
const chatDe = (p, n) => ({ ...CHAT_DEFAUT[n], messages: [], ...((p.chats || {})[n] || {}) });
const chatSet = (p, n, patch) => { p.chats = { ...(p.chats || {}), [n]: { ...chatDe(p, n), ...patch } }; };
const etapeFaite = (p, n) => n === 1 ? !!(p.nom && p.contexte) : n === 2 ? !!p.diag : !!p.mandat;

/* Vue Diagnostic : projets en trois étapes sur SIMATIS seulement. Un mandat n'y voit que le résultat de son diagnostic. */
VIEWS.diagnostic = () => {
  if (INST().type !== 'propre') return diagMandat();
  const projets = D().projets || [];
  const sel = byId(projets, S.projSel);
  return {
    title: "Diagnostic d'Endurance Commerciale",
    actions: sel ? '' : `<button class="btn go" data-act="proj-nouveau">Nouveau projet</button>`,
    body: sel ? diagProjet(sel) : diagListe(projets),
    /* Le fil de l'assistant reste collé au dernier message. */
    after: () => { document.querySelectorAll('.chat-log').forEach(l => { l.scrollTop = l.scrollHeight; }); }
  };
};

function diagListe(projets) {
  const formulaire = S.projForm ? `<div class="panel" style="margin-bottom:14px"><div class="panel-h"><h2>Nouveau projet</h2></div><div class="panel-b dstack">
    <div class="champs2"><label class="champ"><span>Nom de l'entreprise</span><input id="pj-nom" type="text" placeholder="Ex. Atelier Fictif Nord"></label>
    <label class="champ"><span>Activité</span><select id="pj-act">${SECTEURS.map(s => `<option value="${s.id}">${esc(s.nom)}</option>`).join('')}</select></label></div>
    <div class="row"><button class="btn go" data-act="proj-nouveau-ok">Créer et préparer</button><button class="btn" data-act="proj-nouveau-annuler">Annuler</button></div>
    <p class="small muted" style="margin:0">Le projet s'enregistre au fil de l'eau : vous pouvez le quitter et le reprendre à la même étape.</p></div></div>` : '';
  const liste = projets.length
    ? `<div class="panel"><div class="panel-h"><h2>Projets</h2><span class="muted small">${projets.length} en cours</span></div><div class="panel-b">${projets.map(p => `<button class="vq-item" data-act="proj-open" data-id="${p.id}"><div class="row1"><b>${esc(p.nom)}</b><span class="badge">Étape ${p.etape} · ${ETAPES_DIAG[p.etape - 1]}</span></div><small>${esc(activiteDe(p).nom)}, modifié le ${fdate(p.modif)}${p.mandat ? ' · mandat créé' : ''}</small></button>`).join('')}</div></div>`
    : `<div class="panel empty">Aucun projet. Créez-en un pour préparer le premier entretien.</div>`;
  return formulaire + liste;
}

function diagProjet(p) {
  const etapes = ETAPES_DIAG.map((l, i) => `<button class="etape ${p.etape === i + 1 ? 'on' : ''} ${etapeFaite(p, i + 1) ? 'fait' : ''}" data-act="proj-etape" data-id="${p.id}" data-n="${i + 1}" ${p.etape === i + 1 ? 'aria-current="step"' : ''}><span class="num">${etapeFaite(p, i + 1) ? '✓' : i + 1}</span><span>${l}</span></button>`).join('');
  const corps = [etapePreparer, etapeEntretien, etapeAnalyse][p.etape - 1](p);
  return `<div class="proj-head"><div><h2>${esc(p.nom)}</h2><div class="small muted">${esc(activiteDe(p).nom)}, modifié le ${fdate(p.modif)}</div></div><button class="btn" data-act="proj-retour">← Tous les projets</button></div>
  <div class="etapes">${etapes}</div>
  <div class="diag-layout"><div class="diag-main">${corps}</div>${chatPanel(p, p.etape)}</div>`;
}

/* Pied d'étape : on peut toujours aller à l'étape voisine, sans être bloqué par ce qui reste à faire. */
const pied = (p, n) => `<div class="pied">${n > 1 ? `<button class="btn" data-act="proj-etape" data-id="${p.id}" data-n="${n - 1}">← Étape précédente</button>` : '<span></span>'}${n < 3 ? `<button class="btn go" data-act="proj-etape" data-id="${p.id}" data-n="${n + 1}">Étape suivante →</button>` : ''}</div>`;

const etapePreparer = p => `<div class="panel"><div class="panel-h"><h2>Contexte de l'entreprise</h2><span class="muted small">Enregistré au fil de l'eau</span></div><div class="panel-b dstack">
  <div class="champs2">
    <label class="champ"><span>Nom de l'entreprise</span><input type="text" value="${esc(p.nom)}" data-change="proj-champ" data-id="${p.id}" data-champ="nom"></label>
    <label class="champ"><span>Activité</span><select data-change="proj-champ" data-id="${p.id}" data-champ="activite">${SECTEURS.map(s => `<option value="${s.id}" ${s.id === p.activite ? 'selected' : ''}>${esc(s.nom)}</option>`).join('')}</select></label>
  </div>
  <label class="champ"><span>Ce que le dirigeant vous a dit</span><textarea rows="5" data-change="proj-champ" data-id="${p.id}" data-champ="contexte" placeholder="Activité, clients, projet du dirigeant, ce qui bloque aujourd'hui">${esc(p.contexte)}</textarea></label>
  <p class="small muted" style="margin:0">Ce contexte alimente le support et le chat de préparation. Rien n'est envoyé à l'extérieur.</p>
  <div class="cartes">
    <div class="carte"><b>Support de présentation</b><small>Version 2, adaptée à l'entreprise</small><button class="btn" disabled title="Support : non inclus dans la maquette">Ouvrir le support</button></div>
  </div>
  ${pied(p, 1)}</div></div>`;

const etapeEntretien = p => {
  const rapport = p.diag
    ? `<div class="ok-note">Rapport importé. Passez à l'analyse, ou retirez-le si l'import était une erreur.</div><div class="row"><button class="btn" data-act="proj-import-retirer" data-id="${p.id}">Retirer le rapport</button></div>`
    : `<div class="dz">Déposer le rapport tel que fourni par l'outil de diagnostic<br><span class="small muted">PDF ou CSV</span></div><div class="row"><button class="btn" data-act="proj-import" data-id="${p.id}">Importer le rapport (simulation)</button></div><p class="small muted" style="margin:0">La maquette simule l'import avec un résultat d'exemple.</p>`;
  return `<div class="panel"><div class="panel-h"><h2>Rapport de l'outil externe</h2></div><div class="panel-b dstack">${rapport}</div></div>
  <div class="panel"><div class="panel-h"><h2>Formulaire de revue</h2><span class="badge amber">12 sur 18</span></div><div class="panel-b dstack"><p style="color:var(--ink-2);margin:0">Vos commentaires sur chaque rubrique. Vous pouvez y revenir sur plusieurs jours.</p><div class="progress"><i style="width:67%"></i></div><div class="row"><button class="btn" disabled title="Formulaire de revue : non inclus dans la maquette">Ouvrir le formulaire</button></div></div></div>
  ${pied(p, 2)}`;
};

const etapeAnalyse = p => {
  const x = byId(D().diagnostics, p.diag);
  if (!x) return `<div class="panel empty">Aucun rapport importé. Revenez à l'étape 2 pour l'importer.</div>${pied(p, 3)}`;
  const mandat = p.mandat
    ? `<button class="btn" data-act="proj-mandat-ouvrir" data-id="${p.id}">Ouvrir le mandat</button>`
    : `<button class="btn" data-act="proj-mandat" data-id="${p.id}">Créer le mandat prospect fictif</button>`;
  return `<div class="panel"><div class="panel-h"><h2>Résultat</h2><span class="badge ${x.statut === 'Restitué' ? 'green' : 'amber'}">${esc(x.statut)}</span></div><div class="panel-b">${diagResultat(x)}</div>
    <div class="decision"><button class="btn go" data-act="diag-rapport" data-id="${x.id}">Préparer le rapport</button><button class="btn" data-act="go" data-v="plan">Construire le plan d'action</button>${mandat}<span class="hint">Le mandat reprend l'activité, les offres et le plan de ce projet, avec des données fictives.</span></div></div>
  ${pied(p, 3)}`;
};

/* Assistant Claude de l'étape : modèle et effort choisis par l'utilisateur, conversation gardée par projet. */
function chatPanel(p, n) {
  const c = chatDe(p, n);
  const titre = ['Préparation', 'Entretien', 'Rapport'][n - 1];
  const messages = c.messages.length
    ? c.messages.map(m => `<div class="msg ${m.role}"><small>${m.role === 'user' ? 'Vous' : `Assistant${m.simule ? ' · simulé dans la maquette' : ''}`}</small><p>${esc(m.txt)}</p></div>`).join('')
    : `<p class="muted small" style="margin:0">Posez une question sur ce projet. Le chat part avec le contexte, le rapport importé et les résultats.</p>`;
  const options = (liste, val) => liste.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('');
  return `<aside class="panel chat" aria-label="Assistant Claude, étape ${titre.toLowerCase()}">
    <div class="panel-h"><div><h2>Assistant · ${titre}</h2><div class="small muted">Chat Claude de ce projet</div></div></div>
    <div class="panel-b dstack">
      <div class="chat-cfg">
        <label>Modèle<select data-change="proj-chat-cfg" data-id="${p.id}" data-n="${n}" data-champ="modele">${options(MODELES, c.modele)}</select></label>
        <label>Effort<select data-change="proj-chat-cfg" data-id="${p.id}" data-n="${n}" data-champ="effort">${options(EFFORTS, c.effort)}</select></label>
      </div>
      <div class="chat-log">${messages}</div>
      <div class="chat-form"><textarea id="chat-in-${n}" rows="2" placeholder="Votre message"></textarea><button class="btn go" data-act="proj-chat-envoyer" data-id="${p.id}" data-n="${n}">Envoyer</button></div>
      <p class="small muted" style="margin:0">Maquette : la réponse est simulée. Le vrai chat utilise le modèle et l'effort choisis ici.</p>
    </div></aside>`;
}

/* Vue d'un mandat : résultat du dernier diagnostic, plan d'action en résumé, auto-diagnostic VMA à venir. */
function diagMandat() {
  const list = D().diagnostics; const x = list.find(d => d.statut === 'Restitué') || list[0];
  if (!x) return { title: 'Diagnostic', body: '<div class="panel empty">Aucun diagnostic pour ce mandat.</div>' };
  return {
    title: 'Diagnostic',
    body: `<div class="grid g-main"><div class="panel"><div class="panel-h"><div><h2>Dernier diagnostic</h2><div class="small muted">Entretien du ${fdate(x.date)}</div></div><span class="badge ${x.statut === 'Restitué' ? 'green' : 'amber'}">${esc(x.statut)}</span></div><div class="panel-b">${diagResultat(x)}</div></div>
    <div class="panel"><div class="panel-h"><h2>Plan d'action, en résumé</h2></div><div class="panel-b">${D().plan.map(b => `<div class="plan-b ${b.ok ? 'ok' : ''}"><span class="k">${b.ok ? '✓' : ''}</span><div><b>${esc(b.b)}</b><p class="small muted" style="margin:2px 0 0">${esc(b.txt || 'Pas encore renseigné')}</p></div></div>`).join('')}</div></div></div>
    <div class="panel" style="margin-top:14px;opacity:.75"><div class="panel-b"><b>Auto-diagnostic VMA</b> <span class="badge">Plus tard</span><p class="small muted" style="margin:6px 0 0">Le client pourra refaire le test seul depuis son espace diagnostic.</p></div></div>`
  };
}

Object.assign(ACTIONS, {
  'proj-nouveau': () => { S.projForm = true; render(); },
  'proj-nouveau-annuler': () => { S.projForm = false; render(); },
  'proj-nouveau-ok': () => {
    const champ = document.getElementById('pj-nom'); const nom = champ.value.trim();
    if (!nom) { champ.focus(); return; }
    const act = byId(SECTEURS, document.getElementById('pj-act').value) || SECTEURS[0];
    const p = { id: uid('pj'), nom, activite: act.id, contexte: '', etape: 1, diag: null, mandat: null, chats: {}, modif: dp(0) };
    D().projets = [p, ...(D().projets || [])]; S.projSel = p.id; S.projForm = false; render(); toast('Projet créé');
  },
  'proj-open': ds => { S.projSel = ds.id; render(); },
  'proj-retour': () => { S.projSel = null; render(); },
  'proj-etape': ds => { const p = byId(D().projets, ds.id); p.etape = Number(ds.n); p.modif = dp(0); render(); },
  /* Un champ modifié (nom, activité, contexte) est enregistré au moment où on quitte le champ. */
  'proj-champ': (ds, el) => {
    const p = byId(D().projets, ds.id); p[ds.champ] = el.value.trim() === '' && ds.champ === 'nom' ? p.nom : el.value; p.modif = dp(0); render();
  },
  /* Simulation de l'import : l'outil externe fournit un rapport, ici un résultat d'exemple. */
  'proj-import': ds => {
    const p = byId(D().projets, ds.id);
    const s = { id: uid('s'), nom: p.nom, secteur: activiteDe(p).nom, ville: '', taille: 0, domaine: '' };
    const x = { id: uid('dg'), soc: s.id, date: dp(0), statut: 'Rapport à rédiger', dims: { outils: 6.4, strategie: 4.1, polyvalence: 2.3 } };
    D().societes.push(s); D().diagnostics.unshift(x); p.diag = x.id; p.modif = dp(0); render(); toast('Rapport importé (simulation)');
  },
  'proj-import-retirer': ds => { const p = byId(D().projets, ds.id); p.diag = null; p.modif = dp(0); render(); },
  /* Le mandat part de l'activité, des offres, du plan et du diagnostic du projet. On reste sur le projet. */
  'proj-mandat': ds => {
    const p = byId(D().projets, ds.id); const act = activiteDe(p); const x = byId(D().diagnostics, p.diag);
    p.mandat = creerMandatProspect(p.nom, `Mandat prospect · ${act.nom}`, { ouvrir: false, adapt: data => adaptMandat(data, act, x) });
    p.modif = dp(0); render();
  },
  'proj-mandat-ouvrir': ds => { const p = byId(D().projets, ds.id); go('diagnostic', p.mandat); },
  /* Choix du modèle ou de l'effort : propre à l'étape, gardé avec le projet. */
  'proj-chat-cfg': (ds, el) => { const p = byId(D().projets, ds.id); chatSet(p, Number(ds.n), { [ds.champ]: el.value }); render(); },
  'proj-chat-envoyer': ds => {
    const p = byId(D().projets, ds.id); const n = Number(ds.n); const champ = document.getElementById(`chat-in-${n}`);
    const txt = champ.value.trim(); if (!txt) { champ.focus(); return; }
    const c = chatDe(p, n);
    chatSet(p, n, { messages: [...c.messages, { role: 'user', txt }, { role: 'assistant', simule: true, txt: `Avec ${libelle(MODELES, c.modele)}, effort ${libelle(EFFORTS, c.effort).toLowerCase()}, le chat réel répondrait ici à partir du contexte de ce projet.` }] });
    render(); document.getElementById(`chat-in-${n}`)?.focus();
  },
  'diag-rapport': ds => {
    const x = byId(D().diagnostics, ds.id);
    D().validations.unshift({ id: uid('v'), type: 'note', niv: 'L1', titre: 'Rapport de diagnostic à relire', soc: x.soc, origine: 'Diagnostic', detail: `Brouillon de rapport pour ${soc(x.soc).nom} : profil ${profil(x.dims).nom}, trois préconisations prioritaires tirées de la bibliothèque, plan d'action en sept blocs en annexe.`, destination: 'Document client (brouillon)', source: 'Grille de scoring + bibliothèque de préconisations', confiance: 'à relire' });
    logAction(`Rapport de diagnostic préparé : ${soc(x.soc).nom}`, 'L1', 'os'); render(); toast('Rapport préparé, à relire dans À valider');
  }
});

/* ---------- Détection ---------- */
VIEWS.detection = () => {
  const d = D(); const sig = d.signaux.filter(s => !s.traite);
  const sources = d.veille || (d.veille = { 'Offres d\'emploi publiques': true, 'Presse régionale': true, 'Registres publics (créations, permis)': true, 'LinkedIn (changements de poste)': true, 'Appels d\'offres publics': false });
  return {
    title: 'Détection',
    body: `<div class="grid g-main"><div class="panel"><div class="panel-h"><h2>Signaux récents</h2><span class="muted small">${sig.length}</span></div>
      ${sig.length ? `<table class="tbl"><thead><tr><th>Société</th><th>Signal</th><th>Force</th><th></th></tr></thead><tbody>${sig.map(s => `<tr><td><b>${esc(s.soc)}</b><div class="small muted">${esc(s.type)}</div></td><td>${esc(s.txt)}<div class="small muted">Source : ${esc(s.source)}, ${rel(s.date)}</div></td><td><span class="badge ${s.force === 'fort' ? 'green' : ''}">${s.force}</span></td><td style="white-space:nowrap"><button class="btn sm" data-act="sig-opp" data-id="${s.id}">Créer une opportunité</button> <button class="btn ghost sm" data-act="sig-ign" data-id="${s.id}">Ignorer</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucun nouveau signal. La veille tourne chaque nuit.</div>'}</div>
      <div class="panel"><div class="panel-h"><h2>Sources de veille</h2>${gauge('L3')}</div><div class="panel-b">
        ${Object.entries(sources).map(([k, v]) => `<label class="check"><input type="checkbox" ${v ? 'checked' : ''} data-change="veille" data-k="${esc(k)}"><span>${esc(k)}</span></label>`).join('')}
        <p class="small muted" style="margin-top:8px">La veille lit des sources publiques. Aucune source tierce n'est interrogée à votre insu.</p></div></div></div>`
  };
};
Object.assign(ACTIONS, {
  veille: (ds, el) => { D().veille[ds.k] = el.checked; save(); toast(el.checked ? 'Source activée' : 'Source désactivée'); },
  'sig-ign': ds => { byId(D().signaux, ds.id).traite = true; render(); toast('Signal ignoré'); },
  'sig-opp': ds => {
    const s = byId(D().signaux, ds.id); s.traite = true;
    const sid = uid('s'); D().societes.push({ id: sid, nom: s.soc, secteur: 'À compléter', ville: '', taille: null, domaine: '' });
    const cid = uid('c'); D().contacts.push({ id: cid, soc: sid, nom: 'Interlocuteur à identifier', fonction: '', email: '', role: '' });
    D().opps.push({ id: uid('o'), soc: sid, contact: cid, titre: 'Opportunité détectée', etape: 'detection', montant: 0, score: { besoin: 1, decideur: 0, budget: 0, timing: 1, engagement: 0 }, potentiel: s.force === 'fort' ? 'eleve' : 'limite', faisab: 'faible', source: 'Signal : ' + s.type.toLowerCase(), echeance: dp(7), prochaine: 'Qualifier le signal', maj: dp(0) });
    logAction(`Opportunité créée depuis un signal : ${s.soc}`, 'L2'); render(); toast('Opportunité ajoutée au pipeline, étape Détection');
  }
});

/* ---------- Bases vivantes ---------- */
VIEWS.bases = () => {
  const d = D();
  const COUL = { 'Non contacté': '#B9C3D0', 'Pas de réponse': '#164A88', 'Réponse positive': '#2F8F5B', 'Réponse négative': '#C98A12', 'Invalide': '#C0442E' };
  const card = b => {
    const tot = Object.values(b.statuts).reduce((a, x) => a + x, 0);
    return `<div class="panel"><div class="panel-h"><div><h2>${esc(b.nom)}</h2><div class="small muted">${esc(b.emplacement)}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" data-act="base-import">Importer un fichier</button><button class="btn sm" data-act="base-enrich">Enrichir</button><button class="btn ghost sm" data-act="base-export">Exporter une vue</button></div></div>
      <div class="panel-b">${b.concurrent ? `<div class="alert amber" style="margin-bottom:14px">${ic('info')}<div>Le fichier a été modifié sur le Drive il y a 20 minutes par une autre personne. L'OS le relira avant toute écriture et ne l'écrasera pas.</div></div>` : ''}
      <div style="display:flex;height:16px;border-radius:4px;overflow:hidden;margin-bottom:10px">${Object.entries(b.statuts).map(([k, v]) => `<div title="${k} : ${v}" style="width:${v / tot * 100}%;background:${COUL[k]}"></div>`).join('')}</div>
      <div class="meta-row" style="margin-bottom:16px">${Object.entries(b.statuts).map(([k, v]) => `<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${COUL[k]};margin-right:5px"></i>${k} <b class="num">${v}</b></span>`).join('')}</div>
      <div class="grid g2"><div><h3>Descripteur</h3><table class="tbl small"><tbody>
        <tr><td class="muted">Onglets</td><td>${b.onglets.map(esc).join(', ')}</td></tr>
        <tr><td class="muted">Clé de dédoublonnage</td><td>Nom de société normalisé et domaine d'email (le domaine prime)</td></tr>
        <tr><td class="muted">Statuts</td><td>${Object.keys(b.statuts).join(', ')}</td></tr>
        <tr><td class="muted">Suivi</td><td>Nombre d'emails envoyés, premier et dernier envoi, date de réponse</td></tr>
        <tr><td class="muted">Fraîcheur</td><td>Contacts antérieurs à 2023 marqués anciens</td></tr>
        <tr><td class="muted">Utilisée par</td><td>Prospection : sélection des contacts et brouillons</td></tr>
        <tr><td class="muted">Connexion</td><td><span class="badge amber">À brancher</span> Base de données commune, en conception</td></tr></tbody></table></div>
      <div><h3>Instantanés</h3>${b.snap ? `<div class="alert blue" style="margin-top:8px">${ic('clock')}<div><b>${fdate(b.snap.date)}</b> ${esc(b.snap.label)}<div style="margin-top:6px"><button class="btn sm" data-act="base-restore" data-id="${b.id}">Restaurer</button></div></div></div>` : '<p class="small muted" style="margin-top:8px">Aucun instantané récent. Un instantané est pris automatiquement avant chaque modification de masse.</p>'}
      <h3 style="margin-top:14px">Garde-fous</h3><ul class="checks small"><li>Journal des statuts en ajout seul</li><li>Simulation avant toute modification de masse</li><li>Une valeur validée par un humain n'est jamais écrasée</li><li>Aucune suppression : archivage</li></ul></div></div></div></div>`;
  };
  return {
    title: 'Bases vivantes',
    actions: `<button class="btn primary" data-act="base-new">Créer une base</button>`,
    body: `<details class="help"><summary>${ic('info')}Qu'est-ce qu'une base vivante ?</summary><div class="help-b">
      <p style="margin-top:0">Une base vivante est un fichier de contacts que l'OS tient à jour au lieu de le figer : chaque envoi, réponse ou rebond met à jour le statut du contact.</p>
      <ol><li><b>Une source de référence.</b> Aujourd'hui un fichier (Drive, XLSX). Demain, la base de données commune en cours de conception. L'OS ne remplace pas la source, il la lit.</li>
      <li><b>L'OS l'entretient.</b> Il importe de nouvelles listes, écarte les doublons, complète les champs vides et tient un journal des statuts en ajout seul : qui a été contacté, quand, avec quelle réponse.</li>
      <li><b>La prospection y pioche.</b> Chaque sélection part d'une base vivante et retire automatiquement les contacts déjà sollicités, invalides ou exclus.</li></ol>
      <p class="small muted" style="margin-bottom:0">Rien n'est supprimé : on archive. Un instantané est pris avant toute modification de masse.</p></div></details>
    ${d.bases.length ? `<div class="stack">${d.bases.map(card).join('')}</div>` : `<div class="panel empty"><p>Pas encore de base pour cette instance.</p><p class="small">Partez d'un fichier (liste de salon, export) : l'OS propose un schéma, vous le validez.</p></div>`}`
  };
};
Object.assign(ACTIONS, {
  'base-restore': ds => { const b = byId(D().bases, ds.id); b.statuts['Invalide'] -= 14; b.statuts['Pas de réponse'] += 12; b.statuts['Non contacté'] += 2; logAction(`Instantané restauré : ${b.snap.label}`, 'L2'); b.snap = null; render(); toast('Base restaurée'); },
  'base-export': () => toast('Vue exportée en XLSX (simulation)'),
  'base-enrich': () => openModal('Enrichir la base', () => `<p>L'OS propose de compléter <b class="num">86</b> lignes sans secteur ni taille.</p><ul class="checks"><li>Sources : CRM du mandat, historique de messagerie, sites publics</li><li>Chaque valeur porte sa source, sa date et un niveau de confiance</li><li>Les valeurs saisies par un humain ne sont pas touchées</li></ul><div style="display:flex;gap:8px;margin-top:16px"><button class="btn go" data-act="base-enrich-ok">Lancer en simulation</button><button class="btn ghost" data-act="close">Annuler</button></div>`),
  'base-enrich-ok': () => { logAction('Enrichissement simulé : 86 lignes, 71 valeurs proposées', 'L2', 'os'); closeOver(); toast('Simulation prête : 71 valeurs proposées, à valider'); },
  'base-import': () => openModal('Importer un fichier', () => `<p>Fichier de démonstration : <b>exposants-salon-industrie.xlsx</b>, 180 lignes.</p><table class="tbl small"><tbody><tr><td>Colonnes reconnues</td><td class="num">7 sur 9</td></tr><tr><td>Doublons probables (domaine identique)</td><td class="num">12</td></tr><tr><td>Lignes sans email</td><td class="num">23</td></tr><tr><td>Repère temporel ajouté</td><td>Salon 2026</td></tr></tbody></table><div style="display:flex;gap:8px;margin-top:16px"><button class="btn go" data-act="base-import-ok">Importer 145 lignes</button><button class="btn ghost" data-act="close">Annuler</button></div>`),
  'base-import-ok': () => { const b = D().bases[0]; b.lignes += 145; b.statuts['Non contacté'] += 145; if (!b.onglets.includes('Salon 2026')) b.onglets.splice(-1, 0, 'Salon 2026'); logAction('Import : 145 lignes ajoutées (12 doublons écartés, 23 sans email mis de côté)', 'L2'); closeOver(); toast('145 lignes importées'); },
  'base-new': () => openModal('Créer une base', () => `<label class="field"><span>Nom</span><input class="input" id="nb-nom" value="Prescripteurs institutionnels"></label><label class="field"><span>Emplacement de référence</span><select class="input"><option>Fichier XLSX sur le Drive</option><option>Google Sheets</option><option>Base locale de l'instance</option></select></label><p class="small muted">L'OS proposera les colonnes à partir de votre besoin. L'emplacement de référence reste à décider.</p><div style="display:flex;gap:8px;margin-top:12px"><button class="btn go" data-act="base-new-ok">Créer</button><button class="btn ghost" data-act="close">Annuler</button></div>`),
  'base-new-ok': () => { const nom = document.getElementById('nb-nom').value || 'Nouvelle base'; D().bases.push({ id: uid('b'), nom, emplacement: 'Drive : Bases/' + nom.toLowerCase().replace(/\W+/g, '-') + '.xlsx', lignes: 0, onglets: ['Contacts', 'Synthèse'], statuts: { 'Non contacté': 0, 'Pas de réponse': 0, 'Réponse positive': 0, 'Réponse négative': 0, 'Invalide': 0 }, maj: dp(0) }); logAction(`Base créée : ${nom}`, 'L2'); closeOver(); toast('Base créée avec son descripteur'); }
});
