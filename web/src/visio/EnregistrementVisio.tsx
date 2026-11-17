import { useCallback, useEffect, useState } from 'react';
import {
  enregistrerCompteRenduRdv,
  fetchDerniereSessionVisio,
  fetchSessionVisio,
  modifierEnregistrement,
  supprimerEnregistrement,
  type SessionVisio,
} from '../api.js';

const erreurDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Le dernier enregistrement d'un rendez-vous : texte en direct, résumé, transcript. Marc peut les
// corriger, les supprimer ou en faire le compte rendu. L'enregistrement lui-même se lance depuis
// l'appli Mac « Visio SIMATIS ».
export function EnregistrementVisio({
  slug,
  rdvId,
  titre = 'Visio',
  intervalleMs = 3000,
  onSupprime,
}: {
  slug: string;
  rdvId: string;
  titre?: string;
  intervalleMs?: number;
  onSupprime?: () => void;
}) {
  const [session, setSession] = useState<SessionVisio | null>(null);
  const [charge, setCharge] = useState(false);
  const [edition, setEdition] = useState<{ resume: string; transcript: string } | null>(null);
  const [crFait, setCrFait] = useState(false);
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
            Texte
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
          {session.resume && (
            <>
              <h3>Résumé</h3>
              <p className="fi-cr">{session.resume}</p>
            </>
          )}
          {session.statut === 'transcrit' && !session.resume && session.transcript && (
            <p className="small muted">Résumé en préparation…</p>
          )}
          {session.transcript && (
            <>
              <h3>Texte</h3>
              <pre className="fi-cr">{session.transcript}</pre>
            </>
          )}
          {session.statut === 'transcrit' && !session.transcript && (
            <p className="muted">Aucune parole transcrite.</p>
          )}
          <div className="row">
            {session.resume &&
              (crFait ? (
                <span role="status">Compte rendu enregistré dans le rendez-vous.</span>
              ) : (
                <button className="btn go" onClick={utiliserCommeCompteRendu}>
                  Utiliser comme compte rendu
                </button>
              ))}
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
        </>
      )}
      {erreur && <p style={{ color: 'var(--red)' }}>{erreur}</p>}
    </div>
  );
}
