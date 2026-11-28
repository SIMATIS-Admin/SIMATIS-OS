import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fetchConnexions, fetchPartenaires, fetchRoutines, fetchSante } from '../api.js';
import {
  compterOrganigramme,
  disposerOrganigramme,
  type EtatOrg,
  type NoeudOrg,
  type RubriqueOrg,
} from '../feuilleDeRouteOS.js';
import { Icon } from '../icons.js';
import { groupInstances, type InstanceSummary } from '../nav.js';
import {
  ETAT_INCONNU,
  LIBELLE_SOURCE,
  accesFonction,
  libelleVue,
  moteur,
  relais,
  sources,
  type Acces,
  type EtatInstance,
} from '../organigrammeInstance.js';

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

// Le bloc explique (clic) ; sa flèche ouvre la section dans l'instance affichée.
function Bloc({
  noeud,
  acces,
  actif,
  onChoisir,
  onOuvrir,
}: {
  noeud: NoeudOrg;
  acces: Acces;
  actif: boolean;
  onChoisir: () => void;
  onOuvrir: (vue: string) => void;
}) {
  const icone = ICONES[noeud.nom];
  const { vue, raison, reservee } = acces;
  const etat = noeud.etat ? CLASSE_ETAT[noeud.etat] : 'partiel';
  return (
    <div
      className={`og-bloc ${etat} ${actif ? 'actif' : ''} ${raison ? 'hors' : ''}`}
      data-tip={raison ?? (noeud.description || undefined)}
    >
      <button type="button" className="og-nom" aria-pressed={actif} onClick={onChoisir}>
        {icone && <Icon name={icone} />}
        <span>{noeud.nom}</span>
        {reservee && <small>Mon activité</small>}
        {noeud.enfants.length > 0 && <em>+{noeud.enfants.length}</em>}
      </button>
      {vue && (
        <button
          type="button"
          className="og-ouvrir"
          aria-label={`Ouvrir ${noeud.nom}`}
          title={`Ouvrir ${noeud.nom}`}
          onClick={() => onOuvrir(vue)}
        >
          ↗
        </button>
      )}
    </div>
  );
}

// Connexions, relais et routines de l'instance affichée, lus en direct. Une lecture en échec laisse
// seulement sa partie « non vérifiée ».
function useEtatInstance(slug: string): EtatInstance {
  const [lu, setLu] = useState<{ slug: string; etat: EtatInstance }>();
  useEffect(() => {
    let courant = true;
    const ou = <T,>(p: Promise<T>) => p.catch(() => null);
    void Promise.all([
      ou(fetchConnexions(slug)),
      ou(fetchPartenaires(slug)),
      ou(fetchRoutines(slug)),
      ou(fetchSante(slug)),
    ]).then(([connexions, partenaires, routines, sante]) => {
      // Une réponse d'une autre forme (version différente du serveur) vaut « non vérifié ».
      if (courant)
        setLu({
          slug,
          etat: {
            connexions: Array.isArray(connexions?.connexions) ? connexions : null,
            partenaires: Array.isArray(partenaires?.partenaires) ? partenaires : null,
            routines: Array.isArray(routines) ? routines : null,
            executeur: sante?.executeur ?? null,
          },
        });
    });
    return () => {
      courant = false;
    };
  }, [slug]);
  // Jamais l'état d'une autre instance, même le temps d'un chargement.
  return lu?.slug === slug ? lu.etat : ETAT_INCONNU;
}

type Detail = {
  titre: string;
  badge?: { texte: string; classe: string };
  textes: string[];
  enfants?: ReactNode;
  vue: string | null;
};

function trouver(
  noeuds: NoeudOrg[],
  nom: string,
  parent?: string,
): { noeud: NoeudOrg; parent?: string } | undefined {
  for (const noeud of noeuds) {
    if (noeud.nom === nom) return { noeud, parent };
    // Une sous-fonction hérite de l'écran de son ancêtre le plus haut placé.
    const dedans = trouver(noeud.enfants, nom, parent ?? noeud.nom);
    if (dedans) return dedans;
  }
  return undefined;
}

