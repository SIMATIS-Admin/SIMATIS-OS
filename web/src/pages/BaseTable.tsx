import { useEffect, useState } from 'react';
import {
  enrichirFicheBase,
  majConformiteBase,
  type AlerteBase,
  type EtatBase,
  type ExclusionBase,
  type FicheBase,
  type FiltresBaseWeb,
  type StatutProspectionBase,
  type ZoneBase,
} from '../api.js';
import { Icon } from '../icons.js';
import { Fenetre } from './Fenetre.js';

export const PAR_PAGE = 50;
const entier = (n: number) => n.toLocaleString('fr-FR');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// One list, five views: each tab is a pair of server filters (zone, status).
const ONGLETS: { id: string; libelle: string; zone?: ZoneBase; statut?: StatutProspectionBase }[] =
  [
    { id: 'toutes', libelle: 'Toutes' },
    { id: 'a_enrichir', libelle: 'À enrichir', zone: 'a_enrichir' },
    {
      id: 'pretes',
      libelle: 'Prêtes à contacter',
      zone: 'prospectable',
      statut: 'jamais_contacte',
    },
    { id: 'contactees', libelle: 'Contactées', statut: 'contacte' },
    { id: 'reponses', libelle: 'Ont répondu', statut: 'a_repondu' },
  ];
const ALERTES: [AlerteBase | undefined, string][] = [
  [undefined, 'Toutes alertes'],
  ['recontact', 'Contactés depuis moins de 6 mois'],
  ['opposition', 'Opposition'],
  ['exclusion', 'Exclus'],
  ['email_invalide', 'Email en erreur'],
  ['deja_en_crm', 'Déjà dans un CRM'],
];
const LIBELLE_STATUT: Record<StatutProspectionBase, string> = {
  jamais_contacte: 'Jamais contacté',
  contacte: 'Contacté',
  a_repondu: 'A répondu',
};
const LIBELLE_RESULTAT: Record<string, string> = {
  sans_reponse: 'sans réponse',
  repondu: 'répondu',
  interesse: 'intéressé',
  pas_interesse: 'pas intéressé',
  mauvais_interlocuteur: 'mauvais interlocuteur',
  reponse_auto: 'réponse automatique',
};
const ASTUCE_ENRICHIR =
  "Ces fiches n'ont pas encore de contact (nom et email ou téléphone). Ouvrez une fiche pour le renseigner : une fiche à enrichir n'entre jamais dans un CRM, et devient prête à contacter dès qu'elle a un nom et un moyen de contact valide.";

const libelleZone = (zone: ZoneBase) =>
  zone === 'prospectable' ? (
    <span className="badge green">Prospectable</span>
  ) : (
    <span className="badge amber">À enrichir</span>
  );

// Month and year only: the history is read, never typed, and a day would suggest more precision.
const moisAnnee = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { month: '2-digit', year: 'numeric' }) : 'NA';

const nomComplet = (f: FicheBase) =>
  [f.prenom, f.nom].filter(Boolean).join(' ') || `Contact à trouver chez ${f.entreprise}`;

const detailContact = (f: FicheBase) =>
  [
    moisAnnee(f.dernierContactLe),
    f.dernierContactCanal,
    f.resultat ? (LIBELLE_RESULTAT[f.resultat] ?? f.resultat) : null,
    f.nbContacts > 0 ? `${f.nbContacts} contact${f.nbContacts > 1 ? 's' : ''}` : null,
    f.mandatContacteur,
  ]
    .filter(Boolean)
    .join(' · ');

const choixConformite = (f: FicheBase) =>
  f.opposition ? 'opposition' : f.exclusion ? `exclusion:${f.exclusion}` : '';

function Conformite({ f, onChange }: { f: FicheBase; onChange: (valeur: string) => void }) {
  return (
    <select
      className="input"
      aria-label={`Conformité de ${nomComplet(f)}`}
      value={choixConformite(f)}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      <option value="opposition">Opposition (ne plus contacter)</option>
      <option value="exclusion:client">Exclu : client</option>
      <option value="exclusion:partenaire">Exclu : partenaire</option>
      <option value="exclusion:concurrent">Exclu : concurrent</option>
    </select>
  );
}

const patchConformite = (valeur: string) => ({
  opposition: valeur === 'opposition',
  exclusion: valeur.startsWith('exclusion:')
    ? (valeur.slice('exclusion:'.length) as ExclusionBase)
    : null,
});

