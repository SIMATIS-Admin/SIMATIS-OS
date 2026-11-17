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
        <Icon name="clock" />
        <span>
          {actifs > 0
            ? `Enregistrements : ${actifs} en cours`
            : liste.length > 0
              ? `Enregistrements : ${liste.length} récents`
              : 'Enregistrements'}
        </span>
        <button className="btn sm" onClick={() => setOuvert(true)}>
          Ouvrir
        </button>
      </section>
      {ouvert && (
        <Fenetre titre="Enregistrements" large onFermer={() => setOuvert(false)}>
          <div className="stack">
            <button className="btn primary" onClick={onEnregistrer}>
              Enregistrer
            </button>
            <p className="small muted">
              Ouvre l’appli Visio SIMATIS, qui enregistre le micro et le son du Mac.
            </p>
            {erreur && <p style={{ color: 'var(--red)' }}>{erreur}</p>}
            {liste.length === 0 && <p className="muted">Aucun enregistrement pour l’instant.</p>}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
              {liste.map((e) => (
                <li
                  key={e.id}
                  className="stack"
                  style={{ borderTop: '1px solid var(--line, #e5e7eb)', paddingTop: 8 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong>{e.titre}</strong>
                      <div className="small muted">
                        {quand(e.debutAt)} · <span className="badge">{etat(e)}</span>
                      </div>
                    </div>
                    <div className="row">
                      <button
                        className="btn sm"
                        onClick={() => setDetail(detail === e.id ? null : e.id)}
                      >
                        {detail === e.id ? 'Masquer' : 'Voir'}
                      </button>
                      <a
                        className="btn sm"
                        href={`#/${slug}/fiche/rdv/${encodeURIComponent(e.rdvId)}`}
                      >
                        Ouvrir la fiche
                      </a>
                      <button className="btn sm" onClick={() => supprimer(e)}>
                        Supprimer
                      </button>
                    </div>
                  </div>
                  {detail === e.id && (
                    <EnregistrementVisio
                      slug={slug}
                      rdvId={e.rdvId}
                      titre={e.titre}
                      onSupprime={() => {
                        setDetail(null);
                        lire();
                      }}
                    />
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
