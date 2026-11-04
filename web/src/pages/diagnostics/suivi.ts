import type { TestVma } from '../../api.js';

const JOUR_MS = 24 * 3600 * 1000;
const jourMois = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

type Reception = Pick<TestVma, 'statut'> & Partial<Pick<TestVma, 'recueLe' | 'resultat'>>;

// Certains résultats anciens ont été reçus sans mise à jour du statut de l'invitation.
export const testTermine = (t: Reception) =>
  t.statut === 'utilisee' || Boolean(t.recueLe || t.resultat);

const ouverte = (t: Reception & Pick<TestVma, 'expireLe'>, maintenant: number) =>
  !testTermine(t) && t.statut === 'envoyee' && Date.parse(t.expireLe) > maintenant;

export const peutRelancer = (
  t: Reception & Pick<TestVma, 'expireLe' | 'contactEmail'>,
  maintenant = Date.now(),
) => ouverte(t, maintenant) && Boolean(t.contactEmail);

export const sansReponse = (
  t: Reception & Pick<TestVma, 'expireLe' | 'envoyeeLe'>,
  maintenant = Date.now(),
) =>
  ouverte(t, maintenant) &&
  t.envoyeeLe !== null &&
  maintenant - Date.parse(t.envoyeeLe) > 7 * JOUR_MS;

type EtapeFrise = {
  cle: string;
  libelle: string;
  date: string | null;
  atteinte: boolean;
  detail?: string;
};

// Cinq emplacements stables : une étape absente ne décale pas les suivantes.
export function etapesFrise(
  t: Reception & Pick<TestVma, 'envoyeeLe' | 'relances' | 'mailOuvertLe' | 'lienOuvertLe'>,
): EtapeFrise[] {
  const relances = [...t.relances].sort((a, b) => a.le.localeCompare(b.le));
  const derniere = relances.at(-1);
  const etape = (cle: string, libelle: string, le: string | null | undefined): EtapeFrise => ({
    cle,
    libelle,
    date: le ? jourMois(le) : null,
    atteinte: Boolean(le),
  });
  return [
    etape('envoi', 'Envoyé', t.envoyeeLe),
    {
      ...etape('relance', 'Relancé', derniere?.le),
      detail: relances.length
        ? relances
            .map((r) => `${jourMois(r.le)}${r.origine === 'auto' ? ' (auto)' : ''}`)
            .join(' · ')
        : undefined,
    },
    {
      ...etape('mail', 'Mail ouvert', t.mailOuvertLe),
      detail: 'Ouverture indicative : certaines messageries chargent les images automatiquement.',
    },
    etape('lien', 'Lien ouvert', t.lienOuvertLe),
    { ...etape('resultat', 'Résultat reçu', t.recueLe), atteinte: testTermine(t) },
  ];
}
