import { useEffect, useState } from 'react';
import {
  creerListeBase,
  fetchMandatsBase,
  majListeBase,
  supprimerListeBase,
  type MandatBase,
  type ResumeListeBase,
} from '../api.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The pilot's own groups of contacts. The mandate of a list is the one that will prospect it.
export function ListesBase({
  slug,
  listes,
  onChange,
}: {
  slug: string;
  listes: ResumeListeBase[];
  onChange: () => void;
}) {
  const [mandats, setMandats] = useState<MandatBase[]>([]);
  const [nouveau, setNouveau] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    fetchMandatsBase(slug).then(
      (m) => actif && setMandats(m),
      () => undefined,
    );
    return () => {
      actif = false;
    };
  }, [slug]);

  const agir = async (action: () => Promise<unknown>) => {
    setOccupe(true);
    setErreur(null);
    try {
      await action();
      onChange();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="bv-listes">
      {erreur && (
        <p className="error" role="alert">
          {erreur}
        </p>
      )}
      {listes.length === 0 ? (
        <p className="muted">
          Aucune liste. Créez-en une, puis cochez des contacts et ajoutez-les à la liste.
        </p>
      ) : (
        <table className="tbl small">
          <thead>
            <tr>
              <th>Liste</th>
              <th>Contacts</th>
              <th>Mandat qui la prospecte</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {listes.map((l) => (
              <tr key={l.id}>
                <td>
                  <input
                    className="input"
                    aria-label={`Nom de la liste ${l.nom}`}
                    defaultValue={l.nom}
                    disabled={occupe}
                    onBlur={(e) => {
                      const nom = e.target.value.trim();
                      if (nom && nom !== l.nom) void agir(() => majListeBase(slug, l.id, { nom }));
                      else e.target.value = l.nom;
                    }}
                  />
                </td>
                <td>{l.nombre}</td>
                <td>
                  <select
                    className="input"
                    aria-label={`Mandat de la liste ${l.nom}`}
                    value={l.mandat ?? ''}
                    disabled={occupe}
                    onChange={(e) =>
                      void agir(() => majListeBase(slug, l.id, { mandat: e.target.value || null }))
                    }
                  >
                    <option value="">Aucun</option>
                    {mandats.map((m) => (
                      <option key={m.slug} value={m.nom}>
                        {m.nom}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="btn sm"
                    disabled={occupe}
                    aria-label={`Supprimer la liste ${l.nom}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Supprimer la liste « ${l.nom} » ? Les contacts restent dans la base.`,
                        )
                      )
                        void agir(() => supprimerListeBase(slug, l.id));
                    }}
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="bv-listes-nouvelle"
        onSubmit={(e) => {
          e.preventDefault();
          const nom = nouveau.trim();
          if (nom)
            void agir(async () => {
              await creerListeBase(slug, nom);
              setNouveau('');
            });
        }}
      >
        <label className="small">
          Nouvelle liste
          <input className="input" value={nouveau} onChange={(e) => setNouveau(e.target.value)} />
        </label>{' '}
        <button className="btn sm primary" disabled={occupe || !nouveau.trim()}>
          Créer la liste
        </button>
      </form>
    </div>
  );
}
