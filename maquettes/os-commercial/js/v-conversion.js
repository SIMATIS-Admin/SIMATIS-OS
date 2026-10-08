/* Conversion : pipeline, fiche opportunité, rendez-vous, devis, relais internes. */

const MOTIFS = ['Budget reporté', 'Choix d\'un concurrent', 'Projet abandonné', 'Recrutement en interne', 'Pas de réponse', 'Autre'];

/* ---------- Pipeline ---------- */
/* Étape la plus avancée atteinte : une affaire gagnée a atteint la commande (rang 5). */
const rang = o => o.clos === 'gagne' ? ETAPES.length : ETAPES.findIndex(e => e.id === o.etape);
function conversions(opps) {
  const atteint = k => opps.filter(o => rang(o) >= k).length;
  return ETAPES.map((e, k) => { const den = atteint(k); return den ? Math.round(atteint(k + 1) / den * 100) : null; });
}
const MIROIR_TIP = (crm, quoi = 'Ce pipeline est le reflet exact du pipeline') => `${quoi} ${crm} de l'instance, qui fait foi. ${crmEcrit() ? `Ce que vous changez ici est écrit dans ${crm}` : 'Synchronisation en lecture seule : rien n\'est écrit dans ' + crm} ; ce qui change dans ${crm} remonte ici à chaque synchronisation (${D().reglages.crm.freq.toLowerCase()}, ou à la demande ; réglable dans Paramètres).`;
/* Badge et bouton de synchronisation, communs au pipeline, aux entreprises et aux contacts d'une instance sous CRM. */
const miroir = quoi => INST().crm ? `<span class="badge blue">Miroir ${INST().crm}, synchronisé ${S.sync?.[S.inst] ? 'à l\'instant' : 'il y a 5 min'}</span>${tip(MIROIR_TIP(INST().crm, quoi))}<button class="btn" data-act="crm-sync">Synchroniser</button>` : '';
const CONV_TIP = "Taux de conversion : part des opportunités arrivées à l'étape de gauche qui ont atteint l'étape de droite. Les affaires ouvertes, gagnées et perdues sont toutes comptées ; une affaire perdue compte jusqu'à l'étape où elle s'est arrêtée.";

