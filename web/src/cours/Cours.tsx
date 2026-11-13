import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDecksCours, fetchTexteCours, urlFichierCours, type DeckCours } from '../api.js';
import { useModePresentation } from '../shell/modePresentation.js';
import { Markdown } from './Markdown.js';
import {
  lireManifest,
  lireModule,
  remplacerVariables,
  type Manifest,
  type Module,
  type TypeSlide,
} from './parseur.js';
import './cours.css';

const LIBELLES: Record<TypeSlide, string> = {
  titre: 'Titre',
  concept: 'Concept',
  demo: 'Démo',
  atelier: 'Atelier',
  recap: 'Récapitulatif',
  piege: 'Piège',
};

type Charge = { manifest: Manifest; modules: Module[] };
type Position = { m: number; s: number };

const AIDE: [string, string][] = [
  ['← → espace', 'Slide précédente ou suivante'],
  ['PageUp PageDown', 'Slide précédente ou suivante'],
  ['↑ ↓', 'Module précédent ou suivant'],
  ['1 à 9', 'Aller au module n'],
  ['N', 'Notes du formateur et aperçu de la suivante'],
  ['F', 'Plein écran'],
  ['?', 'Cette aide'],
];

// La position se garde dans l'adresse (?m=2&s=3) : recharger la page reprend où on s'était arrêté.
const lirePosition = (): Position => {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const n = (v: string | null) => Math.max(0, Number.parseInt(v ?? '', 10) || 0);
  return { m: n(q.get('m')), s: n(q.get('s')) };
};
const lireClient = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('client');

