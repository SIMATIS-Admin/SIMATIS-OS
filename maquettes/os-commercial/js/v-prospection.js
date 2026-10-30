/* Prospection : campagnes de relance (tâches HubSpot) et de prospection à froid (base vivante). Données fictives, rien ne part. */

const P = () => D().prospection;
const TOUCHES_DEFAUT = 4;
const OFFRES = [['vma', 'Test de VMA, 10 minutes'], ['diagnostic', 'Diagnostic d\'endurance'], ['les-deux', 'Les deux'], ['kairos', 'Kairos']];
const THEME_DE = { vma: 'Test de VMA', diagnostic: 'Diagnostic', 'les-deux': 'Test de VMA', kairos: 'Kairos' };

/* ---------- Dates ---------- */
const ajouterJours = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
/* Jours travaillés de l'instance fictive : ni week-end ni mercredi. */
const jourTravaille = s => { const j = new Date(s + 'T12:00:00').getDay(); return j !== 0 && j !== 6 && j !== 3; };
const joursTravailles = (depuis, de, a) => Array.from({ length: a - de + 1 }, (_, k) => ajouterJours(depuis, de + k)).filter(jourTravaille);
const jourLong = s => { const t = new Date(s + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); return t[0].toUpperCase() + t.slice(1); };

/* n échéances étalées sur les jours travaillés de la plage [de, a] jours après `depuis`. */
function echeancesSuivi(n, plage, depuis) {
  const j = joursTravailles(depuis, plage[0], plage[1]);
  return Array.from({ length: n }, (_, i) => j[Math.floor(i * j.length / n)]);
}
/* 3 créneaux entre 7 et 14 jours après l'envoi, jamais un jour non travaillé. */
function creneauxFictifs(depuis) {
  const j = joursTravailles(depuis, 7, 14), heures = ['9h30', '14h', '10h'];
  return [j[0], j[Math.floor(j.length / 2)], j[j.length - 1]].map((s, i) => `${jourLong(s)} à ${heures[i]}`);
}
const prenomDe = nom => { const m = nom.trim().split(/\s+/).filter(x => !/^(m\.|mme|dr|pr)\.?$/i.test(x)); return m.find(x => x.length < 2 || x !== x.toUpperCase()) || m[0] || ''; };

/* ---------- Statistiques (accueil Prospection et Brief du jour) ---------- */
const touchesMaxDe = c => c.max ?? TOUCHES_DEFAUT;
const contactsEpuisables = () => P().froid.filter(c => c.statut === 'contacte' && c.touches >= touchesMaxDe(c));
function prospStats() {
  const p = P(), envoyes = p.occurrences.filter(o => o.etat !== 'brouillon'), sem = envoyes.filter(o => diffDays(o.date) > -7);
  const parTheme = {}, parTouche = {};
  sem.forEach(o => { parTheme[o.theme] = (parTheme[o.theme] || 0) + 1; parTouche[o.touche] = (parTouche[o.touche] || 0) + 1; });
  return { jour: envoyes.filter(o => o.date === dp(0)).length, objectif: p.objectifJour, semaine: sem.length,
    reponses: sem.filter(o => o.etat === 'reponse' || o.etat === 'rdv').length, rdv: sem.filter(o => o.etat === 'rdv').length, parTheme, parTouche, aConfirmer: contactsEpuisables().length };
}
const jauge = (jour, objectif) => { const pct = objectif > 0 ? Math.min(100, Math.round(jour / objectif * 100)) : 0;
  return objectif > 0 ? `<div style="background:rgba(255,255,255,.25);height:8px;border-radius:4px;margin-top:10px"><div style="background:#9FF7E8;width:${pct}%;height:8px;border-radius:4px"></div></div>` : ''; };

/* ---------- Signatures ---------- */
const signatures = () => P().signatures;
const signatureParDefaut = () => (signatures().find(s => s.defaut) || { id: 'aucune' }).id;
const sigNom = id => (signatures().find(s => s.id === id) || { nom: '' }).nom;
const sigPastille = id => id === 'aucune' || !sigNom(id) ? '<span class="muted small">(sans signature)</span>' : `<span style="background:var(--line-2);padding:2px 10px;border-radius:4px;font-size:14px">[ signature : ${esc(sigNom(id))} ]</span>`;

/* ---------- État d'une campagne ---------- */
const nouvelleCampagne = () => ({ inst: S.inst, mode: null, step: 'accueil', sel: [], nb: 30, filtre: '', brouillons: [], cur: 0, resultat: null,
  reglage: { offre: 'vma', creneaux: true, signature: signatureParDefaut(), suiviType: 'courte', suiviDate: '', touchesMax: TOUCHES_DEFAUT } });
