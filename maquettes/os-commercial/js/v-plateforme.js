/* Instruments de bord : routines, autonomie, journal d'audit, second cerveau. */

/* Paramètres modifiables par routine : ce que Marc règle sans toucher à la skill. */
const HEURES = ['6h00', '6h30', '7h00', '7h30', '8h00', '8h30', '9h00'];
const PARAMS_DEF = {
  'r-quot': [
    { k: 'heure', l: 'Heure de lancement', t: 'select', o: HEURES },
    { k: 'jours', l: 'Jours', t: 'select', o: ['Jours ouvrés', 'Du lundi au jeudi', 'Tous les jours'] },
    { k: 'canaux', l: 'Tâches traitées', t: 'checks', o: [['email', 'Relances par email'], ['appel', 'Appels']] },
    { k: 'retard', l: 'Reprendre les tâches en retard depuis au plus', t: 'number', min: 0, max: 90, u: 'jours' },
    { k: 'max', l: 'Brouillons au plus par exécution', t: 'number', min: 1, max: 50, u: 'brouillons' },
    { k: 'creneaux', l: 'Créneaux proposés dans chaque email', t: 'number', min: 0, max: 3, u: 'créneaux' },
    { k: 'delai', l: 'Premier créneau proposé au plus tôt dans', t: 'number', min: 1, max: 15, u: 'jours ouvrés' },
    { k: 'plages', l: 'Plages horaires des créneaux', t: 'select', o: ['9h30-12h00 et 14h00-17h00', '9h00-12h00 seulement', '14h00-18h00 seulement'] }
  ],
  'r-nett': [
    { k: 'declenchement', l: 'Déclenchement', t: 'select', o: ['Après chaque envoi de relances', 'Chaque jour à 18h00', 'À la demande seulement'] },
    { k: 'suivi', l: 'Tâche de suivi proposée à', t: 'number', min: 1, max: 60, u: 'jours' }
  ],
  'r-hebdo': [
    { k: 'jour', l: 'Jour', t: 'select', o: ['Lundi', 'Vendredi'] },
    { k: 'heure', l: 'Heure', t: 'select', o: HEURES }
  ],
  'r-evt': [
    { k: 'devis', l: 'Relancer un devis sans réponse après', t: 'number', min: 3, max: 30, u: 'jours' },
    { k: 'stop', l: 'Arrêter la séquence dès qu\'un contact répond', t: 'bool' }
  ]
};
const rythme = x => {
  const p = x.params || {};
  if (x.id === 'r-quot') return `${p.jours === 'Tous les jours' ? 'Tous les jours' : p.jours === 'Jours ouvrés' ? 'Chaque jour ouvré' : p.jours} à ${p.heure}, ou à la demande`;
  if (x.id === 'r-nett') return p.declenchement;
  if (x.id === 'r-hebdo') return `${p.jour} à ${p.heure}`;
  return x.rythme;
};

/* Étapes qui ont besoin d'une connexion donnée : sans elle, la routine s'arrête là. */
const besoin = txt => /messagerie|Gmail/i.test(txt) ? 'Messagerie' : /agenda/i.test(txt) ? 'Agenda' : null;
const connEtat = c => D().reglages.etat?.[c[0]] ?? c[2];
const connOk = nom => { const c = (INST().conn || []).find(x => x[0] === nom); return !c || connEtat(c) === 'ok'; };

