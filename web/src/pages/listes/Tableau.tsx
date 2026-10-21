import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../../icons.js';
import { Modal } from '../Overlay.js';

// Pipedrive-like list view: chosen and sortable columns, saved filters, in-place and bulk editing.
// Column choice and saved filters are per-browser conveniences (localStorage).

export type Colonne<T> = {
  cle: string;
  label: string;
  valeur: (l: T) => string | number | null;
  affiche?: (l: T) => ReactNode;
  edition?: { champ: string; type?: 'text' | 'number' | 'email' };
  // Hidden until chosen in « Colonnes ».
  masquee?: boolean;
};
export type BilanSuppression = {
  ok: number;
  erreurs: { id: string; erreur: string }[];
  simulation: boolean;
};
type Filtre = { champ: string; valeur: string };
type Enregistre = Filtre & { nom: string };

const PAGE = 50;

// Next activity date, short, in Paris time.
export const jour = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris',
        day: 'numeric',
        month: 'short',
      })
    : '';

function lire<V>(cle: string, defaut: V): V {
  try {
    const v = localStorage.getItem(cle);
    return v ? (JSON.parse(v) as V) : defaut;
  } catch {
    return defaut;
  }
}
function ecrire(cle: string, v: unknown) {
  try {
    localStorage.setItem(cle, JSON.stringify(v));
  } catch {
    // Private window or blocked storage: the choice simply lasts this visit.
  }
}

const sansAccents = (v: string) =>
  v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function Cellule<T>({
  ligne,
  col,
  titre,
  onModifier,
}: {
  ligne: T;
  col: Colonne<T>;
  titre: string;
  onModifier: (l: T, champ: string, v: string | number | null) => Promise<void>;
}) {
  const [edition, setEdition] = useState<string | null>(null);
  const valeur = col.valeur(ligne);
  const valider = () => {
    if (edition === null || !col.edition) return;
    const v = edition.trim();
    setEdition(null);
    void onModifier(
      ligne,
      col.edition.champ,
      v === '' ? null : col.edition.type === 'number' ? Number(v) : v,
    );
  };
  const touche = (e: KeyboardEvent) => {
    if (e.key === 'Enter') valider();
    if (e.key === 'Escape') setEdition(null);
  };
  if (edition !== null)
    return (
      <input
        className="input"
        autoFocus
        aria-label={`${col.label} de ${titre}`}
        type={col.edition?.type ?? 'text'}
        value={edition}
        onChange={(e) => setEdition(e.target.value)}
        onKeyDown={touche}
        onBlur={valider}
      />
    );
  return (
    <span className="tb-cellule">
      {col.affiche ? col.affiche(ligne) : (valeur ?? '')}
      {col.edition && (
        <button
          className="btn ghost sm tb-crayon"
          aria-label={`Modifier ${col.label} de ${titre}`}
          onClick={(e) => {
            e.stopPropagation();
            setEdition(valeur === null ? '' : String(valeur));
          }}
        >
          <Icon name="edit" />
        </button>
      )}
    </span>
  );
}

