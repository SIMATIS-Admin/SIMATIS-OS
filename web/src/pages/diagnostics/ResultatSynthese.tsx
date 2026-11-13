import type { FreinSyntheseVma, ReponsesVma, TestVma } from '../../api.js';
import { fmtEur } from '../TestsVma.js';

// Méthode 3.3 : à gauche, le résultat tel que le dirigeant l'a reçu (trois questions, mêmes phrases que la page et le
// mail) ; à droite, de quoi préparer l'échange (points à vérifier, questions à poser, pratiques, chiffres saisis).
// La colonne de droite reste dans l'OS : elle n'est jamais exportée en PDF.

const NB = ' ';
const pct = (x: number) =>
  `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}${NB}%`;
const ans = (n: number) => (n < 1 ? `${Math.round(n * 12)} mois` : `${n} ${n < 2 ? 'an' : 'ans'}`);
const entier = (v: number) => Math.round(v).toLocaleString('fr-FR');

type Resultat = NonNullable<TestVma['resultat']>;
type Alerte = NonNullable<Resultat['alertes']>[number];
const num = (a: Alerte, k: string) => (typeof a[k] === 'number' ? a[k] : 0);

export const montantFrein = (f: FreinSyntheseVma) => {
  if (!(typeof f.enjeu === 'number' && f.enjeu > 0)) return '';
  if (f.nature === 'securise') return `${fmtEur(f.enjeu)} à sécuriser`;
  return `+${fmtEur(f.enjeu)}${f.nature === 'perteEvitee' ? ' préservés' : ''}`;
};

// Questions à poser pendant l'échange : tirées des points à vérifier, puis des revenus et du premier frein.
export function questionsEchange(e: Resultat, r: ReponsesVma | null | undefined): string[] {
  const qs: string[] = [];
  const P = r?.periode ?? e.periode ?? 3;
  const cm = e.caMensuel;
  for (const a of e.alertes ?? []) {
    if (a.code === 'devis-unitaire')
      qs.push(`Sur les ${P} derniers mois, combien de devis ponctuels, pour quel montant total ?`);
    if (a.code === 'coherence-ca' && cm && r?.ambition?.caActuel)
      qs.push(
        `Votre chiffre d’affaires des 12 derniers mois : plutôt ${fmtEur(r.ambition.caActuel)} ou ${fmtEur(cm.total * 12)} ?`,
      );
    if (a.code === 'dernier-mois')
      qs.push(
        `Vos clients réguliers sans contrat : ${fmtEur(num(a, 'valeur'))} par mois, ou sur ${P} mois ?`,
      );
    if (a.code === 'taux')
      qs.push(
        `Votre taux de signature habituel, en nombre de devis : ${pct(num(a, 'habituel'))}, vraiment ?`,
      );
    if (a.code === 'objectif-inferieur' && e.objectif)
      qs.push(
        `Votre objectif de ${fmtEur(e.objectif.caMensuel * 12)} par an : un plancher, ou votre vraie ambition ?`,
      );
    if (a.code === 'repartition')
      qs.push(
        `${pct(num(a, 'visee'))} de revenus sous contrat d’ici ${ans(e.echeance)} : pourquoi, et pour quels clients ?`,
      );
  }
  if (cm && cm.engage > 0)
    qs.push(
      `Vos ${fmtEur(cm.engage)} par mois sous contrat : combien de clients, quelles échéances ?`,
    );
  const action = e.synthese?.action;
  if (action)
    qs.push(
      `${action.label} : qu’est-ce qui vous a empêché de le faire systématiquement jusqu’ici ?`,
    );
  return qs;
}

