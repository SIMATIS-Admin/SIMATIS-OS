/* Pilotage : brief du jour, file de validation, tableau de bord, portefeuille. */

const late = () => D().taches.filter(t => !t.fait && diffDays(t.echeance) < 0);
const todayTasks = () => D().taches.filter(t => !t.fait && diffDays(t.echeance) === 0);
const rdvToday = () => D().rdv.filter(r => diffDays(r.date) === 0);
const devisARelancer = () => !allowed('devis') ? [] : D().devis.filter(d => d.statut === 'transmis' && diffDays(d.envoye) <= -10);

VIEWS.brief = () => {
  const d = D(), inst = INST();
  const nV = pending(), nL = late().length, nR = rdvToday().length, nD = devisARelancer().length;
  const jour = TODAY.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const phrase = [nV && `${nV} décision${nV > 1 ? 's' : ''} vous attend${nV > 1 ? 'ent' : ''}`, nL && `${nL} tâche${nL > 1 ? 's' : ''} en retard`, nR && `${nR} rendez-vous aujourd'hui`].filter(Boolean);
  const routine = d.routines[0];
  const items = [
    ...rdvToday().map(r => ({ t: r.heure, html: `<b>${esc(r.titre)}</b><div class="small muted">${esc(r.lieu)}${r.binome ? ', en binôme avec ' + esc(r.binome) : ''}</div>`, act: `<button class="btn sm" data-act="rdv-prep" data-id="${r.id}">Préparer</button>` })),
    ...late().map(t => ({ t: '<span class="late">Retard</span>', html: `<b>${esc(t.titre)}</b><div class="small muted">Échue ${rel(t.echeance)}, ${t.canal}</div>`, act: `<button class="btn sm" data-act="task-done" data-id="${t.id}">Marquer fait</button>` })),
    ...todayTasks().map(t => ({ t: 'Jour', html: `<b>${esc(t.titre)}</b><div class="small muted">${t.canal === 'appel' ? 'Fiche d\'appel prête' : t.canal}</div>`, act: `<button class="btn sm" data-act="task-done" data-id="${t.id}">Marquer fait</button>` }))
  ];
  const parScore = ['chaude', 'tiede', 'faible', 'froid'].map(k => ({ k, n: d.opps.filter(o => !o.clos && cat(total(o.score)).k === k).length }));
  const maxS = Math.max(1, ...parScore.map(x => x.n));
  const sig = d.signaux.slice(0, 2);
  return {
    title: 'Brief du jour',
    body: `
    <section class="brief-hero">
      <div style="position:relative;z-index:1">
        <h1>Bonjour, nous sommes ${jour}.</h1>
        <p class="lead">${phrase.length ? phrase.join(', ') + '.' : 'Rien ne vous attend ce matin. Profitez-en pour avancer le plan d\'action.'}</p>
        <p>La routine de ${routine.rythme.match(/\d+h\d+/)[0]} a préparé le terrain. Rien n'a été envoyé : tout ce qui engage attend votre décision.</p>
      </div>
      <div class="brief-counts">
        <button data-act="go" data-v="validations"><span class="n">${nV}</span><span class="l">à valider</span></button>
        <button data-act="go" data-v="pipeline" class="${nL ? 'warn' : ''}"><span class="n">${nL}</span><span class="l">tâches en retard</span></button>
        <button data-act="go" data-v="agenda"><span class="n">${nR}</span><span class="l">rendez-vous aujourd'hui</span></button>
        ${allowed('devis') ? `<button data-act="go" data-v="devis"><span class="n">${nD}</span><span class="l">devis à relancer</span></button>` : ''}
      </div>
    </section>
    <div class="grid g-main" style="margin-top:18px">
      <div class="stack">
        <div class="panel"><div class="panel-h"><h2>Votre journée</h2><span class="muted small">${items.length} élément${items.length > 1 ? 's' : ''}</span></div>
          <div class="panel-b">${items.length ? `<ul class="timeline">${items.map(i => `<li><span class="t">${i.t}</span><div>${i.html}</div>${i.act}</li>`).join('')}</ul>` : '<div class="empty">Journée libre. Les signaux de détection sont un bon point de départ.</div>'}</div></div>
        <div class="panel"><div class="panel-h"><h2>Signaux à regarder</h2><button class="btn ghost sm" data-act="go" data-v="detection">Tous les signaux</button></div>
          <div class="panel-b">${sig.length ? sig.map(s => `<div style="padding:6px 0"><span class="badge ${s.force === 'fort' ? 'green' : ''}">${esc(s.type)}</span> <b>${esc(s.soc)}</b> ${esc(s.txt)}. <span class="muted small">Source : ${esc(s.source)}, ${rel(s.date)}.</span></div>`).join('') : '<div class="empty">Aucun signal cette semaine.</div>'}</div></div>
      </div>
      <div class="stack">
        <div class="panel"><div class="panel-h"><h2>Rapport de la routine</h2>${who('os')}</div>
          <div class="panel-b report-col">
            <div class="small muted">${esc(routine.nom)}, ${rel(routine.dernier)}</div>
            <h4>Ce qui a été fait</h4><ul>${routine.rapport.fait.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            <h4>Ce qui attend votre validation</h4><ul>${routine.rapport.attente.map(x => `<li>${esc(x)}</li>`).join('') || '<li>Rien</li>'}</ul>
            ${routine.rapport.echec.length ? `<h4>Ce qui a échoué</h4><ul>${routine.rapport.echec.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          </div></div>
        <div class="panel"><div class="panel-h"><h2>Pipeline par score</h2><button class="btn ghost sm" data-act="go" data-v="pipeline">Ouvrir</button></div>
          <div class="panel-b bars">${parScore.map(x => `<div class="row"><span>${cat({ chaude: 12, tiede: 8, faible: 4, froid: 0 }[x.k]).nom}</span><div class="bar" style="width:${x.n / maxS * 100}%;background:${{ chaude: '#2F8F5B', tiede: '#C98A12', faible: '#164A88', froid: '#B9C3D0' }[x.k]}"></div><span class="v">${x.n}</span></div>`).join('')}</div></div>
      </div>
    </div>`
  };
};

Object.assign(ACTIONS, {
  'task-done': ds => { const t = byId(D().taches, ds.id); t.fait = true; logAction(`Tâche marquée faite : ${t.titre}`, 'L2'); render(); toast('Tâche marquée faite'); }
});

/* ---------- File de validation ---------- */
const TYPE_V = { email: 'Brouillon', lot: 'Lot de brouillons', tache: 'Tâche CRM', base: 'Base', note: 'Second cerveau', accord: 'Accord interne' };

VIEWS.validations = () => {
  const d = D();
  const f = S.vqFilter;
  const all = d.validations;
  const list = all.filter(v => f === 'traites' ? v.statut : !v.statut && (f === 'tout' || v.type === f));
  if (!list.find(v => v.id === S.vqSel)) S.vqSel = list[0]?.id || null;
  const sel = byId(all, S.vqSel);
  const types = [...new Set(all.filter(v => !v.statut).map(v => v.type))];
  return {
    title: 'À valider',
    body: `<div class="vq">
      <div class="panel">
        <div class="vq-filter">
          <button class="chip ${f === 'tout' ? 'on' : ''}" data-act="vq-filter" data-f="tout">Tout (${pending()})</button>
          ${types.map(t => `<button class="chip ${f === t ? 'on' : ''}" data-act="vq-filter" data-f="${t}">${TYPE_V[t]}</button>`).join('')}
          <button class="chip ${f === 'traites' ? 'on' : ''}" data-act="vq-filter" data-f="traites">Traités</button>
        </div>
        <div class="vq-list">${list.length ? list.map(v => `<button class="vq-item ${v.id === S.vqSel ? 'on' : ''}" data-act="vq-sel" data-id="${v.id}">
            <div class="row1"><b>${esc(v.titre)}</b>${v.statut ? `<span class="badge ${v.statut === 'valide' ? 'green' : ''}">${v.statut === 'valide' ? 'Validé' : 'Écarté'}</span>` : `<span class="badge">${TYPE_V[v.type]}</span>`}</div>
            <small>${v.soc ? esc(soc(v.soc).nom) + ', ' : ''}${esc(v.origine)}</small></button>`).join('') : `<div class="empty">${f === 'traites' ? 'Aucune décision prise pour l\'instant.' : 'Tout est traité. La prochaine routine préparera la suite.'}</div>`}</div>
      </div>
      <div>${sel ? vDetail(sel) : '<div class="panel empty">Sélectionnez un élément à gauche.</div>'}</div>
    </div>`
  };
};

function vDetail(v) {
  const c = v.contact ? contact(v.contact) : null;
  const meta = `<div class="meta-row" style="margin-bottom:12px"><span>${gauge(v.niv)} ${tip(`Niveau d'autonomie de l'OS pour cette action (${v.niv} : ${NIVEAUX[v.niv].d}). Il va de L0, l'OS suggère seulement, à L3, l'OS agit seul. Plus il y a de barres colorées, plus l'OS peut agir sans vous.`)}</span><span>Source : <b>${esc(v.source)}</b></span><span>Confiance : <b>${esc(v.confiance)}</b></span></div>`;
  let main = '', buttons = '', hint = '';
  const done = v.statut ? `<div class="alert ${v.statut === 'valide' ? 'blue' : 'amber'}">${ic('info')}<div>${v.statut === 'valide' ? 'Validé' : 'Écarté'} par vous. ${v.resultat ? esc(v.resultat) : ''}</div></div>` : '';
  if (v.type === 'email') {
    main = `<div class="mail"><div class="mail-h"><div><span>À</span>${esc(c.nom)} &lt;${esc(c.email)}&gt;</div><div><span>Objet</span><b>${esc(v.objet)}</b></div></div>
      <div class="mail-b" id="mail-body" ${S.editing === v.id ? 'contenteditable="true"' : ''}>${v.corps}</div></div>
      <h3 style="margin:16px 0 6px">Contrôles faits avant rédaction</h3><ul class="checks">${v.controles.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    buttons = `<button class="btn go" data-act="v-ok" data-id="${v.id}">${ic('check')}Créer le brouillon dans Gmail</button>
      <button class="btn" data-act="v-edit" data-id="${v.id}">${ic('edit')}${S.editing === v.id ? 'Terminer la modification' : 'Modifier le texte'}</button>
      <button class="btn ghost danger" data-act="v-no" data-id="${v.id}">Écarter</button>`;
    hint = "Le brouillon est créé dans Gmail sans signature : Gmail ajoute la vôtre. C'est vous qui l'envoyez.";
  } else if (v.type === 'tache') {
    main = `<p>${esc(v.detail)}</p><div class="meta-row"><span>Contact : <b>${esc(c.nom)}</b>, ${esc(soc(v.soc).nom)}</span><span>Échéance proposée : <b>${fdate(v.echeance)}</b></span></div>`;
    buttons = `<button class="btn go" data-act="v-ok" data-id="${v.id}">${ic('check')}Créer la tâche</button><button class="btn ghost danger" data-act="v-no" data-id="${v.id}">Écarter</button>`;
    hint = 'La tâche sera créée dans l\'outil du mandat et tracée dans le journal.';
  } else if (v.type === 'base') {
    main = `<p>${esc(v.detail)}</p><table class="tbl diff"><thead><tr><th>Contact</th><th>Avant</th><th>Après</th></tr></thead><tbody>${v.diff.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}<tr><td colspan="3" class="muted small">et 11 autres lignes</td></tr></tbody></table>`;
    buttons = `<button class="btn go" data-act="v-ok" data-id="${v.id}">${ic('check')}Appliquer les 14 changements</button><button class="btn ghost danger" data-act="v-no" data-id="${v.id}">Écarter</button>`;
    hint = 'Un instantané est pris avant. Vous pourrez revenir en arrière depuis Bases vivantes.';
  } else if (v.type === 'note') {
    main = `<p>${esc(v.detail)}</p><div class="meta-row"><span>Destination : <b>${esc(v.destination)}</b></span><span>Statut à l'écriture : <b>brouillon</b></span></div>`;
    buttons = `<button class="btn go" data-act="v-ok" data-id="${v.id}">${ic('check')}Enregistrer en brouillon</button><button class="btn ghost danger" data-act="v-no" data-id="${v.id}">Écarter</button>`;
    hint = "L'OS n'écrit jamais une note validée : vous la relirez dans le second cerveau.";
  } else if (v.type === 'lot') {
    const ex = v.liste[0], sl = creneaux(7);
    main = `<p>${v.liste.length} brouillons personnalisés, un par contact retenu. Exemple pour le premier :</p>
      <div class="mail"><div class="mail-h"><div><span>À</span>${esc(ex.f)}, ${esc(ex.soc)}</div><div><span>Objet</span><b>Votre organisation commerciale</b></div></div>
      <div class="mail-b">${email('Madame, Monsieur', '', [`${ex.rep}, nous avions évoqué l'organisation commerciale de ${esc(ex.soc)}.`, 'Je vous propose un échange de trente minutes pour voir si une direction commerciale à temps partagé aurait du sens pour vous.'], sl)}</div></div>
      <table class="tbl small" style="margin-top:14px"><thead><tr><th>Société</th><th>Type</th><th>Repère temporel</th></tr></thead><tbody>${v.liste.slice(1, 6).map(x => `<tr><td>${esc(x.soc)}</td><td>${x.t}</td><td>${esc(x.rep)}</td></tr>`).join('')}${v.liste.length > 6 ? `<tr><td colspan="3" class="muted">et ${v.liste.length - 6} autres</td></tr>` : ''}</tbody></table>`;
    buttons = `<button class="btn go" data-act="v-ok" data-id="${v.id}">${ic('check')}Créer les ${v.liste.length} brouillons dans Gmail</button><button class="btn ghost danger" data-act="v-no" data-id="${v.id}">Écarter le lot</button>`;
    hint = 'Rien ne part sans vous : chaque brouillon s\'envoie depuis Gmail.';
  } else if (v.type === 'accord') {
    main = `<p>${esc(v.detail)}</p><div class="mail"><div class="mail-h"><div><span>À</span>Cheffe de projet (interne)</div><div><span>Objet</span><b>Accord pour contacter ${esc(soc(v.soc).nom)} ?</b></div></div><div class="mail-b"><p>Bonjour,</p><p>Je souhaiterais contacter ${esc(c.nom)} au sujet d'une étude complémentaire. Êtes-vous d'accord, ou préférez-vous que nous en parlions d'abord ?</p><p>Bien à vous,</p></div></div>`;
    buttons = `<button class="btn go" data-act="v-ok" data-id="${v.id}">${ic('check')}Créer le brouillon interne</button><button class="btn ghost danger" data-act="v-no" data-id="${v.id}">Écarter</button>`;
    hint = "Tant que l'accord n'est pas obtenu, le compte reste exclu des campagnes.";
  }
  return `<div class="panel"><div class="panel-h"><div><h2>${esc(v.titre)}</h2><div class="small muted">${esc(v.origine)}${c ? ', ' + esc(c.nom) + ', ' + esc(soc(v.soc).nom) : ''}</div></div>${who('os')}</div>
    <div class="panel-b">${done}${meta}${main}</div>
    ${v.statut ? '' : `<div class="decision">${buttons}<span class="hint">${hint}</span></div>`}</div>`;
}

const RESULTATS = { email: 'Brouillon créé dans Gmail, à envoyer par vous.', tache: 'Tâche créée et tracée.', base: '14 lignes modifiées, instantané conservé.', note: 'Note enregistrée en brouillon dans le second cerveau.', accord: 'Brouillon interne créé.', lot: 'Brouillons créés dans Gmail, à envoyer par vous.' };

Object.assign(ACTIONS, {
  'vq-filter': ds => { S.vqFilter = ds.f; S.vqSel = null; render(); },
  'vq-sel': ds => { S.vqSel = ds.id; S.editing = null; render(); },
  'v-edit': ds => {
    const v = byId(D().validations, ds.id);
    if (S.editing === v.id) { v.corps = document.getElementById('mail-body').innerHTML; S.editing = null; toast('Texte mis à jour'); }
    else S.editing = v.id;
    render(); if (S.editing) document.getElementById('mail-body')?.focus();
  },
  'v-ok': ds => decide(ds.id, 'valide'),
  'v-no': ds => decide(ds.id, 'ecarte')
});

function decide(id, statut) {
  const v = byId(D().validations, id);
  if (S.editing === id) { v.corps = document.getElementById('mail-body').innerHTML; S.editing = null; }
  v.statut = statut;
  v.resultat = statut === 'valide' ? (INST().demo ? 'En démonstration, rien n\'est créé.' : RESULTATS[v.type]) : '';
  logAction(`${statut === 'valide' ? 'Validé' : 'Écarté'} : ${v.titre}${v.soc ? ' (' + soc(v.soc).nom + ')' : ''}`, v.niv);
  if (statut === 'valide' && v.type === 'base') { const b = D().bases[0]; if (b) { b.statuts['Invalide'] += 14; b.statuts['Pas de réponse'] -= 12; b.statuts['Non contacté'] -= 2; b.snap = { date: dp(0), label: 'Avant passage de 14 contacts en Invalide' }; } }
  if (statut === 'valide' && v.type === 'note') D().notes.unshift({ titre: v.titre, txt: v.detail, dest: v.destination, date: dp(0), statut: 'brouillon' });
  if (statut === 'valide' && v.type === 'tache') D().taches.push({ id: uid('t'), titre: 'Suivi ' + (v.soc ? soc(v.soc).nom : ''), echeance: v.echeance, canal: 'tâche', fait: false });
  const next = D().validations.find(x => !x.statut);
  S.vqSel = next ? next.id : id;
  render();
  toast(statut === 'valide' ? (v.resultat || 'Validé') : 'Écarté, rien n\'a été fait');
}

/* ---------- Tableau de bord ---------- */
VIEWS.tableau = () => {
  const d = D(), f = d.funnel;
  const prospects = f.leads * f.l2p / 100, devis = prospects * f.p2d / 100, cmd = devis * f.d2c / 100, ca = cmd * f.panier;
  const annuel = ca * 12, besoinLeads = f.objectif / 12 / (f.l2p / 100 * f.p2d / 100 * f.d2c / 100 * f.panier);
  const max = f.leads;
  const ouvertes = d.opps.filter(o => !o.clos);
  const pipeTotal = ouvertes.reduce((a, o) => a + o.montant, 0);
  const chaudes = ouvertes.filter(o => total(o.score) >= 12);
  const camp = d.campagnes[0];
  const row = (lbl, val, w, slider, unit) => `<div class="funnel-row"><div class="lbl">${lbl}${slider ? `<input type="range" ${slider} aria-label="${lbl.replace(/<[^>]+>/g, '')}">` : ''}</div><div class="funnel-bar" style="width:${Math.max(1, w)}%"></div><div class="v">${val}${unit || ''}</div></div>`;
  return {
    title: 'Tableau de bord',
    body: `
    <div class="grid g3">
      <div class="panel kpi"><span class="l">Pipeline ouvert</span><span class="v">${eurTxt(pipeTotal)}</span><span class="small muted">${ouvertes.length} opportunités</span></div>
      <div class="panel kpi"><span class="l">Opportunités chaudes (12 et plus)</span><span class="v">${chaudes.length}</span><span class="small muted">${eurTxt(chaudes.reduce((a, o) => a + o.montant, 0))}</span></div>
      <div class="panel kpi"><span class="l">Taux de réponse, dernière campagne</span><span class="v">${camp ? Math.round(camp.reponses / camp.brouillons * 100) + ' %' : '<span style="font:600 20px var(--f-title)">Pas encore</span>'}</span><span class="small muted">${camp ? camp.rdv + ' rendez-vous obtenu' + (camp.rdv > 1 ? 's' : '') : 'Aucune campagne lancée'}</span></div>
    </div>
    <div class="panel" style="margin-top:18px">
      <div class="panel-h"><div><h2>Du lead à la commande</h2><div class="small muted">Chiffre d'affaires = leads × taux lead → prospect × taux prospect → devis × taux devis → commande × panier moyen. Déplacez les curseurs pour simuler.</div></div><span class="badge amber">Modèle à valider</span></div>
      <div class="panel-b">
        ${row('Leads par mois', `<span class="num">${f.leads}</span>`, 100, `min="5" max="200" step="5" value="${f.leads}" data-input="fun" data-k="leads"`)}
        ${row(`Prospects rencontrés <span class="muted small">(${f.l2p} %)</span>`, `<span class="num">${prospects.toFixed(1)}</span>`, prospects / max * 100, `min="5" max="80" value="${f.l2p}" data-input="fun" data-k="l2p"`)}
        ${row(`Devis envoyés <span class="muted small">(${f.p2d} %)</span>`, `<span class="num">${devis.toFixed(1)}</span>`, devis / max * 100, `min="5" max="100" value="${f.p2d}" data-input="fun" data-k="p2d"`)}
        ${row(`Commandes <span class="muted small">(${f.d2c} %)</span>`, `<span class="num">${cmd.toFixed(1)}</span>`, cmd / max * 100, `min="5" max="90" value="${f.d2c}" data-input="fun" data-k="d2c"`)}
        ${row('Panier moyen', eur(f.panier), 0, `min="2000" max="60000" step="500" value="${f.panier}" data-input="fun" data-k="panier"`)}
        <div class="verdict" style="margin-top:18px"><div class="big">${eurTxt(annuel)}<small> / an</small></div>
          <div>Objectif annuel <b class="num">${eurTxt(f.objectif)}</b>. ${annuel >= f.objectif ? 'La trajectoire est tenue.' : `Il faudrait <b class="num">${Math.ceil(besoinLeads)}</b> leads par mois à taux constants, ou améliorer un taux de conversion.`}</div></div>
        <p class="small muted">Suivez ces taux dès le début, même sans référence : ils deviennent fiables après quelques mois, selon la durée moyenne du cycle de vente.</p>
      </div>
    </div>`
  };
};
ACTIONS.fun = (ds, el) => {
  D().funnel[ds.k] = +el.value; const y = window.scrollY; render(); window.scrollTo(0, y);
  document.querySelector(`[data-k="${ds.k}"]`)?.focus();
};

/* ---------- Portefeuille ---------- */
VIEWS.portefeuille = () => {
  const rows = INSTANCES.map(i => {
    const d = S.data[i.id];
    return { i, v: d.validations.filter(v => !v.statut).length, l: d.taches.filter(t => !t.fait && diffDays(t.echeance) < 0).length, r: d.rdv.filter(r => diffDays(r.date) >= 0 && diffDays(r.date) <= 7).length, t: d.temps, ro: d.routines.filter(r => r.actif).length };
  });
  return {
    title: 'Portefeuille',
    body: `<div class="alert blue" style="margin-bottom:18px">${ic('lock')}<div>Cette vue ne montre que des compteurs. Aucun contact, aucun échange et aucun montant d'un mandat n'apparaît dans un autre. Le périmètre exact de ce qui peut être croisé reste à décider.</div></div>
    <div class="panel"><table class="tbl"><thead><tr><th>Instance</th><th>Situation</th><th class="r">À valider</th><th class="r">Tâches en retard</th><th class="r">Rendez-vous 7 j</th><th class="r">Temps cette semaine</th><th class="r">Routines actives</th></tr></thead>
    <tbody>${rows.map(x => `<tr class="click" data-act="inst" data-id="${x.i.id}"><td><span class="inst-dot" style="display:inline-block;background:${x.i.c};margin-right:8px"></span><b>${esc(x.i.nom)}</b><div class="small muted">${esc(x.i.sous)}</div></td><td>${x.i.demo ? '<span class="badge amber">Démonstration</span>' : esc(x.i.situation || 'Activité propre')}</td><td class="r num">${x.v}</td><td class="r num ${x.l ? 'late' : ''}">${x.l}</td><td class="r num">${x.r}</td><td class="r num">${x.t} h</td><td class="r num">${x.ro}/4</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted" style="margin-top:12px">Le temps par instance est lu dans les agendas. Cliquez sur une ligne pour ouvrir l'instance.</p>`
  };
};
