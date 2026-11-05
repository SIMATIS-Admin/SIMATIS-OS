import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiverDepenseGestion,
  archiverRevenuGestion,
  fetchFacturesAEmettre,
  fetchFactures,
  fetchFacturesEmises,
  emettreFacture,
  encaisserFacture,
  type EmissionFacture,
  type FactureEmise,
  poserDelaiMandat,
  type FacturesAEmettre,
  fetchTresorerie,
  fetchTva,
  patchFiche,
  type ProjectionTresorerie,
  type SuiviTvaGestion,
  fetchRevenuGestion,
  type OccurrenceRevenu,
  fetchRevenus,
  type SyntheseRevenus,
  fetchDepenseGestion,
  fetchDepenses,
  occurrenceDepenseGestion,
  occurrenceRevenuGestion,
  type OccurrenceDepense,
  type SyntheseDepenses,
} from '../api.js';
import { aujourdhui, eurCents, libelleMois, moisDecale, MOIS, MOIS_COURTS } from '../gestion.js';
import { Icon } from '../icons.js';
import { GestionTiroir, type CibleTiroir } from './GestionTiroir.js';
import { fusionnerMouvements, type FiltreMouvement, type Mouvement } from './gestion/fusion.js';
import { Factures } from './gestion/Factures.js';
import { GestionImport } from './gestion/GestionImport.js';
import { GestionPipe, VerdictBandeau } from './gestion/GestionPipe.js';
import { Mouvements } from './gestion/Mouvements.js';
import { verdictProjection } from './gestion/verdict.js';
import { GestionTresorerie, type ParamsTresorerie } from './GestionTresorerie.js';
import { GestionIk } from './GestionIk.js';
import { GestionTva } from './GestionTva.js';
import { GestionRevenuTiroir, TYPES_REVENU, type CibleRevenu } from './GestionRevenuTiroir.js';

