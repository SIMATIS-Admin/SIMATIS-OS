import { useEffect, useState } from 'react';
import {
  ApiError,
  creerTestVma,
  fetchTestsVma,
  revoquerTestVma,
  type NouveauTestVma,
  type TestVma,
  type TestVmaType,
} from '../api.js';

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Libellés des statuts d'invitation, tels que Marc les voit dans la liste.
export const libelleStatut = (t: Pick<TestVma, 'statut' | 'expireLe'>, maintenant = Date.now()) => {
  if (t.statut === 'utilisee') return 'Utilisée';
  if (t.statut === 'revoquee') return 'Révoquée';
  return Date.parse(t.expireLe) > maintenant ? 'Envoyée' : 'Expirée';
};

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
  });
  const [lienCree, setLienCree] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

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
    };
    try {
      let cree: TestVma;
      try {
        cree = await creerTestVma(slug, demande);
      } catch (e) {
        // Règle du semestre : Marc confirme ou renonce, rien n'est créé sans sa réponse.
        if (!(e instanceof ApiError && e.status === 409 && e.corps.code === 'semestre')) throw e;
        if (!window.confirm(`${e.message}\n\nCréer quand même cette invitation ?`)) return;
        cree = await creerTestVma(slug, { ...demande, confirmerSemestre: true });
      }
      setLienCree(cree.lien);
      setNouveau({ entrepriseNom: '', type: 'premier', contactNom: '', contactEmail: '' });
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
          {tests?.map((t) => (
            <div key={t.id} className="row">
              <div className="stack">
                <strong>{t.entrepriseNom}</strong>
                <span className="small muted">
                  {t.type === 'essai' ? 'Essai' : 'Premier test'} · {libelleStatut(t)}
                  {t.recueLe ? ` · reçu le ${new Date(t.recueLe).toLocaleDateString('fr-FR')}` : ''}
                </span>
              </div>
              <div className="row">
                {t.statut === 'envoyee' && (
                  <>
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
          ))}
        </div>
      </div>

      {detail?.resultat && <FicheResultat t={detail} />}
    </div>
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
        <p>
          <strong>Ambition : </strong>
          {r.niveau.label} · {fmtEur(r.allureVisee)} par mois dans {r.echeance} an(s)
        </p>
        <p className="small muted">{r.niveau.phrase}</p>
        <div className="small muted">Ce que le dirigeant a vu</div>
        <ol>
          {r.freins.map((f) => (
            <li key={f.n}>
              <strong>{f.titre}</strong> : {f.phrase}
            </li>
          ))}
        </ol>

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
        {c?.freins && (
          <table className="small">
            <thead>
              <tr>
                <th>#</th>
                <th>Frein</th>
                <th>Note</th>
                <th>Gain max</th>
                <th>Gain restant</th>
                <th>Bloc du plan d’action</th>
              </tr>
            </thead>
            <tbody>
              {c.freins.map((f) => (
                <tr key={f.n}>
                  <td>{f.n}</td>
                  <td>{f.label}</td>
                  <td>{f.note} / 4</td>
                  <td>{pct(f.gainMax)}</td>
                  <td>{pct(f.gainRestant)}</td>
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
