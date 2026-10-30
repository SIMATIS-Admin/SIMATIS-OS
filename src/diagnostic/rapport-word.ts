import { zipSync, strToU8 } from 'fflate';
import { z } from 'zod';
import { LOGO_PNG_BASE64, MODELE } from './modele-word.js';

// Contenu du rapport remis au dirigeant : rédigé par Claude, mis en page ici. La mise en page est
// fixe (gabarit SIMATIS, même rendu pour tous les rapports) ; Claude ne produit que du texte.
const texte = (max: number) => z.string().trim().min(1).max(max);
const paragraphes = z.array(texte(3000)).min(1).max(12);

// Tableau libre (2 à 4 colonnes) et section libre : l'OS ne fige ni les thèmes ni les annexes, qui
// varient d'un client à l'autre. Une section sans paragraphe, puce ni tableau reste un simple titre.
const tableauSchema = z
  .object({
    entetes: z.array(texte(60)).min(2).max(4),
    lignes: z
      .array(z.array(texte(1500)).min(2).max(4))
      .min(1)
      .max(12),
  })
  .refine((t) => t.lignes.every((l) => l.length === t.entetes.length), {
    message: 'Chaque ligne du tableau doit avoir autant de cellules que d’en-têtes',
  });
const sectionSchema = z.object({
  titre: texte(200),
  paragraphes: z.array(texte(3000)).max(12).default([]),
  puces: z.array(texte(1500)).max(12).default([]),
  tableau: tableauSchema.optional(),
});

export const contenuRapportSchema = z.object({
  entreprise: texte(120),
  dateDiagnostic: texte(60), // « 13 octobre 2026 »
  reference: texte(60),
  destinataire: texte(160), // « M. Prénom Nom, dirigeant de … »
  essentiel: z.object({
    intro: texte(2000),
    notes: z.array(z.object({ note: texte(8), theme: texte(60), mention: texte(80) })).length(3),
    priorites: z
      .array(z.object({ titre: texte(160), texte: texte(800) }))
      .min(1)
      .max(4),
    plan: z
      .array(z.object({ quand: texte(60), objectif: texte(300), enPlace: texte(500) }))
      .min(1)
      .max(4),
    proposition: texte(2000),
  }),
  contexte: paragraphes,
  resultats: z.object({
    intro: texte(1500),
    // Un thème par ligne : les trois dimensions et, selon le diagnostic, les thèmes de l'entretien.
    dimensions: z
      .array(z.object({ nom: texte(80), note: texte(8), constat: texte(600) }))
      .min(1)
      .max(10),
    profil: z.object({ nom: texte(40), scores: texte(200), paragraphes }),
  }),
  preconisations: z.object({
    intro: texte(1500),
    items: z
      .array(
        z.object({
          etiquette: texte(20),
          titre: texte(200),
          // Renseigné, il alimente le tableau récapitulatif placé avant les cartes.
          potentiel: texte(300).optional(),
          paragraphes,
        }),
      )
      .min(1)
      .max(10),
  }),
  plan: z.object({
    intro: paragraphes,
    horizons: z
      .array(
        z.object({
          quand: texte(40),
          titre: texte(200),
          objectif: texte(500),
          actions: z
            .array(
              z.object({
                quand: texte(60).optional(),
                bloc: texte(100).optional(),
                action: texte(1500),
                resultat: texte(1000).optional(),
              }),
            )
            .min(1)
            .max(8),
        }),
      )
      .min(1)
      .max(4),
    indicateurs: paragraphes,
    nePasFaire: z.array(texte(1500)).max(6).default([]),
    conditions: z.array(texte(1500)).max(8).default([]),
  }),
  conclusion: z.object({
    paragraphes,
    propositionTitre: texte(200),
    proposition: paragraphes,
    // Suite de la proposition : intervention, répartition des rôles, premier cycle…
    blocs: z.array(sectionSchema).max(6).default([]),
  }),
  // « Pour aller plus loin » : une annexe par sujet, lettrée A, B, C… dans l'ordre.
  annexes: z.array(sectionSchema).max(12).default([]),
});
export type ContenuRapport = z.infer<typeof contenuRapportSchema>;

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const SS = 'Source Sans 3';
const MAN = 'Manrope';
const police = (f: string) =>
  `<w:rFonts w:ascii="${f}" w:cs="${f}" w:eastAsia="${f}" w:hAnsi="${f}"/>`;
