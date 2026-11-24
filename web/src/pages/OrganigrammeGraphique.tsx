import { useLayoutEffect, useRef, useState } from 'react';
import {
  compterOrganigramme,
  disposerOrganigramme,
  type EtatOrg,
  type NoeudOrg,
  type RubriqueOrg,
} from '../feuilleDeRouteOS.js';
import { Icon } from '../icons.js';

// Outils extérieurs qui alimentent l'OS (générique, pas des données du client).
const SOURCES = [
  'Gmail',
  'Google Agenda',
  'HubSpot',
  'LinkedIn / SalesNav',
  'Site web',
  'Espace partagé Alpes IA',
];

// Icône par fonction ; une fonction nouvelle sans icône s'affiche simplement sans.
const ICONES: Record<string, string> = {
  Cockpit: 'pulse',
  Inbox: 'inbox',
  Agenda: 'cal',
  Radar: 'radar',
  Recherches: 'search',
  ICP: 'flag',
  Campagnes: 'send',
  'Base des suspects': 'db',
  Pipeline: 'kanban',
  'Rendez-vous': 'cal',
  Devis: 'file',
  'Outils et diagnostics': 'tools',
  'Atelier stratégique': 'sliders',
  'Tableau de bord': 'chart',
  'Second cerveau': 'brain',
  'Démarrage du mandat': 'flag',
  Gestion: 'wallet',
  Entreprises: 'building',
  Contacts: 'users',
  'Instances et modules': 'grid',
  'Propositions et autonomie': 'star',
  'Routines et exécuteur': 'clock',
  Connexions: 'globe',
  'Serveur MCP': 'list',
  Exploitation: 'gear',
  Supports: 'panel',
  'Site web': 'globe',
  Paramètres: 'sliders',
};

const CLASSE_ETAT: Record<EtatOrg, string> = {
  'en service': 'service',
  'à essayer': 'essai',
  partiel: 'partiel',
};

type Trait = { d: string; fleche: boolean; tirets: boolean };

function Bloc({
  noeud,
  actif,
  onChoisir,
}: {
  noeud: NoeudOrg;
  actif: boolean;
  onChoisir: (n: NoeudOrg) => void;
}) {
  const icone = ICONES[noeud.nom];
  return (
    <button
      type="button"
      className={`og-bloc ${noeud.etat ? CLASSE_ETAT[noeud.etat] : 'partiel'} ${actif ? 'actif' : ''}`}
      data-tip={noeud.description || undefined}
      aria-pressed={actif}
      onClick={() => onChoisir(noeud)}
    >
      {icone && <Icon name={icone} />}
      <span>{noeud.nom}</span>
      {noeud.enfants.length > 0 && <em>+{noeud.enfants.length}</em>}
    </button>
  );
}

