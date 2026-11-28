import { describe, expect, it } from 'vitest';
import type { ConnexionInfo } from './api.js';
import type { InstanceSummary } from './nav.js';
import {
  ETAT_INCONNU,
  accesFonction,
  moteur,
  relais,
  sources,
  type EtatInstance,
} from './organigrammeInstance.js';

const instance = (extra: Partial<InstanceSummary> = {}): InstanceSummary => ({
  slug: 'moi',
  nom: 'Espace fictif',
  sous: '',
  type: 'propre',
  phase: null,
  couleur: '#000',
  modules: ['devis', 'diagnostic', 'atelier', 'cerveau', 'gestion', 'site-web'],
  ...extra,
});
const mandat = (modules: string[] = []) =>
  instance({ slug: 'm', type: 'mandat', phase: 'en_cours', modules });

const connexion = (extra: Partial<ConnexionInfo>): ConnexionInfo => ({
  kind: 'crm',
  fournisseur: 'hubspot',
  etat: 'ok',
  reglages: {},
  derniereSynchro: null,
  derniereErreur: null,
  secret: null,
  ...extra,
});
const etat = (extra: Partial<EtatInstance> = {}): EtatInstance => ({ ...ETAT_INCONNU, ...extra });
const connexions = (liste: ConnexionInfo[], ecrituresReelles = false) =>
  ({ connexions: liste, secondeBoite: false, ecrituresReelles }) as EtatInstance['connexions'];
const source = (id: string, i: InstanceSummary, e: EtatInstance) =>
  sources(i, e).find((s) => s.id === id);

describe('accesFonction', () => {
  it('ouvre une section de menu et fait hériter ses sous-fonctions', () => {
    expect(accesFonction('Pipeline', undefined, instance())).toEqual({
      vue: 'pipeline',
      raison: null,
      reservee: false,
    });
    expect(accesFonction('Détail fictif', 'Pipeline', instance()).vue).toBe('pipeline');
  });

  it('réserve la gestion, la feuille de route, l’atelier et les devis à Mon activité', () => {
    for (const nom of ['Gestion', 'Feuille de route de l’OS', 'Atelier stratégique', 'Devis']) {
      const a = accesFonction(nom, undefined, mandat(['gestion', 'cerveau', 'atelier', 'devis']));
      expect(a).toEqual({ vue: null, raison: 'Réservé à Mon activité.', reservee: true });
    }
    expect(accesFonction('Gestion', undefined, instance()).vue).toBe('gestion');
    expect(accesFonction('Feuille de route de l’OS', undefined, instance()).vue).toBe(
      'feuille-de-route-os',
    );
  });

  it('signale un module non activé', () => {
    expect(accesFonction('Outils et diagnostics', undefined, mandat())).toMatchObject({
      vue: null,
      raison: 'Module non activé dans cette instance.',
    });
    expect(accesFonction('Second cerveau', undefined, mandat(['cerveau'])).vue).toBe('cerveau');
  });

  it('ne propose pas d’ouvrir un écran pas encore construit', () => {
    expect(accesFonction('Démarrage du mandat', undefined, mandat(['demarrage']))).toMatchObject({
      vue: null,
      raison: 'Écran pas encore construit.',
    });
  });

  it('réserve les fonctions LinkedIn à Mon activité, même sous une section ouverte à tous', () => {
    expect(accesFonction('SalesNav', 'Radar', mandat()).raison).toBe('Réservé à Mon activité.');
    expect(accesFonction('Envoi par Chrome', 'SalesNav', mandat()).raison).toBe(
      'Réservé à Mon activité.',
    );
    expect(accesFonction('SalesNav', 'Radar', instance()).vue).toBe('radar');
  });

  it('mène le socle aux Paramètres ou au Portefeuille', () => {
    expect(accesFonction('Connexions', undefined, mandat()).vue).toBe('parametres');
    expect(accesFonction('Instances et modules', undefined, mandat()).vue).toBe('portefeuille');
    expect(accesFonction('Serveur MCP', undefined, mandat())).toEqual({
      vue: null,
      raison: null,
      reservee: false,
    });
  });
});

