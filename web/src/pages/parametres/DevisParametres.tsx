import { useCallback, useEffect, useState } from 'react';
import {
  creerClauseDevis,
  creerModeleDevis,
  fetchParametresDevis,
  modifierClauseDevis,
  modifierModeleDevis,
  saveReglagesDevis,
  supprimerClauseDevis,
  supprimerModeleDevis,
  type ClauseBibliotheque,
  type ModeleMission,
  type ParametresDevis,
  type ReglagesDevis,
} from '../../api.js';
import { exempleNumero, formatNumeroValide } from '../../devis.js';

const erreur = (e: unknown) => (e instanceof Error ? e.message : String(e));
const UNITES: ModeleMission['lignes'][number]['unite'][] = [
  'forfait',
  'jour',
  'mois',
  'personne',
  'heure',
];
const MODELE_VIDE: ModeleMission = {
  nom: '',
  contexte: '',
  objectifs: '',
  inclus: '',
  exclu: '',
  livrables: '',
  duree: '',
  lignes: [],
};

function Reglages({
  slug,
  initial,
  onMessage,
}: {
  slug: string;
  initial: ReglagesDevis;
  onMessage: (m: string) => void;
}) {
  const [r, setR] = useState(initial);
  const valide = formatNumeroValide(r.numerotation);
  const nombre = (cle: 'tvaPct' | 'validiteJours' | 'acomptePct', libelle: string, max: number) => (
    <label className="field">
      <span>{libelle}</span>
      <input
        className="input"
        type="number"
        min={cle === 'validiteJours' ? 1 : 0}
        max={max}
        value={r[cle]}
        onChange={(e) => setR({ ...r, [cle]: Math.round(Number(e.target.value)) || 0 })}
      />
    </label>
  );
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-h">
        <h2>Réglages</h2>
      </div>
      <div className="panel-b stack">
        <label className="field">
          <span>Format de numérotation</span>
          <input
            className="input"
            value={r.numerotation}
            onChange={(e) => setR({ ...r, numerotation: e.target.value })}
          />
        </label>
        {valide ? (
          <p className="small muted" style={{ margin: 0 }}>
            Exemple : {exempleNumero(r.numerotation, new Date().getFullYear())}. {'{AAAA}'} = année,{' '}
            {'{NNN}'} = compteur (autant de N que de chiffres).
          </p>
        ) : (
          <p className="small" style={{ margin: 0, color: 'var(--red)' }}>
            Format invalide : il faut un compteur, par exemple DEV-{'{AAAA}'}-{'{NNN}'}.
          </p>
        )}
        <label className="field">
          <span>
            Pied de page des devis : mentions légales (raison sociale, adresse, SIRET, TVA…)
          </span>
          <textarea
            className="input"
            rows={3}
            value={r.mentions}
            onChange={(e) => setR({ ...r, mentions: e.target.value })}
          />
        </label>
        <div className="grid g2">
          {nombre('tvaPct', 'TVA (%)', 100)}
          {nombre('validiteJours', 'Validité par défaut (jours)', 365)}
          {nombre('acomptePct', 'Acompte par défaut (%)', 100)}
        </div>
        <div>
          <button
            className="btn primary"
            disabled={!valide}
            onClick={() =>
              void saveReglagesDevis(slug, r).then(
                () => onMessage('Réglages enregistrés.'),
                (e: unknown) => onMessage(erreur(e)),
              )
            }
          >
            Enregistrer les réglages
          </button>
        </div>
      </div>
    </div>
  );
}

