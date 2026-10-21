import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import {
  changeOpportunite,
  createTache,
  creerMandatDepuisAffaire,
  fetchFiche,
  fetchInstances,
  lierMandat,
  noteFiche,
  patchFiche,
  updateTache,
  type Changement,
  type Evenement,
  type FicheDetail,
  type KindFiche,
} from '../api.js';
import { eur } from '../crm.js';
import type { InstanceSummary } from '../nav.js';
import { Icon } from '../icons.js';
import { ActionsFiche } from './liens/ActionsFiche.js';
import { CarteLiens, type LigneLien } from './liens/CarteLiens.js';
import { Cloture } from './Pipeline.js';
import { ACTIVITES } from './taches/commun.js';
import { EditionTache } from './taches/Edition.js';
import { estSimulation } from './Taches.js';

// Pipedrive-like detail page: summary and editable details on the left, note / activity composer
// and the record's timeline on the right; a deal adds its stage bar and Won / Lost buttons.

type Champ = {
  cle: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'email';
  affiche?: (v: unknown) => string;
};
const CHAMPS: Record<KindFiche, Champ[]> = {
  affaire: [
    { cle: 'titre', label: 'Titre' },
    { cle: 'montant', label: 'Valeur', type: 'number', affiche: (v) => (v ? eur(Number(v)) : '') },
    {
      cle: 'echeance',
      label: 'Date de clôture',
      type: 'date',
      affiche: (v) => (v ? new Date(`${enTexte(v)}T12:00:00`).toLocaleDateString('fr-FR') : ''),
    },
  ],
  contact: [
    { cle: 'nom', label: 'Nom' },
    { cle: 'fonction', label: 'Fonction' },
    { cle: 'email', label: 'Email', type: 'email' },
    { cle: 'telephone', label: 'Téléphone' },
  ],
  entreprise: [
    { cle: 'nom', label: 'Nom' },
    { cle: 'ville', label: 'Ville' },
    { cle: 'domaine', label: 'Domaine' },
    { cle: 'taille', label: 'Salariés', type: 'number' },
    { cle: 'secteur', label: 'Secteur' },
  ],
};
const EVENEMENTS: Record<Evenement['type'], [string, string]> = {
  note: ['edit', 'Note'],
  appel: ['phone', 'Appel'],
  email: ['send', 'Email'],
  reunion: ['users', 'Réunion'],
  activite: ['check', 'Activité faite'],
  etape: ['flag', 'Étape'],
};
const FILTRES: [string, string, Evenement['type'][]][] = [
  ['tout', 'Tout', []],
  ['notes', 'Notes', ['note']],
  ['activites', 'Activités', ['activite']],
  ['appels', 'Appels', ['appel']],
  ['emails', 'Emails', ['email']],
  ['reunions', 'Réunions', ['reunion']],
];
const dateHeure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
// Record fields come as unknown JSON: only strings and numbers are shown.
const enTexte = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const lien = (slug: string, kind: KindFiche, id: string) => `#/${slug}/fiche/${kind}/${id}`;