const SANS_BORD =
  '<w:top w:val="none" w:color="FFFFFF" w:sz="0"/><w:left w:val="none" w:color="FFFFFF" w:sz="0"/><w:bottom w:val="none" w:color="FFFFFF" w:sz="0"/><w:right w:val="none" w:color="FFFFFF" w:sz="0"/>';
const NOB = `<w:tcBorders>${SANS_BORD}</w:tcBorders>`;
const TBB = `<w:tblBorders>${SANS_BORD}<w:insideH w:val="none" w:color="FFFFFF" w:sz="0"/><w:insideV w:val="none" w:color="FFFFFF" w:sz="0"/></w:tblBorders>`;

type Style = { font?: string; color?: string; sz?: number; b?: boolean; i?: boolean; sp?: number };
const run = (t: string, { font = SS, color = '0B2038', sz = 21, b, i, sp }: Style = {}) =>
  `<w:r><w:rPr>${police(font)}${b ? '<w:b/><w:bCs/>' : ''}${i ? '<w:i/><w:iCs/>' : ''}<w:color w:val="${color}"/>${sp ? `<w:spacing w:val="${sp}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;

const para = (t: string, after = 200, line = 340, sz = 25) =>
  `<w:p><w:pPr><w:spacing w:after="${after}" w:before="0" w:line="${line}"/></w:pPr>${run(t, { sz })}</w:p>`;
// Paragraphe du corps, un cran plus petit que le chapeau de section.
const corps = (t: string, after = 120) => para(t, after, 300, 21);

const h1 = (t: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/><w:pBdr><w:bottom w:val="single" w:color="70CEBE" w:sz="12" w:space="6"/></w:pBdr><w:spacing w:after="220" w:before="0"/></w:pPr>${run(t, { font: MAN, color: '0C376B', sz: 44, b: true })}</w:p>`;
const h2 = (t: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:keepNext/><w:spacing w:after="110" w:before="300"/></w:pPr>${run(t, { font: MAN, color: '0C376B', sz: 30, b: true })}</w:p>`;
const surtitre = (t: string) =>
  `<w:p><w:pPr><w:keepNext/><w:spacing w:after="60" w:before="260"/></w:pPr>${run(t.toUpperCase(), { color: '41A594', sz: 18, b: true, sp: 12 })}</w:p>`;
const note = (t: string) =>
  `<w:p><w:pPr><w:keepNext/><w:spacing w:after="160" w:line="280"/></w:pPr>${run(t, { color: '5B7180', sz: 20, i: true })}</w:p>`;
const puce = (titre: string, suite: string, numId: number) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr><w:spacing w:after="80" w:line="300"/></w:pPr>${run(titre, { b: true })}${run(` ${suite}`)}</w:p>`;
const espace = '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';

const marges = (t: number, l: number, b: number, r: number) =>
  `<w:tcMar><w:top w:type="dxa" w:w="${t}"/><w:left w:type="dxa" w:w="${l}"/><w:bottom w:type="dxa" w:w="${b}"/><w:right w:type="dxa" w:w="${r}"/></w:tcMar>`;

function tableau(largeurs: number[], entetes: string[], lignes: string[][]) {
  const total = largeurs.reduce((a, b) => a + b, 0);
  let o = `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="${total}"/>${TBB}</w:tblPr><w:tblGrid>${largeurs.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>`;
  entetes.forEach((h, c) => {
    o += `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${largeurs[c]}"/>${NOB}<w:shd w:fill="0C376B" w:color="auto" w:val="clear"/>${marges(90, 140, 90, 140)}<w:vAlign w:val="center"/></w:tcPr><w:p>${run(h, { color: 'FFFFFF', sz: 17, b: true, sp: 12 })}</w:p></w:tc>`;
  });
  o += '</w:tr>';
  lignes.forEach((ligne, n) => {
    const fond = n % 2 === 0 ? 'FFFFFF' : 'F2F8F6';
    o += '<w:tr><w:trPr><w:cantSplit/></w:trPr>';
    ligne.forEach((t, c) => {
      const gras = c === 0;
      const rp = `${police(SS)}${gras ? '<w:b/><w:bCs/>' : '<w:b w:val="false"/><w:bCs w:val="false"/>'}<w:color w:val="${gras ? '0C376B' : '0B2038'}"/><w:sz w:val="20"/><w:szCs w:val="20"/>`;
      o += `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${largeurs[c]}"/>${NOB}<w:shd w:fill="${fond}" w:color="auto" w:val="clear"/>${marges(110, 140, 110, 140)}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="262"/></w:pPr><w:r><w:rPr>${rp}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p></w:tc>`;
    });
    o += '</w:tr>';
  });
  return `${o}</w:tbl>`;
}

