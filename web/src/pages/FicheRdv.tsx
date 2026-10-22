import { useCallback, useEffect, useState } from 'react';
import {
  enregistrerCompteRenduRdv,
  fetchRdv,
  lierRdv,
  trierRdv,
  type KindFiche,
  type RdvFiche,
  type StatutRdv,
} from '../api.js';
import { Icon } from '../icons.js';
import { LierExistant } from './liens/CarteLiens.js';
import { quand } from './RendezVous.js';

// A calendar block treated as a client meeting: sorted by the pilot, linked to companies, contacts
// and deals, with its compte rendu. Same layout as the other records (links left, content right).

const erreurDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const lien = (slug: string, kind: KindFiche, id: string) => `#/${slug}/fiche/${kind}/${id}`;

type Groupe = { kind: KindFiche; titre: string; vide: string };
const GROUPES: Groupe[] = [
  { kind: 'entreprise', titre: 'Organisation', vide: 'Aucune organisation liée.' },
  { kind: 'contact', titre: 'Contacts', vide: 'Aucun contact lié.' },
  { kind: 'affaire', titre: 'Affaire', vide: 'Aucune affaire liée.' },
];

function Groupe({
  slug,
  rdvId,
  groupe,
  lignes,
  onChange,
  onMessage,
}: {
  slug: string;
  rdvId: string;
  groupe: Groupe;
  lignes: { id: string; nom: string; detail?: string | null }[];
  onChange: () => void;
  onMessage: (m: string | null) => void;
}) {
  const [ajout, setAjout] = useState(false);
  const agir = (id: string, retirer: boolean) =>
    lierRdv(slug, rdvId, { kind: groupe.kind, id }, retirer).then(
      () => {
        setAjout(false);
        onMessage(null);
        onChange();
      },
      (e: unknown) => onMessage(erreurDe(e)),
    );
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>{groupe.titre}</h2>
        <button className="btn sm" onClick={() => setAjout(!ajout)}>
          + Ajouter
        </button>
      </div>
      {ajout && (
        <LierExistant
          slug={slug}
          kind={groupe.kind}
          exclus={lignes.map((l) => l.id)}
          onChoix={(id) => void agir(id, false)}
        />
      )}
      <ul className="panel-b fi-liste">
        {lignes.length === 0 && <li className="muted small">{groupe.vide}</li>}
        {lignes.map((l) => (
          <li key={l.id} className="fi-ligne">
            <span className="fi-ident">
              <span
                className={`fi-av ${groupe.kind === 'contact' ? '' : 'carre'}`}
                aria-hidden="true"
              >
                {l.nom.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <a href={lien(slug, groupe.kind, l.id)}>{l.nom}</a>
                {l.detail && <span className="small muted"> {l.detail}</span>}
              </span>
            </span>
            <button
              className="btn ghost sm"
              aria-label={`Délier ${l.nom}`}
              title="Délier"
              onClick={() => void agir(l.id, true)}
            >
              <Icon name="x" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CompteRendu({
  slug,
  rdv,
  onDone,
  onMessage,
}: {
  slug: string;
  rdv: RdvFiche;
  onDone: () => void;
  onMessage: (m: string | null) => void;
}) {
  const [texte, setTexte] = useState(rdv.compteRendu?.texte ?? '');
  const [edition, setEdition] = useState(!rdv.compteRendu);
  const [tache, setTache] = useState(!rdv.compteRendu);
  const [cerveau, setCerveau] = useState(true);
  const [busy, setBusy] = useState(false);
  const enregistrer = () => {
    setBusy(true);
    enregistrerCompteRenduRdv(slug, rdv, texte, {
      proposerTache: tache,
      versCerveau: cerveau,
    }).then(
      () => {
        setBusy(false);
        setEdition(false);
        onMessage(
          cerveau
            ? 'Compte rendu enregistré. Une note pour le second cerveau attend dans l’Inbox.'
            : 'Compte rendu enregistré.',
        );
        onDone();
      },
      (e: unknown) => {
        setBusy(false);
        onMessage(erreurDe(e));
      },
    );
  };
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Compte rendu</h2>
        {rdv.compteRendu && !edition && (
          <button className="btn sm" onClick={() => setEdition(true)}>
            Modifier
          </button>
        )}
      </div>
      <div className="panel-b stack">
        {edition ? (
          <>
            <textarea
              className="input"
              rows={8}
              aria-label="Compte rendu"
              placeholder="Besoin, interlocuteurs, décisions, échéances…"
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
            />
            <label className="check">
              <input type="checkbox" checked={tache} onChange={(e) => setTache(e.target.checked)} />
              <span>Proposer une tâche « prochaine étape »</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={cerveau}
                onChange={(e) => setCerveau(e.target.checked)}
              />
              <span>Envoyer aussi vers le second cerveau (via l’Inbox)</span>
            </label>
            <div>
              <button
                className="btn primary"
                disabled={busy || !texte.trim()}
                onClick={enregistrer}
              >
                Enregistrer le compte rendu
              </button>
            </div>
          </>
        ) : (
          <p className="fi-cr">{rdv.compteRendu?.texte}</p>
        )}
      </div>
    </section>
  );
}

export function FicheRdv({ slug, id }: { slug: string; id: string }) {
  const [rdv, setRdv] = useState<RdvFiche | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchRdv(slug, id).then(setRdv, (e: unknown) => setMessage(erreurDe(e)));
  }, [slug, id]);
  useEffect(load, [load]);

  if (!rdv) return message ? <div className="empty">{message}</div> : null;
  const trier = (statut: StatutRdv) =>
    void trierRdv(slug, id, statut).then(load, (e: unknown) => setMessage(erreurDe(e)));
  return (
    <>
      <div className="fi-entete">
        <div>
          <a
            className="small fi-retour"
            href="#"
            onClick={(e) => (e.preventDefault(), history.back())}
          >
            ‹ Retour
          </a>
          <h1>{rdv.titre || 'Rendez-vous'}</h1>
          <div className="small muted fi-sous">
            {rdv.debut && <span>{quand(rdv.debut)}</span>}
            {rdv.lieu && <span>{rdv.lieu}</span>}
            {rdv.compteRendu ? (
              <span className="badge green">Compte rendu fait</span>
            ) : rdv.statut === 'ignore' ? (
              <span className="badge">Pas un RDV</span>
            ) : rdv.statut === 'a_trier' ? (
              <span className="badge amber">À trier</span>
            ) : null}
          </div>
        </div>
        <div className="decision">
          {rdv.statut === 'ignore' ? (
            <button className="btn" onClick={() => trier('a_trier')}>
              Remettre dans les RDV à trier
            </button>
          ) : (
            <>
              {rdv.statut === 'a_trier' && (
                <button className="btn go" onClick={() => trier('rdv')}>
                  C’est un RDV
                </button>
              )}
              <button className="btn" onClick={() => trier('ignore')}>
                Pas un RDV
              </button>
            </>
          )}
        </div>
      </div>
      {message && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div>{message}</div>
        </div>
      )}
      <div className="fi-corps">
        <div className="fi-gauche">
          <Groupe
            slug={slug}
            rdvId={id}
            groupe={GROUPES[0] as Groupe}
            lignes={rdv.entreprises}
            onChange={load}
            onMessage={setMessage}
          />
          <Groupe
            slug={slug}
            rdvId={id}
            groupe={GROUPES[1] as Groupe}
            lignes={rdv.contacts}
            onChange={load}
            onMessage={setMessage}
          />
          <Groupe
            slug={slug}
            rdvId={id}
            groupe={GROUPES[2] as Groupe}
            lignes={rdv.affaires}
            onChange={load}
            onMessage={setMessage}
          />
        </div>
        <div className="fi-droite">
          <CompteRendu
            key={rdv.compteRendu?.at ?? 'nouveau'}
            slug={slug}
            rdv={rdv}
            onDone={load}
            onMessage={setMessage}
          />
        </div>
      </div>
    </>
  );
}
