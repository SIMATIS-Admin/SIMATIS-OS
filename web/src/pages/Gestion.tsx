import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  archiverDepenseGestion,
  archiverRevenuGestion,
  fetchRevenus,
  type RevenuGestion,
  type SyntheseRevenus,
  fetchDepenseGestion,
  fetchDepenses,
  occurrenceDepenseGestion,
  type OccurrenceDepense,
  type SyntheseDepenses,
} from '../api.js';
import {
  aujourdhui,
  eurCents,
  jourCourt,
  libelleMois,
  moisDecale,
  MOIS,
  MOIS_COURTS,
} from '../gestion.js';
import { Icon } from '../icons.js';
import { GestionTiroir, type CibleTiroir } from './GestionTiroir.js';
import { ETATS_REVENU, GestionRevenuTiroir, TYPES_REVENU } from './GestionRevenuTiroir.js';

type Onglet = 'vue' | 'depenses' | 'revenus' | 'tresorerie' | 'ik' | 'tva';
const ONGLETS: [Onglet, string][] = [
  ['vue', 'Vue d’ensemble'],
  ['depenses', 'Dépenses'],
  ['revenus', 'Revenus & facturation'],
  ['tresorerie', 'Trésorerie'],
  ['ik', 'IK & compte associé'],
  ['tva', 'TVA'],
];
// Écrans suivants : annoncés, jamais simulés avec des chiffres.
const PREVU: Partial<Record<Onglet, [string, string]>> = {
  tresorerie: ['Lot C', 'Échéancier, scénarios et projection de trésorerie.'],
  ik: ['Lot D', 'Trajets, barème versionné et compte courant d’associé.'],
  tva: ['Lot C', 'Suivi mensuel de la TVA, exigibilité à confirmer avec le comptable.'],
};
type Filtre = 'toutes' | 'recurrentes' | 'ponctuelles' | 'previsionnelles';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Section Gestion, réservée à « Mon activité ». `autorise` vient de l'instance courante ; le serveur
// refuse de toute façon les autres espaces.
export function Gestion({
  slug,
  autorise,
  mandats,
}: {
  slug: string;
  autorise: boolean;
  mandats: { slug: string; nom: string }[];
}) {
  const [onglet, setOnglet] = useState<Onglet>('vue');
  const [mois, setMois] = useState(() => aujourdhui().slice(0, 7));
  const [donnees, setDonnees] = useState<{
    synthese: SyntheseDepenses;
    occurrences: OccurrenceDepense[];
  } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tiroir, setTiroir] = useState<{ cible: CibleTiroir; duplique?: boolean } | null>(null);
  const [recettes, setRecettes] = useState<{
    synthese: SyntheseRevenus;
    revenus: RevenuGestion[];
  } | null>(null);
  const [tiroirRevenu, setTiroirRevenu] = useState<{ revenu?: RevenuGestion } | null>(null);
  const [filtre, setFiltre] = useState<Filtre>('toutes');
  const [affectation, setAffectation] = useState('');
  const [refacturables, setRefacturables] = useState(false);
  const [recherche, setRecherche] = useState('');

  const charger = useCallback(async () => {
    try {
      setErreur(null);
      const [d, r] = await Promise.all([fetchDepenses(slug, mois), fetchRevenus(slug, mois)]);
      setDonnees(d);
      setRecettes(r);
    } catch (e) {
      setErreur(message(e));
    }
  }, [slug, mois]);

  useEffect(() => {
    if (autorise) void charger();
  }, [autorise, charger]);

  // Touche N : nouvelle dépense, sauf pendant une saisie.
  useEffect(() => {
    if (!autorise) return;
    const sur = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !tiroir) {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
        e.preventDefault();
        setTiroir({ cible: {} });
      }
      if (e.key === 'Escape') setTiroir(null);
    };
    window.addEventListener('keydown', sur);
    return () => window.removeEventListener('keydown', sur);
  }, [autorise, tiroir]);

  const nomAff = useCallback(
    (a: { cible: string; mandat?: string }) =>
      a.cible === 'simatis'
        ? 'SIMATIS'
        : a.cible === 'kairos'
          ? 'KAIROS'
          : (mandats.find((m) => m.slug === a.mandat)?.nom ?? a.mandat ?? 'Mandat'),
    [mandats],
  );

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (donnees?.occurrences ?? []).filter((o) => {
      if (filtre === 'recurrentes' && !o.recurrente) return false;
      if (filtre === 'ponctuelles' && o.recurrente) return false;
      if (filtre === 'previsionnelles' && o.etat !== 'a_venir') return false;
      if (affectation && !o.affectations.some((a) => nomAff(a) === affectation)) return false;
      if (refacturables && !o.refacturable) return false;
      return (
        !q ||
        `${o.libelle} ${o.categorie ?? ''} ${o.affectations.map(nomAff).join(' ')}`
          .toLowerCase()
          .includes(q)
      );
    });
  }, [donnees, filtre, affectation, refacturables, recherche, nomAff]);

  if (!autorise)
    return <p className="empty">Cette section n’est pas disponible dans cet espace.</p>;

  const ouvrir = async (o: OccurrenceDepense, duplique = false) => {
    try {
      const depense = await fetchDepenseGestion(slug, o.depenseId);
      setTiroir({
        cible: { depense, occurrence: o.recurrente ? o.cle.split('|')[1] : undefined },
        duplique,
      });
    } catch (e) {
      setErreur(message(e));
    }
  };
  const ignorer = async (o: OccurrenceDepense) => {
    try {
      if (o.recurrente)
        await occurrenceDepenseGestion(slug, o.depenseId, o.cle.split('|')[1]!, {
          portee: 'cette',
          etat: 'ignoree',
        });
      else await archiverDepenseGestion(slug, o.depenseId);
      await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };
  const s = donnees?.synthese;
  const aMois = (m: string) => {
    setMois(m);
  };
  const cheminDuMois = (
    <div className="g-periode">
      <button
        className="btn ghost sm"
        aria-label="Mois précédent"
        onClick={() => aMois(moisDecale(mois, -1))}
      >
        ‹
      </button>
      <b>{libelleMois(mois)}</b>
      <button
        className="btn ghost sm"
        aria-label="Mois suivant"
        onClick={() => aMois(moisDecale(mois, 1))}
      >
        ›
      </button>
    </div>
  );

  const vue = (
    <>
      <div className="g-niveaux">
        <div className="panel kpi">
          <span className="g-ic">
            <Icon name="wallet" />
          </span>
          <div>
            <span className="l">Dépenses TTC en {MOIS[Number(mois.slice(5)) - 1]}</span>
            <span className="v num">{s ? eurCents(s.totalCents) : '–'}</span>
            <span className="g-duo">
              <span>
                <i /> {s ? eurCents(s.payeCents) : '–'} payé
              </span>
              <span>
                <i className="prev" /> {s ? eurCents(s.aVenirCents) : '–'} à venir
              </span>
            </span>
          </div>
        </div>
        <div className="panel kpi">
          <span className="g-ic">
            <Icon name="clock" />
          </span>
          <div>
            <span className="l">Charges récurrentes / mois</span>
            <span className="v num">{s ? eurCents(s.recurrentMensuelCents) : '–'}</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setFiltre('recurrentes');
                setOnglet('depenses');
              }}
            >
              Voir les récurrentes
            </a>
          </div>
        </div>
        <div className="panel kpi">
          <span className="g-ic">
            <Icon name="chart" />
          </span>
          <div>
            <span className="l">Revenus à encaisser (HT)</span>
            <span className="v num">
              {recettes ? eurCents(recettes.synthese.aEncaisserCents) : '–'}
            </span>
            <span className="g-duo">
              <span>
                <i /> {recettes ? eurCents(recettes.synthese.encaisseCents) : '–'} encaissé
              </span>
            </span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setOnglet('revenus');
              }}
            >
              Voir les recettes
            </a>
          </div>
        </div>
        {(
          [
            ['Trésorerie fin de mois', 'Lot C'],
            ['TVA du mois', 'Lot C'],
          ] as const
        ).map(([k, lot]) => (
          <div className="panel kpi" key={k}>
            <span className="g-ic">
              <Icon name="chart" />
            </span>
            <div>
              <span className="l">{k}</span>
              <span className="v vide">Non renseigné</span>
              <span className="g-maj">Arrive avec le {lot}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-h">
          <h2>Dépenses des 12 prochains mois</h2>
          {cheminDuMois}
        </div>
        <div className="panel-b">
          {s && s.parMois12.some((m) => m.cents) ? (
            <div className="g-barres">
              {(() => {
                const max = Math.max(...s.parMois12.map((m) => m.cents), 1);
                return s.parMois12.map((m) => (
                  <div key={m.mois} title={`${libelleMois(m.mois)} : ${eurCents(m.cents)}`}>
                    <span style={{ height: `${Math.max(2, (m.cents / max) * 100)}%` }} />
                    {MOIS_COURTS[Number(m.mois.slice(5)) - 1]}
                  </div>
                ));
              })()}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Aucune dépense sur cette période. Ajoutez-en une pour voir son effet ici.
            </p>
          )}
        </div>
      </div>
    </>
  );

  const depenses = (
    <>
      <div className="panel g-bandeau-tri" style={{ marginBottom: 18 }}>
        <div>
          <span className="small muted">Payé en {MOIS[Number(mois.slice(5)) - 1]}</span>
          <span className="v num">{s ? eurCents(s.payeCents) : '–'}</span>
        </div>
        <div>
          <span className="small muted">À venir d’ici fin de mois</span>
          <span className="v num">{s ? eurCents(s.aVenirCents) : '–'}</span>
        </div>
        <div>
          <span className="small muted">Total TTC du mois</span>
          <span className="v num">{s ? eurCents(s.totalCents) : '–'}</span>
        </div>
        <div>
          <span className="small muted">Charges récurrentes / mois</span>
          <span className="v num">{s ? eurCents(s.recurrentMensuelCents) : '–'}</span>
        </div>
      </div>
      <div className="panel">
        <div className="g-filtres">
          {(
            [
              ['toutes', 'Toutes'],
              ['recurrentes', 'Récurrentes'],
              ['ponctuelles', 'Ponctuelles'],
              ['previsionnelles', 'Prévisionnelles'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              className={`chip ${filtre === k ? 'on' : ''}`}
              onClick={() => setFiltre(k)}
            >
              {l}
            </button>
          ))}
          <span className="g-sep" />
          <select
            className="input"
            aria-label="Affectation"
            value={affectation}
            onChange={(e) => setAffectation(e.target.value)}
          >
            <option value="">Toutes les affectations</option>
            {['SIMATIS', 'KAIROS', ...mandats.map((m) => m.nom)].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <button
            className={`chip ${refacturables ? 'on' : ''}`}
            aria-pressed={refacturables}
            onClick={() => setRefacturables(!refacturables)}
          >
            Refacturables
          </button>
          <span style={{ flex: 1 }} />
          {cheminDuMois}
          <input
            className="input"
            type="search"
            placeholder="Rechercher une dépense"
            aria-label="Rechercher"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        {visibles.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Dépense</th>
                <th>État</th>
                <th>Affectée à</th>
                <th>Refacturable</th>
                <th className="r">Montant TTC</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((o) => (
                <tr
                  key={o.cle}
                  className={`click ${o.etat === 'ignoree' ? 'muted' : ''}`}
                  onClick={() => void ouvrir(o)}
                >
                  <td className="num">{jourCourt(o.date)}</td>
                  <td className="g-lib">
                    <b>{o.libelle}</b>
                    <small>
                      {o.categorie ?? 'Sans catégorie'}
                      {o.payeur === 'associe' ? ' · avancé par l’associé' : ''}
                    </small>
                  </td>
                  <td>
                    <span
                      className={`badge ${o.etat === 'payee' ? 'green' : o.etat === 'ignoree' ? '' : 'amber'}`}
                    >
                      {o.etat === 'payee' ? 'Payée' : o.etat === 'ignoree' ? 'Ignorée' : 'Prévue'}
                    </span>{' '}
                    {o.recurrente && <span className="badge">Récurrente</span>}
                  </td>
                  <td>
                    <span className="g-aff">
                      {o.affectations.map((a) => (
                        <span className="badge" key={`${a.cible}${a.mandat ?? ''}`}>
                          {nomAff(a)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>
                    {o.refacturable ? (
                      <span
                        className="badge blue"
                        title="Intention de refacturer, pas encore une recette"
                      >
                        Refacturable
                      </span>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                  <td className="r num">
                    <b>{eurCents(o.montantTtcCents)}</b>
                  </td>
                  <td className="g-act" onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost sm" onClick={() => void ouvrir(o, true)}>
                      Dupliquer
                    </button>
                    <button className="btn ghost sm" onClick={() => void ignorer(o)}>
                      {o.recurrente ? 'Ignorer' : 'Supprimer'}
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={5} className="r">
                  <b>Total affiché</b>
                </td>
                <td className="r num">
                  <b>
                    {eurCents(
                      visibles
                        .filter((o) => o.etat !== 'ignoree')
                        .reduce((t, o) => t + o.montantTtcCents, 0),
                    )}
                  </b>
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="panel-b">
            <p className="muted" style={{ margin: 0 }}>
              Aucune dépense ne correspond.{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setTiroir({ cible: {} });
                }}
              >
                Ajouter une dépense
              </a>
            </p>
          </div>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Cliquer une ligne pour la modifier. Touche <b>N</b> : nouvelle dépense.
      </p>
    </>
  );

  const nomMandat = (m: string | null) =>
    m ? (mandats.find((x) => x.slug === m)?.nom ?? m) : 'Aucun mandat';
  const retirerRevenu = async (r: RevenuGestion) => {
    try {
      await archiverRevenuGestion(slug, r.id);
      await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };
  const revenus = (
    <>
      <div className="panel g-bandeau-tri" style={{ marginBottom: 18 }}>
        <div>
          <span className="small muted">À encaisser (HT)</span>
          <span className="v">{recettes ? eurCents(recettes.synthese.aEncaisserCents) : '–'}</span>
        </div>
        <div>
          <span className="small muted">Encaissé (HT)</span>
          <span className="v">{recettes ? eurCents(recettes.synthese.encaisseCents) : '–'}</span>
        </div>
      </div>
      <div className="panel">
        <div className="g-filtres">
          <span style={{ flex: 1 }} />
          {cheminDuMois}
        </div>
        {recettes?.revenus.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Recette</th>
                <th>Mandat</th>
                <th>État</th>
                <th className="r">Montant HT</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recettes.revenus.map((r) => (
                <tr key={r.id} className="click" onClick={() => setTiroirRevenu({ revenu: r })}>
                  <td className="num">
                    {jourCourt(
                      r.etat === 'encaissee' && r.dateEncaissement ? r.dateEncaissement : r.date,
                    )}
                  </td>
                  <td className="g-lib">
                    <b>{r.libelle}</b>
                    <small>
                      {TYPES_REVENU.find(([k]) => k === r.type)?.[1]}
                      {r.referenceFacture ? ` · ${r.referenceFacture}` : ''}
                    </small>
                  </td>
                  <td>
                    <span className="badge">{nomMandat(r.mandat)}</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${r.etat === 'encaissee' ? 'green' : r.etat === 'emise' ? 'blue' : 'amber'}`}
                    >
                      {ETATS_REVENU.find(([k]) => k === r.etat)?.[1]}
                    </span>
                  </td>
                  <td className="r num">
                    <b>{eurCents(r.montantHtCents)}</b>
                  </td>
                  <td className="g-act" onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost sm" onClick={() => void retirerRevenu(r)}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="panel-b">
            <p className="muted" style={{ margin: 0 }}>
              Aucune recette ce mois-ci.{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setTiroirRevenu({});
                }}
              >
                Ajouter une recette
              </a>
            </p>
          </div>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Montants hors taxes. Revenus récurrents, refacturations et factures à émettre : Lot B.
      </p>
    </>
  );

  const prevu = PREVU[onglet];
  return (
    <>
      <div className="g-onglets" role="tablist">
        {ONGLETS.map(([id, l]) => (
          <button
            key={id}
            role="tab"
            aria-selected={onglet === id}
            className={`chip ${onglet === id ? 'on' : ''}`}
            onClick={() => setOnglet(id)}
          >
            {l}
          </button>
        ))}
        <span className="espace" />
        <button className="btn primary" onClick={() => setTiroir({ cible: {} })}>
          + Dépense
        </button>
        <button className="btn" onClick={() => setTiroirRevenu({})}>
          + Recette
        </button>
      </div>
      {erreur && (
        <div className="alert red" role="alert">
          {erreur}
        </div>
      )}
      {onglet === 'vue' && vue}
      {onglet === 'depenses' && depenses}
      {onglet === 'revenus' && revenus}
      {prevu && (
        <div className="panel">
          <div className="panel-h">
            <h2>{ONGLETS.find(([id]) => id === onglet)?.[1]}</h2>
            <span className="badge amber">{prevu[0]}</span>
          </div>
          <div className="panel-b">
            <p className="muted" style={{ margin: 0 }}>
              {prevu[1]} Pas encore disponible : aucun chiffre n’est affiché tant que la source
              n’est pas renseignée.
            </p>
          </div>
        </div>
      )}
      {tiroirRevenu && (
        <GestionRevenuTiroir
          key={tiroirRevenu.revenu?.id ?? 'neuve'}
          slug={slug}
          mandats={mandats}
          revenu={tiroirRevenu.revenu}
          onClose={() => setTiroirRevenu(null)}
          onSaved={() => {
            setTiroirRevenu(null);
            void charger();
          }}
        />
      )}
      {tiroir && (
        <GestionTiroir
          key={`${tiroir.cible.depense?.id ?? 'neuve'}-${tiroir.cible.occurrence ?? ''}-${tiroir.duplique ? 'd' : ''}`}
          slug={slug}
          mandats={mandats}
          cible={tiroir.cible}
          duplique={tiroir.duplique}
          onClose={() => setTiroir(null)}
          onSaved={(encore) => {
            setTiroir(encore ? { cible: {} } : null);
            void charger();
          }}
        />
      )}
    </>
  );
}
