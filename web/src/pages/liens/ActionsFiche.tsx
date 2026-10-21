import { useEffect, useState } from 'react';
import {
  fetchRecherche,
  fusionnerFiches,
  supprimerFiche,
  type KindFiche,
  type Recherche,
} from '../../api.js';
import { Modal } from '../Overlay.js';

// Delete and merge buttons of a record page. A merge keeps one of the two records; the page then
// reloads (this one kept) or follows to the kept one.

const candidats = (kind: KindFiche, r: Recherche): { id: string; nom: string }[] =>
  kind === 'contact'
    ? r.personnes.map((p) => ({ id: p.id, nom: p.nom }))
    : kind === 'entreprise'
      ? r.organisations.map((o) => ({ id: o.id, nom: o.nom }))
      : r.affaires.map((a) => ({ id: a.id, nom: a.titre }));

export function ActionsFiche({
  slug,
  kind,
  id,
  titre,
  onMessage,
  onChange,
}: {
  slug: string;
  kind: KindFiche;
  id: string;
  titre: string;
  onMessage: (m: string | null) => void;
  onChange: () => void;
}) {
  const [ouvert, setOuvert] = useState<'supprimer' | 'fusionner' | null>(null);
  const [q, setQ] = useState('');
  const [trouves, setTrouves] = useState<{ id: string; nom: string }[]>([]);
  const [autre, setAutre] = useState<{ id: string; nom: string } | null>(null);
  const [garde, setGarde] = useState<'ici' | 'autre' | ''>('');

  useEffect(() => {
    if (ouvert !== 'fusionner' || q.trim().length < 2) {
      setTrouves([]);
      return;
    }
    let alive = true;
    fetchRecherche(slug, q.trim()).then(
      (r) => alive && setTrouves(candidats(kind, r).filter((c) => c.id !== id)),
      () => alive && setTrouves([]),
    );
    return () => {
      alive = false;
    };
  }, [slug, kind, id, q, ouvert]);

  const fermer = () => {
    setOuvert(null);
    setQ('');
    setAutre(null);
    setGarde('');
  };
  const erreur = (e: unknown) => {
    onMessage(e instanceof Error ? e.message : String(e));
    fermer();
  };

  const supprimer = () =>
    supprimerFiche(slug, { kind, id }).then((r) => {
      fermer();
      if ('simulation' in r) return onMessage(r.message);
      history.back();
    }, erreur);

  const fusionner = () => {
    if (!autre || !garde) return;
    const gardeId = garde === 'ici' ? id : autre.id;
    const absorbeId = garde === 'ici' ? autre.id : id;
    return fusionnerFiches(slug, kind, gardeId, absorbeId).then((r) => {
      fermer();
      if ('simulation' in r) return onMessage(r.message);
      if (gardeId === id) {
        onMessage(null);
        onChange();
      } else location.hash = `#/${slug}/fiche/${kind}/${gardeId}`;
    }, erreur);
  };

  return (
    <>
      <div className="decision">
        <button className="btn" onClick={() => setOuvert('fusionner')}>
          Fusionner avec…
        </button>
        <button className="btn" onClick={() => setOuvert('supprimer')}>
          Supprimer
        </button>
      </div>
      {ouvert === 'supprimer' && (
        <Modal title={`Supprimer « ${titre} » ?`} onClose={fermer}>
          <p>
            La fiche est supprimée de l’OS et archivée dans HubSpot si elle y existe. Ses tâches et
            son historique restent, détachés.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn primary" onClick={() => void supprimer()}>
              Confirmer la suppression
            </button>
            <button className="btn ghost" onClick={fermer}>
              Annuler
            </button>
          </div>
        </Modal>
      )}
      {ouvert === 'fusionner' && (
        <Modal title="Fusionner avec une autre fiche" onClose={fermer}>
          {!autre ? (
            <>
              <input
                className="input"
                autoFocus
                aria-label="Rechercher la fiche à fusionner"
                placeholder="Rechercher par nom"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {trouves.map((c) => (
                <button key={c.id} className="btn ghost" onClick={() => setAutre(c)}>
                  {c.nom}
                </button>
              ))}
            </>
          ) : (
            <>
              <fieldset style={{ border: 0, padding: 0 }}>
                <legend>Quelle fiche garder ?</legend>
                <label className="check">
                  <input
                    type="radio"
                    name="garde"
                    checked={garde === 'ici'}
                    onChange={() => setGarde('ici')}
                  />
                  <span>{titre} (cette fiche)</span>
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="garde"
                    checked={garde === 'autre'}
                    onChange={() => setGarde('autre')}
                  />
                  <span>{autre.nom}</span>
                </label>
              </fieldset>
              <p className="small muted">
                Liens, tâches et historique de l’autre fiche passent sur celle gardée, puis l’autre
                est supprimée. La fusion est définitive dans HubSpot.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn primary" disabled={!garde} onClick={() => void fusionner()}>
                  Confirmer la fusion
                </button>
                <button className="btn ghost" onClick={fermer}>
                  Annuler
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
