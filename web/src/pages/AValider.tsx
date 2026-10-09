import { useCallback, useEffect, useState } from 'react';
import { decider, fetchPropositions, type PropositionItem } from '../api.js';
import { htmlSur } from '../html.js';
import { Icon } from '../icons.js';
import { Gauge, Tip } from './widgets.js';

const FILTRES = [
  ['tout', 'Tout'],
  ['brouillon', 'Brouillon'],
  ['tache', 'Tâche CRM'],
  ['cerveau', 'Second cerveau'],
  ['traites', 'Traités'],
] as const;
type Filtre = (typeof FILTRES)[number][0];

const TYPE_LIBELLE: Record<string, string> = {
  'email.brouillon': 'Brouillon',
  'crm.tache': 'Tâche CRM',
  'note.second_cerveau': 'Second cerveau',
};
const NIVEAU_TIP = (n: string) =>
  `Niveau d'autonomie de l'OS pour cette action (${n}). Il va de L0, l'OS suggère seulement, à L3, l'OS agit seul. Plus il y a de barres colorées, plus l'OS peut agir sans vous.`;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const titre = (p: PropositionItem) =>
  p.type === 'email.brouillon' ? str(p.contenu.objet) : str(p.contenu.titre) || p.type;

function Statut({ p }: { p: PropositionItem }) {
  if (p.statut === 'proposee')
    return <span className="badge">{TYPE_LIBELLE[p.type] ?? p.type}</span>;
  if (p.statut === 'appliquee') return <span className="badge green">Validé</span>;
  if (p.statut === 'echec') return <span className="badge red">Échec</span>;
  return <span className="badge">Écarté</span>;
}

