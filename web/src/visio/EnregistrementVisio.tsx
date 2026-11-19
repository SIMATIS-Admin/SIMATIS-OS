import { useCallback, useEffect, useState } from 'react';
import {
  creerRdvOs,
  enregistrerCompteRenduRdv,
  fetchDerniereSessionVisio,
  fetchRendezVous,
  fetchSessionVisio,
  garderTranscriptDansRdv,
  modifierEnregistrement,
  rattacherEnregistrement,
  supprimerEnregistrement,
  type RendezVous,
  type SessionVisio,
} from '../api.js';

const erreurDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

const quand = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });

// Un enregistrement mal rangé (typiquement un enregistrement libre) : Marc le rattache à un
// rendez-vous qui existe déjà, ou en crée un sur place, pour le lier à l'organisation, au contact
// et à l'affaire.
function Rattacher({
  slug,
  rdvId,
  sessionId,
  onRattache,
}: {
  slug: string;
  rdvId: string;
  sessionId: string;
  onRattache: (rdvId: string) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [rdv, setRdv] = useState<RendezVous[] | null>(null);
  const [choix, setChoix] = useState('');
  const [nouveau, setNouveau] = useState(false);
  const [titre, setTitre] = useState('');
  const [debut, setDebut] = useState('');
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!ouvert || rdv) return;
    fetchRendezVous(slug).then(
      (r) =>
        setRdv(
          r.rdv
            .filter((x) => x.id !== rdvId && x.statut !== 'ignore')
            .sort((a, b) => b.debut.localeCompare(a.debut)),
        ),
      (e: unknown) => {
        setRdv([]);
        setErreur(erreurDe(e));
      },
    );
  }, [ouvert, rdv, slug, rdvId]);

  const rattacher = (cible: string) => {
    setBusy(true);
    setErreur(null);
    rattacherEnregistrement(slug, sessionId, cible).then(
      () => onRattache(cible),
      (e: unknown) => {
        setBusy(false);
        setErreur(erreurDe(e));
      },
    );
  };
  const creer = () => {
    setBusy(true);
    setErreur(null);
    creerRdvOs(slug, {
      titre: titre.trim(),
      debut: new Date(debut).toISOString(),
      dureeMinutes: 60,
      lieu: null,
    }).then(
      (r) => rattacher(r.id),
      (e: unknown) => {
        setBusy(false);
        setErreur(erreurDe(e));
      },
    );
  };

  if (!ouvert) {
    return (
      <div className="row">
        <button className="btn" onClick={() => setOuvert(true)}>
          Rattacher à un autre rendez-vous
        </button>
      </div>
    );
  }
  return (
    <section className="visio-rattacher" aria-label="Rattacher à un rendez-vous">
      <h3>Rattacher à un autre rendez-vous</h3>
      <p className="small muted">
        L’enregistrement, son résumé et son transcript suivent le rendez-vous choisi, avec son
        organisation, son contact et son affaire.
      </p>
      {!nouveau ? (
        <>
          <label>
            Rendez-vous existant
            <select
              className="input"
              value={choix}
              onChange={(e) => setChoix(e.target.value)}
              disabled={!rdv}
            >
              <option value="">{rdv ? 'Choisir un rendez-vous…' : 'Chargement…'}</option>
              {(rdv ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {quand(r.debut)} · {r.titre || 'Sans titre'}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button
              className="btn primary"
              disabled={!choix || busy}
              onClick={() => rattacher(choix)}
            >
              Rattacher
            </button>
            <button className="btn" onClick={() => setNouveau(true)}>
              Créer un rendez-vous
            </button>
            <button className="btn" onClick={() => setOuvert(false)}>
              Annuler
            </button>
          </div>
        </>
      ) : (
        <>
          <label>
            Titre du rendez-vous
            <input className="input" value={titre} onChange={(e) => setTitre(e.target.value)} />
          </label>
          <label>
            Date et heure
            <input
              className="input"
              type="datetime-local"
              value={debut}
              onChange={(e) => setDebut(e.target.value)}
            />
          </label>
          <div className="row">
            <button
              className="btn primary"
              disabled={!titre.trim() || !debut || busy}
              onClick={creer}
            >
              Créer et rattacher
            </button>
            <button className="btn" onClick={() => setNouveau(false)}>
              Choisir un rendez-vous existant
            </button>
          </div>
        </>
      )}
      {erreur && <p style={{ color: 'var(--red)' }}>{erreur}</p>}
    </section>
  );
}

// Le dernier enregistrement d'un rendez-vous : texte en direct, résumé, transcript. Marc peut les
// corriger, les supprimer, faire du résumé le compte rendu, garder le transcript dans le rendez-vous
// ou rattacher l'enregistrement à un autre rendez-vous. L'enregistrement lui-même se lance depuis
// l'appli Mac « Visio SIMATIS ».
export function EnregistrementVisio({
  slug,
  rdvId,
  titre = 'Visio',
  intervalleMs = 3000,
  onSupprime,
  onRattache,
}: {
  slug: string;
  rdvId: string;
  titre?: string;
  intervalleMs?: number;
  onSupprime?: () => void;
  onRattache?: (rdvId: string) => void;
}) {
  const [session, setSession] = useState<SessionVisio | null>(null);
  const [charge, setCharge] = useState(false);
  const [edition, setEdition] = useState<{ resume: string; transcript: string } | null>(null);
  const [crFait, setCrFait] = useState(false);
  const [transcriptFait, setTranscriptFait] = useState(false);
  const [onglet, setOnglet] = useState<'resume' | 'transcript'>('resume');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetchDerniereSessionVisio(slug, rdvId).then(
      (s) => {
        setSession(s);
        setCharge(true);
      },
      (e: unknown) => {
        setErreur(erreurDe(e));
        setCharge(true);
      },
    );
  }, [slug, rdvId]);

  // Tant que la session avance (enregistrement, transcription, résumé), on la relit.
  const id = session?.id;
  const avance =
    !!session &&
    !edition &&
    (session.statut === 'en_cours' ||
      session.statut === 'clos' ||
      (session.statut === 'transcrit' && !!session.transcript && !session.resume));
  useEffect(() => {
    if (!avance || !id) return;
    const t = setInterval(() => {
      fetchSessionVisio(slug, id).then(setSession, () => undefined);
    }, intervalleMs);
    return () => clearInterval(t);
  }, [avance, id, slug, intervalleMs]);

  const enregistrer = useCallback(() => {
    if (!session || !edition) return;
    modifierEnregistrement(slug, session.id, {
      resume: edition.resume,
      transcript: edition.transcript,
    }).then(
      (s) => {
        setSession(s);
        setEdition(null);
        setCrFait(false);
        setTranscriptFait(false);
      },
      (e: unknown) => setErreur(erreurDe(e)),
    );
  }, [slug, session, edition]);

  const supprimer = () => {
    if (!session) return;
    if (
      !confirm(
        'Supprimer cet enregistrement, son texte et son résumé ? Cette action est définitive.',
      )
    ) {
      return;
    }
    supprimerEnregistrement(slug, session.id).then(
      () => {
        setSession(null);
        onSupprime?.();
      },
      (e: unknown) => setErreur(erreurDe(e)),
    );
  };

  const utiliserCommeCompteRendu = () => {
    if (!session?.resume) return;
    enregistrerCompteRenduRdv(slug, { id: rdvId, titre }, session.resume, {
      proposerTache: true,
      versCerveau: true,
    }).then(
      () => setCrFait(true),
      (e: unknown) => setErreur(erreurDe(e)),
    );
  };

  const garderTranscript = () => {
    if (!session) return;
    garderTranscriptDansRdv(slug, session.id).then(
      () => setTranscriptFait(true),
      (e: unknown) => setErreur(erreurDe(e)),
    );
  };

  // Par défaut, on retourne à la fiche du rendez-vous qui vient de recevoir l'enregistrement.
  const apresRattachement = (cible: string) => {
    if (onRattache) onRattache(cible);
    else location.hash = `#/${slug}/fiche/rdv/${encodeURIComponent(cible)}`;
  };

  if (!charge) return <p className="muted">Chargement…</p>;
  if (!session) {
    return (
      <>
        <p className="muted">
          Aucun enregistrement pour ce rendez-vous. Lancez-le depuis l’appli Visio SIMATIS.
        </p>
        {erreur && <p style={{ color: 'var(--red)' }}>{erreur}</p>}
      </>
    );
  }
  return (
    <div className="stack">
      {session.statut === 'en_cours' && <p role="status">Enregistrement en cours…</p>}
      {session.statut === 'clos' && (
        <p role="status">
          Transcription en cours ({session.transcrits} morceaux sur {session.morceaux})…
        </p>
      )}
      {edition ? (
        <>
          <label>
            Résumé
            <textarea
              className="input"
              rows={6}
              value={edition.resume}
              onChange={(e) => setEdition({ ...edition, resume: e.target.value })}
            />
          </label>
          <label>
            Transcript
            <textarea
              className="input"
              rows={12}
              value={edition.transcript}
              onChange={(e) => setEdition({ ...edition, transcript: e.target.value })}
            />
          </label>
          <div className="row">
            <button className="btn primary" onClick={enregistrer}>
              Enregistrer les modifications
            </button>
            <button className="btn" onClick={() => setEdition(null)}>
              Annuler
            </button>
          </div>
        </>
      ) : (
        <>
          <nav className="visio-tuiles" aria-label="Contenu de l’enregistrement">
            <button aria-pressed={onglet === 'resume'} onClick={() => setOnglet('resume')}>
              Résumé
            </button>
            <button aria-pressed={onglet === 'transcript'} onClick={() => setOnglet('transcript')}>
              Transcript
            </button>
          </nav>
          {onglet === 'resume' ? (
            <>
              {session.resume && <p className="fi-cr">{session.resume}</p>}
              {session.statut === 'transcrit' && !session.resume && session.transcript && (
                <p className="small muted">Résumé en préparation…</p>
              )}
              {!session.resume && !(session.statut === 'transcrit' && session.transcript) && (
                <p className="muted">Pas encore de résumé.</p>
              )}
              {session.resume &&
                (crFait ? (
                  <span role="status">Compte rendu enregistré dans le rendez-vous.</span>
                ) : (
                  <div className="row">
                    <button className="btn go" onClick={utiliserCommeCompteRendu}>
                      Enregistrer comme compte rendu
                    </button>
                  </div>
                ))}
            </>
          ) : (
            <>
              {session.transcript && <pre className="fi-cr">{session.transcript}</pre>}
              {session.statut === 'transcrit' && !session.transcript && (
                <p className="muted">Aucune parole transcrite.</p>
              )}
              {!session.transcript && session.statut !== 'transcrit' && (
                <p className="muted">Pas encore de transcript.</p>
              )}
              {session.transcript &&
                (transcriptFait ? (
                  <span role="status">Transcript enregistré dans le rendez-vous.</span>
                ) : (
                  <div className="row">
                    <button className="btn go" onClick={garderTranscript}>
                      Enregistrer le transcript dans le rendez-vous
                    </button>
                  </div>
                ))}
            </>
          )}
          <div className="row">
            {session.statut === 'transcrit' && (
              <button
                className="btn"
                onClick={() =>
                  setEdition({ resume: session.resume ?? '', transcript: session.transcript ?? '' })
                }
              >
                Modifier
              </button>
            )}
            <button className="btn" onClick={supprimer}>
              Supprimer
            </button>
          </div>
          <Rattacher
            slug={slug}
            rdvId={rdvId}
            sessionId={session.id}
            onRattache={apresRattachement}
          />
        </>
      )}
      {erreur && <p style={{ color: 'var(--red)' }}>{erreur}</p>}
    </div>
  );
}
