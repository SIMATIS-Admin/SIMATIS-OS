import { useCallback, useEffect, useState } from 'react';
import {
  ajouterEntreprisesALaListeBase,
  creerListeBase,
  fetchEntreprisesBase,
  retirerEntreprisesDeLaListeBase,
  type LigneEntrepriseBase,
  type ResumeListeBase,
} from '../api.js';
import { CarteEntreprises } from './CarteEntreprises.js';
import { Fenetre } from './Fenetre.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const entier = (n: number) => n.toLocaleString('fr-FR');
const PAR_PAGE = 50;
const euros = (n: number | null) =>
  n === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(n);

// The companies of the base (those confirmed in the State directory), the lists of companies
// they sit in, and a way to put several of them in a list at once.
export function EntreprisesBase({
  slug,
  listes,
  onChange,
  onVoirContacts,
}: {
  slug: string;
  listes: ResumeListeBase[];
  onChange: () => void;
  onVoirContacts: (liste: string) => void;
}) {
  const [q, setQ] = useState('');
  const [liste, setListe] = useState('');
  const [page, setPage] = useState(0);
  const [etat, setEtat] = useState<{ entreprises: LigneEntrepriseBase[]; total: number } | null>(
    null,
  );
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // The map, with the companies already chosen when it is opened from a selection.
  const [carte, setCarte] = useState<string[] | null>(null);
  const listesEntreprises = listes.filter((l) => l.type === 'entreprises');

  const charger = useCallback(
    () =>
      fetchEntreprisesBase(slug, { q, liste: liste || undefined, page }).then(
        (e) => {
          setEtat(e);
          setSelection(new Set());
        },
        (e: unknown) => setErreur(message(e)),
      ),
    [slug, q, liste, page],
  );
  useEffect(() => {
    void charger();
  }, [charger]);

  const agir = async (action: () => Promise<void>) => {
    setOccupe(true);
    setErreur(null);
    try {
      await action();
      await charger();
      onChange();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };
  const ajouter = (valeur: string) =>
    agir(async () => {
      let id = valeur;
      if (valeur === 'nouvelle') {
        const nom = window.prompt('Nom de la nouvelle liste d’entreprises');
        if (!nom?.trim()) return;
        id = (await creerListeBase(slug, nom, null, 'entreprises')).id;
      }
      const { ajoutees } = await ajouterEntreprisesALaListeBase(slug, id, [...selection]);
      setInfo(
        `${ajoutees} entreprise${ajoutees > 1 ? 's' : ''} ajoutée${ajoutees > 1 ? 's' : ''} à la liste.`,
      );
    });
  const nomListe = (id: string) => listes.find((l) => l.id === id)?.nom ?? '';
  const total = etat?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  const lignes = etat?.entreprises ?? [];

  return (
    <section className="bv-liste" aria-label="Entreprises de la base">
      <div className="bv-outils">
        <input
          className="input bv-recherche"
          type="search"
          aria-label="Rechercher une entreprise de la base"
          placeholder="Nom, SIREN ou ville"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <select
          className="input"
          aria-label="Filtrer les entreprises par liste"
          value={liste}
          onChange={(e) => {
            setListe(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Toutes les entreprises</option>
          {listesEntreprises.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nom} ({l.nombre})
            </option>
          ))}
        </select>
        {liste && (
          <button className="btn sm" onClick={() => onVoirContacts(liste)}>
            Voir les contacts de cette liste
          </button>
        )}
        <button className="btn sm" onClick={() => setCarte([])}>
          Voir la carte
        </button>
        <span className="small muted">
          {entier(total)} entreprise{total > 1 ? 's' : ''}
        </span>
      </div>
      {selection.size > 0 && (
        <div className="bv-selection" role="region" aria-label="Actions sur les entreprises">
          <strong>
            {selection.size} sélectionnée{selection.size > 1 ? 's' : ''}
          </strong>
          <select
            className="input"
            aria-label="Ajouter les entreprises à une liste"
            value=""
            disabled={occupe}
            onChange={(e) => e.target.value && void ajouter(e.target.value)}
          >
            <option value="">Ajouter à une liste…</option>
            {listesEntreprises.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nom}
              </option>
            ))}
            <option value="nouvelle">+ Nouvelle liste…</option>
          </select>
          <button className="btn sm" disabled={occupe} onClick={() => setCarte([...selection])}>
            Tournée sur la carte
          </button>
          {liste && (
            <button
              className="btn sm"
              disabled={occupe}
              onClick={() =>
                void agir(async () => {
                  await retirerEntreprisesDeLaListeBase(slug, liste, [...selection]);
                })
              }
            >
              Retirer de cette liste
            </button>
          )}
          <button
            className="bv-fermer clair"
            aria-label="Désélectionner"
            onClick={() => setSelection(new Set())}
          >
            ×
          </button>
        </div>
      )}
      {info && (
        <p className="small muted" role="status">
          {info}
        </p>
      )}
      {erreur && (
        <p className="error" role="alert">
          {erreur}
        </p>
      )}
      {etat && lignes.length === 0 ? (
        <div className="empty">
          {total === 0 && !q && !liste
            ? 'Aucune entreprise rattachée à l’annuaire pour l’instant. Utilisez « Chercher des entreprises » ou rattachez un contact depuis sa fiche.'
            : 'Aucune entreprise ne correspond.'}
        </div>
      ) : (
        <div className="mapping-scroll">
          <table className="tbl small bv-table">
            <thead>
              <tr>
                <th className="bv-case">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner"
                    checked={lignes.length > 0 && selection.size === lignes.length}
                    onChange={() =>
                      setSelection(
                        selection.size === lignes.length
                          ? new Set()
                          : new Set(lignes.map((l) => l.id)),
                      )
                    }
                  />
                </th>
                <th>Entreprise</th>
                <th>Ville</th>
                <th>Activité</th>
                <th>Effectif</th>
                <th>CA publié</th>
                <th>Contacts</th>
                <th>Listes</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td className="bv-case">
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${l.nom}`}
                      checked={selection.has(l.id)}
                      onChange={() => {
                        const n = new Set(selection);
                        if (!n.delete(l.id)) n.add(l.id);
                        setSelection(n);
                      }}
                    />
                  </td>
                  <td>
                    {l.nom}
                    <div className="small muted">SIREN {l.siren}</div>
                  </td>
                  <td>{l.ville ?? '—'}</td>
                  <td>{l.naf ?? '—'}</td>
                  <td>{l.effectif ?? '—'}</td>
                  <td>{euros(l.ca)}</td>
                  <td>{l.nbContacts}</td>
                  <td>{l.listes.map(nomListe).filter(Boolean).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <p>
          <button className="btn sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
            Page précédente
          </button>{' '}
          <span className="small muted">
            page {page + 1} sur {pages}
          </span>{' '}
          <button className="btn sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Page suivante
          </button>
        </p>
      )}
      {carte && (
        <Fenetre titre="Carte des entreprises" onFermer={() => setCarte(null)}>
          <CarteEntreprises
            slug={slug}
            filtres={{ q: q || undefined, liste: liste || undefined }}
            initiales={carte}
          />
        </Fenetre>
      )}
    </section>
  );
}
