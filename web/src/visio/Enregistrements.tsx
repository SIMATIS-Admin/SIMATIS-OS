import { useCallback, useEffect, useState } from 'react';
import { fetchEnregistrements, supprimerEnregistrement, type EnregistrementListe } from '../api.js';
import { Icon } from '../icons.js';
import { Fenetre } from '../pages/Fenetre.js';
import { EnregistrementVisio } from './EnregistrementVisio.js';

const etat = (e: EnregistrementListe) =>
  e.aResume
    ? 'Résumé prêt'
    : e.statut === 'en_cours'
      ? 'En cours'
      : e.statut === 'clos'
        ? 'Transcription en cours'
        : e.statut === 'transcrit'
          ? 'Transcrit'
          : 'Échec';

const quand = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });

// L'enregistrement se lance dans l'appli Mac « Visio SIMATIS », qui capte tout le son du Mac : le
// bouton l'ouvre par son adresse (visio-simatis://).
const ouvrirAppliMac = () => {
  location.href = 'visio-simatis://enregistrer';
};

// Dans le cockpit, une barre discrète ; la liste complète des enregistrements est dans une fenêtre.
export function Enregistrements({
  slug,
  onEnregistrer = ouvrirAppliMac,
}: {
  slug: string;
  onEnregistrer?: () => void;
}) {
  const [liste, setListe] = useState<EnregistrementListe[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const lire = useCallback(() => {
    fetchEnregistrements(slug).then(setListe, () => undefined);
  }, [slug]);
  useEffect(() => {
    lire();
    // Un enregistrement en cours passe à « résumé prêt » sans que l'écran bouge.
    const t = setInterval(lire, 15_000);
    return () => clearInterval(t);
  }, [lire]);

  const supprimer = (e: EnregistrementListe) => {
    if (!confirm(`Supprimer « ${e.titre} » ? Son texte et son résumé seront perdus.`)) return;
    supprimerEnregistrement(slug, e.id).then(
      () => {
        setDetail(null);
        lire();
      },
      (err: unknown) => setErreur(err instanceof Error ? err.message : String(err)),
    );
  };

  const actifs = liste.filter((e) => e.statut === 'en_cours').length;
  return (
    <>
      <section className="cockpit-bandeau vide" aria-label="Enregistrements">
        <span className="cockpit-bandeau-icone">
          <Icon name="pulse" />
        </span>
        <span className="cockpit-bandeau-texte">
          <strong>Enregistrements</strong>
          <span>
            {actifs > 0
              ? `${actifs} en cours`
              : liste.length > 0
                ? `${liste.length} ${liste.length > 1 ? 'récents' : 'récent'}`
                : 'Aucun récent'}
          </span>
        </span>
        <button className="btn sm" onClick={() => setOuvert(true)}>
          Ouvrir
        </button>
      </section>
      {ouvert && (
        <Fenetre
          titre="Enregistrements"
          sousTitre="Retrouvez vos réunions enregistrées et leurs transcriptions."
          large
          onFermer={() => setOuvert(false)}
        >
          <div className="enregistrements-fenetre">
            <div className="enregistrements-lancement">
              <span className="enregistrements-lancement-icone">
                <Icon name="pulse" />
              </span>
              <div>
                <strong>Démarrer un nouvel enregistrement</strong>
                <p>Visio SIMATIS enregistrera le micro et le son du Mac.</p>
              </div>
              <button className="btn primary" onClick={onEnregistrer}>
                <Icon name="play" />
                Enregistrer
              </button>
            </div>
            {erreur && (
              <p className="enregistrements-erreur" role="alert">
                {erreur}
              </p>
            )}
            {liste.length === 0 && (
              <div className="enregistrements-vide">
                <Icon name="clock" />
                <strong>Aucun enregistrement pour l’instant</strong>
                <span>Les prochaines réunions enregistrées apparaîtront ici.</span>
              </div>
            )}
            <ul className="enregistrements-liste">
              {liste.map((e) => (
                <li key={e.id} className="enregistrement-item">
                  <div className="enregistrement-resume">
                    <span className="enregistrement-icone">
                      <Icon name="clock" />
                    </span>
                    <div className="enregistrement-identite">
                      <strong>{e.titre}</strong>
                      <div className="enregistrement-meta">
                        <span>{quand(e.debutAt)}</span>
                        <span
                          className={`enregistrement-etat ${e.statut === 'erreur' ? 'erreur' : ''} ${e.aResume ? 'pret' : ''}`}
                        >
                          {etat(e)}
                        </span>
                      </div>
                    </div>
                    <div className="enregistrement-actions">
                      <button
                        className="btn sm"
                        onClick={() => setDetail(detail === e.id ? null : e.id)}
                      >
                        <Icon name={detail === e.id ? 'down' : 'file'} />
                        {detail === e.id ? 'Masquer' : 'Voir'}
                      </button>
                      <a
                        className="btn sm"
                        href={`#/${slug}/fiche/rdv/${encodeURIComponent(e.rdvId)}`}
                      >
                        <Icon name="cal" />
                        Ouvrir la fiche
                      </a>
                      <button className="btn sm danger" onClick={() => supprimer(e)}>
                        <Icon name="trash" />
                        Supprimer
                      </button>
                    </div>
                  </div>
                  {detail === e.id && (
                    <div className="enregistrement-detail">
                      <EnregistrementVisio
                        slug={slug}
                        rdvId={e.rdvId}
                        titre={e.titre}
                        onSupprime={() => {
                          setDetail(null);
                          lire();
                        }}
                        onRattache={() => {
                          setDetail(null);
                          lire();
                        }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Fenetre>
      )}
    </>
  );
}