export function Cours({ slug, deck }: { slug: string; deck: string }) {
  const [etat, setEtat] = useState<
    { statut: 'chargement' } | { statut: 'erreur'; message: string } | ({ statut: 'pret' } & Charge)
  >({ statut: 'chargement' });
  const [pos, setPos] = useState<Position>(lirePosition);
  const [notes, setNotes] = useState(false);
  const [aide, setAide] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const { basculer } = useModePresentation();

  useEffect(() => {
    let annule = false;
    (async () => {
      const manifest = lireManifest(JSON.parse(await fetchTexteCours(slug, deck, 'manifest.json')));
      const client = lireClient();
      let profil: Record<string, string> = {};
      if (client) {
        try {
          profil = JSON.parse(
            await fetchTexteCours(slug, deck, `clients/${client}.json`),
          ) as Record<string, string>;
        } catch {
          // Profil absent : les valeurs génériques du manifest s'appliquent.
        }
      }
      const sources = await Promise.all(
        manifest.modules.map((f) => fetchTexteCours(slug, deck, f)),
      );
      const modules = sources.map((src) =>
        lireModule(remplacerVariables(src, profil, manifest.generique)),
      );
      return { manifest, modules };
    })().then(
      (c) => !annule && setEtat({ statut: 'pret', ...c }),
      (e: unknown) =>
        !annule &&
        setEtat({
          statut: 'erreur',
          message: e instanceof Error ? e.message : 'Support indisponible',
        }),
    );
    return () => {
      annule = true;
    };
  }, [slug, deck]);

  const modules = etat.statut === 'pret' ? etat.modules : [];
  const m = Math.min(pos.m, Math.max(0, modules.length - 1));
  const slides = modules[m]?.slides ?? [];
  const s = Math.min(pos.s, Math.max(0, slides.length - 1));

  const aller = useCallback((suivant: Position) => {
    setPos(suivant);
    const base = location.hash.split('?')[0]!;
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    q.set('m', String(suivant.m));
    q.set('s', String(suivant.s));
    history.replaceState(null, '', `${base}?${q.toString()}`);
  }, []);
  const suivante = useCallback(() => {
    if (s < slides.length - 1) aller({ m, s: s + 1 });
    else if (m < modules.length - 1) aller({ m: m + 1, s: 0 });
  }, [aller, m, s, slides.length, modules.length]);
  const precedente = useCallback(() => {
    if (s > 0) aller({ m, s: s - 1 });
    else if (m > 0) aller({ m: m - 1, s: Math.max(0, (modules[m - 1]?.slides.length ?? 1) - 1) });
  }, [aller, m, s, modules]);

  useEffect(() => {
    if (etat.statut !== 'pret') return;
    const touche = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const cible = e.target instanceof HTMLElement ? e.target : null;
      if (cible?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') suivante();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') precedente();
      else if (e.key === 'ArrowDown' && m < modules.length - 1) aller({ m: m + 1, s: 0 });
      else if (e.key === 'ArrowUp' && m > 0) aller({ m: m - 1, s: 0 });
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= modules.length)
        aller({ m: Number(e.key) - 1, s: 0 });
      else if (e.key === 'n' || e.key === 'N') setNotes((v) => !v);
      else if (e.key === '?') setAide((v) => !v);
      else if (e.key === 'f' || e.key === 'F') {
        basculer();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void racine.current?.requestFullscreen?.();
      } else if (e.key === 'Escape') setAide(false);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, [etat.statut, suivante, precedente, aller, m, modules.length, basculer]);

  const resoudre = useMemo(() => (src: string) => urlFichierCours(slug, deck, src), [slug, deck]);

  if (etat.statut === 'chargement')
    return (
      <p className="empty" role="status">
        Chargement du support…
      </p>
    );
  if (etat.statut === 'erreur')
    return (
      <div className="empty" role="alert">
        <p>{etat.message}</p>
        <a className="btn sm" href={`#/${slug}/cours`}>
          ← Tous les supports
        </a>
      </div>
    );

  const module = modules[m];
  const slide = slides[s];
  if (!module || !slide) return <p className="empty">Ce support n’a pas encore de slides.</p>;
  const prochaine = slides[s + 1] ?? modules[m + 1]?.slides[0];

  return (
    <div
      className="cours"
      ref={racine}
      role="region"
      aria-label={etat.manifest.titre}
      style={
        {
          ...(etat.manifest.couleur ? { '--marque': etat.manifest.couleur } : {}),
          ...(etat.manifest.accent ? { '--accent': etat.manifest.accent } : {}),
        } as React.CSSProperties
      }
    >
      <div className="cours-scene">
        <article
          className={`cours-slide type-${slide.type}`}
          aria-label={`Slide ${s + 1} sur ${slides.length}`}
        >
          <header className="cours-bandeau">
            {etat.manifest.logo && (
              <img
                className="cours-logo"
                src={resoudre(etat.manifest.logo)}
                alt={etat.manifest.titre}
              />
            )}
            <span className="cours-type">{LIBELLES[slide.type]}</span>
            <span className="cours-module">
              {module.titre || `Module ${m + 1}`}
              {module.duree ? ` · ${module.duree} min` : ''}
            </span>
          </header>
          <h2>{slide.titre}</h2>
          <div className={`cours-colonnes n${slide.colonnes.length}`}>
            {slide.colonnes.map((c, k) => (
              <div key={k} className="cours-colonne">
                <Markdown source={c} resoudre={resoudre} />
              </div>
            ))}
          </div>
          {slide.livrable && (
            <p className="cours-livrable">
              <b>Livrable</b> {slide.livrable}
            </p>
          )}
        </article>
        {notes && (
          <aside className="cours-notes" aria-label="Notes du formateur">
            <b>Notes du formateur</b>
            <p>{slide.notes || 'Pas de note pour cette slide.'}</p>
            {prochaine && (
              <p className="cours-suivante">
                <b>Suivante</b> {prochaine.titre}
              </p>
            )}
          </aside>
        )}
        {aide && (
          <div className="cours-aide" role="dialog" aria-label="Raccourcis">
            <b>Raccourcis</b>
            <dl>
              {AIDE.map(([touche, texte]) => (
                <div key={touche}>
                  <dt>{touche}</dt>
                  <dd>{texte}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
      <nav className="cours-commande" aria-label="Navigation du support">
        <a className="btn sm" href={`#/${slug}/cours`}>
          ← Supports
        </a>
        <div className="cours-modules" role="group" aria-label="Modules">
          {modules.map((mod, k) => (
            <button
              key={k}
              type="button"
              className={k === m ? 'on' : ''}
              aria-current={k === m ? 'step' : undefined}
              onClick={() => aller({ m: k, s: 0 })}
            >
              {k + 1}
              <span className="cours-module-nom"> {mod.titre}</span>
            </button>
          ))}
        </div>
        <button
          className="btn sm"
          type="button"
          aria-label="Slide précédente"
          disabled={m === 0 && s === 0}
          onClick={precedente}
        >
          ←
        </button>
        <span className="dia-compteur">
          {s + 1} / {slides.length}
        </span>
        <button
          className="btn sm"
          type="button"
          aria-label="Slide suivante"
          disabled={m === modules.length - 1 && s === slides.length - 1}
          onClick={suivante}
        >
          →
        </button>
        <button
          className="btn sm"
          type="button"
          aria-pressed={notes}
          onClick={() => setNotes((v) => !v)}
        >
          Notes
        </button>
      </nav>
    </div>
  );
}

// Liste des supports du dossier configuré : un clic ouvre le lecteur.
export function CoursListe({ slug }: { slug: string }) {
  const [decks, setDecks] = useState<DeckCours[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    fetchDecksCours(slug).then(setDecks, (e: unknown) =>
      setErreur(e instanceof Error ? e.message : 'Supports indisponibles'),
    );
  }, [slug]);
  if (erreur)
    return (
      <p className="empty" role="alert">
        {erreur}
      </p>
    );
  if (!decks) return <p className="empty">Chargement…</p>;
  if (decks.length === 0) return <p className="empty">Aucun support dans le dossier configuré.</p>;
  return (
    <div className="cours-liste">
      {decks.map((d) => (
        <a
          key={d.id}
          className="cours-carte"
          href={`#/${slug}/cours/deck/${encodeURIComponent(d.id)}`}
        >
          <b>{d.titre}</b>
          {d.soustitre && <span>{d.soustitre}</span>}
        </a>
      ))}
    </div>
  );
}
