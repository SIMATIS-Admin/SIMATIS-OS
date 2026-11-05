import { useCallback, useEffect, useState } from 'react';
import {
  archiverLieuIk,
  archiverMouvementCca,
  archiverTrajetIk,
  avancerMoisIk,
  comptabiliserMouvementCca,
  creerBaremeIk,
  creerLieuIk,
  creerMouvementCca,
  creerTrajetIk,
  modifierTrajetIk,
  creerVehiculeIk,
  fetchCca,
  fetchConfigIk,
  fetchEtatIk,
  poserAbonnementIk,
  urlExportIk,
  validerBaremeIk,
  type ActionMoisIk,
  type ConfigIk,
  type EtatIk,
  type StatutIk,
  type SuiviCcaGestion,
  type TrancheIk,
} from '../api.js';
import { aujourdhui, eurCents, libelleMois } from '../gestion.js';

const STATUTS: Record<StatutIk, string> = {
  brouillon: 'Brouillon',
  a_controler: 'À contrôler',
  valide: 'Validé pour transmission',
  comptabilise: 'Comptabilisé',
  rembourse: 'Remboursé',
};
// Le cran suivant de chaque mois : un seul bouton à la fois, jamais de saut d'étape.
const SUIVANT: Record<StatutIk, [ActionMoisIk, string] | null> = {
  brouillon: ['a_controler', 'Passer à contrôler'],
  a_controler: ['valide', 'Valider pour transmission'],
  valide: ['comptabilise', 'Marquer comptabilisé'],
  comptabilise: ['rembourse', 'Marquer remboursé'],
  rembourse: null,
};
const TYPES_CCA: [string, string][] = [
  ['ouverture', "Solde d'ouverture"],
  ['apport', 'Apport'],
  ['depense_personnelle', 'Dépense personnelle'],
  ['loyer', "Loyer versé à l'associé"],
  ['remboursement', 'Remboursement'],
  ['correction', 'Correction du comptable'],
];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nombre = (s: string) => {
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const euroSaisi = (s: string) => {
  const n = nombre(s);
  return n == null ? null : Math.round(n * 100);
};

// IK (trajets, barème versionné, export du mois) et compte courant d'associé. Aucune valeur n'est
// préremplie : lieux, distances et barème viennent de Marc ou de son comptable.
export function GestionIk({
  slug,
  mois,
  periode,
  mandats,
  onModifie,
}: {
  slug: string;
  mois: string;
  periode: React.ReactNode;
  mandats: { slug: string; nom: string }[];
  // Appelé après un changement qui touche les factures à émettre (mandat ou case Refacturer).
  onModifie?: () => void;
}) {
  const [config, setConfig] = useState<ConfigIk | null>(null);
  const [vehiculeId, setVehiculeId] = useState('');
  const [etat, setEtat] = useState<EtatIk | null>(null);
  const [cca, setCca] = useState<SuiviCcaGestion | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [compta, setCompta] = useState<{
    action: ActionMoisIk;
    date: string;
    source: string;
  } | null>(null);

  const attraper = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setErreur(null);
      return true;
    } catch (e) {
      setErreur(message(e));
      return false;
    }
  }, []);

  const charger = useCallback(async () => {
    await attraper(async () => {
      const c = await fetchConfigIk(slug);
      setConfig(c);
      setCca(await fetchCca(slug));
      const id = c.vehicules.some((v) => v.id === vehiculeId)
        ? vehiculeId
        : (c.vehicules[0]?.id ?? '');
      setVehiculeId(id);
      setEtat(id ? await fetchEtatIk(slug, mois, id) : null);
    });
  }, [slug, mois, vehiculeId, attraper]);
  useEffect(() => {
    void charger();
  }, [charger]);

  // --- formulaires ---
  const [veh, setVeh] = useState({ libelle: '', categorie: '' });
  const [lieu, setLieu] = useState({ nom: '', km: '', origine: 'saisie' });
  const [bar, setBar] = useState({
    annee: String(new Date().getFullYear()),
    categorie: '',
    source: '',
    tranches: [{ jusqua: '', taux: '', forfait: '' }],
  });
  const [traj, setTraj] = useState({
    date: `${mois}-01`,
    trajet: '',
    km: '',
    commentaire: '',
    mandat: '',
    refacturer: false,
  });
  const [mvt, setMvt] = useState({
    date: aujourdhui(),
    type: 'apport',
    libelle: '',
    montant: '',
    etat: 'prevu' as 'prevu' | 'comptabilise',
    source: '',
  });

  useEffect(() => setTraj((t) => ({ ...t, date: `${mois}-01` })), [mois]);

  const trancheDepuis = (): TrancheIk[] | string => {
    const out: TrancheIk[] = [];
    let de = 0;
    for (const [i, l] of bar.tranches.entries()) {
      const derniere = i === bar.tranches.length - 1;
      const jusqua = derniere ? null : nombre(l.jusqua);
      const taux = nombre(l.taux);
      const forfait = l.forfait.trim() ? euroSaisi(l.forfait) : 0;
      if (taux == null || forfait == null || (!derniere && (jusqua == null || jusqua <= de)))
        return `Tranche ${i + 1} incomplète ou incohérente.`;
      out.push({
        deKm: de,
        jusquaKm: jusqua,
        // Taux saisi en €/km (0,xxx) : stocké en dix-millièmes d'euro.
        tauxDixMilliemes: Math.round(taux * 10000),
        forfaitCents: forfait,
      });
      if (jusqua != null) de = jusqua;
    }
    return out;
  };

  const baremeAnnee = config?.baremes.filter((b) => b.annee === Number(mois.slice(0, 4))) ?? [];
  const suivant = etat && etat.lignes.length ? etat.lignes.map((l) => l.statut) : [];
  const statutMois = (
    ['brouillon', 'a_controler', 'valide', 'comptabilise', 'rembourse'] as StatutIk[]
  ).find((s) => suivant.includes(s));

  if (!config) return <p className="muted">Chargement…</p>;

  return (
    <>
      {erreur && (
        <div className="alert red" role="alert">
          {erreur}
        </div>
      )}
      <div className="alert blue" style={{ marginBottom: 14 }}>
        <div>
          <b>Document de préparation</b> : l’export n’est pas une pièce fiscale et n’est jamais
          envoyé automatiquement. Une IK n’est justifiée que si aucun transport n’a été payé sur le
          compte professionnel pour ce déplacement.
        </div>
      </div>

      {config.vehicules.length === 0 ? (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <h2>Votre véhicule</h2>
          </div>
          <div className="panel-b">
            <form
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void attraper(async () => {
                  await creerVehiculeIk(slug, {
                    libelle: veh.libelle,
                    categorie: veh.categorie,
                    puissanceFiscale: null,
                  });
                  await charger();
                });
              }}
            >
              <div className="g-champs2">
                <label className="field">
                  <span>Nom du véhicule</span>
                  <input
                    className="input"
                    value={veh.libelle}
                    onChange={(e) => setVeh({ ...veh, libelle: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Catégorie du barème</span>
                  <input
                    className="input"
                    value={veh.categorie}
                    onChange={(e) => setVeh({ ...veh, categorie: e.target.value })}
                  />
                </label>
              </div>
              <button className="btn primary" type="submit">
                Ajouter le véhicule
              </button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h">
              <h2>IK de {libelleMois(mois)}</h2>
              {periode}
            </div>
            <div className="panel-b">
              {config.vehicules.length > 1 && (
                <label className="field">
                  <span>Véhicule</span>
                  <select
                    className="input"
                    value={vehiculeId}
                    onChange={(e) => setVehiculeId(e.target.value)}
                  >
                    {config.vehicules.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.libelle}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <fieldset style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
                <legend className="small muted">Abonnement de transport ce mois-ci ?</legend>
                {[
                  [true, 'Oui'],
                  [false, 'Non'],
                ].map(([v, l]) => (
                  <label key={String(v)} style={{ marginRight: 14 }}>
                    <input
                      type="radio"
                      name="abonnement"
                      checked={etat?.abonnement === v}
                      onChange={() =>
                        void attraper(async () => {
                          await poserAbonnementIk(slug, mois, v as boolean);
                          await charger();
                        })
                      }
                    />{' '}
                    {l as string}
                  </label>
                ))}
                {etat?.abonnement == null && <span className="small muted">Non renseigné</span>}
              </fieldset>
              {etat?.avertissements.map((a) => (
                <p className="small muted" key={a} style={{ margin: '0 0 6px' }}>
                  {a}
                </p>
              ))}
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Trajet</th>
                    <th>Commentaire</th>
                    <th className="num">km A/R</th>
                    <th className="num">Cumul annuel</th>
                    <th className="num">Indemnité</th>
                    <th>Mandat</th>
                    <th>Refacturer</th>
                    <th>Statut</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {etat?.lignes.map((l) => (
                    <tr key={l.id}>
                      <td>{l.date}</td>
                      <td>{l.trajet}</td>
                      <td>{l.commentaire}</td>
                      <td className="num">{l.km}</td>
                      <td className="num">{l.cumulKm}</td>
                      <td className="num">
                        {l.indemniteCents == null ? '–' : eurCents(l.indemniteCents)}
                      </td>
                      <td>
                        {l.mandat
                          ? (mandats.find((m) => m.slug === l.mandat)?.nom ?? l.mandat)
                          : '–'}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Refacturer le trajet du ${l.date}`}
                          checked={l.refacturer}
                          disabled={!l.mandat}
                          onChange={(e) =>
                            void attraper(async () => {
                              await modifierTrajetIk(slug, l.id, { refacturer: e.target.checked });
                              await charger();
                              onModifie?.();
                            })
                          }
                        />
                      </td>
                      <td>{STATUTS[l.statut]}</td>
                      <td>
                        {(l.statut === 'brouillon' || l.statut === 'a_controler') && (
                          <button
                            className="btn"
                            aria-label={`Supprimer le trajet du ${l.date}`}
                            onClick={() =>
                              void attraper(async () => {
                                await archiverTrajetIk(slug, l.id);
                                await charger();
                              })
                            }
                          >
                            Supprimer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {etat && etat.lignes.length === 0 && (
                    <tr>
                      <td colSpan={10} className="muted">
                        Aucun trajet ce mois-ci.
                      </td>
                    </tr>
                  )}
                </tbody>
                {etat && etat.lignes.length > 0 && (
                  <tfoot>
                    <tr>
                      <th colSpan={3}>Total du mois</th>
                      <th className="num">{etat.totalKm}</th>
                      <th />
                      <th className="num">
                        {etat.totalIndemniteCents == null
                          ? 'Barème à valider'
                          : eurCents(etat.totalIndemniteCents)}
                      </th>
                      <th colSpan={4} />
                    </tr>
                  </tfoot>
                )}
              </table>
              {etat?.derniereDateTransmise && (
                <p className="small muted">
                  Dernière date déjà transmise : {etat.derniereDateTransmise}.
                </p>
              )}
              {etat?.cca && etat.cca.ecartCents !== 0 && (
                <div className="alert amber">
                  Le calcul a changé depuis la comptabilisation : écart de{' '}
                  {eurCents(Math.abs(etat.cca.ecartCents))} avec le compte d’associé. Rien n’est
                  corrigé automatiquement : demandez l’écriture rectificative au comptable.
                </div>
              )}
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {statutMois && SUIVANT[statutMois] && (
                  <button
                    className="btn primary"
                    onClick={() => {
                      const [action] = SUIVANT[statutMois]!;
                      if (action === 'comptabilise' || action === 'rembourse')
                        setCompta({ action, date: aujourdhui(), source: '' });
                      else
                        void attraper(async () => {
                          await avancerMoisIk(slug, mois, { vehiculeId, action });
                          await charger();
                        });
                    }}
                  >
                    {SUIVANT[statutMois][1]}
                  </button>
                )}
                {statutMois === 'valide' && (
                  <button
                    className="btn"
                    onClick={() =>
                      void attraper(async () => {
                        await avancerMoisIk(slug, mois, { vehiculeId, action: 'rouvrir' });
                        await charger();
                      })
                    }
                  >
                    Rouvrir le mois
                  </button>
                )}
                {etat && etat.lignes.length > 0 && (
                  <a className="btn" href={urlExportIk(slug, mois, vehiculeId)} download>
                    Exporter en CSV
                  </a>
                )}
              </div>
              {compta && (
                <form
                  autoComplete="off"
                  style={{ marginTop: 12 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void attraper(async () => {
                      await avancerMoisIk(slug, mois, {
                        vehiculeId,
                        action: compta.action,
                        date: compta.date,
                        source: compta.source,
                      });
                      setCompta(null);
                      await charger();
                    });
                  }}
                >
                  <div className="g-champs2">
                    <label className="field">
                      <span>Date de l’écriture</span>
                      <input
                        className="input"
                        type="date"
                        value={compta.date}
                        onChange={(e) => setCompta({ ...compta, date: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Source (écriture du comptable, virement…)</span>
                      <input
                        className="input"
                        value={compta.source}
                        onChange={(e) => setCompta({ ...compta, source: e.target.value })}
                      />
                    </label>
                  </div>
                  <button className="btn primary" type="submit">
                    Confirmer
                  </button>
                  <button className="btn" type="button" onClick={() => setCompta(null)}>
                    Annuler
                  </button>
                </form>
              )}

              <h3 style={{ margin: '18px 0 8px' }}>Ajouter un trajet</h3>
              <form
                autoComplete="off"
                onSubmit={(e) => {
                  e.preventDefault();
                  const km = nombre(traj.km);
                  if (km == null || km < 1) return setErreur('Indiquez la distance aller-retour.');
                  void attraper(async () => {
                    await creerTrajetIk(slug, {
                      vehiculeId,
                      date: traj.date,
                      trajet: traj.trajet,
                      commentaire: traj.commentaire,
                      kmAllerRetour: Math.round(km),
                      mandat: traj.mandat || null,
                      refacturer: traj.refacturer && !!traj.mandat,
                    });
                    setTraj({ ...traj, trajet: '', km: '', commentaire: '', refacturer: false });
                    await charger();
                    onModifie?.();
                  });
                }}
              >
                <div className="g-champs2">
                  <label className="field">
                    <span>Date</span>
                    <input
                      className="input"
                      type="date"
                      value={traj.date}
                      onChange={(e) => setTraj({ ...traj, date: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Trajet</span>
                    <input
                      className="input"
                      list="ik-lieux"
                      value={traj.trajet}
                      onChange={(e) => {
                        const l = config.lieux.find(
                          (x) => `Domicile à ${x.nom}` === e.target.value,
                        );
                        setTraj({
                          ...traj,
                          trajet: e.target.value,
                          km: l ? String(l.distanceKm) : traj.km,
                        });
                      }}
                    />
                    <datalist id="ik-lieux">
                      {config.lieux.map((l) => (
                        <option key={l.id} value={`Domicile à ${l.nom}`} />
                      ))}
                    </datalist>
                  </label>
                  <label className="field">
                    <span>Distance aller-retour (km)</span>
                    <input
                      className="input num"
                      inputMode="numeric"
                      value={traj.km}
                      onChange={(e) => setTraj({ ...traj, km: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Commentaire (client, projet, réunion)</span>
                    <input
                      className="input"
                      value={traj.commentaire}
                      onChange={(e) => setTraj({ ...traj, commentaire: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Mandat du trajet</span>
                    <select
                      className="input"
                      value={traj.mandat}
                      onChange={(e) =>
                        setTraj({
                          ...traj,
                          mandat: e.target.value,
                          refacturer: e.target.value ? traj.refacturer : false,
                        })
                      }
                    >
                      <option value="">Aucun mandat</option>
                      {mandats.map((m) => (
                        <option key={m.slug} value={m.slug}>
                          {m.nom}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    disabled={!traj.mandat}
                    checked={traj.refacturer}
                    onChange={(e) => setTraj({ ...traj, refacturer: e.target.checked })}
                  />
                  &nbsp;Refacturer ce trajet
                </label>
                <button className="btn primary" type="submit">
                  Ajouter le trajet
                </button>
              </form>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h">
              <h2>Lieux habituels</h2>
            </div>
            <div className="panel-b">
              {config.lieux.map((l) => (
                <div key={l.id} style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
                  <span>
                    {l.nom} · {l.distanceKm} km A/R ·{' '}
                    {l.origine === 'convention_comptable'
                      ? 'convention du comptable'
                      : l.origine === 'calculee'
                        ? 'calculée'
                        : 'saisie'}
                  </span>
                  <button
                    className="btn"
                    onClick={() =>
                      void attraper(async () => {
                        await archiverLieuIk(slug, l.id);
                        await charger();
                      })
                    }
                  >
                    Retirer
                  </button>
                </div>
              ))}
              <form
                autoComplete="off"
                onSubmit={(e) => {
                  e.preventDefault();
                  const km = nombre(lieu.km);
                  if (km == null) return setErreur('Distance invalide.');
                  void attraper(async () => {
                    await creerLieuIk(slug, {
                      nom: lieu.nom,
                      distanceKm: Math.round(km),
                      origine: lieu.origine,
                    });
                    setLieu({ nom: '', km: '', origine: 'saisie' });
                    await charger();
                  });
                }}
              >
                <div className="g-champs2">
                  <label className="field">
                    <span>Nom du lieu</span>
                    <input
                      className="input"
                      value={lieu.nom}
                      onChange={(e) => setLieu({ ...lieu, nom: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Distance aller-retour (km)</span>
                    <input
                      className="input num"
                      value={lieu.km}
                      onChange={(e) => setLieu({ ...lieu, km: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Origine de la distance</span>
                    <select
                      className="input"
                      value={lieu.origine}
                      onChange={(e) => setLieu({ ...lieu, origine: e.target.value })}
                    >
                      <option value="saisie">Saisie</option>
                      <option value="calculee">Calculée avec un outil d’itinéraire</option>
                      <option value="convention_comptable">Convention du comptable</option>
                    </select>
                  </label>
                </div>
                <button className="btn" type="submit">
                  Ajouter le lieu
                </button>
              </form>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h">
              <h2>Barème kilométrique {mois.slice(0, 4)}</h2>
            </div>
            <div className="panel-b">
              <p className="small muted">
                Aucun taux n’est fourni par l’OS : saisissez le barème applicable, puis validez-le
                (vous ou le comptable). Seul un barème validé sert au calcul ; une correction crée
                une nouvelle version.
              </p>
              {baremeAnnee.map((b) => (
                <div key={b.id} style={{ marginBottom: 8 }}>
                  <b>
                    {b.categorie} · version {b.version}
                  </b>{' '}
                  · {b.source} ·{' '}
                  {b.valideLe ? (
                    `validé le ${b.valideLe}`
                  ) : (
                    <button
                      className="btn"
                      onClick={() =>
                        void attraper(async () => {
                          await validerBaremeIk(slug, b.id, aujourdhui());
                          await charger();
                        })
                      }
                    >
                      Valider ce barème
                    </button>
                  )}
                  <div className="small muted">
                    {b.tranches
                      .map(
                        (t) =>
                          `${t.deKm}–${t.jusquaKm ?? '∞'} km : ${t.tauxDixMilliemes / 10000} €/km + ${eurCents(t.forfaitCents)}`,
                      )
                      .join(' · ')}
                  </div>
                </div>
              ))}
              <form
                autoComplete="off"
                onSubmit={(e) => {
                  e.preventDefault();
                  const tranches = trancheDepuis();
                  if (typeof tranches === 'string') return setErreur(tranches);
                  void attraper(async () => {
                    await creerBaremeIk(slug, {
                      annee: Number(bar.annee),
                      categorie: bar.categorie,
                      source: bar.source,
                      tranches,
                    });
                    await charger();
                  });
                }}
              >
                <div className="g-champs2">
                  <label className="field">
                    <span>Année</span>
                    <input
                      className="input num"
                      value={bar.annee}
                      onChange={(e) => setBar({ ...bar, annee: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Catégorie</span>
                    <input
                      className="input"
                      value={bar.categorie}
                      onChange={(e) => setBar({ ...bar, categorie: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Source du barème</span>
                    <input
                      className="input"
                      value={bar.source}
                      onChange={(e) => setBar({ ...bar, source: e.target.value })}
                    />
                  </label>
                </div>
                {bar.tranches.map((t, i) => {
                  const derniere = i === bar.tranches.length - 1;
                  const maj = (p: Partial<typeof t>) =>
                    setBar({
                      ...bar,
                      tranches: bar.tranches.map((x, j) => (j === i ? { ...x, ...p } : x)),
                    });
                  return (
                    <div className="g-champs2" key={i}>
                      <label className="field">
                        <span>Tranche {i + 1} : jusqu’à (km)</span>
                        <input
                          className="input num"
                          disabled={derniere}
                          placeholder={derniere ? 'Sans plafond' : ''}
                          value={t.jusqua}
                          onChange={(e) => maj({ jusqua: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Taux (€/km)</span>
                        <input
                          className="input num"
                          value={t.taux}
                          onChange={(e) => maj({ taux: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Forfait (€)</span>
                        <input
                          className="input num"
                          value={t.forfait}
                          onChange={(e) => maj({ forfait: e.target.value })}
                        />
                      </label>
                    </div>
                  );
                })}
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    setBar({
                      ...bar,
                      tranches: [...bar.tranches, { jusqua: '', taux: '', forfait: '' }],
                    })
                  }
                >
                  + Tranche
                </button>{' '}
                <button className="btn primary" type="submit">
                  Enregistrer le barème
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      <div className="panel">
        <div className="panel-h">
          <h2>Compte courant d’associé</h2>
        </div>
        <div className="panel-b">
          {cca?.avertissements.map((a) => (
            <p className="small muted" key={a} style={{ margin: '0 0 6px' }}>
              {a}
            </p>
          ))}
          <div className="panel g-bandeau-tri" style={{ marginBottom: 14 }}>
            <div>
              <span className="small muted">Solde confirmé</span>
              <span className="v">
                {cca?.confirmeCents == null ? 'Non renseigné' : eurCents(cca.confirmeCents)}
              </span>
              {cca?.ouverture && (
                <span className="small muted">
                  depuis l’ouverture du {cca.ouverture.date} · {cca.ouverture.source}
                </span>
              )}
            </div>
            <div>
              <span className="small muted">Estimé (avec le prévu)</span>
              <span className="v">
                {cca?.estimeCents == null ? 'Non renseigné' : eurCents(cca.estimeCents)}
              </span>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mouvement</th>
                <th className="num">Montant</th>
                <th>État</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cca?.mouvements.map((m) => (
                <tr key={m.id}>
                  <td>{m.date}</td>
                  <td>
                    {m.libelle}
                    {m.avantOuverture && (
                      <span className="small muted"> (avant l’ouverture, écarté)</span>
                    )}
                  </td>
                  <td className="num">{eurCents(m.montantCents)}</td>
                  <td>{m.etat === 'comptabilise' ? 'Comptabilisé' : 'Prévu'}</td>
                  <td>{m.source ?? '–'}</td>
                  <td>
                    {m.etat === 'prevu' && (
                      <button
                        className="btn"
                        onClick={() => {
                          const source = window.prompt(
                            'Source de l’écriture (relevé, comptable) ?',
                          );
                          if (source)
                            void attraper(async () =>
                              setCca(await comptabiliserMouvementCca(slug, m.id, source)),
                            );
                        }}
                      >
                        Comptabiliser
                      </button>
                    )}{' '}
                    {!m.derive && (
                      <button
                        className="btn"
                        onClick={() =>
                          void attraper(async () => setCca(await archiverMouvementCca(slug, m.id)))
                        }
                      >
                        Retirer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {cca && cca.mouvements.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Aucun mouvement.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="small muted">
            Les IK ne rejoignent le compte confirmé qu’à la comptabilisation ; le loyer est à
            confirmer avec le comptable avant de l’inscrire ici.
          </p>
          <form
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              const c = euroSaisi(mvt.montant);
              if (c == null) return setErreur('Montant invalide (négatif pour un débit).');
              void attraper(async () => {
                setCca(
                  await creerMouvementCca(slug, {
                    date: mvt.date,
                    type: mvt.type,
                    libelle: mvt.libelle,
                    montantCents: c,
                    etat: mvt.etat,
                    source: mvt.source.trim() || null,
                  }),
                );
                setMvt({ ...mvt, libelle: '', montant: '', source: '' });
              });
            }}
          >
            <div className="g-champs2">
              <label className="field">
                <span>Date</span>
                <input
                  className="input"
                  type="date"
                  value={mvt.date}
                  onChange={(e) => setMvt({ ...mvt, date: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Type</span>
                <select
                  className="input"
                  value={mvt.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    setMvt({
                      ...mvt,
                      type,
                      etat: type === 'ouverture' ? 'comptabilise' : mvt.etat,
                    });
                  }}
                >
                  {TYPES_CCA.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Libellé</span>
                <input
                  className="input"
                  value={mvt.libelle}
                  onChange={(e) => setMvt({ ...mvt, libelle: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Montant (€, crédit positif, débit négatif)</span>
                <input
                  className="input num"
                  value={mvt.montant}
                  onChange={(e) => setMvt({ ...mvt, montant: e.target.value })}
                />
              </label>
              <label className="field">
                <span>État</span>
                <select
                  className="input"
                  value={mvt.etat}
                  onChange={(e) =>
                    setMvt({ ...mvt, etat: e.target.value as 'prevu' | 'comptabilise' })
                  }
                >
                  <option value="prevu">Prévu</option>
                  <option value="comptabilise">Comptabilisé</option>
                </select>
              </label>
              <label className="field">
                <span>Source (obligatoire si comptabilisé)</span>
                <input
                  className="input"
                  value={mvt.source}
                  onChange={(e) => setMvt({ ...mvt, source: e.target.value })}
                />
              </label>
            </div>
            <button className="btn primary" type="submit">
              Ajouter le mouvement
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
