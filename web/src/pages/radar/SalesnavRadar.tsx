import { useCallback, useEffect, useState } from 'react';
import {
  actionProspectSalesnav,
  ajouterProspectSalesnav,
  choisirCibleSalesnav,
  enregistrerActionSalesnav,
  enregistrerReglagesSalesnav,
  fetchPipeSalesnav,
  fetchReglagesSalesnav,
  proposerSalesnav,
  type ActionProspectSalesnav,
  type PipeSalesnav,
  type ProspectSalesnav,
  type ReglagesSalesnav,
  type StatutProspectSalesnav,
} from '../../api.js';
import { Fenetre } from '../Fenetre.js';
import { SalesnavMessages } from '../SalesnavMessages.js';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Une erreur est survenue.');

const COLONNES: { statut: StatutProspectSalesnav; titre: string; aide: string }[] = [
  { statut: 'propose', titre: 'Proposés', aide: 'À valider aujourd’hui' },
  { statut: 'demande_envoyee', titre: 'Demande envoyée', aide: 'En attente d’acceptation' },
  { statut: 'connecte', titre: 'Connectés', aide: 'Vous pouvez leur écrire' },
  { statut: 'a_repondu', titre: 'Ont répondu', aide: 'Opportunités du Radar' },
  { statut: 'sans_reponse', titre: 'Sans réponse', aide: 'À retirer' },
];

const pct = (v: number | null) => (v === null ? '–' : `${String(v).replace('.', ',')} %`);

const AVERTISSEMENTS: Record<ReglagesSalesnav['niveau'], string> = {
  normal: '',
  attention:
    'Au-delà de 15 demandes par jour, LinkedIn risque de restreindre votre compte. Montez progressivement.',
  danger:
    'Plus de 20 demandes par jour : le risque de restriction du compte est élevé. Baissez le quota.',
};

