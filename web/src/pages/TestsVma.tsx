import { useEffect, useState } from 'react';
import {
  ApiError,
  creerTestVma,
  fetchTestsVma,
  relancerTestVma,
  revoquerTestVma,
  type FreinVma,
  type NouveauTestVma,
  type TestVma,
  type TestVmaCree,
  type TestVmaType,
} from '../api.js';
import type { EnvoiInvitation } from '../api.js';
import { messageEnvoi } from './diagnostics/envoi.js';

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Libellés des statuts d'invitation, tels que Marc les voit dans la liste.
export const libelleStatut = (t: Pick<TestVma, 'statut' | 'expireLe'>, maintenant = Date.now()) => {
  if (t.statut === 'utilisee') return 'Utilisée';
  if (t.statut === 'revoquee') return 'Révoquée';
  return Date.parse(t.expireLe) > maintenant ? 'Envoyée' : 'Expirée';
};

const JOUR_MS = 24 * 3600 * 1000;
const jourMois = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

// Invitation encore ouverte : ni utilisée, ni révoquée, ni expirée.
const ouverte = (t: Pick<TestVma, 'statut' | 'expireLe'>, maintenant: number) =>
  t.statut === 'envoyee' && Date.parse(t.expireLe) > maintenant;

// Le bouton Relancer : une invitation ouverte, avec une adresse où écrire.
export const peutRelancer = (
  t: Pick<TestVma, 'statut' | 'expireLe' | 'contactEmail'>,
  maintenant = Date.now(),
) => ouverte(t, maintenant) && Boolean(t.contactEmail);

// Filtre « Sans réponse » : ouverte, et envoyée il y a plus de 7 jours.
export const sansReponse = (
  t: Pick<TestVma, 'statut' | 'expireLe' | 'envoyeeLe'>,
  maintenant = Date.now(),
) =>
  ouverte(t, maintenant) &&
  t.envoyeeLe !== null &&
  maintenant - Date.parse(t.envoyeeLe) > 7 * JOUR_MS;

// La frise d'une invitation : envoi, relances, résultat ; une étape non atteinte reste grisée.
export function etapesFrise(
  t: Pick<TestVma, 'statut' | 'envoyeeLe' | 'relances'>,
): { libelle: string; fait: boolean }[] {
  return [
    t.envoyeeLe
      ? { libelle: `Envoyé ${jourMois(t.envoyeeLe)}`, fait: true }
      : { libelle: 'Envoyé', fait: false },
    ...t.relances.map((r) => ({
      libelle: `Relancé ${jourMois(r.le)}${r.origine === 'auto' ? ' (auto)' : ''}`,
      fait: true,
    })),
    { libelle: 'Test passé', fait: t.statut === 'utilisee' },
  ];
}

const messageRelance = (envoi: EnvoiInvitation, email: string | null) =>
  envoi.statut === 'envoye'
    ? `Relance envoyée à ${email ?? 'le dirigeant'}.`
    : envoi.statut === 'simule'
      ? 'Relance non envoyée : les écritures réelles sont désactivées (simulation).'
      : `Relance non envoyée${envoi.raison ? ` : ${envoi.raison}` : ''}.`;

const TYPES: [TestVmaType, string][] = [
  ['premier', 'Premier test'],
  ['essai', 'Essai (non compté dans l’historique)'],
];

