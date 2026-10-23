import { useState } from 'react';
import {
  actualiserHistoriqueBase,
  majConformiteBase,
  urlExportBase,
  type AlerteBase,
  type EtatBase,
  type ExclusionBase,
  type FicheBase,
  type FiltresBaseWeb,
  type StatutProspectionBase,
  type ZoneBase,
} from '../api.js';
import { Icon } from '../icons.js';

export const PAR_PAGE = 50;
const entier = (n: number) => n.toLocaleString('fr-FR');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const ZONES: [ZoneBase | undefined, string][] = [
  [undefined, 'Toutes'],
  ['prospectable', 'Prospectables'],
  ['a_enrichir', 'À enrichir'],
];
const STATUTS: [StatutProspectionBase | undefined, string][] = [
  [undefined, 'Tous statuts'],
  ['jamais_contacte', 'Jamais contactés'],
  ['contacte', 'Contactés'],
  ['a_repondu', 'Ont répondu'],
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

const libelleZone = (zone: ZoneBase) =>
  zone === 'prospectable' ? (
    <span className="badge green">Prospectable</span>
  ) : (
    <span className="badge amber">À enrichir</span>
  );

// Month and year only: the history is read, never typed, and a day would suggest more precision.
const moisAnnee = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { month: '2-digit', year: 'numeric' }) : 'NA';

const choixConformite = (f: FicheBase) =>
  f.opposition ? 'opposition' : f.exclusion ? `exclusion:${f.exclusion}` : '';

