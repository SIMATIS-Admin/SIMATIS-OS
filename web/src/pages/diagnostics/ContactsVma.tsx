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
import { Icon } from '../../icons.js';
import { Modale } from './Creation.js';
import { libelleStatut } from '../TestsVma.js';

const erreurDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const normaliser = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLocaleLowerCase('fr');
const jour = (s: string) => new Date(s).toLocaleDateString('fr-FR');
const date = (s: string) => new Date(s).toLocaleString('fr-FR');

function identite(t: ContactVma) {
  const complet = t.contactNom?.trim() ?? '';
  const prenom = t.contactPrenom?.trim() ?? '';
  const nom = t.contactNomFamille?.trim() ?? '';
  if (prenom)
    return {
      prenom,
      nom:
        nom ||
        (complet.startsWith(prenom + ' ')
          ? complet.slice(prenom.length + 1)
          : complet === prenom
            ? ''
            : complet),
    };
  if (nom) {
    return {
      prenom: complet.endsWith(' ' + nom) ? complet.slice(0, -nom.length - 1) : '',
      nom,
    };
  }
  // Les anciennes invitations saisissent « Prénom et nom » dans un seul champ.
  const morceaux = complet.split(/\s+/);
  if (morceaux.length < 2 || morceaux.some((mot) => !/^[\p{L}'’.-]+$/u.test(mot))) {
    return { prenom: '', nom: complet };
  }
  return { prenom: morceaux[0]!, nom: morceaux.slice(1).join(' ') };
}

const statutTest = (t: ContactVma) =>
  t.recueLe
    ? 'Test réalisé'
    : !t.envoyeeLe && t.statut === 'envoyee' && Date.parse(t.expireLe) > Date.now()
      ? 'En attente d’envoi'
      : libelleStatut(t);

const tris = {
  entreprise: 'Entreprise',
  nom: 'Nom',
  prenom: 'Prénom',
  date: 'Date de création',
  statut: 'Statut du test',
} as const;
type Tri = keyof typeof tris;
const comparer = new Intl.Collator('fr', { sensitivity: 'base', numeric: true }).compare;

type TestSupprime = { id: string; nom: string | null; entreprise: string; date: string };

export function ContactsVma({
  slug,
  onRetour,
  accesTest,
  testsSupprimesCle,
}: {
  slug: string;
  onRetour: () => void;
  accesTest?: (test: ContactVma) => { archive: boolean; ouvrir: () => void } | null;
  testsSupprimesCle?: string;
}) {
  const [supprimes] = useState<TestSupprime[]>(() => {
    try {
      const valeur: unknown = JSON.parse(
        testsSupprimesCle ? (localStorage.getItem(testsSupprimesCle) ?? '[]') : '[]',
      );
      return Array.isArray(valeur) ? (valeur as TestSupprime[]) : [];
    } catch {
      return [];
    }
  });
  const [lignes, setLignes] = useState<ContactVma[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const [origine, setOrigine] = useState('');
  const [statut, setStatut] = useState('');
  const [crm, setCrm] = useState('');
  const [tri, setTri] = useState<Tri>('entreprise');
  const [inverse, setInverse] = useState(false);
  const cleRetires = `diagnostics.contacts-retires.${slug}`;
  const [retires, setRetires] = useState<string[]>(() => {
    try {
      const valeur: unknown = JSON.parse(localStorage.getItem(cleRetires) ?? '[]');
      return Array.isArray(valeur)
        ? valeur.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  });
  const [voirRetires, setVoirRetires] = useState(false);
  const basculerRetire = (cle: string) => {
    const suivants = retires.includes(cle) ? retires.filter((id) => id !== cle) : [...retires, cle];
    try {
      localStorage.setItem(cleRetires, JSON.stringify(suivants));
      setRetires(suivants);
    } catch {
      setErreur('Impossible d’enregistrer ce choix dans ce navigateur.');
    }
  };
  const [historiques, setHistoriques] = useState<Set<string>>(new Set());
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
  const filtresActifs = [origine, statut, crm].filter(Boolean).length;
  const q = normaliser(recherche);
  const fiches = (lignes ?? []).map((t) => ({
    ...t,
    ...identite(t),
    statutAffiche: statutTest(t),
    lie: Boolean(t.contactId && t.entrepriseId),
  }));
  const statuts = [...new Set(fiches.map((t) => t.statutAffiche))].sort(comparer);
  const visibles = fiches
    .filter(
      (t) =>
        (!q ||
          normaliser(
            [
              t.entrepriseNom,
              t.prenom,
              t.nom,
              t.contactNom,
              t.contactPoste || t.contactLie?.fonction,
              t.contactEmail,
              t.contactTelephone || t.contactLie?.telephone,
            ].join(' '),
          ).includes(q)) &&
        (!origine || t.origine === origine) &&
        (!statut || t.statutAffiche === statut) &&
        (!crm || t.lie === (crm === 'lie')),
    )
    .sort((a, b) => {
      const valeur = (t: typeof a) =>
        ({
          entreprise: t.entrepriseNom,
          nom: t.nom,
          prenom: t.prenom,
          date: t.creeLe,
          statut: t.statutAffiche,
        })[tri];
      return (inverse ? -1 : 1) * comparer(valeur(a), valeur(b));
    });
  const groupes = new Map<string, (typeof visibles)[number][]>();
  for (const t of visibles) {
    const cle =
      t.prenom && t.nom
        ? `nom:${normaliser(t.prenom + ' ' + t.nom)}`
        : t.contactId
          ? `crm:${t.contactId}`
          : t.contactEmail
            ? `email:${normaliser(t.contactEmail)}`
            : `test:${t.id}`;
    const groupe = groupes.get(cle);
    if (groupe) groupe.push(t);
    else groupes.set(cle, [t]);
  }
  const groupesAffiches = [...groupes].filter(([cle]) => retires.includes(cle) === voirRetires);
  const nombreOccurrences = groupesAffiches.reduce(
    (total, [, invitations]) => total + invitations.length,
    0,
  );
  return (
    <div className="stack dg">
      <div className="panel">
        <div className="panel-h">
          <div>
            <h2>Contacts</h2>
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
          {(retires.length > 0 || voirRetires) && (
            <button
              className="btn vma-occurrences"
              type="button"
              onClick={() => setVoirRetires(!voirRetires)}
            >
              {voirRetires ? 'Retour aux contacts' : `Lignes retirées (${retires.length})`}
            </button>
          )}
          <div className="vma-contact-recherche">
            <input
              className="input"
              type="search"
              aria-label="Rechercher un contact"
              placeholder="Entreprise, nom, mail…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              aria-expanded={filtresOuverts}
              aria-controls="vma-contact-filtres"
              onClick={() => setFiltresOuverts(!filtresOuverts)}
            >
              Filtres et tri{filtresActifs ? ` (${filtresActifs})` : ''}
              <span aria-hidden="true">{filtresOuverts ? '▴' : '▾'}</span>
            </button>
          </div>
          <div id="vma-contact-filtres" className="vma-contact-filtres" hidden={!filtresOuverts}>
            <label>
              <span>Origine du contact</span>
              <select
                className="input"
                aria-label="Origine du contact"
                value={origine}
                onChange={(e) => setOrigine(e.target.value)}
              >
                <option value="">Toutes les origines</option>
                <option value="invitation">Invitation SIMATIS</option>
                <option value="inscription">Inscription par lien</option>
              </select>
            </label>
            <label>
              <span>Statut du test</span>
              <select
                className="input"
                aria-label="Statut du test"
                value={statut}
                onChange={(e) => setStatut(e.target.value)}
              >
                <option value="">Tous les statuts</option>
                {statuts.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Rattachement CRM</span>
              <select
                className="input"
                aria-label="Rattachement CRM"
                value={crm}
                onChange={(e) => setCrm(e.target.value)}
              >
                <option value="">Tous les rattachements</option>
                <option value="a_lier">À rattacher au CRM</option>
                <option value="lie">Rattachés au CRM</option>
              </select>
            </label>
            <label>
              <span>Trier par</span>
              <select
                className="input"
                aria-label="Trier par"
                value={tri}
                onChange={(e) => setTri(e.target.value as Tri)}
              >
                {Object.entries(tris).map(([cle, titre]) => (
                  <option key={cle} value={cle}>
                    {titre}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              aria-label="Inverser le tri"
              onClick={() => setInverse(!inverse)}
            >
              {inverse ? '↓ Décroissant' : '↑ Croissant'}
            </button>
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
                {groupesAffiches.length} contact(s) · {nombreOccurrences} invitation(s) ou
                inscription(s)
              </p>
              <table>
                <thead>
                  <tr>
                    {['Contact', 'Entreprise', 'Coordonnées', 'Suivi du test', 'Actions'].map(
                      (t) => (
                        <th key={t} scope="col">
                          {t}
                        </th>
                      ),
                    )}
                    <th scope="col" aria-label="Visibilité de la ligne" />
                  </tr>
                </thead>
                <tbody>
                  {groupesAffiches.map(([cle, invitations]) => {
                    const chronologie = [...invitations].sort((a, b) =>
                      b.creeLe.localeCompare(a.creeLe),
                    );
                    const t = chronologie[0]!;
                    const ouvert = historiques.has(cle);
                    const occurrences = ouvert ? chronologie : [t];
                    const entreprises = [
                      ...new Set(occurrences.map((invitation) => invitation.entrepriseNom)),
                    ];
                    const emails = [
                      ...new Set(
                        occurrences.map((invitation) => invitation.contactEmail).filter(Boolean),
                      ),
                    ];
                    return (
                      <tr key={cle}>
                        <td>
                          <strong className="vma-contact-nom">
                            {t.prenom && <span>{t.prenom}</span>}
                            {t.prenom && t.nom && ' '}
                            {t.nom && <span>{t.nom}</span>}
                            {!t.prenom && !t.nom && 'Nom non renseigné'}
                          </strong>
                          <div className="small muted">
                            {t.contactPoste || t.contactLie?.fonction}
                          </div>
                        </td>
                        <td>{entreprises.join(' · ')}</td>
                        <td>
                          {emails.map((email) => (
                            <div key={email}>{email}</div>
                          ))}
                          <div>{t.contactTelephone || t.contactLie?.telephone}</div>
                        </td>
                        <td>
                          {occurrences.map((invitation) => {
                            const acces = accesTest?.(invitation);
                            return (
                              <div className="vma-contact-test" key={invitation.id}>
                                <span
                                  className={
                                    invitation.recueLe ? 'vma-statut vma-statut-recu' : 'vma-statut'
                                  }
                                >
                                  {invitation.statutAffiche}
                                </span>
                                <span className="small muted">
                                  {jour(
                                    invitation.recueLe || invitation.envoyeeLe || invitation.creeLe,
                                  )}
                                </span>
                                {entreprises.length > 1 && <span>{invitation.entrepriseNom}</span>}
                                {acces && (
                                  <button className="btn" type="button" onClick={acces.ouvrir}>
                                    {acces.archive ? 'Voir dans les archives' : 'Voir le test'}
                                  </button>
                                )}
                                {acces === null && (
                                  <span className="small muted">Test indisponible</span>
                                )}
                              </div>
                            );
                          })}
                          {invitations.length > 1 && (
                            <button
                              className="btn vma-occurrences"
                              type="button"
                              aria-expanded={ouvert}
                              onClick={() =>
                                setHistoriques((avant) => {
                                  const suivantes = new Set(avant);
                                  if (suivantes.has(cle)) suivantes.delete(cle);
                                  else suivantes.add(cle);
                                  return suivantes;
                                })
                              }
                            >
                              {ouvert
                                ? 'Masquer les occurrences'
                                : `Voir les ${invitations.length} occurrences`}
                            </button>
                          )}
                        </td>
                        <td>
                          {[
                            ...new Map(
                              occurrences.flatMap((invitation) =>
                                invitation.contactLie
                                  ? [[invitation.contactLie.id, invitation.contactLie] as const]
                                  : [],
                              ),
                            ).values(),
                          ].map((contact) => (
                            <a
                              className="btn vma-fiche-crm"
                              key={contact.id}
                              href={`#/${slug}/contacts/${contact.id}`}
                            >
                              Fiche CRM
                            </a>
                          ))}
                          {occurrences
                            .filter((invitation) => !invitation.contactLie)
                            .map((invitation) => (
                              <div key={invitation.id} className="vma-contact-test">
                                <button
                                  className="btn"
                                  type="button"
                                  onClick={() => setChoix(invitation)}
                                >
                                  Rattacher au CRM
                                </button>
                                {occurrences.length > 1 && (
                                  <span className="small muted">{jour(invitation.creeLe)}</span>
                                )}
                              </div>
                            ))}
                        </td>
                        <td className="vma-contact-retrait">
                          <button
                            className={voirRetires ? 'btn' : 'vma-contact-corbeille'}
                            type="button"
                            aria-label={voirRetires ? 'Réafficher la ligne' : 'Retirer la ligne'}
                            title={voirRetires ? 'Réafficher la ligne' : 'Retirer la ligne'}
                            onClick={() => basculerRetire(cle)}
                          >
                            {voirRetires ? 'Réafficher' : <Icon name="trash" />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!groupesAffiches.length && (
                    <tr>
                      <td colSpan={6}>Aucun contact ne correspond à ces critères.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      {supprimes.some((t) => !q || normaliser(`${t.nom ?? ''} ${t.entreprise}`).includes(q)) && (
        <details className="panel panel-b">
          <summary>Tests supprimés</summary>
          <ul>
            {supprimes
              .filter((t) => !q || normaliser(`${t.nom ?? ''} ${t.entreprise}`).includes(q))
              .map((t) => (
                <li key={t.id}>
                  {t.nom ? `${t.nom} · ` : ''}
                  {t.entreprise} · {jour(t.date)} · Supprimé
                </li>
              ))}
          </ul>
        </details>
      )}
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
        const correspondances = test.contactEmail
          ? c.filter(
              (contact) =>
                contact.email && normaliser(contact.email) === normaliser(test.contactEmail!),
            )
          : [];
        const contact = correspondances.length === 1 ? correspondances[0] : undefined;
        const organisations = e.filter(
          (organisation) => normaliser(organisation.nom) === normaliser(test.entrepriseNom),
        );
        setContactId(test.contactId ?? contact?.id ?? '');
        setEntrepriseId(
          test.entrepriseId ??
            contact?.entrepriseId ??
            (organisations.length === 1 ? organisations[0]!.id : ''),
        );
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
              onFermer();
            })
          }
        >
          Enregistrer le rattachement
        </button>
        {charge && !entrepriseId && (
          <details>
            <summary>Créer une organisation</summary>
            <div className="stack">
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
            </div>
          </details>
        )}
        {charge && !contactId && (
          <details>
            <summary>Créer un contact</summary>
            <div className="stack">
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
            </div>
          </details>
        )}
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
