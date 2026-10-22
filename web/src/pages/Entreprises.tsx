import { useEffect, useState } from 'react';
import {
  createEntreprise,
  fetchEntreprises,
  patchFiche,
  type Entreprise,
  type RefFiche,
} from '../api.js';
import { eur } from '../crm.js';
import { Modal } from './Overlay.js';
import { fusionnerDeux, supprimerEnLot } from './listes/lots.js';
import { jour, Tableau } from './listes/Tableau.js';
import { SearchBox } from './SearchBox.js';

export function NouvelleEntreprise({
  slug,
  onClose,
  onCreated,
  lierA,
}: {
  slug: string;
  onClose: () => void;
  onCreated: (id: string, message?: string) => void;
  // Record the organisation is added from: the new one is linked to it.
  lierA?: RefFiche;
}) {
  const [nom, setNom] = useState('');
  const [secteur, setSecteur] = useState('');
  const [ville, setVille] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () =>
    createEntreprise(slug, {
      nom,
      secteur: secteur || undefined,
      ville: ville || undefined,
      ...(lierA ? { lierA } : {}),
    }).then(
      (e) => onCreated(e.id, e.avertissement ?? e.message),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  return (
    <Modal title="Nouvelle entreprise" onClose={onClose}>
      <label className="field">
        <span>Nom</span>
        <input className="input" value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Secteur</span>
        <input className="input" value={secteur} onChange={(e) => setSecteur(e.target.value)} />
      </label>
      <label className="field">
        <span>Ville</span>
        <input className="input" value={ville} onChange={(e) => setVille(e.target.value)} />
      </label>
      {error && (
        <p className="small" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn primary" disabled={!nom.trim()} onClick={() => void submit()}>
          Créer
        </button>
        <button className="btn ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Modal>
  );
}

export function Entreprises({ slug }: { slug: string }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Entreprise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  // In-place and bulk edits: written like the detail page (HubSpot first when it is the source).
  const modifier = (id: string, champ: string, v: string | number | null) =>
    patchFiche(slug, 'entreprise', id, { [champ]: v }).then(
      (r) => {
        setMessage('simulation' in r ? r.message : null);
        setVersion((n) => n + 1);
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );

  useEffect(() => {
    let alive = true;
    fetchEntreprises(slug, q).then(
      (rows) => alive && (setList(rows), setError(null)),
      (e: unknown) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [slug, q, version]);

  return (
    <>
      <div className="page-actions">
        <button className="btn primary" onClick={() => setCreating(true)}>
          Nouvelle entreprise
        </button>
      </div>
      <div className="panel">
        <div className="panel-h">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Rechercher une entreprise, un secteur, une ville"
          />
          <span className="small muted">
            {list ? `${list.length} entreprise${list.length > 1 ? 's' : ''}` : ''}
          </span>
        </div>
        {error && <p className="empty">{error}</p>}
        {message && (
          <div className="alert amber" style={{ margin: 8 }}>
            <div>{message}</div>
          </div>
        )}
        {list && (
          <Tableau
            cle="entreprises"
            lignes={list}
            titre={(e) => e.nom}
            onOuvrir={(e) => (location.hash = `#/${slug}/fiche/entreprise/${e.id}`)}
            onModifier={(e, champ, v) => modifier(e.id, champ, v)}
            onSupprimer={supprimerEnLot(slug, 'entreprise', () => setVersion((n) => n + 1))}
            onFusionner={fusionnerDeux(slug, 'entreprise', () => setVersion((n) => n + 1))}
            colonnes={[
              {
                cle: 'nom',
                label: 'Organisation',
                valeur: (e) => e.nom,
                affiche: (e) => <b>{e.nom}</b>,
              },
              { cle: 'secteur', label: 'Secteur', valeur: (e) => e.secteur },
              { cle: 'ville', label: 'Ville', valeur: (e) => e.ville, edition: { champ: 'ville' } },
              {
                cle: 'domaine',
                label: 'Domaine',
                valeur: (e) => e.domaine,
                edition: { champ: 'domaine' },
              },
              {
                cle: 'taille',
                label: 'Salariés',
                valeur: (e) => e.taille,
                edition: { champ: 'taille', type: 'number' },
              },
              { cle: 'contacts', label: 'Contacts', valeur: (e) => e.nbContacts },
              { cle: 'opps', label: 'Affaires ouvertes', valeur: (e) => e.oppsOuvertes },
              {
                cle: 'valeur',
                label: 'Valeur ouverte',
                valeur: (e) => e.montantOuvert,
                affiche: (e) => (e.montantOuvert ? eur(e.montantOuvert) : ''),
              },
              {
                cle: 'prochaine',
                label: 'Prochaine activité',
                valeur: (e) => e.prochaineActivite,
                affiche: (e) => jour(e.prochaineActivite),
              },
            ]}
          />
        )}
        {list?.length === 0 && <p className="empty">Aucune entreprise ne correspond.</p>}
      </div>
      {creating && (
        <NouvelleEntreprise
          slug={slug}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setVersion((v) => v + 1);
            location.hash = `#/${slug}/fiche/entreprise/${id}`;
          }}
        />
      )}
    </>
  );
}