function ChampEditable({
  champ,
  valeur,
  modifiable,
  onSave,
}: {
  champ: Champ;
  valeur: unknown;
  modifiable: boolean;
  onSave: (v: string | number | null) => void;
}) {
  const [edition, setEdition] = useState(false);
  const [texte, setTexte] = useState('');
  const ouvrir = () => {
    setTexte(enTexte(valeur));
    setEdition(true);
  };
  const valider = () => {
    setEdition(false);
    const v = texte.trim();
    onSave(v === '' ? null : champ.type === 'number' ? Number(v) : v);
  };
  const touche = (e: KeyboardEvent) => {
    if (e.key === 'Enter') valider();
    if (e.key === 'Escape') setEdition(false);
  };
  return (
    <div className="fi-champ">
      <span className="muted small">{champ.label}</span>
      {edition ? (
        <input
          className="input"
          aria-label={champ.label}
          type={champ.type ?? 'text'}
          value={texte}
          autoFocus
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={touche}
          onBlur={valider}
        />
      ) : (
        <span className="fi-valeur">
          {(champ.affiche ? champ.affiche(valeur) : enTexte(valeur)) || (
            <span className="muted">—</span>
          )}
          {modifiable && (
            <button
              className="btn ghost sm"
              aria-label={`Modifier ${champ.label}`}
              onClick={ouvrir}
            >
              <Icon name="edit" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

// A deal of the own activity close to signature becomes a mandate (copy of the company and its
// contacts), or is linked to a mandate created before. Two clicks to create, as for a demo.
function Mandat({
  slug,
  id,
  mandat,
  onChange,
}: {
  slug: string;
  id: string;
  mandat: { slug: string; nom: string } | null;
  onChange: () => void;
}) {
  const [crm, setCrm] = useState<'hubspot' | 'aucun'>('hubspot');
  const [arme, setArme] = useState(false);
  const [mandats, setMandats] = useState<InstanceSummary[]>([]);
  const [cible, setCible] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (mandat) return;
    fetchInstances().then(
      (l) => setMandats(l.filter((i) => i.type === 'mandat')),
      () => setMandats([]),
    );
  }, [mandat]);
  const run = (action: () => Promise<unknown>, then: () => void) => {
    setBusy(true);
    setMessage(null);
    action()
      .then(then, (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy(false);
        setArme(false);
      });
  };
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Mandat</h2>
      </div>
      <div className="panel-b stack">
        {mandat ? (
          <p style={{ margin: 0 }}>
            Mandat : <a href={`#/${mandat.slug}/brief`}>{mandat.nom}</a>
          </p>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Signature proche ? Le mandat est créé en Closing avec une copie de l'entreprise et de
              ses contacts. Les devis restent ici.
            </p>
            <label className="field">
              <span>CRM du client</span>
              <select
                className="input"
                value={crm}
                onChange={(e) => setCrm(e.target.value as 'hubspot' | 'aucun')}
              >
                <option value="hubspot">HubSpot</option>
                <option value="aucun">Pas de CRM : l'OS tient le pipeline</option>
              </select>
            </label>
            <div>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  arme
                    ? run(
                        () =>
                          creerMandatDepuisAffaire(slug, id, crm === 'hubspot' ? 'hubspot' : null),
                        // The instance menu must list the new mandate, as after a demo conversion.
                        () => location.reload(),
                      )
                    : setArme(true)
                }
              >
                {arme ? 'Confirmer la création' : 'Créer le mandat'}
              </button>
            </div>
            {mandats.length > 0 && (
              <>
                <label className="field">
                  <span>Mandat existant</span>
                  <select
                    className="input"
                    aria-label="Mandat existant"
                    value={cible}
                    onChange={(e) => setCible(e.target.value)}
                  >
                    <option value="">Choisir…</option>
                    {mandats.map((m) => (
                      <option key={m.slug} value={m.slug}>
                        {m.nom}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <button
                    className="btn"
                    disabled={busy || !cible}
                    onClick={() => run(() => lierMandat(slug, id, cible), onChange)}
                  >
                    Lier à un mandat existant
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {message && <p className="small muted">{message}</p>}
      </div>
    </section>
  );
}

// Cards of the links a record shows. The primary link is only editable on the owning side: a deal
// owns its primary person and organisation, a person its primary organisation. A HubSpot record's
// primary link is chosen in HubSpot (the next sync would put it back).
function cartesDe(kind: KindFiche, liens: FicheDetail['liens'], hubspot: boolean): Carte[] {
  const principal = (l?: { id: string; nom: string } | null): LigneLien[] =>
    l ? [{ ...l, principal: true }] : [];
  const personnes = { titre: 'Personnes', kind: 'contact' as const };
  const organisations = { titre: 'Organisations', kind: 'entreprise' as const };
  const affaires: Carte = {
    titre: 'Affaires',
    kind: 'affaire',
    principalGerable: false,
    lignes: (liens.affaires ?? []).map((o) => ({
      id: o.id,
      nom: o.titre,
      principal: o.principal ?? false,
      detail:
        `${o.clos ? (o.clos === 'gagne' ? '· Gagnée' : '· Perdue') : ''}${o.montant ? ` · ${eur(o.montant)}` : ''}`.trim(),
    })),
  };
  if (kind === 'affaire')
    return [
      {
        ...personnes,
        principalGerable: !hubspot,
        lignes: liens.contacts ?? principal(liens.contact),
      },
      {
        ...organisations,
        principalGerable: !hubspot,
        lignes: liens.entreprises ?? principal(liens.entreprise),
      },
    ];
  if (kind === 'contact')
    return [
      {
        ...organisations,
        principalGerable: !hubspot,
        lignes: liens.entreprises ?? principal(liens.entreprise),
      },
      affaires,
    ];
  return [{ ...personnes, principalGerable: false, lignes: liens.contacts ?? [] }, affaires];
}

type Carte = {
  titre: string;
  kind: KindFiche;
  principalGerable: boolean;
  lignes: LigneLien[];
};

export function Fiche({ slug, kind, id }: { slug: string; kind: KindFiche; id: string }) {
  const [data, setData] = useState<FicheDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<'note' | 'activite'>('note');
  const [note, setNote] = useState('');
  const [versHubspot, setVersHubspot] = useState(true);
  const [filtre, setFiltre] = useState('tout');
  const [cloture, setCloture] = useState<'gagne' | 'perdu' | null>(null);
  const [planifier, setPlanifier] = useState(false);

  const load = useCallback(() => {
    fetchFiche(slug, kind, id).then(setData, (e: unknown) =>
      setMessage(e instanceof Error ? e.message : String(e)),
    );
  }, [slug, kind, id]);
  useEffect(load, [load]);

  const erreur = (e: unknown) => setMessage(e instanceof Error ? e.message : String(e));
  const apres = (r: unknown) => {
    setMessage(estSimulation(r) ? r.message : null);
    if (!estSimulation(r) && r && typeof r === 'object' && 'fiche' in r) setData(r as FicheDetail);
    else load();
  };
  const modifier = (patch: Record<string, unknown>) =>
    void patchFiche(slug, kind, id, patch).then(apres, erreur);
  const changer = (c: Changement) =>
    void changeOpportunite(slug, id, c).then((r) => {
      setMessage(r.simulation ? 'Simulation : rien n’a été écrit dans HubSpot.' : null);
      load();
    }, erreur);

  if (!data) return message ? <div className="empty">{message}</div> : null;
  const f = data.fiche;
  const cartes = cartesDe(kind, data.liens, f.origine === 'hubspot');
  const hubspot = f.origine === 'hubspot';
  const titre = enTexte(f.titre) || enTexte(f.nom);
  const shown = data.historique.filter((e) => {
    const types = FILTRES.find(([k]) => k === filtre)?.[2] ?? [];
    return types.length === 0 || types.includes(e.type);
  });
  const etapeCourante = data.etapes?.find((e) => e.id === f.etape);

  return (
    <>
      <div className="fi-entete">
        <div>
          <a className="small" href="#" onClick={(e) => (e.preventDefault(), history.back())}>
            ‹ Retour
          </a>
          <h1>{titre}</h1>
          <div className="small muted fi-sous">
            {kind === 'affaire' && f.montant ? (
              <b className="num">{eur(Number(f.montant))}</b>
            ) : null}
            {data.liens.entreprise && (
              <a href={lien(slug, 'entreprise', data.liens.entreprise.id)}>
                {data.liens.entreprise.nom}
              </a>
            )}
            {data.liens.contact && (
              <a href={lien(slug, 'contact', data.liens.contact.id)}>{data.liens.contact.nom}</a>
            )}
            <span className={`badge ${hubspot ? 'blue' : ''}`}>{hubspot ? 'HubSpot' : 'OS'}</span>
          </div>
        </div>
        <ActionsFiche
          slug={slug}
          kind={kind}
          id={id}
          titre={titre}
          onMessage={setMessage}
          onChange={load}
        />
        {kind === 'affaire' &&
          (f.clos ? (
            <span className={`badge ${f.clos === 'gagne' ? 'green' : 'red'}`}>
              {f.clos === 'gagne' ? 'Gagnée' : 'Perdue'}
            </span>
          ) : (
            data.ecrit && (
              <div className="decision">
                <button className="btn fi-gagne" onClick={() => setCloture('gagne')}>
                  Gagnée
                </button>
                <button className="btn fi-perdu" onClick={() => setCloture('perdu')}>
                  Perdue
                </button>
              </div>
            )
          ))}
      </div>
      {data.etapes && !f.clos && (
        <div className="fi-etapes">
          {data.etapes.map((e) => (
            <button
              key={e.id}
              className={`fi-etape ${e.id === f.etape ? 'on' : ''} ${e.jours !== null ? 'passee' : ''}`}
              aria-label={`Passer à l'étape ${e.label}`}
              title={e.label}
              disabled={!data.ecrit || e.id === f.etape}
              onClick={() => changer({ etape: e.id })}
            >
              <span>{e.label}</span>
              {e.jours !== null && <small>{e.jours} j</small>}
            </button>
          ))}
        </div>
      )}
      {message && (
        <div className="alert amber" style={{ marginBottom: 12 }}>
          <div>{message}</div>
        </div>
      )}
      <div className="fi-corps">
        <div className="fi-gauche">
          {kind === 'affaire' && (
            <section className="panel">
              <div className="panel-h">
                <h2>Résumé</h2>
              </div>
              <div className="panel-b">
                <div className="fi-champ">
                  <span className="muted small">Étape</span>
                  <span>{etapeCourante?.label ?? enTexte(f.etape)}</span>
                </div>
                {etapeCourante?.probabilite != null && (
                  <div className="fi-champ">
                    <span className="muted small">Probabilité</span>
                    <span>{etapeCourante.probabilite} %</span>
                  </div>
                )}
                {typeof f.prochaineEtape === 'string' && f.prochaineEtape && (
                  <div className="fi-champ">
                    <span className="muted small">Prochaine étape</span>
                    <span>{f.prochaineEtape}</span>
                  </div>
                )}
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-h">
              <h2>Détails</h2>
            </div>
            <div className="panel-b">
              {CHAMPS[kind]
                .filter(
                  (c) => !(kind === 'entreprise' && c.cle === 'secteur' && hubspot) || f[c.cle],
                )
                .map((c) => (
                  <ChampEditable
                    key={c.cle}
                    champ={c}
                    valeur={f[c.cle]}
                    modifiable={
                      data.ecrit && !(kind === 'entreprise' && c.cle === 'secteur' && hubspot)
                    }
                    onSave={(v) => v !== (f[c.cle] ?? null) && modifier({ [c.cle]: v })}
                  />
                ))}
            </div>
          </section>
          {kind === 'affaire' && data.mandat !== undefined && (
            <Mandat slug={slug} id={id} mandat={data.mandat} onChange={load} />
          )}
          {cartes.map((c) => (
            <CarteLiens
              key={c.titre}
              slug={slug}
              titre={c.titre}
              kind={c.kind}
              de={{ kind, id }}
              lignes={c.lignes}
              ecrit={data.ecrit}
              principalGerable={c.principalGerable}
              onChange={load}
              onMessage={setMessage}
            />
          ))}
        </div>
        <div className="fi-droite">
          <section className="panel">
            <div className="seg fi-onglets">
              <button className={onglet === 'note' ? 'on' : ''} onClick={() => setOnglet('note')}>
                Note
              </button>
              <button
                className={onglet === 'activite' ? 'on' : ''}
                onClick={() => setOnglet('activite')}
              >
                Activité
              </button>
            </div>
            <div className="panel-b">
              {onglet === 'note' ? (
                <>
                  <textarea
                    className="input"
                    rows={3}
                    aria-label="Note"
                    placeholder="Prenez des notes sur cette fiche…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="decision">
                    {hubspot && data.ecrit && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={versHubspot}
                          onChange={(e) => setVersHubspot(e.target.checked)}
                        />
                        <span>Aussi dans HubSpot</span>
                      </label>
                    )}
                    <button
                      className="btn primary"
                      disabled={!note.trim()}
                      onClick={() =>
                        void noteFiche(slug, kind, id, {
                          corps: note,
                          hubspot: hubspot && data.ecrit && versHubspot,
                        }).then((r) => {
                          if (!estSimulation(r)) setNote('');
                          apres(r);
                        }, erreur)
                      }
                    >
                      Enregistrer la note
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn primary" onClick={() => setPlanifier(true)}>
                  Planifier une activité
                </button>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>À venir</h2>
            </div>
            <ul className="panel-b fi-liste">
              {data.aVenir.length === 0 && <li className="muted small">Aucune activité prévue.</li>}
              {data.aVenir.map((t) => (
                <li key={t.id} className="fi-avenir">
                  <input
                    type="checkbox"
                    aria-label={`Marquer faite : ${t.titre}`}
                    onChange={() =>
                      void updateTache(slug, t.id, { fait: true }).then(apres, erreur)
                    }
                  />
                  <Icon name={ACTIVITES[t.type][0]} />
                  <span>{t.titre}</span>
                  <span className="small muted">{t.echeance ? dateHeure(t.echeance) : ''}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Historique</h2>
            </div>
            <div className="vq-filter">
              {FILTRES.map(([k, l]) => (
                <button
                  key={k}
                  className={`chip ${filtre === k ? 'on' : ''}`}
                  onClick={() => setFiltre(k)}
                >
                  {l}
                </button>
              ))}
            </div>
            <ul className="panel-b fi-histo">
              {shown.length === 0 && <li className="muted small">Rien pour ce filtre.</li>}
              {shown.map((e) => {
                const [ico, lbl] = EVENEMENTS[e.type];
                return (
                  <li key={e.id} className={`fi-evt ${e.type}`}>
                    <span className="fi-ico" title={lbl}>
                      <Icon name={ico} />
                    </span>
                    <div>
                      <div className="small muted">
                        {lbl} · {dateHeure(e.at)}
                        {e.origine === 'hubspot' ? ' · HubSpot' : ''}
                      </div>
                      {e.titre && <b>{e.type === 'etape' ? `Étape : ${e.titre}` : e.titre}</b>}
                      {e.texte && <p>{e.texte}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
      {cloture && (
        <Cloture
          o={{ entreprise: data.liens.entreprise?.nom ?? null, titre }}
          resultat={cloture}
          onClose={() => setCloture(null)}
          onDone={(c) => {
            setCloture(null);
            changer(c);
          }}
        />
      )}
      {planifier && (
        <EditionTache
          tache={null}
          hubspot={hubspot && data.ecrit}
          onClose={() => setPlanifier(false)}
          onSave={async ({ hubspot: versHs, ...saisie }) => {
            const r = await createTache(slug, {
              ...saisie,
              hubspot: versHs,
              contactId:
                kind === 'contact'
                  ? id
                  : kind === 'affaire'
                    ? (data.liens.contact?.id ?? null)
                    : null,
              opportuniteId: kind === 'affaire' ? id : null,
            });
            setPlanifier(false);
            apres(r);
          }}
        />
      )}
    </>
  );
}
