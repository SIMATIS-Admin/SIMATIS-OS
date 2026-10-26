import { useCallback, useEffect, useRef, useState } from 'react';
import {
  envoyerCompteRendu,
  fetchContacts,
  fetchEntreprises,
  fetchPreparation,
  creerRdvOs,
  fetchRendezVous,
  lierRendezVous,
  lierRdv,
  trierRdv,
  type Preparation,
  type RendezVous as Rdv,
  type RendezVousReponse,
  type StatutRdv,
} from '../api.js';
import { Fenetre } from './Fenetre.js';
import { Lien } from './taches/Edition.js';

type Choix = { id: string; nom: string } | null;

export const quand = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });

function PreparationPanel({ slug, rdv }: { slug: string; rdv: Rdv }) {
  const [p, setP] = useState<Preparation | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (rdv.opportunite) {
      fetchPreparation(slug, rdv.opportunite.id).then(setP, (e: unknown) => setError(String(e)));
    }
  }, [slug, rdv]);
  if (!rdv.opportunite) {
    return (
      <p className="small muted">
        Aucune opportunité ouverte liée à ce rendez-vous : ajoutez le contact invité dans le CRM.
      </p>
    );
  }
  if (error) return <p className="small muted">{error}</p>;
  if (!p) return null;
  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        <b>{p.entreprise ?? p.titre}</b>
        {p.secteur ? `, ${p.secteur}` : ''}
        {p.ville ? `, ${p.ville}` : ''}
        {p.taille ? `, ${p.taille} salariés` : ''}. Interlocuteur : <b>{p.contact ?? '—'}</b>
        {p.fonction ? `, ${p.fonction}` : ''} ({p.role ?? 'rôle à préciser'}).
      </p>
      <p style={{ margin: 0 }}>
        Qualification : <b>{p.score === null ? 'non évaluée' : `${p.score} / 15`}</b>
        {p.prochaineEtape ? ` · Prochaine étape notée : ${p.prochaineEtape}` : ''}
      </p>
      <h3 style={{ margin: 0 }}>À creuser pendant le rendez-vous</h3>
      {p.aCreuser.length ? (
        <ul className="checks">
          {p.aCreuser.map((c) => (
            <li key={c.critere}>
              <span>
                <b>{c.critere}</b>
                {c.note !== null ? ` (${c.note}/3)` : ''}
                {c.question ? ` : ${c.question}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small">La qualification est complète : préparez la proposition.</p>
      )}
    </div>
  );
}

function CompteRendu({ slug, rdv, onDone }: { slug: string; rdv: Rdv; onDone: () => void }) {
  const [texte, setTexte] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const save = () => {
    setBusy(true);
    envoyerCompteRendu(slug, rdv, texte).then(
      () => {
        setMessage('Compte rendu enregistré : une tâche pour la suite attend dans l’Inbox.');
        onDone();
      },
      (e: unknown) => {
        setMessage(e instanceof Error ? e.message : String(e));
        setBusy(false);
      },
    );
  };
  if (message) return <p className="small">{message}</p>;
  return (
    <div className="stack">
      <label className="field">
        <span>Ce qui s'est dit</span>
        <textarea
          className="input"
          rows={5}
          placeholder="Besoin, interlocuteurs, budget, échéance…"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
      </label>
      <p className="small muted" style={{ margin: 0 }}>
        L'OS proposera, pour validation, une tâche pour la prochaine étape.
      </p>
      <div>
        <button className="btn go" disabled={busy || !texte.trim()} onClick={save}>
          Enregistrer le compte rendu
        </button>
      </div>
    </div>
  );
}

// Contact or company of a meeting the guests' emails do not tell (kept in the OS only).
function LienRdv({ slug, rdv, onDone }: { slug: string; rdv: Rdv; onDone: () => void }) {
  const [personne, setPersonne] = useState<Choix>(rdv.contact);
  const [entreprise, setEntreprise] = useState<Choix>(rdv.entreprise);
  const [erreur, setErreur] = useState<string | null>(null);
  const chercherPersonne = useCallback(
    (q: string) => fetchContacts(slug, q).then((r) => r.map((c) => ({ id: c.id, nom: c.nom }))),
    [slug],
  );
  const chercherEntreprise = useCallback(
    (q: string) => fetchEntreprises(slug, q).then((r) => r.map((e) => ({ id: e.id, nom: e.nom }))),
    [slug],
  );
  const enregistrer = (lien: { contactId: string | null; entrepriseId: string | null }) =>
    lierRendezVous(slug, rdv.id, lien).then(onDone, (e: unknown) =>
      setErreur(e instanceof Error ? e.message : String(e)),
    );
  return (
    <div className="stack">
      <div className="grid g2">
        <Lien label="Contact" chercher={chercherPersonne} choix={personne} onChoix={setPersonne} />
        <Lien
          label="Entreprise"
          chercher={chercherEntreprise}
          choix={entreprise}
          onChoix={setEntreprise}
        />
      </div>
      {erreur && (
        <p className="small" style={{ color: 'var(--red)' }}>
          {erreur}
        </p>
      )}
      <div>
        <button
          className="btn go sm"
          onClick={() =>
            void enregistrer({
              contactId: personne?.id ?? null,
              entrepriseId: entreprise?.id ?? null,
            })
          }
        >
          Enregistrer le lien
        </button>{' '}
        {rdv.lienManuel && (
          <button
            className="btn sm"
            onClick={() => void enregistrer({ contactId: null, entrepriseId: null })}
          >
            Revenir aux invités du rendez-vous
          </button>
        )}
      </div>
    </div>
  );
}

type Onglet = 'a_trier' | 'rdv' | 'sans_cr' | 'ignore';
const ONGLETS: [Onglet, string][] = [
  ['a_trier', 'À trier'],
  ['rdv', 'Rendez-vous'],
  ['sans_cr', 'Sans compte rendu'],
  ['ignore', 'Ignorés'],
];
// A block the pilot has not sorted yet carries no statut in older answers.
const statutDe = (r: Rdv): StatutRdv => r.statut ?? 'a_trier';
const dansOnglet = (r: Rdv, onglet: Onglet, maintenant: number) =>
  onglet === 'sans_cr'
    ? statutDe(r) === 'rdv' && !r.compteRendu && new Date(r.debut).getTime() <= maintenant
    : statutDe(r) === onglet;
const jour = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Paris',
  });

const DUREES = [15, 30, 45, 60, 90, 120];

// A meeting that does not come from Google: title, moment, length, place. The links to contacts,
// companies and deals are added on its sheet, like for any meeting.
function NouveauRdv({ slug, onFermer }: { slug: string; onFermer: () => void }) {
  const [titre, setTitre] = useState('');
  const [date, setDate] = useState('');
  const [heure, setHeure] = useState('');
  const [duree, setDuree] = useState(60);
  const [lieu, setLieu] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const pret = titre.trim() !== '' && date !== '' && heure !== '';
  const creer = () => {
    setEnvoi(true);
    creerRdvOs(slug, {
      titre: titre.trim(),
      debut: new Date(`${date}T${heure}`).toISOString(),
      dureeMinutes: duree,
      lieu: lieu.trim() || null,
    }).then(
      (r) => {
        location.hash = `#/${slug}/fiche/rdv/${encodeURIComponent(r.id)}`;
      },
      (e: unknown) => {
        setErreur(e instanceof Error ? e.message : String(e));
        setEnvoi(false);
      },
    );
  };
  return (
    <Fenetre
      titre="Nouveau rendez-vous"
      sousTitre="Créé dans l’OS : il n’apparaît pas dans Google Agenda."
      onFermer={onFermer}
      pied={
        <>
          <button className="btn" onClick={onFermer}>
            Annuler
          </button>
          <button className="btn primary" disabled={!pret || envoi} onClick={creer}>
            Créer
          </button>
        </>
      }
    >
      <div className="stack">
        <label>
          Titre
          <input className="input" value={titre} onChange={(e) => setTitre(e.target.value)} />
        </label>
        <div className="grid g2">
          <label>
            Date
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Heure
            <input
              className="input"
              type="time"
              value={heure}
              onChange={(e) => setHeure(e.target.value)}
            />
          </label>
        </div>
        <div className="grid g2">
          <label>
            Durée
            <select
              className="input"
              value={duree}
              onChange={(e) => setDuree(Number(e.target.value))}
            >
              {DUREES.map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </select>
          </label>
          <label>
            Lieu
            <input className="input" value={lieu} onChange={(e) => setLieu(e.target.value)} />
          </label>
        </div>
        {erreur && <p style={{ color: 'var(--red)' }}>{erreur}</p>}
      </div>
    </Fenetre>
  );
}

export function RendezVous({ slug, ouvrir }: { slug: string; ouvrir?: string }) {
  const [data, setData] = useState<RendezVousReponse | null>(null);
  const [onglet, setOnglet] = useState<Onglet>('a_trier');
  const [ouvert, setOuvert] = useState<{ id: string; vue: 'prep' | 'cr' | 'lien' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);
  // The first read picks the tab: the blocks to sort when there are some, else the meetings.
  const premiere = useRef(true);
  const load = useCallback(() => {
    fetchRendezVous(slug).then(
      (r) => {
        if (premiere.current && !r.rdv.some((x) => statutDe(x) === 'a_trier')) setOnglet('rdv');
        premiere.current = false;
        setData(r);
      },
      (e: unknown) => setError(String(e)),
    );
  }, [slug]);
  useEffect(load, [load]);
  // Opened from the Agenda: the meeting's row shows its preparation straight away, scrolled into
  // view and highlighted, since it is often far down the list. Its tab comes forward first.
  const dejaOuvert = useRef<string | null>(null);
  useEffect(() => {
    const cible = ouvrir ? data?.rdv.find((r) => r.id === ouvrir) : undefined;
    // Once only: sorting the block afterwards must not pull the screen back to it.
    if (!cible || dejaOuvert.current === cible.id) return;
    dejaOuvert.current = cible.id;
    setOnglet(
      statutDe(cible) === 'a_trier' ? 'a_trier' : statutDe(cible) === 'ignore' ? 'ignore' : 'rdv',
    );
    setOuvert({ id: cible.id, vue: 'prep' });
  }, [ouvrir, data]);
  useEffect(() => {
    if (ouvert?.id === ouvrir) {
      document.getElementById(`rdv-${ouvrir}`)?.scrollIntoView?.({ block: 'start' });
    }
  }, [ouvert, ouvrir]);
  const trier = (r: Rdv, statut: StatutRdv) =>
    void trierRdv(slug, r.id, statut).then(load, (e: unknown) => setError(String(e)));
  // The guests' emails suggest a contact: validating it makes the link firm and the block a meeting.
  const validerSuggestion = (r: Rdv) =>
    void (async () => {
      if (r.contact) await lierRdv(slug, r.id, { kind: 'contact', id: r.contact.id });
      if (r.entreprise) await lierRdv(slug, r.id, { kind: 'entreprise', id: r.entreprise.id });
      await trierRdv(slug, r.id, 'rdv');
      load();
    })().catch((e: unknown) => setError(String(e)));

  if (error) return <div className="empty">{error}</div>;
  if (!data) return null;
  // Google's state goes next to the list: meetings created in the OS show whatever it says.
  const bandeau =
    data.etat === 'non_configure'
      ? 'Agenda non branché : connectez le compte Google du mandat dans Paramètres > Connexions.'
      : data.etat === 'erreur'
        ? (data.erreur ?? 'Agenda illisible.')
        : null;
  const creerBloc = (
    <>
      <div className="rdv-actions">
        <button className="btn primary" onClick={() => setCreation(true)}>
          + Nouveau rendez-vous
        </button>
      </div>
      {creation && <NouveauRdv slug={slug} onFermer={() => setCreation(false)} />}
    </>
  );
  if (bandeau && data.rdv.length === 0) {
    return (
      <>
        {creerBloc}
        <div className="empty">{bandeau}</div>
      </>
    );
  }
  const maintenant = Date.now();
  const visibles = data.rdv.filter((r) => dansOnglet(r, onglet, maintenant));
  const introuvable = ouvrir && !data.rdv.some((r) => r.id === ouvrir);
  return (
    <>
      {creerBloc}
      <div className="panel">
        {bandeau && (
          <p className="small muted" style={{ padding: '10px 12px 0', margin: 0 }}>
            {bandeau}
          </p>
        )}
        <div className="vq-filter rdv-onglets" role="tablist">
          {ONGLETS.map(([id, label]) => {
            const n = data.rdv.filter((r) => dansOnglet(r, id, maintenant)).length;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={onglet === id}
                className={`chip ${onglet === id ? 'on' : ''} ${id === 'a_trier' && n > 0 ? 'alerte' : ''}`}
                onClick={() => setOnglet(id)}
              >
                {label} ({n})
              </button>
            );
          })}
        </div>
        {introuvable && (
          <p className="small muted" style={{ padding: '10px 12px 0', margin: 0 }}>
            Ce rendez-vous est en dehors de la période affichée ici (semaine passée et deux
            prochaines).
          </p>
        )}
        {data.agendasIgnores && data.agendasIgnores.length > 0 && (
          <p className="small muted" style={{ padding: '10px 12px 0', margin: 0 }}>
            Agenda non lu : {data.agendasIgnores.join(', ')}. Décochez-le dans Paramètres &gt;
            Connexions.
          </p>
        )}
        {visibles.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Rendez-vous</th>
                <th>Liens</th>
                <th>Lieu</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((r, i) => {
                const passe = new Date(r.debut).getTime() <= maintenant;
                const statut = statutDe(r);
                const precedent = visibles[i - 1];
                return [
                  (!precedent || jour(precedent.debut) !== jour(r.debut)) && (
                    <tr key={`${r.id}-jour`} className="rdv-jour">
                      <td colSpan={5}>{jour(r.debut)}</td>
                    </tr>
                  ),
                  <tr key={r.id} id={`rdv-${r.id}`} className={r.id === ouvrir ? 'cible' : ''}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {quand(r.debut)}
                    </td>
                    <td>
                      <a href={`#/${slug}/fiche/rdv/${encodeURIComponent(r.id)}`}>
                        <b>{r.titre}</b>
                      </a>
                      {r.opportunite && <div className="small muted">{r.opportunite.titre}</div>}
                      {r.compteRendu && (
                        <div className="small" style={{ color: 'var(--green)' }}>
                          Compte rendu fait
                        </div>
                      )}
                    </td>
                    <td>
                      {r.contact || r.entreprise ? (
                        <div className="rdv-puces">
                          {r.entreprise && (
                            <a
                              className="fi-puce"
                              href={`#/${slug}/fiche/entreprise/${r.entreprise.id}`}
                            >
                              {r.entreprise.nom}
                            </a>
                          )}
                          {r.contact && (
                            <a className="fi-puce" href={`#/${slug}/fiche/contact/${r.contact.id}`}>
                              {r.contact.nom}
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="muted">Hors CRM</span>
                      )}
                      {statut !== 'ignore' && (
                        <div>
                          <button
                            className="lien"
                            onClick={() => setOuvert({ id: r.id, vue: 'lien' })}
                            aria-label={`Lier « ${r.titre} » à un contact ou une entreprise`}
                          >
                            {r.contact || r.entreprise ? 'Changer le lien' : 'Lier'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>{r.lieu ?? <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {statut === 'ignore' ? (
                        <button className="btn sm" onClick={() => trier(r, 'a_trier')}>
                          Remettre à trier
                        </button>
                      ) : statut === 'a_trier' ? (
                        <>
                          <button
                            className="btn go sm"
                            title={
                              r.contact && !r.lienManuel ? `Lier à ${r.contact.nom}` : undefined
                            }
                            onClick={() =>
                              r.contact && !r.lienManuel ? validerSuggestion(r) : trier(r, 'rdv')
                            }
                          >
                            C’est un RDV
                          </button>{' '}
                          <button className="btn sm" onClick={() => trier(r, 'ignore')}>
                            Pas un RDV
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn sm"
                            onClick={() => setOuvert({ id: r.id, vue: 'prep' })}
                          >
                            Préparer
                          </button>{' '}
                          {passe && !r.compteRendu && (
                            <button
                              className="btn go sm"
                              onClick={() => setOuvert({ id: r.id, vue: 'cr' })}
                            >
                              Compte rendu
                            </button>
                          )}{' '}
                          <button className="btn ghost sm" onClick={() => trier(r, 'ignore')}>
                            Pas un RDV
                          </button>
                        </>
                      )}
                    </td>
                  </tr>,
                  ouvert?.id === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={5}>
                        {ouvert.vue === 'lien' ? (
                          <LienRdv
                            slug={slug}
                            rdv={r}
                            onDone={() => {
                              setOuvert(null);
                              load();
                            }}
                          />
                        ) : ouvert.vue === 'prep' ? (
                          <PreparationPanel slug={slug} rdv={r} />
                        ) : (
                          <CompteRendu slug={slug} rdv={r} onDone={load} />
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            {onglet === 'a_trier'
              ? 'Rien à trier : tous les blocs de l’agenda ont été classés.'
              : onglet === 'ignore'
                ? 'Aucun bloc écarté.'
                : 'Aucun rendez-vous ici entre la semaine passée et les deux prochaines.'}
          </div>
        )}
      </div>
    </>
  );
}