function Conformite({ f, onChange }: { f: FicheBase; onChange: (valeur: string) => void }) {
  return (
    <select
      className="input"
      aria-label={`Conformité de ${f.prenom ?? ''} ${f.nom}`}
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

export function BaseTable({
  slug,
  etat,
  filtres,
  onFiltres,
  page,
  onPage,
  onChange,
}: {
  slug: string;
  etat: EtatBase;
  filtres: FiltresBaseWeb;
  onFiltres: (f: FiltresBaseWeb) => void;
  page: number;
  onPage: (p: number) => void;
  onChange: () => void;
}) {
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const total = etat.compteurs.aEnrichir + etat.compteurs.prospectable;
  const filtrer = (f: FiltresBaseWeb) => {
    onFiltres({ ...filtres, ...f });
    onPage(0);
  };

  const agir = async (f: () => Promise<void>) => {
    setError(null);
    setInfo(null);
    setOccupe(true);
    try {
      await f();
    } catch (e) {
      setError(message(e));
    } finally {
      setOccupe(false);
    }
  };

  const actualiser = () =>
    agir(async () => {
      const r = await actualiserHistoriqueBase(slug);
      setInfo(
        `${entier(r.verifiees)} adresses vérifiées dans les CRM, ${entier(r.trouvees)} déjà connues.`,
      );
      onChange();
    });

  const conformite = (f: FicheBase, valeur: string) =>
    agir(async () => {
      const exclusion = valeur.startsWith('exclusion:')
        ? (valeur.slice('exclusion:'.length) as ExclusionBase)
        : null;
      await majConformiteBase(slug, f.id, { opposition: valeur === 'opposition', exclusion });
      onChange();
    });

  return (
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>Base vivante</h2>
          <div className="small muted">
            {entier(total)} fiches : {entier(etat.compteurs.prospectable)} prospectables,{' '}
            {entier(etat.compteurs.aEnrichir)} à enrichir. Une fiche à enrichir n'entre jamais dans
            un CRM.
          </div>
        </div>
        <div className="sw-actions">
          <button
            className="btn sm"
            disabled={occupe || total === 0}
            onClick={() => void actualiser()}
          >
            Actualiser l'historique
          </button>{' '}
          <a className="btn sm" href={urlExportBase(slug, filtres)} download>
            Exporter en CSV
          </a>
        </div>
      </div>
      <div className="panel-b">
        <div className="chips">
          {ZONES.map(([z, libelle]) => (
            <button
              key={libelle}
              className={`chip ${filtres.zone === z ? 'on' : ''}`}
              onClick={() => filtrer({ zone: z })}
            >
              {libelle}
            </button>
          ))}
        </div>
        <div className="chips">
          <select
            className="input"
            style={{ maxWidth: 190 }}
            aria-label="Filtrer par statut"
            value={filtres.statut ?? ''}
            onChange={(e) =>
              filtrer({
                statut: (e.target.value || undefined) as StatutProspectionBase | undefined,
              })
            }
          >
            {STATUTS.map(([v, libelle]) => (
              <option key={libelle} value={v ?? ''}>
                {libelle}
              </option>
            ))}
          </select>
          <select
            className="input"
            style={{ maxWidth: 260 }}
            aria-label="Filtrer par alerte"
            value={filtres.alerte ?? ''}
            onChange={(e) =>
              filtrer({ alerte: (e.target.value || undefined) as AlerteBase | undefined })
            }
          >
            {ALERTES.map(([v, libelle]) => (
              <option key={libelle} value={v ?? ''}>
                {libelle}
              </option>
            ))}
          </select>
          <select
            className="input"
            style={{ maxWidth: 190 }}
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
          <input
            className="input"
            style={{ maxWidth: 260 }}
            aria-label="Rechercher dans la base"
            placeholder="Entreprise, nom, email…"
            value={filtres.q ?? ''}
            onChange={(e) => filtrer({ q: e.target.value })}
          />
        </div>
        {info && <div className="small muted">{info}</div>}
        {error && (
          <div className="alert amber">
            <Icon name="info" />
            <div>{error}</div>
          </div>
        )}
        {etat.fiches.length === 0 ? (
          <div className="empty">
            {total === 0
              ? 'La base est vide : importez une première liste.'
              : 'Aucune fiche ne correspond.'}
          </div>
        ) : (
          <div className="mapping-scroll">
            <table className="tbl small">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Contact</th>
                  <th>Fonction</th>
                  <th>Email</th>
                  <th>Téléphone</th>
                  <th>Zone</th>
                  <th>Dernier contact</th>
                  <th>Alertes</th>
                  <th>Conformité</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {etat.fiches.map((f) => (
                  <tr key={f.id}>
                    <td>{f.entreprise}</td>
                    <td>{[f.prenom, f.nom].filter(Boolean).join(' ')}</td>
                    <td>{f.fonction ?? '—'}</td>
                    <td>{f.email ?? '—'}</td>
                    <td>{f.telephone ?? '—'}</td>
                    <td>{libelleZone(f.zone)}</td>
                    <td>
                      {LIBELLE_STATUT[f.statutProspection]}
                      <div className="small muted">
                        {moisAnnee(f.dernierContactLe)}
                        {f.dernierContactCanal ? ` · ${f.dernierContactCanal}` : ''}
                        {f.resultat ? ` · ${LIBELLE_RESULTAT[f.resultat] ?? f.resultat}` : ''}
                        {f.nbContacts > 0
                          ? ` · ${f.nbContacts} contact${f.nbContacts > 1 ? 's' : ''}`
                          : ''}
                        {f.mandatContacteur ? ` · ${f.mandatContacteur}` : ''}
                      </div>
                    </td>
                    <td>
                      {f.alertes.length === 0 && <span className="muted">—</span>}
                      {f.alertes.map((a) => (
                        <div key={a.code}>
                          <span className={`badge ${a.bloquante ? 'red' : 'amber'}`}>
                            {a.libelle}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td>
                      <Conformite f={f} onChange={(v) => void conformite(f, v)} />
                    </td>
                    <td>
                      {f.provenance}
                      {f.mandat && <div className="small muted">{f.mandat}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {etat.total > PAR_PAGE && (
          <div className="chips">
            <button
              className="btn sm"
              disabled={page === 0}
              onClick={() => onPage(Math.max(0, page - 1))}
            >
              Précédent
            </button>
            <span className="small muted">
              {entier(page * PAR_PAGE + 1)}–{entier(Math.min(etat.total, (page + 1) * PAR_PAGE))}{' '}
              sur {entier(etat.total)}
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
      </div>
    </div>
  );
}
