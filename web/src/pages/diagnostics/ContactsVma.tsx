import { useEffect, useState } from 'react';
import {
  createContact,
  createEntreprise,
  fetchContacts,
  fetchContactsVma,
  fetchEntreprises,
  creerLienProspectionVma,
  rattacherVma,
  retirerAccordVma,
  type Contact,
  type ContactVma,
  type Entreprise,
} from '../../api.js';
import { Modale } from './Creation.js';
import { libelleStatut } from '../TestsVma.js';

const erreurDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const normaliser = (s: string) => s.trim().toLocaleLowerCase('fr');
const date = (s: string) => new Date(s).toLocaleString('fr-FR');

export function ContactsVma({ slug, onRetour }: { slug: string; onRetour: () => void }) {
  const [lignes, setLignes] = useState<ContactVma[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState('tous');
  const [choix, setChoix] = useState<ContactVma | null>(null);
  const [lien, setLien] = useState('');
  const [copie, setCopie] = useState(false);
  const [creationLien, setCreationLien] = useState(false);
  const charger = () =>
    fetchContactsVma(slug)
      .then(setLignes)
      .catch((e: unknown) => setErreur(erreurDe(e)));
  useEffect(() => {
    void charger();
  }, [slug]);
  const obtenirLien = async () => {
    if (creationLien) return;
    setCreationLien(true);
    try {
      const r = await creerLienProspectionVma(slug);
      setLien(r.lien);
      setCopie(false);
      try {
        await navigator.clipboard.writeText(r.lien);
        setCopie(true);
      } catch {
        /* Le lien reste sélectionnable. */
      }
    } catch (e) {
      setErreur(erreurDe(e));
    } finally {
      setCreationLien(false);
    }
  };
  const visibles = lignes?.filter((t) => {
    const q = normaliser(recherche);
    return (
      (!q ||
        normaliser(
          [
            t.entrepriseNom,
            t.contactPrenom,
            t.contactNom,
            t.contactPoste,
            t.contactEmail,
            t.contactTelephone,
          ].join(' '),
        ).includes(q)) &&
      (filtre !== 'a_lier' || !t.contactId || !t.entrepriseId) &&
      (filtre !== 'realises' || Boolean(t.recueLe)) &&
      (filtre !== 'inscriptions' || t.origine === 'inscription')
    );
  });
  return (
    <div className="stack dg">
      <div className="panel">
        <div className="panel-h">
          <div>
            <h2>Contacts VMA</h2>
            <p className="small muted">
              Vos invitations et les inscriptions depuis les liens personnels, avec leur
              rattachement au CRM.
            </p>
          </div>
          <div className="dg-outils">
            <button className="btn" onClick={onRetour}>
              ← Outils et diagnostics
            </button>
            <button className="btn go" disabled={creationLien} onClick={() => void obtenirLien()}>
              Créer un lien de prospection
            </button>
            <button className="btn" onClick={() => void charger()}>
              Actualiser
            </button>
          </div>
        </div>
        <div className="panel-b">
          {lien && (
            <p role="status">
              {copie ? 'Lien personnel copié : ' : 'Lien personnel à partager : '}
              <a href={lien} target="_blank" rel="noopener noreferrer">
                {lien}
              </a>
            </p>
          )}
          <div className="dg-outils">
            <input
              className="input"
              type="search"
              aria-label="Rechercher un contact VMA"
              placeholder="Entreprise, nom, mail…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
            <select
              className="input"
              aria-label="Filtrer les contacts VMA"
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
            >
              <option value="tous">Tous les contacts</option>
              <option value="a_lier">À rattacher au CRM</option>
              <option value="realises">Test réalisé</option>
              <option value="inscriptions">Inscription par lien</option>
            </select>
          </div>
        </div>
      </div>
      {erreur && (
        <div className="alert amber" role="alert">
          {erreur}
        </div>
      )}
      <div className="panel">
        <div className="panel-b vma-contacts-table">
          {!lignes ? (
            <p>Chargement…</p>
          ) : (
            <>
              <p className="small muted">
                {visibles?.length} invitation(s) · Les coordonnées déclarées sont conservées même
                après rattachement.
              </p>
              <table>
                <thead>
                  <tr>
                    {[
                      'Entreprise',
                      'Prénom',
                      'Nom',
                      'Poste',
                      'Mail',
                      'Téléphone',
                      'Suivi du test',
                      'CRM',
                      'Accord commercial',
                      'Actions',
                    ].map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibles?.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {t.entrepriseNom}
                        <div className="small muted">
                          {t.origine === 'inscription'
                            ? 'Inscription par lien'
                            : 'Invitation SIMATIS'}
                        </div>
                      </td>
                      <td>{t.contactPrenom || '—'}</td>
                      <td>{t.contactNomFamille || t.contactNom || '—'}</td>
                      <td>{t.contactPoste || t.contactLie?.fonction || '—'}</td>
                      <td>{t.contactEmail || '—'}</td>
                      <td>{t.contactTelephone || t.contactLie?.telephone || '—'}</td>
                      <td>
                        {t.recueLe
                          ? 'Test réalisé'
                          : !t.envoyeeLe &&
                              t.statut === 'envoyee' &&
                              Date.parse(t.expireLe) > Date.now()
                            ? 'En attente d’envoi'
                            : libelleStatut(t)}
                        <div className="small muted">
                          {t.envoyeeLe
                            ? `Mail envoyé le ${date(t.envoyeeLe)}`
                            : t.echecEnvoi
                              ? `Échec : ${t.echecEnvoi}`
                              : 'Mail non envoyé'}
                          {t.recueLe && ` · Résultat reçu le ${date(t.recueLe)}`}
                        </div>
                      </td>
                      <td>
                        {t.contactLie ? (
                          <a href={`#/${slug}/contacts/${t.contactLie.id}`}>{t.contactLie.nom}</a>
                        ) : (
                          <span>Contact non lié</span>
                        )}
                        <br />
                        {t.entrepriseLiee ? (
                          <a href={`#/${slug}/entreprises/${t.entrepriseLiee.id}`}>
                            {t.entrepriseLiee.nom}
                          </a>
                        ) : (
                          <span>Organisation non liée</span>
                        )}
                      </td>
                      <td>
                        {t.consentement
                          ? t.consentement.retireLe
                            ? `Retiré le ${date(t.consentement.retireLe)}`
                            : `Accepté le ${date(t.consentement.accepteLe)}`
                          : 'Non recueilli ici'}
                      </td>
                      <td>
                        <button className="btn" onClick={() => setChoix(t)}>
                          Gérer les fiches CRM
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!visibles?.length && (
                    <tr>
                      <td colSpan={10}>Aucun contact ne correspond à ces critères.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      {choix && (
        <Rattachement
          key={choix.id}
          slug={slug}
          test={choix}
          onFermer={() => setChoix(null)}
          onChange={() => void charger()}
        />
      )}
    </div>
  );
}

function Rattachement({
  slug,
  test,
  onFermer,
  onChange,
}: {
  slug: string;
  test: ContactVma;
  onFermer: () => void;
  onChange: () => void;
}) {
  const [entreprises, setEntreprises] = useState<Entreprise[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [entrepriseId, setEntrepriseId] = useState(test.entrepriseId ?? '');
  const [contactId, setContactId] = useState(test.contactId ?? '');
  const [nomEntreprise, setNomEntreprise] = useState(test.entrepriseNom);
  const [nom, setNom] = useState(test.contactNom ?? '');
  const [poste, setPoste] = useState(test.contactPoste ?? '');
  const [email, setEmail] = useState(test.contactEmail ?? '');
  const [telephone, setTelephone] = useState(test.contactTelephone ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [retire, setRetire] = useState(Boolean(test.consentement?.retireLe));
  const [charge, setCharge] = useState(false);
  useEffect(() => {
    Promise.all([fetchEntreprises(slug, ''), fetchContacts(slug, '')])
      .then(([e, c]) => {
        setEntreprises(e);
        setContacts(c);
        setCharge(true);
      })
      .catch((e: unknown) => setErreur(erreurDe(e)));
  }, [slug]);
  const agir = async (f: () => Promise<void>) => {
    if (enCours) return;
    setEnCours(true);
    setErreur(null);
    setInfo(null);
    try {
      await f();
      onChange();
    } catch (e) {
      setErreur(erreurDe(e));
    } finally {
      setEnCours(false);
    }
  };
  const doublonEntreprise = entreprises.find(
    (e) => normaliser(e.nom) === normaliser(nomEntreprise),
  );
  const doublonContact = email.trim()
    ? contacts.find((c) => c.email && normaliser(c.email) === normaliser(email))
    : undefined;
  const creerOrganisation = () =>
    agir(async () => {
      const e = await createEntreprise(slug, { nom: nomEntreprise.trim() });
      if (!e.id) {
        setInfo(e.message ?? 'Simulation : aucune fiche créée.');
        return;
      }
      // Sauver immédiatement le rattachement : une erreur lors de la création du contact ne le perd pas.
      await rattacherVma(slug, test.id, { entrepriseId: e.id });
      setEntrepriseId(e.id);
      setEntreprises(await fetchEntreprises(slug, ''));
      setInfo('Organisation créée et liée à cette invitation.');
    });
  const creerPersonne = () =>
    agir(async () => {
      const c = await createContact(slug, {
        nom: nom.trim(),
        fonction: poste.trim() || undefined,
        email: email.trim() || undefined,
        telephone: telephone.trim() || undefined,
        entrepriseId: entrepriseId || null,
      });
      if (!c.id) {
        setInfo(c.message ?? 'Simulation : aucune fiche créée.');
        return;
      }
      await rattacherVma(slug, test.id, { contactId: c.id, entrepriseId: entrepriseId || null });
      setContactId(c.id);
      setContacts(await fetchContacts(slug, ''));
      setInfo('Contact créé et lié à cette invitation.');
    });
  return (
    <Modale
      titre={`Fiches CRM · ${test.contactNom || test.entrepriseNom}`}
      onFermer={() => {
        if (!enCours) onFermer();
      }}
    >
      <div className="stack">
        <p className="small muted">
          Choisissez les fiches existantes ou créez-les avec les coordonnées de l’invitation. Aucune
          affaire ne sera créée.
        </p>
        {erreur && (
          <p role="alert" className="alert amber">
            {erreur}
          </p>
        )}
        {info && <p role="status">{info}</p>}
        <label className="field">
          Organisation existante
          <select
            className="input"
            value={entrepriseId}
            onChange={(e) => setEntrepriseId(e.target.value)}
            disabled={enCours || !charge}
          >
            <option value="">Non liée</option>
            {entreprises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Contact existant
          <select
            className="input"
            value={contactId}
            onChange={(e) => {
              const c = contacts.find((p) => p.id === e.target.value);
              setContactId(e.target.value);
              if (c?.entrepriseId) setEntrepriseId(c.entrepriseId);
            }}
            disabled={enCours || !charge}
          >
            <option value="">Non lié</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom} · {c.email || 'sans mail'} · {c.entreprise || 'sans organisation'}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn go"
          disabled={enCours || !charge}
          onClick={() =>
            void agir(async () => {
              await rattacherVma(slug, test.id, {
                contactId: contactId || null,
                entrepriseId: entrepriseId || null,
              });
              setInfo('Rattachement enregistré.');
            })
          }
        >
          Enregistrer le rattachement
        </button>
        <hr />
        <label className="field">
          Nom de l’organisation à créer
          <input
            className="input"
            value={nomEntreprise}
            onChange={(e) => setNomEntreprise(e.target.value)}
          />
        </label>
        {doublonEntreprise && (
          <p className="small">
            Organisation de même nom trouvée :{' '}
            <button className="btn" onClick={() => setEntrepriseId(doublonEntreprise.id)}>
              Sélectionner {doublonEntreprise.nom}
            </button>
          </p>
        )}
        <button
          className="btn"
          disabled={enCours || !charge || !nomEntreprise.trim() || Boolean(doublonEntreprise)}
          onClick={() => void creerOrganisation()}
        >
          Créer et lier l’organisation
        </button>
        <label className="field">
          Prénom et nom du contact à créer
          <input className="input" value={nom} onChange={(e) => setNom(e.target.value)} />
        </label>
        <label className="field">
          Poste
          <input className="input" value={poste} onChange={(e) => setPoste(e.target.value)} />
        </label>
        <label className="field">
          Mail
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Téléphone
          <input
            className="input"
            type="tel"
            value={telephone}
            onChange={(e) => setTelephone(e.target.value)}
          />
        </label>
        {doublonContact && (
          <p className="small">
            Cette adresse existe déjà :{' '}
            <button
              className="btn"
              onClick={() => {
                setContactId(doublonContact.id);
                if (doublonContact.entrepriseId) setEntrepriseId(doublonContact.entrepriseId);
              }}
            >
              Sélectionner {doublonContact.nom}
            </button>
          </p>
        )}
        <button
          className="btn"
          disabled={enCours || !charge || !nom.trim() || Boolean(doublonContact)}
          onClick={() => void creerPersonne()}
        >
          Créer et lier le contact
        </button>
        {test.consentement && (
          <details>
            <summary>Accord commercial</summary>
            <p>{test.consentement.texte}</p>
            <p className="small">
              Accepté le {date(test.consentement.accepteLe)} · Version {test.consentement.version}
            </p>
            {retire ? (
              <p>Accord retiré : exclure ce contact de la prospection.</p>
            ) : (
              <button
                className="btn"
                disabled={enCours}
                onClick={() =>
                  void agir(async () => {
                    await retirerAccordVma(slug, test.id);
                    setRetire(true);
                    setInfo('Retrait de l’accord enregistré.');
                  })
                }
              >
                Enregistrer un retrait de l’accord
              </button>
            )}
          </details>
        )}
        <button className="btn" disabled={enCours} onClick={onFermer}>
          Fermer
        </button>
      </div>
    </Modale>
  );
}