describe('sources', () => {
  it('lit la messagerie, l’agenda et le CRM de l’instance', () => {
    const e = etat({
      connexions: connexions([
        connexion({ kind: 'messagerie', fournisseur: 'infomaniak' }),
        connexion({ kind: 'crm', fournisseur: 'hubspot', etat: 'erreur' }),
      ]),
    });
    expect(source('messagerie', mandat(), e)).toMatchObject({
      nom: 'Messagerie Infomaniak',
      etat: 'branche',
    });
    expect(source('crm', mandat(), e)).toMatchObject({ nom: 'HubSpot', etat: 'erreur' });
    expect(source('agenda', mandat(), e)).toMatchObject({ etat: 'absent' });
  });

  it('donne la dernière erreur d’une connexion en panne', () => {
    const e = etat({
      connexions: connexions([
        connexion({ etat: 'erreur', derniereErreur: 'Jeton fictif refusé' }),
      ]),
    });
    expect(source('crm', mandat(), e)?.erreur).toBe('Jeton fictif refusé');
  });

  it('dit le sens de la synchronisation du CRM', () => {
    const avec = (sens?: string) =>
      source(
        'crm',
        mandat(),
        etat({
          connexions: connexions([connexion({ reglages: { sens } as ConnexionInfo['reglages'] })]),
        }),
      )?.moyen;
    expect(avec('deux_sens')).toContain('deux sens');
    expect(avec()).toContain('lecture seule');
  });

  it('ne présente pas comme absent un état qui n’a pas pu être lu', () => {
    expect(source('messagerie', mandat(), ETAT_INCONNU)?.etat).toBe('inconnu');
  });

  it('adapte les sources au type d’instance et aux modules', () => {
    const ids = (i: InstanceSummary) =>
      sources(i, ETAT_INCONNU)
        .filter((s) => s.etat !== 'indisponible')
        .map((s) => s.id);
    expect(ids(instance())).toEqual(
      expect.arrayContaining(['linkedin', 'siteweb', 'cerveau', 'reunions', 'publiques']),
    );
    expect(ids(mandat())).not.toContain('linkedin');
    expect(ids(mandat())).not.toContain('siteweb');
    expect(ids(mandat())).not.toContain('cerveau');
    expect(source('cerveau', mandat(['cerveau']), ETAT_INCONNU)?.moyen).toContain('Espace partagé');
  });
});

describe('moteur', () => {
  it('résume les routines, l’exécuteur et le double verrou', () => {
    const etapes = moteur(
      etat({
        connexions: connexions([], true),
        routines: [
          { nom: 'Routine A', actif: true },
          { nom: 'Routine B', actif: false },
        ] as EtatInstance['routines'],
        executeur: { actif: false, poste: null, vuLe: null },
      }),
    );
    expect(etapes.map((e) => e.id)).toEqual([
      'routines',
      'executeur',
      'proposition',
      'validation',
      'verrou',
      'ecriture',
    ]);
    expect(etapes[0]).toMatchObject({ mention: '1 sur 2 actives' });
    expect(etapes[0]?.texte).toContain('Routine A');
    expect(etapes[1]?.mention).toBe('à l’arrêt');
    expect(etapes[4]?.mention).toBe('ouvert');
  });

  it('annonce des écritures simulées quand le verrou est fermé', () => {
    const verrou = moteur(etat({ connexions: connexions([]) })).find((e) => e.id === 'verrou');
    expect(verrou?.mention).toBe('fermé : écritures simulées');
  });
});

describe('relais', () => {
  const partenaires = (extra: object) =>
    ({
      actif: true,
      porteuse: true,
      niveaux: [{ id: 'L3', libelle: 'Niveau fictif' }],
      partenaires: [],
      ...extra,
    }) as unknown as EtatInstance['partenaires'];

  it('dessine la liaison avec chaque partenaire actif', () => {
    const r = relais(
      mandat(),
      etat({
        partenaires: partenaires({
          partenaires: [
            { id: '1', nom: 'Partenaire fictif', statut: 'active', niveau: 'L3' },
            { id: '2', nom: 'Ancien', statut: 'revoquee', niveau: 'L0' },
          ],
        }),
      }),
    );
    expect(r.partenaires).toEqual(['Partenaire fictif · autonomie : Niveau fictif']);
    expect(r.resume).toContain('1 partenaire');
  });

  it('explique chaque situation sans partenaire', () => {
    expect(relais(mandat(), ETAT_INCONNU).resume).toContain('non vérifié');
    expect(relais(mandat(), etat({ partenaires: partenaires({ actif: false }) })).resume).toContain(
      'non configuré',
    );
    expect(relais(mandat(), etat({ partenaires: partenaires({}) })).resume).toContain(
      'Aucun partenaire',
    );
    expect(
      relais(instance(), etat({ partenaires: partenaires({ porteuse: false }) })).resume,
    ).toContain('mandat');
    expect(relais(instance({ type: 'prospect' }), ETAT_INCONNU).resume).toContain('démo');
  });
});