function Detail({
  p,
  onDecide,
}: {
  p: PropositionItem;
  onDecide: (d: 'valider' | 'ecarter', contenu?: Record<string, unknown>) => void;
}) {
  const [edition, setEdition] = useState(false);
  const [objet, setObjet] = useState(str(p.contenu.objet));
  const [corps, setCorps] = useState(str(p.contenu.corps));
  useEffect(() => {
    setEdition(false);
    setObjet(str(p.contenu.objet));
    setCorps(str(p.contenu.corps));
  }, [p]);

  const modifie = objet !== str(p.contenu.objet) || corps !== str(p.contenu.corps);
  const contenuModifie = modifie ? { ...p.contenu, objet, corps } : undefined;
  const ouverte = p.statut === 'proposee';
  const resultat = p.resultat as { erreur?: string; simulation?: boolean } | null;

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>{titre(p)}</h2>
        <Statut p={p} />
      </div>
      <div className="panel-b">
        <div className="meta-row" style={{ marginBottom: 12 }}>
          <span>
            <Gauge niveau={p.niveau} /> <Tip text={NIVEAU_TIP(p.niveau)} />
          </span>
          {p.action && <span>{p.action}</span>}
          {typeof p.contenu.origine === 'string' && (
            <span>
              Origine : <b>{p.contenu.origine}</b>
            </span>
          )}
        </div>

        {!ouverte && (
          <div
            className={`alert ${p.statut === 'appliquee' ? 'blue' : 'amber'}`}
            style={{ marginBottom: 12 }}
          >
            <Icon name="info" />
            <div>
              {p.statut === 'appliquee'
                ? resultat?.simulation
                  ? 'Validé, en simulation : rien n’a été écrit dans les outils du client.'
                  : 'Validé et appliqué.'
                : p.statut === 'echec'
                  ? `Validé, mais l'application a échoué : ${resultat?.erreur ?? ''}`
                  : 'Écarté par vous.'}
            </div>
          </div>
        )}

        {p.type === 'email.brouillon' && (
          <>
            <div className="mail">
              <div className="mail-h">
                <div>
                  <span>À</span>
                  {p.contact ? `${p.contact.nom} ` : ''}&lt;{str(p.contenu.to)}&gt;
                </div>
                <div>
                  <span>Objet</span>
                  {edition ? (
                    <input
                      className="input"
                      value={objet}
                      onChange={(e) => setObjet(e.target.value)}
                    />
                  ) : (
                    <b>{objet}</b>
                  )}
                </div>
              </div>
              {edition ? (
                <textarea
                  className="input"
                  rows={12}
                  aria-label="Texte du brouillon"
                  value={corps}
                  onChange={(e) => setCorps(e.target.value)}
                />
              ) : (
                <div className="mail-b" dangerouslySetInnerHTML={{ __html: htmlSur(corps) }} />
              )}
            </div>
            {Array.isArray(p.contenu.controles) && p.contenu.controles.length > 0 && (
              <>
                <h3 style={{ margin: '16px 0 6px' }}>Contrôles faits avant rédaction</h3>
                <ul className="checks">
                  {(p.contenu.controles as string[]).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {p.type === 'crm.tache' && (
          <>
            <p>{str(p.contenu.detail)}</p>
            <div className="meta-row">
              {p.contact && (
                <span>
                  Contact : <b>{p.contact.nom}</b>
                  {p.contact.entreprise ? `, ${p.contact.entreprise}` : ''}
                </span>
              )}
              {typeof p.contenu.echeance === 'string' && (
                <span>
                  Échéance proposée :{' '}
                  <b>
                    {new Date(p.contenu.echeance).toLocaleDateString('fr-FR', {
                      timeZone: 'Europe/Paris',
                    })}
                  </b>
                </span>
              )}
            </div>
          </>
        )}
        {p.type === 'note.second_cerveau' && (
          <>
            <p>{str(p.contenu.texte)}</p>
            <div className="meta-row">
              {typeof p.contenu.destination === 'string' && (
                <span>
                  Destination : <b>{p.contenu.destination}</b>
                </span>
              )}
              <span>
                Statut à l'écriture : <b>brouillon</b>
              </span>
            </div>
          </>
        )}

        {ouverte && (
          <div className="decision">
            <button className="btn go" onClick={() => onDecide('valider', contenuModifie)}>
              <Icon name="check" />
              {p.type === 'email.brouillon'
                ? 'Créer le brouillon dans Gmail'
                : p.type === 'crm.tache'
                  ? 'Créer la tâche'
                  : 'Enregistrer en brouillon'}
            </button>
            {p.type === 'email.brouillon' && (
              <button className="btn" onClick={() => setEdition(!edition)}>
                <Icon name="edit" />
                {edition ? 'Terminer la modification' : 'Modifier le texte'}
              </button>
            )}
            <button className="btn ghost danger" onClick={() => onDecide('ecarter')}>
              Écarter
            </button>
            <span className="hint">
              {p.type === 'email.brouillon'
                ? "Le brouillon est créé dans Gmail sans signature : Gmail ajoute la vôtre. C'est vous qui l'envoyez."
                : p.type === 'crm.tache'
                  ? "La tâche sera créée dans l'outil du mandat et tracée dans le journal."
                  : "L'OS n'écrit jamais une note validée : vous la relirez dans le second cerveau."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function AValider({ slug }: { slug: string }) {
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [list, setList] = useState<PropositionItem[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchPropositions(slug, filtre).then(setList, (e: unknown) => setMessage(String(e)));
  }, [slug, filtre]);
  useEffect(load, [load]);

  const choisi = list?.find((p) => p.id === sel) ?? list?.[0];
  const decide = (id: string, d: 'valider' | 'ecarter', contenu?: Record<string, unknown>) =>
    decider(slug, id, d, contenu).then(
      (p) => {
        setMessage(
          p.statut === 'echec'
            ? `Échec : ${(p.resultat as { erreur?: string } | null)?.erreur ?? ''}`
            : d === 'ecarter'
              ? 'Écarté.'
              : 'Validé.',
        );
        setSel(null);
        load();
      },
      (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)),
    );

  return (
    <div className="vq">
      <div className="panel">
        <div className="vq-filter">
          {FILTRES.map(([f, l]) => (
            <button
              key={f}
              className={`chip ${filtre === f ? 'on' : ''}`}
              onClick={() => setFiltre(f)}
            >
              {l}
              {f === 'tout' && filtre === 'tout' && list ? ` (${list.length})` : ''}
            </button>
          ))}
        </div>
        <div className="vq-list">
          {list?.length ? (
            list.map((p) => (
              <button
                key={p.id}
                className={`vq-item ${p.id === choisi?.id ? 'on' : ''}`}
                onClick={() => setSel(p.id)}
              >
                <div className="row1">
                  <b>{titre(p)}</b>
                  <Statut p={p} />
                </div>
                <small>
                  {p.contact?.entreprise ? `${p.contact.entreprise}, ` : ''}
                  {str(p.contenu.origine) || (p.auteur === 'os' ? "Préparé par l'OS" : p.auteur)}
                </small>
              </button>
            ))
          ) : (
            <div className="empty">
              {filtre === 'traites'
                ? "Aucune décision prise pour l'instant."
                : 'Tout est traité. La prochaine routine préparera la suite.'}
            </div>
          )}
        </div>
      </div>
      <div>
        {message && <p className="small muted">{message}</p>}
        {choisi ? (
          <Detail p={choisi} onDecide={(d, c) => void decide(choisi.id, d, c)} />
        ) : (
          <div className="panel empty">Sélectionnez un élément à gauche.</div>
        )}
      </div>
    </div>
  );
}
