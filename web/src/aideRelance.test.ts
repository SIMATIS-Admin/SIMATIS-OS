import { describe, expect, it } from 'vitest';
import type { PipelineOpp, PropositionItem, TacheVue } from './api.js';
import {
  angleDe,
  brouillonPour,
  htmlEnTexte,
  construireFile,
  ficheAppel,
  POUR_TOUJOURS,
  prenomDe,
  redigerMail,
  suitesProposees,
} from './aideRelance.js';

const maintenant = new Date('2026-11-20T09:00:00Z');
const etapes = [
  { id: 'detection', label: 'Détection' },
  { id: 'prospection', label: 'Prospection' },
  { id: 'qualification', label: 'Qualification' },
  { id: 'proposition', label: 'Proposition' },
];

const opp = (o: Partial<PipelineOpp>): PipelineOpp =>
  ({
    id: 'o',
    titre: 'Affaire fictive',
    etape: 'qualification',
    clos: null,
    montant: null,
    entreprise: null,
    contact: null,
    derniereActivite: null,
    joursInactif: null,
    radar: null,
    tentatives: 0,
    radarEtapeManuelle: null,
    ...o,
  }) as PipelineOpp;

const tache = (t: Partial<TacheVue>): TacheVue =>
  ({
    id: 't',
    titre: 'Relancer',
    canal: 'email',
    type: 'email',
    fait: false,
    echeance: '2026-11-14T08:00:00Z',
    contact: null,
    entreprise: null,
    opportunite: null,
    ...t,
  }) as TacheVue;

const pipeline = (opportunites: PipelineOpp[]) => ({ etapes, opportunites, inactiviteJours: 14 });