const LARGEURS_TABLEAU: Record<number, number[]> = {
  2: [3000, 6638],
  3: [2300, 3669, 3669],
  4: [1900, 2700, 2700, 2338],
};

// Puce simple (sans titre en gras) : indicateurs, conditions, listes des annexes.
const puceTexte = (t: string) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr><w:spacing w:after="80" w:line="300"/></w:pPr>${run(t)}</w:p>`;

type Section = z.infer<typeof sectionSchema>;
function section(s: Section, titre: string) {
  return [
    h2(titre),
    ...s.paragraphes.map((t) => corps(t)),
    ...s.puces.map(puceTexte),
    ...(s.tableau
      ? [
          tableau(
            LARGEURS_TABLEAU[s.tableau.entetes.length]!,
            s.tableau.entetes.map((h) => h.toUpperCase()),
            s.tableau.lignes,
          ),
          espace,
        ]
      : []),
  ];
}

// Colonnes du tableau d'actions d'un horizon : seules celles renseignées apparaissent, l'action
// prenant la largeur restante.
type Action = ContenuRapport['plan']['horizons'][number]['actions'][number];
type Colonne = { titre: string; largeur: number; valeur: (a: Action) => string | undefined };
function tableauActions(actions: Action[]) {
  const toutes: Colonne[] = [
    { titre: 'QUAND', largeur: 1700, valeur: (a) => a.quand },
    { titre: 'BLOC DE LA MÉTHODE', largeur: 2700, valeur: (a) => a.bloc },
    { titre: 'ACTION', largeur: 0, valeur: (a) => a.action },
    { titre: 'RÉSULTAT ATTENDU', largeur: 3000, valeur: (a) => a.resultat },
  ];
  const colonnes = toutes.filter((c) => c.titre === 'ACTION' || actions.some((a) => c.valeur(a)));
  const fixe = colonnes.reduce((total, c) => total + c.largeur, 0);
  return tableau(
    colonnes.map((c) => c.largeur || 9638 - fixe),
    colonnes.map((c) => c.titre),
    actions.map((a) => colonnes.map((c) => c.valeur(a) ?? '')),
  );
}

function tuiles(notes: ContenuRapport['essentiel']['notes'], verrou: number) {
  const largeurs = [3212, 3214, 3212];
  let o = `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="9638"/>${TBB}</w:tblPr><w:tblGrid>${largeurs.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr>`;
  notes.forEach((n, c) => {
    const fond = c === verrou ? 'E8F7F3' : 'F2F8F6';
    o += `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${largeurs[c]}"/>${NOB}<w:shd w:fill="${fond}" w:color="auto" w:val="clear"/>${marges(170, 240, 170, 200)}<w:vAlign w:val="center"/></w:tcPr>`;
    o += `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>${run(n.note, { font: MAN, color: '0C376B', sz: 52, b: true })}</w:p>`;
    o += `<w:p><w:pPr><w:spacing w:after="20" w:line="250"/></w:pPr>${run(n.theme, { font: MAN, color: '0C376B', sz: 19, b: true })}</w:p>`;
    o += `<w:p><w:pPr><w:spacing w:after="0" w:line="250"/></w:pPr>${run(n.mention, { color: '5B7180', sz: 19 })}</w:p></w:tc>`;
  });
  return `${o}</w:tr></w:tbl>`;
}

function encartProfil(p: ContenuRapport['resultats']['profil']) {
  let o = `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="9638"/>${TBB}</w:tblPr><w:tblGrid><w:gridCol w:w="9638"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="9638"/>${NOB}<w:shd w:fill="F2F8F6" w:color="auto" w:val="clear"/>${marges(240, 300, 240, 300)}</w:tcPr>`;
  o += `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>${run('PROFIL DÉTECTÉ', { color: '5B7180', sz: 18, b: true, sp: 12 })}</w:p>`;
  o += `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr>${run(p.nom, { font: MAN, color: '0C376B', sz: 48, b: true })}</w:p>`;
  o += `<w:p><w:pPr><w:spacing w:after="140"/></w:pPr>${run(p.scores, { color: '5B7180', sz: 17, b: true })}</w:p>`;
  p.paragraphes.forEach((t, n) => {
    o += `<w:p><w:pPr><w:spacing w:after="${n === p.paragraphes.length - 1 ? 0 : 120}" w:before="0" w:line="290"/></w:pPr>${run(t)}</w:p>`;
  });
  return `${o}</w:tc></w:tr></w:tbl>`;
}