function EnrichirFiche({ slug, f, onFait }: { slug: string; f: FicheBase; onFait: () => void }) {
  const [champs, setChamps] = useState({
    prenom: f.prenom ?? '',
    nom: f.nom,
    email: f.email ?? '',
    telephone: f.telephone ?? '',
    fonction: f.fonction ?? '',
  });
  const [occupe, setOccupe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const champ = (cle: keyof typeof champs, libelle: string) => (
    <label className="bv-champ">
      <span className="small muted">{libelle}</span>
      <input
        className="input"
        aria-label={libelle}
        value={champs[cle]}
        onChange={(e) => setChamps({ ...champs, [cle]: e.target.value })}
      />
    </label>
  );
  const enregistrer = async () => {
    setError(null);
    setOccupe(true);
    try {
      await enrichirFicheBase(slug, f.id, champs);
      onFait();
    } catch (e) {
      setError(message(e));
    } finally {
      setOccupe(false);
    }
  };
  return (
    <>
      <h3 className="bv-sous-titre">Enrichir avec un contact</h3>
      {champ('prenom', 'Prénom')}
      {champ('nom', 'Nom')}
      {champ('email', 'Email')}
      {champ('telephone', 'Téléphone')}
      {champ('fonction', 'Fonction')}
      {error && (
        <div className="alert amber">
          <Icon name="info" />
          <div>{error}</div>
        </div>
      )}
      <p>
        <button
          className="btn primary"
          disabled={occupe || !Object.values(champs).some((v) => v.trim())}
          onClick={() => void enregistrer()}
        >
          Enregistrer le contact
        </button>
      </p>
    </>
  );
}

function FicheTiroir({
  slug,
  f,
  onConformite,
  onEnrichi,
  onFermer,
}: {
  slug: string;
  f: FicheBase;
  onConformite: (valeur: string) => void;
  onEnrichi: () => void;
  onFermer: () => void;
}) {
  return (
    <Fenetre
      tiroir
      titre={nomComplet(f)}
      sousTitre={[f.fonction, f.entreprise].filter(Boolean).join(', ')}
      onFermer={onFermer}
    >
      <dl className="bv-fiche">
        <dt>Zone</dt>
        <dd>{libelleZone(f.zone)}</dd>
        <dt>Email</dt>
        <dd>{f.email ?? '—'}</dd>
        <dt>Téléphone</dt>
        <dd>{f.telephone ?? '—'}</dd>
        <dt>Source</dt>
        <dd>
          {f.provenance}
          {f.mandat ? ` · ${f.mandat}` : ''}
        </dd>
        <dt>Conformité</dt>
        <dd>
          <Conformite f={f} onChange={onConformite} />
        </dd>
      </dl>
      {f.zone === 'a_enrichir' && <EnrichirFiche key={f.id} slug={slug} f={f} onFait={onEnrichi} />}
      <h3 className="bv-sous-titre">Historique</h3>
      <p>
        {LIBELLE_STATUT[f.statutProspection]}
        <span className="small muted"> {detailContact(f)}</span>
      </p>
      {f.alertes.map((a) => (
        <div key={a.code}>
          <span className={`badge ${a.bloquante ? 'red' : 'amber'}`}>{a.libelle}</span>
        </div>
      ))}
    </Fenetre>
  );
}

export function BaseTable({
  slug,
  etat,
  filtres,
  onFiltres,
  page,
  onPage,
  onChange,
  onImporter,
}: {
  slug: string;
  etat: EtatBase;
  filtres: FiltresBaseWeb;
  onFiltres: (f: FiltresBaseWeb) => void;
  page: number;
  onPage: (p: number) => void;
  onChange: () => void;
  onImporter: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [ouverte, setOuverte] = useState<string | null>(null);
  const total = etat.compteurs.aEnrichir + etat.compteurs.prospectable;

  // A selection never outlives the rows it was made on.
  useEffect(() => setSelection(new Set()), [etat.fiches]);

  const filtrer = (f: FiltresBaseWeb) => {
    onFiltres({ ...filtres, ...f });
    onPage(0);
  };
  const actif =
    ONGLETS.find((o) => o.zone === filtres.zone && o.statut === filtres.statut)?.id ?? null;

  const agir = async (f: () => Promise<void>) => {
    setError(null);
    setOccupe(true);
    try {
      await f();
    } catch (e) {
      setError(message(e));
    } finally {
      setOccupe(false);
    }
  };

  const conformite = (ids: string[], valeur: string) =>
    agir(async () => {
      for (const id of ids) await majConformiteBase(slug, id, patchConformite(valeur));
      onChange();
    });

  const basculer = (id: string) =>
    setSelection((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const toutesCochees = etat.fiches.length > 0 && selection.size === etat.fiches.length;
  const fiche = etat.fiches.find((f) => f.id === ouverte);

  return (
    <section className="bv-liste" aria-label="Fiches de la base">
      <div className="bv-onglets" role="tablist">
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            role="tab"
            aria-selected={actif === o.id}
            className="bv-onglet"
            onClick={() => filtrer({ zone: o.zone, statut: o.statut })}
          >
            {o.libelle}
          </button>
        ))}
      </div>
      {actif === 'a_enrichir' && (
        <div className="bv-astuce">
          <Icon name="info" />
          <span>{ASTUCE_ENRICHIR}</span>
        </div>
      )}
      <div className="bv-outils">
        <select
          className="input"
          aria-label="Filtrer par alerte"
          value={filtres.alerte ?? ''}
          onChange={(e) => filtrer({ alerte: (e.target.value || undefined) as AlerteBase })}
        >
          {ALERTES.map(([v, libelle]) => (
            <option key={libelle} value={v ?? ''}>
              {libelle}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Filtrer par source"
          value={filtres.provenance ?? ''}
          onChange={(e) => filtrer({ provenance: e.target.value || undefined })}
        >
          <option value="">Toutes sources</option>
          {etat.provenances.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="bv-compte small muted">
          {entier(etat.total)} fiche{etat.total > 1 ? 's' : ''}
        </span>
      </div>
      {error && (
        <div className="alert amber">
          <Icon name="info" />
          <div>{error}</div>
        </div>
      )}
      {etat.fiches.length === 0 ? (
        <div className="empty">
          {total === 0 ? (
            <>
              La base est vide : importez une première liste.
              <p>
                <button className="btn primary" onClick={onImporter}>
                  Importer une liste
                </button>
              </p>
            </>
          ) : (
            'Aucune fiche ne correspond. Essayez un autre mot ou retirez un filtre.'
          )}
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
                    checked={toutesCochees}
                    onChange={() =>
                      setSelection(
                        toutesCochees ? new Set() : new Set(etat.fiches.map((f) => f.id)),
                      )
                    }
                  />
                </th>
                <th>Contact</th>
                <th>Entreprise</th>
                <th>Coordonnées</th>
                <th>Dernier contact</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {etat.fiches.map((f) => (
                <tr
                  key={f.id}
                  className={selection.has(f.id) ? 'coche' : ''}
                  onClick={() => setOuverte(f.id)}
                >
                  <td className="bv-case" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${nomComplet(f)}`}
                      checked={selection.has(f.id)}
                      onChange={() => basculer(f.id)}
                    />
                  </td>
                  <td>
                    <button className="bv-lien" onClick={() => setOuverte(f.id)}>
                      {nomComplet(f)}
                    </button>
                    <div className="small muted">{f.fonction ?? ''}</div>
                  </td>
                  <td>{f.entreprise}</td>
                  <td>
                    {f.email ?? <span className="muted">Pas d'email</span>}
                    <div className="small muted">{f.telephone ?? ''}</div>
                  </td>
                  <td>
                    {LIBELLE_STATUT[f.statutProspection]}
                    <div className="small muted">{detailContact(f)}</div>
                  </td>
                  <td>
                    {libelleZone(f.zone)}
                    {f.alertes.map((a) => (
                      <div key={a.code}>
                        <span className={`badge ${a.bloquante ? 'red' : 'amber'}`}>
                          {a.libelle}
                        </span>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {etat.total > PAR_PAGE && (
        <div className="bv-pied">
          <button
            className="btn sm"
            disabled={page === 0}
            onClick={() => onPage(Math.max(0, page - 1))}
          >
            Précédent
          </button>
          <span className="small muted">
            {entier(page * PAR_PAGE + 1)}–{entier(Math.min(etat.total, (page + 1) * PAR_PAGE))} sur{' '}
            {entier(etat.total)}
          </span>
          <button
            className="btn sm"
            disabled={(page + 1) * PAR_PAGE >= etat.total}
            onClick={() => onPage(page + 1)}
          >
            Suivant
          </button>
        </div>
      )}

      {selection.size > 0 && (
        <div className="bv-selection" role="region" aria-label="Actions sur la sélection">
          <strong>
            {selection.size} sélectionnée{selection.size > 1 ? 's' : ''}
          </strong>
          <button
            className="btn sm"
            disabled={occupe}
            onClick={() => void conformite([...selection], 'opposition')}
          >
            Ne plus contacter
          </button>
          <select
            className="input"
            aria-label="Exclure la sélection comme"
            value=""
            disabled={occupe}
            onChange={(e) => e.target.value && void conformite([...selection], e.target.value)}
          >
            <option value="">Exclure comme…</option>
            <option value="exclusion:client">Client</option>
            <option value="exclusion:partenaire">Partenaire</option>
            <option value="exclusion:concurrent">Concurrent</option>
          </select>
          <button
            className="bv-fermer clair"
            aria-label="Désélectionner"
            onClick={() => setSelection(new Set())}
          >
            ×
          </button>
        </div>
      )}

      {fiche && (
        <FicheTiroir
          slug={slug}
          f={fiche}
          onEnrichi={() => {
            setOuverte(null);
            onChange();
          }}
          onFermer={() => setOuverte(null)}
          onConformite={(v) => void conformite([fiche.id], v)}
        />
      )}
    </section>
  );
}
