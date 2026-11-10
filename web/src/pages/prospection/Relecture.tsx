import { useEffect, useState } from 'react';
import {
  fetchCampagne,
  finaliserCampagne,
  modifierBrouillonCampagne,
  reformulerBrouillonCampagne,
  reformulerBrouillonsCampagne,
  urlImageSignature,
  type BrouillonCampagne,
  type CampagneProspection,
  type ResultatCampagne,
  type SignatureProspection,
  type SuiviBrouillon,
} from '../../api.js';
import { corpsSur, htmlVersTexte, texteVersHtml } from './texte.js';

const ETATS: Record<string, [string, string]> = {
  pret: ['green', 'Prêt'],
  a_verifier: ['amber', 'À vérifier'],
  ecarte: ['', 'Écarté'],
  cree: ['blue', 'Créé'],
  a_rediger: ['blue', 'Claude reformule…'],
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Relecture({
  slug,
  campagne,
  signatures,
  envoiPossible = false,
  intervalleMs = 3000,
  onTermine,
}: {
  slug: string;
  campagne: CampagneProspection;
  signatures: SignatureProspection[];
  envoiPossible?: boolean;
  intervalleMs?: number;
  onTermine: (r: ResultatCampagne) => void;
}) {
  const [brouillons, setBrouillons] = useState<BrouillonCampagne[]>(campagne.brouillons);
  const [courant, setCourant] = useState(campagne.brouillons[0]?.id ?? '');
  const [edition, setEdition] = useState<{ objet: string; texte: string } | null>(null);
  const [citee, setCitee] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [confirmerEnvoi, setConfirmerEnvoi] = useState(false);
  const [demandes, setDemandes] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [consigneLot, setConsigneLot] = useState('');

  const reformulation = brouillons.some((x) => x.etat === 'a_rediger');
  const campagneId = campagne.id;
  // Claude rend le mail reformulé par l'exécuteur du poste : on interroge la campagne jusqu'à son retour.
  useEffect(() => {
    if (!reformulation) return;
    let actif = true;
    const t = setInterval(() => {
      fetchCampagne(slug, campagneId).then(
        (c) => {
          if (!actif || c.statut === 'redaction') return;
          setBrouillons(c.brouillons);
        },
        (e: unknown) => actif && setErreur(message(e)),
      );
    }, intervalleMs);
    return () => {
      actif = false;
      clearInterval(t);
    };
  }, [reformulation, slug, campagneId, intervalleMs]);

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

  const reformuler = async (id: string) => {
    const consigne = (demandes[id] ?? '').trim();
    if (!consigne) return;
    try {
      await reformulerBrouillonCampagne(slug, campagne.id, id, consigne);
      setBrouillons((l) => l.map((x) => (x.id === id ? { ...x, etat: 'a_rediger', consigne } : x)));
      setDemandes((d) => ({ ...d, [id]: '' }));
      setEdition(null);
      setErreur(null);
    } catch (e) {
      setErreur(message(e));
    }
  };

  // Les mails encore reformulables : ni écartés, ni déjà créés, ni en cours de reformulation.
  const reformulables = brouillons.filter((x) => x.etat === 'pret' || x.etat === 'a_verifier');
  const choisis = reformulables.filter((x) => selection.includes(x.id));
  const basculer = (id: string) =>
    setSelection((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  const reformulerLot = async () => {
    const consigne = consigneLot.trim();
    if (!consigne || choisis.length === 0) return;
    const ids = choisis.map((x) => x.id);
    try {
      await reformulerBrouillonsCampagne(slug, campagne.id, consigne, ids);
      setBrouillons((l) =>
        l.map((x) => (ids.includes(x.id) ? { ...x, etat: 'a_rediger', consigne } : x)),
      );
      setSelection([]);
      setConsigneLot('');
      setEdition(null);
      setErreur(null);
    } catch (e) {
      setErreur(message(e));
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
      {reformulables.length > 1 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-b">
            <label className="field">
              <span className="small">
                <b>Faire reformuler plusieurs mails par Claude, avec la même demande</b> : cochez
                les mails dans la liste (ou tous d'un coup), puis dites ce que vous voulez changer
              </span>
              <textarea
                className="input"
                aria-label="Demande pour les mails cochés"
                rows={2}
                maxLength={1000}
                placeholder="Ex. : ton plus direct, plus court, sans la phrase sur le prix…"
                disabled={reformulation}
                value={consigneLot}
                onChange={(e) => setConsigneLot(e.target.value)}
              />
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="small">
                <input
                  type="checkbox"
                  checked={choisis.length === reformulables.length}
                  disabled={reformulation}
                  onChange={(e) =>
                    setSelection(e.target.checked ? reformulables.map((x) => x.id) : [])
                  }
                />{' '}
                Tout cocher ({reformulables.length})
              </label>
              <button
                className="btn sm"
                disabled={reformulation || choisis.length === 0 || !consigneLot.trim()}
                onClick={() => void reformulerLot()}
              >
                Faire reformuler{' '}
                {choisis.length > 1 ? `les ${choisis.length} mails cochés` : 'le mail coché'}
              </button>
              {reformulation && (
                <span className="small muted">Une reformulation est déjà en cours.</span>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(280px,1fr) 2.4fr', gap: 14 }}>
        <div className="stack" style={{ alignContent: 'start' }}>
          {brouillons.map((x) => (
            <div
              key={x.id}
              className="panel"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 0 0 12px',
                opacity: x.etat === 'ecarte' ? 0.5 : 1,
                border: x.id === b.id ? '2px solid var(--navy)' : undefined,
              }}
            >
              {reformulables.length > 1 && (
                <input
                  type="checkbox"
                  aria-label={`Cocher le mail de ${x.contactNom}`}
                  checked={selection.includes(x.id)}
                  disabled={reformulation || !reformulables.some((r) => r.id === x.id)}
                  onChange={() => basculer(x.id)}
                />
              )}
              <button
                aria-label={`Ouvrir le mail de ${x.contactNom}`}
                aria-current={x.id === b.id}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px 10px 4px',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setCourant(x.id);
                  setEdition(null);
                  setCitee(null);
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{x.contactNom}</b> <span className="small muted">{x.societe}</span>
                </span>
                <span className="small" style={{ whiteSpace: 'nowrap' }}>
                  <span className={`badge ${ETATS[x.etat]?.[0] ?? ''}`}>{ETATS[x.etat]?.[1]}</span>{' '}
                  touche {x.touche}
                </span>
              </button>
            </div>
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
                disabled={b.etat === 'a_rediger'}
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
                disabled={b.etat === 'a_rediger'}
                onClick={() =>
                  void modifier(b.id, { etat: b.etat === 'ecarte' ? 'pret' : 'ecarte' })
                }
              >
                {b.etat === 'ecarte' ? 'Rétablir' : 'Écarter'}
              </button>
            </div>
          </div>
          <div className="panel-b">
            {b.etat === 'a_rediger' && (
              <div className="alert blue" style={{ marginBottom: 12 }} role="status">
                <div>
                  Claude reformule ce mail : « {b.consigne} ». Comptez environ une minute. Vous
                  pouvez relire les autres mails en attendant.
                </div>
              </div>
            )}
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
                <div dangerouslySetInnerHTML={{ __html: corpsSur(b.corps ?? '') }} />
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
            {!edition && b.etat !== 'ecarte' && b.etat !== 'cree' && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
                <label className="field">
                  <span className="small">
                    <b>Faire reformuler ce mail par Claude</b> : dites ce que vous voulez changer
                  </span>
                  <textarea
                    className="input"
                    aria-label="Ce que vous voulez changer"
                    rows={2}
                    maxLength={1000}
                    placeholder="Ex. : plus court, sans la phrase sur le prix, ton plus direct…"
                    disabled={reformulation}
                    value={demandes[b.id] ?? ''}
                    onChange={(e) => setDemandes({ ...demandes, [b.id]: e.target.value })}
                  />
                </label>
                <button
                  className="btn sm"
                  disabled={reformulation || !(demandes[b.id] ?? '').trim()}
                  onClick={() => void reformuler(b.id)}
                >
                  Faire reformuler par Claude
                </button>
                {reformulation && b.etat !== 'a_rediger' && (
                  <span className="small muted"> Une reformulation est déjà en cours.</span>
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
          disabled={enCours || reformulation || aVerifier > 0 || prets === 0}
          onClick={() => void finaliser('brouillons')}
        >
          {campagne.mode === 'reponse'
            ? 'Créer le brouillon de réponse dans la messagerie'
            : `Créer les ${prets} ${prets > 1 ? 'brouillons' : 'brouillon'} dans la messagerie`}
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
              disabled={enCours || reformulation || aVerifier > 0 || prets === 0}
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
        {reformulation && (
          <span className="small" style={{ color: 'var(--amber)' }}>
            Un mail est en cours de reformulation : attendez son retour avant de créer les
            brouillons.
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
