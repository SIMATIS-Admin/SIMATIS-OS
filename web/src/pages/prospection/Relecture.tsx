import { useState } from 'react';
import {
  finaliserCampagne,
  modifierBrouillonCampagne,
  urlImageSignature,
  type BrouillonCampagne,
  type CampagneProspection,
  type ResultatCampagne,
  type SignatureProspection,
  type SuiviBrouillon,
} from '../../api.js';
import { htmlVersTexte, texteVersHtml } from './texte.js';

const ETATS: Record<string, [string, string]> = {
  pret: ['green', 'Prêt'],
  a_verifier: ['amber', 'À vérifier'],
  ecarte: ['', 'Écarté'],
  cree: ['blue', 'Créé'],
  a_rediger: ['', 'À rédiger'],
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Relecture({
  slug,
  campagne,
  signatures,
  envoiPossible = false,
  onTermine,
}: {
  slug: string;
  campagne: CampagneProspection;
  signatures: SignatureProspection[];
  envoiPossible?: boolean;
  onTermine: (r: ResultatCampagne) => void;
}) {
  const [brouillons, setBrouillons] = useState<BrouillonCampagne[]>(campagne.brouillons);
  const [courant, setCourant] = useState(campagne.brouillons[0]?.id ?? '');
  const [edition, setEdition] = useState<{ objet: string; texte: string } | null>(null);
  const [citee, setCitee] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [confirmerEnvoi, setConfirmerEnvoi] = useState(false);

  const b = brouillons.find((x) => x.id === courant) ?? brouillons[0];
  const signature = signatures.find((s) => s.id === campagne.reglage.signatureId);
  const actifs = brouillons.filter((x) => x.etat !== 'ecarte');
  const aVerifier = brouillons.filter((x) => x.etat === 'a_verifier').length;
  const prets = brouillons.filter((x) => x.etat === 'pret').length;

  const modifier = async (id: string, champs: Parameters<typeof modifierBrouillonCampagne>[3]) => {
    try {
      const maj = await modifierBrouillonCampagne(slug, campagne.id, id, champs);
      setBrouillons((l) => l.map((x) => (x.id === id ? { ...x, ...maj } : x)));
      setErreur(null);
      return true;
    } catch (e) {
      setErreur(message(e));
      return false;
    }
  };

  const finaliser = async (mode: 'brouillons' | 'envoi' = 'brouillons') => {
    setEnCours(true);
    try {
      onTermine(await finaliserCampagne(slug, campagne.id, mode));
    } catch (e) {
      setErreur(message(e));
    } finally {
      setEnCours(false);
      setConfirmerEnvoi(false);
    }
  };

  if (!b) return <div className="empty">Aucun brouillon.</div>;
  const suivi = (type: SuiviBrouillon) => b.suiviType === type && citee !== b.id;

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(220px,1fr) 2.4fr', gap: 14 }}>
        <div className="stack">
          {brouillons.map((x) => (
            <button
              key={x.id}
              className="panel"
              aria-label={`Ouvrir le mail de ${x.contactNom}`}
              aria-current={x.id === b.id}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                opacity: x.etat === 'ecarte' ? 0.5 : 1,
                border: x.id === b.id ? '2px solid var(--navy)' : undefined,
              }}
              onClick={() => {
                setCourant(x.id);
                setEdition(null);
                setCitee(null);
              }}
            >
              <div className="panel-b" style={{ padding: '10px 12px' }}>
                <b>{x.contactNom}</b> <span className="small muted">{x.societe}</span>
                <div className="small">
                  <span className={`badge ${ETATS[x.etat]?.[0] ?? ''}`}>{ETATS[x.etat]?.[1]}</span>{' '}
                  touche {x.touche}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="panel">
          <div className="panel-h">
            <div>
              <h2>
                {b.contactNom} <span className="muted small">{b.societe}</span>
              </h2>
              <div className="small muted">Objet : {b.objet ?? '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn sm"
                onClick={() =>
                  setEdition(
                    edition ? null : { objet: b.objet ?? '', texte: htmlVersTexte(b.corps ?? '') },
                  )
                }
              >
                {edition ? 'Annuler' : 'Modifier le texte'}
              </button>
              <button
                className={`btn sm ${b.etat === 'ecarte' ? '' : 'danger'}`}
                onClick={() =>
                  void modifier(b.id, { etat: b.etat === 'ecarte' ? 'pret' : 'ecarte' })
                }
              >
                {b.etat === 'ecarte' ? 'Rétablir' : 'Écarter'}
              </button>
            </div>
          </div>
          <div className="panel-b">
            {b.etat === 'a_verifier' && (
              <div className="alert amber" style={{ marginBottom: 12 }}>
                <div>
                  {b.note ?? 'Ce brouillon est à vérifier.'}{' '}
                  <button className="btn sm" onClick={() => void modifier(b.id, { etat: 'pret' })}>
                    J'ai relu ce mail
                  </button>
                </div>
              </div>
            )}
            {edition ? (
              <div>
                <label className="field">
                  <span>Objet</span>
                  <input
                    className="input"
                    aria-label="Objet"
                    value={edition.objet}
                    onChange={(e) => setEdition({ ...edition, objet: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>
                    Texte du mail (une ligne vide entre deux paragraphes, « - » pour une puce)
                  </span>
                  <textarea
                    className="input"
                    aria-label="Texte du mail"
                    rows={12}
                    value={edition.texte}
                    onChange={(e) => setEdition({ ...edition, texte: e.target.value })}
                  />
                </label>
                <button
                  className="btn primary"
                  onClick={() =>
                    void modifier(b.id, {
                      objet: edition.objet,
                      corps: texteVersHtml(edition.texte),
                    }).then((ok) => ok && setEdition(null))
                  }
                >
                  Enregistrer le texte
                </button>
              </div>
            ) : (
              <div style={{ lineHeight: 1.55 }}>
                <div dangerouslySetInnerHTML={{ __html: b.corps ?? '' }} />
                {signature ? (
                  <img
                    src={urlImageSignature(slug, signature.id)}
                    alt={`Signature ${signature.nom}`}
                    style={{ maxWidth: 360, maxHeight: 120 }}
                  />
                ) : (
                  <p className="small muted">(sans signature)</p>
                )}
              </div>
            )}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
              <b className="small">Suivi après ce mail</b>
              <div style={{ marginTop: 6 }}>
                <label style={{ marginRight: 14 }}>
                  <input
                    type="radio"
                    name={`suivi-${b.id}`}
                    checked={suivi('delai')}
                    onChange={() => {
                      setCitee(null);
                      void modifier(b.id, { suiviType: 'delai' });
                    }}
                  />{' '}
                  Relancer selon la campagne
                </label>
                <label style={{ marginRight: 14 }}>
                  <input
                    type="radio"
                    name={`suivi-${b.id}`}
                    checked={b.suiviType === 'citee' || citee === b.id}
                    onChange={() => setCitee(b.id)}
                  />{' '}
                  Date citée par le contact
                </label>
                <label style={{ marginRight: 14 }}>
                  <input
                    type="radio"
                    name={`suivi-${b.id}`}
                    checked={suivi('clos')}
                    onChange={() => {
                      setCitee(null);
                      void modifier(b.id, { suiviType: 'clos' });
                    }}
                  />{' '}
                  Dossier clos (refus)
                </label>
                {(b.suiviType === 'citee' || citee === b.id) && (
                  <input
                    className="input"
                    type="date"
                    aria-label="Date de reprise"
                    style={{ width: 'auto' }}
                    value={b.suiviDate ? b.suiviDate.slice(0, 10) : ''}
                    onChange={(e) =>
                      e.target.value &&
                      void modifier(b.id, { suiviType: 'citee', suiviDate: e.target.value }).then(
                        (ok) => ok && setCitee(null),
                      )
                    }
                  />
                )}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {b.suiviType === 'clos'
                  ? 'Aucune tâche de suivi ne sera créée.'
                  : 'Une tâche de suivi (MAIL) sera créée après ce mail.'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {erreur && (
        <p className="small" role="alert" style={{ color: 'var(--red)', marginTop: 12 }}>
          {erreur}
        </p>
      )}
      <div
        style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <button
          className="btn primary"
          disabled={enCours || aVerifier > 0 || prets === 0}
          onClick={() => void finaliser('brouillons')}
        >
          Créer les {prets} {prets > 1 ? 'brouillons' : 'brouillon'} dans la messagerie
        </button>
        {envoiPossible ? (
          confirmerEnvoi ? (
            <>
              <b className="small">
                {prets} {prets > 1 ? 'mails partent' : 'mail part'} maintenant, sans autre
                relecture.
              </b>
              <button className="btn go" disabled={enCours} onClick={() => void finaliser('envoi')}>
                Oui, envoyer
              </button>
              <button className="btn ghost" onClick={() => setConfirmerEnvoi(false)}>
                Annuler
              </button>
            </>
          ) : (
            <button
              className="btn go"
              disabled={enCours || aVerifier > 0 || prets === 0}
              onClick={() => setConfirmerEnvoi(true)}
            >
              Valider et envoyer ({prets})
            </button>
          )
        ) : (
          <span className="small muted">
            Envoi direct indisponible : les deux verrous d'écriture sont fermés.
          </span>
        )}
        {aVerifier > 0 && (
          <span className="small" style={{ color: 'var(--amber)' }}>
            {aVerifier} à vérifier : relisez-les avant de continuer.
          </span>
        )}
        <span className="small muted">
          {actifs.length} sur {brouillons.length} retenus. Vous envoyez vous-même depuis votre
          messagerie.
        </span>
      </div>
    </>
  );
}