const camp = () => (S.camp && S.camp.inst === S.inst ? S.camp : (S.camp = nouvelleCampagne()));
const tachesRelance = () => D().taches.filter(t => t.relance && !t.fait);
function eligiblesFroid() {
  return P().froid.filter(c => c.statut === 'jamais' || (c.statut === 'contacte' && c.touches < touchesMaxDe(c) && diffDays(c.derniere) <= -14));
}
function tirerEchantillon(C) {
  const f = C.filtre.trim().toLowerCase();
  const pool = eligiblesFroid().filter(c => !f || (c.soc + ' ' + c.nom + ' ' + c.fonction).toLowerCase().includes(f)).sort(() => Math.random() - .5);
  C.sel = pool.slice(0, Math.max(0, C.nb)).map(c => c.id);
}

/* ---------- Rédaction ---------- */
const ANGLES = [
  (o) => `Je me permets de vous écrire car ${o}.`,
  (o) => `Je reviens vers vous au sujet de mon précédent message : ${o}.`,
  (o) => `Un dernier angle, plus concret : ${o}.`,
  (o) => `Je ne veux pas vous solliciter à l'excès, c'est mon dernier message : ${o}.`
];
const PROPOSITION = { vma: 'je peux vous proposer un test de 10 minutes, qui vous situe rapidement', diagnostic: 'je peux vous proposer un diagnostic d\'endurance commerciale', 'les-deux': 'je peux vous proposer un test de 10 minutes, puis un diagnostic d\'endurance commerciale si le résultat vous parle', kairos: 'je peux vous présenter l\'accompagnement Kairos en quelques minutes' };
function redigerBrouillon(c, reglage, variante = 0) {
  const angle = ANGLES[Math.min(ANGLES.length - 1, (c.touche - 1 + variante) % ANGLES.length)];
  return { objet: c.fil || `${THEME_DE[reglage.offre]} : une proposition`,
    corps: [angle(PROPOSITION[reglage.offre]), 'Cela vous prendrait peu de temps, et vous auriez un repère concret.'],
    creneaux: reglage.creneaux ? creneauxFictifs(dp(0)) : [] };
}
const plageSuivi = r => r.suiviType === 'longue' ? [30, 60] : [14, 28];
function genererBrouillons(C) {
  const r = C.reglage, cibles = C.mode === 'relance'
    ? tachesRelance().filter(t => C.sel.includes(t.id)).map(t => ({ cle: t.id, nom: t.contactNom, soc: t.soc, touche: t.relance.touche + 1, fil: t.relance.fil }))
    : P().froid.filter(c => C.sel.includes(c.id)).map(c => ({ cle: c.id, nom: c.nom, soc: c.soc, touche: c.touches + 1, fil: null }));
  const dates = r.suiviType === 'date' ? cibles.map(() => r.suiviDate || dp(30)) : echeancesSuivi(cibles.length, plageSuivi(r), dp(0));
  return cibles.map((c, i) => ({ id: uid('br'), ...c, ...redigerBrouillon(c, r), variante: 0, suivi: { type: 'delai', date: dates[i] },
    etat: c.fil === null && C.mode === 'relance' ? 'verifier' : 'pret', vu: !(c.fil === null && C.mode === 'relance') }));
}
const corpsHtml = (b, C) => `<p>Bonjour ${esc(prenomDe(b.nom))},</p>${b.corps.map(p => `<p>${esc(p)}</p>`).join('')}
  ${b.creneaux.length ? `<p>Seriez-vous disponible à l'un de ces créneaux ?</p><ul>${b.creneaux.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}<p>Bien à vous,</p><p>${sigPastille(C.reglage.signature)}</p>`;

/* ---------- Vue principale ---------- */
const hero = (s) => `<div style="background:var(--navy);color:#fff;border-radius:var(--r-m);padding:16px 18px"><div class="small" style="opacity:.8">AUJOURD'HUI</div>
  <div style="font-size:40px;font-weight:700;line-height:1.1" class="num">${s.jour} <span style="font-size:16px;font-weight:400">mails${s.objectif ? ' sur ' + s.objectif : ''}</span></div>${jauge(s.jour, s.objectif)}</div>`;
const listeStats = o => Object.entries(o).map(([k, v]) => `${esc(k)} : <b class="num">${v}</b>`).join('<br>') || '<span class="muted">Rien cette semaine</span>';