function carte(numero: number, etiquette: string, titre: string, textes: string[]) {
  let o = `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="9638"/>${TBB}</w:tblPr><w:tblGrid><w:gridCol w:w="1150"/><w:gridCol w:w="8488"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>`;
  o += `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1150"/>${NOB}<w:shd w:fill="9FF7E8" w:color="auto" w:val="clear"/>${marges(200, 120, 200, 120)}<w:vAlign w:val="top"/></w:tcPr>`;
  o += `<w:p><w:pPr><w:spacing w:after="60"/><w:jc w:val="center"/></w:pPr>${run(String(numero).padStart(2, '0'), { font: MAN, color: '0C376B', sz: 32, b: true })}</w:p><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr>${run(etiquette.toUpperCase(), { font: MAN, color: '0C376B', sz: 15, b: true })}</w:p></w:tc>`;
  o += `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="8488"/>${NOB}<w:shd w:fill="F2F8F6" w:color="auto" w:val="clear"/>${marges(200, 240, 200, 240)}<w:vAlign w:val="center"/></w:tcPr>`;
  o += `<w:p><w:pPr><w:spacing w:after="80" w:line="280"/></w:pPr>${run(titre, { font: MAN, color: '0C376B', sz: 24, b: true })}</w:p>`;
  textes.forEach((t, n) => {
    o += `<w:p><w:pPr><w:spacing w:after="${n === textes.length - 1 ? 0 : 80}" w:line="290"/></w:pPr>${run(t)}</w:p>`;
  });
  return `${o}</w:tc></w:tr></w:tbl>`;
}

function couverture(c: ContenuRapport) {
  const ligne = (
    t: string,
    o: { font?: string; color: string; sz: number; b?: boolean; after?: number; sp?: number },
  ) =>
    `<w:p><w:pPr><w:spacing w:after="${o.after ?? 0}"/></w:pPr>${run(t, { font: o.font ?? SS, color: o.color, sz: o.sz, b: o.b, sp: o.sp })}</w:p>`;
  const cellule = (hauteur: number, contenu: string, fond?: string) =>
    `<w:tr><w:trPr><w:trHeight w:val="${hauteur}" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="11906"/>${NOB}${fond ? `<w:shd w:fill="${fond}" w:color="auto" w:val="clear"/>` : ''}${marges(100, 1134, 100, 1134)}<w:vAlign w:val="center"/></w:tcPr>${contenu}</w:tc></w:tr>`;
  const mono = { font: 'IBM Plex Mono', color: '9FF7E8', sz: 18, b: true, sp: 12 };
  return (
    `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="11906"/>${TBB}</w:tblPr><w:tblGrid><w:gridCol w:w="11906"/></w:tblGrid>` +
    cellule(2700, `<w:p><w:r>${MODELE.coverDrawing}</w:r></w:p>`) +
    cellule(
      10400,
      ligne('DIAGNOSTIC D’ENDURANCE COMMERCIALE', { ...mono, after: 300 }) +
        ligne(c.entreprise, { font: MAN, color: 'FFFFFF', sz: 92, b: true, after: 200 }) +
        ligne('Rapport de diagnostic, préconisations et plan d’action commercial', {
          color: 'FFFFFF',
          sz: 32,
          after: 900,
        }) +
        ligne(`DIAGNOSTIC RÉALISÉ LE ${c.dateDiagnostic.toUpperCase()}`, { ...mono, after: 80 }) +
        ligne(`RÉFÉRENCE ${c.reference.toUpperCase()}`, mono),
      '0C376B',
    ) +
    cellule(
      3600,
      ligne(`Établi pour ${c.destinataire}`, { color: '0B2038', sz: 22, after: 80 }) +
        ligne('Marc Tabouret, Directeur Commercial à temps partagé', {
          color: '5B7180',
          sz: 20,
          after: 20,
        }) +
        ligne('SIMATIS Conseil & Formation', { color: '5B7180', sz: 20 }),
    ) +
    '</w:tbl>'
  );
}

