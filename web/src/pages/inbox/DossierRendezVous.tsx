import { Fragment, useState, type ReactNode } from 'react';
import {
  fetchCandidatsRdv,
  type CandidatRdv,
  type CorpsAcquittement,
  type SujetVue,
} from '../../api.js';
import { enLigne } from '../../cours/Markdown.js';

const quand = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

// Un résumé arrivé sans retours à la ligne (« **Titre** - point - point ») est remis en titres et
// listes pour l'affichage seulement : le texte envoyé à l'acquittement reste celui de Marc.
export const normaliser = (texte: string): string =>
  texte.includes('\n')
    ? texte
    : texte
        .replace(/\s+(\*\*[^*\n]{1,60}\*\*)\s+-\s+/g, '\n\n$1\n- ')
        .replace(/\s+-\s+(?=\S)/g, '\n- ');

// Titres (#, **Titre** seul sur sa ligne), listes à puces et paragraphes ; rien n'est écrit en HTML brut.
function CompteRenduRendu({ texte }: { texte: string }) {
  const lignes = normaliser(texte).replace(/\r\n?/g, '\n').split('\n');
  const blocs: ReactNode[] = [];
  let puces: string[] = [];
  const viderPuces = () => {
    if (puces.length === 0) return;
    const items = puces;
    blocs.push(
      <ul key={`ul-${blocs.length}`}>
        {items.map((p, i) => (
          <li key={i}>{enLigne(p)}</li>
        ))}
      </ul>,
    );
    puces = [];
  };
  for (const brute of lignes) {
    const ligne = brute.trim();
    const puce = /^[-*]\s+(.+)$/.exec(ligne);
    if (puce) {
      puces.push(puce[1]!);
      continue;
    }
    viderPuces();
    if (!ligne) continue;
    const titre = /^#{1,4}\s+(.+)$/.exec(ligne) ?? /^\*\*([^*]+)\*\*$/.exec(ligne);
    if (titre) blocs.push(<h4 key={blocs.length}>{enLigne(titre[1]!)}</h4>);
    else blocs.push(<p key={blocs.length}>{enLigne(ligne)}</p>);
  }
  viderPuces();
  return <div data-testid="compte-rendu-rendu">{blocs}</div>;
}

const NOUVEAU = '';

// Entrée « le rendez-vous et sa suite » : ce que l'OS a repéré, le compte rendu relu et corrigeable,
// et ce qui sera fait à l'acquittement, en un seul clic.
export function DossierRendezVous({
  slug,
  s,
  onAcquitter,
}: {
  slug: string;
  s: SujetVue;
  onAcquitter: (corps: CorpsAcquittement) => void;
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
  if (!dossier) return null;

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
    onAcquitter({ ...(eventId ? { eventId } : {}), texte, cerveau, contactId });
  };

  return (
    <div className="stack" style={{ marginBottom: 12 }}>
      <h3>Déjà fait</h3>
      <div className="stack">
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
        {dossier.interlocuteurs.length > 1 ? (
          <>
            <label className="small muted" htmlFor={`dos-contact-${s.id}`}>
              Interlocuteur
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
            </select>
          </>
        ) : interlocuteur ? (
          <div>
            ✔ Interlocuteur : {interlocuteur.nom}
            {interlocuteur.entreprise ? ` (${interlocuteur.entreprise})` : ''}
          </div>
        ) : (
          <div className="small muted">Aucun interlocuteur reconnu dans le CRM.</div>
        )}
      </div>

      <h3>Compte rendu</h3>
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

      <h3>À l’acquittement, l’OS va…</h3>
      <Fragment>
        <label>
          <input type="checkbox" checked disabled readOnly /> Enregistrer le compte rendu sur le
          rendez-vous et dans les fiches
        </label>
        <label>
          <input type="checkbox" checked={cerveau} onChange={(e) => setCerveau(e.target.checked)} />{' '}
          <span>Écrire dans le second cerveau</span>
        </label>
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