describe('construireFile', () => {
  it('classe : retard, puis affaire dormante la plus avancée, puis signaux du Radar', () => {
    const file = construireFile({
      maintenant,
      pipeline: pipeline([
        opp({ id: 'r1', entreprise: 'Radar Un', etape: 'detection', radar: 'repondu' }),
        opp({ id: 'd1', entreprise: 'Dormante Qualif', etape: 'qualification', joursInactif: 30 }),
        opp({
          id: 'd2',
          entreprise: 'Dormante Proposition',
          etape: 'proposition',
          joursInactif: 20,
        }),
      ]),
      enRetard: [
        tache({
          id: 't1',
          entreprise: { id: 'e1', nom: 'Retard Récent' },
          echeance: '2026-11-19T08:00:00Z',
        }),
        tache({
          id: 't2',
          entreprise: { id: 'e2', nom: 'Retard Ancien' },
          echeance: '2026-11-10T08:00:00Z',
        }),
      ],
    });
    expect(file.map((a) => a.entreprise)).toEqual([
      'Retard Ancien',
      'Retard Récent',
      'Dormante Proposition',
      'Dormante Qualif',
      'Radar Un',
    ]);
  });

  it("fusionne les raisons d'une même entreprise en une seule ligne", () => {
    const file = construireFile({
      maintenant,
      pipeline: pipeline([
        opp({
          id: 'd1',
          entreprise: 'Exemple Industrie',
          etape: 'proposition',
          joursInactif: 16,
          montant: 5100,
        }),
      ]),
      enRetard: [tache({ id: 't1', entreprise: { id: 'e1', nom: 'EXEMPLE industrie' } })],
    });
    expect(file).toHaveLength(1);
    expect(file[0]?.raisons.map((r) => r.source)).toEqual(['retard', 'dormante']);
    expect(file[0]?.tacheIds).toEqual(['t1']);
    expect(file[0]?.montant).toBe(5100);
    expect(file[0]?.etape).toBe('Proposition');
  });

  it("n'inclut que les affaires sans activité au-delà du seuil et ignore les affaires closes", () => {
    const file = construireFile({
      maintenant,
      enRetard: [],
      pipeline: pipeline([
        opp({ id: 'a', entreprise: 'Récente', joursInactif: 5 }),
        opp({ id: 'b', entreprise: 'Pile au seuil', joursInactif: 14 }),
        opp({ id: 'c', entreprise: 'Perdue', joursInactif: 90, clos: 'perdu' }),
      ]),
    });
    expect(file).toEqual([]);
  });

  it('traite le Radar : a répondu avant à relancer avant à contacter, approchée ignorée', () => {
    const file = construireFile({
      maintenant,
      enRetard: [],
      pipeline: pipeline([
        opp({ id: 'a', entreprise: 'A contacter', etape: 'detection' }),
        opp({ id: 'b', entreprise: 'Approchée', etape: 'detection', tentatives: 1 }),
        opp({
          id: 'c',
          entreprise: 'A relancer',
          etape: 'prospection',
          tentatives: 3,
          radar: 'sans_reponse',
        }),
        opp({ id: 'd', entreprise: 'A répondu', etape: 'prospection', radar: 'repondu' }),
      ]),
    });
    expect(file.map((a) => a.entreprise)).toEqual(['A répondu', 'A relancer', 'A contacter']);
    expect(file.find((a) => a.entreprise === 'A relancer')?.canal).toBe('appel');
    expect(file.find((a) => a.entreprise === 'A contacter')?.canal).toBe('mail');
  });

  it('propose un appel quand la tâche en retard est un appel, et ignore les tâches terminées ou génériques', () => {
    const file = construireFile({
      maintenant,
      pipeline: pipeline([]),
      enRetard: [
        tache({
          id: 't1',
          canal: 'appel',
          type: 'appel',
          entreprise: { id: 'e', nom: 'Appel Fictif' },
        }),
        tache({
          id: 't2',
          canal: 'tache',
          type: 'tache',
          entreprise: { id: 'f', nom: 'Générique' },
        }),
        tache({ id: 't3', fait: true, entreprise: { id: 'g', nom: 'Terminée' } }),
      ],
    });
    expect(file.map((a) => [a.entreprise, a.canal])).toEqual([['Appel Fictif', 'appel']]);
  });

  it("cache les actions reportées jusqu'à leur date et écarte celles écartées", () => {
    const base = {
      maintenant,
      pipeline: pipeline([]),
      enRetard: [
        tache({ id: 't1', entreprise: { id: 'e', nom: 'Reportée' } }),
        tache({ id: 't2', entreprise: { id: 'f', nom: 'Écartée' } }),
        tache({ id: 't3', entreprise: { id: 'g', nom: 'Visible' } }),
      ],
    };
    const file = construireFile({
      ...base,
      masquees: {
        'ent:reportee': maintenant.getTime() + 86_400_000,
        'ent:ecartee': POUR_TOUJOURS,
      },
    });
    expect(file.map((a) => a.entreprise)).toEqual(['Visible']);
    const demain = new Date(maintenant.getTime() + 2 * 86_400_000);
    expect(
      construireFile({
        ...base,
        maintenant: demain,
        masquees: { 'ent:reportee': maintenant.getTime() + 86_400_000 },
      }).map((a) => a.entreprise),
    ).toContain('Reportée');
  });
});

