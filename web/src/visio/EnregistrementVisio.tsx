import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cloreSessionVisio,
  envoyerMorceauVisio,
  fetchDerniereSessionVisio,
  fetchSessionVisio,
  ouvrirSessionVisio,
  type SessionVisio,
} from '../api.js';
import { CaptureVisio } from './capture.js';

type Etat = 'repos' | 'enregistrement' | 'transcription';

const duree = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

// Micro de l'utilisateur, plus le son de l'onglet de la visio s'il est partagé. Rien n'est demandé
// avant le clic de l'utilisateur.
async function obtenirSources(): Promise<{ micro: MediaStream; onglet: MediaStream | null }> {
  const micro = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const partage = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audio = partage.getAudioTracks();
    // On ne garde que le son : l'image de l'onglet n'est ni enregistrée ni envoyée.
    for (const piste of partage.getTracks()) if (!audio.includes(piste)) piste.stop();
    return { micro, onglet: audio.length > 0 ? new MediaStream(audio) : null };
  } catch {
    return { micro, onglet: null };
  }
}

export function EnregistrementVisio({
  slug,
  rdvId,
  intervalleMs = 3000,
}: {
  slug: string;
  rdvId: string;
  intervalleMs?: number;
}) {
  const [etat, setEtat] = useState<Etat>('repos');
  const [session, setSession] = useState<SessionVisio | null>(null);
  const [microSeul, setMicroSeul] = useState(false);
  const [secondes, setSecondes] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const capture = useRef<CaptureVisio | null>(null);
  const sessionId = useRef<string | null>(null);
  const sources = useRef<{ micro: MediaStream; onglet: MediaStream | null } | null>(null);

  const charger = useCallback(() => {
    fetchDerniereSessionVisio(slug, rdvId).then(
      (s) => {
        setSession(s);
        if (s && (s.statut === 'clos' || s.statut === 'en_cours')) setEtat('transcription');
      },
      () => undefined,
    );
  }, [slug, rdvId]);
  useEffect(charger, [charger]);

  // Chronomètre pendant l'enregistrement.
  useEffect(() => {
    if (etat !== 'enregistrement') return;
    const debut = Date.now();
    const t = setInterval(() => setSecondes(Math.floor((Date.now() - debut) / 1000)), 1000);
    return () => clearInterval(t);
  }, [etat]);

  // Après l'arrêt, le poste transcrit les morceaux : on relit la session jusqu'au transcript.
  useEffect(() => {
    if (etat !== 'transcription' || !session || session.statut === 'transcrit') return;
    const t = setInterval(() => {
      fetchSessionVisio(slug, session.id).then(
        (s) => {
          setSession(s);
          if (s.statut === 'transcrit') setEtat('repos');
        },
        () => undefined,
      );
    }, intervalleMs);
    return () => clearInterval(t);
  }, [etat, session, slug, intervalleMs]);

  const demarrer = async () => {
    setErreur(null);
    try {
      const src = await obtenirSources();
      const { id } = await ouvrirSessionVisio(slug, rdvId);
      sources.current = src;
      sessionId.current = id;
      setMicroSeul(src.onglet === null);
      setSecondes(0);
      const c = new CaptureVisio({
        onErreur: () =>
          setErreur('Un morceau n’a pas pu être envoyé : le transcript sera incomplet.'),
      });
      c.demarrer(src, (m) => envoyerMorceauVisio(slug, id, m).then(() => undefined));
      capture.current = c;
      setEtat('enregistrement');
    } catch (e) {
      setErreur(
        e instanceof Error
          ? `Enregistrement impossible : ${e.message}`
          : 'Enregistrement impossible.',
      );
    }
  };

  const arreter = async () => {
    const id = sessionId.current;
    if (!id) return;
    setEtat('transcription');
    try {
      await capture.current?.arreter();
      for (const flux of [sources.current?.micro, sources.current?.onglet]) {
        for (const piste of flux?.getTracks() ?? []) piste.stop();
      }
      const { statut } = await cloreSessionVisio(slug, id);
      setSession(await fetchSessionVisio(slug, id));
      if (statut === 'transcrit') setEtat('repos');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Enregistrement de la visio</h2>
      </div>
      <div className="panel-b stack">
        {etat === 'repos' && (
          <button className="btn primary" onClick={() => void demarrer()}>
            Enregistrer
          </button>
        )}
        {etat === 'enregistrement' && (
          <>
            <p role="status">Enregistrement en cours · {duree(secondes)}</p>
            <p className="small muted">
              Prévenez les participants que la visio est enregistrée.
              {microSeul &&
                ' Le son de l’onglet n’est pas partagé : micro seul, les autres voix ne seront pas transcrites.'}
            </p>
            <button className="btn" onClick={() => void arreter()}>
              Arrêter
            </button>
          </>
        )}
        {etat === 'transcription' && (
          <p role="status">
            Transcription en cours
            {session ? ` (${session.transcrits} morceaux sur ${session.morceaux})` : ''}…
          </p>
        )}
        {erreur && <p style={{ color: 'var(--red)' }}>{erreur}</p>}
        {session?.transcript && <pre className="fi-cr">{session.transcript}</pre>}
        {session?.statut === 'transcrit' && !session.transcript && (
          <p className="muted">Aucune parole transcrite.</p>
        )}
      </div>
    </section>
  );
}
