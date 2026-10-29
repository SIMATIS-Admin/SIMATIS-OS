import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCarteCerveau, operationCerveau, type EspaceCerveau } from '../api.js';
import { IdeeCerveau, MessagePartage, NoteCerveau } from './NoteCerveau.js';
import { categorieInfo, disposer, voisins, type CarteCerveau } from '../cerveau.js';

const TAILLE = 1000;

const dateParis = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// Deux cerveaux : SIMATIS (le dossier du Drive) et Partagé (l'espace partagé avec Christophe), chacun
// avec sa carte et son édition.
export function Cerveau({ slug }: { slug: string }) {
  const [espace, setEspace] = useState<EspaceCerveau>('simatis');
  return (
    <>
      <div className="seg" style={{ marginBottom: 14 }}>
        {(
          [
            ['simatis', 'SIMATIS'],
            ['partage', 'Partagé'],
          ] as const
        ).map(([id, libelle]) => (
          <button
            key={id}
            className={espace === id ? 'on' : ''}
            aria-pressed={espace === id}
            onClick={() => setEspace(id)}
          >
            {libelle}
          </button>
        ))}
      </div>
      <CerveauEspace key={`${slug}-${espace}`} slug={slug} espace={espace} />
    </>
  );
}

function CerveauEspace({ slug, espace }: { slug: string; espace: EspaceCerveau }) {
  const partage = espace === 'partage';
  const [carte, setCarte] = useState<CarteCerveau | null | undefined>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);
  const [masquees, setMasquees] = useState<Set<string>>(new Set());
  const [choisie, setChoisie] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [message, setMessage] = useState<{ enReponseA?: string } | null>(null);
  const [actualisation, setActualisation] = useState(false);
  const [rechargement, setRechargement] = useState(0);
  const [vue, setVue] = useState({ x: -TAILLE / 2, y: -TAILLE / 2, l: TAILLE });
  const glisse = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let vivant = true;
    fetchCarteCerveau(slug, espace).then(
      (c) => vivant && setCarte(c),
      (e: unknown) => vivant && setErreur(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      vivant = false;
    };
  }, [slug, espace, rechargement]);

  const positions = useMemo(
    () =>
      carte ? new Map(disposer(carte.noeuds, carte.liens, TAILLE).map((p) => [p.id, p])) : null,
    [carte],
  );
  const categories = useMemo(() => {
    const n = new Map<string, number>();
    for (const nd of carte?.noeuds ?? []) n.set(nd.categorie, (n.get(nd.categorie) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  }, [carte]);

  // Relit l'espace partagé sur le kDrive (une lecture par note) : lent, donc à la demande.
  const actualiser = () => {
    setActualisation(true);
    operationCerveau(slug, { espace: 'partage', type: 'actualiser' }).then(
      () => {
        setActualisation(false);
        setRechargement((n) => n + 1);
      },
      (e: unknown) => {
        setActualisation(false);
        setErreur(e instanceof Error ? e.message : String(e));
      },
    );
  };

  if (erreur) return <div className="empty">{erreur}</div>;
  if (carte === undefined) return <div className="empty">Chargement…</div>;
  if (carte === null || !positions)
    return (
      <div className="empty">
        {partage
          ? 'La carte de l’espace partagé n’est pas encore arrivée. '
          : 'La carte n’est pas encore arrivée. '}
        Elle est envoyée par l’exécuteur de cet ordinateur : vérifiez qu’il tourne (Routines Claude)
        et que{' '}
        {partage
          ? 'le serveur « partage » de Claude Code est installé'
          : 'le dossier du second cerveau est configuré'}
        .
        {partage && (
          <>
            {' '}
            <button className="btn" onClick={actualiser} disabled={actualisation}>
              {actualisation ? 'Lecture du kDrive…' : 'Actualiser'}
            </button>
          </>
        )}
      </div>
    );

  const par = new Map(carte.noeuds.map((n) => [n.id, n]));
  const visible = (id: string) => !masquees.has(par.get(id)?.categorie ?? '');
  const requete = recherche.trim().toLowerCase();
  const trouve = (id: string) =>
    !requete ||
    (par.get(id)?.titre.toLowerCase().includes(requete) ?? false) ||
    id.toLowerCase().includes(requete);
  const note = choisie ? par.get(choisie) : undefined;
  const lies = note ? voisins(carte, note.id) : null;
  const voisinage = new Set([...(lies?.sortants ?? []), ...(lies?.entrants ?? [])]);

  const zoom = (facteur: number, cx = vue.x + vue.l / 2, cy = vue.y + vue.l / 2) => {
    const l = Math.min(TAILLE * 3, Math.max(60, vue.l * facteur));
    setVue({ x: cx - ((cx - vue.x) / vue.l) * l, y: cy - ((cy - vue.y) / vue.l) * l, l });
  };

  return (
    <div className="cerveau">
      <div className="panel cerveau-carte">
        <svg
          viewBox={`${vue.x} ${vue.y} ${vue.l} ${vue.l}`}
          role="img"
          aria-label="Carte du second cerveau"
          onWheel={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            zoom(
              e.deltaY > 0 ? 1.15 : 1 / 1.15,
              vue.x + ((e.clientX - r.left) / r.width) * vue.l,
              vue.y + ((e.clientY - r.top) / r.height) * vue.l,
            );
          }}
          onPointerDown={(e) => {
            glisse.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => {
            if (!glisse.current) return;
            const r = e.currentTarget.getBoundingClientRect();
            const dx = ((e.clientX - glisse.current.x) / r.width) * vue.l;
            const dy = ((e.clientY - glisse.current.y) / r.height) * vue.l;
            glisse.current = { x: e.clientX, y: e.clientY };
            setVue((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
          }}
          onPointerUp={() => (glisse.current = null)}
          onPointerLeave={() => (glisse.current = null)}
        >
          {carte.liens.map((l) => {
            const a = positions.get(l.de);
            const b = positions.get(l.vers);
            if (!a || !b || !visible(l.de) || !visible(l.vers)) return null;
            const actif = choisie === l.de || choisie === l.vers;
            return (
              <line
                key={`${l.de}>${l.vers}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={actif ? 'cv-lien actif' : 'cv-lien'}
              />
            );
          })}
          {carte.noeuds.map((n) => {
            const p = positions.get(n.id);
            if (!p || !visible(n.id)) return null;
            const estim = n.id === choisie;
            const estimVoisin = voisinage.has(n.id);
            const attenue = (!!requete && !trouve(n.id)) || (!!choisie && !estim && !estimVoisin);
            return (
              <circle
                key={n.id}
                data-testid={`noeud-${n.id}`}
                cx={p.x}
                cy={p.y}
                r={estim ? 9 : requete && trouve(n.id) ? 7 : 5}
                fill={categorieInfo(n.categorie).couleur}
                opacity={attenue ? 0.18 : 1}
                stroke={estim ? 'var(--ink)' : 'none'}
                strokeWidth={2}
                className="cv-noeud"
                onClick={() => setChoisie(estim ? null : n.id)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <title>{n.titre}</title>
              </circle>
            );
          })}
        </svg>
        <div className="cerveau-zoom">
          <button aria-label="Zoom avant" onClick={() => zoom(1 / 1.4)}>
            +
          </button>
          <button aria-label="Zoom arrière" onClick={() => zoom(1.4)}>
            −
          </button>
          <button onClick={() => setVue({ x: -TAILLE / 2, y: -TAILLE / 2, l: TAILLE })}>
            Recentrer
          </button>
          <button
            onClick={() => {
              setVue({ x: -TAILLE / 2, y: -TAILLE / 2, l: TAILLE });
              setMasquees(new Set());
              setChoisie(null);
              setRecherche('');
            }}
          >
            Réinitialiser la vue
          </button>
        </div>
      </div>

      <div className="cerveau-cote">
        {partage && (
          <div className="cerveau-actions" style={{ marginTop: 0 }}>
            <button className="btn" onClick={() => setMessage({})}>
              + Nouveau message
            </button>
            <button className="btn" onClick={actualiser} disabled={actualisation}>
              {actualisation ? 'Lecture du kDrive…' : 'Actualiser'}
            </button>
          </div>
        )}
        <IdeeCerveau
          slug={slug}
          espace={espace}
          onAjoutee={(chemin) => {
            setOuverte(chemin);
            // La carte est redéposée par l'exécuteur juste après l'écriture.
            setTimeout(() => setRechargement((n) => n + 1), 3000);
          }}
        />
        <div className="panel">
          <div className="panel-b">
            <input
              type="search"
              placeholder="Chercher une note…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              aria-label="Chercher une note"
              style={{ width: '100%' }}
            />
            <div className="cerveau-legende" aria-label="Légende">
              {categories.map(([cat, nb]) => {
                const info = categorieInfo(cat);
                const off = masquees.has(cat);
                return (
                  <button
                    key={cat}
                    className={off ? 'off' : ''}
                    aria-pressed={!off}
                    onClick={() =>
                      setMasquees((s) => {
                        const suite = new Set(s);
                        if (!suite.delete(cat)) suite.add(cat);
                        return suite;
                      })
                    }
                  >
                    <span className="pastille" style={{ background: info.couleur }} />
                    {info.libelle} <span className="nb">{nb}</span>
                  </button>
                );
              })}
            </div>
            <p className="cerveau-note">
              {carte.noeuds.length} notes, {carte.liens.length} liens
              {carte.autresFichiers > 0 ? `, ${carte.autresFichiers} autres fichiers` : ''}
              {carte.tronquee ? ' (carte limitée aux premières notes)' : ''}. Mise à jour le{' '}
              {dateParis(carte.misAJour)}.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-b">
            {note && lies ? (
              <>
                <h3 style={{ margin: 0 }}>{note.titre}</h3>
                <p className="cerveau-note">
                  <span
                    className="pastille"
                    style={{ background: categorieInfo(note.categorie).couleur }}
                  />
                  {categorieInfo(note.categorie).libelle}
                  {note.statut ? ` · ${note.statut}` : ''}
                  <br />
                  <code>{note.id}</code>
                </p>
                <button className="btn" onClick={() => setOuverte(note.id)}>
                  Ouvrir et modifier
                </button>
                {(
                  [
                    ['Renvoie vers', lies.sortants],
                    ['Cité par', lies.entrants],
                  ] as const
                ).map(([titre, ids]) =>
                  ids.length > 0 ? (
                    <div key={titre}>
                      <b>{titre}</b>
                      <ul className="cerveau-liste">
                        {ids.map((id) => (
                          <li key={id}>
                            <button onClick={() => setChoisie(id)}>
                              {par.get(id)?.titre ?? id}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
              </>
            ) : (
              <p className="cerveau-note">Cliquez sur une note de la carte pour voir ses liens.</p>
            )}
          </div>
        </div>
      </div>
      {message && (
        <div style={{ gridColumn: '1 / -1' }}>
          <MessagePartage
            key={message.enReponseA ?? 'nouveau'}
            slug={slug}
            enReponseA={message.enReponseA}
            onFerme={() => setMessage(null)}
            onDepose={() => {
              setMessage(null);
              setTimeout(() => setRechargement((n) => n + 1), 3000);
            }}
          />
        </div>
      )}
      {ouverte && (
        <div style={{ gridColumn: '1 / -1' }}>
          <NoteCerveau
            key={ouverte}
            slug={slug}
            espace={espace}
            {...(partage ? { onRepondre: (c: string) => setMessage({ enReponseA: c }) } : {})}
            chemin={ouverte}
            onFerme={() => setOuverte(null)}
            onEnregistre={() => setTimeout(() => setRechargement((n) => n + 1), 3000)}
          />
        </div>
      )}
    </div>
  );
}