// Section commune à tous les rapports : le principe du diagnostic et les quatre profils.
function demarche() {
  return [
    h1('Notre démarche'),
    para(
      'Le Diagnostic d’Endurance Commerciale est un entretien d’une heure trente. Il mesure si une entreprise sait vendre dans la durée, et pas seulement gagner des affaires de temps en temps.',
    ),
    para(
      'L’entretien passe en revue sept thèmes, chacun noté sur 10. Les réponses sont ensuite regroupées en trois dimensions, qui décrivent la façon dont l’entreprise vend.',
    ),
    puce(
      'Les outils et la méthode.',
      'La façon dont les ventes sont préparées, suivies et mesurées.',
      3,
    ),
    puce(
      'La stratégie, la régularité et l’endurance.',
      'La capacité à tenir un effort commercial dans le temps, même quand le marché se complique.',
      3,
    ),
    puce('La polyvalence.', 'La capacité à s’adapter à de nouveaux marchés.', 3),
    para(
      'Chaque dimension doit atteindre 6 sur 10, et on les examine dans cet ordre. Comme en course de fond, c’est le point le plus faible qui fixe le niveau. La première dimension qui n’atteint pas 6 donne le profil de l’entreprise.',
    ),
    tableau(
      [2300, 7338],
      ['PROFIL', 'CE QUE CELA VEUT DIRE'],
      [
        [
          'Joggeur',
          'Les outils et la méthode ne sont pas encore en place. Les ventes dépendent surtout des personnes et de leur instinct.',
        ],
        [
          'Sprinteur',
          'Les outils existent, mais l’effort commercial manque de régularité et s’essouffle dans la durée.',
        ],
        [
          'Marathonien',
          'L’effort est régulier et outillé, mais l’entreprise a encore du mal à s’adapter à de nouveaux marchés.',
        ],
        [
          'Ultra-endurant',
          'Les trois dimensions sont acquises. La façon de vendre est solide, durable et peut se transmettre.',
        ],
      ],
    ),
  ].join('');
}

// Dimension la plus basse sous le seuil : c'est elle que la tuile « verrou » met en avant.
const indiceVerrou = (c: ContenuRapport) => {
  const notes = c.essentiel.notes.map((n) => Number.parseFloat(n.note.replace(',', '.')));
  const sous = notes.findIndex((n) => n < 6);
  return sous;
};

function corpsDocument(c: ContenuRapport) {
  const e = c.essentiel;
  const b: string[] = [couverture(c), MODELE.sectCouverture];
  b.push(h1('L’essentiel'), para(e.intro), tuiles(e.notes, indiceVerrou(c)));
  b.push(h2(e.priorites.length > 1 ? `${nombre(e.priorites.length)} priorités` : 'Priorité'));
  e.priorites.forEach((p) => b.push(puce(p.titre, p.texte, 2)));
  b.push(
    h2('Le plan en trois temps'),
    tableau(
      [1900, 3700, 4038],
      ['QUAND', 'OBJECTIF', 'CE QUI SERA EN PLACE'],
      e.plan.map((p) => [p.quand, p.objectif, p.enPlace]),
    ),
    h2('Ma proposition'),
    para(e.proposition),
  );
  b.push(demarche());
  b.push(h1(`Le contexte ${deEntreprise(c.entreprise)}`), ...c.contexte.map((t) => para(t)));
  b.push(
    h1('Résultats du diagnostic'),
    para(c.resultats.intro),
    tableau(
      [2700, 1100, 5838],
      ['THÈME', 'NOTE', 'CE QUE NOUS AVONS CONSTATÉ'],
      c.resultats.dimensions.map((d) => [d.nom, d.note, d.constat]),
    ),
    espace,
    encartProfil(c.resultats.profil),
  );
  b.push(h1('Préconisations'), para(c.preconisations.intro));
  if (c.preconisations.items.some((p) => p.potentiel)) {
    b.push(
      tableau(
        [1900, 5200, 2538],
        ['DÉMARRAGE', 'PRÉCONISATION', 'POTENTIEL'],
        c.preconisations.items.map((p) => [p.etiquette, p.titre, p.potentiel ?? '']),
      ),
      espace,
    );
  }
  c.preconisations.items.forEach((p, n) =>
    b.push(carte(n + 1, p.etiquette, p.titre, p.paragraphes), espace),
  );
  b.push(h1('Plan d’action commercial'), ...c.plan.intro.map((t) => para(t)));
  for (const h of c.plan.horizons) {
    b.push(surtitre(h.quand), h2(h.titre), note(h.objectif), tableauActions(h.actions));
  }
  b.push(h2('Les indicateurs à suivre'), ...c.plan.indicateurs.map(puceTexte));
  if (c.plan.nePasFaire.length > 0)
    b.push(h2('Ce que l’entreprise ne fera pas'), ...c.plan.nePasFaire.map((t) => corps(t)));
  if (c.plan.conditions.length > 0)
    b.push(h2('Les conditions de réussite'), ...c.plan.conditions.map(puceTexte));
  b.push(h1('Conclusion et prochaine étape'), ...c.conclusion.paragraphes.map((t) => para(t)));
  b.push(h2(c.conclusion.propositionTitre), ...c.conclusion.proposition.map((t) => corps(t, 200)));
  for (const bloc of c.conclusion.blocs) b.push(...section(bloc, bloc.titre));
  b.push(
    `<w:p><w:pPr><w:spacing w:after="200" w:before="120" w:line="300"/></w:pPr>${run('Bien à vous,')}</w:p>`,
    `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>${run('Marc Tabouret', { color: '0C376B', sz: 24, b: true })}</w:p>`,
    `<w:p><w:pPr><w:spacing w:after="20"/></w:pPr>${run('Directeur Commercial à temps partagé', { color: '5B7180', sz: 20 })}</w:p>`,
    `<w:p>${run('SIMATIS Conseil & Formation', { color: '5B7180', sz: 20 })}</w:p>`,
  );
  if (c.annexes.length > 0) {
    b.push(h1('Pour aller plus loin'));
    c.annexes.forEach((a, n) =>
      b.push(...section(a, `${String.fromCharCode(65 + n)}. ${a.titre}`)),
    );
  }
  b.push(MODELE.sectFinale);
  return b.join('');
}