type Onglet = 'pilotage' | 'mouvements' | 'factures' | 'importer' | 'tva';
const ONGLETS: [Onglet, string][] = [
  ['pilotage', 'Pilotage'],
  ['mouvements', 'Mouvements'],
  ['factures', 'Factures'],
  ['importer', 'Importer'],
  ['tva', 'TVA & IK'],
];

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
  const [onglet, setOnglet] = useState<Onglet>('pilotage');
  const [mois, setMois] = useState(() => aujourdhui().slice(0, 7));
  const [donnees, setDonnees] = useState<{
    synthese: SyntheseDepenses;
    occurrences: OccurrenceDepense[];
  } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tiroir, setTiroir] = useState<{ cible: CibleTiroir; duplique?: boolean } | null>(null);
  const [recettes, setRecettes] = useState<{
    synthese: SyntheseRevenus;
    revenus: OccurrenceRevenu[];
  } | null>(null);
  const [tresorerie, setTresorerie] = useState<ProjectionTresorerie | null>(null);
  const [paramsTreso, setParamsTreso] = useState<ParamsTresorerie>({
    horizon: 6,
    granularite: 'mois',
    retard: 0,
    decalage: 0,
    exclus: [],
    pipe: true,
    remuneration: true,
    hypotheses: {},
  });
  const [tva, setTva] = useState<SuiviTvaGestion | null>(null);
  const [aFacturer, setAFacturer] = useState<OccurrenceRevenu[]>([]);
  const [factures, setFactures] = useState<FacturesAEmettre | null>(null);
  const [emises, setEmises] = useState<FactureEmise[]>([]);
  const [tiroirRevenu, setTiroirRevenu] = useState<CibleRevenu | null>(null);
  const [sousOnglet, setSousOnglet] = useState<'tva' | 'ik'>('tva');
  const [filtreMouvement, setFiltreMouvement] = useState<FiltreMouvement>('tout');

  // Chaque chargement porte un numéro : une réponse dépassée par un chargement plus récent est jetée.
  const sequence = useRef(0);
  const charger = useCallback(async () => {
    const numero = ++sequence.current;
    try {
      setErreur(null);
      const horizon = new Date(`${aujourdhui()}T00:00:00Z`);
      horizon.setUTCDate(horizon.getUTCDate() + 30);
      const [d, r, f, t, v, fm, em] = await Promise.all([
        fetchDepenses(slug, mois),
        fetchRevenus(slug, mois),
        fetchFacturesAEmettre(slug, horizon.toISOString().slice(0, 10)),
        fetchTresorerie(slug, paramsTreso),
        fetchTva(slug, mois),
        fetchFactures(slug),
        fetchFacturesEmises(slug),
      ]);
      if (numero !== sequence.current) return;
      setTresorerie(t);
      setTva(v);
      setDonnees(d);
      setRecettes(r);
      setAFacturer(f);
      setFactures(fm);
      setEmises(em);
    } catch (e) {
      setErreur(message(e));
    }
  }, [slug, mois, paramsTreso]);

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

  const mouvements = useMemo(
    () => fusionnerMouvements(donnees?.occurrences ?? [], recettes?.revenus ?? []),
    [donnees, recettes],
  );

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

  // Solde de fin du mois demandé dans le scénario central ; absent tant que le solde n'est pas renseigné.
  const finMoisCentral = (() => {
    const p = tresorerie?.scenarios
      .find((x) => x.scenario === 'central')
      ?.periodes.find((x) => x.debut.slice(0, 7) === tresorerie.aujourdhui.slice(0, 7));
    return p?.soldeFinCents ?? null;
  })();

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
                setFiltreMouvement('recurrents');
                setOnglet('mouvements');
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
              {recettes ? eurCents(recettes.synthese.aEncaisserCertainCents) : '–'}
            </span>
            <span className="g-duo">
              <span>
                <i /> {recettes ? eurCents(recettes.synthese.encaisseCents) : '–'} encaissé
              </span>
              <span>
                <i className="prev" />{' '}
                {recettes ? eurCents(recettes.synthese.aEncaisserIncertainCents) : '–'} incertain
              </span>
            </span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setFiltreMouvement('recettes');
                setOnglet('mouvements');
              }}
            >
              Voir les recettes
            </a>
          </div>
        </div>
        <div className="panel kpi">
          <span className="g-ic">
            <Icon name="chart" />
          </span>
          <div>
            <span className="l">Trésorerie fin de mois (central)</span>
            {finMoisCentral == null ? (
              <span className="v vide">Non renseigné</span>
            ) : (
              <span className="v num">{eurCents(finMoisCentral)}</span>
            )}
            <span className="g-maj">
              {tresorerie?.reglages.soldeCents == null
                ? 'Solde d’ouverture à renseigner'
                : `Solde au ${tresorerie.reglages.soldeDate} · ${tresorerie.reglages.soldeSource}`}
            </span>
          </div>
        </div>
        <div className="panel kpi">
          <span className="g-ic">
            <Icon name="chart" />
          </span>
          <div>
            <span className="l">TVA du mois</span>
            <span className="v vide">À confirmer</span>
            <span className="g-maj">
              {tva
                ? `Estimation incertaine : ${eurCents(Math.abs(tva.estimeeCents))} ${tva.estimeeCents < 0 ? 'de crédit' : 'à payer'}`
                : 'Exigibilité à valider'}
            </span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setSousOnglet('tva');
                setOnglet('tva');
              }}
            >
              Voir la TVA
            </a>
          </div>
        </div>
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

  const nomMandat = (m: string | null) =>
    m ? (mandats.find((x) => x.slug === m)?.nom ?? m) : 'Aucun mandat';
  const ouvrirRevenu = async (r: OccurrenceRevenu, etat?: 'emise') => {
    try {
      const revenu = await fetchRevenuGestion(slug, r.revenuId);
      setTiroirRevenu({ revenu, occurrence: r.recurrente ? r.cle.split('|')[1] : undefined, etat });
    } catch (e) {
      setErreur(message(e));
    }
  };
  const retirerRevenu = async (r: OccurrenceRevenu) => {
    try {
      if (r.recurrente)
        await occurrenceRevenuGestion(slug, r.revenuId, r.cle.split('|')[1]!, {
          portee: 'cette',
          etat: 'ignoree',
        });
      else await archiverRevenuGestion(slug, r.revenuId);
      await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };
  const changerSignature = async (id: string, date: string | null) => {
    try {
      await patchFiche(slug, 'affaire', id, { signatureEstimee: date });
      await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };
  const emettre = async (e: EmissionFacture) => {
    try {
      await emettreFacture(slug, e);
      await charger();
      return true;
    } catch (err) {
      setErreur(message(err));
      return false;
    }
  };
  const encaisser = async (id: string, date: string) => {
    try {
      await encaisserFacture(slug, id, date);
      await charger();
    } catch (err) {
      setErreur(message(err));
    }
  };
  const changerDelai = async (mandat: string, jours: number | null) => {
    try {
      await poserDelaiMandat(slug, mandat, jours);
      await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };
  const ouvrirMouvement = (m: Mouvement) =>
    m.depense ? void ouvrir(m.depense) : void ouvrirRevenu(m.recette!);
  const retirerMouvement = (m: Mouvement) =>
    m.depense ? void ignorer(m.depense) : void retirerRevenu(m.recette!);
  const bandeauMouvements = [
    {
      label: `Payé en ${MOIS[Number(mois.slice(5)) - 1]} (dépenses TTC)`,
      valeur: s ? eurCents(s.payeCents) : '–',
    },
    {
      label: 'À venir d’ici fin de mois (dépenses TTC)',
      valeur: s ? eurCents(s.aVenirCents) : '–',
    },
    {
      label: 'À encaisser, certain (recettes HT)',
      valeur: recettes ? eurCents(recettes.synthese.aEncaisserCertainCents) : '–',
    },
    {
      label: 'À encaisser, incertain (recettes HT)',
      valeur: recettes ? eurCents(recettes.synthese.aEncaisserIncertainCents) : '–',
    },
    {
      label: 'Encaissé (recettes HT)',
      valeur: recettes ? eurCents(recettes.synthese.encaisseCents) : '–',
    },
  ];

  const revenusParMandat = (
    <>
      {recettes && recettes.synthese.parMandat.length > 0 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <h2>Revenus par mandat</h2>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Mandat</th>
                {TYPES_REVENU.map(([k, l]) => (
                  <th key={k} className="r">
                    {l}
                  </th>
                ))}
                <th className="r">Total HT</th>
                <th className="r">À facturer</th>
              </tr>
            </thead>
            <tbody>
              {recettes.synthese.parMandat.map((m) => (
                <tr key={m.mandat ?? 'aucun'}>
                  <td>
                    <b>{nomMandat(m.mandat)}</b>
                  </td>
                  {TYPES_REVENU.map(([k]) => (
                    <td key={k} className="r num">
                      {m.parType[k] ? eurCents(m.parType[k]) : <span className="muted">–</span>}
                    </td>
                  ))}
                  <td className="r num">
                    <b>{eurCents(m.totalCents)}</b>
                  </td>
                  <td className="r num">{eurCents(m.aFacturerCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <>
      <div className="g-onglets" role="tablist">
        {ONGLETS.map(([id, l]) => (
          <button
            key={id}
            role="tab"
            aria-selected={onglet === id}
            className={`chip ${onglet === id ? 'on' : ''}`}
            onClick={() => {
              // Un filtre posé par une carte ne doit pas coller à l'onglet.
              if (id === 'mouvements' && onglet !== 'mouvements') setFiltreMouvement('tout');
              setOnglet(id);
            }}
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
      {onglet === 'pilotage' && (
        <>
          {tresorerie && (
            <VerdictBandeau
              verdict={verdictProjection(tresorerie, paramsTreso.decalage, paramsTreso.exclus)}
            />
          )}
          {vue}
          <div style={{ marginTop: 18 }}>
            <GestionTresorerie
              slug={slug}
              projection={tresorerie}
              params={paramsTreso}
              onParams={setParamsTreso}
              onReglagesSaved={() => void charger()}
              onAjouterRevenu={() => setTiroirRevenu({})}
            />
          </div>
          {tresorerie && (
            <GestionPipe
              affaires={tresorerie.pipe.affaires}
              decalage={paramsTreso.decalage}
              exclus={paramsTreso.exclus}
              onDecalage={(decalage) => setParamsTreso({ ...paramsTreso, decalage })}
              onExclus={(exclus) => setParamsTreso({ ...paramsTreso, exclus })}
              inclure={paramsTreso.pipe}
              hypotheses={paramsTreso.hypotheses}
              onInclure={(pipe) => setParamsTreso({ ...paramsTreso, pipe })}
              onHypothese={(id, h) => {
                const reste = Object.entries(paramsTreso.hypotheses).filter(([k]) => k !== id);
                setParamsTreso({
                  ...paramsTreso,
                  hypotheses: Object.fromEntries(h ? [...reste, [id, h]] : reste),
                });
              }}
              onReinitialiser={() => setParamsTreso({ ...paramsTreso, hypotheses: {} })}
              onDate={(id, date) => void changerSignature(id, date)}
            />
          )}
          {revenusParMandat}
        </>
      )}
      {onglet === 'mouvements' && (
        <Mouvements
          key={filtreMouvement}
          mouvements={mouvements}
          aFacturer={aFacturer}
          bandeau={bandeauMouvements}
          periode={cheminDuMois}
          mandats={mandats.map((m) => m.nom)}
          nomAff={nomAff}
          filtreInitial={filtreMouvement}
          onOuvrir={ouvrirMouvement}
          onDupliquer={(m) => void ouvrir(m.depense!, true)}
          onRetirer={retirerMouvement}
          onMarquerFacturee={(r) => void ouvrirRevenu(r, 'emise')}
          onVoirFactures={() => setOnglet('factures')}
          onAjouter={(f) => (f === 'recettes' ? setTiroirRevenu({}) : setTiroir({ cible: {} }))}
        />
      )}
      {onglet === 'factures' && factures && (
        <Factures
          donnees={factures}
          mandats={mandats}
          onDelai={(m, j) => void changerDelai(m, j)}
          emises={emises}
          onEmettre={(e) => emettre(e)}
          onEncaisser={(id, d) => void encaisser(id, d)}
        />
      )}
      {onglet === 'importer' && <GestionImport slug={slug} onImporte={() => void charger()} />}
      {onglet === 'tva' && (
        <>
          <div className="g-filtres" style={{ marginBottom: 14 }}>
            {(
              [
                ['tva', 'TVA'],
                ['ik', 'IK & compte associé'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                className={`chip ${sousOnglet === k ? 'on' : ''}`}
                aria-pressed={sousOnglet === k}
                onClick={() => setSousOnglet(k)}
              >
                {l}
              </button>
            ))}
          </div>
          {sousOnglet === 'tva' ? (
            <GestionTva
              slug={slug}
              mois={mois}
              suivi={tva}
              periode={cheminDuMois}
              onSaved={() => void charger()}
            />
          ) : (
            <GestionIk
              slug={slug}
              mois={mois}
              periode={cheminDuMois}
              mandats={mandats}
              onModifie={() => void charger()}
            />
          )}
        </>
      )}
      {tiroirRevenu && (
        <GestionRevenuTiroir
          key={`${tiroirRevenu.revenu?.id ?? 'neuve'}-${tiroirRevenu.occurrence ?? ''}-${tiroirRevenu.etat ?? ''}`}
          slug={slug}
          mandats={mandats}
          cible={tiroirRevenu}
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
