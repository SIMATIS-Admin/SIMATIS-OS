import { useEffect, useState } from 'react';
import {
  createContact,
  fetchContacts,
  fetchSuspectsBase,
  type SuspectBase,
  fetchEntreprises,
  type Contact,
  type Entreprise,
  patchFiche,
  type RefFiche,
} from '../api.js';
import { Modal } from './Overlay.js';
import { fusionnerDeux, supprimerEnLot } from './listes/lots.js';
import { Tableau } from './listes/Tableau.js';
import {
  EnteteCommercial,
  Identite,
  ProchaineActivite,
  useChoixCommercial,
} from './commercial/commun.js';
import { ApercuCommercial, type ReferenceCommerciale } from './commercial/Apercu.js';
import { SearchBox } from './SearchBox.js';
import { SuspectsBase } from './commercial/SuspectsBase.js';
import {
  correspondAuStatut,
  FiltreStatut,
  LIBELLE_STATUT,
  type ChoixStatut,
} from './commercial/FiltreStatut.js';

// Simulated creation (no id) or created-but-not-linked answer: what to tell the person.
const messageDe = (r: { avertissement?: string; message?: string }) => r.avertissement ?? r.message;

export function NouveauContact({
  slug,
  onClose,
  onCreated,
  lierA,
  entrepriseParDefaut,
}: {
  slug: string;
  onClose: () => void;
  onCreated: (id: string, message?: string) => void;
  // Record the person is added from: the new one is linked to it.
  lierA?: RefFiche;
  entrepriseParDefaut?: string;
}) {
  const [nom, setNom] = useState('');
  const [fonction, setFonction] = useState('');
  const [email, setEmail] = useState('');
  const [entrepriseId, setEntrepriseId] = useState(entrepriseParDefaut ?? '');
  const [entreprises, setEntreprises] = useState<Entreprise[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEntreprises(slug, '').then(setEntreprises, () => setEntreprises([]));
  }, [slug]);

  const submit = () =>
    createContact(slug, {
      nom,
      fonction: fonction || undefined,
      email: email || undefined,
      entrepriseId: entrepriseId || null,
      ...(lierA ? { lierA } : {}),
    }).then(
      (c) => onCreated(c.id, messageDe(c)),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );

  return (
    <Modal title="Nouveau contact" onClose={onClose}>
      <label className="field">
        <span>Nom</span>
        <input className="input" value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Fonction</span>
        <input className="input" value={fonction} onChange={(e) => setFonction(e.target.value)} />
      </label>
      <label className="field">
        <span>Email</span>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {lierA?.kind !== 'entreprise' && (
        <label className="field">
          <span>Entreprise</span>
          <select
            className="input"
            value={entrepriseId}
            onChange={(e) => setEntrepriseId(e.target.value)}
          >
            <option value="">Aucune</option>
            {entreprises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom}
              </option>
            ))}
          </select>
        </label>
      )}
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

