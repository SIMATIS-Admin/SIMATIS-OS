import { OrigineContact } from './OrigineContact.js';
import { emailGenerique, normaliserLinkedin } from '../../../src/base-vivante/nettoyage.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  enrichirFicheBase,
  etatEnrichissement,
  majConformiteBase,
  supprimerFichesBase,
  type AlerteBase,
  type EtatBase,
  type EtatEnrichissement,
  type ExclusionBase,
  type FicheBase,
  type FiltresBaseWeb,
  type StatutProspectionBase,
} from '../api.js';
import { Icon } from '../icons.js';
import { LancerEnrichissement, SuggestionsEnrichissement } from './EnrichissementIA.js';
import { Fenetre } from './Fenetre.js';

export const PAR_PAGE = 50;
const entier = (n: number) => n.toLocaleString('fr-FR');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Chaque onglet applique ses filtres à la même liste.
const ONGLETS: (Pick<FiltresBaseWeb, 'canal' | 'zone' | 'statut'> & {
  id: string;
  libelle: string;
})[] = [
  { id: 'a_enrichir', libelle: 'À enrichir', zone: 'a_enrichir' },
  { id: 'email', libelle: 'À prospecter par e-mail', canal: 'email' },
  { id: 'linkedin', libelle: 'À prospecter sur LinkedIn', canal: 'linkedin' },
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

export const libelleZone = (
  f: Pick<FicheBase, 'zone' | 'nom' | 'linkedin' | 'email' | 'emailInvalide'>,
) =>
  f.nom &&
  normaliserLinkedin(f.linkedin) &&
  (!f.email || f.emailInvalide || emailGenerique(f.email)) ? (
    <span className="badge linkedin">LinkedIn</span>
  ) : f.zone === 'prospectable' ? (
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
    linkedin: f.linkedin ?? '',
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
      {champ('linkedin', 'Profil LinkedIn')}
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
  onSupprimer,
  occupe,
  onEnrichi,
  onFermer,
}: {
  slug: string;
  f: FicheBase;
  onConformite: (valeur: string) => void;
  onSupprimer: () => void;
  occupe: boolean;
  onEnrichi: () => void;
  onFermer: () => void;
}) {
  return (
    <Fenetre
      tiroir
      titre={nomComplet(f)}
      sousTitre={[f.fonction, f.entreprise].filter(Boolean).join(', ')}
      pied={
        <button className="btn" disabled={occupe} onClick={onSupprimer}>
          Supprimer la fiche
        </button>
      }
      onFermer={onFermer}
    >
      <dl className="bv-fiche">
        <dt>Zone</dt>
        <dd>{libelleZone(f)}</dd>
        <dt>Email</dt>
        <dd>{f.email ?? '—'}</dd>
        {f.emailEntreprise && (
          <>
            <dt>E-mail général de {f.entreprise}</dt>
            <dd>{f.emailEntreprise}</dd>
          </>
        )}
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
  recherche,
}: {
  slug: string;
  etat: EtatBase;
  filtres: FiltresBaseWeb;
  onFiltres: (f: FiltresBaseWeb) => void;
  page: number;
  onPage: (p: number) => void;
  onChange: () => void;
  onImporter: () => void;
  recherche?: ReactNode;
}) {
  const [note, setNote] = useState<FicheBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const fichesPrecedentes = useRef(etat.fiches);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [ia, setIa] = useState<EtatEnrichissement | null>(null);
  const [lancement, setLancement] = useState(false);
  const [tacheIa, setTacheIa] = useState<string | null>(null);
  const total = etat.compteurs.total ?? etat.compteurs.aEnrichir + etat.compteurs.prospectable;

  // L'enrichissement par IA n'apparaît que si le serveur a une clé OpenAI.
  useEffect(() => {
    let actif = true;
    etatEnrichissement(slug).then(
      (e) => actif && setIa(e),
      () => undefined,
    );
    return () => {
      actif = false;
    };
  }, [slug, tacheIa]);

  // A selection never outlives the rows it was made on.
  useEffect(() => {
    if (fichesPrecedentes.current !== etat.fiches) setSelection(new Set());
    fichesPrecedentes.current = etat.fiches;
  }, [etat.fiches]);

  const filtrer = (f: FiltresBaseWeb) => {
    onFiltres({ ...filtres, ...f });
    onPage(0);
  };
  const baseComplete =
    !filtres.zone && !filtres.canal && (filtres.tri !== undefined || !filtres.statut);
  const actif = baseComplete
    ? 'tous'
    : (ONGLETS.find(
        (o) => o.zone === filtres.zone && o.statut === filtres.statut && o.canal === filtres.canal,
      )?.id ?? null);

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

  const supprimer = (ids: string[], confirmation: string) => {
    if (!window.confirm(confirmation)) return;
    void agir(async () => {
      await supprimerFichesBase(slug, ids);
      if (ouverte && ids.includes(ouverte)) setOuverte(null);
      setSelection(new Set());
      if (page > 0 && ids.length === etat.fiches.length) onPage(page - 1);
      else onChange();
    });
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
      <div className="panel-h bv-liste-entete">
        <h2>Contacts</h2>
        <span className="small muted">
          {entier(etat.total)} fiche{etat.total > 1 ? 's' : ''} affichée{etat.total > 1 ? 's' : ''}
        </span>
      </div>
      <div className="bv-onglets" role="tablist" aria-label="Vues des contacts">
        <button
          role="tab"
          aria-selected={baseComplete}
          className="bv-onglet"
          onClick={() => {
            onFiltres({ tri: 'entreprise' });
            onPage(0);
          }}
        >
          Base complète ({entier(total)})
        </button>
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            role="tab"
            aria-label={o.id === 'email' || o.id === 'linkedin' ? o.libelle : undefined}
            aria-selected={actif === o.id}
            className="bv-onglet"
            onClick={() =>
              filtrer({ zone: o.zone, statut: o.statut, canal: o.canal, tri: undefined })
            }
          >
            {o.id === 'email' ? 'E-mail' : o.id === 'linkedin' ? 'LinkedIn' : o.libelle}
            {o.id === 'a_enrichir' && ` (${entier(etat.compteurs.aEnrichir)})`}
          </button>
        ))}
      </div>
      {actif === 'a_enrichir' && (
        <details className="bv-aide">
          <summary>
            <Icon name="info" />
            Comment enrichir les fiches ?
          </summary>
          <p>{ASTUCE_ENRICHIR}</p>
        </details>
      )}
      <div className="bv-outils">
        {recherche}
        <details className="bv-filtres">
          <summary className="btn sm">
            <Icon name="sliders" />
            Filtres et tri
            {filtres.alerte || filtres.provenance || (baseComplete && filtres.statut)
              ? ' · actifs'
              : ''}
          </summary>
          <div className="bv-filtres-options">
            {baseComplete && (
              <>
                <select
                  className="input"
                  aria-label="Trier les fiches"
                  value={filtres.tri ?? 'entreprise'}
                  onChange={(e) => filtrer({ tri: e.target.value as FiltresBaseWeb['tri'] })}
                >
                  <option value="entreprise">Entreprise (A–Z)</option>
                  <option value="tentatives">Plus de tentatives</option>
                  <option value="dernier_contact">Dernier contact récent</option>
                </select>
                <select
                  className="input"
                  aria-label="Filtrer par statut de prospection"
                  value={filtres.statut ?? ''}
                  onChange={(e) =>
                    filtrer({ statut: (e.target.value || undefined) as StatutProspectionBase })
                  }
                >
                  <option value="">Tous les statuts</option>
                  {Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => (
                    <option key={valeur} value={valeur}>
                      {libelle}
                    </option>
                  ))}
                </select>
              </>
            )}
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
          </div>
        </details>
      </div>
      {selection.size > 0 && (
        <div className="bv-selection" role="region" aria-label="Actions sur la sélection">
          <strong>
            {selection.size} sélectionnée{selection.size > 1 ? 's' : ''}
          </strong>
          {ia?.disponible && (
            <button className="btn sm" disabled={occupe} onClick={() => setLancement(true)}>
              Rechercher avec Codex
            </button>
          )}
          <button
            className="btn sm"
            disabled={occupe}
            onClick={() => void conformite([...selection], 'opposition')}
          >
            Ne plus contacter
          </button>
          <button
            className="btn sm"
            disabled={occupe}
            onClick={() =>
              supprimer(
                [...selection],
                `Supprimer les fiches sélectionnées (${selection.size}) de la Base vivante ?`,
              )
            }
          >
            Supprimer la sélection
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
                {baseComplete && <th>Tentatives</th>}
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
                      aria-label={`Sélectionner ${f.nom ? nomComplet(f) : f.entreprise}`}
                      checked={selection.has(f.id)}
                      onChange={() => basculer(f.id)}
                    />
                  </td>
                  <td>
                    <button className="bv-lien" onClick={() => setOuverte(f.id)}>
                      {nomComplet(f)}
                    </button>
                    <div className="small muted bv-fonction" title={f.fonction ?? undefined}>
                      {f.fonction ?? ''}
                    </div>
                    <button
                      className="bv-note"
                      aria-label={`Note d’origine de ${nomComplet(f)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setNote(f);
                      }}
                    >
                      <Icon name="info" /> Note d’origine
                    </button>
                  </td>
                  <td>{f.entreprise}</td>
                  <td>
                    {f.email ?? <span className="muted">Pas d'email</span>}
                    <div className="small muted">{f.telephone ?? ''}</div>
                    {f.linkedin &&
                      /^https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/in\/[^ /]+/i.test(f.linkedin) && (
                        <a
                          href={f.linkedin}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Profil LinkedIn
                        </a>
                      )}
                  </td>
                  <td>
                    {LIBELLE_STATUT[f.statutProspection]}
                    <div className="small muted">{detailContact(f)}</div>
                  </td>
                  {baseComplete && <td>{entier(f.nbContacts)}</td>}
                  <td>
                    {libelleZone(f)}
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

      {ia?.disponible && ia.tacheEnCours && !tacheIa && (
        <div className="bv-astuce">
          <Icon name="info" />
          <span>Un enrichissement est en cours.</span>
          <button className="btn sm" onClick={() => setTacheIa(ia.tacheEnCours)}>
            Suivre l'enrichissement
          </button>
        </div>
      )}
      {lancement && ia && (
        <LancerEnrichissement
          slug={slug}
          ficheIds={[...selection]}
          lotMax={ia.lotMax}
          onFermer={() => setLancement(false)}
          onLance={(id) => {
            setLancement(false);
            setTacheIa(id);
          }}
        />
      )}
      {tacheIa && (
        <SuggestionsEnrichissement
          slug={slug}
          tacheId={tacheIa}
          onFini={() => {
            setTacheIa(null);
            onChange();
          }}
        />
      )}

      {note && (
        <OrigineContact
          slug={slug}
          id={note.id}
          nom={nomComplet(note)}
          fermer={() => setNote(null)}
        />
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
          occupe={occupe}
          onSupprimer={() =>
            supprimer(
              [fiche.id],
              `Supprimer la fiche « ${nomComplet(fiche)} » de la Base vivante ?`,
            )
          }
          onConformite={(v) => void conformite([fiche.id], v)}
        />
      )}
    </section>
  );
}
