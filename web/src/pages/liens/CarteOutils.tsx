import { useState } from 'react';
import {
  fetchProjetsDiag,
  fetchTestsVma,
  fetchRendezVous,
  majProjetDiag,
  rattacherVma,
  lierRdv,
  type RefFiche,
} from '../../api.js';
import { Icon } from '../../icons.js';

type Type = 'diagnostic' | 'vma' | 'rdv';
type Ligne = { id: string; nom: string; detail?: string; href: string };
type Choix = { id: string; nom: string; autreLien: boolean };
const cleDe = (de: RefFiche) =>
  de.kind === 'affaire' ? 'opportuniteId' : de.kind === 'contact' ? 'contactId' : 'entrepriseId';

// Les liens restent locaux à l’OS, y compris pour une fiche provenant de HubSpot.
export function CarteOutils({
  slug,
  type,
  titre,
  de,
  lignes,
  onChange,
  onMessage,
}: {
  slug: string;
  type: Type;
  titre: string;
  de: RefFiche;
  lignes: Ligne[];
  onChange: () => void;
  onMessage: (message: string | null) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState<Choix[]>([]);
  const [recherche, setRecherche] = useState('');
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [charge, setCharge] = useState(false);
  const cle = cleDe(de);
  const erreur = (e: unknown) => onMessage(e instanceof Error ? e.message : String(e));
  const ouvrir = async () => {
    if (ouvert) return setOuvert(false);
    setOuvert(true);
    setCharge(false);
    setSelection('');
    setRecherche('');
    try {
      const liste: Choix[] =
        type === 'diagnostic'
          ? (await fetchProjetsDiag(slug)).map((p) => ({
              id: p.id,
              nom: p.nom,
              autreLien: !!p[cle] && p[cle] !== de.id,
            }))
          : type === 'vma'
            ? (await fetchTestsVma(slug)).map((t) => ({
                id: t.id,
                nom: `${t.entrepriseNom} · ${t.contactNom || t.contactEmail || 'Test VMA'} · ${new Date(t.creeLe).toLocaleDateString('fr-FR')}`,
                autreLien: !!t[cle] && t[cle] !== de.id,
              }))
            : await fetchRendezVous(slug).then((r) => {
                if (r.etat !== 'ok') throw new Error(r.erreur || 'Agenda non configuré.');
                return r.rdv
                  .filter((r) => r.statut !== 'ignore')
                  .map((r) => ({
                    id: r.id,
                    nom: `${r.titre} · ${new Date(r.debut).toLocaleString('fr-FR')}`,
                    autreLien: false,
                  }));
              });
      setChoix(liste.filter((c) => !lignes.some((l) => l.id === c.id)));
      setCharge(true);
    } catch (e) {
      erreur(e);
      setOuvert(false);
    }
  };
  const enregistrer = async (id: string, retirer = false) => {
    setBusy(true);
    try {
      if (type === 'rdv') await lierRdv(slug, id, de, retirer);
      else if (type === 'diagnostic')
        await majProjetDiag(slug, id, { [cle]: retirer ? null : de.id });
      else await rattacherVma(slug, id, { [cle]: retirer ? null : de.id });
      setOuvert(false);
      onMessage(null);
      onChange();
    } catch (e) {
      erreur(e);
    } finally {
      setBusy(false);
    }
  };
  const remplace = choix.find((c) => c.id === selection)?.autreLien;
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>
          {titre} ({lignes.length})
        </h2>
        <button
          className="btn sm"
          aria-label={`Lier un ${type === 'vma' ? 'test VMA' : type === 'rdv' ? 'rendez-vous' : 'diagnostic'}`}
          disabled={busy}
          onClick={() => void ouvrir()}
        >
          {ouvert ? 'Annuler' : '+ Lier'}
        </button>
      </div>
      {ouvert && (
        <div className="panel-b stack">
          {!charge ? (
            <p role="status">Chargement…</p>
          ) : (
            <>
              <input
                className="input"
                aria-label={`Rechercher dans ${titre}`}
                placeholder="Rechercher…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              <select
                className="input"
                aria-label={`Choisir dans ${titre}`}
                value={selection}
                onChange={(e) => setSelection(e.target.value)}
              >
                <option value="">Choisir…</option>
                {choix
                  .filter((c) =>
                    c.nom.toLocaleLowerCase('fr').includes(recherche.toLocaleLowerCase('fr')),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
              </select>
              {choix.length === 0 && (
                <p className="small muted">Aucun élément disponible à lier.</p>
              )}
              {remplace && (
                <p className="small muted">
                  Cet élément est déjà lié à une autre fiche de ce type. Son lien sera remplacé ;
                  ses autres rattachements seront conservés.
                </p>
              )}
              <button
                className="btn primary"
                disabled={busy || !selection}
                onClick={() => void enregistrer(selection)}
              >
                {remplace ? 'Remplacer le lien' : 'Lier à cette fiche'}
              </button>
            </>
          )}
        </div>
      )}
      <ul className="panel-b fi-liste">
        {lignes.length === 0 && (
          <li className="muted small">
            Aucun {type === 'vma' ? 'test VMA' : type === 'rdv' ? 'rendez-vous' : 'diagnostic'} lié.
          </li>
        )}
        {lignes.map((l) => (
          <li className="fi-ligne" key={l.id}>
            <span className="fi-ident">
              <span className="fi-av carre">
                <Icon name={type === 'rdv' ? 'cal' : 'radar'} />
              </span>
              <span>
                <a href={l.href}>{l.nom}</a>
                {l.detail && <span className="small muted"> {l.detail}</span>}
              </span>
            </span>
            <button
              className="btn ghost sm"
              aria-label={`Délier ${l.nom}`}
              disabled={busy}
              onClick={() => void enregistrer(l.id, true)}
            >
              <Icon name="x" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
