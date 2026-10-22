import { useCallback, useEffect, useState } from 'react';
import {
  envoyerCompteRendu,
  fetchContacts,
  fetchEntreprises,
  fetchPreparation,
  fetchRendezVous,
  lierRendezVous,
  type Preparation,
  type RendezVous as Rdv,
  type RendezVousReponse,
} from '../api.js';
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

export function RendezVous({ slug, ouvrir }: { slug: string; ouvrir?: string }) {
  const [data, setData] = useState<RendezVousReponse | null>(null);
  const [ouvert, setOuvert] = useState<{ id: string; vue: 'prep' | 'cr' | 'lien' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchRendezVous(slug).then(setData, (e: unknown) => setError(String(e)));
  }, [slug]);
  useEffect(load, [load]);
  // Opened from the Agenda: the meeting's row shows its preparation straight away, scrolled into
  // view and highlighted, since it is often far down the list.
  useEffect(() => {
    if (ouvrir && data?.rdv.some((r) => r.id === ouvrir)) setOuvert({ id: ouvrir, vue: 'prep' });
  }, [ouvrir, data]);
  useEffect(() => {
    if (ouvert?.id === ouvrir) {
      document.getElementById(`rdv-${ouvrir}`)?.scrollIntoView?.({ block: 'start' });
    }
  }, [ouvert, ouvrir]);

  if (error) return <div className="empty">{error}</div>;
  if (!data) return null;
  if (data.etat === 'non_configure') {
    return (
      <div className="empty">
        Agenda non branché : connectez le compte Google du mandat dans Paramètres &gt; Connexions.
      </div>
    );
  }
  if (data.etat === 'erreur') return <div className="empty">{data.erreur}</div>;
  const maintenant = Date.now();
  const introuvable = ouvrir && !data.rdv.some((r) => r.id === ouvrir);
  return (
    <div className="panel">
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
      {data.rdv.length ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th>Rendez-vous</th>
              <th>Interlocuteur</th>
              <th>Lieu</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rdv.map((r) => {
              const passe = new Date(r.debut).getTime() <= maintenant;
              return [
                <tr key={r.id} id={`rdv-${r.id}`} className={r.id === ouvrir ? 'cible' : ''}>
                  <td className="num">{quand(r.debut)}</td>
                  <td>
                    <b>{r.titre}</b>
                    {r.opportunite && <div className="small muted">{r.opportunite.titre}</div>}
                    {r.compteRendu && (
                      <div className="small" style={{ color: 'var(--green)' }}>
                        Compte rendu fait
                      </div>
                    )}
                  </td>
                  <td>
                    {r.contact || r.entreprise ? (
                      <>
                        {r.contact?.nom ?? r.entreprise?.nom}
                        {r.contact && r.entreprise && (
                          <div className="small muted">{r.entreprise.nom}</div>
                        )}
                      </>
                    ) : (
                      <span className="muted">Hors CRM</span>
                    )}
                    <div>
                      <button
                        className="lien"
                        onClick={() => setOuvert({ id: r.id, vue: 'lien' })}
                        aria-label={`Lier « ${r.titre} » à un contact ou une entreprise`}
                      >
                        {r.contact || r.entreprise ? 'Changer le lien' : 'Lier'}
                      </button>
                    </div>
                  </td>
                  <td>{r.lieu ?? <span className="muted">—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => setOuvert({ id: r.id, vue: 'prep' })}>
                      Préparer
                    </button>{' '}
                    {passe && !r.compteRendu && (
                      <button
                        className="btn go sm"
                        onClick={() => setOuvert({ id: r.id, vue: 'cr' })}
                      >
                        Compte rendu
                      </button>
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
          Aucun rendez-vous entre la semaine passée et les deux prochaines.
        </div>
      )}
    </div>
  );
}
