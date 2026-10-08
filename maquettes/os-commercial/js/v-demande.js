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
    title: "Plan d'action commercial", sub: 'Sept blocs, dans cet ordre. Chaque action découle d\'une décision, chaque décision d\'une qualification.',
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
    title: 'Démarrage du mandat', sub: 'La même méthode, adaptée à la situation de départ.',
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
VIEWS.diagnostic = () => {
  const list = D().diagnostics; const sel = byId(list, S.diagSel) || list[0];
  if (!sel) return { title: 'Diagnostic', body: '<div class="panel empty">Aucun diagnostic pour cette instance.</div>' };
  const p = profil(sel.dims);
  return {
    title: "Diagnostic d'Endurance Commerciale", sub: "Le profil commercial de l'entreprise, jamais celui d'une personne.",
    actions: `<button class="btn" disabled title="Le questionnaire d'entretien n'est pas inclus dans la maquette">Nouveau diagnostic</button>`,
    body: `<div class="grid g-main"><div class="panel"><div class="panel-h"><div><h2>${esc(soc(sel.soc).nom)}</h2><div class="small muted">Entretien du ${fdate(sel.date)}</div></div><span class="badge ${sel.statut === 'Restitué' ? 'green' : 'amber'}">${esc(sel.statut)}</span></div>
      <div class="panel-b"><div class="profil">${radar(sel.dims)}<div style="flex:1;min-width:220px"><div class="small muted">Profil</div><div style="font:800 30px var(--f-title);color:var(--navy)">${p.nom}</div><p style="color:var(--ink-2)">${p.d}</p>
      <div class="bars">${DIMS.map(([id, l]) => `<div class="row"><span>${l}</span><div class="bar" style="width:${sel.dims[id] * 10}%;background:${sel.dims[id] >= SEUIL ? 'var(--teal)' : 'var(--ink-3)'}"></div><span class="v">${sel.dims[id].toFixed(1)}</span></div>`).join('')}</div>
      <p class="small muted">Lecture en cascade : une dimension ne compte que si la précédente atteint le seuil (pointillés).</p></div></div></div>
      <div class="decision"><button class="btn go" data-act="diag-rapport" data-id="${sel.id}">Préparer le rapport</button><button class="btn" data-act="go" data-v="plan">Construire le plan d'action</button><span class="hint">Le rapport part de la bibliothèque de préconisations. Vous le relisez avant remise.</span></div></div>
      <div class="panel"><div class="panel-h"><h2>Diagnostics</h2></div><div class="panel-b">${list.map(x => `<button class="vq-item ${x === sel ? 'on' : ''}" data-act="diag-sel" data-id="${x.id}"><div class="row1"><b>${esc(soc(x.soc).nom)}</b><span class="badge">${profil(x.dims).nom}</span></div><small>${fdate(x.date)}, ${esc(x.statut)}</small></button>`).join('')}</div></div></div>`
  };
};
Object.assign(ACTIONS, {
  'diag-sel': ds => { S.diagSel = ds.id; render(); },
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
    title: 'Détection', sub: 'Repérer sans contacter. On détecte d\'abord, on prospecte ensuite.',
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

/* ---------- Prospection : sélection de campagne ---------- */
const REGLES = [
  { id: 'statuts', l: 'Croiser avec tous les journaux de statuts', d: 'Retire les contacts déjà contactés.', n: 0.34, fixe: true },
  { id: 'invalides', l: 'Exclure les contacts invalides ou hors service', d: 'Rebonds définitifs, départs, adresses mal formées.', n: 0.08, fixe: true },
  { id: 'publics', l: 'Exclure les organismes publics', d: 'Périmètre exclu par le mandat.', n: 0.05 },
  { id: 'clients', l: 'Exclure les comptes actifs du CRM', d: 'Vérifié par nom de société et par domaine d\'email.', n: 0.03, fixe: true },
  { id: 'expert', l: 'Exclure les comptes suivis par un expert sans accord préalable', d: 'Protège les relations existantes.', n: 0.017 },
  { id: 'historique', l: "Vérifier l'historique de messagerie et du CRM", d: 'Un échange récent retire le contact de la sélection.', n: 0.007, fixe: true }
];
const FICTIFS = { soc: ['Usinage Perret', 'Atelier Blanc', 'Cartonnerie Rivière', 'Forges de Saint-Clair', 'Plastiques Morel', 'Transports Ravier', 'Salaisons du Haut-Doubs', 'Thermique Delorme', 'Câblerie Viallon', 'Laboratoire Orvel', 'Menuiserie Ferraz', 'Brasserie du Lac', 'Imprimerie Mauduit', 'Peinture Industrielle Rey', 'Fromagerie Bouvard'], f: ['Directeur général', 'Responsable maintenance', 'Directrice de site', 'Responsable QSE', 'Gérant', 'Directeur technique'], o: ['Salon 2023', 'Anciens prospects', 'Contacts réseau', 'Sales Navigator'] };

VIEWS.prospection = () => {
  const d = D(), b = d.bases[0];
  if (!b) return { title: 'Prospection', sub: 'Sélection de contacts et brouillons, sans envoi automatique.', body: `<div class="panel empty"><p>Aucune base de prospection pour cette instance.</p><button class="btn primary" data-act="go" data-v="bases">Créer une base</button></div>` };
  const C = S.camp && S.camp.inst === S.inst ? S.camp : (S.camp = { inst: S.inst, step: 'config', on: Object.fromEntries(REGLES.map(r => [r.id, r.id !== 'expert' || INST().modules.includes('relais')])), limite: 30, mix: 60 });
  let reste = b.lignes; const lignes = REGLES.map((r, k) => { const n = Math.round(b.lignes * r.n); const on = C.on[r.id]; if (on) reste -= n; return { r, n, on, k }; });
  const nb = Math.min(C.limite, reste), nouv = Math.round(nb * C.mix / 100);
  const config = `<div class="grid g-main">
    <div class="panel"><div class="panel-h"><div><h2>Règles de sélection</h2><div class="small muted">Base : ${esc(b.nom)}, <span class="num">${b.lignes.toLocaleString('fr-FR')}</span> lignes</div></div>${gauge('L3')}</div>
      <div class="panel-b"><ol class="steps">${lignes.map(({ r, n, on, k }) => `<li class="${on ? '' : 'off'}"><span class="k">${k + 1}</span><div><b>${r.l}</b><div class="small muted">${r.d}</div></div><div style="text-align:right"><div class="minus">− ${n}</div>${r.fixe ? `<span class="lock" title="Règle toujours active">${ic('lock')}toujours</span>` : `<label class="small"><input type="checkbox" ${on ? 'checked' : ''} data-change="camp-rule" data-id="${r.id}"> active</label>`}</div></li>`).join('')}</ol></div></div>
    <div class="stack"><div class="panel panel-b"><div class="small muted">Contacts disponibles</div><div class="result-n">${reste}</div>
      <label class="field" style="margin-top:16px"><span>Contacts par exécution : <b class="num">${C.limite}</b></span><input type="range" min="10" max="50" step="5" value="${C.limite}" data-input="camp-lim" style="width:100%;accent-color:var(--navy)"></label>
      <label class="field"><span>Nouveaux contacts / relances : <b class="num">${C.mix} %</b> / <b class="num">${100 - C.mix} %</b></span><input type="range" min="0" max="100" step="10" value="${C.mix}" data-input="camp-mix" style="width:100%;accent-color:var(--navy)"></label>
      <button class="btn primary" style="width:100%;justify-content:center" data-act="camp-run">${ic('play')}Lancer la sélection en simulation</button>
      <p class="small muted" style="margin-top:10px">La simulation ne modifie rien. Vous voyez la liste avant tout brouillon.</p></div>
      ${d.campagnes.length ? `<div class="panel"><div class="panel-h"><h2>Campagnes précédentes</h2></div><table class="tbl small"><thead><tr><th>Date</th><th class="r">Brouillons</th><th class="r">Réponses</th><th class="r">RDV</th></tr></thead><tbody>${d.campagnes.map(c => `<tr><td>${fdate(c.date)}<div class="small muted">${esc(c.fichier)}</div></td><td class="r num">${c.brouillons}</td><td class="r num">${c.reponses}</td><td class="r num">${c.rdv}</td></tr>`).join('')}</tbody></table></div>` : ''}</div></div>`;
  if (C.step === 'config') return { title: 'Prospection', sub: 'La décision précède le canal : qui, et pourquoi, avant l\'outil.', body: config };
  const sel = C.liste;
  return {
    title: 'Prospection', sub: `Simulation : ${sel.length} contacts sélectionnés, rien n'est écrit.`,
    actions: `<button class="btn" data-act="camp-back">Revoir les règles</button>${C.step === 'resultat' ? `<button class="btn go" data-act="camp-draft">Préparer les ${sel.length} brouillons</button>` : ''}`,
    body: `${C.step === 'fait' ? `<div class="alert blue" style="margin-bottom:16px">${ic('check')}<div>${sel.length} brouillons préparés et regroupés dans <a href="#" data-act="go" data-v="validations">À valider</a>. Journal de statuts écrit en ajout seul : <b>${esc(C.fichier)}</b>.</div></div>` : ''}
    <div class="grid g-main"><div class="panel"><div class="panel-h"><h2>Contacts retenus</h2><span class="muted small">${nouv} nouveaux, ${sel.length - nouv} relances</span></div>
      <table class="tbl"><thead><tr><th>Société</th><th>Fonction</th><th>Origine</th><th>Type</th><th>Repère temporel</th></tr></thead><tbody>${sel.slice(0, 12).map(x => `<tr><td><b>${esc(x.soc)}</b></td><td>${esc(x.f)}</td><td>${esc(x.o)}</td><td><span class="badge ${x.t === 'Nouveau' ? 'blue' : ''}">${x.t}</span></td><td class="small">${esc(x.rep)}</td></tr>`).join('')}<tr><td colspan="5" class="muted small">et ${sel.length - 12} autres contacts</td></tr></tbody></table></div>
      <div class="panel"><div class="panel-h"><h2>Résumé de l'exécution</h2>${who('os')}</div><div class="panel-b report-col">
        <h4>Exclusions notables</h4><ul><li>2 sociétés écartées : compte actif trouvé par le domaine d'email alors que le nom différait</li><li>1 contact écarté : réponse reçue depuis une autre adresse il y a 3 semaines</li>${C.on.expert ? '<li>3 comptes en attente d\'accord préalable d\'un expert</li>' : ''}</ul>
        <h4>Sources utilisées</h4><ul><li>${esc(b.nom)}</li><li>${b.lignes > 1000 ? '7' : '3'} journaux de statuts</li><li>${esc(INST().outil)}, messagerie et agenda du mandat</li></ul>
        <h4>Ce que contiendront les brouillons</h4><ul><li>Vouvoiement, message court, « Bien à vous, » sans signature</li><li>Trois créneaux vérifiés dans l'agenda</li><li>Un repère temporel explicite</li></ul></div></div></div>`
  };
};
Object.assign(ACTIONS, {
  'camp-rule': (ds, el) => { S.camp.on[ds.id] = el.checked; render(); },
  'camp-lim': (ds, el) => { S.camp.limite = +el.value; const y = scrollY; render(); scrollTo(0, y); document.querySelector('[data-input="camp-lim"]')?.focus(); },
  'camp-mix': (ds, el) => { S.camp.mix = +el.value; const y = scrollY; render(); scrollTo(0, y); document.querySelector('[data-input="camp-mix"]')?.focus(); },
  'camp-back': () => { S.camp.step = 'config'; render(); },
  'camp-run': () => {
    const C = S.camp, n = C.limite, nouv = Math.round(n * C.mix / 100);
    C.liste = Array.from({ length: n }, (_, k) => { const o = FICTIFS.o[k % 4]; return { soc: FICTIFS.soc[k % 15] + (k >= 15 ? ' ' + (k > 22 ? 'Sud' : 'Est') : ''), f: FICTIFS.f[k % 6], o, t: k < nouv ? 'Nouveau' : 'Relance', rep: o === 'Salon 2023' ? 'Rencontre au salon 2023' : o === 'Anciens prospects' ? 'Échange de 2022' : o === 'Contacts réseau' ? 'Recommandation du réseau' : 'Profil repéré en septembre' }; });
    C.step = 'resultat'; logAction(`Sélection de campagne simulée : ${n} contacts`, 'L3', 'os'); render();
  },
  'camp-draft': () => {
    const C = S.camp, d = D(), part = 'Statuts_exceptions_part' + (d.campagnes.length + 6) + '.csv';
    C.step = 'fait'; C.fichier = part;
    d.campagnes.unshift({ id: uid('cp'), date: dp(0), selection: C.liste.length, brouillons: C.liste.length, reponses: 0, rdv: 0, fichier: part });
    d.validations.unshift({ id: uid('v'), type: 'lot', niv: 'L1', titre: `Lot de ${C.liste.length} brouillons de prospection`, origine: 'Campagne de prospection', liste: C.liste, source: d.bases[0].nom, confiance: 'élevée' });
    logAction(`Journal de statuts écrit en ajout seul : ${part}`, 'L3', 'os');
    logAction(`${C.liste.length} brouillons de prospection préparés`, 'L1', 'os');
    render(); toast(`${C.liste.length} brouillons préparés, à valider`);
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
        <tr><td class="muted">Fraîcheur</td><td>Contacts antérieurs à 2023 marqués anciens</td></tr></tbody></table></div>
      <div><h3>Instantanés</h3>${b.snap ? `<div class="alert blue" style="margin-top:8px">${ic('clock')}<div><b>${fdate(b.snap.date)}</b> ${esc(b.snap.label)}<div style="margin-top:6px"><button class="btn sm" data-act="base-restore" data-id="${b.id}">Restaurer</button></div></div></div>` : '<p class="small muted" style="margin-top:8px">Aucun instantané récent. Un instantané est pris automatiquement avant chaque modification de masse.</p>'}
      <h3 style="margin-top:14px">Garde-fous</h3><ul class="checks small"><li>Journal des statuts en ajout seul</li><li>Simulation avant toute modification de masse</li><li>Une valeur validée par un humain n'est jamais écrasée</li><li>Aucune suppression : archivage</li></ul></div></div></div></div>`;
  };
  return {
    title: 'Bases vivantes', sub: 'Vos fichiers restent la référence. L\'OS les lit, les enrichit et trace chaque changement.',
    actions: `<button class="btn primary" data-act="base-new">Créer une base</button>`,
    body: d.bases.length ? `<div class="stack">${d.bases.map(card).join('')}</div>` : `<div class="panel empty"><p>Pas encore de base pour cette instance.</p><p class="small">Partez d'un fichier (liste de salon, export) : l'OS propose un schéma, vous le validez.</p></div>`
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