VIEWS.routines = () => {
  const r = D().routines, inst = INST();
  const conn = inst.conn || [];
  return {
    title: 'Routines Claude',
    actions: `<span class="small muted">${conn.map(c => `${esc(c[1])} ${connEtat(c) === 'ok' ? '✓' : '(non configuré)'}`).join(' · ')}</span><button class="btn" data-act="go-params" data-tab="routines">${ic('gear')}Réglages</button>`,
    body: `    <div class="grid g2">${r.map(x => `<div class="panel"><div class="panel-h"><div><h2>${esc(x.nom)}</h2><div class="small muted">${esc(rythme(x))}</div></div>
        <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" ${x.actif ? 'checked' : ''} data-change="rt-toggle" data-id="${x.id}" style="accent-color:var(--teal)">${x.actif ? 'Active' : 'En pause'}</label></div>
      <div class="panel-b report-col">
        <h4 style="margin-top:0">Ce que fait la routine</h4><ol class="rt-steps">${(x.etapes || []).map(e => `<li class="${besoin(e) && !connOk(besoin(e)) ? 'blocked' : ''}">${esc(e)}</li>`).join('')}</ol>
        <div class="small muted" style="margin-top:10px">Dernière exécution : ${rel(x.dernier)}</div>
        <h4>Fait</h4><ul>${x.rapport.fait.map(f => `<li>${esc(f)}</li>`).join('') || '<li>Rien</li>'}</ul>
        ${x.rapport.attente.length ? `<h4>En attente de validation</h4><ul>${x.rapport.attente.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        ${x.rapport.echec.length ? `<h4>Échecs</h4><ul>${x.rapport.echec.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div>
      <div class="decision"><button class="btn primary sm" data-act="rt-run" data-id="${x.id}" ${x.actif ? '' : 'disabled'}>${ic('play')}Lancer maintenant</button><span class="hint">Rien n'est envoyé : les brouillons attendent dans Gmail.</span></div></div>`).join('')}</div>`
  };
};
Object.assign(ACTIONS, {
  'rt-toggle': (ds, el) => { const x = byId(D().routines, ds.id); x.actif = el.checked; logAction(`Routine ${el.checked ? 'activée' : 'mise en pause'} : ${x.nom}`, 'L2'); render(); },
  'rt-run': ds => {
    const x = byId(D().routines, ds.id);
    const run = S.run = { id: x.id, k: 0, err: null, fin: false };
    openModal(esc(x.nom), runBody);
    const tick = setInterval(() => {
      const R = S.run; if (R !== run) return clearInterval(tick);
      const etape = x.etapes[R.k], b = besoin(etape);
      if (b && !connOk(b)) { R.err = `${b} non configurée pour ${INST().nom} : la routine s'arrête ici.`; }
      else R.k++;
      if (R.err || R.k >= x.etapes.length) { clearInterval(tick); R.fin = true; finRoutine(x, R); }
      if (OVER || R.fin) render();
    }, 450);
  },
  'go-params': ds => { S.paramTab = ds.tab; go('parametres'); },
  'rt-voir': () => { S.run = null; OVER = null; S.vqFilter = 'tout'; go('validations'); }
});
function runBody() {
  const R = S.run, x = byId(D().routines, R.id);
  return `<p class="small muted" style="margin-top:0">Instance : <b>${esc(INST().nom)}</b>. Connexions utilisées : ${(INST().conn || []).filter(c => connEtat(c) === 'ok').map(c => esc(c[1])).join(', ')}.</p>
    <ol class="rt-steps run">${x.etapes.map((e, k) => `<li class="${k < R.k ? 'done' : k === R.k && R.err ? 'blocked' : k === R.k && !R.fin ? 'cur' : ''}">${esc(e)}</li>`).join('')}</ol>
    ${R.err ? `<div class="alert amber" style="margin-top:12px">${ic('info')}<div>${esc(R.err)}</div></div>` : ''}
    ${R.fin && !R.err ? `<div class="alert blue" style="margin-top:12px">${ic('check')}<div>${esc(R.bilan)}</div></div>` : ''}
    ${R.fin ? `<div style="display:flex;gap:8px;margin-top:14px">${R.n ? `<button class="btn go" data-act="rt-voir">Voir dans À valider</button>` : ''}<button class="btn ghost" data-act="close">Fermer</button></div>` : ''}`;
}
function finRoutine(x, R) {
  const d = D(), fait = [];
  let n = 0;
  if (!R.err && x.id === 'r-quot') {
    const p = x.params || {}, canaux = p.canaux || ['email', 'appel'];
    d.taches.filter(t => canaux.includes('email') && !t.fait && diffDays(t.echeance) <= 0 && -diffDays(t.echeance) <= (p.retard ?? 30) && t.canal === 'email' && !t.prepare && t.opp).slice(0, p.max || 20).forEach(t => {
      t.prepare = true; const o = byId(d.opps, t.opp), c = contact(o.contact);
      d.validations.unshift({ id: uid('v'), type: 'email', niv: 'L1', titre: 'Relance préparée par la routine', soc: o.soc, contact: o.contact, origine: x.nom, objet: o.titre,
        corps: email(c.nom, '', ['Je reviens vers vous suite à notre dernier échange.', 'Seriez-vous disponible pour en reparler brièvement ?'], p.creneaux ? creneaux(4).slice(0, p.creneaux) : null),
        controles: ['Historique de messagerie consulté', 'Tâche échue ' + rel(t.echeance), 'Créneaux vérifiés dans l\'agenda'], source: INST().outil, confiance: 'élevée' });
      n++;
    });
    const appels = canaux.includes('appel') ? d.taches.filter(t => !t.fait && diffDays(t.echeance) <= 0 && t.canal === 'appel').length : 0;
    fait.push(`${n} brouillon${n > 1 ? 's' : ''} de relance préparé${n > 1 ? 's' : ''} dans Gmail`, canaux.includes('appel') ? `Planning d'appels : ${appels} appel${appels > 1 ? 's' : ''}` : 'Appels non traités (désactivés dans Paramètres)', 'Brief du jour produit');
  } else if (!R.err) fait.push(...x.etapes.map(e => e + ' : fait'));
  R.n = n || pending();
  R.bilan = x.id === 'r-quot' ? `${fait[0]}. ${pending()} élément${pending() > 1 ? 's' : ''} en attente de votre décision.` : 'Routine terminée. Rien n\'a été envoyé.';
  x.dernier = dp(0);
  x.rapport = { fait: R.err ? x.etapes.slice(0, R.k) : fait, attente: [`${pending()} élément${pending() > 1 ? 's' : ''} à valider`], echec: R.err ? [R.err] : [] };
  logAction(`Routine Claude exécutée : ${x.nom}${R.err ? ' (arrêtée)' : ''}`, 'L3', 'os');
}

/* ---------- Paramètres : connexions et réglages des routines, par instance ---------- */
const OBJETS_CRM = [['entreprises', 'Entreprises'], ['contacts', 'Contacts'], ['transactions', 'Transactions (pipeline)'], ['taches', 'Tâches'], ['notes', 'Notes'], ['emails', 'Emails enregistrés']];
const champ = (f, v, attrs) => {
  if (f.t === 'select') return `<label class="field"><span>${f.l}</span><select class="input" ${attrs}>${f.o.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  if (f.t === 'number') return `<label class="field"><span>${f.l}</span><span style="display:flex;gap:8px;align-items:center"><input class="input num" style="width:100px" type="number" min="${f.min}" max="${f.max}" value="${v}" ${attrs}><span class="small muted">${f.u}</span></span></label>`;
  if (f.t === 'checks') return `<div class="field"><span>${f.l}</span><div class="checks-row">${f.o.map(([k, l]) => `<label class="check"><input type="checkbox" value="${k}" ${(v || []).includes(k) ? 'checked' : ''} ${attrs}><span>${l}</span></label>`).join('')}</div></div>`;
  return `<label class="check"><input type="checkbox" ${v ? 'checked' : ''} ${attrs}><span>${f.l}</span></label>`;
};
const verrou = txt => `<div class="lock" style="margin-top:6px">${ic('lock')}${txt}</div>`;

VIEWS.parametres = () => {
  const inst = INST(), R = D().reglages, tab = S.paramTab || 'connexions';
  const etat = c => connEtat(c) === 'ok' ? '<span class="badge green">Connecté</span>' : `<span class="badge amber">Non configuré</span>`;
  const conn = c => {
    const [k, nom] = c, ok = connEtat(c) === 'ok';
    const head = `<div class="panel-h"><div><h2>${esc(nom)}</h2><div class="small muted">${esc(k)}</div></div>${etat(c)}</div>`;
    if (!ok) return `<div class="panel">${head}<div class="panel-b"><p style="margin-top:0">Sans cette connexion, les routines s'arrêtent à l'étape qui en a besoin. Rien ne part depuis la boîte d'une autre instance.</p><button class="btn primary" data-act="conn-on" data-k="${esc(k)}">Connecter</button></div></div>`;
    if (k === 'CRM' && inst.crm) return `<div class="panel">${head}<div class="panel-b">
      <div class="grid g2">${champ({ t: 'select', l: 'Fréquence de synchronisation', o: ['Toutes les 5 minutes', 'Toutes les 15 minutes', 'Toutes les heures', 'Une fois par jour', 'À la demande seulement'] }, R.crm.freq, 'data-change="reg" data-g="crm" data-k="freq"')}
      ${champ({ t: 'select', l: 'Sens', o: ['Dans les deux sens', `De ${inst.crm} vers l'OS (lecture seule)`] }, R.crm.sens, 'data-change="reg" data-g="crm" data-k="sens"')}</div>
      ${champ({ t: 'checks', l: 'Objets synchronisés', o: OBJETS_CRM }, R.crm.objets, 'data-change="reg-list" data-g="crm" data-k="objets"')}
      <div class="field"><span>Champs synchronisés ${tip(`Décochez un champ pour l'exclure : l'OS ne le lit plus et ne l'écrit jamais dans ${inst.crm}.`)}</span><div class="checks-row">${CHAMPS_CRM.map(f => `<label class="check"><input type="checkbox" ${R.crm.exclus.includes(f) ? '' : 'checked'} data-change="reg-champ" data-f="${esc(f)}"><span>${esc(f)}</span></label>`).join('')}</div></div>
      ${verrou(`${inst.crm} fait foi en cas d'écart. Aucune suppression n'est jamais écrite.`)}</div>
      <div class="decision"><button class="btn" data-act="crm-sync">Synchroniser maintenant</button><span class="hint">Dernière synchronisation : ${S.sync?.[S.inst] ? 'à l\'instant' : 'il y a 5 min'}.</span></div></div>`;
    if (k === 'CRM' || k === 'Pipeline') return `<div class="panel">${head}<div class="panel-b"><p style="margin:0">${inst.demo ? 'Données fictives de démonstration.' : 'Pas de CRM chez ce client : pipeline, entreprises et contacts sont tenus par l\'OS. Rien à synchroniser.'}</p></div></div>`;
    if (k === 'Messagerie') return `<div class="panel">${head}<div class="panel-b"><div class="grid g2">
      ${champ({ t: 'select', l: 'Historique lu', o: ['3 mois', '12 mois', '24 mois'] }, R.gmail.histo, 'data-change="reg" data-g="gmail" data-k="histo"')}
      ${champ({ t: 'select', l: 'Contenu lu', o: ['Extraits seulement', 'Corps complet'] }, R.gmail.contenu, 'data-change="reg" data-g="gmail" data-k="contenu"')}</div>
      ${verrou('Brouillons créés sans signature : Gmail ajoute la vôtre.')}${verrou('Aucun envoi direct : vous envoyez depuis Gmail.')}</div></div>`;
    return `<div class="panel">${head}<div class="panel-b"><div class="grid g2">
      ${champ({ t: 'select', l: 'Calendriers lus', o: ['Agenda principal', 'Agenda principal et agendas partagés'] }, R.agenda.calendriers, 'data-change="reg" data-g="agenda" data-k="calendriers"')}
      ${champ({ t: 'number', l: 'Marge autour des rendez-vous', min: 0, max: 60, u: 'minutes' }, R.agenda.tampon, 'data-change="reg-num" data-g="agenda" data-k="tampon" data-min="0" data-max="60"')}</div>
      ${verrou('L\'OS lit les disponibilités ; il ne crée un rendez-vous qu\'après votre accord.')}</div></div>`;
  };
  const routine = x => `<div class="panel"><div class="panel-h"><div><h2>${esc(x.nom)}</h2><div class="small muted">${esc(rythme(x))}</div></div>
      <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" ${x.actif ? 'checked' : ''} data-change="rt-toggle" data-id="${x.id}" style="accent-color:var(--teal)">${x.actif ? 'Active' : 'En pause'}</label></div>
    <div class="panel-b">${(PARAMS_DEF[x.id] || []).map(f => champ(f, x.params[f.k], `data-change="rt-param" data-id="${x.id}" data-k="${f.k}"`)).join('') || '<p class="muted small" style="margin:0">Rien à régler.</p>'}</div></div>`;
  return {
    title: 'Paramètres',
    actions: `<div class="seg"><button class="${tab === 'connexions' ? 'on' : ''}" data-act="param-tab" data-tab="connexions">Connexions</button><button class="${tab === 'routines' ? 'on' : ''}" data-act="param-tab" data-tab="routines">Routines Claude</button></div>`,
    body: `<div class="alert blue" style="margin-bottom:18px">${ic('lock')}<div>Réglages de <b>${esc(inst.nom)}</b> uniquement. Chaque instance a ses propres connexions ; les accès eux-mêmes ne sont jamais stockés dans l'OS.</div></div>
      ${tab === 'connexions' ? `<div class="stack">${(inst.conn || []).map(conn).join('')}</div>`
        : `<div class="grid g2">${D().routines.map(routine).join('')}</div><p class="small muted" style="margin-top:12px">Les règles de rédaction (vouvoiement, sans signature, contrôles avant envoi) restent celles des skills Claude.</p>`}`
  };
};
const setParam = (x, f, el) => {
  if (f.t === 'checks') x.params[f.k] = [...document.querySelectorAll(`[data-change="rt-param"][data-id="${x.id}"][data-k="${f.k}"]:checked`)].map(i => i.value);
  else if (f.t === 'bool') x.params[f.k] = el.checked;
  else if (f.t === 'number') { const n = +el.value; x.params[f.k] = Math.min(f.max, Math.max(f.min, isNaN(n) ? f.min : n)); }
  else x.params[f.k] = el.value;
};
const saved = () => { const y = scrollY; render(); scrollTo(0, y); toast('Réglage enregistré'); };
Object.assign(ACTIONS, {
  'param-tab': ds => { S.paramTab = ds.tab; render(); },
  'rt-param': (ds, el) => { const x = byId(D().routines, ds.id); setParam(x, PARAMS_DEF[x.id].find(f => f.k === ds.k), el); x.rythme = rythme(x); logAction(`Réglage modifié : ${x.nom}`, 'L2'); saved(); },
  reg: (ds, el) => { D().reglages[ds.g][ds.k] = el.value; logAction(`Connexion réglée : ${ds.g}, ${ds.k}`, 'L2'); saved(); },
  'reg-num': (ds, el) => { const n = +el.value; D().reglages[ds.g][ds.k] = Math.min(+ds.max, Math.max(+ds.min, isNaN(n) ? +ds.min : n)); saved(); },
  'reg-list': (ds, el) => { const l = D().reglages[ds.g][ds.k]; D().reglages[ds.g][ds.k] = el.checked ? [...new Set([...l, el.value])] : l.filter(v => v !== el.value); saved(); },
  'reg-champ': (ds, el) => { const c = D().reglages.crm; c.exclus = el.checked ? c.exclus.filter(f => f !== ds.f) : [...c.exclus, ds.f]; logAction(`Champ ${el.checked ? 'synchronisé' : 'exclu'} : ${ds.f}`, 'L2'); saved(); },
  'conn-on': ds => { (D().reglages.etat = D().reglages.etat || {})[ds.k] = 'ok'; logAction(`Connexion établie (simulée) : ${ds.k}`, 'L2'); render(); toast('Connexion établie (simulation)'); }
});

/* ---------- Autonomie ---------- */
VIEWS.autonomie = () => {
  const a = D().autonomie;
  const rank = n => +n.slice(1);
  return {
    title: 'Autonomie et garde-fous',
    body: `<div class="grid g4" style="margin-bottom:18px">${Object.entries(NIVEAUX).map(([k, n]) => `<div class="panel panel-b">${gauge(k)}<p class="small" style="margin:8px 0 0;color:var(--ink-2)">${n.d}</p></div>`).join('')}</div>
    <div class="panel"><table class="tbl"><thead><tr><th>Action</th><th>Niveau</th><th>Limite</th></tr></thead><tbody>${a.map(x => {
      const max = x.fixe && x.niv !== 'interdit' && x.id !== 'envoi' ? rank(x.niv) : x.id === 'envoi' ? 2 : 3;
      const min = x.min ? rank(x.min) : 0;
      return `<tr><td>${esc(x.action)}</td><td>${x.niv === 'interdit' ? '<span class="badge red">Interdit</span>' : `<div class="lvl" role="group" aria-label="${esc(x.action)}">${['L0', 'L1', 'L2', 'L3'].map((l, k) => `<button class="${x.niv === l ? 'on' : ''}" ${k > max || k < min ? 'disabled' : ''} data-act="auto-set" data-id="${x.id}" data-l="${l}">${l}</button>`).join('')}</div>`}</td><td>${x.fixe ? `<span class="lock">${ic('lock')}${esc(x.fixe)}</span>` : '<span class="small muted">Réglable pour cette instance</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="grid g2" style="margin-top:18px"><div class="panel panel-b"><h3>Garde-fous toujours actifs</h3><ul class="checks small" style="margin-top:8px"><li>Mode simulation disponible sur toute écriture</li><li>Journal d'audit de chaque écriture</li><li>Arrêt de séquence dès qu'un contact répond</li><li>Au plus 30 contacts par exécution (réglable)</li><li>Vérification de l'historique avant tout message</li><li>Aucune action sur une instance non sélectionnée</li></ul></div>
      <div class="panel panel-b"><h3>Cloisonnement</h3><p class="small" style="margin-top:8px;color:var(--ink-2)">Cette instance a ses propres comptes, ses données et ses règles. Aucune donnée d'un autre mandat n'est lue ici. Les secrets d'accès ne sont jamais stockés dans l'OS : la configuration ne contient que leur nom.</p></div></div>`
  };
};
ACTIONS['auto-set'] = ds => { const x = byId(D().autonomie, ds.id); const avant = x.niv; x.niv = ds.l; logAction(`Autonomie modifiée : ${x.action} (${avant} → ${ds.l})`, 'L2'); render(); toast(`${x.action} : ${ds.l}`); };

/* ---------- Journal d'audit ---------- */
VIEWS.journal = () => {
  const f = S.jFilter || 'tout';
  const j = D().journal.filter(x => f === 'tout' || x.par === f);
  return {
    title: "Journal d'audit",
    actions: `<div class="seg"><button class="${f === 'tout' ? 'on' : ''}" data-act="j-f" data-f="tout">Tout</button><button class="${f === 'os' ? 'on' : ''}" data-act="j-f" data-f="os">L'OS</button><button class="${f === 'pilote' ? 'on' : ''}" data-act="j-f" data-f="pilote">Vous</button></div>`,
    body: `<div class="panel">${j.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Par</th><th>Action</th><th>Niveau</th></tr></thead><tbody>${j.map(x => `<tr><td class="num small">${fdate(x.date)}</td><td>${who(x.par)}</td><td>${esc(x.action)}</td><td>${x.niv ? gauge(x.niv) : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucune entrée pour ce filtre.</div>'}</div>`
  };
};
ACTIONS['j-f'] = ds => { S.jFilter = ds.f; render(); };

/* ---------- Second cerveau ---------- */
VIEWS.cerveau = () => {
  const d = D(), inst = INST();
  const auto = d.autonomie.filter(a => a.niv !== 'interdit').map(a => `${a.action.split(',')[0]} : ${a.niv}`).slice(0, 5);
  return {
    title: 'Second cerveau',
    body: `<div class="grid g-main"><div class="stack">
      <div class="panel"><div class="panel-h"><h2>Notes écrites par l'OS</h2><span class="badge">toujours en brouillon</span></div>
        <div class="panel-b">${d.notes.length ? d.notes.map(n => `<div style="padding:10px 0;border-bottom:1px solid var(--line-2)"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(n.titre)}</b><span class="badge amber">brouillon</span></div><p class="small" style="margin:4px 0;color:var(--ink-2)">${esc(n.txt)}</p><div class="small muted">${fdate(n.date)}, vers ${esc(n.dest)}</div></div>`).join('') : '<div class="empty">Aucune note pour l\'instant. Les affaires gagnées ou perdues en proposeront.</div>'}</div></div>
      <div class="panel panel-b"><h3>Comment l'OS s'en sert</h3><ul class="checks small" style="margin-top:8px"><li>Il lit d'abord l'index, puis seulement les fiches utiles à la tâche</li><li>Il choisit explicitement le mandat et n'utilise rien d'un autre mandat</li><li>Il écrit selon la procédure Mémoriser, en brouillon, avec une entrée datée au journal</li><li>Il montre les contradictions au lieu de les trancher</li><li>Ce qui marche dans un mandat ne remonte dans les méthodes que dépersonnalisé et validé par vous</li></ul></div></div>
      <div class="panel"><div class="panel-h"><h2>Fiche d'instance</h2><span class="badge">sans secret</span></div><div class="panel-b"><table class="tbl small"><tbody>
        <tr><td class="muted">Instance</td><td><b>${esc(inst.nom)}</b>, ${esc(inst.sous)}</td></tr>
        ${inst.situation ? `<tr><td class="muted">Situation de départ</td><td>${esc(inst.situation)}</td></tr>` : ''}
        <tr><td class="muted">Outil de référence</td><td>${esc(inst.outil)}</td></tr>
        <tr><td class="muted">Accès</td><td class="num">${inst.id.toUpperCase().replace(/-/g, '_')}_CRM_TOKEN<br>${inst.id.toUpperCase()}_GMAIL<br>${inst.id.toUpperCase()}_AGENDA</td></tr>
        <tr><td class="muted">Bases</td><td>${d.bases.map(b => esc(b.nom)).join(', ') || 'Aucune'}</td></tr>
        <tr><td class="muted">Règles propres</td><td>${inst.modules.includes('relais') ? 'Accord préalable d\'un expert, organismes publics exclus, écrire à la première personne' : 'Règles standard'}</td></tr>
        <tr><td class="muted">Autonomie</td><td>${auto.map(esc).join('<br>')}</td></tr></tbody></table>
        <p class="small muted" style="margin-top:10px">Les accès sont des noms de variables. Les valeurs vivent dans un coffre de secrets, hors de l'OS et du second cerveau.</p></div></div></div>`
  };
};
