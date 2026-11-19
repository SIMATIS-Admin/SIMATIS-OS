import { useEffect, useRef, useState } from 'react';
import {
  enregistrerDevis,
  fetchDevisDetail,
  fetchParametresDevis,
  nouvelleVersionDevis,
  transmettreDevis,
  validerDevis,
  type ContenuDevis,
  type DevisDetail,
  type LigneDevis,
  type ParametresDevis,
} from '../api.js';
import { calculer, problemesAvantEnvoi } from '../devis.js';
import { Icon } from '../icons.js';
import { DevisApercu } from './DevisApercu.js';
import { STATUT } from './DevisListe.js';

type Etape = 'mission' | 'prix' | 'conditions' | 'envoi';
const ETAPES: [Etape, string][] = [
  ['mission', '1. Mission'],
  ['prix', '2. Prix'],
  ['conditions', '3. Conditions de vente'],
  ['envoi', '4. Envoi'],
];
const UNITES: LigneDevis['unite'][] = ['forfait', 'jour', 'mois', 'personne', 'heure'];
const eur2 = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const entier = (v: string, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number(v)) || min));

const contenuDe = (d: DevisDetail): ContenuDevis => ({
  titre: d.titre,
  contexte: d.contexte,
  objectifs: d.objectifs,
  inclus: d.inclus,
  exclu: d.exclu,
  livrables: d.livrables,
  debut: d.debut,
  duree: d.duree,
  lignes: d.lignes,
  remisePct: d.remisePct,
  acomptePct: d.acomptePct,
  frais: d.frais,
  validiteJours: d.validiteJours,
  clauses: d.clauses,
});

// Délai sans frappe avant d'enregistrer le brouillon : assez court pour ne rien perdre.
const DELAI_ENREGISTREMENT = 800;