function Verdict({ e }: { e: Resultat }) {
  const v = e.synthese!.verdict;
  const alerte = v.cle === 'suspendu' || v.cle === 'objectif-bas';
  return (
    <div className={`rs-verdict${alerte ? ' alerte' : ''}`}>
      <strong>{v.titre}</strong>
      {v.phrase && <p>{v.phrase}</p>}
      {v.points.length > 0 && (
        <ul>
          {v.points.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {v.remarques.map((x) => (
        <p key={x}>{x}</p>
      ))}
    </div>
  );
}

// Ce que le dirigeant a reçu : les trois questions.
export function TroisQuestions({ e }: { e: Resultat }) {
  const s = e.synthese!;
  const cm = e.caMensuel!;
  const cles =
    e.parcours === 'lancement'
      ? (['regulier', 'ponctuel'] as const)
      : (['engage', 'regulier', 'ponctuel'] as const);
  const part = (x: number) => (cm.total > 0 ? x / cm.total : 0);
  const objectif = e.objectif?.caMensuel ?? e.allureVisee;
  const echelle = Math.max(cm.total, objectif) || 1;
  const max = Math.max(1, ...s.freins.map((f) => f.enjeu ?? 0));
  return (
    <div className="rs-questions">
      <section>
        <div className="rs-q">1 · {s.questions[0]}</div>
        <Verdict e={e} />
        <div className="rs-grand">{fmtEur(cm.total)}</div>
        <div className="muted">
          de chiffre d’affaires par mois, en moyenne sur {e.periode ?? 3} mois
        </div>
        <div
          className="rs-repart"
          role="img"
          aria-label={cles.map((k) => `${s.libelles[k] ?? k} ${fmtEur(cm[k])}`).join(', ')}
        >
          {cles.map((k) => (
            <span key={k} className={`rs-${k}`} style={{ width: `${part(cm[k]) * 100}%` }} />
          ))}
        </div>
        <div className="rs-legende">
          {cles.map((k) => (
            <div key={k}>
              <i className={`rs-${k}`} />
              <span>
                {s.libelles[k] ?? k}
                {k === 'ponctuel' && s.vmaLigne && <span className="muted"> ({s.vmaLigne})</span>}
              </span>
              <strong>
                {fmtEur(cm[k])} · {pct(part(cm[k]))}
              </strong>
            </div>
          ))}
        </div>
        <div className="rs-compare">
          <div>
            <span>Aujourd’hui</span>
            <strong>{fmtEur(cm.total)}</strong>
          </div>
          <span className="rs-b" style={{ width: `${(cm.total / echelle) * 100}%` }} />
          <div>
            <span>Objectif à {ans(e.echeance)}</span>
            <strong>{fmtEur(objectif)}</strong>
          </div>
          <span className="rs-b obj" style={{ width: `${(objectif / echelle) * 100}%` }} />
        </div>
      </section>

      <section>
        <div className="rs-q">2 · {s.questions[1]}</div>
        <p className="rs-titre">{s.pratiques.titre}</p>
        {s.pratiques.forces.length > 0 && (
          <div className="rs-forces">
            {s.pratiques.forces.map((x) => (
              <span key={x}>✓ {x}</span>
            ))}
          </div>
        )}
        <p>{s.texteFreins}</p>
        <div className="rs-leviers">
          {s.freins.map((f) => (
            <div key={f.k}>
              <div className="l">
                <span>{f.label}</span>
                <span className="m">{montantFrein(f)}</span>
              </div>
              <span
                className={`j${f.nature === 'securise' ? ' sec' : ''}`}
                style={{
                  width: `${f.enjeu && f.enjeu > 0 ? Math.max(4, (f.enjeu / max) * 100) : 0}%`,
                }}
              />
              <div className="small muted">{f.hypothese}</div>
            </div>
          ))}
        </div>
        {s.texteAutres && <p className="small muted">{s.texteAutres}</p>}
        {s.gainMensuel > 0 && <p className="small muted">{s.noteMontants}</p>}
      </section>

      {s.action && (
        <section>
          <div className="rs-q">3 · {s.questions[2]}</div>
          <div className="rs-action">
            <strong>{s.action.label}</strong>
            <p>{s.action.sous}</p>
            <ol>
              {s.action.debut.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {[...s.freins, ...s.autres].length > 0 && (
        <details className="rs-detail">
          <summary>Plans d’action de chaque frein</summary>
          {[...s.freins, ...s.autres].map((f) => (
            <div key={f.k} className="rs-plan">
              <strong>{f.titre}</strong>{' '}
              {montantFrein(f) && <span className="m">{montantFrein(f)}</span>}
              {f.reponse && (
                <div className="small">
                  Réponse : « {f.reponse} »
                  {f.cible && f.cible !== f.reponse ? ` · les plus avancés : « ${f.cible} »` : ''}
                </div>
              )}
              {f.debut && f.debut.length > 0 && (
                <ul className="small">
                  {f.debut.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
              {f.signe && <div className="small muted">Signe que c’est en place : {f.signe}</div>}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

const LIBELLES_CHIFFRES: [string, string][] = [
  ['regulier', 'Clients réguliers, sans contrat (sur la période)'],
  ['regulierDernier', 'dont le dernier mois'],
  ['engageMin', 'Sous contrat (minimum mensuel)'],
  ['engageDuree', 'durée restante (mois)'],
  ['engageReconduit', 'part reconduite (%)'],
  ['ponctuel', 'Prestations ponctuelles (sur la période)'],
  ['devisNb', 'Devis envoyés (nombre)'],
  ['devisMontant', 'Montant des devis'],
  ['cmdNb', 'Commandes (nombre)'],
  ['cmdMontant', 'Montant des commandes'],
  ['taux', 'Taux de signature habituel (%)'],
];
const SANS_EUROS = new Set(['devisNb', 'cmdNb', 'engageDuree', 'engageReconduit', 'taux']);
// Champs signalés par une alerte : surlignés dans le tableau des chiffres saisis.
const SUSPECTS: Record<string, string[]> = {
  'devis-unitaire': ['devisNb', 'devisMontant'],
  'dernier-mois': ['regulier', 'regulierDernier'],
  taux: ['taux', 'cmdMontant'],
};

// Pour Marc : préparer l'échange.
export function PreparerEchange({ test }: { test: TestVma }) {
  const e = test.resultat!;
  const r = test.reponses;
  const s = e.synthese!;
  const v = s.verdict;
  const qs = questionsEchange(e, r);
  const suspects = new Set((e.alertes ?? []).flatMap((a) => SUSPECTS[a.code] ?? []));
  const caSuspect = (e.alertes ?? []).some((a) => a.code === 'coherence-ca');
  const pratiques = (test.calcul?.freins ?? []).slice().sort((a, b) => a.n - b.n);
  const regularite = r?.freins?.regularite;
  const ecartees = r?.freinsEcartes?.length ?? 0;
  const ch = r?.chiffres ?? {};
  const est = r?.estimes ?? {};
  const Points = ({ note }: { note: number }) => (
    <span className={`rs-points${note < 4 ? ' frein' : ''}`} aria-label={`${note} sur 4`}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= note ? 'on' : ''} />
      ))}
    </span>
  );
  return (
    <div className="rs-marc">
      <div className="panel">
        <div className="panel-h">
          <span className="rs-q">À vérifier avec le dirigeant</span>
          <span className="small muted">
            {v.points.length} + {v.remarques.length}
          </span>
        </div>
        <div className="panel-b">
          {v.points.length + v.remarques.length === 0 ? (
            <p className="small muted">Aucune incohérence relevée dans les chiffres.</p>
          ) : (
            <ul className="rs-alertes">
              {v.points.map((x) => (
                <li key={x} className="fort">
                  {x}
                </li>
              ))}
              {v.remarques.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {qs.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <span className="rs-q">Questions pour l’échange</span>
          </div>
          <div className="panel-b">
            <ul className="rs-qs">
              {qs.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {pratiques.length > 0 && (
        <div className="panel">
          <div className="panel-h">
            <span className="rs-q">Ses pratiques</span>
            <span className="small muted">sur 4</span>
          </div>
          <div className="panel-b rs-pratiques">
            {pratiques.map((f) => (
              <div key={f.n}>
                <span>{f.label}</span>
                <Points note={f.note} />
              </div>
            ))}
            {typeof regularite === 'number' && (
              <div>
                <span>Régularité de l’activité</span>
                <Points note={regularite} />
              </div>
            )}
            {ecartees > 0 && (
              <p className="small muted">
                {ecartees} question{ecartees > 1 ? 's' : ''} écartée{ecartees > 1 ? 's' : ''} (« ne
                s’applique pas »).
              </p>
            )}
          </div>
        </div>
      )}

      {r?.chiffres && (
        <div className="panel">
          <div className="panel-h">
            <span className="rs-q">Ses chiffres saisis</span>
            <span className="small muted">sur {r.periode ?? 3} mois</span>
          </div>
          <div className="panel-b">
            <table className="rs-saisie">
              <tbody>
                {LIBELLES_CHIFFRES.filter(([k]) => typeof ch[k] === 'number').map(([k, lib]) => (
                  <tr key={k} className={suspects.has(k) ? 'ko' : ''}>
                    <td>
                      {lib}
                      {est[k] && <span className="rs-tag">estimé</span>}
                    </td>
                    <td>{SANS_EUROS.has(k) ? entier(ch[k]!) : `${entier(ch[k]!)} €`}</td>
                  </tr>
                ))}
                {typeof r.ambition?.caActuel === 'number' && (
                  <tr className={caSuspect ? 'ko' : ''}>
                    <td>CA des 12 derniers mois</td>
                    <td>{entier(r.ambition.caActuel)} €</td>
                  </tr>
                )}
                {typeof r.ambition?.caVise === 'number' && (
                  <tr>
                    <td>Objectif à {ans(r.ambition.echeance ?? e.echeance)}</td>
                    <td>{entier(r.ambition.caVise)} €</td>
                  </tr>
                )}
              </tbody>
            </table>
            {(r.ecartes ?? []).length > 0 && (
              <p className="small muted">Blocs écartés : {r.ecartes!.length}.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// La page complète, en deux colonnes.
export function ResultatSynthese({ test }: { test: TestVma }) {
  const e = test.resultat;
  if (!e?.synthese || !e.caMensuel) return null;
  return (
    <div className="rs-grille">
      <div className="panel">
        <div className="panel-h">
          <span className="rs-q rs-gris">Le résultat reçu par le dirigeant</span>
          <span className="small muted">identique au mail</span>
        </div>
        <div className="panel-b">
          <TroisQuestions e={e} />
        </div>
      </div>
      <div data-pdf-exclude>
        <PreparerEchange test={test} />
      </div>
    </div>
  );
}
