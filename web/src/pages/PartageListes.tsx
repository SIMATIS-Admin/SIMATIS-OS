import { useState } from 'react';
import { operationCerveau } from '../api.js';
import type { CarteCerveau } from '../cerveau.js';

type Resultat = { chemin: string; extraits: string[] };

const jour = (iso: string | null | undefined, id: string) =>
  new Date(iso ?? id.slice('echanges/'.length, 'echanges/'.length + 10)).toLocaleDateString(
    'fr-FR',
    { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' },
  );

const GENRES: Record<string, string> = { question: 'Question', reponse: 'Réponse', info: 'Info' };

const LienKdrive = ({ url }: { url: string | null | undefined }) =>
  url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      Ouvrir dans le kDrive
    </a>
  ) : null;

// Retrouver ce que l'autre a déposé dans l'espace partagé : ses échanges, une recherche dans le
// contenu, et les fichiers (PDF, images, pages) qui ne s'ouvrent pas dans l'OS.
export function PartageListes({
  slug,
  carte,
  onOuvrir,
}: {
  slug: string;
  carte: CarteCerveau;
  onOuvrir: (chemin: string) => void;
}) {
  const [requete, setRequete] = useState('');
  const [resultats, setResultats] = useState<Resultat[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const titres = new Map(carte.noeuds.map((n) => [n.id, n.titre]));
  const repondues = new Set(carte.noeuds.flatMap((n) => (n.reponseA ? [n.reponseA] : [])));
  const sansReponse = (id: string, genre: string | null | undefined) =>
    genre === 'question' && !repondues.has(id);
  const echanges = carte.noeuds
    .filter((n) => n.categorie === 'echanges')
    .sort(
      (a, b) =>
        Number(sansReponse(b.id, b.genre)) - Number(sansReponse(a.id, a.genre)) ||
        b.id.localeCompare(a.id),
    );
  const fichiers = carte.fichiers ?? [];

  const chercher = () => {
    if (!requete.trim() || enCours) return;
    setEnCours(true);
    setErreur(null);
    operationCerveau(slug, { espace: 'partage', type: 'chercher', requete }).then(
      (r) => {
        setEnCours(false);
        setResultats(r.resultats ?? []);
      },
      (e: unknown) => {
        setEnCours(false);
        setErreur(e instanceof Error ? e.message : String(e));
      },
    );
  };

  return (
    <>
      <div className="panel">
        <div className="panel-b">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              chercher();
            }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input
              type="search"
              placeholder="Chercher dans le contenu…"
              aria-label="Chercher dans le contenu"
              value={requete}
              onChange={(e) => setRequete(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn" type="submit" disabled={enCours || !requete.trim()}>
              {enCours ? 'Recherche…' : 'Chercher'}
            </button>
          </form>
          {erreur && <p className="cerveau-note">{erreur}</p>}
          {resultats && !erreur && (
            <ul className="cerveau-liste">
              {resultats.length === 0 && <li className="cerveau-note">Aucun résultat.</li>}
              {resultats.map((r) => (
                <li key={r.chemin}>
                  {r.chemin.endsWith('.md') ? (
                    <button onClick={() => onOuvrir(r.chemin)}>
                      {titres.get(r.chemin) ?? r.chemin}
                    </button>
                  ) : (
                    <>
                      <code>{r.chemin}</code> <LienKdrive url={carte.lienKdrive} />
                    </>
                  )}
                  {r.extraits.slice(0, 3).map((x) => (
                    <div key={x} className="cerveau-note">
                      {x}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-b">
          <b>Échanges</b>
          {echanges.length === 0 ? (
            <p className="cerveau-note">Aucun échange pour l’instant.</p>
          ) : (
            <ul className="cerveau-liste">
              {echanges.map((n) => (
                <li key={n.id} data-testid="echange">
                  <button onClick={() => onOuvrir(n.id)}>{n.titre}</button>
                  <span className="cerveau-note">
                    {' '}
                    {GENRES[n.genre ?? ''] ?? 'Message'} · {n.auteur ?? '?'} · {jour(n.date, n.id)}
                    {sansReponse(n.id, n.genre) ? ' · ' : ''}
                  </span>
                  {sansReponse(n.id, n.genre) && <b>Sans réponse</b>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {fichiers.length > 0 && (
        <div className="panel">
          <div className="panel-b">
            <b>Autres fichiers</b>
            <ul className="cerveau-liste">
              {fichiers.map((f) => (
                <li key={f}>
                  <code>{f}</code> <LienKdrive url={carte.lienKdrive} />
                </li>
              ))}
            </ul>
            {!carte.lienKdrive && (
              <p className="cerveau-note">
                Pour ouvrir ces fichiers depuis l’OS, ajoutez le lien du dossier kDrive dans .env
                (PARTAGE_KDRIVE_URL).
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
