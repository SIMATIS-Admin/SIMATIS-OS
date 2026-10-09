// Extracts the fictive demo data from the mockup into src/demo/fixtures.json.
// Reads data.js only: instances.local.js (real names, git-ignored) is never loaded.
// Dates are stored as day offsets from the mockup's "today", so the demo stays current when loaded.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'maquettes/os-commercial/js/data.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(`${source};globalThis.__out = { INSTANCES, TODAY, data: SEED() };`, context);
const { INSTANCES, TODAY, data } = context.__out;

const offset = (isoDay) =>
  isoDay ? Math.round((new Date(`${isoDay}T12:00:00`) - TODAY) / 864e5) : null;

const fixtures = INSTANCES.map((i) => {
  const d = data[i.id];
  const contactOf = (oppRef) => d.opps.find((o) => o.id === oppRef)?.contact ?? null;
  return {
    slug: i.id,
    nom: i.nom,
    type: i.type,
    config: { sous: i.sous, couleur: i.c, modules: i.modules, funnel: d.funnel },
    entreprises: d.societes.map((s) => ({
      ref: s.id,
      nom: s.nom,
      secteur: s.secteur,
      ville: s.ville,
      taille: s.taille ?? null,
      domaine: s.domaine || null,
    })),
    contacts: d.contacts.map((c) => ({
      ref: c.id,
      entreprise: c.soc,
      nom: c.nom,
      fonction: c.fonction,
      email: c.email,
      role: c.role || null,
    })),
    opportunites: d.opps.map((o) => ({
      ref: o.id,
      entreprise: o.soc,
      contact: o.contact ?? null,
      titre: o.titre,
      etape: o.etape,
      montant: o.montant ?? null,
      echeanceJours: offset(o.echeance),
      clos: o.clos ?? null,
      motif: o.motif ?? null,
      origine: o.source ?? null,
      qualification: o.score ?? null,
      potentiel: o.potentiel ?? null,
      faisabilite: o.faisab ?? null,
      prochaineEtape: o.prochaine ?? null,
    })),
    // Pending proposals of the "À valider" screen (email drafts, CRM tasks, second-brain notes).
    propositions: d.validations
      .filter((v) => ['email', 'tache', 'note'].includes(v.type))
      .map((v) => {
        const contact = d.contacts.find((c) => c.id === v.contact);
        if (v.type === 'email') {
          return {
            type: 'email.brouillon',
            niveau: v.niv,
            contenu: {
              to: contact?.email ?? '',
              objet: v.objet,
              corps: v.corps,
              contact: v.contact ?? null,
              origine: v.origine,
              controles: v.controles ?? [],
            },
          };
        }
        if (v.type === 'tache') {
          return {
            type: 'crm.tache',
            niveau: v.niv,
            contenu: {
              titre: v.titre,
              detail: v.detail,
              canal: 'tache',
              echeanceJours: offset(v.echeance),
              contact: v.contact ?? null,
              origine: v.origine,
            },
          };
        }
        return {
          type: 'note.second_cerveau',
          niveau: v.niv,
          contenu: {
            titre: v.titre,
            texte: v.detail,
            destination: v.destination ?? null,
            origine: v.origine,
          },
        };
      }),
    taches: d.taches.map((t) => ({
      opportunite: t.opp ?? null,
      contact: t.contact ?? contactOf(t.opp),
      titre: t.titre,
      canal: t.canal === 'appel' || t.canal === 'email' ? t.canal : 'tache',
      echeanceJours: offset(t.echeance),
      fait: t.fait === true,
    })),
  };
});

fs.writeFileSync(
  path.join(root, 'src/demo/fixtures.json'),
  `${JSON.stringify(fixtures, null, 2)}\n`,
);
