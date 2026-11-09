import { useState } from 'react';
import {
  ajouterEntreprisesBase,
  interpreterEntreprisesBase,
  rechercherEntreprisesBase,
  type CriteresWeb,
  type PageEntreprisesWeb,
  type ResumeListeBase,
} from '../api.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const entier = (n: number) => n.toLocaleString('fr-FR');
// A published turnover of 0 means the figure is not disclosed, not that the company earns nothing.
const euros = (n: number | null | undefined) =>
  !n
    ? '—'
    : new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(n);

// Effectif brackets of the directory, grouped the way a salesperson thinks of company size.
const TAILLES: [string, string[]][] = [
  ['1 à 9 salariés', ['01', '02', '03']],
  ['10 à 49', ['11', '12']],
  ['50 à 249', ['21', '22', '31']],
  ['250 à 999', ['32', '41']],
  ['1 000 et plus', ['42', '51', '52', '53']],
];
const CATEGORIES = ['PME', 'ETI', 'GE'];
const VIDES: CriteresWeb = { secteurs: [], departements: [], effectifs: [], categories: [] };

// Describe the target in plain words, check what was understood, search the State directory,
// then bring the chosen companies into the base, ready to be enriched with contacts.
export function RechercheEntreprises({
  slug,
  listes,
  onAjoute,
}: {
  slug: string;
  listes: ResumeListeBase[];
  onAjoute: (message: string) => void;
}) {
  const [demande, setDemande] = useState('');
  const [criteres, setCriteres] = useState<CriteresWeb>(VIDES);
  const [departements, setDepartements] = useState('');
  const [secteur, setSecteur] = useState('');
  const [compris, setCompris] = useState<{ resume: string; nonTraites: string[] } | null>(null);
  const [page, setPage] = useState<PageEntreprisesWeb | null>(null);
  const [choisies, setChoisies] = useState<Set<string>>(new Set());
  const [liste, setListe] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const agir = async (action: () => Promise<void>) => {
    setOccupe(true);
    setErreur(null);
    try {
      await action();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };
  const maj = (patch: Partial<CriteresWeb>) => setCriteres((c) => ({ ...c, ...patch }));
  const liste2 = (valeur: string) =>
    valeur
      .split(/[\s,;]+/)
      .map((d) => d.trim().toUpperCase())
      .filter(Boolean);

  const comprendre = () =>
    agir(async () => {
      const r = await interpreterEntreprisesBase(slug, demande);
      setCriteres(r.criteres);
      setDepartements(r.criteres.departements.join(', '));
      setCompris({ resume: r.resume, nonTraites: r.nonTraites });
      setPage(null);
    });

  const lancer = (numero: number) =>
    agir(async () => {
      const r = await rechercherEntreprisesBase(
        slug,
        { ...criteres, departements: liste2(departements) },
        numero,
      );
      setPage(r);
      setChoisies(new Set());
    });

  const ajouter = () =>
    agir(async () => {
      const r = await ajouterEntreprisesBase(slug, [...choisies], liste || undefined);
      const morceaux = [
        r.ajoutees > 0 && `${r.ajoutees} ajoutée${r.ajoutees > 1 ? 's' : ''} à enrichir`,
        r.existantes > 0 &&
          `${r.existantes} déjà connue${r.existantes > 1 ? 's' : ''}, rattachée${r.existantes > 1 ? 's' : ''}`,
        r.introuvables > 0 && `${r.introuvables} introuvable${r.introuvables > 1 ? 's' : ''}`,
      ].filter(Boolean);
      onAjoute(`Entreprises : ${morceaux.join(', ')}.`);
      setChoisies(new Set());
      if (page) setPage({ ...page, dejaDansLaBase: [...page.dejaDansLaBase, ...choisies] });
    });

  const aUnCritere =
    Boolean(criteres.q) ||
    criteres.secteurs.length > 0 ||
    liste2(departements).length > 0 ||
    criteres.effectifs.length > 0 ||
    criteres.categories.length > 0 ||
    criteres.caMin !== undefined ||
    criteres.caMax !== undefined;
  const basculer = <T,>(liste: T[], valeur: T): T[] =>
    liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur];
  const selectionnables =
    page?.resultats.filter((r) => !page.dejaDansLaBase.includes(r.siren)) ?? [];

  return (
    <div className="bv-recherche-entreprises">
      {erreur && (
        <p className="error" role="alert">
          {erreur}
        </p>
      )}
      <label className="small">
        Les entreprises que vous cherchez
        <textarea
          className="input"
          rows={3}
          value={demande}
          placeholder="PME de la métallurgie dans le Rhône et l’Ain, 20 à 100 salariés"
          onChange={(e) => setDemande(e.target.value)}
        />
      </label>
      <p>
        <button
          className="btn"
          disabled={occupe || !demande.trim()}
          onClick={() => void comprendre()}
        >
          Comprendre ma demande
        </button>{' '}
        {occupe && !page && <span className="small muted">L’IA lit votre demande…</span>}
      </p>
      {compris && (
        <div className="bv-compris">
          <p className="small">{compris.resume}</p>
          {compris.nonTraites.length > 0 && (
            <p className="small muted">
              L’annuaire ne permet pas de filtrer : {compris.nonTraites.join(' ; ')}. À vérifier
              entreprise par entreprise.
            </p>
          )}
        </div>
      )}

      <fieldset className="bv-criteres">
        <legend>Critères de recherche</legend>
        <p>
          {criteres.secteurs.map((s) => (
            <span key={s.code} className="badge">
              {s.libelle.includes(s.code) ? s.libelle : `${s.libelle} (${s.code})`}{' '}
              <button
                className="bv-fermer"
                aria-label={`Retirer le secteur ${s.libelle}`}
                onClick={() =>
                  maj({ secteurs: criteres.secteurs.filter((x) => x.code !== s.code) })
                }
              >
                ×
              </button>
            </span>
          ))}{' '}
          <input
            className="input"
            aria-label="Ajouter un secteur (division ou code NAF)"
            placeholder="Secteur : 25 ou 25.62B"
            value={secteur}
            onChange={(e) => setSecteur(e.target.value)}
            onKeyDown={(e) => {
              const code = secteur.trim().toUpperCase();
              if (e.key === 'Enter' && /^(\d\d|\d\d\.\d\d[A-Z])$/.test(code)) {
                e.preventDefault();
                maj({
                  secteurs: [
                    ...criteres.secteurs,
                    { code, libelle: code.length === 2 ? `Division ${code}` : `NAF ${code}` },
                  ],
                });
                setSecteur('');
              }
            }}
          />
        </p>
        <label className="small">
          Départements
          <input
            className="input"
            value={departements}
            placeholder="69, 01, 2A"
            onChange={(e) => setDepartements(e.target.value)}
          />
        </label>
        <div role="group" aria-label="Taille de l’entreprise">
          {TAILLES.map(([libelle, codes]) => (
            <label key={libelle} className="small">
              <input
                type="checkbox"
                checked={codes.every((c) => criteres.effectifs.includes(c))}
                onChange={(e) =>
                  maj({
                    effectifs: e.target.checked
                      ? [...new Set([...criteres.effectifs, ...codes])]
                      : criteres.effectifs.filter((c) => !codes.includes(c)),
                  })
                }
              />{' '}
              {libelle}{' '}
            </label>
          ))}
        </div>
        <div role="group" aria-label="Catégorie">
          {CATEGORIES.map((c) => (
            <label key={c} className="small">
              <input
                type="checkbox"
                checked={criteres.categories.includes(c)}
                onChange={() => maj({ categories: basculer(criteres.categories, c) })}
              />{' '}
              {c}{' '}
            </label>
          ))}
        </div>
        <label className="small">
          Mots-clés
          <input
            className="input"
            value={criteres.q ?? ''}
            onChange={(e) => maj({ q: e.target.value || undefined })}
          />
        </label>
      </fieldset>
      <p>
        <button
          className="btn primary"
          disabled={occupe || !aUnCritere}
          onClick={() => void lancer(1)}
        >
          Chercher dans l’annuaire
        </button>
      </p>

      {page && (
        <section aria-label="Résultats">
          <p className="small muted">
            {entier(page.total)} entreprise{page.total > 1 ? 's' : ''}
            {page.total >= 10000
              ? ' ou plus (l’annuaire n’en montre pas plus de 10 000) : affinez la recherche'
              : ''}
            {' · '}page {page.page} sur {entier(Math.min(page.pages, 400))}
          </p>
          {page.resultats.length === 0 ? (
            <p className="muted">Aucune entreprise ne correspond.</p>
          ) : (
            <table className="tbl small">
              <thead>
                <tr>
                  <th />
                  <th>Entreprise</th>
                  <th>Ville</th>
                  <th>Activité</th>
                  <th>Effectif</th>
                  <th>CA publié</th>
                </tr>
              </thead>
              <tbody>
                {page.resultats.map((r) => {
                  const deja = page.dejaDansLaBase.includes(r.siren);
                  return (
                    <tr key={r.siren}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Choisir ${r.nom}`}
                          disabled={deja}
                          checked={choisies.has(r.siren)}
                          onChange={() => setChoisies(new Set(basculer([...choisies], r.siren)))}
                        />
                      </td>
                      <td>
                        {r.nom}
                        {deja && <span className="badge"> déjà dans la base</span>}
                      </td>
                      <td>{r.ville ?? '—'}</td>
                      <td>{r.naf ?? '—'}</td>
                      <td>{r.effectif ?? '—'}</td>
                      <td>{euros(r.finances[0]?.ca)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p>
            <button
              className="btn sm"
              disabled={occupe || page.page <= 1}
              onClick={() => void lancer(page.page - 1)}
            >
              Page précédente
            </button>{' '}
            <button
              className="btn sm"
              disabled={occupe || page.page >= Math.min(page.pages, 400)}
              onClick={() => void lancer(page.page + 1)}
            >
              Page suivante
            </button>{' '}
            <button
              className="btn sm"
              disabled={occupe || selectionnables.length === 0}
              onClick={() => setChoisies(new Set(selectionnables.map((r) => r.siren)))}
            >
              Tout choisir
            </button>
          </p>
          {choisies.size > 0 && (
            <p>
              <select
                className="input"
                aria-label="Ranger dans une liste"
                value={liste}
                onChange={(e) => setListe(e.target.value)}
              >
                <option value="">Sans liste</option>
                {listes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nom}
                  </option>
                ))}
              </select>{' '}
              <button className="btn primary" disabled={occupe} onClick={() => void ajouter()}>
                Ajouter {choisies.size} entreprise{choisies.size > 1 ? 's' : ''} à la base
              </button>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
