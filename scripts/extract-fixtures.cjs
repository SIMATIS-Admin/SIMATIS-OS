// Extracts the fictive demo data from the mockup into src/demo/fixtures.json.
// Reads data.js only: instances.local.js (real names, git-ignored) is never loaded.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'maquettes/os-commercial/js/data.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(`${source};globalThis.__out = { INSTANCES, data: SEED() };`, context);
const { INSTANCES, data } = context.__out;

const fixtures = INSTANCES.map((i) => ({
  slug: i.id,
  nom: i.nom,
  type: i.type,
  config: { sous: i.sous, couleur: i.c, modules: i.modules },
  entreprises: data[i.id].societes.map((s) => ({
    ref: s.id,
    nom: s.nom,
    secteur: s.secteur,
    ville: s.ville,
    taille: s.taille ?? null,
    domaine: s.domaine || null,
  })),
  contacts: data[i.id].contacts.map((c) => ({
    entreprise: c.soc,
    nom: c.nom,
    fonction: c.fonction,
    email: c.email,
    role: c.role || null,
  })),
}));

fs.writeFileSync(
  path.join(root, 'src/demo/fixtures.json'),
  `${JSON.stringify(fixtures, null, 2)}\n`,
);