function ClauseLigne({
  c,
  onSave,
  onDelete,
}: {
  c: ClauseBibliotheque & { id: string };
  onSave: (v: ClauseBibliotheque) => void;
  onDelete: () => void;
}) {
  const [v, setV] = useState<ClauseBibliotheque>(c);
  return (
    <div className="d-clause">
      <div>
        <input
          className="input"
          aria-label={`Titre de la clause ${c.titre}`}
          value={v.titre}
          onChange={(e) => setV({ ...v, titre: e.target.value })}
        />
        <textarea
          className="input"
          aria-label={`Texte de la clause ${c.titre}`}
          value={v.texte}
          onChange={(e) => setV({ ...v, texte: e.target.value })}
        />
        <label className="small">
          <input
            type="checkbox"
            checked={v.parDefaut}
            onChange={(e) => setV({ ...v, parDefaut: e.target.checked })}
          />{' '}
          Reprise automatiquement dans chaque nouveau devis
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button className="btn sm" onClick={() => onSave(v)}>
          Enregistrer
        </button>
        <button
          className="btn ghost sm"
          aria-label={`Supprimer la clause ${c.titre}`}
          onClick={onDelete}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

function Clauses({
  slug,
  clauses,
  onChange,
  onMessage,
}: {
  slug: string;
  clauses: ParametresDevis['clauses'];
  onChange: () => void;
  onMessage: (m: string) => void;
}) {
  const [titre, setTitre] = useState('');
  const [texte, setTexte] = useState('');
  const faire = (p: Promise<unknown>, ok: string) =>
    p.then(
      () => {
        onMessage(ok);
        onChange();
      },
      (e: unknown) => onMessage(erreur(e)),
    );
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-h">
        <h2>Bibliothèque de clauses (conditions de vente)</h2>
      </div>
      <div className="panel-b">
        <p className="small muted">
          Chaque clause est copiée dans le devis : la modifier ici ne change pas un devis déjà créé.
        </p>
        {clauses.map((c) => (
          <ClauseLigne
            key={c.id}
            c={c}
            onSave={(v) =>
              void faire(
                modifierClauseDevis(slug, c.id, { ...v, ordre: c.ordre }),
                'Clause enregistrée.',
              )
            }
            onDelete={() => void faire(supprimerClauseDevis(slug, c.id), 'Clause supprimée.')}
          />
        ))}
        <div className="d-clause">
          <div>
            <input
              className="input"
              placeholder="Titre de la clause"
              aria-label="Titre de la nouvelle clause"
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
            />
            <textarea
              className="input"
              placeholder="Texte de la clause"
              aria-label="Texte de la nouvelle clause"
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
            />
          </div>
          <button
            className="btn primary sm"
            disabled={!titre.trim()}
            onClick={() =>
              void faire(
                creerClauseDevis(slug, {
                  titre,
                  texte,
                  parDefaut: false,
                  ordre: clauses.length + 1,
                }),
                'Clause ajoutée.',
              ).then(() => {
                setTitre('');
                setTexte('');
              })
            }
          >
            Ajouter la clause
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeleFormulaire({
  titreBouton,
  initial,
  libelleChamp,
  onSubmit,
  onDelete,
}: {
  titreBouton: string;
  initial: ModeleMission;
  libelleChamp: string;
  onSubmit: (m: ModeleMission) => void;
  onDelete?: () => void;
}) {
  const [m, setM] = useState(initial);
  const champ = (cle: Exclude<keyof ModeleMission, 'lignes'>, libelle: string, texte = true) => (
    <label className="field">
      <span>{libelle}</span>
      {texte ? (
        <textarea
          className="input"
          rows={2}
          aria-label={`${libelle} ${libelleChamp}`}
          value={m[cle]}
          onChange={(e) => setM({ ...m, [cle]: e.target.value })}
        />
      ) : (
        <input
          className="input"
          aria-label={`${libelle} ${libelleChamp}`}
          value={m[cle]}
          onChange={(e) => setM({ ...m, [cle]: e.target.value })}
        />
      )}
    </label>
  );
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-b stack">
        {champ('nom', 'Nom', false)}
        {champ('contexte', 'Contexte')}
        {champ('objectifs', 'Objectifs')}
        {champ('inclus', 'Périmètre inclus')}
        {champ('exclu', 'Périmètre exclu')}
        {champ('livrables', 'Livrables')}
        {champ('duree', 'Durée', false)}
        <div className="small muted">
          Lignes de prestation (sans prix : vous fixez les prix dans chaque devis)
        </div>
        {m.lignes.map((l, k) => (
          <div key={k} style={{ display: 'flex', gap: 6 }}>
            <input
              className="input"
              aria-label={`Libellé de la ligne ${k + 1} ${libelleChamp}`}
              value={l.libelle}
              onChange={(e) =>
                setM({
                  ...m,
                  lignes: m.lignes.map((x, i) => (i === k ? { ...x, libelle: e.target.value } : x)),
                })
              }
            />
            <select
              className="input"
              style={{ width: 110 }}
              aria-label={`Unité de la ligne ${k + 1} ${libelleChamp}`}
              value={l.unite}
              onChange={(e) =>
                setM({
                  ...m,
                  lignes: m.lignes.map((x, i) =>
                    i === k ? { ...x, unite: e.target.value as typeof l.unite } : x,
                  ),
                })
              }
            >
              {UNITES.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <input
              className="input"
              style={{ width: 70 }}
              type="number"
              min={1}
              aria-label={`Quantité de la ligne ${k + 1} ${libelleChamp}`}
              value={l.quantite}
              onChange={(e) =>
                setM({
                  ...m,
                  lignes: m.lignes.map((x, i) =>
                    i === k
                      ? { ...x, quantite: Math.max(1, Math.round(Number(e.target.value)) || 1) }
                      : x,
                  ),
                })
              }
            />
            <button
              className="btn ghost sm"
              aria-label={`Retirer la ligne ${k + 1} ${libelleChamp}`}
              onClick={() => setM({ ...m, lignes: m.lignes.filter((_, i) => i !== k) })}
            >
              ×
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn sm"
            onClick={() =>
              setM({ ...m, lignes: [...m.lignes, { libelle: '', unite: 'forfait', quantite: 1 }] })
            }
          >
            + Ajouter une ligne
          </button>
          <button className="btn primary sm" disabled={!m.nom.trim()} onClick={() => onSubmit(m)}>
            {titreBouton}
          </button>
          {onDelete && (
            <button className="btn ghost sm" onClick={onDelete}>
              Supprimer le modèle
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Modeles({
  slug,
  modeles,
  onChange,
  onMessage,
}: {
  slug: string;
  modeles: ParametresDevis['modeles'];
  onChange: () => void;
  onMessage: (m: string) => void;
}) {
  const faire = (p: Promise<unknown>, ok: string) =>
    p.then(
      () => {
        onMessage(ok);
        onChange();
      },
      (e: unknown) => onMessage(erreur(e)),
    );
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Modèles de mission</h2>
      </div>
      <div className="panel-b">
        <p className="small muted">
          Un modèle pré-remplit le périmètre d’un devis. Il ne contient jamais de prix.
        </p>
        {modeles.map((m) => (
          <ModeleFormulaire
            key={m.id}
            titreBouton="Enregistrer le modèle"
            libelleChamp={`du modèle ${m.nom}`}
            initial={m}
            onSubmit={(v) => void faire(modifierModeleDevis(slug, m.id, v), 'Modèle enregistré.')}
            onDelete={() => void faire(supprimerModeleDevis(slug, m.id), 'Modèle supprimé.')}
          />
        ))}
        <ModeleFormulaire
          key={modeles.length}
          titreBouton="Ajouter le modèle"
          libelleChamp="du nouveau modèle"
          initial={MODELE_VIDE}
          onSubmit={(v) => void faire(creerModeleDevis(slug, v), 'Modèle ajouté.')}
        />
      </div>
    </div>
  );
}

export function DevisParametres({ slug }: { slug: string }) {
  const [p, setP] = useState<ParametresDevis | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const charger = useCallback(() => {
    fetchParametresDevis(slug).then(setP, (e: unknown) => setMessage(erreur(e)));
  }, [slug]);
  useEffect(charger, [charger]);
  if (!p) return <div className="empty">{message ?? 'Chargement des paramètres du devis…'}</div>;
  return (
    <>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
      <Reglages slug={slug} initial={p.reglages} onMessage={setMessage} />
      <Clauses slug={slug} clauses={p.clauses} onChange={charger} onMessage={setMessage} />
      <Modeles slug={slug} modeles={p.modeles} onChange={charger} onMessage={setMessage} />
    </>
  );
}
