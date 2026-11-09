import { useEffect, useState } from 'react';
import {
  createEntreprise,
  fetchEntreprises,
  patchFiche,
  type Entreprise,
  type RefFiche,
} from '../api.js';
import { sommeEur } from '../crm.js';
import { Modal } from './Overlay.js';
import { fusionnerDeux, supprimerEnLot } from './listes/lots.js';
import { jour, Tableau } from './listes/Tableau.js';
import {
  EnteteCommercial,
  Identite,
  ProchaineActivite,
  useChoixCommercial,
} from './commercial/commun.js';
import { ApercuCommercial, type ReferenceCommerciale } from './commercial/Apercu.js';
import { Icon } from '../icons.js';
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
  const [q, setQ] = useChoixCommercial(`${slug}.entreprises.recherche`, '');
  const [filtre, setFiltre] = useChoixCommercial(`${slug}.entreprises.filtre`, 'toutes');
  const [vue, setVue] = useChoixCommercial(`${slug}.entreprises.vue.v2`, 'liste');
  const [apercu, setApercu] = useState<ReferenceCommerciale | null>(null);
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

  const visibles = list?.filter((e) =>
    filtre === 'affaires'
      ? e.oppsOuvertes > 0
      : filtre === 'sans'
        ? !e.prochaineActivite
        : filtre === 'sans-contact'
          ? e.nbContacts === 0
          : filtre === 'sans-nom'
            ? /^Entreprise HubSpot \d+$/.test(e.nom)
            : true,
  );
  return (
    <section className="commercial-page com-entreprises">
      <EnteteCommercial description="Les personnes, les affaires et le prochain échange de chaque entreprise.">
        <div className="seg" aria-label="Présentation des entreprises">
          {(['cartes', 'liste'] as const).map((v) => (
            <button
              key={v}
              className={vue === v ? 'on' : ''}
              aria-pressed={vue === v}
              onClick={() => setVue(v)}
            >
              <Icon name={v === 'cartes' ? 'panel' : 'list'} />
              {v === 'cartes' ? 'Cartes' : 'Liste'}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          Nouvelle entreprise
        </button>
      </EnteteCommercial>
      <nav className="com-onglets" aria-label="Vues des entreprises">
        {(
          [
            ['toutes', 'Toutes'],
            ['affaires', 'Avec une affaire'],
            ['sans', 'Sans activité'],
            ['sans-contact', 'Sans contact'],
            ['sans-nom', 'Nom à renseigner'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={filtre === id} onClick={() => setFiltre(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className={`com-repertoire ${vue === 'liste' ? 'panel' : ''}`}>
        <div className="panel-h">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Rechercher une entreprise, un secteur, une ville"
          />
          <span className="small muted">
            {list
              ? `${visibles?.length ?? 0} entreprise${(visibles?.length ?? 0) > 1 ? 's' : ''}`
              : ''}
          </span>
        </div>
        {error && <p className="empty">{error}</p>}
        {message && (
          <div className="alert amber" style={{ margin: 8 }}>
            <div>{message}</div>
          </div>
        )}
        {list && vue !== 'liste' && (
          <div className="com-entreprise-grille">
            {visibles?.map((e) => (
              <article className="com-entreprise-carte" key={e.id}>
                <button
                  className="com-ouvrir"
                  onClick={() => setApercu({ kind: 'entreprise', id: e.id })}
                >
                  <Identite
                    nom={e.nom}
                    detail={[e.secteur, e.ville].filter(Boolean).join(' · ')}
                    carre
                  />
                  <Icon name="panel" />
                </button>
                <div className="com-entreprise-affaires">
                  <span>
                    {e.oppsOuvertes} affaire{e.oppsOuvertes > 1 ? 's' : ''} ouverte
                    {e.oppsOuvertes > 1 ? 's' : ''}
                  </span>
                  <strong>
                    {e.montantOuvert || e.montantMensuelOuvert
                      ? sommeEur({ spot: e.montantOuvert, mensuel: e.montantMensuelOuvert ?? 0 })
                      : 'À estimer'}
                  </strong>
                </div>
                <footer>
                  <span>
                    <Icon name="users" />
                    {e.nbContacts} contact{e.nbContacts > 1 ? 's' : ''}
                  </span>
                  <ProchaineActivite date={e.prochaineActivite} />
                </footer>
              </article>
            ))}
          </div>
        )}
        {list && vue === 'liste' && (
          <Tableau
            cle="entreprises"
            lignes={visibles ?? []}
            outilsRepliables
            titre={(e) => e.nom}
            onOuvrir={(e) => setApercu({ kind: 'entreprise', id: e.id })}
            onModifier={(e, champ, v) => modifier(e.id, champ, v)}
            onSupprimer={supprimerEnLot(slug, 'entreprise', () => setVersion((n) => n + 1))}
            onFusionner={fusionnerDeux(slug, 'entreprise', () => setVersion((n) => n + 1))}
            colonnes={[
              {
                cle: 'nom',
                label: 'Organisation',
                valeur: (e) => e.nom,
                affiche: (e) => (
                  <button
                    className="com-ouvrir"
                    onClick={(event) => {
                      event.stopPropagation();
                      setApercu({ kind: 'entreprise', id: e.id });
                    }}
                  >
                    <Identite nom={e.nom} detail={e.secteur} carre />
                  </button>
                ),
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
                affiche: (e) =>
                  e.montantOuvert || e.montantMensuelOuvert
                    ? sommeEur({ spot: e.montantOuvert, mensuel: e.montantMensuelOuvert })
                    : '',
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
        {visibles?.length === 0 && <p className="empty">Aucune entreprise ne correspond.</p>}
      </div>
      {apercu && (
        <ApercuCommercial
          key={`${apercu.kind}-${apercu.id}`}
          slug={slug}
          reference={apercu}
          onFermer={() => setApercu(null)}
        />
      )}
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
    </section>
  );
}