export function Tableau<T extends { id: string }>({
  cle,
  lignes,
  colonnes,
  titre,
  onOuvrir,
  onModifier,
  onSupprimer,
  onFusionner,
}: {
  cle: string;
  lignes: T[];
  colonnes: Colonne<T>[];
  titre: (l: T) => string;
  onOuvrir: (l: T) => void;
  onModifier: (l: T, champ: string, v: string | number | null) => Promise<void>;
  // Without them the list neither deletes nor merges.
  onSupprimer?: (ids: string[]) => Promise<BilanSuppression>;
  onFusionner?: (gardeId: string, absorbeId: string) => Promise<{ simulation: boolean } | void>;
}) {
  const prefixe = `simatis.liste.${cle}`;
  const [masquees, setMasquees] = useState<string[]>(() =>
    lire(
      `${prefixe}.masquees`,
      colonnes.filter((c) => c.masquee).map((c) => c.cle),
    ),
  );
  const [choix, setChoix] = useState(false);
  const [tri, setTri] = useState<{ cle: string; sens: 1 | -1 } | null>(null);
  const [filtre, setFiltre] = useState<Filtre>({ champ: '', valeur: '' });
  const [nomFiltre, setNomFiltre] = useState('');
  const [enregistres, setEnregistres] = useState<Enregistre[]>(() =>
    lire(`${prefixe}.filtres`, []),
  );
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lot, setLot] = useState({ champ: '', valeur: '' });
  const [limite, setLimite] = useState(PAGE);
  const [action, setAction] = useState<'supprimer' | 'fusionner' | null>(null);
  const [garde, setGarde] = useState('');
  const [bilan, setBilan] = useState<string | null>(null);

  const visibles = colonnes.filter((c) => !masquees.includes(c.cle));
  const editables = colonnes.filter((c) => c.edition);
  const colFiltre = colonnes.find((c) => c.cle === filtre.champ);
  const filtrees = lignes.filter(
    (l) =>
      !colFiltre ||
      !filtre.valeur.trim() ||
      sansAccents(String(colFiltre.valeur(l) ?? '')).includes(sansAccents(filtre.valeur.trim())),
  );
  const colTri = colonnes.find((c) => c.cle === tri?.cle);
  const triees =
    colTri && tri
      ? [...filtrees].sort((a, b) => {
          const x = colTri.valeur(a);
          const y = colTri.valeur(b);
          if (x === null || x === '') return 1;
          if (y === null || y === '') return -1;
          return (
            (typeof x === 'number' && typeof y === 'number'
              ? x - y
              : String(x).localeCompare(String(y), 'fr')) * tri.sens
          );
        })
      : filtrees;

  const basculerColonne = (c: string) => {
    const next = masquees.includes(c) ? masquees.filter((x) => x !== c) : [...masquees, c];
    setMasquees(next);
    ecrire(`${prefixe}.masquees`, next);
  };
  const trier = (c: string) =>
    setTri((t) => (t?.cle === c ? { cle: c, sens: t.sens === 1 ? -1 : 1 } : { cle: c, sens: 1 }));
  const enregistrer = () => {
    if (!nomFiltre.trim() || !filtre.champ) return;
    const next = [
      ...enregistres.filter((f) => f.nom !== nomFiltre.trim()),
      { ...filtre, nom: nomFiltre.trim() },
    ];
    setEnregistres(next);
    ecrire(`${prefixe}.filtres`, next);
    setNomFiltre('');
  };
  const selectionner = (id: string) =>
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const appliquer = async () => {
    const col = editables.find((c) => c.edition?.champ === lot.champ);
    if (!col?.edition) return;
    const v = lot.valeur.trim();
    const valeur = v === '' ? null : col.edition.type === 'number' ? Number(v) : v;
    for (const l of lignes.filter((x) => selection.has(x.id))) {
      await onModifier(l, lot.champ, valeur);
    }
    setSelection(new Set());
    setLot({ champ: '', valeur: '' });
  };

  const choisies = lignes.filter((l) => selection.has(l.id));
  const fermer = () => {
    setAction(null);
    setGarde('');
  };
  const supprimer = async () => {
    if (!onSupprimer) return;
    const r = await onSupprimer(choisies.map((l) => l.id));
    const nom = (id: string) => titre(lignes.find((l) => l.id === id) ?? choisies[0]!);
    setBilan(
      r.simulation
        ? "Simulation : rien n'a été supprimé (écritures réelles désactivées)."
        : [
            `${r.ok} supprimée${r.ok > 1 ? 's' : ''}`,
            ...(r.erreurs.length > 0
              ? [
                  `${r.erreurs.length} échec${r.erreurs.length > 1 ? 's' : ''} : ${r.erreurs.map((e) => `${nom(e.id)} (${e.erreur})`).join(' ; ')}`,
                ]
              : []),
          ].join(', '),
    );
    fermer();
    setSelection(new Set());
  };
  const fusionner = async () => {
    const absorbe = choisies.find((l) => l.id !== garde);
    if (!onFusionner || !garde || !absorbe) return;
    const r = await onFusionner(garde, absorbe.id);
    setBilan(
      r?.simulation
        ? "Simulation : rien n'a été fusionné (écritures réelles désactivées)."
        : 'Fiches fusionnées.',
    );
    fermer();
    setSelection(new Set());
  };

  return (
    <div className="tb">
      {bilan && (
        <div className="alert amber" role="status" style={{ margin: 8 }}>
          <div>{bilan}</div>
        </div>
      )}
      <div className="tb-outils">
        <select
          className="input"
          aria-label="Filtres enregistrés"
          value=""
          onChange={(e) => {
            const f = enregistres.find((x) => x.nom === e.target.value);
            if (f) setFiltre({ champ: f.champ, valeur: f.valeur });
          }}
        >
          <option value="">Filtres enregistrés…</option>
          {enregistres.map((f) => (
            <option key={f.nom} value={f.nom}>
              {f.nom}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Champ du filtre"
          value={filtre.champ}
          onChange={(e) => setFiltre({ ...filtre, champ: e.target.value })}
        >
          <option value="">Filtrer sur…</option>
          {colonnes.map((c) => (
            <option key={c.cle} value={c.cle}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          className="input"
          aria-label="Valeur du filtre"
          placeholder="contient…"
          value={filtre.valeur}
          onChange={(e) => setFiltre({ ...filtre, valeur: e.target.value })}
        />
        {filtre.champ && filtre.valeur && (
          <>
            <input
              className="input"
              aria-label="Nom du filtre"
              placeholder="Nom du filtre"
              value={nomFiltre}
              onChange={(e) => setNomFiltre(e.target.value)}
            />
            <button className="btn sm" onClick={enregistrer}>
              Enregistrer le filtre
            </button>
            <button className="btn ghost sm" onClick={() => setFiltre({ champ: '', valeur: '' })}>
              Effacer
            </button>
          </>
        )}
        <span className="tb-espace" />
        <div className="tb-colonnes">
          <button className="btn sm" onClick={() => setChoix(!choix)}>
            Colonnes
          </button>
          {choix && (
            <div className="tb-menu">
              {colonnes.map((c) => (
                <label key={c.cle} className="check">
                  <input
                    type="checkbox"
                    aria-label={`Afficher la colonne ${c.label}`}
                    checked={!masquees.includes(c.cle)}
                    disabled={c.cle === colonnes[0]?.cle}
                    onChange={() => basculerColonne(c.cle)}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      {selection.size > 0 && (
        <section className="tb-lot" aria-label={`${selection.size} sélectionnées`}>
          <b>
            {selection.size} sélectionnée{selection.size > 1 ? 's' : ''}
          </b>
          <select
            className="input"
            aria-label="Champ à modifier"
            value={lot.champ}
            onChange={(e) => setLot({ ...lot, champ: e.target.value })}
          >
            <option value="">Champ…</option>
            {editables.map((c) => (
              <option key={c.cle} value={c.edition?.champ}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            className="input"
            aria-label="Nouvelle valeur"
            value={lot.valeur}
            onChange={(e) => setLot({ ...lot, valeur: e.target.value })}
          />
          <button className="btn primary sm" disabled={!lot.champ} onClick={() => void appliquer()}>
            Appliquer
          </button>
          {onFusionner && (
            <button
              className="btn sm"
              disabled={selection.size !== 2}
              title={selection.size === 2 ? undefined : 'Cochez exactement deux fiches'}
              onClick={() => setAction('fusionner')}
            >
              Fusionner
            </button>
          )}
          {onSupprimer && (
            <button className="btn sm" onClick={() => setAction('supprimer')}>
              Supprimer la sélection
            </button>
          )}
          <button className="btn ghost sm" onClick={() => setSelection(new Set())}>
            Annuler
          </button>
        </section>
      )}
      {action === 'supprimer' && (
        <Modal
          title={`Supprimer ${choisies.length} fiche${choisies.length > 1 ? 's' : ''} ?`}
          onClose={fermer}
        >
          <p>
            Les fiches sont supprimées de l’OS et archivées dans HubSpot si elles y existent. Leurs
            tâches et activités restent, détachées.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn primary" onClick={() => void supprimer()}>
              Confirmer la suppression
            </button>
            <button className="btn ghost" onClick={fermer}>
              Annuler
            </button>
          </div>
        </Modal>
      )}
      {action === 'fusionner' && choisies.length === 2 && (
        <Modal title="Fusionner deux fiches" onClose={fermer}>
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend>Quelle fiche garder ?</legend>
            {choisies.map((l) => (
              <label key={l.id} className="check">
                <input
                  type="radio"
                  name="garde"
                  value={l.id}
                  checked={garde === l.id}
                  onChange={() => setGarde(l.id)}
                />
                <span>{titre(l)}</span>
              </label>
            ))}
          </fieldset>
          <p className="small muted">
            Liens, tâches et historique de l’autre fiche passent sur celle-ci, puis l’autre est
            supprimée. La fusion est définitive dans HubSpot.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn primary" disabled={!garde} onClick={() => void fusionner()}>
              Confirmer la fusion
            </button>
            <button className="btn ghost" onClick={fermer}>
              Annuler
            </button>
          </div>
        </Modal>
      )}
      <table className="tbl">
        <thead>
          <tr>
            <th className="tb-case">
              <input
                type="checkbox"
                aria-label="Tout sélectionner"
                checked={triees.length > 0 && triees.every((l) => selection.has(l.id))}
                onChange={(e) =>
                  setSelection(e.target.checked ? new Set(triees.map((l) => l.id)) : new Set())
                }
              />
            </th>
            {visibles.map((c) => (
              <th key={c.cle}>
                <button
                  className="tb-tri"
                  aria-label={`Trier par ${c.label}`}
                  onClick={() => trier(c.cle)}
                >
                  {c.label}
                  {tri?.cle === c.cle ? (tri.sens === 1 ? ' ↑' : ' ↓') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {triees.slice(0, limite).map((l) => (
            <tr key={l.id} className={selection.has(l.id) ? 'sel' : ''}>
              <td className="tb-case">
                <input
                  type="checkbox"
                  aria-label={`Sélectionner ${titre(l)}`}
                  checked={selection.has(l.id)}
                  onChange={() => selectionner(l.id)}
                />
              </td>
              {visibles.map((c, k) => (
                <td
                  key={c.cle}
                  className={k === 0 ? 'tb-nom' : ''}
                  onClick={k === 0 ? () => onOuvrir(l) : undefined}
                >
                  <Cellule ligne={l} col={c} titre={titre(l)} onModifier={onModifier} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {triees.length > limite && (
        <button className="btn tb-plus" onClick={() => setLimite(limite + PAGE)}>
          Afficher plus ({triees.length - limite})
        </button>
      )}
    </div>
  );
}