export function Contacts({ slug }: { slug: string }) {
  const [q, setQ] = useChoixCommercial(`${slug}.contacts.recherche`, '');
  const [filtre, setFiltre] = useChoixCommercial(`${slug}.contacts.filtre`, 'tous');
  const [statut, setStatut] = useChoixCommercial<ChoixStatut>(`${slug}.contacts.statut`, 'tous');
  const [apercu, setApercu] = useState<ReferenceCommerciale | null>(null);
  const [list, setList] = useState<Contact[] | null>(null);
  const [suspectsBase, setSuspectsBase] = useState<SuspectBase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  // In-place and bulk edits: written like the detail page (HubSpot first when it is the source).
  const modifier = (id: string, champ: string, v: string | number | null) =>
    patchFiche(slug, 'contact', id, { [champ]: v }).then(
      (r) => {
        setMessage('simulation' in r ? r.message : null);
        setVersion((n) => n + 1);
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );

  useEffect(() => {
    let alive = true;
    fetchContacts(slug, q).then(
      (rows) => alive && (setList(rows), setError(null)),
      (e: unknown) => alive && setError(String(e)),
    );
    // Les Bases vivantes sont un complément : sans elles, la liste du CRM reste utilisable.
    fetchSuspectsBase(slug, q).then(
      (rows) => alive && setSuspectsBase(rows),
      () => alive && setSuspectsBase([]),
    );
    return () => {
      alive = false;
    };
  }, [slug, q, version]);

  const visibles = list?.filter(
    (c) =>
      correspondAuStatut(c, statut) &&
      (filtre === 'affaires'
        ? c.oppsOuvertes > 0
        : filtre === 'sans'
          ? !c.prochaineActivite
          : true),
  );
  return (
    <section className="commercial-page com-contacts">
      <EnteteCommercial description="Vos contacts, leur entreprise et la prochaine action, au même endroit.">
        <button className="btn primary" onClick={() => setCreating(true)}>
          Nouveau contact
        </button>
      </EnteteCommercial>
      <FiltreStatut
        lignes={list && [...list, ...suspectsBase.map(() => ({ statut: 'suspect' as const }))]}
        valeur={statut}
        onChange={setStatut}
      />
      <nav className="com-onglets" aria-label="Vues des contacts">
        {(
          [
            ['tous', 'Tous'],
            ['affaires', 'Avec une affaire'],
            ['sans', 'Sans activité'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={filtre === id} onClick={() => setFiltre(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="panel com-repertoire">
        <div className="panel-h">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Rechercher un nom, une fonction, une entreprise"
          />
          <span className="small muted">
            {list
              ? `${visibles?.length ?? 0} contact${(visibles?.length ?? 0) > 1 ? 's' : ''}`
              : ''}
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
            cle="contacts"
            lignes={visibles ?? []}
            outilsRepliables
            titre={(c) => c.nom}
            onOuvrir={(c) => setApercu({ kind: 'contact', id: c.id })}
            onModifier={(c, champ, v) => modifier(c.id, champ, v)}
            onSupprimer={supprimerEnLot(slug, 'contact', () => setVersion((n) => n + 1))}
            onFusionner={fusionnerDeux(slug, 'contact', () => setVersion((n) => n + 1))}
            colonnes={[
              {
                cle: 'nom',
                label: 'Contact',
                valeur: (c) => c.nom,
                affiche: (c) => (
                  <button
                    className="com-ouvrir"
                    onClick={(e) => {
                      e.stopPropagation();
                      setApercu({ kind: 'contact', id: c.id });
                    }}
                  >
                    <Identite nom={c.nom} detail={c.fonction} />
                  </button>
                ),
              },
              {
                cle: 'entreprise',
                label: 'Entreprise',
                valeur: (c) => c.entreprise,
                affiche: (c) =>
                  c.entrepriseId ? (
                    <button
                      className="com-texte-lien"
                      onClick={(e) => {
                        e.stopPropagation();
                        setApercu({ kind: 'entreprise', id: c.entrepriseId! });
                      }}
                    >
                      {c.entreprise}
                    </button>
                  ) : (
                    <span className="muted">{c.entreprise ?? '—'}</span>
                  ),
              },
              {
                cle: 'statut',
                label: 'Statut',
                valeur: (c) => LIBELLE_STATUT[c.statut],
              },
              {
                cle: 'fonction',
                label: 'Fonction',
                valeur: (c) => c.fonction,
                edition: { champ: 'fonction' },
                masquee: true,
              },
              {
                cle: 'email',
                label: 'Email',
                valeur: (c) => c.email,
                edition: { champ: 'email', type: 'email' },
                masquee: true,
              },
              {
                cle: 'telephone',
                label: 'Téléphone',
                valeur: (c) => c.telephone,
                edition: { champ: 'telephone' },
                masquee: true,
              },
              {
                cle: 'opps',
                label: 'Affaires ouvertes',
                valeur: (c) => c.oppsOuvertes,
                masquee: true,
              },
              {
                cle: 'prochaine',
                label: 'Prochaine activité',
                valeur: (c) => c.prochaineActivite,
                affiche: (c) => <ProchaineActivite date={c.prochaineActivite} />,
              },
              { cle: 'role', label: 'Rôle', valeur: (c) => c.role, masquee: true },
            ]}
          />
        )}
        {visibles?.length === 0 && suspectsBase.length === 0 && (
          <p className="empty">Aucun contact ne correspond.</p>
        )}
        {(statut === 'tous' || statut === 'suspect') && filtre === 'tous' && (
          <SuspectsBase slug={slug} suspects={suspectsBase} />
        )}
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
        <NouveauContact
          slug={slug}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setVersion((v) => v + 1);
            location.hash = `#/${slug}/fiche/contact/${id}`;
          }}
        />
      )}
    </section>
  );
}