describe('textes préparés', () => {
  it('prend le prénom seul, sans civilité ni nom en majuscules', () => {
    expect(prenomDe('Camille Exemple')).toBe('Camille');
    expect(prenomDe('Mme Camille EXEMPLE')).toBe('Camille');
    expect(prenomDe('EXEMPLE Camille')).toBe('Camille');
    expect(prenomDe(null)).toBe('');
  });

  const action = (raison: string, source: 'retard' | 'dormante' | 'radar') =>
    construireFile({
      maintenant,
      pipeline: pipeline(
        source === 'dormante'
          ? [opp({ entreprise: 'Fictive', contact: 'Camille Exemple', joursInactif: 30 })]
          : [],
      ),
      enRetard:
        source === 'retard'
          ? [
              tache({
                entreprise: { id: 'e', nom: 'Fictive' },
                contact: { id: 'c', nom: 'Camille Exemple' },
              }),
            ]
          : [],
    })[0]!;

  it("rédige un mail au prénom seul, sans signature, selon l'angle", () => {
    const a = action('', 'dormante');
    expect(angleDe(a)).toBe('relance');
    const mail = redigerMail(a);
    expect(mail.corps.startsWith('Bonjour Camille,\n\n')).toBe(true);
    expect(mail.corps).not.toContain('Exemple');
    expect(mail.corps).not.toMatch(/Bien à vous|Cordialement/);
    expect(angleDe(action('', 'retard'))).toBe('suivi');
  });

  it('salue sans nom quand le contact est inconnu', () => {
    const a = { ...action('', 'dormante'), contact: null };
    expect(redigerMail(a).corps.startsWith('Bonjour,\n\n')).toBe(true);
    expect(ficheAppel(a).ouverture.startsWith("Bonjour, c'est Marc")).toBe(true);
  });

  it("propose des suites selon le canal et le résultat de l'appel", () => {
    expect(suitesProposees('mail')[0]?.canal).toBe('appel');
    expect(suitesProposees('appel', 'joint')[0]?.canal).toBe('email');
    expect(suitesProposees('appel', 'absent')[0]?.libelle).toBe('Rappeler dans 2 jours');
    expect(suitesProposees('mail').at(-1)?.canal).toBeNull();
  });
});

describe('tri des tâches anciennes', () => {
  it('place une tâche en retard depuis plus de 30 jours après les affaires sans activité et le Radar', () => {
    const file = construireFile({
      maintenant,
      pipeline: pipeline([
        opp({ id: 'd', entreprise: 'Dormante', etape: 'proposition', joursInactif: 20 }),
        opp({ id: 'r', entreprise: 'Radar', etape: 'detection', radar: 'repondu' }),
      ]),
      enRetard: [
        tache({
          id: 't1',
          entreprise: { id: 'e1', nom: 'Périmée' },
          echeance: '2026-08-01T08:00:00Z',
        }),
        tache({
          id: 't2',
          entreprise: { id: 'e2', nom: 'Récente' },
          echeance: '2026-11-15T08:00:00Z',
        }),
      ],
    });
    expect(file.map((a) => a.entreprise)).toEqual(['Récente', 'Dormante', 'Radar', 'Périmée']);
  });
});

describe('brouillons préparés par la routine', () => {
  const proposition = (contenu: Record<string, unknown>, statut = 'proposee'): PropositionItem =>
    ({ id: 'p', type: 'email.brouillon', statut, contenu }) as unknown as PropositionItem;
  const action = construireFile({
    maintenant,
    pipeline: pipeline([]),
    enRetard: [
      tache({
        id: 't1',
        contact: { id: 'c1', nom: 'Camille Exemple' },
        entreprise: { id: 'e', nom: 'Fictive' },
      }),
    ],
  })[0]!;

  it('retrouve le brouillon par tâche liée, sinon par contact, et ignore les traités', () => {
    expect(brouillonPour(action, [proposition({ tacheId: 't1' })])).not.toBeNull();
    expect(brouillonPour(action, [proposition({ contactId: 'c1' })])).not.toBeNull();
    expect(brouillonPour(action, [proposition({ contactId: 'autre', tacheId: 'x' })])).toBeNull();
    expect(brouillonPour(action, [proposition({ tacheId: 't1' }, 'appliquee')])).toBeNull();
    expect(
      brouillonPour(action, [{ ...proposition({ tacheId: 't1' }), type: 'crm.tache' }]),
    ).toBeNull();
  });

  it('transforme le HTML en texte lisible sans jamais en garder de balise', () => {
    const texte = htmlEnTexte(
      '<style>p{color:red}</style><p>Bonjour&nbsp;Dana,</p><p>A &amp; B<br>Ligne <b>deux</b></p><script>alert(1)</script>',
    );
    expect(texte).toBe('Bonjour Dana,\n\nA & B\nLigne deux');
    expect(texte).not.toMatch(/[<>]/);
  });
});