// La page SalesNav : une campagne de prospection LinkedIn menée à la main, un profil à la fois.
// Chaque jour l'OS propose une dizaine de profils ; on valide chacun, puis on suit la demande, la
// connexion, les messages et la réponse. Les chiffres sont ceux d'une campagne LinkedIn classique.
export function SalesnavRadar({ slug, onRetour }: { slug: string; onRetour: () => void }) {
  const [pipe, setPipe] = useState<PipeSalesnav | null>(null);
  const [reglages, setReglages] = useState<ReglagesSalesnav | null>(null);
  const [quota, setQuota] = useState(8);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [messages, setMessages] = useState(false);
  const [ajout, setAjout] = useState(false);
  const [lien, setLien] = useState('');
  const [nom, setNom] = useState('');

  const charger = useCallback(async () => {
    try {
      setPipe(await fetchPipeSalesnav(slug));
    } catch (e) {
      setErreur(message(e));
    }
  }, [slug]);

  useEffect(() => {
    void charger();
    let actif = true;
    fetchReglagesSalesnav(slug).then(
      (r) => {
        if (!actif) return;
        setReglages(r);
        setQuota(r.quotaJour);
      },
      (e: unknown) => actif && setErreur(message(e)),
    );
    return () => {
      actif = false;
    };
  }, [slug, charger]);

  const executer = async (fn: () => Promise<unknown>, succes?: string) => {
    setErreur(null);
    setInfo(null);
    try {
      await fn();
      if (succes) setInfo(succes);
      await charger();
    } catch (e) {
      setErreur(message(e));
    }
  };

  const enregistrerReglages = (r: { quotaJour?: number; pause?: boolean }) =>
    executer(async () => {
      const nouveau = await enregistrerReglagesSalesnav(slug, r);
      setReglages(nouveau);
      setQuota(nouveau.quotaJour);
    }, 'Réglage enregistré.');

  const agir = (p: ProspectSalesnav, action: ActionProspectSalesnav) =>
    executer(async () => {
      const r = await actionProspectSalesnav(slug, p.id, action);
      if (action === 'reponse')
        setInfo(
          r.opportuniteCreee
            ? 'Réponse enregistrée : une opportunité a été créée dans le Radar.'
            : 'Réponse enregistrée.',
        );
    });

  const proposer = () =>
    executer(async () => {
      const r = await proposerSalesnav(slug);
      setInfo(
        r.proposes === 0
          ? 'Rien à proposer pour le moment : traitez d’abord les profils proposés, ou le quota du jour est atteint.'
          : `${r.proposes} profil${r.proposes > 1 ? 's' : ''} proposé${r.proposes > 1 ? 's' : ''}.` +
              (r.manque > 0
                ? ` Il en manque ${r.manque} : ajoutez des profils par leur lien.`
                : ''),
      );
    });

  const copier = async (texte: string) => {
    try {
      await navigator.clipboard.writeText(texte);
      setInfo('Message copié.');
    } catch {
      setErreur('Copie impossible : sélectionnez le texte à la main.');
    }
  };

  const niveau = quota > 20 ? 'danger' : quota > 15 ? 'attention' : 'normal';
  const prospects = pipe?.prospects ?? [];
  const stats = pipe?.stats;

  const carte = (p: ProspectSalesnav) => (
    <article key={p.id} className="sr-prospect" aria-label={p.nom}>
      <header>
        <a href={p.lienLinkedin} target="_blank" rel="noreferrer" className="sr-nom">
          <strong>{p.nom}</strong>
        </a>
        <span className="muted small">
          {[p.fonction, p.entreprise].filter(Boolean).join(' · ') || 'Poste non renseigné'}
        </span>
        {p.aRetirer && <span className="chip small sr-retirer">À retirer</span>}
      </header>
      {(p.statut === 'propose' || p.statut === 'connecte') && (
        <label className="sr-cible">
          <span className="small">Cible des messages</span>
          <select
            aria-label={`Cible de ${p.nom}`}
            value={p.cible ?? ''}
            onChange={(e) =>
              void executer(() => choisirCibleSalesnav(slug, p.id, e.target.value || null))
            }
          >
            <option value="">À choisir</option>
            {(pipe?.cibles ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}
      {p.message && (
        <div className="sr-message">
          <p className="small">
            {p.message.etape === 'invitation' ? 'Note d’invitation' : 'Message à envoyer'}
          </p>
          <p>{p.message.texte}</p>
          {p.message.manquantes.length > 0 && (
            <p className="small salesnav-erreur">
              À compléter : {p.message.manquantes.join(', ')}.
            </p>
          )}
          <button
            type="button"
            className="btn sm"
            aria-label={`Copier le message pour ${p.nom}`}
            onClick={() => void copier(p.message!.texte)}
          >
            Copier
          </button>
        </div>
      )}
      {(p.statut === 'propose' || p.statut === 'connecte') && !p.message && (
        <p className="small muted">
          Choisissez la cible pour voir le message ; écrivez-le dans « Messages » s’il n’existe pas
          encore.
        </p>
      )}
      <div className="sr-actions">
        {p.statut === 'propose' && (
          <>
            <a className="btn sm" href={p.lienLinkedin} target="_blank" rel="noreferrer">
              Ouvrir le profil
            </a>
            <button
              type="button"
              className="btn sm primary"
              onClick={() => void agir(p, 'demande')}
            >
              Demande envoyée
            </button>
            <button type="button" className="btn sm" onClick={() => void agir(p, 'ecarter')}>
              Écarter
            </button>
          </>
        )}
        {p.statut === 'demande_envoyee' && (
          <>
            <button
              type="button"
              className="btn sm primary"
              onClick={() => void agir(p, 'connecte')}
            >
              Connecté(e)
            </button>
            <button type="button" className="btn sm" onClick={() => void agir(p, 'reponse')}>
              A répondu
            </button>
            <button type="button" className="btn sm" onClick={() => void agir(p, 'sans-reponse')}>
              Sans réponse
            </button>
          </>
        )}
        {p.statut === 'connecte' && (
          <>
            <button
              type="button"
              className="btn sm primary"
              onClick={() => void agir(p, 'message')}
            >
              Message envoyé
            </button>
            <button type="button" className="btn sm" onClick={() => void agir(p, 'reponse')}>
              A répondu
            </button>
            <button type="button" className="btn sm" onClick={() => void agir(p, 'sans-reponse')}>
              Sans réponse
            </button>
          </>
        )}
        {p.statut === 'a_repondu' && (
          <>
            <button type="button" className="btn sm" onClick={() => void agir(p, 'message')}>
              Message envoyé
            </button>
            {p.opportuniteId && (
              <a
                className="btn sm"
                href={`#/${slug}/fiche/affaire/${p.opportuniteId}?depuis=radar`}
              >
                Opportunité
              </a>
            )}
          </>
        )}
        {p.statut === 'sans_reponse' && (
          <button type="button" className="btn sm" onClick={() => void agir(p, 'ecarter')}>
            Retirer
          </button>
        )}
      </div>
      {p.nbMessages > 0 && (
        <p className="small muted">
          {p.nbMessages} message{p.nbMessages > 1 ? 's' : ''} envoyé{p.nbMessages > 1 ? 's' : ''}
        </p>
      )}
    </article>
  );

  return (
    <section className="salesnav-radar" aria-label="SalesNav">
      <header className="sr-entete">
        <button type="button" className="btn" onClick={onRetour}>
          ← Retour au Radar
        </button>
        <h2>SalesNav</h2>
        <span className="sr-entete-actions">
          <button
            type="button"
            className="btn"
            onClick={() =>
              void executer(
                () => enregistrerActionSalesnav(slug, { type: 'demande_recue' }),
                'Demande reçue enregistrée.',
              )
            }
          >
            + Demande reçue
          </button>
          <button type="button" className="btn" onClick={() => setAjout((v) => !v)}>
            Ajouter un profil
          </button>
          <button type="button" className="btn" onClick={() => setMessages(true)}>
            Messages
          </button>
        </span>
      </header>
      {erreur && (
        <p role="alert" className="salesnav-erreur">
          {erreur}
        </p>
      )}
      {info && !erreur && (
        <p role="status" className="muted small">
          {info}
        </p>
      )}

      <div className="sr-stats" aria-label="Statistiques SalesNav">
        <div className="sr-etape">
          <strong>{stats?.demandesEnvoyees ?? '–'}</strong>
          <span>Demandes envoyées</span>
        </div>
        <div className="sr-etape">
          <strong>{stats ? pct(stats.tauxAcceptation) : '–'}</strong>
          <span>Acceptées en relation</span>
          <small className="muted">{stats?.acceptees ?? 0} connexions</small>
        </div>
        <div className="sr-etape">
          <strong>{stats?.messagesEnvoyes ?? '–'}</strong>
          <span>Messages envoyés</span>
        </div>
        <div className="sr-etape">
          <strong>{stats?.reponses ?? '–'}</strong>
          <span>Réponses</span>
          <small className="muted">{stats ? pct(stats.tauxReponse) : '–'} des connectés</small>
        </div>
      </div>

      <div className="sr-quota">
        <h3>Demandes par jour</h3>
        <label>
          <span className="sr-valeur">
            {quota} par jour · {quota * 5} par semaine
          </span>
          <input
            type="range"
            aria-label="Demandes par jour"
            min={0}
            max={reglages?.quotaMax ?? 25}
            step={1}
            value={quota}
            onChange={(e) => setQuota(Number(e.target.value))}
          />
        </label>
        <p className="muted small">
          Recommandé au départ : {reglages?.recommande ?? 8} par jour, puis {reglages?.cible ?? 12}{' '}
          si le taux d’acceptation reste bon.
        </p>
        {AVERTISSEMENTS[niveau] && (
          <p role="alert" className={`sr-alerte sr-${niveau}`}>
            {AVERTISSEMENTS[niveau]}
          </p>
        )}
        <div className="sr-actions">
          <button
            type="button"
            className="btn primary"
            disabled={!reglages || quota === reglages.quotaJour}
            onClick={() => void enregistrerReglages({ quotaJour: quota })}
          >
            Enregistrer le quota
          </button>
          <label className="sr-pause">
            <input
              type="checkbox"
              checked={reglages?.pause ?? false}
              disabled={!reglages}
              onChange={(e) => void enregistrerReglages({ pause: e.target.checked })}
            />
            Mettre le canal en pause
          </label>
        </div>
      </div>

      {ajout && (
        <form
          className="sr-ajout"
          aria-label="Ajouter un profil"
          onSubmit={(e) => {
            e.preventDefault();
            void executer(async () => {
              await ajouterProspectSalesnav(slug, { lien, nom });
              setLien('');
              setNom('');
              setAjout(false);
            }, 'Profil ajouté aux profils proposés.');
          }}
        >
          <input
            aria-label="Lien du profil"
            value={lien}
            placeholder="Lien du profil LinkedIn ou Sales Navigator"
            onChange={(e) => setLien(e.target.value)}
          />
          <input
            aria-label="Nom de la personne"
            value={nom}
            placeholder="Nom"
            onChange={(e) => setNom(e.target.value)}
          />
          <button type="submit" className="btn primary" disabled={!lien.trim() || !nom.trim()}>
            Ajouter
          </button>
        </form>
      )}

      <div className="sr-proposer">
        <button type="button" className="btn primary" onClick={() => void proposer()}>
          Proposer des profils pour aujourd’hui
        </button>
        <span className="muted small">
          {pipe ? `${pipe.disponibles} disponibles dans la Base des suspects` : ''}
        </span>
      </div>

      <div className="sr-colonnes" aria-label="Pipe SalesNav">
        {COLONNES.map((c) => {
          const lignes = prospects.filter((p) => p.statut === c.statut);
          return (
            <section key={c.statut} className="sr-colonne" aria-label={c.titre}>
              <header>
                <h3>
                  {c.titre} <span className="muted small">{lignes.length}</span>
                </h3>
                <span className="muted small">{c.aide}</span>
              </header>
              {lignes.length === 0 ? (
                <p className="muted small">Personne pour le moment.</p>
              ) : (
                lignes.map(carte)
              )}
            </section>
          );
        })}
      </div>

      {messages && (
        <Fenetre titre="Messages SalesNav" large onFermer={() => setMessages(false)}>
          <SalesnavMessages slug={slug} />
        </Fenetre>
      )}
    </section>
  );
}
