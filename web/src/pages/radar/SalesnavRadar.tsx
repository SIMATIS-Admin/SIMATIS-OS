import { useCallback, useEffect, useState } from 'react';
import {
  actionProspectSalesnav,
  ajouterProspectSalesnav,
  choisirCibleSalesnav,
  enregistrerActionSalesnav,
  enregistrerReglagesSalesnav,
  envoyerDemandeSalesnav,
  fetchCiblages,
  fetchPipeSalesnav,
  fetchReglagesSalesnav,
  proposerSalesnav,
  type ActionProspectSalesnav,
  type CiblageAtelier,
  type PipeSalesnav,
  type ProspectSalesnav,
  type ReglagesSalesnav,
  type StatutProspectSalesnav,
} from '../../api.js';
import { LIMITE_NOTE_SALESNAV, grouperCibles, optionsCibles } from './salesnav-constantes.js';
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

// « ICP A » → « A » : la lettre sert de repère, le nom du segment dit de qui il s'agit.
const lettre = (code: string) => code.replace(/^ICP\s+/i, '');

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
  const [aEnvoyer, setAEnvoyer] = useState<ProspectSalesnav | null>(null);
  const [note, setNote] = useState('');
  const [reglagesOuverts, setReglagesOuverts] = useState(false);
  const [deplies, setDeplies] = useState<string[]>([]);
  const [ciblages, setCiblages] = useState<CiblageAtelier[]>([]);

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
    // Les ICP de l'Atelier donnent un nom aux cibles ; sans eux, on garde les seules valeurs.
    Promise.resolve(fetchCiblages(slug)).then(
      (c) => actif && setCiblages(Array.isArray(c) ? c : []),
      () => undefined,
    );
    return () => {
      actif = false;
    };
  }, [slug, charger]);

  // Tant qu'un envoi est ouvert, la page se rafraîchit pour afficher son résultat.
  const envoiOuvert = (pipe?.envois ?? []).some(
    (e) => e.statut === 'en_attente' || e.statut === 'en_cours',
  );
  useEffect(() => {
    if (!envoiOuvert) return;
    const t = setInterval(() => void charger(), 3000);
    return () => clearInterval(t);
  }, [envoiOuvert, charger]);

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

  const enregistrerReglages = (r: { quotaJour?: number; pause?: boolean; essaiABlanc?: boolean }) =>
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

  const ouvrirEnvoi = (p: ProspectSalesnav) => {
    setNote(p.message?.texte ?? '');
    setAEnvoyer(p);
  };

  const confirmerEnvoi = () => {
    const p = aEnvoyer;
    if (!p) return;
    setAEnvoyer(null);
    void executer(
      () => envoyerDemandeSalesnav(slug, p.id, note),
      pipe?.essaiABlanc
        ? 'Essai à blanc lancé : Chrome ouvre le profil mais n’envoie rien.'
        : 'Envoi lancé : Chrome va se connecter au profil.',
    );
  };

  const copier = async (texte: string) => {
    try {
      await navigator.clipboard.writeText(texte);
      setInfo('Message copié.');
    } catch {
      setErreur('Copie impossible : sélectionnez le texte à la main.');
    }
  };

  const prospects = pipe?.prospects ?? [];
  const avecMessage = new Set(pipe?.cibles ?? []);
  const options = optionsCibles(ciblages, [...avecMessage, ...prospects.map((p) => p.cible)]);
  const groupes = grouperCibles(options);
  const sansCible = prospects.filter((p) => p.statut === 'propose' && !p.cible);

  const appliquerAuLot = (valeur: string) =>
    executer(
      async () => {
        for (const p of sansCible) await choisirCibleSalesnav(slug, p.id, valeur);
      },
      `Cible appliquée à ${sansCible.length} profil${sansCible.length > 1 ? 's' : ''}.`,
    );

  const niveau = quota > 20 ? 'danger' : quota > 15 ? 'attention' : 'normal';
  const stats = pipe?.stats;

  const carte = (p: ProspectSalesnav) => {
    const envoi = (pipe?.envois ?? []).find((e) => e.prospectId === p.id);
    const enCours = envoi?.statut === 'en_attente' || envoi?.statut === 'en_cours';
    return (
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
              {groupes.map(([groupe, liste]) => (
                <optgroup key={groupe} label={groupe}>
                  {liste.map((o) => (
                    <option key={o.valeur} value={o.valeur}>
                      {[lettre(o.code), o.nom].filter(Boolean).join(' · ')}
                      {avecMessage.has(o.valeur) ? '' : ' (sans message)'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {p.message && (
          <div className="sr-message">
            <p className="small sr-message-titre">
              {p.message.etape === 'invitation' ? 'Note d’invitation' : 'Message à envoyer'}
              <button
                type="button"
                className="btn ghost sm"
                aria-label={`Copier le message pour ${p.nom}`}
                onClick={() => void copier(p.message!.texte)}
              >
                Copier
              </button>
            </p>
            <p className={deplies.includes(p.id) ? '' : 'sr-message-texte'}>{p.message.texte}</p>
            {p.message.texte.length > 140 && (
              <button
                type="button"
                className="sr-lien"
                aria-expanded={deplies.includes(p.id)}
                onClick={() =>
                  setDeplies((d) => (d.includes(p.id) ? d.filter((x) => x !== p.id) : [...d, p.id]))
                }
              >
                {deplies.includes(p.id) ? 'Réduire' : 'Voir tout'}
              </button>
            )}
            {p.message.manquantes.length > 0 && (
              <p className="small salesnav-erreur">
                À compléter : {p.message.manquantes.join(', ')}.
              </p>
            )}
          </div>
        )}
        {(p.statut === 'propose' || p.statut === 'connecte') && !p.message && (
          <p className="small muted">
            Choisissez la cible pour voir le message ; écrivez-le dans « Messages » s’il n’existe
            pas encore.
          </p>
        )}
        <div className="sr-actions">
          {p.statut === 'propose' && (
            <>
              <button
                type="button"
                className="btn sm primary"
                disabled={!p.message || enCours || (p.message?.manquantes.length ?? 0) > 0}
                onClick={() => ouvrirEnvoi(p)}
              >
                Envoyer la demande
              </button>
              <a className="btn ghost sm" href={p.lienLinkedin} target="_blank" rel="noreferrer">
                Ouvrir le profil
              </a>
              <button
                type="button"
                className="btn ghost sm"
                disabled={enCours}
                onClick={() => void agir(p, 'demande')}
              >
                Déjà envoyée à la main
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => void agir(p, 'ecarter')}
              >
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
        {p.statut === 'propose' && envoi && (
          <p
            className={`small ${envoi.statut === 'echec' ? 'salesnav-erreur' : 'muted'}`}
            role="status"
          >
            {enCours
              ? 'Envoi en cours dans Chrome…'
              : envoi.statut === 'essai'
                ? `Essai à blanc terminé : ${envoi.detail ?? ''}`
                : (envoi.detail ?? 'Envoi terminé.')}
          </p>
        )}
        {p.nbMessages > 0 && (
          <p className="small muted">
            {p.nbMessages} message{p.nbMessages > 1 ? 's' : ''} envoyé{p.nbMessages > 1 ? 's' : ''}
          </p>
        )}
      </article>
    );
  };

  return (
    <section className="salesnav-radar" aria-label="SalesNav">
      <header className="sr-entete">
        <button type="button" className="btn" onClick={onRetour}>
          ← Retour au Radar
        </button>
        <div className="sr-titre">
          <h2>
            SalesNav{' '}
            {pipe && (
              <span
                className={`chip fixe small ${pipe.essaiABlanc ? '' : 'on'}`}
                title={
                  pipe.essaiABlanc
                    ? 'Aucune demande n’est envoyée : Chrome s’arrête avant le clic final.'
                    : 'Les demandes sont réellement envoyées par Chrome.'
                }
              >
                {pipe.essaiABlanc ? 'Mode essai' : 'Envoi réel'}
              </span>
            )}
          </h2>
          <span className="muted small">
            {pipe ? `${pipe.disponibles} profils disponibles dans la Base des suspects` : ''}
          </span>
        </div>
        <span className="sr-entete-actions">
          <button type="button" className="btn primary" onClick={() => void proposer()}>
            Proposer des profils pour aujourd’hui
          </button>
          <button type="button" className="btn" onClick={() => setAjout((v) => !v)}>
            Ajouter un profil
          </button>
          <button type="button" className="btn" onClick={() => setMessages(true)}>
            Messages
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              void executer(
                () => enregistrerActionSalesnav(slug, { type: 'demande_recue' }),
                'Demande reçue enregistrée.',
              )
            }
          >
            + Demande reçue
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

      {pipe?.pause && pipe.pauseRaison && (
        <p role="alert" className="sr-alerte sr-danger">
          Canal en pause : {pipe.pauseRaison}
        </p>
      )}
      {pipe?.alerte && (
        <p role="alert" className="sr-alerte sr-attention">
          {pipe.alerte.message}
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

      <div className="sr-reglages">
        <button
          type="button"
          className="sr-reglages-bouton"
          aria-expanded={reglagesOuverts}
          onClick={() => setReglagesOuverts((v) => !v)}
        >
          <strong>Réglages</strong>
          <span className="muted small">
            {reglages?.quotaJour ?? quota} demandes par jour
            {pipe?.pause ? ' · en pause' : ''}
            {pipe?.essaiABlanc ? ' · essai à blanc' : ''}
          </span>
          <span aria-hidden="true">{reglagesOuverts ? '▾' : '▸'}</span>
        </button>
        {reglagesOuverts && (
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
              Recommandé au départ : {reglages?.recommande ?? 8} par jour, puis{' '}
              {reglages?.cible ?? 12} si le taux d’acceptation reste bon.
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
              <label className="sr-pause">
                <input
                  type="checkbox"
                  checked={reglages?.essaiABlanc ?? true}
                  disabled={!reglages}
                  onChange={(e) => void enregistrerReglages({ essaiABlanc: e.target.checked })}
                />
                Essai à blanc : aucune demande n’est envoyée
              </label>
            </div>
          </div>
        )}
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

      {sansCible.length > 0 && options.length > 0 && (
        <div className="sr-lot-cible" role="group" aria-label="Cible du lot">
          <p>
            <strong>
              Quelle cible pour{' '}
              {sansCible.length === 1
                ? 'le profil proposé'
                : `les ${sansCible.length} profils proposés`}{' '}
              ?
            </strong>{' '}
            <span className="muted small">
              Un clic l’applique à tous les profils sans cible ; vous pouvez la changer ensuite sur
              chaque carte.
            </span>
          </p>
          {groupes.map(([groupe, liste]) => (
            <div key={groupe} className="sr-cibles-groupe">
              <span className="sr-cibles-entreprise">{groupe}</span>
              {liste.map((o) => (
                <button
                  key={o.valeur}
                  type="button"
                  className="sr-cible-chip"
                  title={`${o.valeur}${o.nom ? ` — ${o.nom}` : ''}${avecMessage.has(o.valeur) ? '' : ' (pas encore de message)'}`}
                  onClick={() => void appliquerAuLot(o.valeur)}
                >
                  <b>{lettre(o.code)}</b>
                  <span>{o.nom || 'Cible'}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="sr-colonnes" aria-label="Pipe SalesNav">
        {COLONNES.map((c) => {
          const lignes = prospects.filter((p) => p.statut === c.statut);
          return (
            <section
              key={c.statut}
              className={`sr-colonne ${lignes.length === 0 ? 'sr-colonne-vide' : ''}`}
              aria-label={c.titre}
            >
              <header>
                <h3>
                  {c.titre} <span className="muted small">{lignes.length}</span>
                </h3>
                <span className="muted small">{c.aide}</span>
              </header>
              {lignes.length === 0 ? (
                <p className="muted small">
                  {c.statut === 'propose'
                    ? 'Cliquez sur « Proposer des profils » pour recevoir la sélection du jour.'
                    : 'Personne pour le moment.'}
                </p>
              ) : (
                lignes.map(carte)
              )}
            </section>
          );
        })}
      </div>

      {aEnvoyer && (
        <Fenetre
          titre="Envoyer la demande"
          onFermer={() => setAEnvoyer(null)}
          pied={
            <>
              <button type="button" className="btn" onClick={() => setAEnvoyer(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={note.trim() === '' || note.trim().length > LIMITE_NOTE_SALESNAV}
                onClick={confirmerEnvoi}
              >
                {pipe?.essaiABlanc ? 'Lancer l’essai à blanc' : 'Confirmer et envoyer'}
              </button>
            </>
          }
        >
          <p>
            <strong>{aEnvoyer.nom}</strong>
            <span className="muted small">
              {' '}
              {[aEnvoyer.fonction, aEnvoyer.entreprise].filter(Boolean).join(' · ')}
            </span>
          </p>
          <p className="small muted">
            {pipe?.essaiABlanc
              ? 'Essai à blanc : Chrome ouvre le profil et prépare la note, mais n’envoie rien.'
              : 'Chrome va cliquer sur « Se connecter » avec cette note, une seule demande.'}
          </p>
          <label>
            <span className="small">Note d’invitation</span>
            <textarea
              aria-label="Note d’invitation"
              rows={6}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <span
            className={`small ${note.trim().length > LIMITE_NOTE_SALESNAV ? 'salesnav-trop' : 'muted'}`}
            aria-live="polite"
          >
            {note.trim().length} / {LIMITE_NOTE_SALESNAV} caractères
          </span>
        </Fenetre>
      )}

      {messages && (
        <Fenetre titre="Messages SalesNav" large onFermer={() => setMessages(false)}>
          <SalesnavMessages slug={slug} />
        </Fenetre>
      )}
    </section>
  );
}