// Schéma de l'OS construit depuis la note de l'organigramme : les zones sont fixes, leur contenu vient
// de la note, donc une fonction livrée apparaît sans toucher au code. Ce qui dépend de l'instance
// (sections ouvertes, connexions, relais, routines) est lu dans l'OS.
export function OrganigrammeGraphique({
  rubriques,
  instances,
  slug,
}: {
  rubriques: RubriqueOrg[];
  instances: InstanceSummary[];
  slug: string;
}) {
  const [affichee, setAffichee] = useState(slug);
  // Clé de l'élément expliqué en bas : le détail est recalculé quand l'instance change.
  const [choix, setChoix] = useState<string | null>(null);
  const [traits, setTraits] = useState<Trait[]>([]);
  const [hauteur, setHauteur] = useState(0);
  const racine = useRef<HTMLDivElement>(null);
  const src = useRef<HTMLDivElement>(null);
  const jour = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const base = useRef<HTMLDivElement>(null);
  const chaine = useRef<HTMLDivElement>(null);
  const liaison = useRef<HTMLDivElement>(null);
  const fiche = useRef<HTMLDivElement>(null);
  const socle = useRef<HTMLDivElement>(null);

  const dispo = disposerOrganigramme(rubriques);
  const { total, enService } = compterOrganigramme(rubriques);
  const instance = instances.find((i) => i.slug === affichee) ?? instances[0]!;
  const etat = useEtatInstance(instance.slug);
  const entrees = sources(instance, etat);
  const etapes = moteur(etat);
  const liens = relais(instance, etat);
  const ouvrir = (vue: string) => {
    location.hash = `#/${instance.slug}/${vue}`;
  };

  useLayoutEffect(() => {
    const tracer = () => {
      const r = racine.current;
      const c = cols.current;
      if (!r || !src.current || !jour.current || !base.current || !socle.current || c.length < 3)
        return;
      if (!chaine.current || !liaison.current) return;
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
      const mo = pos(chaine.current);
      const re = pos(liaison.current);
      const k = c.map((e) => pos(e as HTMLElement));
      const v = (x: number, y1: number, y2: number, fleche: boolean, tirets: boolean): Trait => ({
        d: `M${x} ${y1}L${x} ${y2}`,
        fleche,
        tirets,
      });
      const t: Trait[] = [v(s.cx, s.b, j.t - 2, true, false)];
      k.forEach((p) => t.push(v(p.cx, j.b, p.t - 2, true, false)));
      k.forEach((p) => t.push(v(p.cx, p.b, ba.t - 2, true, true)));
      t.push(v(ba.cx, ba.b, mo.t - 2, true, false));
      t.push(v(mo.cx, mo.b, re.t - 2, false, true));
      t.push(v(re.cx, re.b, so.t - 2, false, true));
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
  }, [rubriques, choix, affichee, etat.connexions, etat.partenaires, etat.routines]);

  // L'explication est sous le schéma : on l'amène à l'écran quand on choisit un élément.
  useEffect(() => {
    if (choix) fiche.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [choix]);

  const bloc = (n: NoeudOrg, parent?: string) => (
    <Bloc
      key={n.nom}
      noeud={n}
      acces={accesFonction(n.nom, parent, instance)}
      actif={choix === `fn:${n.nom}`}
      onChoisir={() => setChoix(`fn:${n.nom}`)}
      onOuvrir={ouvrir}
    />
  );
  const rang = (noeuds: NoeudOrg[]) => noeuds.map((n) => bloc(n));

  const detail = (): Detail | null => {
    if (!choix) return null;
    const [genre, cle = ''] = choix.split(/:(.*)/);
    if (genre === 'fn') {
      const trouve = trouver(
        rubriques.flatMap((r) => r.noeuds),
        cle,
      );
      if (!trouve) return null;
      const { noeud, parent } = trouve;
      const acces = accesFonction(noeud.nom, parent, instance);
      return {
        titre: noeud.nom,
        badge: noeud.etat ? { texte: noeud.etat, classe: CLASSE_ETAT[noeud.etat] } : undefined,
        textes: [noeud.description, acces.raison ?? ''],
        enfants: noeud.enfants.map((n) => bloc(n, parent ?? noeud.nom)),
        vue: acces.vue,
      };
    }
    if (genre === 'src') {
      const s = entrees.find((x) => x.id === cle);
      return s
        ? {
            titre: s.nom,
            badge: { texte: LIBELLE_SOURCE[s.etat], classe: `source ${s.etat}` },
            textes: [
              s.moyen,
              `Sert dans : ${s.alimente}.`,
              s.erreur ? `Dernière erreur : ${s.erreur}` : '',
            ],
            vue: s.vue,
          }
        : null;
    }
    if (genre === 'moteur') {
      const e = etapes.find((x) => x.id === cle);
      return e
        ? {
            titre: e.nom,
            badge: e.mention ? { texte: e.mention, classe: 'partiel' } : undefined,
            textes: [e.texte],
            vue: e.vue,
          }
        : null;
    }
    return {
      titre: 'Relais entre OS',
      textes: [liens.resume, liens.texte],
      vue: instance.type === 'prospect' ? null : 'parametres',
    };
  };
  const explication = detail();

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

      <div className="og-instances" role="group" aria-label="Instance affichée">
        {groupInstances(instances).map((g) => (
          <div key={g.type}>
            <p className="og-cap">{g.label}</p>
            <div className="og-rang">
              {g.instances.map((i) => (
                <button
                  key={i.slug}
                  type="button"
                  className={`og-instance ${i.slug === instance.slug ? 'on' : ''}`}
                  aria-pressed={i.slug === instance.slug}
                  onClick={() => setAffichee(i.slug)}
                >
                  <i style={{ background: i.couleur }} />
                  {i.nom}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

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
        <span>
          <i className="hors" />
          pas dans cette instance
        </span>
        <span>↗ ouvrir la section</span>
        <b>
          {total} fonctions · {enService} en service
        </b>
      </div>

      <div className="og-bande og-sources" ref={src}>
        <p className="og-cap">Ce qui entre dans {instance.nom}, et par quel moyen</p>
        <div className="og-rang">
          {entrees.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`og-source ${s.etat} ${choix === `src:${s.id}` ? 'actif' : ''}`}
              aria-pressed={choix === `src:${s.id}`}
              data-tip={s.moyen}
              onClick={() => setChoix(`src:${s.id}`)}
            >
              <i />
              {s.nom}
              <small>{LIBELLE_SOURCE[s.etat]}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="og-espace">
        <span>lecture et synchronisation</span>
      </div>
      <div className="og-bande og-jour" ref={jour}>
        <p className="og-cap">Ma journée</p>
        <div className="og-rang">{rang(dispo.journee)}</div>
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
            <div className="og-corps">{rang(c.noeuds)}</div>
          </div>
        ))}
      </div>

      <div className="og-bande og-base" ref={base}>
        <p className="og-cap">Ma base</p>
        <div className="og-rang">{rang(dispo.base)}</div>
      </div>

      <div className="og-espace">
        <span>ce qui doit sortir de l’OS</span>
      </div>
      <div className="og-bande og-moteur" ref={chaine}>
        <p className="og-cap">Le moteur : de la routine à l’écriture</p>
        <ol className="og-chaine">
          {etapes.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={`og-etape ${choix === `moteur:${e.id}` ? 'actif' : ''}`}
                aria-pressed={choix === `moteur:${e.id}`}
                data-tip={e.texte}
                onClick={() => setChoix(`moteur:${e.id}`)}
              >
                {e.nom}
                {e.mention && <small>{e.mention}</small>}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="og-espace" />
      <div className="og-bande og-relais" ref={liaison}>
        <p className="og-cap">Relais entre OS</p>
        <div className="og-rang">
          <button
            type="button"
            className={`og-etape ${choix === 'relais' ? 'actif' : ''}`}
            aria-pressed={choix === 'relais'}
            onClick={() => setChoix('relais')}
          >
            Comment fonctionne le relais
          </button>
          {liens.partenaires.length > 0 ? (
            <>
              <span className="og-pastille">OS {instance.nom}</span>
              <b aria-hidden="true">⇄</b>
              <span className="og-pastille">Relais d’agents</span>
              <b aria-hidden="true">⇄</b>
              {liens.partenaires.map((p) => (
                <span key={p} className="og-pastille">
                  {p}
                </span>
              ))}
            </>
          ) : (
            <span className="og-pastille vide">{liens.resume}</span>
          )}
        </div>
      </div>

      <div className="og-espace" />
      <div className="og-bas">
        <div className="og-bande og-socle" ref={socle}>
          <p className="og-cap">Le socle</p>
          <div className="og-rang">{rang(dispo.socle)}</div>
        </div>
        <div className="og-bande og-plus">
          <p className="og-cap">Plus</p>
          <div className="og-rang">{rang(dispo.plus)}</div>
        </div>
      </div>

      {dispo.autres.map((r) => (
        <div key={r.titre} className="og-bande og-plus og-autre">
          <p className="og-cap">{r.titre}</p>
          <div className="og-rang">{rang(r.noeuds)}</div>
        </div>
      ))}

      {explication && (
        <div
          className="og-detail"
          role="region"
          aria-label={`Détail : ${explication.titre}`}
          ref={fiche}
        >
          <h4>
            {explication.titre}
            {explication.badge && (
              <span className={`og-etat ${explication.badge.classe}`}>
                {explication.badge.texte}
              </span>
            )}
          </h4>
          {explication.textes.filter(Boolean).map((t) => (
            <p key={t}>{t}</p>
          ))}
          {explication.vue && (
            <button type="button" className="og-aller" onClick={() => ouvrir(explication.vue!)}>
              Ouvrir la section {libelleVue(explication.vue)} →
            </button>
          )}
          <div className="og-rang">{explication.enfants}</div>
        </div>
      )}
    </div>
  );
}
