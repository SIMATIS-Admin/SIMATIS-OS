/* Instruments de bord : routines, autonomie, journal d'audit, second cerveau. */

VIEWS.routines = () => {
  const r = D().routines;
  return {
    title: 'Routines', sub: 'Ce que l\'OS fait pour vous à rythme régulier. Chaque exécution laisse un rapport court.',
    body: `<div class="grid g2">${r.map(x => `<div class="panel"><div class="panel-h"><div><h2>${esc(x.nom)}</h2><div class="small muted">${esc(x.rythme)}</div></div>
        <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" ${x.actif ? 'checked' : ''} data-change="rt-toggle" data-id="${x.id}" style="accent-color:var(--teal)">${x.actif ? 'Active' : 'En pause'}</label></div>
      <div class="panel-b report-col"><p class="small" style="color:var(--ink-2)">${esc(x.contenu)}</p>
        <div class="small muted">Dernière exécution : ${rel(x.dernier)}</div>
        <h4>Fait</h4><ul>${x.rapport.fait.map(f => `<li>${esc(f)}</li>`).join('') || '<li>Rien</li>'}</ul>
        ${x.rapport.attente.length ? `<h4>En attente de validation</h4><ul>${x.rapport.attente.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        ${x.rapport.echec.length ? `<h4>Échecs</h4><ul>${x.rapport.echec.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div>
      <div class="decision"><button class="btn sm" data-act="rt-run" data-id="${x.id}" ${x.actif ? '' : 'disabled'}>${ic('play')}Exécuter maintenant</button><span class="hint">Exécution simulée, rien n'est envoyé.</span></div></div>`).join('')}</div>
    <p class="small muted" style="margin-top:14px">Le mode d'exécution réel des routines (sessions Claude Code, tâches planifiées ou scripts autonomes) reste à décider.</p>`
  };
};
Object.assign(ACTIONS, {
  'rt-toggle': (ds, el) => { const x = byId(D().routines, ds.id); x.actif = el.checked; logAction(`Routine ${el.checked ? 'activée' : 'mise en pause'} : ${x.nom}`, 'L2'); render(); },
  'rt-run': ds => {
    const x = byId(D().routines, ds.id), d = D();
    const t = d.taches.find(t => !t.fait && diffDays(t.echeance) <= 0 && t.canal === 'email' && !t.prepare);
    const fait = ['Lecture des tâches, de la messagerie et de l\'agenda'];
    if (t && x.id === 'r-quot') {
      t.prepare = true; const o = byId(d.opps, t.opp); const c = contact(o.contact);
      d.validations.unshift({ id: uid('v'), type: 'email', niv: 'L1', titre: 'Relance préparée par la routine', soc: o.soc, contact: o.contact, origine: x.nom, objet: o.titre,
        corps: email(c.nom, '', ['Je reviens vers vous suite à notre dernier échange.', 'Seriez-vous disponible pour en reparler brièvement ?'], creneaux(4)),
        controles: ['Historique de messagerie consulté', 'Tâche échue ' + rel(t.echeance), 'Créneaux vérifiés dans l\'agenda'], source: INST().outil, confiance: 'élevée' });
      fait.push('1 brouillon de relance préparé');
    }
    fait.push(x.id === 'r-hebdo' ? 'Revue du pipeline par score' : 'Rapport produit');
    x.dernier = dp(0); x.rapport = { fait, attente: [`${pending()} élément${pending() > 1 ? 's' : ''} à valider`], echec: [] };
    logAction(`Routine exécutée : ${x.nom}`, 'L3', 'os'); render(); toast('Routine exécutée, rapport mis à jour');
  }
});

/* ---------- Autonomie ---------- */
VIEWS.autonomie = () => {
  const a = D().autonomie;
  const rank = n => +n.slice(1);
  return {
    title: 'Autonomie et garde-fous', sub: 'Jusqu\'où l\'OS peut aller seul, action par action. Certaines limites ne se déverrouillent pas.',
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
    title: "Journal d'audit", sub: 'Qui a fait quoi, quand, à quel niveau d\'autonomie. Les contenus sensibles ne sont pas recopiés.',
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
    title: 'Second cerveau', sub: 'La mémoire durable : stratégie, offre, méthodes, décisions et leurs raisons. Jamais de contacts ni de pipeline.',
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
