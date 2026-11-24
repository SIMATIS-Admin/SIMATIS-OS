import { Fragment, useState } from 'react';
import {
  fetchCandidatsRdv,
  type CandidatRdv,
  type CorpsAcquittement,
  type LigneSuite,
  type SujetVue,
} from '../../api.js';
import { CompteRenduRendu, normaliser } from './CompteRenduRendu.js';

const quand = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

export { normaliser };

// Le champ date-heure du navigateur travaille en heure locale, l'OS en UTC.
const deuxChiffres = (n: number) => String(n).padStart(2, '0');
const versLocal = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}T${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;
};
const versIso = (local: string) => new Date(local).toISOString();

type Ligne<G extends LigneSuite['genre']> = Extract<LigneSuite, { genre: G }>;

const NOUVEAU = '';
const LIGNE_CASE = { display: 'block' } as const;

// Entrée « le rendez-vous et sa suite » : ce que l'OS a repéré, le compte rendu relu et corrigeable,
// et ce qui sera fait à l'acquittement, en un seul clic.
export function DossierRendezVous({
  slug,
  s,
  onAcquitter,
}: {
  slug: string;
  s: SujetVue;
  onAcquitter: (corps: CorpsAcquittement) => void | Promise<unknown>;
}) {
  const prepare = s.compteRenduPrepare;
  const dossier = prepare?.dossier;
  const [texte, setTexte] = useState(prepare?.texte ?? '');
  const [edition, setEdition] = useState(false);
  const [eventId, setEventId] = useState(dossier?.rdv?.eventId ?? NOUVEAU);
  const [candidats, setCandidats] = useState<CandidatRdv[] | null>(null);
  const [changer, setChanger] = useState(false);
  const [contactId, setContactId] = useState<string | null>(
    dossier?.interlocuteurs.find((i) => i.principal)?.contactId ?? s.contact?.id ?? null,
  );
  const [cerveau, setCerveau] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const diag = dossier?.suite?.find((l): l is Ligne<'diagnostic'> => l.genre === 'diagnostic');
  const rdvSuite = dossier?.suite?.find((l): l is Ligne<'rdv'> => l.genre === 'rdv');
  const relance = dossier?.suite?.find((l): l is Ligne<'relance'> => l.genre === 'relance');
  const [diagCoche, setDiagCoche] = useState(diag?.coche ?? false);
  const [diagNom, setDiagNom] = useState(diag?.nom ?? '');
  const [rdvCoche, setRdvCoche] = useState(rdvSuite?.coche ?? false);
  const [rdvTitre, setRdvTitre] = useState(rdvSuite?.titre ?? '');
  const [rdvDebut, setRdvDebut] = useState(rdvSuite ? versLocal(rdvSuite.debut) : '');
  const [relCoche, setRelCoche] = useState(relance?.coche ?? false);
  const [relTitre, setRelTitre] = useState(relance?.titre ?? '');
  const [relEcheance, setRelEcheance] = useState(relance?.echeance ?? '');
  if (!dossier) return null;

  // Seules les lignes cochées, avec leurs textes tels que Marc les a laissés, partent à l'acquittement.
  const suiteChoisie: NonNullable<CorpsAcquittement['suite']> = {
    ...(diag && !diag.existant && diagCoche && diagNom.trim()
      ? { diagnostic: { nom: diagNom } }
      : {}),
    ...(rdvSuite && !rdvSuite.dejaAgenda && rdvCoche && rdvTitre.trim() && rdvDebut
      ? { rdv: { titre: rdvTitre, debut: versIso(rdvDebut) } }
      : {}),
    ...(relance && relCoche && relTitre.trim() && relEcheance
      ? { relance: { titre: relTitre, echeance: relEcheance } }
      : {}),
  };

  const listeRdv: { eventId: string; titre: string; debut: string | null }[] =
    candidats ?? dossier.candidats;
  const choisir = rdvChoisi(dossier.rdv, listeRdv, eventId);
  const montrerListe = !dossier.rdvCertain || changer;
  const interlocuteur = dossier.interlocuteurs.find((i) => i.contactId === contactId);

  const ouvrirChoix = () => {
    setChanger(true);
    void fetchCandidatsRdv(slug, s.id).then(setCandidats, () => undefined);
  };
  const acquitter = () => {
    if (envoi) return;
    setEnvoi(true);
    // En cas d'échec le bouton se libère : Marc peut corriger et réessayer.
    void Promise.resolve(
      onAcquitter({
        ...(eventId ? { eventId } : {}),
        texte,
        cerveau,
        contactId,
        ...(Object.keys(suiteChoisie).length > 0 ? { suite: suiteChoisie } : {}),
      }),
    ).finally(() => setEnvoi(false));
  };

  return (
    <div className="stack dossier" style={{ marginBottom: 12 }}>
      <h3 className="dossier-titre">Déjà fait</h3>
      <div className="stack dossier-fait">
        {montrerListe ? (
          <>
            <label className="small muted" htmlFor={`dos-rdv-${s.id}`}>
              {dossier.rdvCertain ? 'Rendez-vous de l’agenda' : 'Rendez-vous à choisir'}
            </label>
            <select
              id={`dos-rdv-${s.id}`}
              className="input"
              aria-label="Rendez-vous du compte rendu"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value={NOUVEAU}>Nouveau rendez-vous (sans événement Google)</option>
              {listeRdv.map((c) => (
                <option key={c.eventId} value={c.eventId}>
                  {c.titre} · {quand(c.debut)}
                </option>
              ))}
            </select>
          </>
        ) : (
          <div>
            ✔ Rendez-vous de l’agenda : {choisir?.titre} · {quand(choisir?.debut ?? null)}{' '}
            <button className="btn" onClick={ouvrirChoix}>
              Changer
            </button>
          </div>
        )}
        {dossier.interlocuteurs.length > 0 ? (
          <>
            <label className="small muted" htmlFor={`dos-contact-${s.id}`}>
              {interlocuteur ? '✔ Interlocuteur' : 'Interlocuteur'}
            </label>
            <select
              id={`dos-contact-${s.id}`}
              className="input"
              aria-label="Interlocuteur du rendez-vous"
              value={contactId ?? ''}
              onChange={(e) => setContactId(e.target.value || null)}
            >
              {dossier.interlocuteurs.map((i) => (
                <option key={i.contactId} value={i.contactId}>
                  {i.nom}
                  {i.entreprise ? ` (${i.entreprise})` : ''}
                </option>
              ))}
              <option value="">Aucun</option>
            </select>
          </>
        ) : (
          <div className="small muted">Aucun interlocuteur reconnu dans le CRM.</div>
        )}
        {rdvSuite?.dejaAgenda ? (
          <div>
            ✔ Prochain rendez-vous déjà dans l’agenda : {rdvSuite.dejaAgenda.titre} ·{' '}
            {quand(rdvSuite.dejaAgenda.debut)}
          </div>
        ) : null}
        {diag?.existant ? <div>✔ Diagnostic déjà créé : {diag.existant.nom}</div> : null}
      </div>

      <h3 className="dossier-titre">Compte rendu</h3>
      {edition ? (
        <textarea
          className="input"
          rows={14}
          aria-label="Compte rendu"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
      ) : (
        <CompteRenduRendu texte={texte} />
      )}
      <div className="decision">
        <button className="btn" onClick={() => setEdition(!edition)}>
          {edition ? 'Terminer' : 'Modifier'}
        </button>
      </div>

      <h3 className="dossier-titre">À l’acquittement, l’OS va…</h3>
      <Fragment>
        <label style={LIGNE_CASE}>
          <input type="checkbox" checked disabled readOnly /> Enregistrer le compte rendu sur le
          rendez-vous et dans les fiches
        </label>
        <label style={LIGNE_CASE}>
          <input type="checkbox" checked={cerveau} onChange={(e) => setCerveau(e.target.checked)} />{' '}
          <span>Écrire dans le second cerveau</span>
        </label>
        {diag && !diag.existant ? (
          <div className="stack">
            <label style={LIGNE_CASE}>
              <input
                type="checkbox"
                checked={diagCoche}
                onChange={(e) => setDiagCoche(e.target.checked)}
              />{' '}
              Créer le diagnostic dans « Outils et diagnostics »
            </label>
            <input
              className="input"
              aria-label="Nom du diagnostic"
              value={diagNom}
              onChange={(e) => setDiagNom(e.target.value)}
            />
          </div>
        ) : null}
        {rdvSuite && !rdvSuite.dejaAgenda ? (
          <div className="stack">
            <label style={LIGNE_CASE}>
              <input
                type="checkbox"
                checked={rdvCoche}
                onChange={(e) => setRdvCoche(e.target.checked)}
              />{' '}
              Créer le rendez-vous dans l’agenda de l’OS
            </label>
            <input
              className="input"
              aria-label="Titre du rendez-vous à créer"
              value={rdvTitre}
              onChange={(e) => setRdvTitre(e.target.value)}
            />
            <input
              className="input"
              type="datetime-local"
              aria-label="Date du rendez-vous à créer"
              value={rdvDebut}
              onChange={(e) => setRdvDebut(e.target.value)}
            />
          </div>
        ) : null}
        {relance ? (
          <div className="stack">
            <label style={LIGNE_CASE}>
              <input
                type="checkbox"
                checked={relCoche}
                onChange={(e) => setRelCoche(e.target.checked)}
              />{' '}
              Créer la tâche de relance
            </label>
            <input
              className="input"
              aria-label="Titre de la relance"
              value={relTitre}
              onChange={(e) => setRelTitre(e.target.value)}
            />
            <input
              className="input"
              type="date"
              aria-label="Échéance de la relance"
              value={relEcheance}
              onChange={(e) => setRelEcheance(e.target.value)}
            />
          </div>
        ) : null}
      </Fragment>
      <div className="decision">
        <button className="btn go" disabled={envoi || !texte.trim()} onClick={acquitter}>
          Acquitter
        </button>
      </div>
    </div>
  );
}

const rdvChoisi = (
  rdv: { eventId: string; titre: string; debut: string | null } | null,
  liste: { eventId: string; titre: string; debut: string | null }[],
  eventId: string,
) => liste.find((c) => c.eventId === eventId) ?? (rdv?.eventId === eventId ? rdv : null) ?? rdv;
