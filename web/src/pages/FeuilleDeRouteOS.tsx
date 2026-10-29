import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchCarteCerveau, operationCerveau } from '../api.js';
import type { NoeudCerveau } from '../cerveau.js';
import {
  NOTE_FEUILLE,
  NOTE_STRUCTURE,
  ajouterEtape,
  idéesOS,
  marquerPromue,
} from '../feuilleDeRouteOS.js';
import { NoteCerveau } from './NoteCerveau.js';

type Note = { contenu: string } | { erreur: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Réservé à « Mon activité » : la structure de l'OS et ses prochaines étapes, tenues dans le second
// cerveau (le Drive reste la référence). `autorise` vient de l'instance courante ; le serveur refuse
// de toute façon les autres instances.
export function FeuilleDeRouteOS({ slug, autorise }: { slug: string; autorise: boolean }) {
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [idees, setIdees] = useState<NoeudCerveau[]>([]);
  const [edition, setEdition] = useState<string | null>(null);
  const [alerte, setAlerte] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  // Idées promues pendant cette visite : la carte relue juste après peut encore les montrer en brouillon.
  const promues = useRef(new Set<string>());

  const charger = useCallback(async () => {
    const lire = (chemin: string): Promise<Note> =>
      operationCerveau(slug, { type: 'lire', chemin }).then(
        (r): Note => ({ contenu: r.contenu ?? '' }),
        (e: unknown): Note => ({ erreur: message(e) }),
      );
    const [structure, feuille, carte] = await Promise.all([
      lire(NOTE_STRUCTURE),
      lire(NOTE_FEUILLE),
      fetchCarteCerveau(slug).catch(() => null),
    ]);
    setNotes({ [NOTE_STRUCTURE]: structure, [NOTE_FEUILLE]: feuille });
    setIdees(carte ? idéesOS(carte.noeuds).filter((i) => !promues.current.has(i.id)) : []);
  }, [slug]);

  useEffect(() => {
    if (autorise) void charger();
  }, [autorise, charger]);

  if (!autorise)
    return <p className="empty">Cette section n’est pas disponible dans cet espace.</p>;

  // Deux écritures : d'abord l'étape dans la feuille, puis l'idée marquée. Si la seconde échoue,
  // l'étape existe déjà : on le dit sans rien défaire.
  const promouvoir = async (idee: NoeudCerveau) => {
    setOccupe(true);
    setAlerte(null);
    try {
      const feuille = await operationCerveau(slug, { type: 'lire', chemin: NOTE_FEUILLE });
      // Déjà liée (promotion précédente dont l'idée n'a pas pu être marquée) : pas de doublon.
      if (!(feuille.contenu ?? '').includes(`(../idees-en-vrac/${idee.id.split('/').pop()})`))
        await operationCerveau(slug, {
          type: 'ecrire',
          chemin: NOTE_FEUILLE,
          contenu: ajouterEtape(feuille.contenu ?? '', idee.titre, idee.id),
          empreinte: feuille.empreinte ?? '',
        });
    } catch (e) {
      setAlerte(
        e instanceof ApiError && e.status === 409
          ? 'La feuille de route a été modifiée ailleurs. Rechargez la page avant de promouvoir.'
          : message(e),
      );
      setOccupe(false);
      return;
    }
    try {
      const lue = await operationCerveau(slug, { type: 'lire', chemin: idee.id });
      await operationCerveau(slug, {
        type: 'ecrire',
        chemin: idee.id,
        contenu: marquerPromue(lue.contenu ?? ''),
        empreinte: lue.empreinte ?? '',
      });
    } catch {
      setAlerte(
        'L’étape a été ajoutée, mais l’idée n’a pas pu être marquée comme promue : marquez-la à la main.',
      );
    }
    setOccupe(false);
    promues.current.add(idee.id);
    await charger();
  };

  const bloc = (titre: string, chemin: string) => {
    const note = notes[chemin];
    return (
      <div className="panel">
        <div className="panel-h">
          <b>{titre}</b>
          <button className="btn" onClick={() => setEdition(chemin)} disabled={!note}>
            Modifier
          </button>
        </div>
        <div className="panel-b">
          {!note ? (
            'Chargement…'
          ) : 'erreur' in note ? (
            <div className="empty" role="alert">
              {note.erreur}
            </div>
          ) : (
            <pre className="cerveau-texte" style={{ whiteSpace: 'pre-wrap' }}>
              {note.contenu}
            </pre>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="stack">
      {alerte && (
        <div className="empty" role="alert">
          {alerte}
        </div>
      )}
      {edition && (
        <NoteCerveau
          slug={slug}
          chemin={edition}
          onFerme={() => setEdition(null)}
          onEnregistre={() => void charger()}
        />
      )}
      {bloc('Prochaines étapes', NOTE_FEUILLE)}
      <div className="panel">
        <div className="panel-h">
          <b>Idées pour l’OS à trier</b>
        </div>
        <div className="panel-b">
          {idees.length === 0 ? (
            <span className="cerveau-note">Aucune idée en attente.</span>
          ) : (
            idees.map((idee) => (
              <div key={idee.id} className="cerveau-actions">
                <span>{idee.titre}</span>
                <button className="btn" disabled={occupe} onClick={() => void promouvoir(idee)}>
                  Promouvoir en étape
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      {bloc('Structure de l’OS', NOTE_STRUCTURE)}
    </div>
  );
}