VIEWS.prospection = () => {
  const C = camp(), p = P();
  const retour = `<button class="btn" data-act="camp-home">Retour à la prospection</button>`;
  if (C.step === 'choix') return { title: 'Prospection', actions: retour, body: vueChoix(C) };
  if (C.step === 'reglage') return { title: 'Prospection', actions: retour, body: vueReglage(C) };
  if (C.step === 'relecture') return { title: 'Prospection', actions: retour, body: vueRelecture(C) };
  if (C.step === 'fait') return { title: 'Prospection', actions: retour, body: vueFait(C) };
  if (C.step === 'epuises') return { title: 'Prospection', actions: retour, body: vueEpuises(C) };
  const s = prospStats(), relDues = tachesRelance().length, aRelancer = eligiblesFroid().filter(c => c.statut === 'contacte').length, dispo = eligiblesFroid().filter(c => c.statut === 'jamais').length;
  return { title: 'Prospection', actions: '', body: `<div class="stack">
    <div class="grid g3" style="grid-template-columns:1.3fr 1fr 1fr">${hero(s)}
      <div class="panel"><div class="panel-b"><div class="small muted">CETTE SEMAINE</div><div style="font-size:28px;font-weight:700" class="num">${s.semaine} envoyés</div><div class="small muted">${s.reponses} réponses · ${s.rdv} rendez-vous</div></div></div>
      <div class="panel"><div class="panel-b"><div class="small muted">PAR THÈME ET PAR TOUCHE</div><div class="small" style="line-height:1.7;margin-top:4px">${listeStats(s.parTheme)}<br>${Object.entries(s.parTouche).map(([k, v]) => `Touche ${k} : <b class="num">${v}</b>`).join(' · ')}</div></div></div></div>
    <div class="grid g2">
      <div class="panel" style="border:2px solid var(--navy)"><div class="panel-b"><h2 style="margin-top:0">Relancer des tâches</h2><p class="small muted">Vous choisissez des tâches de relance${INST().crm ? ' ' + esc(INST().crm) : ''}, l'OS rédige un mail par tâche dans le style du premier contact.</p>
        <p class="small"><b class="num">${relDues}</b> tâches de relance à traiter</p><button class="btn primary" data-act="camp-start" data-mode="relance">Choisir les tâches</button></div></div>
      <div class="panel" style="border:2px solid var(--teal)"><div class="panel-b"><h2 style="margin-top:0">Prospecter à froid</h2><p class="small muted">Vous tirez un échantillon de la base vivante, l'OS rédige un mail par contact.</p>
        <p class="small"><b class="num">${dispo}</b> contacts jamais sollicités · <b class="num">${aRelancer}</b> à relancer (touche suivante)</p><button class="btn go" data-act="camp-start" data-mode="froid">Tirer un échantillon</button></div></div></div>
    <div class="panel"><div class="panel-h"><h2>Campagnes récentes</h2><span class="small muted">Ce qui a été lancé, et ce que ça a donné</span></div><div class="panel-b">
      ${p.lots.length ? `<table class="tbl small"><thead><tr><th>Date</th><th>Lot</th><th class="r">Mails</th><th class="r">Réponses</th></tr></thead><tbody>${p.lots.slice(0, 5).map(l => `<tr><td>${fdate(l.date)}</td><td>${esc(l.nom)}</td><td class="r num">${l.mails}</td><td class="r num">${l.reponses}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small" style="margin:0">Aucune campagne pour l\'instant.</p>'}
      <p class="small" style="margin-bottom:0">${s.aConfirmer ? `<button class="link strong" data-act="camp-epuises">Contacts épuisés à confirmer (${s.aConfirmer})</button>` : '<span class="muted">Aucun contact épuisé à confirmer.</span>'}</p></div></div></div>` };
};

function vueChoix(C) {
  const continuer = (n, mode) => `<div style="margin-top:14px;display:flex;gap:10px;align-items:center"><button class="btn primary" data-act="camp-next" ${n ? '' : 'disabled'}>Continuer avec ${n} ${mode === 'relance' ? 'tâche' : 'contact'}${n > 1 ? 's' : ''}</button>${n ? '' : '<span class="small muted">Rien n\'est sélectionné.</span>'}</div>`;
  if (C.mode === 'relance') {
    const ts = tachesRelance(), toutes = ts.length && ts.every(t => C.sel.includes(t.id));
    return `<div class="panel"><div class="panel-h"><h2>Quelles tâches relancer ?</h2><label class="small"><input type="checkbox" ${toutes ? 'checked' : ''} data-change="camp-all"> Tout sélectionner</label></div><div class="panel-b">
      ${ts.length ? `<table class="tbl"><thead><tr><th></th><th>Contact</th><th>Société</th><th>Échéance</th><th>Prochaine touche</th><th>Fil du premier contact</th></tr></thead><tbody>${ts.map(t => `<tr><td><input type="checkbox" ${C.sel.includes(t.id) ? 'checked' : ''} data-change="camp-toggle" data-id="${t.id}"></td><td><b>${esc(t.contactNom)}</b></td><td>${esc(t.soc)}</td><td class="small">${diffDays(t.echeance) < 0 ? `<span class="late">en retard, ${rel(t.echeance)}</span>` : 'Aujourd\'hui'}</td><td class="num">${t.relance.touche + 1}</td><td class="small">${t.relance.fil ? esc(t.relance.fil) : '<span class="badge amber">Fil introuvable : à vérifier</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucune tâche de relance à traiter.</div>'}
      ${continuer(C.sel.length, 'relance')}</div></div>`;
  }
  const f = P().froid, nb = s => f.filter(c => c.statut === s).length, recents = f.filter(c => c.statut === 'contacte' && c.touches < touchesMaxDe(c) && diffDays(c.derniere) > -14).length;
  const liste = P().froid.filter(c => C.sel.includes(c.id));
  return `<div class="grid g-main"><div class="panel"><div class="panel-h"><h2>Échantillon de la base vivante</h2><button class="btn sm" data-act="camp-sample">Tirer un autre échantillon</button></div><div class="panel-b">
      <div class="grid g2"><label class="field"><span>Nombre de contacts</span><input class="input" type="number" min="1" max="100" value="${C.nb}" data-change="camp-nb"></label>
      <label class="field"><span>Filtre (société, secteur, fonction)</span><input class="input" value="${esc(C.filtre)}" placeholder="par exemple : fonderie" data-change="camp-filtre"></label></div>
      ${liste.length ? `<table class="tbl small"><thead><tr><th>Contact</th><th>Société</th><th>Fonction</th><th class="r">Touches</th></tr></thead><tbody>${liste.slice(0, 12).map(c => `<tr><td><b>${esc(c.nom)}</b></td><td>${esc(c.soc)}</td><td>${esc(c.fonction)}</td><td class="r num">${c.touches}</td></tr>`).join('')}${liste.length > 12 ? `<tr><td colspan="4" class="muted small">et ${liste.length - 12} autres contacts</td></tr>` : ''}</tbody></table>` : '<div class="alert amber">' + ic('info') + '<div>Aucun contact ne correspond : élargissez le filtre ou importez des contacts dans la base.</div></div>'}
      ${continuer(liste.length, 'froid')}</div></div>
    <div class="panel"><div class="panel-h"><h2>Règles de sélection ${tip('Ces règles s\'appliquent à chaque tirage. Un contact exclu ne sera jamais proposé.')}</h2></div><div class="panel-b"><ul class="checks small">
      <li>Épuisés : <b class="num">${nb('epuise')}</b> exclus</li><li>Ont déjà répondu : <b class="num">${nb('repondu')}</b> exclus</li>
      <li>Contactés il y a moins de 14 jours : <b class="num">${recents}</b> exclus</li><li>Touches maximum atteintes, à confirmer : <b class="num">${contactsEpuisables().length}</b> exclus</li>
      <li>Clients actifs du CRM : exclus (par société et par domaine)</li><li>Contacts invalides : exclus</li></ul></div></div></div>`;
}

const radio = (k, v, cur, lib) => `<label style="margin-right:14px"><input type="radio" name="r-${k}" value="${v}" ${cur === v ? 'checked' : ''} data-change="camp-set" data-k="${k}"> ${lib}</label>`;
function vueReglage(C) {
  const r = C.reglage, n = C.sel.length, sigs = signatures();
  return `<div class="panel"><div class="panel-h"><h2>Régler la campagne <span class="badge ${C.mode === 'relance' ? 'blue' : 'green'}">${C.mode === 'relance' ? 'Relance' : 'Froid'} · ${n} ${C.mode === 'relance' ? 'tâche' : 'contact'}${n > 1 ? 's' : ''}</span></h2></div><div class="panel-b">
    <div style="display:grid;grid-template-columns:170px 1fr;row-gap:16px;align-items:center">
      <b>Offre</b><div>${OFFRES.map(([v, l]) => radio('offre', v, r.offre, l)).join('')}</div>
      <b>Style</b><div class="small muted">${C.mode === 'relance' ? 'Reprend le ton du premier mail du fil (lu dans Gmail).' : 'Court, vouvoiement, un angle différent à chaque touche.'}</div>
      <b>Créneaux</b><div><label><input type="checkbox" ${r.creneaux ? 'checked' : ''} data-change="camp-set" data-k="creneaux"> Proposer 3 créneaux, entre 1 et 2 semaines après l'envoi</label> <span class="small muted">vérifiés dans l'agenda</span></div>
      <b>Signature</b><div>${sigs.map(s => radio('signature', s.id, r.signature, esc(s.nom))).join('')}${radio('signature', 'aucune', r.signature, 'Aucune')}</div>
      <b>Prochain suivi</b><div>${radio('suiviType', 'courte', r.suiviType, '2 à 3 semaines')}${radio('suiviType', 'longue', r.suiviType, '1 à 2 mois')}${radio('suiviType', 'date', r.suiviType, 'Date précise')}${r.suiviType === 'date' ? `<input class="input" type="date" style="width:auto" value="${esc(r.suiviDate)}" data-change="camp-set" data-k="suiviDate">` : ''}<div class="small muted">Étalé sur vos jours travaillés ; ${C.mode === 'relance' ? 'la tâche de suivi garde le canal d\'origine' : 'tâche de suivi dans l\'OS'}.</div></div>
      ${C.mode === 'froid' ? `<b>Touches maximum</b><div><input class="input" type="number" min="1" max="10" style="width:80px" value="${r.touchesMax}" data-change="camp-set" data-k="touchesMax"> <span class="small muted">au-delà, le contact est proposé comme « épuisé », sur votre confirmation</span></div>` : ''}
    </div><div style="margin-top:18px"><button class="btn primary" data-act="camp-draft">Rédiger les ${n} brouillons</button></div></div></div>`;
}

const ETAT_BR = { pret: ['green', 'Prêt'], verifier: ['amber', 'À vérifier'], ecarte: ['', 'Écarté'] };
const brouillonsActifs = C => C.brouillons.filter(b => b.etat !== 'ecarte');
const envoiBloque = C => brouillonsActifs(C).some(b => b.etat === 'verifier' && !b.vu);
const envoiPossible = () => P().verrous.serveur && P().verrous.admin;
function vueRelecture(C) {
  const b = C.brouillons[C.cur] || C.brouillons[0], n = brouillonsActifs(C).length, bloque = envoiBloque(C);
  if (!b) return '<div class="empty">Aucun brouillon.</div>';
  const suiviOpts = [['delai', `Relancer le ${fdate(b.suivi.date)}`], ['citee', 'Date citée par le contact'], ['clos', 'Dossier clos (refus)']];
  return `<div class="grid" style="grid-template-columns:minmax(220px,1fr) 2.4fr;gap:14px">
    <div class="stack" style="margin:0">${C.brouillons.map((x, i) => `<div class="panel" style="${i === C.cur ? 'border:2px solid var(--navy)' : ''};cursor:pointer;opacity:${x.etat === 'ecarte' ? .5 : 1}" data-act="br-open" data-i="${i}"><div class="panel-b" style="padding:10px 12px"><b>${esc(x.nom)}</b> <span class="small muted">${esc(x.soc)}</span><div class="small"><span class="badge ${ETAT_BR[x.etat][0]}">${ETAT_BR[x.etat][1]}</span> touche ${x.touche}</div></div></div>`).join('')}</div>
    <div class="panel"><div class="panel-h"><div><h2>${esc(b.nom)} <span class="muted small">${esc(b.soc)}</span></h2><div class="small muted">Objet : ${esc(b.objet)}</div></div><div style="display:flex;gap:6px"><button class="btn sm" data-act="br-regen">Régénérer</button><button class="btn sm ${b.etat === 'ecarte' ? '' : 'danger'}" data-act="br-skip">${b.etat === 'ecarte' ? 'Rétablir' : 'Écarter'}</button></div></div>
      <div class="panel-b">${b.etat === 'verifier' ? `<div class="alert amber" style="margin-bottom:12px">${ic('info')}<div>Le fil Gmail d'origine est introuvable : relisez le mail avant de l'envoyer.</div></div>` : ''}
        <div style="line-height:1.55">${corpsHtml(b, C)}</div>
        <label class="field" style="margin-top:10px"><span>Corps du message (modifiable)</span><textarea class="input" data-change="br-edit">${esc(b.corps.join('\n\n'))}</textarea></label>
        <div style="border-top:1px solid var(--line);padding-top:12px"><b class="small">Suivi après ce mail</b><div style="margin-top:6px">${suiviOpts.map(([v, l]) => `<label style="margin-right:14px"><input type="radio" name="suivi" value="${v}" ${b.suivi.type === v ? 'checked' : ''} data-change="br-suivi"> ${l}</label>`).join('')}
        ${b.suivi.type === 'citee' ? `<input class="input" type="date" style="width:auto" value="${esc(b.suivi.date)}" data-change="br-date">` : ''}</div>
        <div class="small muted" style="margin-top:4px">${b.suivi.type === 'clos' ? 'Aucune tâche de suivi ne sera créée.' : C.mode === 'relance' ? `Tâche de suivi ${INST().crm ? esc(INST().crm) + ' ' : ''}(MAIL) le ${fdate(b.suivi.date)}.` : `Tâche de suivi dans l'OS le ${fdate(b.suivi.date)}.`}</div></div></div></div></div>
    <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn primary" data-act="camp-send" data-mode="brouillons" ${n && !bloque ? '' : 'disabled'}>Mettre en brouillons Gmail (${n})</button>
      <button class="btn go" data-act="camp-send" data-mode="envoi" ${n && !bloque && envoiPossible() ? '' : 'disabled'}>Valider et envoyer (${n})</button>
      ${envoiPossible() ? '' : `<span class="small muted">Envoi direct désactivé : les deux verrous sont fermés. <a href="#" data-act="go-params" data-tab="prospection">Réglages</a></span>`}
      ${bloque ? '<span class="small" style="color:var(--amber)">Ouvrez les mails « à vérifier » avant l\'envoi.</span>' : ''}</div>`;
}

function vueFait(C) {
  const r = C.resultat; if (!r) return '<div class="empty">Rien à afficher.</div>';
  return `<div class="alert blue" style="margin-bottom:16px">${ic('check')}<div>${r.envoi ? `${r.mails} mails envoyés (simulation, rien n'est parti).` : `${r.mails} brouillons créés dans Gmail (simulation).`}</div></div>
    <div class="panel"><div class="panel-h"><h2>Ce qui a été enregistré</h2></div><div class="panel-b"><table class="tbl small"><tbody>
      <tr><td>Occurrences de prospection</td><td class="r num">${r.mails}</td></tr><tr><td>Tâches de suivi créées</td><td class="r num">${r.suivis}</td></tr>
      <tr><td>Dossiers clos (sans suivi)</td><td class="r num">${r.clos}</td></tr>${r.mode === 'relance' ? `<tr><td>Tâches MAIL en retard reportées de 7 jours</td><td class="r num">${r.reportes}</td></tr>` : ''}</tbody></table>
      <p class="small muted">Compteur du jour : <b class="num">${prospStats().jour}</b> sur ${prospStats().objectif}.</p><button class="btn primary" data-act="camp-home">Retour à la prospection</button></div></div>`;
}

function vueEpuises(C) {
  const l = contactsEpuisables(), sel = C.epSel || [];
  return `<div class="panel"><div class="panel-h"><h2>Contacts épuisés à confirmer</h2><span class="small muted">Aucun contact n'est marqué sans votre accord.</span></div><div class="panel-b">
    ${l.length ? `<table class="tbl"><thead><tr><th></th><th>Contact</th><th>Société</th><th class="r">Touches</th><th>Dernière</th><th></th></tr></thead><tbody>${l.map(c => `<tr><td><input type="checkbox" ${sel.includes(c.id) ? 'checked' : ''} data-change="ep-toggle" data-id="${c.id}"></td><td><b>${esc(c.nom)}</b></td><td>${esc(c.soc)}</td><td class="r num">${c.touches}</td><td class="small">${fdate(c.derniere)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="ep-ok" data-id="${c.id}">Marquer épuisé</button> <button class="btn sm ghost" data-act="ep-garder" data-id="${c.id}">Garder</button></td></tr>`).join('')}</tbody></table>
      <div style="margin-top:12px"><button class="btn primary" data-act="ep-lot" ${sel.length ? '' : 'disabled'}>Marquer épuisés (${sel.length})</button></div>` : '<div class="empty">Aucun contact à confirmer.</div>'}</div></div>`;
}

/* ---------- Envoi (simulé) : occurrences, tâches de suivi, report des tâches en retard ---------- */
function envoyerLot(mode) {
  const C = camp(), d = D(), p = P(), envoi = mode === 'envoi', r = C.reglage;
  const actifs = brouillonsActifs(C); let suivis = 0, clos = 0, reportes = 0;
  actifs.forEach(b => {
    p.occurrences.push({ id: uid('oc'), date: dp(0), contact: b.nom, soc: b.soc, theme: THEME_DE[r.offre], touche: b.touche, etat: envoi ? 'envoye' : 'brouillon', campagne: C.mode === 'relance' ? 'Relance' : 'Froid' });
    if (C.mode === 'froid') { const c = p.froid.find(x => x.id === b.cle); if (c) { c.touches = b.touche; c.statut = 'contacte'; c.derniere = dp(0); c.max = r.touchesMax; } }
    else { const t = d.taches.find(x => x.id === b.cle); if (t) { t.fait = true; t.faitLe = dp(0); const a = d.activites.find(x => x.date === dp(0)) || (d.activites.unshift({ date: dp(0), email: 0, appel: 0, autre: 0 }), d.activites[0]); a.email++; } }
    if (b.suivi.type === 'clos') { clos++; return; }
    d.taches.push({ id: uid('t'), titre: C.mode === 'relance' ? `RELANCE de prospection (MAIL) : ${b.nom}` : `Relance à froid, touche ${b.touche + 1} : ${b.nom}`, contactNom: b.nom, soc: b.soc, echeance: b.suivi.date, canal: 'email', fait: false,
      ...(C.mode === 'relance' ? { relance: { touche: b.touche, fil: b.fil || b.objet } } : { os: true }) });
    suivis++;
  });
  if (C.mode === 'relance') d.taches.filter(t => t.canal === 'email' && !t.fait && !t.relance && diffDays(t.echeance) < 0).forEach(t => { let e = ajouterJours(t.echeance, 7); while (!jourTravaille(e)) e = ajouterJours(e, 1); t.echeance = e; reportes++; });
  p.lots.unshift({ id: uid('lt'), date: dp(0), nom: C.mode === 'relance' ? 'Relance de tâches' : 'Froid, nouveau lot', mails: actifs.length, reponses: 0 });
  logAction(`${actifs.length} mails de prospection ${envoi ? 'envoyés' : 'mis en brouillons Gmail'} (simulation)`, 'L1', 'os');
  C.resultat = { mails: actifs.length, suivis, clos, reportes, envoi, mode: C.mode }; C.step = 'fait';
  return C.resultat;
}

/* ---------- Actions ---------- */
const redessiner = () => { const y = scrollY; render(); scrollTo(0, y); };
Object.assign(ACTIONS, {
  'camp-home': () => { S.camp = nouvelleCampagne(); render(); },
  'camp-start': ds => { const C = S.camp = nouvelleCampagne(); C.mode = ds.mode; C.step = 'choix'; if (ds.mode === 'froid') tirerEchantillon(C); render(); },
  'camp-toggle': (ds, el) => { const C = camp(); C.sel = el.checked ? [...new Set([...C.sel, ds.id])] : C.sel.filter(x => x !== ds.id); redessiner(); },
  'camp-all': (ds, el) => { const C = camp(); C.sel = el.checked ? tachesRelance().map(t => t.id) : []; redessiner(); },
  'camp-nb': (ds, el) => { const C = camp(); C.nb = Math.max(1, Math.min(100, +el.value || 1)); tirerEchantillon(C); redessiner(); },
  'camp-filtre': (ds, el) => { const C = camp(); C.filtre = el.value; tirerEchantillon(C); redessiner(); },
  'camp-sample': () => { tirerEchantillon(camp()); redessiner(); },
  'camp-next': () => { const C = camp(); if (C.sel.length) { C.step = 'reglage'; render(); } },
  'camp-set': (ds, el) => { const r = camp().reglage; r[ds.k] = el.type === 'checkbox' ? el.checked : ds.k === 'touchesMax' ? Math.max(1, +el.value || 1) : el.value; redessiner(); },
  'camp-draft': () => { const C = camp(); C.brouillons = genererBrouillons(C); C.cur = 0; C.step = 'relecture'; logAction(`${C.brouillons.length} brouillons de prospection rédigés`, 'L1', 'os'); render(); },
  'br-open': ds => { const C = camp(); C.cur = +ds.i; C.brouillons[C.cur].vu = true; redessiner(); },
  'br-skip': () => { const b = camp().brouillons[camp().cur]; b.etat = b.etat === 'ecarte' ? (b.fil === null && camp().mode === 'relance' ? 'verifier' : 'pret') : 'ecarte'; redessiner(); },
  'br-regen': () => { const C = camp(), b = C.brouillons[C.cur]; b.variante++; Object.assign(b, redigerBrouillon(b, C.reglage, b.variante)); redessiner(); toast('Brouillon régénéré'); },
  'br-edit': (ds, el) => { camp().brouillons[camp().cur].corps = el.value.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean); redessiner(); },
  'br-suivi': (ds, el) => { camp().brouillons[camp().cur].suivi.type = el.value; redessiner(); },
  'br-date': (ds, el) => { if (el.value) camp().brouillons[camp().cur].suivi.date = el.value; redessiner(); },
  'camp-send': ds => { const C = camp(); if (ds.mode === 'envoi' && !envoiPossible()) return; if (envoiBloque(C) || !brouillonsActifs(C).length) return; envoyerLot(ds.mode); render(); toast(ds.mode === 'envoi' ? 'Mails envoyés (simulation)' : 'Brouillons créés dans Gmail (simulation)'); },
  'camp-epuises': () => { const C = camp(); C.step = 'epuises'; C.epSel = []; render(); },
  'ep-toggle': (ds, el) => { const C = camp(); C.epSel = el.checked ? [...(C.epSel || []), ds.id] : (C.epSel || []).filter(x => x !== ds.id); redessiner(); },
  'ep-ok': ds => { const c = P().froid.find(x => x.id === ds.id); c.statut = 'epuise'; logAction(`Contact marqué épuisé : ${c.nom}`, 'L2'); render(); },
  'ep-garder': ds => { const c = P().froid.find(x => x.id === ds.id); c.max = c.touches + 1; render(); toast('Contact conservé dans la prospection'); },
  'ep-lot': () => { const C = camp(); (C.epSel || []).forEach(id => { const c = P().froid.find(x => x.id === id); if (c) c.statut = 'epuise'; }); logAction(`${(C.epSel || []).length} contacts marqués épuisés`, 'L2'); C.epSel = []; render(); },
  'sig-add': () => openModal('Ajouter une signature', () => `<label class="field"><span>Nom de la signature</span><input class="input" id="sg-nom" placeholder="Par exemple : Kairos seul"></label><p class="small muted">L'image sera importée à l'étape de construction ; ici, la maquette garde seulement le nom.</p>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-act="sig-add-ok">Ajouter</button><button class="btn ghost" data-act="close">Annuler</button></div>`),
  'sig-add-ok': () => { const n = document.getElementById('sg-nom').value.trim(); if (!n) { document.getElementById('sg-nom').focus(); return; } signatures().push({ id: uid('sg'), nom: n, defaut: false }); OVER = null; render(); toast('Signature ajoutée'); },
  'sig-rename': ds => openModal('Renommer la signature', () => `<label class="field"><span>Nom</span><input class="input" id="sg-nom" value="${esc(sigNom(ds.id))}"></label>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-act="sig-rename-ok" data-id="${ds.id}">Enregistrer</button><button class="btn ghost" data-act="close">Annuler</button></div>`),
  'sig-rename-ok': ds => { const n = document.getElementById('sg-nom').value.trim(); if (n) signatures().find(s => s.id === ds.id).nom = n; OVER = null; render(); },
  'sig-replace': () => toast('Image remplacée (simulation)'),
  'sig-delete': ds => { const p = P(); p.signatures = p.signatures.filter(s => s.id !== ds.id); if (S.camp && S.camp.reglage.signature === ds.id) S.camp.reglage.signature = signatureParDefaut(); render(); toast('Signature supprimée'); },
  'sig-default': ds => { signatures().forEach(s => { s.defaut = s.id === ds.id && !s.defaut; }); render(); },
  'verrou-set': (ds, el) => { P().verrous[ds.k] = el.checked; logAction(`Verrou d'envoi ${ds.k} ${el.checked ? 'ouvert' : 'fermé'}`, 'L3'); render(); }
});

/* ---------- Paramètres : onglet Prospection (signatures et verrous d'envoi) ---------- */
function prospParamTab() {
  const p = P(), v = p.verrous;
  return `<div class="grid g2"><div class="panel"><div class="panel-h"><h2>Signatures</h2><button class="btn sm primary" data-act="sig-add">Ajouter une signature</button></div><div class="panel-b">
      ${p.signatures.length ? `<table class="tbl small"><tbody>${p.signatures.map(s => `<tr><td>${sigPastille(s.id)}<div class="small muted">${esc(s.nom)}</div></td><td style="white-space:nowrap"><label class="small"><input type="checkbox" ${s.defaut ? 'checked' : ''} data-change="sig-default" data-id="${s.id}"> par défaut</label></td>
        <td style="white-space:nowrap"><button class="btn sm" data-act="sig-rename" data-id="${s.id}">Renommer</button> <button class="btn sm" data-act="sig-replace" data-id="${s.id}">Remplacer l'image</button> <button class="btn sm ghost danger" data-act="sig-delete" data-id="${s.id}">Supprimer</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small" style="margin:0">Aucune signature : les mails partiront sans signature.</p>'}
      <p class="small muted">Chaque signature est une image intégrée au mail. Le choix se fait à chaque campagne.</p></div></div>
    <div class="panel"><div class="panel-h"><h2>Verrous d'envoi</h2><span class="badge ${envoiPossible() ? 'amber' : 'green'}">${envoiPossible() ? 'Envoi direct possible' : 'Envoi direct bloqué'}</span></div><div class="panel-b">
      <p style="margin-top:0">« Valider et envoyer » ne s'active que si <b>les deux</b> verrous sont ouverts. Tant qu'un seul l'est, vous mettez les brouillons dans Gmail et vous les envoyez vous-même.</p>
      <label style="display:block;margin-bottom:8px"><input type="checkbox" ${v.serveur ? 'checked' : ''} data-change="verrou-set" data-k="serveur"> <b>Variable du serveur</b> <span class="small muted">réglage technique, hors de l'interface</span></label>
      <label style="display:block"><input type="checkbox" ${v.admin ? 'checked' : ''} data-change="verrou-set" data-k="admin"> <b>Interrupteur administrateur</b> <span class="small muted">dans les réglages de l'OS</span></label></div></div></div>`;
}

/* ---------- Brief du jour : mêmes chiffres que l'accueil Prospection ---------- */
function prospBriefPanel() {
  const s = prospStats(), ts = D().taches.filter(t => t.relance), faites = ts.filter(t => t.fait && t.faitLe === dp(0)).length, restantes = ts.filter(t => !t.fait && diffDays(t.echeance) <= 0).length;
  return `<div class="panel"><div class="panel-h"><h2>Prospection du jour</h2><button class="btn sm" data-act="go" data-v="prospection">Ouvrir</button></div><div class="panel-b">
    ${hero(s)}<p class="small" style="margin:10px 0 0">Relances faites aujourd'hui : <b class="num">${faites}</b> · restantes : <b class="num">${restantes}</b><br>Cette semaine : <b class="num">${s.semaine}</b> mails, <b class="num">${s.reponses}</b> réponses${s.aConfirmer ? `<br><button class="link strong" data-act="camp-epuises-brief">${s.aConfirmer} contacts épuisés à confirmer</button>` : ''}</p></div></div>`;
}
ACTIONS['camp-epuises-brief'] = () => { ACTIONS['camp-epuises'](); go('prospection'); };
