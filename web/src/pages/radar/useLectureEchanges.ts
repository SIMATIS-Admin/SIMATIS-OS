import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLectureEchanges, lancerLectureEchanges, type LectureEchanges } from '../../api.js';

const ATTENTE_MS = 3000;

// La lecture de la messagerie qui range au Radar les affaires sans rendez-vous : demandée à
// l'ouverture de l'écran (le serveur ne relit que si la dernière lecture est ancienne), suivie
// jusqu'à sa fin, puis `apres` recharge l'écran. `relire` la force.
export function useLectureEchanges(slug: string, apres: () => void) {
  const [lecture, setLecture] = useState<LectureEchanges | null>(null);
  const apresRef = useRef(apres);
  apresRef.current = apres;
  const minuteur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const suivre = useCallback(
    (etat: LectureEchanges) => {
      setLecture(etat);
      clearTimeout(minuteur.current);
      if (etat.etat !== 'en_cours') return;
      minuteur.current = setTimeout(() => {
        fetchLectureEchanges(slug).then(
          (suivant) => {
            suivre(suivant);
            if (suivant.etat !== 'en_cours') apresRef.current();
          },
          () => undefined,
        );
      }, ATTENTE_MS);
    },
    [slug],
  );

  useEffect(() => {
    let actif = true;
    lancerLectureEchanges(slug).then(
      (etat) => actif && suivre(etat),
      () => undefined,
    );
    return () => {
      actif = false;
      clearTimeout(minuteur.current);
    };
  }, [slug, suivre]);

  const relire = () =>
    lancerLectureEchanges(slug, true).then(suivre, (e: unknown) =>
      setLecture({
        etat: 'echec',
        derniereLecture: lecture?.derniereLecture ?? null,
        erreur: e instanceof Error ? e.message : String(e),
      }),
    );
  return { lecture, relire };
}

// « Messagerie lue le 14 nov. à 09:12 », ou où en est la lecture.
export function libelleLecture(l: LectureEchanges | null): string {
  if (!l) return '';
  if (l.etat === 'en_cours') return 'Lecture de la messagerie en cours…';
  if (l.etat === 'echec') return `Messagerie non lue : ${l.erreur ?? 'erreur inconnue'}`;
  if (!l.derniereLecture) return 'Messagerie pas encore lue';
  const d = new Date(l.derniereLecture);
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    d.toLocaleString('fr-FR', { ...o, timeZone: 'Europe/Paris' });
  return `Messagerie lue le ${fmt({ day: 'numeric', month: 'short' })} à ${fmt({ hour: '2-digit', minute: '2-digit' })}`;
}