// Schéma de l'OS construit depuis la note de l'organigramme : les zones sont fixes, leur contenu vient
// de la note, donc une fonction livrée apparaît sans toucher au code.
export function OrganigrammeGraphique({ rubriques }: { rubriques: RubriqueOrg[] }) {
  const [choix, setChoix] = useState<NoeudOrg | null>(null);
  const [traits, setTraits] = useState<Trait[]>([]);
  const [hauteur, setHauteur] = useState(0);
  const racine = useRef<HTMLDivElement>(null);
  const src = useRef<HTMLDivElement>(null);
  const jour = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const base = useRef<HTMLDivElement>(null);
  const socle = useRef<HTMLDivElement>(null);

  const dispo = disposerOrganigramme(rubriques);
  const { total, enService } = compterOrganigramme(rubriques);

  useLayoutEffect(() => {
    const tracer = () => {
      const r = racine.current;
      const c = cols.current;
      if (!r || !src.current || !jour.current || !base.current || !socle.current || c.length < 3)
        return;
      const o = r.getBoundingClientRect();
      const pos = (e: HTMLElement) => {
        const b = e.getBoundingClientRect();
        return {
          l: b.left - o.left,
          r: b.right - o.left,
          t: b.top - o.top,
          b: b.bottom - o.top,
          cx: (b.left + b.right) / 2 - o.left,
        };
      };
      const s = pos(src.current);
      const j = pos(jour.current);
      const ba = pos(base.current);
      const so = pos(socle.current);
      const k = c.map((e) => pos(e as HTMLElement));
      const v = (x: number, y1: number, y2: number, fleche: boolean, tirets: boolean): Trait => ({
        d: `M${x} ${y1}L${x} ${y2}`,
        fleche,
        tirets,
      });
      const t: Trait[] = [v(s.cx, s.b, j.t - 2, true, false)];
      k.forEach((p) => t.push(v(p.cx, j.b, p.t - 2, true, false)));
      k.forEach((p) => t.push(v(p.cx, p.b, ba.t - 2, true, true)));
      t.push(v(ba.cx, ba.b, so.t - 2, false, true));
      // Flèches entre colonnes : seulement quand elles sont côte à côte.
      for (let i = 0; i < 2; i++) {
        const a = k[i];
        const b = k[i + 1];
        if (a && b && b.l > a.r)
          t.push({ d: `M${a.r} ${a.t + 24}L${b.l - 3} ${a.t + 24}`, fleche: true, tirets: false });
      }
      setTraits(t);
      setHauteur(r.offsetHeight);
    };
    tracer();
    if (typeof ResizeObserver === 'undefined' || !racine.current) return;
    const obs = new ResizeObserver(tracer);
    obs.observe(racine.current);
    void document.fonts?.ready.then(tracer);
    return () => obs.disconnect();
  }, [rubriques, choix]);

  const bloc = (n: NoeudOrg) => (
    <Bloc key={n.nom} noeud={n} actif={choix?.nom === n.nom} onChoisir={setChoix} />
  );

  return (
    <div className="og" ref={racine}>
      <svg className="og-traits" style={{ height: hauteur }} aria-hidden="true">
        <defs>
          <marker
            id="og-fleche"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path
              d="M2 1L8 5L2 9"
              fill="none"
              stroke="#41a594"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        {traits.map((t, i) => (
          <path
            key={i}
            d={t.d}
            fill="none"
            stroke="#41a594"
            strokeWidth="2.2"
            strokeDasharray={t.tirets ? '5 5' : undefined}
            markerEnd={t.fleche ? 'url(#og-fleche)' : undefined}
          />
        ))}
      </svg>

      <div className="og-legende">
        <span>
          <i className="service" />
          en service
        </span>
        <span>
          <i className="essai" />à essayer
        </span>
        <span>
          <i className="partiel" />
          partiel
        </span>
        <b>
          {total} fonctions · {enService} en service
        </b>
      </div>

      <div className="og-bande og-sources" ref={src}>
        <p className="og-cap">Ce qui entre</p>
        <div className="og-rang">
          {SOURCES.map((s) => (
            <span key={s} className="og-source">
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="og-espace" />
      <div className="og-bande og-jour" ref={jour}>
        <p className="og-cap">Ma journée</p>
        <div className="og-rang">{dispo.journee.map(bloc)}</div>
      </div>

      <div className="og-cols">
        {dispo.colonnes.map((c, i) => (
          <div
            key={c.titre}
            className={`og-col c${i}`}
            ref={(e) => {
              cols.current[i] = e;
            }}
          >
            <h3>
              <b>{i + 1}</b>
              {c.titre}
            </h3>
            <div className="og-corps">{c.noeuds.map(bloc)}</div>
          </div>
        ))}
      </div>

      <div className="og-bande og-base" ref={base}>
        <p className="og-cap">Ma base</p>
        <div className="og-rang">{dispo.base.map(bloc)}</div>
      </div>

      <div className="og-espace" />
      <div className="og-bas">
        <div className="og-bande og-socle" ref={socle}>
          <p className="og-cap">Le socle</p>
          <div className="og-rang">{dispo.socle.map(bloc)}</div>
        </div>
        <div className="og-bande og-plus">
          <p className="og-cap">Plus</p>
          <div className="og-rang">{dispo.plus.map(bloc)}</div>
        </div>
      </div>

      {dispo.autres.map((r) => (
        <div key={r.titre} className="og-bande og-plus og-autre">
          <p className="og-cap">{r.titre}</p>
          <div className="og-rang">{r.noeuds.map(bloc)}</div>
        </div>
      ))}

      {choix && (
        <div className="og-detail" role="region" aria-label={`Détail : ${choix.nom}`}>
          <h4>
            {choix.nom}
            {choix.etat && (
              <span className={`og-etat ${CLASSE_ETAT[choix.etat]}`}>{choix.etat}</span>
            )}
          </h4>
          {choix.description && <p>{choix.description}</p>}
          {choix.enfants.length > 0 && <div className="og-rang">{choix.enfants.map(bloc)}</div>}
        </div>
      )}
    </div>
  );
}