export function DevisEditeur({
  slug,
  id,
  etapeInitiale = 'mission',
  onOuvrir,
}: {
  slug: string;
  id: string;
  etapeInitiale?: Etape;
  onOuvrir: (id: string) => void;
}) {
  const [d, setD] = useState<DevisDetail | null>(null);
  const [c, setC] = useState<ContenuDevis | null>(null);
  const [etape, setEtape] = useState<Etape>(etapeInitiale);
  const [message, setMessage] = useState<string | null>(null);
  const [clausesBib, setClausesBib] = useState<ParametresDevis['clauses']>([]);
  const sale = useRef(false);
  const dernier = useRef<ContenuDevis | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchDevisDetail(slug, id).then(
      (x) => {
        setD(x);
        setC(contenuDe(x));
      },
      (e: unknown) => setMessage(String(e)),
    );
  }, [slug, id]);

  useEffect(() => {
    fetchParametresDevis(slug).then(
      (p) => setClausesBib(p.clauses),
      () => setClausesBib([]),
    );
  }, [slug]);

  const brouillon = d?.statut === 'brouillon';
  dernier.current = c;
  // Quitter l'éditeur avec une saisie en attente l'enregistre d'abord : rien ne se perd.
  useEffect(
    () => () => {
      if (sale.current && dernier.current) {
        sale.current = false;
        void enregistrerDevis(slug, id, dernier.current).catch(() => undefined);
      }
    },
    [slug, id],
  );
  useEffect(() => {
    if (!c || !brouillon || !sale.current) return;
    const t = setTimeout(() => {
      sale.current = false;
      enregistrerDevis(slug, id, c).then(
        () => setMessage('Brouillon enregistré'),
        (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
      );
    }, DELAI_ENREGISTREMENT);
    minuteur.current = t;
    return () => clearTimeout(t);
  }, [c, brouillon, slug, id]);

  if (!d || !c) return <div className="empty">{message ?? 'Chargement du devis…'}</div>;

  const maj = (patch: Partial<ContenuDevis>) => {
    sale.current = true;
    setC({ ...c, ...patch });
  };
  const majLigne = (k: number, patch: Partial<LigneDevis>) =>
    maj({ lignes: c.lignes.map((l, i) => (i === k ? { ...l, ...patch } : l)) });
  const majClause = (k: number, patch: Partial<ContenuDevis['clauses'][number]>) =>
    maj({ clauses: c.clauses.map((x, i) => (i === k ? { ...x, ...patch } : x)) });
  const err = (e: unknown) => setMessage(e instanceof Error ? e.message : String(e));
  const totaux = calculer(c, d.tvaPct);
  const problemes = problemesAvantEnvoi(c);
  const bloque = totaux.prixManquant || !c.inclus.trim();
  const off = !brouillon;

  const valider = async () => {
    // L'enregistrement automatique ne doit pas courir avec la validation.
    if (minuteur.current) clearTimeout(minuteur.current);
    try {
      await enregistrerDevis(slug, id, c);
      sale.current = false;
      await validerDevis(slug, id);
      const x = await fetchDevisDetail(slug, id);
      setD(x);
      setC(contenuDe(x));
      setMessage('Devis validé et verrouillé');
    } catch (e) {
      err(e);
    }
  };

  const champ = (
    cle: 'titre' | 'contexte' | 'objectifs' | 'inclus' | 'exclu' | 'livrables' | 'duree',
    libelle: string,
    aide?: string,
    ligne = false,
  ) => (
    <div className="d-bloc">
      <label htmlFor={`dv-${cle}`}>{libelle}</label>
      {aide && <div className="aide">{aide}</div>}
      {ligne ? (
        <input
          id={`dv-${cle}`}
          className="input"
          type="text"
          disabled={off}
          value={c[cle]}
          onChange={(e) => maj({ [cle]: e.target.value })}
        />
      ) : (
        <textarea
          id={`dv-${cle}`}
          className="input"
          disabled={off}
          value={c[cle]}
          onChange={(e) => maj({ [cle]: e.target.value })}
        />
      )}
    </div>
  );

  const nombre = (
    cle: 'remisePct' | 'acomptePct' | 'validiteJours',
    libelle: string,
    min: number,
    max: number,
  ) => (
    <div className="d-bloc">
      <label htmlFor={`dv-${cle}`}>{libelle}</label>
      <input
        id={`dv-${cle}`}
        className="input"
        type="number"
        min={min}
        max={max}
        disabled={off}
        value={c[cle]}
        onChange={(e) => maj({ [cle]: entier(e.target.value, min, max) })}
      />
    </div>
  );

  return (
    <div className="d-edit">
      <div>
        <div style={{ marginBottom: 12 }}>
          <h2>
            {d.numero} <span className={`badge ${STATUT[d.statut][1]}`}>{STATUT[d.statut][0]}</span>
          </h2>
          <div className="small muted">
            {d.entreprise ?? '—'}, {d.opportunite}
          </div>
        </div>
        {off && (
          <div className="alert amber">
            <Icon name="lock" />
            <div>Devis verrouillé. Pour le modifier, créez une nouvelle version (étape Envoi).</div>
          </div>
        )}
        <div className="d-etapes">
          {ETAPES.map(([k, l]) => (
            <button
              key={k}
              className={`chip ${etape === k ? 'on' : ''}`}
              onClick={() => setEtape(k)}
            >
              {l}
            </button>
          ))}
        </div>

        {etape === 'mission' && (
          <>
            {champ('titre', 'Intitulé de la mission', undefined, true)}
            {champ(
              'contexte',
              'Contexte',
              'Pourquoi le client fait appel à vous, en deux ou trois phrases.',
            )}
            {champ('objectifs', 'Objectifs', 'Une ligne par objectif.')}
            {champ('inclus', 'Ce qui est inclus (périmètre)', 'Une ligne par prestation.')}
            {champ(
              'exclu',
              'Ce qui est exclu',
              'Évite les malentendus : ce que le prix ne couvre pas.',
            )}
            {champ('livrables', 'Livrables')}
            <div className="d-duo">
              <div className="d-bloc">
                <label htmlFor="dv-debut">Début souhaité</label>
                <input
                  id="dv-debut"
                  className="input"
                  type="date"
                  disabled={off}
                  value={c.debut ?? ''}
                  onChange={(e) => maj({ debut: e.target.value || null })}
                />
              </div>
              {champ('duree', 'Durée', 'Ex. 6 semaines', true)}
            </div>
          </>
        )}

        {etape === 'prix' && (
          <>
            {!off && (
              <div className="alert amber">
                <Icon name="lock" />
                <div>
                  Les prix sont à vous : l’OS ne propose ni tarif ni remise. Le montant de l’affaire
                  est seulement rappelé, à reprendre d’un clic.
                </div>
              </div>
            )}
            <table className="tbl d-lignes">
              <thead>
                <tr>
                  <th>Prestation</th>
                  <th>Unité</th>
                  <th>Qté</th>
                  <th>Prix unit. HT</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.lignes.map((l, k) => (
                  <tr key={k}>
                    <td>
                      <input
                        className="input"
                        aria-label={`Libellé de la ligne ${k + 1}`}
                        disabled={off}
                        value={l.libelle}
                        onChange={(e) => majLigne(k, { libelle: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        aria-label={`Unité de la ligne ${k + 1}`}
                        disabled={off}
                        value={l.unite}
                        onChange={(e) =>
                          majLigne(k, { unite: e.target.value as LigneDevis['unite'] })
                        }
                      >
                        {UNITES.map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        aria-label={`Quantité de la ligne ${k + 1}`}
                        disabled={off}
                        value={l.quantite}
                        onChange={(e) =>
                          majLigne(k, { quantite: entier(e.target.value, 1, 10_000) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={`input num ${l.prixUnitaire === null ? 'vide' : ''}`}
                        type="number"
                        min={0}
                        placeholder="à fixer"
                        aria-label={`Prix unitaire : ${l.libelle}`}
                        disabled={off}
                        value={l.prixUnitaire ?? ''}
                        onChange={(e) =>
                          majLigne(k, {
                            prixUnitaire:
                              e.target.value === '' ? null : entier(e.target.value, 0, 10_000_000),
                          })
                        }
                      />
                      {!off && l.prixUnitaire === null && l.prixPropose != null && (
                        <button
                          className="btn ghost sm"
                          onClick={() => majLigne(k, { prixUnitaire: l.prixPropose ?? null })}
                        >
                          Reprendre {Math.round(l.prixPropose).toLocaleString('fr-FR')} €
                        </button>
                      )}
                    </td>
                    <td>
                      {!off && c.lignes.length > 1 && (
                        <button
                          className="btn ghost sm"
                          aria-label={`Retirer la ligne ${k + 1}`}
                          onClick={() => maj({ lignes: c.lignes.filter((_, i) => i !== k) })}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!off && (
              <button
                className="btn sm"
                style={{ marginTop: 8 }}
                onClick={() =>
                  maj({
                    lignes: [
                      ...c.lignes,
                      { libelle: '', unite: 'forfait', quantite: 1, prixUnitaire: null },
                    ],
                  })
                }
              >
                + Ajouter une ligne
              </button>
            )}
            <div className="d-duo" style={{ marginTop: 16 }}>
              {nombre('remisePct', 'Remise commerciale (%)', 0, 100)}
              {nombre('acomptePct', 'Acompte à la commande (%)', 0, 100)}
              <div className="d-bloc">
                <label htmlFor="dv-frais">Frais de déplacement</label>
                <select
                  id="dv-frais"
                  className="input"
                  disabled={off}
                  value={c.frais}
                  onChange={(e) => maj({ frais: e.target.value as ContenuDevis['frais'] })}
                >
                  <option value="refactures">Refacturés au réel</option>
                  <option value="inclus">Inclus dans le prix</option>
                </select>
              </div>
              {nombre('validiteJours', 'Validité du devis (jours)', 1, 365)}
            </div>
            <div className="d-total">
              <div>
                <span>Total HT avant remise</span>
                <span className="num">{eur2(totaux.brut)}</span>
              </div>
              {c.remisePct > 0 && (
                <div>
                  <span>Remise {c.remisePct} %</span>
                  <span className="num">− {eur2(totaux.remise)}</span>
                </div>
              )}
              <div>
                <span>Total HT</span>
                <span className="num">{eur2(totaux.ht)}</span>
              </div>
              <div>
                <span>TVA {d.tvaPct} %</span>
                <span className="num">{eur2(totaux.tva)}</span>
              </div>
              <div className="ttc">
                <span>Total TTC</span>
                <span className="num">{eur2(totaux.ttc)}</span>
              </div>
            </div>
          </>
        )}

        {etape === 'conditions' && (
          <>
            <p className="small muted">
              Les clauses viennent de la bibliothèque (Paramètres, onglet Devis). Cochez, modifiez
              ou ajoutez celles de ce devis : le texte est copié, la bibliothèque n’est pas touchée.
            </p>
            <div className="panel">
              <div className="panel-b">
                {c.clauses.map((cl, k) => (
                  <div key={k} className="d-clause">
                    <input
                      type="checkbox"
                      aria-label={`Clause active : ${cl.titre}`}
                      disabled={off}
                      checked={cl.active}
                      onChange={(e) => majClause(k, { active: e.target.checked })}
                    />
                    <div>
                      <input
                        className="input"
                        aria-label={`Titre de la clause ${k + 1}`}
                        disabled={off}
                        value={cl.titre}
                        onChange={(e) => majClause(k, { titre: e.target.value })}
                      />
                      <textarea
                        className="input"
                        aria-label={`Texte de la clause ${k + 1}`}
                        disabled={off}
                        value={cl.texte}
                        onChange={(e) => majClause(k, { texte: e.target.value })}
                      />
                    </div>
                    {!off && (
                      <button
                        className="btn ghost sm"
                        aria-label={`Retirer la clause ${k + 1}`}
                        onClick={() => maj({ clauses: c.clauses.filter((_, i) => i !== k) })}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {!c.clauses.length && <div className="empty">Aucune clause pour l’instant.</div>}
              </div>
            </div>
            {!off && clausesBib.length > 0 && (
              <label className="field" style={{ marginTop: 8 }}>
                <span>Insérer une clause de la bibliothèque</span>
                <select
                  className="input"
                  aria-label="Insérer une clause de la bibliothèque"
                  value=""
                  onChange={(e) => {
                    const b = clausesBib.find((x) => x.id === e.target.value);
                    if (b)
                      maj({
                        clauses: [...c.clauses, { titre: b.titre, texte: b.texte, active: true }],
                      });
                  }}
                >
                  <option value="">Choisir une clause…</option>
                  {clausesBib.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.titre}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!off && (
              <button
                className="btn sm"
                style={{ marginTop: 8 }}
                onClick={() =>
                  maj({
                    clauses: [...c.clauses, { titre: 'Nouvelle clause', texte: '', active: true }],
                  })
                }
              >
                + Ajouter une clause
              </button>
            )}
          </>
        )}

        {etape === 'envoi' && (
          <div className="panel">
            <div className="panel-b stack">
              <h3>Avant l’envoi</h3>
              {problemes.length ? (
                <ul style={{ margin: '0 0 0 18px' }}>
                  {problemes.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  <span className="badge green">Prêt</span> Tous les contrôles sont passés.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {brouillon && (
                  <button
                    className="btn primary"
                    disabled={bloque}
                    title={bloque ? 'Fixez tous les prix et le périmètre inclus' : undefined}
                    onClick={() => void valider()}
                  >
                    Valider le devis
                  </button>
                )}
                {d.statut === 'valide' && (
                  <button
                    className="btn go"
                    onClick={() =>
                      void transmettreDevis(slug, id).then(
                        () =>
                          setMessage(
                            'Transmission proposée : validez-la dans l’Inbox, c’est un engagement auprès du client.',
                          ),
                        err,
                      )
                    }
                  >
                    <Icon name="send" />
                    Demander l’envoi
                  </button>
                )}
                <a
                  className="btn"
                  href={`/api/i/${slug}/devis/${encodeURIComponent(id)}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Télécharger le PDF
                </a>
                {d.statut !== 'brouillon' && (
                  <button
                    className="btn"
                    onClick={() =>
                      void nouvelleVersionDevis(slug, id).then((v) => onOuvrir(v.id), err)
                    }
                  >
                    Nouvelle version
                  </button>
                )}
              </div>
              {d.statut === 'transmis' && d.envoyeLe && (
                <p className="small muted" style={{ margin: 0 }}>
                  Envoyé le {new Date(d.envoyeLe).toLocaleDateString('fr-FR')}.
                </p>
              )}
            </div>
          </div>
        )}
        {message && (
          <p className="small" role="status" style={{ marginTop: 10 }}>
            {message}
          </p>
        )}
      </div>
      <div className="d-prev-cadre">
        <div className="muted small" style={{ marginBottom: 6 }}>
          Aperçu : ce que recevra le client
        </div>
        <DevisApercu
          contenu={c}
          numero={d.numero}
          client={d.entreprise}
          contact={d.contact}
          date={d.createdAt}
          tvaPct={d.tvaPct}
          mentions={d.mentions}
        />
      </div>
    </div>
  );
}
