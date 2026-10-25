import { useEffect, useRef, useState } from 'react';
import {
  entrerRepondantsBase,
  validerReponseBase,
  type ClasseReponseBase,
  type ReponseBase,
} from '../api.js';
import { Icon } from '../icons.js';

// The keyboard shortcut of each class is its position here (1 to 6).
const CLASSES: [ClasseReponseBase, string][] = [
  ['interesse', 'Intéressé'],
  ['pas_interesse', 'Pas intéressé'],
  ['ne_plus_contacter', 'Ne plus me contacter'],
  ['mauvais_interlocuteur', 'Mauvais interlocuteur'],
  ['repondu', 'A répondu (sans plus)'],
  ['reponse_auto', 'Réponse automatique'],
];
const entier = (n: number) => n.toLocaleString('fr-FR');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Replies Claude classed wait here: the record only moves once the pilot validates. One reply at
// a time, with Claude's proposal highlighted, so a validation is a single click or key.
export function ReponsesBase({
  slug,
  aValider,
  aClasser,
  onChange,
}: {
  slug: string;
  aValider: ReponseBase[];
  aClasser: number;
  onChange: () => void;
}) {
  const [passees, setPassees] = useState<Set<string>>(new Set());
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = useRef(aValider.length);
  total.current = Math.max(total.current, aValider.length);

  const courante = aValider.find((r) => !passees.has(r.id));
  const faites = total.current - aValider.length + passees.size;

  const agir = async (f: () => Promise<void>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(message(e));
    }
  };

  const valider = (r: ReponseBase, classe: ClasseReponseBase) =>
    agir(async () => {
      await validerReponseBase(slug, r.id, classe);
      onChange();
    });

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (!courante || cible.matches?.('input, select, textarea')) return;
      const choix = CLASSES[Number(e.key) - 1];
      if (choix) void valider(courante, choix[0]);
    };
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  });

  const entrer = () =>
    agir(async () => {
      const r = await entrerRepondantsBase(slug);
      const morceaux = [
        r.cree ? `${entier(r.cree)} ajoutés au CRM` : null,
        r.existant ? `${entier(r.existant)} déjà présents` : null,
        r.simulation
          ? `${entier(r.simulation)} simulés (écritures réelles vers le CRM désactivées : rien créé)`
          : null,
        r.refuse ? `${entier(r.refuse)} écartés (opposition, exclusion, déjà liés…)` : null,
      ].filter(Boolean);
      setInfo(morceaux.length ? morceaux.join(', ') + '.' : 'Aucun répondant à ajouter.');
      onChange();
    });

  return (
    <div className="stack">
      <div className="small muted">
        Claude propose une classe pour chaque réponse ; vous validez. « Ne plus me contacter »
        devient une opposition, prioritaire sur tout.
        {aClasser > 0 &&
          ` ${entier(aClasser)} réponse${aClasser > 1 ? 's' : ''} attend${aClasser > 1 ? 'ent' : ''} la routine « Base vivante ».`}
      </div>
      {error && (
        <div className="alert amber">
          <Icon name="info" />
          <div>{error}</div>
        </div>
      )}
      {courante ? (
        <div>
          <div className="bv-progres" aria-hidden="true">
            <i style={{ width: `${(faites / Math.max(total.current, 1)) * 100}%` }} />
          </div>
          <div className="small muted">
            Réponse {faites + 1} sur {total.current}
          </div>
          <p>
            <strong>{courante.entreprise}</strong>
            <span className="muted">
              {' '}
              · {courante.contact} · {courante.mandat} ·{' '}
              {new Date(courante.recuLe).toLocaleDateString('fr-FR')}
            </span>
          </p>
          {courante.objet && <div className="small muted">{courante.objet}</div>}
          <blockquote className="bv-citation">{courante.extrait}</blockquote>
          {courante.classe && (
            <div className="small bv-propose">
              Proposé par Claude : {CLASSES.find(([c]) => c === courante.classe)?.[1]}
            </div>
          )}
          <div className="bv-classes">
            {CLASSES.map(([c, libelle], i) => (
              <button
                key={c}
                className={`bv-classe ${c === courante.classe ? 'propose' : ''} ${c === 'ne_plus_contacter' ? 'opposition' : ''}`}
                onClick={() => void valider(courante, c)}
              >
                {libelle}
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
          <p>
            <button
              className="btn ghost sm"
              onClick={() => setPassees((p) => new Set(p).add(courante.id))}
            >
              Passer cette réponse
            </button>
          </p>
        </div>
      ) : (
        <div className="empty">Aucune réponse à valider.</div>
      )}
      {info && <p className="small muted">{info}</p>}
      <div>
        <button className="btn sm" onClick={() => void entrer()}>
          Ajouter les répondants au CRM du mandat
        </button>
      </div>
    </div>
  );
}