// Élision : « d’Atelier », « de Nordic ».
const deEntreprise = (nom: string) =>
  /^[aeiouyàâäéèêëîïôöùûü]/i.test(nom) ? `d’${nom}` : `de ${nom}`;

const nombre = (n: number) => ['Une', 'Deux', 'Trois', 'Quatre'][n - 1] ?? String(n);

const RELS_DOCUMENT =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' +
  '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>' +
  '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
  '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
  '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
  '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' +
  '<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>' +
  '</Relationships>';

function proprietes(c: ContenuRapport, maintenant: Date) {
  const iso = maintenant.toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Diagnostic d’Endurance Commerciale, ${esc(c.entreprise)}</dc:title><dc:creator>Marc Tabouret</dc:creator><dc:description>Rapport de diagnostic, préconisations et plan d’action commercial</dc:description><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
}

// Fichier Word du rapport : gabarit SIMATIS (couverture, en-tête, pied de page, styles) + contenu.
export function genererRapportWord(contenu: ContenuRapport, maintenant = new Date()): Uint8Array {
  const document = `${MODELE.documentOuvre}${corpsDocument(contenu)}</w:body></w:document>`;
  const entete = MODELE.header.replace('{{ENTREPRISE}}', esc(contenu.entreprise.toUpperCase()));
  const fichiers: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(MODELE.contentTypes),
    '_rels/.rels': strToU8(MODELE.rootRels),
    'docProps/core.xml': strToU8(proprietes(contenu, maintenant)),
    'docProps/app.xml': strToU8(MODELE.app),
    'docProps/custom.xml': strToU8(MODELE.custom),
    'word/document.xml': strToU8(document),
    'word/_rels/document.xml.rels': strToU8(RELS_DOCUMENT),
    'word/styles.xml': strToU8(MODELE.styles),
    'word/numbering.xml': strToU8(MODELE.numbering),
    'word/settings.xml': strToU8(MODELE.settings),
    'word/fontTable.xml': strToU8(MODELE.fontTable),
    'word/_rels/fontTable.xml.rels': strToU8(MODELE.fontTableRels),
    'word/footnotes.xml': strToU8(MODELE.footnotes),
    'word/_rels/footnotes.xml.rels': strToU8(MODELE.footnotesRels),
    'word/endnotes.xml': strToU8(MODELE.endnotes),
    'word/_rels/endnotes.xml.rels': strToU8(MODELE.endnotesRels),
    'word/header1.xml': strToU8(entete),
    'word/_rels/header1.xml.rels': strToU8(MODELE.headerRels),
    'word/footer1.xml': strToU8(MODELE.footer),
    'word/_rels/footer1.xml.rels': strToU8(MODELE.footerRels),
    'word/media/logo.png': Uint8Array.from(Buffer.from(LOGO_PNG_BASE64, 'base64')),
  };
  return zipSync(fichiers, { level: 6 });
}

export const nomFichier = (entreprise: string, version: number) =>
  `Rapport Diagnostic Endurance - ${entreprise
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} - v${version}.docx`;
