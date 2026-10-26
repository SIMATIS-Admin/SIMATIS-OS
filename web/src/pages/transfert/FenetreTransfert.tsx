import { useEffect, useState } from 'react';
import {
  apercuTransfert,
  lancerTransfert,
  type ApercuTransfert,
  type NoeudTransfert,
  type RefTransfert,
  type TypeTransfert,
} from '../../api.js';
import { Fenetre } from '../Fenetre.js';

const NOMS: Record<TypeTransfert, [string, string]> = {
  sujet: ['entrée', 'entrées'],
  tache: ['tâche', 'tâches'],
  affaire: ['affaire', 'affaires'],
  contact: ['contact', 'contacts'],
  entreprise: ['entreprise', 'entreprises'],
  rdv: ['rendez-vous', 'rendez-vous'],
};
const LIENS: TypeTransfert[] = ['affaire', 'contact', 'entreprise'];

// « 1 affaire, 2 tâches » then the verb agreeing with the total.
function phrase(noeuds: NoeudTransfert[], verbe: [string, string], suite = '') {
  if (!noeuds.length) return null;
  const parType = new Map<TypeTransfert, number>();
  for (const n of noeuds) parType.set(n.type, (parType.get(n.type) ?? 0) + 1);
  const liste = [...parType].map(([t, n]) => `${n} ${NOMS[t][n > 1 ? 1 : 0]}`).join(', ');
  return `${liste} ${verbe[noeuds.length > 1 ? 1 : 0]}${suite}`;
}

export function FenetreTransfert({
  slug,
  objet,
  instanceOrigine,
  cible,
  onFermer,
  onFait,
}: {
  slug: string;
  objet: RefTransfert;
  instanceOrigine: string;
  cible: { slug: string; nom: string };
  onFermer: () => void;
  onFait: (cibleSlug: string, racine: RefTransfert) => void;
}) {
  const [apercu, setApercu] = useState<ApercuTransfert | null>(null);
  const [exclusions, setExclusions] = useState<RefTransfert[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const demande = (copierQuandMeme?: boolean) => ({
    ...objet,
    instanceOrigine,
    instanceCible: cible.slug,
    exclusions,
    ...(copierQuandMeme ? { copierQuandMeme } : {}),
  });

  useEffect(() => {
    let vivant = true;
    apercuTransfert(slug, {
      ...objet,
      instanceOrigine,
      instanceCible: cible.slug,
      exclusions,
    }).then(
      (a) => vivant && setApercu(a),
      (e: unknown) => vivant && setErreur(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      vivant = false;
    };
  }, [slug, objet, instanceOrigine, cible.slug, exclusions]);

  const basculer = (n: NoeudTransfert) =>
    setExclusions((x) =>
      x.some((e) => e.id === n.id)
        ? x.filter((e) => e.id !== n.id)
        : [...x, { type: n.type, id: n.id }],
    );
  const confirmer = (copierQuandMeme?: boolean) => {
    setEnvoi(true);
    lancerTransfert(slug, demande(copierQuandMeme)).then(
      (r) => onFait(cible.slug, { type: r.racine.type, id: r.racine.id }),
      (e: unknown) => {
        setErreur(e instanceof Error ? e.message : String(e));
        setEnvoi(false);
      },
    );
  };

  const deplaces = apercu?.noeuds.filter((n) => n.mode === 'deplace') ?? [];
  const copies = apercu?.noeuds.filter((n) => n.mode === 'copie') ?? [];
  const phraseDeplaces = phrase(deplaces, ['sera déplacé', 'seront déplacés']);
  const phraseCopies = phrase(
    copies,
    ['sera copié', 'seront copiés'],
    ' (détaché de l’outil d’origine)',
  );
  const existante = apercu?.copieExistante ?? null;
  const proposes = [
    ...(apercu?.noeuds.filter((n) => !n.obligatoire && n.id !== objet.id) ?? []),
    // An unticked object disappears from the preview: keep a box to tick it back.
    ...exclusions
      .filter((e) => !apercu?.noeuds.some((n) => n.id === e.id))
      .map((e) => ({ ...e, libelle: 'Objet exclu', mode: 'deplace' as const, obligatoire: false })),
  ];

  return (
    <Fenetre
      titre={`Transférer vers ${cible.nom}`}
      onFermer={onFermer}
      pied={
        <>
          <button className="btn" onClick={onFermer}>
            Annuler
          </button>
          <button
            className="btn primary"
            disabled={!apercu || envoi}
            onClick={() => confirmer(existante !== null)}
          >
            {existante ? 'Copier quand même' : 'Confirmer'}
          </button>
        </>
      }
    >
      {erreur && <p className="red">{erreur}</p>}
      {!apercu && !erreur && <p className="muted">Calcul de l’aperçu…</p>}
      {apercu && (
        <div className="transfert-apercu">
          {phraseDeplaces && <p>{phraseDeplaces}</p>}
          {phraseCopies && <p>{phraseCopies}</p>}
          {existante && (
            <p className="red">
              Cet objet a déjà été copié dans cette instance.{' '}
              {LIENS.includes(existante.type) && (
                <a href={`#/${cible.slug}/fiche/${existante.type}/${existante.id}`}>
                  Ouvrir la copie existante
                </a>
              )}
            </p>
          )}
          {proposes.length > 0 && (
            <fieldset>
              <legend>Objets liés proposés</legend>
              {proposes.map((n) => (
                <label key={`${n.type}:${n.id}`} className="transfert-ligne">
                  <input
                    type="checkbox"
                    checked={!exclusions.some((e) => e.id === n.id)}
                    onChange={() => basculer(n)}
                  />
                  <span>
                    {n.libelle} <small>({NOMS[n.type][0]})</small>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {apercu.liensRetires.length > 0 && (
            <ul className="muted">
              {apercu.liensRetires.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {apercu.avertissements.length > 0 && (
            <ul className="muted">
              {apercu.avertissements.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Fenetre>
  );
}
