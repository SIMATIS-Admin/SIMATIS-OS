import { useCallback, useEffect, useState } from 'react';
import {
  fetchMandatsBase,
  fetchRapprochementBase,
  lancerRapprochementBase,
  majDebutMandatBase,
  type EtatRapprochementBase,
  type MandatBase,
} from '../api.js';
import { Icon } from '../icons.js';

const entier = (n: number) => n.toLocaleString('fr-FR');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// One pass over the mandate's mailbox, from the start of the mandate: who was contacted, who
// answered, which addresses bounced. Read-only: nothing is written in the mailbox.
export function RapprochementMail({ slug, onTermine }: { slug: string; onTermine: () => void }) {
  const [mandats, setMandats] = useState<MandatBase[]>([]);
  const [choix, setChoix] = useState('');
  const [debut, setDebut] = useState('');
  const [etat, setEtat] = useState<EtatRapprochementBase>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMandatsBase(slug).then(
      (liste) => {
        setMandats(liste);
        const premier = liste[0];
        if (premier) {
          setChoix(premier.slug);
          setDebut(premier.debutMandat ?? '');
        }
      },
      () => undefined,
    );
    fetchRapprochementBase(slug).then(setEtat, () => undefined);
  }, [slug]);

  const enCours = etat?.etat === 'en_cours';
  const suivre = useCallback(() => {
    fetchRapprochementBase(slug).then(
      (e) => {
        setEtat(e);
        if (e && e.etat !== 'en_cours') onTermine();
      },
      () => undefined,
    );
  }, [slug, onTermine]);
  useEffect(() => {
    if (!enCours) return;
    const minuteur = window.setInterval(suivre, 2000);
    return () => window.clearInterval(minuteur);
  }, [enCours, suivre]);

  const choisir = (s: string) => {
    setChoix(s);
    setDebut(mandats.find((m) => m.slug === s)?.debutMandat ?? '');
  };
  const enregistrerDebut = async () => {
    setError(null);
    try {
      await majDebutMandatBase(slug, choix, debut || null);
      setMandats((liste) =>
        liste.map((m) => (m.slug === choix ? { ...m, debutMandat: debut || null } : m)),
      );
    } catch (e) {
      setError(message(e));
    }
  };
  const lancer = async () => {
    setError(null);
    try {
      if (debut !== (mandats.find((m) => m.slug === choix)?.debutMandat ?? ''))
        await majDebutMandatBase(slug, choix, debut || null);
      setEtat(await lancerRapprochementBase(slug, choix));
    } catch (e) {
      setError(message(e));
    }
  };

  if (mandats.length === 0) return null;
  const r = etat?.rapport;
  return (
    <div className="panel">
      <div className="panel-h">
        <div>
          <h2>Rapprochement avec une boîte mail</h2>
          <div className="small muted">
            Lit la boîte Gmail d'un mandat, en lecture seule, depuis le début du mandat : met à jour
            le dernier contact, les réponses et les adresses en erreur de chaque fiche.
          </div>
        </div>
      </div>
      <div className="panel-b">
        <div className="grid g2">
          <label className="field">
            <span>Mandat</span>
            <select className="input" value={choix} onChange={(e) => choisir(e.target.value)}>
              {mandats.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Début du mandat</span>
            <input
              className="input"
              type="date"
              value={debut}
              onChange={(e) => setDebut(e.target.value)}
              onBlur={() => void enregistrerDebut()}
            />
          </label>
        </div>
        {error && (
          <div className="alert amber">
            <Icon name="info" />
            <div>{error}</div>
          </div>
        )}
        <button className="btn primary" disabled={enCours || !debut} onClick={() => void lancer()}>
          {enCours ? 'Lecture en cours…' : 'Lire la boîte mail'}
        </button>
        {etat?.etat === 'en_cours' && (
          <p className="small muted" aria-live="polite">
            {etat.total === 0
              ? 'Recherche des messages…'
              : `${entier(etat.lus)} messages lus sur ${entier(etat.total)}.`}
          </p>
        )}
        {etat?.etat === 'echec' && (
          <div className="alert amber">
            <Icon name="info" />
            <div>{etat.erreur}</div>
          </div>
        )}
        {etat?.etat === 'termine' && r && (
          <div className="chips" aria-label="Résultat du rapprochement">
            <span className="badge">{entier(r.messages)} messages lus</span>
            <span className="badge blue">{entier(r.contactes)} contactés</span>
            <span className="badge green">{entier(r.reponses)} réponses</span>
            <span className="badge">{entier(r.autos)} réponses automatiques</span>
            <span className="badge red">{entier(r.bounces)} adresses en erreur</span>
            <span className="badge amber">{entier(r.jamaisContactes)} jamais contactés</span>
          </div>
        )}
      </div>
    </div>
  );
}