// Euros formatés comme dans le reste de l'OS : « 15 k€ », espace insécable avant l'unité.
const NB = '\u00a0';
export const fmtEur = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${NB}M€`;
  if (a >= 1000)
    return `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NB}k€`;
  return `${Math.round(v).toLocaleString('fr-FR')}${NB}€`;
};
const pct = (x: number) =>
  `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}${NB}%`;

export function TestsVma({ slug }: { slug: string }) {
  const [tests, setTests] = useState<TestVma[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState<NouveauTestVma>({
    entrepriseNom: '',
    type: 'premier',
    contactNom: '',
    contactEmail: '',
    tutoiement: false,
  });
  const [lienCree, setLienCree] = useState<string | null>(null);
  const [mailCree, setMailCree] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [relance, setRelance] = useState<{ test: TestVma; tu: boolean } | null>(null);
  const [infoRelance, setInfoRelance] = useState<string | null>(null);
  const [filtreSansReponse, setFiltreSansReponse] = useState(false);

  const charger = () =>
    fetchTestsVma(slug)
      .then((liste) => {
        setTests(liste);
        setErreur(null);
      })
      .catch((e: unknown) => setErreur(messageErreur(e)));

  useEffect(() => {
    setTests(null);
    void charger();
  }, [slug]);

  const creer = async () => {
    setEnvoi(true);
    setErreur(null);
    const demande: NouveauTestVma = {
      entrepriseNom: nouveau.entrepriseNom,
      type: nouveau.type,
      contactNom: nouveau.contactNom || null,
      contactEmail: nouveau.contactEmail || null,
      tutoiement: nouveau.tutoiement ?? false,
    };
    try {
      let cree: TestVmaCree;
      try {
        cree = await creerTestVma(slug, demande);
      } catch (e) {
        // Règle du semestre : Marc confirme ou renonce, rien n'est créé sans sa réponse.
        if (!(e instanceof ApiError && e.status === 409 && e.corps.code === 'semestre')) throw e;
        if (!window.confirm(`${e.message}\n\nCréer quand même cette invitation ?`)) return;
        cree = await creerTestVma(slug, { ...demande, confirmerSemestre: true });
      }
      setLienCree(cree.lien);
      setMailCree(messageEnvoi(cree.envoi, cree.contactEmail));
      setNouveau({
        entrepriseNom: '',
        type: 'premier',
        contactNom: '',
        contactEmail: '',
        tutoiement: false,
      });
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  const revoquer = async (t: TestVma) => {
    if (
      !window.confirm(`Révoquer l’invitation de ${t.entrepriseNom} ? Le lien ne fonctionnera plus.`)
    )
      return;
    try {
      await revoquerTestVma(slug, t.id);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  const envoyerRelance = async () => {
    if (!relance) return;
    setErreur(null);
    try {
      const res = await relancerTestVma(slug, relance.test.id, relance.tu);
      setInfoRelance(messageRelance(res.envoi ?? { statut: 'echec' }, res.contactEmail));
      setRelance(null);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  const copier = (lien: string) => {
    void navigator.clipboard?.writeText(lien);
  };

  const detail = tests?.find((t) => t.id === ouvert) ?? null;
  const peutEnvoyer = nouveau.entrepriseNom.trim().length > 0 && !envoi;

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-h">
          <span>Tests VMA</span>
        </div>
        <div className="panel-b stack">
          <p className="small muted">
            Auto-diagnostic envoyé par invitation : le dirigeant ouvre le lien, passe le test en
            environ 15 minutes, et son résultat arrive ici. Cette procédure est séparée des
            diagnostics d’endurance.
          </p>
          {erreur && <div className="alert amber">{erreur}</div>}
          {lienCree && (
            <div className="alert">
              <div>Invitation créée. Lien à transmettre au dirigeant :</div>
              <div className="mono">{lienCree}</div>
              {mailCree && <div>{mailCree}</div>}
              <div className="row">
                <button className="btn" type="button" onClick={() => copier(lienCree)}>
                  Copier le lien
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <span>Inviter un dirigeant</span>
        </div>
        <form
          className="panel-b stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (peutEnvoyer) void creer();
          }}
        >
          <label className="field">
            <span>Entreprise</span>
            <input
              value={nouveau.entrepriseNom}
              onChange={(e) => setNouveau({ ...nouveau, entrepriseNom: e.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>Type</span>
            <select
              value={nouveau.type}
              onChange={(e) => setNouveau({ ...nouveau, type: e.target.value as TestVmaType })}
            >
              {TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Nom du dirigeant (facultatif)</span>
            <input
              value={nouveau.contactNom ?? ''}
              onChange={(e) => setNouveau({ ...nouveau, contactNom: e.target.value })}
            />
          </label>
          <label className="field">
            <span>E-mail du dirigeant (pour le brouillon du résultat)</span>
            <input
              type="email"
              value={nouveau.contactEmail ?? ''}
              onChange={(e) => setNouveau({ ...nouveau, contactEmail: e.target.value })}
            />
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={nouveau.tutoiement ?? false}
              onChange={(e) => setNouveau({ ...nouveau, tutoiement: e.target.checked })}
            />
            <span>Tutoyer le dirigeant</span>
          </label>
          <div className="row">
            <button className="btn go" type="submit" disabled={!peutEnvoyer}>
              Créer l’invitation
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-h">
          <span>Invitations et résultats</span>
        </div>
        <div className="panel-b stack">
          {tests === null && !erreur && <p className="small muted">Chargement…</p>}
          {tests?.length === 0 && <p className="small muted">Aucune invitation pour l’instant.</p>}
          {infoRelance && <div className="alert">{infoRelance}</div>}
          {relance && (
            <div className="alert stack">
              <div>
                Relancer {relance.test.contactNom ?? relance.test.entrepriseNom} (
                {relance.test.contactEmail}) : un court rappel, avec le même lien.
              </div>
              <label className="row">
                <input
                  type="checkbox"
                  checked={relance.tu}
                  onChange={(e) => setRelance({ ...relance, tu: e.target.checked })}
                />
                <span>Tutoyer pour cette relance</span>
              </label>
              <div className="row">
                <button className="btn go" type="button" onClick={() => void envoyerRelance()}>
                  Envoyer la relance
                </button>
                <button className="btn" type="button" onClick={() => setRelance(null)}>
                  Annuler
                </button>
              </div>
            </div>
          )}
          {tests && tests.length > 0 && (
            <label className="row small">
              <input
                type="checkbox"
                checked={filtreSansReponse}
                onChange={(e) => setFiltreSansReponse(e.target.checked)}
              />
              <span>Sans réponse depuis plus de 7 jours</span>
            </label>
          )}
          {tests
            ?.filter((t) => !filtreSansReponse || sansReponse(t))
            .map((t) => (
              <div key={t.id} className="stack">
                <div className="row">
                  <div className="stack">
                    <strong>{t.entrepriseNom}</strong>
                    <span className="small muted">
                      {t.type === 'essai' ? 'Essai' : 'Premier test'} · {libelleStatut(t)}
                      {t.recueLe
                        ? ` · reçu le ${new Date(t.recueLe).toLocaleDateString('fr-FR')}`
                        : ''}
                    </span>
                  </div>
                  <div className="row">
                    {t.statut === 'envoyee' && (
                      <>
                        {peutRelancer(t) && (
                          <button
                            className="btn"
                            type="button"
                            onClick={() => {
                              setInfoRelance(null);
                              setRelance({ test: t, tu: t.tutoiement });
                            }}
                          >
                            Relancer
                          </button>
                        )}
                        <button className="btn" type="button" onClick={() => copier(t.lien)}>
                          Copier le lien
                        </button>
                        <button className="btn" type="button" onClick={() => void revoquer(t)}>
                          Révoquer
                        </button>
                      </>
                    )}
                    {t.resultat && (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setOuvert(ouvert === t.id ? null : t.id)}
                      >
                        {ouvert === t.id ? 'Fermer' : 'Voir le résultat'}
                      </button>
                    )}
                  </div>
                </div>
                <ol className="frise small">
                  {etapesFrise(t).map((e, i) => (
                    <li key={i} className={e.fait ? 'fait' : 'attente'}>
                      {e.libelle}
                    </li>
                  ))}
                </ol>
                {t.echecEnvoi && (
                  <span className="small muted">Dernier envoi en échec : {t.echecEnvoi}</span>
                )}
              </div>
            ))}
        </div>
      </div>

      {detail?.resultat && <FicheResultat t={detail} />}
    </div>
  );
}

type ResultatVma = NonNullable<TestVma['resultat']>;

// Un frein comme le mail le présente : titre, phrase, puis enjeu, réponse, pratique visée, actions et signe.
function FreinVu({ f, textes }: { f: FreinVma; textes: Record<string, string> }) {
  return (
    <li>
      <strong>{f.titre}</strong> : {f.phrase}
      {typeof f.enjeu === 'number' && f.enjeu > 0 && (
        <div className="small">
          {textes.libelleEnjeu ?? 'Enjeu estimé'} : environ +{fmtEur(f.enjeu)} par mois*
        </div>
      )}
      {f.reponse && (
        <div className="small">
          {textes.libelleReponse ?? 'Votre réponse'} : « {f.reponse} »
        </div>
      )}
      {f.cible && f.cible !== f.reponse && (
        <div className="small">
          {textes.libelleCible ?? 'Les plus avancés'} : « {f.cible} »
        </div>
      )}
      {f.debut && f.debut.length > 0 && (
        <div className="small">
          <strong>{textes.libelleDebut ?? 'Par où commencer'}</strong>
          <ul>
            {f.debut.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {f.signe && (
        <div className="small">
          {textes.libelleSigne ?? 'Signe que c’est en place'} : {f.signe}
        </div>
      )}
    </li>
  );
}

// Les freins tels que le dirigeant les a reçus par mail : en mode portefeuille, deux listes (conquête
// et portefeuille) avec l'écart de chacune ; sinon une seule liste.
function FreinsVus({ r }: { r: ResultatVma }) {
  const textes = r.textes ?? {};
  const note = r.freins.some((f) => typeof f.enjeu === 'number' && f.enjeu > 0) && textes.noteEnjeu;
  const echeance = `${r.echeance} an${r.echeance < 2 ? '' : 's'}`;
  const ecart = (nom: string, cible: number, lancee: number, ecartV: number) =>
    ecartV > 0
      ? `${nom} : votre cible est de ${fmtEur(cible)} par mois ; sur votre lancée, ${fmtEur(lancee)} dans ${echeance}, soit ${fmtEur(ecartV)} par mois d’écart.`
      : `${nom} : votre cible de ${fmtEur(cible)} par mois est couverte sur votre lancée (${fmtEur(lancee)} dans ${echeance}).`;
  const section = (titre: string, phrase: string, liste: FreinVma[]) => (
    <div key={titre}>
      <div className="small muted">{titre}</div>
      {phrase && <p className="small">{phrase}</p>}
      <ol>
        {liste.map((f) => (
          <FreinVu key={f.n} f={f} textes={textes} />
        ))}
      </ol>
    </div>
  );
  const portefeuille = r.modePortefeuille === true && (r.recurrent ?? 0) > 0;
  return (
    <>
      {portefeuille ? (
        <>
          {section(
            textes.titreConquete ?? 'Conquête',
            ecart(
              textes.libelleNouvellesAffaires ?? 'Nouvelles affaires',
              r.spotCible ?? 0,
              r.spotEcheance ?? 0,
              r.ecartSpot ?? 0,
            ),
            r.freinsConquete ?? [],
          )}
          {section(
            textes.titrePortefeuille ?? 'Portefeuille',
            ecart(
              textes.libelleSocleRecurrent ?? 'Socle récurrent',
              r.recurrentCible ?? 0,
              r.socleEcheance ?? 0,
              r.ecartRecurrent ?? 0,
            ) +
              (r.partRecVisee != null && r.partRecActuelle != null
                ? ` Part visée : ${pct(r.partRecVisee)} (aujourd’hui ${pct(r.partRecActuelle)}).`
                : ''),
            r.freinsPortefeuille ?? [],
          )}
        </>
      ) : (
        <ol>
          {r.freins.map((f) => (
            <FreinVu key={f.n} f={f} textes={textes} />
          ))}
        </ol>
      )}
      {note && <p className="small muted">* {textes.noteEnjeu}</p>}
    </>
  );
}

// Fiche de résultat : ce que le dirigeant a vu, puis le détail réservé à Marc (gains, blocs).
function FicheResultat({ t }: { t: TestVma }) {
  const r = t.resultat;
  const c = t.calcul;
  if (!r) return null;
  return (
    <div className="panel">
      <div className="panel-h">
        <span>Résultat de {t.entrepriseNom}</span>
      </div>
      <div className="panel-b stack">
        <p>
          <strong>VMA : </strong>
          {r.mesurable
            ? `${fmtEur(r.vma)} de CA commandé par mois (${fmtEur((r.vma ?? 0) * 12)} par an)`
            : 'non mesurable'}
          {' · '}
          {r.statut} · {r.tenue}
        </p>
        {r.recurrent !== null && r.recurrent !== undefined && (
          <p>
            <strong>Socle récurrent : </strong>
            {fmtEur(r.recurrent)} par mois · <strong>allure actuelle : </strong>
            {fmtEur(r.allureActuelle)} par mois
          </p>
        )}
        {typeof r.trajectoire === 'number' && (
          <p>
            <strong>Sur sa lancée dans {r.echeance} an(s) : </strong>
            {fmtEur(r.trajectoire)} par mois · socle récurrent {fmtEur(r.recurrent ?? 0)} →{' '}
            {fmtEur(r.socleEcheance ?? 0)} par mois
          </p>
        )}
        <p>
          <strong>Ambition : </strong>
          {r.niveau.label} · {fmtEur(r.allureVisee)} par mois dans {r.echeance} an(s)
        </p>
        <p className="small muted">{r.niveau.phrase}</p>
        <div className="small muted">Ce que le dirigeant a vu</div>
        <FreinsVus r={r} />

        <div className="small muted">Pour Marc uniquement</div>
        {c?.potentiel !== undefined && (
          <p className="small">
            Potentiel brut : +{fmtEur(c.potentiel)} par mois · part à convertir :{' '}
            {c.niveau?.part !== undefined ? pct(c.niveau.part) : '—'}
          </p>
        )}
        {c?.recurrent !== undefined && c.recurrent > 0 && (
          <p className="small">
            Part du récurrent dans le CA des 12 derniers mois :{' '}
            {c.partRecurrent !== null && c.partRecurrent !== undefined ? pct(c.partRecurrent) : '—'}
            {' · '}allure actuelle / CA :{' '}
            {c.ratioAllure !== null && c.ratioAllure !== undefined ? pct(c.ratioAllure) : '—'}
            {c.recurrentEstime ? ' · récurrent déclaré estimé' : ''}
          </p>
        )}
        {c?.attrition !== undefined && (c.recurrent ?? 0) > 0 && (
          <p className="small">
            Portefeuille : contrats récurrents {pct(c.partRec ?? 0)} des commandes · attrition{' '}
            {pct(c.attrition)} par an · développement {pct(c.developpement ?? 0)} par an
            {c.potentielVma !== undefined
              ? ` · potentiel de la seule VMA : +${fmtEur(c.potentielVma)} par mois`
              : ''}
          </p>
        )}
        {c?.freins && (
          <table className="small">
            <thead>
              <tr>
                <th>#</th>
                <th>Frein</th>
                <th>Note</th>
                <th>Gain max</th>
                <th>Gain restant</th>
                <th>Poids à l’échéance</th>
                <th>Bloc du plan d’action</th>
              </tr>
            </thead>
            <tbody>
              {c.freins.map((f) => (
                <tr key={f.n}>
                  <td>{f.n}</td>
                  <td>
                    {f.label}
                    {f.moteur === 'portefeuille' ? ' (portefeuille)' : ''}
                  </td>
                  <td>{f.note} / 4</td>
                  <td>{pct(f.gainMax)}</td>
                  <td>{pct(f.gainRestant)}</td>
                  <td>{f.impact !== undefined ? `+${fmtEur(f.impact)} / mois` : '—'}</td>
                  <td>{f.bloc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