VIEWS.pipeline = () => {
  const d = D(), mode = S.pipeMode;
  const opps = d.opps.filter(o => !o.clos);
  const conv = conversions(d.opps);
  const card = o => { const lt = !o.clos && diffDays(o.echeance) < 0; return `<div class="card" draggable="true" data-drag="${o.id}" data-act="opp" data-id="${o.id}" tabindex="0">
      <div class="soc">${esc(soc(o.soc).nom)}</div><div class="ttl">${esc(o.titre)}</div>
      ${o.clos === 'perdu' ? `<div class="motif">Perdue en ${ETAPES.find(e => e.id === o.etape).nom.toLowerCase()}${o.motif ? ' : ' + esc(o.motif.toLowerCase()) : ''}</div>` : o.clos ? '' : `<div class="next ${lt ? 'late' : ''}">${esc(o.prochaine)}, ${rel(o.echeance)}</div>`}
      <div class="ft">${scoreBadge(o.score)}<span class="small">${o.montant ? eur(o.montant) : '<span class="muted">à estimer</span>'}</span></div></div>`; };
  const col = (id, nom, os, cls = '') => `<div class="col ${cls}" data-drop="${id}"><div class="col-h"><b>${nom} <span class="muted">${os.length}</span></b><span>${eurTxt(os.reduce((a, o) => a + o.montant, 0))}</span></div>${os.map(card).join('') || '<div class="small muted" style="padding:8px">Glissez une carte ici</div>'}</div>`;
  const arrow = (k, de, vers) => `<div class="conv" aria-label="${de} vers ${vers} : ${conv[k] == null ? 'pas de donnée' : conv[k] + ' %'}"><span class="pct ${conv[k] != null && conv[k] < 30 ? 'low' : ''}">${conv[k] == null ? '–' : conv[k] + '%'}</span><span class="arr">→</span>${k === 0 ? tip(CONV_TIP) : ''}</div>`;
  const noms = [...ETAPES.map(e => e.nom), 'Commande'];
  const board = `<div class="board">${ETAPES.map((e, k) => col(e.id, e.nom, opps.filter(o => o.etape === e.id)) + arrow(k, noms[k], noms[k + 1])).join('')}
    ${col('gagne', 'Gagnées', d.opps.filter(o => o.clos === 'gagne'), 'won closed')}${col('perdu', 'Perdues', d.opps.filter(o => o.clos === 'perdu'), 'lost closed')}</div>`;
  const cells = [['eleve-forte', 'Potentiel élevé, faisabilité forte'], ['eleve-faible', 'Potentiel élevé, faisabilité faible'], ['limite-forte', 'Potentiel limité, faisabilité forte'], ['limite-faible', 'Potentiel limité, faisabilité faible']];
  const matrix = `<div class="matrix"><div class="ax y">Potentiel élevé</div>${cells.slice(0, 2).map(cellH).join('')}<div class="ax y">Potentiel limité</div>${cells.slice(2).map(cellH).join('')}<div></div><div class="ax">Faisabilité forte</div><div class="ax">Faisabilité faible</div></div>`;
  function cellH([k, l]) { const m = MATRICE[k]; const os = opps.filter(o => `${o.potentiel}-${o.faisab}` === k); return `<div class="cell ${m.k}" aria-label="${l}"><h3>${m.nom}<span class="num small muted">${os.length}</span></h3><p>${m.d}</p>${os.map(o => `<span class="pill" data-act="opp" data-id="${o.id}">${scoreBadge(o.score)}${esc(soc(o.soc).nom)}</span>`).join('')}</div>`; }
  return {
    title: 'Pipeline',
    actions: `${miroir()}<div class="seg"><button class="${mode === 'board' ? 'on' : ''}" data-act="pipe-mode" data-m="board">Étapes</button><button class="${mode === 'matrice' ? 'on' : ''}" data-act="pipe-mode" data-m="matrice">Matrice</button></div><button class="btn primary" data-act="opp-new">Nouvelle opportunité</button>`,
    body: mode === 'board' ? board : matrix,
    after: () => {
      document.querySelectorAll('[data-drag]').forEach(c => c.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', c.dataset.drag)));
      document.querySelectorAll('[data-drop]').forEach(col => {
        col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop'); });
        col.addEventListener('dragleave', () => col.classList.remove('drop'));
        col.addEventListener('drop', e => {
          e.preventDefault(); col.classList.remove('drop');
          const o = byId(D().opps, e.dataTransfer.getData('text/plain')), cible = col.dataset.drop;
          if (!o) return;
          // Gagner ou perdre passe toujours par la fenêtre de clôture, pour garder le motif et l'enseignement.
          if (cible === 'gagne' || cible === 'perdu') { if (o.clos !== cible) ACTIONS['opp-close']({ id: o.id, r: cible }); return; }
          if (o.etape === cible && !o.clos) return;
          const rouverte = !!o.clos; o.clos = null; o.motif = null; o.etape = cible; o.maj = dp(0);
          logAction(`${rouverte ? 'Opportunité rouverte' : 'Étape changée'} : ${soc(o.soc).nom} → ${ETAPES.find(x => x.id === o.etape).nom}`, 'L2');
          render(); toast((rouverte ? 'Opportunité rouverte' : 'Étape mise à jour') + (crmEcrit() ? ` dans ${crmEcrit()}` : ''));
        });
      });
    }
  };
};
ACTIONS['crm-sync'] = () => { (S.sync = S.sync || {})[S.inst] = true; logAction(`Synchronisation ${INST().crm} : pipeline à jour`, 'L3', 'os'); render(); toast(`Données à jour : aucun écart avec ${INST().crm}`); };
ACTIONS['pipe-mode'] = ds => { S.pipeMode = ds.m; render(); };

/* ---------- Fiche opportunité ---------- */
function oppDrawer(id) {
  const o = byId(D().opps, id); if (!o) return;
  const c = contact(o.contact), s = soc(o.soc);
  openDrawer(`<h2>${esc(s.nom)}</h2><div class="small muted">${esc(o.titre)}</div>`, () => {
    const t = total(o.score), k = cat(t), m = MATRICE[`${o.potentiel}-${o.faisab}`];
    return `<div class="meta-row" style="margin-bottom:14px"><span>Contact : <b>${esc(c.nom)}</b>${c.fonction ? ', ' + esc(c.fonction) : ''}</span><span>Source : <b>${esc(o.source)}</b></span>${s.taille ? `<span>${esc(s.secteur)}, <b class="num">${s.taille}</b> salariés</span>` : ''}</div>
    <div class="grid g2"><label class="field"><span>Étape</span><select class="input" data-change="opp-etape" data-id="${o.id}">${ETAPES.map(e => `<option value="${e.id}" ${e.id === o.etape ? 'selected' : ''}>${e.nom}</option>`).join('')}</select></label>
      <label class="field"><span>Montant estimé (€)</span><input class="input num" type="number" min="0" step="500" value="${o.montant || ''}" data-change="opp-montant" data-id="${o.id}"></label></div>
    <h3>Qualification</h3>
    ${CRITERES.map(cr => `<div class="crit"><div class="lbl"><b>${cr.nom}</b><small>0 : ${cr.bas}. 3 : ${cr.haut}.</small></div><div class="seg" role="group" aria-label="${cr.nom}">${[0, 1, 2, 3].map(v => `<button class="${o.score[cr.id] === v ? 'on' : ''}" data-act="opp-score" data-id="${o.id}" data-c="${cr.id}" data-v="${v}">${v}</button>`).join('')}</div></div>`).join('')}
    <div class="verdict"><div class="big">${t}<small>/15</small></div><div><span class="score ${k.k}">${k.nom}, ${k.prio}</span><div class="small" style="margin-top:4px">${k.action}</div></div></div>
    <div class="grid g2"><label class="field"><span>Potentiel</span><select class="input" data-change="opp-pot" data-id="${o.id}"><option value="eleve" ${o.potentiel === 'eleve' ? 'selected' : ''}>Élevé</option><option value="limite" ${o.potentiel === 'limite' ? 'selected' : ''}>Limité</option></select></label>
      <label class="field"><span>Faisabilité</span><select class="input" data-change="opp-fai" data-id="${o.id}"><option value="forte" ${o.faisab === 'forte' ? 'selected' : ''}>Forte</option><option value="faible" ${o.faisab === 'faible' ? 'selected' : ''}>Faible</option></select></label></div>
    <div class="alert blue">${ic('info')}<div>Décision : <b>${m.nom}</b>. ${m.d}</div></div>
    <h3 style="margin-top:18px">Prochaine action</h3><p style="margin-top:4px">${esc(o.prochaine)} <span class="${diffDays(o.echeance) < 0 ? 'late' : 'muted'} small">(${rel(o.echeance)})</span></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      ${o.clos ? `<span class="badge ${o.clos === 'gagne' ? 'green' : 'red'}">${o.clos === 'gagne' ? 'Gagnée' : 'Perdue'}${o.motif ? ' : ' + esc(o.motif) : ''}</span><button class="btn" data-act="opp-reopen" data-id="${o.id}">Rouvrir</button>` : `
      ${allowed('devis') ? `<button class="btn primary" data-act="devis-new" data-id="${o.id}">${ic('file')}Préparer un devis</button>` : ''}
      <button class="btn" data-act="rdv-new" data-id="${o.id}">${ic('cal')}Planifier un rendez-vous</button>
      <button class="btn go" data-act="opp-close" data-id="${o.id}" data-r="gagne">Gagnée</button>
      <button class="btn danger" data-act="opp-close" data-id="${o.id}" data-r="perdu">Perdue</button>`}</div>
    <h3 style="margin-top:22px">Historique</h3><ul class="hist">${(o.hist || []).map(h => `<li><span class="d">${fdate(h.date)}</span><span>${esc(h.txt)}</span></li>`).join('')}<li><span class="d">${fdate(o.maj)}</span><span>Dernière mise à jour</span></li></ul>`;
  }, s.nom);
}
const reDrawer = id => { const y = document.querySelector('.drawer')?.scrollTop; oppDrawer(id); const dr = document.querySelector('.drawer'); if (dr && y) dr.scrollTop = y; };
Object.assign(ACTIONS, {
  opp: ds => oppDrawer(ds.id),
  'opp-score': ds => { const o = byId(D().opps, ds.id); o.score[ds.c] = +ds.v; o.maj = dp(0); reDrawer(o.id); },
  'opp-etape': (ds, el) => { const o = byId(D().opps, ds.id); o.etape = el.value; o.maj = dp(0); logAction(`Étape changée : ${soc(o.soc).nom}`, 'L2'); reDrawer(o.id); },
  'opp-montant': (ds, el) => { const o = byId(D().opps, ds.id); o.montant = +el.value || 0; reDrawer(o.id); },
  'opp-pot': (ds, el) => { byId(D().opps, ds.id).potentiel = el.value; reDrawer(ds.id); },
  'opp-fai': (ds, el) => { byId(D().opps, ds.id).faisab = el.value; reDrawer(ds.id); },
  'opp-close': ds => {
    const o = byId(D().opps, ds.id), gagne = ds.r === 'gagne';
    openModal(gagne ? 'Opportunité gagnée' : 'Opportunité perdue', () => `<p>${esc(soc(o.soc).nom)}, ${esc(o.titre)}.</p>
      ${gagne ? '' : `<label class="field"><span>Motif</span><select class="input" id="motif">${MOTIFS.map(m => `<option>${m}</option>`).join('')}</select></label>`}
      <label class="field"><span>${gagne ? 'Ce qui a fait la différence' : 'Ce que vous retenez'}</span><textarea class="input" id="lecon" placeholder="Le message, le signal, le moment…"></textarea></label>
      <p class="small muted">L'OS en tirera une proposition de note pour le second cerveau, sans nom de client.</p>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn ${gagne ? 'go' : 'primary'}" data-act="opp-close-ok" data-id="${o.id}" data-r="${ds.r}">Clôturer</button><button class="btn ghost" data-act="close">Annuler</button></div>`);
  },
  'opp-close-ok': ds => {
    const o = byId(D().opps, ds.id), gagne = ds.r === 'gagne';
    const motif = document.getElementById('motif')?.value, lecon = document.getElementById('lecon').value.trim();
    o.clos = gagne ? 'gagne' : 'perdu'; o.motif = gagne ? null : motif; o.maj = dp(0);
    D().validations.unshift({ id: uid('v'), type: 'note', niv: 'L2', titre: `Enseignement : affaire ${gagne ? 'gagnée' : 'perdue'}`, origine: "Boucle d'apprentissage", detail: `Affaire ${gagne ? 'gagnée' : 'perdue'} dans le secteur ${soc(o.soc).secteur.toLowerCase()}${motif ? ', motif : ' + motif.toLowerCase() : ''}. ${lecon || 'Enseignement à préciser.'}`, destination: 'Méthodes (forme dépersonnalisée)', source: 'Clôture d\'affaire', confiance: 'à relire' });
    logAction(`Opportunité ${gagne ? 'gagnée' : 'perdue'} : ${soc(o.soc).nom}`, 'L2');
    OVER = null; render(); toast('Clôturée. Une note est proposée dans À valider.');
  },
  'opp-reopen': ds => { const o = byId(D().opps, ds.id); o.clos = null; o.motif = null; o.maj = dp(0); logAction(`Opportunité rouverte : ${soc(o.soc).nom}`, 'L2'); OVER = null; render(); toast('Opportunité rouverte'); },
  'opp-new': () => openModal('Nouvelle opportunité', () => `<label class="field"><span>Société</span><input class="input" id="no-soc" placeholder="Nom de la société"></label><label class="field"><span>Objet</span><input class="input" id="no-titre" placeholder="Ce que vous pourriez vendre"></label><label class="field"><span>Source</span><select class="input" id="no-src"><option>Réseau</option><option>Salon</option><option>Lead entrant</option><option>LinkedIn</option><option>Recommandation</option></select></label><div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-act="opp-new-ok">Créer</button><button class="btn ghost" data-act="close">Annuler</button></div>`),
  'opp-new-ok': () => {
    const nom = document.getElementById('no-soc').value.trim(); if (!nom) { document.getElementById('no-soc').focus(); return; }
    const sid = uid('s'), cid = uid('c'), newId = uid('o');
    D().societes.push({ id: sid, nom, secteur: 'À compléter', ville: '', taille: null, domaine: '' });
    D().contacts.push({ id: cid, soc: sid, nom: 'Interlocuteur à identifier', fonction: '', email: '', role: '' });
    D().opps.push({ id: newId, soc: sid, contact: cid, titre: document.getElementById('no-titre').value.trim() || 'À préciser', etape: 'detection', montant: 0, score: { besoin: 0, decideur: 0, budget: 0, timing: 0, engagement: 0 }, potentiel: 'limite', faisab: 'faible', source: document.getElementById('no-src').value, echeance: dp(7), prochaine: 'Qualifier', maj: dp(0) });
    logAction(`Opportunité créée : ${nom}`, 'L2'); OVER = null; render(); oppDrawer(newId);
  }
});

/* ---------- Entreprises et contacts ---------- */
const filtre = (...champs) => { const q = (S.crmQ || '').trim().toLowerCase(); return !q || champs.some(c => String(c || '').toLowerCase().includes(q)); };
const recherche = place => `<label class="search">${ic('search')}<input class="input" type="search" placeholder="${place}" value="${esc(S.crmQ || '')}" data-input="crm-q" aria-label="${place}"></label>`;
const oppsDe = sid => D().opps.filter(o => o.soc === sid);
const etapeNom = o => o.clos === 'gagne' ? 'Gagnée' : o.clos === 'perdu' ? 'Perdue' : ETAPES.find(e => e.id === o.etape).nom;

VIEWS.entreprises = () => {
  const d = D();
  const list = d.societes.filter(x => filtre(x.nom, x.secteur, x.ville)).sort((a, b) => a.nom.localeCompare(b.nom));
  return {
    title: 'Entreprises',
    actions: `${miroir('Cette liste est le reflet exact des entreprises')}<button class="btn primary" data-act="soc-new">Nouvelle entreprise</button>`,
    body: `<div class="panel"><div class="panel-h">${recherche('Rechercher une entreprise, un secteur, une ville')}<span class="small muted">${list.length} entreprise${list.length > 1 ? 's' : ''}</span></div>
      <table class="tbl"><thead><tr><th>Entreprise</th><th>Secteur</th><th>Ville</th><th class="r">Salariés</th><th class="r">Contacts</th><th>Opportunités</th></tr></thead><tbody>
      ${list.map(x => { const os = oppsDe(x.id), ouv = os.filter(o => !o.clos); return `<tr class="click" data-act="soc-open" data-id="${x.id}"><td><b>${esc(x.nom)}</b>${x.domaine ? `<div class="small muted">${esc(x.domaine)}</div>` : ''}</td><td>${esc(x.secteur)}</td><td>${esc(x.ville)}</td><td class="r num">${x.taille ?? ''}</td><td class="r num">${d.contacts.filter(c => c.soc === x.id).length}</td><td class="small">${ouv.length ? `${ouv.length} ouverte${ouv.length > 1 ? 's' : ''}, ${eurTxt(ouv.reduce((a, o) => a + o.montant, 0))}` : os.length ? `<span class="muted">${etapeNom(os[0])}</span>` : '<span class="muted">Aucune</span>'}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Aucune entreprise ne correspond.</td></tr>'}
      </tbody></table></div>`
  };
};

VIEWS.contacts = () => {
  const d = D();
  const list = d.contacts.filter(c => filtre(c.nom, c.fonction, soc(c.soc).nom, c.email)).sort((a, b) => a.nom.localeCompare(b.nom));
  return {
    title: 'Contacts',
    actions: `${miroir('Cette liste est le reflet exact des contacts')}<button class="btn primary" data-act="ct-new">Nouveau contact</button>`,
    body: `<div class="panel"><div class="panel-h">${recherche('Rechercher un nom, une fonction, une entreprise')}<span class="small muted">${list.length} contact${list.length > 1 ? 's' : ''}</span></div>
      <table class="tbl"><thead><tr><th>Contact</th><th>Fonction</th><th>Entreprise</th><th>Email</th><th>Rôle</th></tr></thead><tbody>
      ${list.map(c => `<tr class="click" data-act="ct-open" data-id="${c.id}"><td><b>${esc(c.nom)}</b></td><td>${esc(c.fonction)}</td><td>${esc(soc(c.soc).nom)}</td><td class="small">${esc(c.email)}</td><td>${c.role ? `<span class="badge">${esc(c.role)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Aucun contact ne correspond.</td></tr>'}
      </tbody></table></div>`
  };
};

const oppLignes = os => os.length ? `<ul class="hist">${os.map(o => `<li><span class="d">${etapeNom(o)}</span><span><button class="link" data-act="opp" data-id="${o.id}">${esc(o.titre)}</button> ${o.montant ? eur(o.montant) : ''}</span></li>`).join('')}</ul>` : '<p class="muted small">Aucune opportunité.</p>';
function socDrawer(id) {
  const x = byId(D().societes, id); if (!x) return;
  openDrawer(`<h2>${esc(x.nom)}</h2><div class="small muted">${esc(x.secteur)}${x.ville ? ', ' + esc(x.ville) : ''}</div>`, () => {
    const cs = D().contacts.filter(c => c.soc === id);
    return `<div class="meta-row" style="margin-bottom:14px">${x.taille ? `<span><b class="num">${x.taille}</b> salariés</span>` : ''}${x.domaine ? `<span>${esc(x.domaine)}</span>` : ''}${INST().crm ? `<span class="badge blue">Fiche ${INST().crm}</span>` : ''}</div>
      <h3>Contacts</h3>${cs.length ? `<ul class="hist">${cs.map(c => `<li><span class="d">${esc(c.role || '')}</span><span><button class="link" data-act="ct-open" data-id="${c.id}">${esc(c.nom)}</button>, ${esc(c.fonction)}</span></li>`).join('')}</ul>` : '<p class="muted small">Aucun contact.</p>'}
      <h3 style="margin-top:18px">Opportunités</h3>${oppLignes(oppsDe(id))}`;
  }, x.nom);
}
function ctDrawer(id) {
  const c = byId(D().contacts, id); if (!c) return; const x = soc(c.soc);
  openDrawer(`<h2>${esc(c.nom)}</h2><div class="small muted">${esc(c.fonction)}${x.nom !== '?' ? ', ' + esc(x.nom) : ''}</div>`, () => `
    <div class="meta-row" style="margin-bottom:14px"><span>${esc(c.email) || '<span class="muted">Email inconnu</span>'}</span>${c.role ? `<span class="badge">${esc(c.role)}</span>` : ''}${INST().crm ? `<span class="badge blue">Fiche ${INST().crm}</span>` : ''}</div>
    <h3>Entreprise</h3><p style="margin-top:4px"><button class="link" data-act="soc-open" data-id="${c.soc}">${esc(x.nom)}</button></p>
    <h3 style="margin-top:18px">Opportunités</h3>${oppLignes(D().opps.filter(o => o.contact === id))}
    <h3 style="margin-top:18px">Tâches ouvertes</h3>${(() => { const ts = D().taches.filter(t => !t.fait && D().opps.some(o => o.id === t.opp && o.contact === id)); return ts.length ? `<ul class="hist">${ts.map(t => `<li><span class="d">${fdate(t.echeance)}</span><span>${esc(t.titre)}</span></li>`).join('')}</ul>` : '<p class="muted small">Aucune.</p>'; })()}`, c.nom);
}
const ecritCrm = () => crmEcrit() ? ` et écrit dans ${crmEcrit()}` : '';
Object.assign(ACTIONS, {
  'crm-q': (ds, el) => { S.crmQ = el.value; const pos = el.selectionStart; render(); const i = document.querySelector('[data-input="crm-q"]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } },
  'soc-open': ds => socDrawer(ds.id),
  'ct-open': ds => ctDrawer(ds.id),
  'soc-new': () => openModal('Nouvelle entreprise', () => `<label class="field"><span>Nom</span><input class="input" id="ns-nom"></label><div class="grid g2"><label class="field"><span>Secteur</span><input class="input" id="ns-sec"></label><label class="field"><span>Ville</span><input class="input" id="ns-vil"></label></div>
    ${crmEcrit() ? `<p class="small muted">L'entreprise sera aussi créée dans ${crmEcrit()}.</p>` : ''}<div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-act="soc-new-ok">Créer</button><button class="btn ghost" data-act="close">Annuler</button></div>`),
  'soc-new-ok': () => {
    const nom = document.getElementById('ns-nom').value.trim(); if (!nom) { document.getElementById('ns-nom').focus(); return; }
    D().societes.push({ id: uid('s'), nom, secteur: document.getElementById('ns-sec').value.trim() || 'À compléter', ville: document.getElementById('ns-vil').value.trim(), taille: null, domaine: '' });
    logAction(`Entreprise créée : ${nom}${INST().crm ? ' (écrite dans ' + INST().crm + ')' : ''}`, 'L2'); OVER = null; render(); toast(`Entreprise ajoutée${ecritCrm()}`);
  },
  'ct-new': () => openModal('Nouveau contact', () => `<div class="grid g2"><label class="field"><span>Nom</span><input class="input" id="nct-nom"></label><label class="field"><span>Fonction</span><input class="input" id="nct-fct"></label></div>
    <div class="grid g2"><label class="field"><span>Entreprise</span><select class="input" id="nct-soc">${D().societes.slice().sort((a, b) => a.nom.localeCompare(b.nom)).map(x => `<option value="${x.id}">${esc(x.nom)}</option>`).join('')}</select></label><label class="field"><span>Email</span><input class="input" id="nct-mail" type="email"></label></div>
    ${crmEcrit() ? `<p class="small muted">Le contact sera aussi créé dans ${crmEcrit()}.</p>` : ''}<div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-act="ct-new-ok">Créer</button><button class="btn ghost" data-act="close">Annuler</button></div>`),
  'ct-new-ok': () => {
    const nom = document.getElementById('nct-nom').value.trim(); if (!nom) { document.getElementById('nct-nom').focus(); return; }
    D().contacts.push({ id: uid('c'), soc: document.getElementById('nct-soc').value, nom, fonction: document.getElementById('nct-fct').value.trim(), email: document.getElementById('nct-mail').value.trim(), role: '' });
    logAction(`Contact créé : ${nom}${crmEcrit() ? ' (écrit dans ' + crmEcrit() + ')' : ''}`, 'L2'); OVER = null; render(); toast(`Contact ajouté${ecritCrm()}`);
  }
});

/* ---------- Rendez-vous ---------- */
const QUESTIONS = {
  besoin: 'Que se passe-t-il si rien ne change dans les douze prochains mois ?',
  decideur: 'Qui d\'autre participera à la décision, et comment se prend-elle ?',
  budget: 'Le budget est-il alloué, à arbitrer, ou conditionné à autre chose ?',
  timing: 'Quel événement fixe l\'échéance de ce projet ?',
  engagement: 'Quelle serait pour vous la prochaine étape utile ?'
};
VIEWS.agenda = () => {
  const r = D().rdv.slice().sort((a, b) => a.date.localeCompare(b.date));
  return {
    title: 'Rendez-vous',
    body: `<div class="panel">${r.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Rendez-vous</th><th>Lieu</th><th>Binôme</th><th></th></tr></thead><tbody>${r.map(x => `<tr><td class="num">${fdate(x.date)}<div class="small muted">${x.heure}</div></td><td><b>${esc(x.titre)}</b>${x.cr ? '<div class="small" style="color:var(--green)">Compte rendu fait</div>' : ''}</td><td>${esc(x.lieu)}</td><td>${x.binome ? esc(x.binome) : '<span class="muted">Seul</span>'}</td><td style="white-space:nowrap"><button class="btn sm" data-act="rdv-prep" data-id="${x.id}">Préparer</button> ${diffDays(x.date) <= 0 && !x.cr ? `<button class="btn go sm" data-act="rdv-cr" data-id="${x.id}">Compte rendu</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucun rendez-vous planifié.</div>'}</div>`
  };
};
Object.assign(ACTIONS, {
  'rdv-prep': ds => {
    const r = byId(D().rdv, ds.id), o = byId(D().opps, r.opp), s = soc(o.soc), c = contact(o.contact);
    const gaps = CRITERES.filter(cr => o.score[cr.id] < 3);
    openDrawer(`<h2>Préparation</h2><div class="small muted">${esc(r.titre)}, ${fdate(r.date)} à ${r.heure}</div>`, () => `
      <div class="meta-row" style="margin-bottom:12px">${who('os')}<span>${gauge('L1')}</span></div>
      <h3>Le compte</h3><p style="margin-top:4px">${esc(s.nom)}, ${esc(s.secteur)}${s.ville ? ', ' + esc(s.ville) : ''}${s.taille ? `, <span class="num">${s.taille}</span> salariés` : ''}. Interlocuteur : <b>${esc(c.nom)}</b>${c.fonction ? ', ' + esc(c.fonction) : ''} (${esc(c.role || 'rôle à préciser')}).</p>
      <h3 style="margin-top:14px">Où en est la qualification</h3><div class="verdict">${scoreBadge(o.score)}<div class="small">${cat(total(o.score)).action}</div></div>
      <h3>Questions à poser</h3><ul class="checks">${gaps.map(cr => `<li><span><b>${cr.nom}</b> (${o.score[cr.id]}/3) : ${QUESTIONS[cr.id]}</span></li>`).join('') || '<li>La qualification est complète : préparez la proposition.</li>'}</ul>
      ${r.binome ? `<h3 style="margin-top:14px">Répartition des rôles avec ${esc(r.binome)}</h3><table class="tbl small"><tbody><tr><td class="muted">Vous</td><td>Ouverture, enjeux, qualification, prochaine étape</td></tr><tr><td class="muted">L'expert</td><td>Questions techniques, crédibilité, premier cadrage du périmètre</td></tr><tr><td class="muted">Après</td><td>Retour à deux dans les 24 heures, devis préparé par l'OS</td></tr></tbody></table>` : ''}
      <h3 style="margin-top:14px">Historique</h3><ul class="hist"><li><span class="d">${fdate(o.maj)}</span><span>${esc(o.prochaine)}</span></li><li><span class="d">${fdate(dp(-20))}</span><span>Premier échange (${esc(o.source.toLowerCase())})</span></li></ul>`, 'Préparation');
  },
  'rdv-cr': ds => {
    const r = byId(D().rdv, ds.id);
    openModal('Compte rendu', () => `<p class="small muted">${esc(r.titre)}</p><label class="field"><span>Ce qui s'est dit</span><textarea class="input" id="cr-txt" placeholder="Besoin, interlocuteurs, budget, échéance…">Besoin confirmé, décision prévue avant la fin du trimestre. Le dirigeant souhaite une proposition en deux options.</textarea></label>
      <p class="small" style="margin-bottom:6px"><b>L'OS préparera, pour validation :</b></p><ul class="checks small"><li>La mise à jour de l'opportunité et de son score</li><li>Une tâche pour la prochaine étape</li><li>Une note durable si un enseignement ressort</li></ul>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn go" data-act="rdv-cr-ok" data-id="${r.id}">Enregistrer le compte rendu</button><button class="btn ghost" data-act="close">Annuler</button></div>`);
  },
  'rdv-cr-ok': ds => {
    const r = byId(D().rdv, ds.id), o = byId(D().opps, r.opp); r.cr = document.getElementById('cr-txt').value;
    (o.hist = o.hist || []).unshift({ date: dp(0), txt: 'Compte rendu : ' + r.cr.slice(0, 90) });
    D().validations.unshift({ id: uid('v'), type: 'tache', niv: 'L2', titre: 'Tâche issue du compte rendu', soc: o.soc, contact: o.contact, origine: 'Compte rendu de rendez-vous', detail: 'Préparer la proposition en deux options demandée pendant le rendez-vous.', echeance: dp(3), source: 'Votre compte rendu', confiance: 'élevée' });
    logAction(`Compte rendu enregistré : ${r.titre}`, 'L1'); OVER = null; render(); toast('Compte rendu enregistré, une tâche est proposée');
  },
  'rdv-new': ds => {
    const o = byId(D().opps, ds.id), sl = creneaux(5);
    openModal('Planifier un rendez-vous', () => `<p>Créneaux libres dans votre agenda :</p>${sl.map((x, k) => `<label class="check"><input type="radio" name="sl" value="${k}" ${k === 0 ? 'checked' : ''}><span>${x}</span></label>`).join('')}<div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" data-act="rdv-new-ok" data-id="${o.id}">Réserver le créneau</button><button class="btn ghost" data-act="close">Annuler</button></div>`);
  },
  'rdv-new-ok': ds => {
    const o = byId(D().opps, ds.id), k = +document.querySelector('input[name=sl]:checked').value;
    const sl = creneauxD(5)[k];
    D().rdv.push({ id: uid('r'), opp: o.id, titre: 'Rendez-vous ' + soc(o.soc).nom, date: sl.iso, heure: sl.h, lieu: 'À préciser', binome: null });
    logAction(`Rendez-vous réservé : ${soc(o.soc).nom}`, 'L2'); OVER = null; render(); toast('Créneau réservé dans votre agenda');
  }
});

/* ---------- Devis ---------- */
const devisTotal = d => d.lignes.reduce((a, l) => a + (l.pu || 0) * l.q, 0);
const STATUT_DEVIS = { brouillon: ['Brouillon', 'amber'], valide: ['Validé par vous', 'blue'], transmis: ['Transmis', 'green'] };
VIEWS.devis = () => {
  const list = D().devis;
  return {
    title: 'Devis',
    body: `<div class="panel">${list.length ? `<table class="tbl"><thead><tr><th>Numéro</th><th>Client</th><th>Statut</th><th class="r">Montant</th><th>Suivi</th></tr></thead><tbody>${list.map(d => { const o = byId(D().opps, d.opp); const st = STATUT_DEVIS[d.statut]; const ar = d.statut === 'transmis' && diffDays(d.envoye) <= -10; return `<tr class="click" data-act="devis-open" data-id="${d.id}"><td class="num">${esc(d.num)}</td><td><b>${esc(soc(o.soc).nom)}</b><div class="small muted">${esc(o.titre)}</div></td><td><span class="badge ${st[1]}">${st[0]}</span></td><td class="r">${d.lignes.some(l => l.pu == null) ? '<span class="muted">prix à fixer</span>' : eur(devisTotal(d))}</td><td class="small">${d.statut === 'transmis' ? `Envoyé ${rel(d.envoye)}${ar ? ' <span class="late">à relancer</span>' : ''}` : '<span class="muted">En préparation</span>'}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">Aucun devis. Préparez-en un depuis une opportunité du pipeline.</div>'}</div>`
  };
};
function devisDrawer(id) {
  const d = byId(D().devis, id), o = byId(D().opps, d.opp);
  openDrawer(`<h2>${esc(d.num)}</h2><div class="small muted">${esc(soc(o.soc).nom)}, ${esc(o.titre)}</div>`, () => {
    const manque = d.lignes.some(l => l.pu == null), edit = d.statut === 'brouillon';
    return `<div class="meta-row" style="margin-bottom:12px"><span>Préparation ${gauge('L1')}</span><span>Transmission ${gauge('L2')}</span></div>
      ${edit ? `<div class="alert amber" style="margin-bottom:12px">${ic('lock')}<div>Les lignes viennent des devis passés. Les prix restent vides tant que vous ne les fixez pas : l'OS ne propose jamais de prix ni de remise.</div></div>` : ''}
      <table class="tbl"><thead><tr><th>Désignation</th><th class="r">Qté</th><th class="r">Prix unitaire</th><th class="r">Total</th></tr></thead><tbody>
      ${d.lignes.map((l, k) => `<tr><td>${esc(l.l)}</td><td class="r num">${l.q}</td><td class="r">${edit ? `<input class="input num" style="width:120px;text-align:right" type="number" min="0" step="100" placeholder="à fixer" value="${l.pu ?? ''}" data-change="devis-pu" data-id="${d.id}" data-k="${k}" aria-label="Prix unitaire">` : eur(l.pu)}</td><td class="r">${l.pu == null ? '<span class="muted">–</span>' : eur(l.pu * l.q)}</td></tr>`).join('')}
      <tr><td colspan="3" class="r"><b>Total HT</b></td><td class="r"><b>${manque ? '<span class="muted">à fixer</span>' : eur(devisTotal(d))}</b></td></tr></tbody></table>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
      ${edit ? `<button class="btn primary" data-act="devis-valid" data-id="${d.id}" ${manque ? 'disabled title="Fixez tous les prix d\'abord"' : ''}>Valider le devis</button>` : ''}
      ${d.statut === 'valide' ? `<button class="btn go" data-act="devis-send" data-id="${d.id}">${ic('send')}Transmettre au client</button>` : ''}
      ${d.statut === 'transmis' ? `<button class="btn" data-act="devis-relance" data-id="${d.id}">Préparer une relance</button>` : ''}</div>
      ${d.statut === 'transmis' ? `<p class="small muted" style="margin-top:12px">Envoyé le ${fdate(d.envoye)}, valable jusqu'au ${fdate(d.validite)}. Relance automatique proposée à 10 jours sans réponse.</p>` : ''}`;
  }, d.num);
}
Object.assign(ACTIONS, {
  'devis-open': ds => devisDrawer(ds.id),
  'devis-pu': (ds, el) => { const d = byId(D().devis, ds.id); d.lignes[+ds.k].pu = el.value === '' ? null : +el.value; devisDrawer(d.id); document.querySelectorAll('[data-change="devis-pu"]')[+ds.k + 1]?.focus(); },
  'devis-valid': ds => { const d = byId(D().devis, ds.id); d.statut = 'valide'; logAction(`Devis validé et prix fixés : ${d.num}`, 'L1'); devisDrawer(d.id); toast('Devis validé'); },
  'devis-send': ds => {
    const d = byId(D().devis, ds.id);
    if (INST().demo) { toast('En démonstration, aucun envoi n\'est possible'); return; }
    openModal('Transmettre le devis', () => `<p>Le devis <b>${esc(d.num)}</b> de <b>${eur(devisTotal(d))}</b> HT sera envoyé à ${esc(contact(byId(D().opps, d.opp).contact).nom)}.</p><p class="small muted">C'est un engagement auprès du client : l'OS attend votre accord explicite.</p><div style="display:flex;gap:8px;margin-top:12px"><button class="btn go" data-act="devis-send-ok" data-id="${d.id}">Oui, transmettre</button><button class="btn ghost" data-act="close">Annuler</button></div>`);
  },
  'devis-send-ok': ds => { const d = byId(D().devis, ds.id); d.statut = 'transmis'; d.envoye = dp(0); d.validite = dp(30); const o = byId(D().opps, d.opp); if (ETAPES.findIndex(e => e.id === o.etape) < 3) o.etape = 'proposition'; logAction(`Devis transmis : ${d.num}`, 'L2'); OVER = null; render(); toast('Devis transmis'); },
  'devis-relance': ds => {
    const d = byId(D().devis, ds.id), o = byId(D().opps, d.opp), c = contact(o.contact);
    D().validations.unshift({ id: uid('v'), type: 'email', niv: 'L1', titre: 'Relance du devis', soc: o.soc, contact: o.contact, origine: 'Relance de devis', objet: `Votre devis ${d.num}`,
      corps: email(c.nom, '', [`Je reviens vers vous au sujet du devis transmis le ${fdate(d.envoye)}.`, 'Je vous propose un court échange pour répondre à vos questions.'], creneaux(6)),
      controles: ['Historique de messagerie consulté', `Devis envoyé ${rel(d.envoye)}`, 'Créneaux vérifiés dans l\'agenda'], source: 'Devis + messagerie', confiance: 'élevée' });
    logAction(`Relance de devis préparée : ${d.num}`, 'L1', 'os'); OVER = null; S.vqSel = D().validations[0].id; S.vqFilter = 'tout'; go('validations'); toast('Brouillon de relance prêt');
  },
  'devis-new': ds => {
    const o = byId(D().opps, ds.id); const num = (INST().demo ? 'DEMO-' : 'DEV-2026-') + String(D().devis.length + 16).padStart(3, '0');
    const nd = { id: uid('d'), opp: o.id, num, statut: 'brouillon', lignes: [{ l: o.titre, q: 1, pu: null }, { l: 'Restitution et plan de suivi', q: 1, pu: null }] };
    D().devis.unshift(nd); logAction(`Devis préparé : ${num} (prix à fixer)`, 'L1', 'os'); OVER = null; go('devis'); devisDrawer(nd.id);
  }
});

/* ---------- Relais internes ---------- */
VIEWS.relais = () => {
  const r = D().relais;
  return {
    title: 'Relais internes',
    body: `<div class="panel"><table class="tbl"><thead><tr><th>Contributeur</th><th class="r">Contacts confiés</th><th class="r">Tâches ouvertes</th><th class="r">Contacts non traités</th><th>Prochain point</th><th></th></tr></thead><tbody>${r.map((x, k) => `<tr><td><b>${esc(x.nom)}</b></td><td class="r num">${x.confies}</td><td class="r num">${x.taches}</td><td class="r num ${x.nonTraites ? 'late' : ''}">${x.nonTraites}</td><td>${fdate(x.prochain)} <span class="small muted">(${rel(x.prochain)})</span></td><td><button class="btn sm" data-act="relais-prep" data-k="${k}">Préparer le point mensuel</button></td></tr>`).join('')}</tbody></table></div>
    <div class="alert blue" style="margin-top:16px">${ic('info')}<div>Règle de ce mandat : un client suivi par un expert n'est jamais contacté sans son accord préalable. C'est un paramètre de l'instance, modifiable dans les règles de prospection.</div></div>`
  };
};
ACTIONS['relais-prep'] = ds => {
  const x = D().relais[+ds.k];
  D().validations.unshift({ id: uid('v'), type: 'note', niv: 'L1', titre: `Point mensuel : ${x.nom}`, origine: 'Animation des relais', detail: `Ordre du jour préparé : ${x.confies} contacts confiés (${x.nonTraites} non traités), ${x.taches} tâches ouvertes avec leurs liens CRM, sujets commerciaux repérés dans les missions en cours.`, destination: 'Document de séance (brouillon)', source: 'CRM du mandat', confiance: 'élevée' });
  logAction(`Point mensuel préparé : ${x.nom}`, 'L1', 'os'); render(); toast('Ordre du jour préparé, à valider');
};
