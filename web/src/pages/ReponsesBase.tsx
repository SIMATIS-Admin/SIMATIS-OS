import { useCallback, useEffect, useState } from 'react';
import {
  entrerRepondantsBase,
  fetchReponsesBase,
  validerReponseBase,
  type ClasseReponseBase,
  type ReponseBase,
} from '../api.js';
import { Icon } from '../icons.js';

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

function Ligne({
  r,
  onValider,
}: {
  r: ReponseBase;
  onValider: (classe: ClasseReponseBase) => Promise<void>;
}) {
  const [classe, setClasse] = useState<ClasseReponseBase>(r.classe ?? 'repondu');
  return (
    <tr>
      <td>
        {r.entreprise}
        <div className="small muted">
          {r.contact} · {r.mandat} · {new Date(r.recuLe).toLocaleDateString('fr-FR')}
        </div>
      </td>
      <td>
        {r.objet && <div>{r.objet}</div>}
        <div className="small muted">{r.extrait}</div>
      </td>
      <td>
        <select
          className="input"
          aria-label={`Classe de la réponse de ${r.contact}`}
          value={classe}
          onChange={(e) => setClasse(e.target.value as ClasseReponseBase)}
        >
          {CLASSES.map(([c, libelle]) => (
            <option key={c} value={c}>
              {libelle}
            </option>
          ))}
        </select>
      </td>
      <td>
        <button className="btn sm primary" onClick={() => void onValider(classe)}>
          Valider
        </button>
      </td>
    </tr>
  );
}

// Replies Claude classed wait here: the record only moves once the pilot validates.
export function ReponsesBase({ slug, onChange }: { slug: string; onChange: () => void }) {
  const [aValider, setAValider] = useState<ReponseBase[]>([]);
  const [aClasser, setAClasser] = useState(0);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const charger = useCallback(
    () =>
      fetchReponsesBase(slug).then(
        (r) => {
          setAValider(r.aValider);
          setAClasser(r.aClasser);
        },
        () => undefined,
      ),
    [slug],
  );
  useEffect(() => void charger(), [charger]);

  const agir = async (f: () => Promise<void>) => {
    setError(null);
    setInfo(null);
    try {
      await f();
    } catch (e) {
      setError(message(e));
    }
  };

  const valider = (r: ReponseBase, classe: ClasseReponseBase) =>
    agir(async () => {
      await validerReponseBase(slug, r.id, classe);
      await charger();
      onChange();
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
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>Réponses reçues</h2>
          <div className="small muted">
            Claude propose une classe pour chaque réponse ; vous validez. « Ne plus me contacter »
            devient une opposition, prioritaire sur tout.
            {aClasser > 0 &&
              ` ${entier(aClasser)} réponse${aClasser > 1 ? 's' : ''} attend${aClasser > 1 ? 'ent' : ''} la routine « Base vivante ».`}
          </div>
        </div>
        <div className="sw-actions">
          <button className="btn sm" onClick={() => void entrer()}>
            Ajouter les répondants au CRM du mandat
          </button>
        </div>
      </div>
      <div className="panel-b">
        {info && <p className="small muted">{info}</p>}
        {error && (
          <div className="alert amber">
            <Icon name="info" />
            <div>{error}</div>
          </div>
        )}
        {aValider.length === 0 ? (
          <div className="empty">Aucune réponse à valider.</div>
        ) : (
          <div className="mapping-scroll">
            <table className="tbl small">
              <thead>
                <tr>
                  <th>Prospect</th>
                  <th>Réponse</th>
                  <th>Classe</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {aValider.map((r) => (
                  <Ligne key={r.id} r={r} onValider={(c) => valider(r, c)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
