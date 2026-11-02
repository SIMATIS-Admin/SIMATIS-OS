import type { FreinVma, TestVma } from '../../api.js';
import { fmtEur } from '../TestsVma.js';

const NB = ' ';
const pct = (x: number) =>
  `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}${NB}%`;
const ans = (n: number) => (n < 1 ? `${Math.round(n * 12)} mois` : `${n} ${n < 2 ? 'an' : 'ans'}`);

type Resultat = NonNullable<TestVma['resultat']>;

// Les libellés tels que le site les a envoyés avec le résultat (textes simples, et trois tables).
export type TextesV3 = {
  libelleCaMensuel?: string;
  libelleVmaPrev?: string;
  definitionVma?: string;
  nonMesurable?: string;
  aucunFrein?: string;
  noteEnjeu?: string;
  titreConquete?: string;
  titrePortefeuille?: string;
  libelleReponse?: string;
  libelleCible?: string;
  libelleDebut?: string;
  libelleSigne?: string;
  libellesRevenus?: Record<string, string>;
  natures?: Record<string, string>;
  conclusions?: {
    titreCa: string;
    titreComposition: string;
    ca: Record<string, string>;
    composition: Record<string, string>;
  };
};
export const textesV3 = (textes: unknown) => (textes ?? {}) as TextesV3;

// Les freins d'une liste, avec la nature de leur enjeu : en euros pour les prestations ponctuelles, non chiffré
// pour les clients réguliers et les contrats (aucun coefficient n'est avancé).
export function ListeFreinsV3({
  liste,
  t,
  note,
}: {
  liste: FreinVma[];
  t: TextesV3;
  note?: boolean;
}) {
  const natures = t.natures ?? {};
  const texte = (
    k: 'libelleReponse' | 'libelleCible' | 'libelleDebut' | 'libelleSigne',
    defaut: string,
  ) => t[k] ?? defaut;
  return (
    <>
      <ol className="rc-freins">
        {liste.map((f, i) => {
          const nature = natures[f.nature ?? 'gain'] ?? '';
          return (
            <li key={f.n}>
              <span className="rang">{i + 1}</span>
              <span className="corps">
                <span className="ft">{f.titre}</span>
                <span className="enjeu">
                  {typeof f.enjeu === 'number' && f.enjeu > 0
                    ? `${nature} estimé : environ +${fmtEur(f.enjeu)} par mois*`
                    : `${nature} · ${(natures.nonChiffre ?? 'enjeu non chiffré').toLowerCase()}`}
                </span>
                <span>{f.phrase}</span>
                {f.reponse && (
                  <span className="fd">
                    <strong>{texte('libelleReponse', 'Votre réponse')} : </strong>« {f.reponse} »
                  </span>
                )}
                {f.cible && f.cible !== f.reponse && (
                  <span className="fd">
                    <strong>{texte('libelleCible', 'Les plus avancés')} : </strong>« {f.cible} »
                  </span>
                )}
                {f.debut && f.debut.length > 0 && (
                  <>
                    <strong className="fd">{texte('libelleDebut', 'Par où commencer')}</strong>
                    <ul>
                      {f.debut.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {f.signe && (
                  <span className="fd">
                    <strong>{texte('libelleSigne', 'Signe que c’est en place')} : </strong>
                    {f.signe}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {note && t.noteEnjeu && <p className="small muted">* {t.noteEnjeu}</p>}
    </>
  );
}

// Méthode 3.0, tel que le dirigeant l'a lu : le CA mensuel et ses trois catégories, la VMA des seules prestations
// ponctuelles, deux conclusions distinctes (CA couvert ? part sous engagement atteinte ?), puis les freins.
export function CorpsV3({ e }: { e: Resultat }) {
  const t = textesV3(e.textes);
  const lib = t.libellesRevenus ?? {};
  const conclusions = t.conclusions;
  const cm = e.caMensuel!;
  const o = e.objectif;
  const pr = e.projection;
  const c = e.conclusionCa;
  const comp = e.composition;
  const previsionnel = e.previsionnel === true;
  const avecRec = typeof pr?.caAvecReconduction === 'number';
  const pastille =
    e.pastille === 'prévisionnelle'
      ? (['warn', 'Chiffres prévisionnels'] as const)
      : e.pastille === 'estimés'
        ? (['warn', 'Chiffres en partie estimés'] as const)
        : e.pastille === 'non mesurable'
          ? (['risk', 'Non mesurable'] as const)
          : (['ok', 'Chiffres réels'] as const);
  const categories = (['regulier', 'engage', 'ponctuel'] as const).map((k) => (
    <p key={k}>
      {lib[k] ?? k} : {fmtEur(cm[k])} par mois{cm.total > 0 ? ` (${pct(cm[k] / cm.total)})` : ''}
    </p>
  ));
  const portefeuille = e.freinsPortefeuille ?? [];
  const avecEnjeu = [...e.freins, ...portefeuille].some(
    (f) => typeof f.enjeu === 'number' && f.enjeu > 0,
  );
  return (
    <>
      <div className="panel rc-carte">
        <div className="rc-eyebrow">{t.libelleCaMensuel ?? 'Votre chiffre d’affaires mensuel'}</div>
        <div className="rc-grand">
          {fmtEur(cm.total)}
          <small>
            {' '}
            de chiffre d’affaires par mois, soit {fmtEur(cm.total * 12)} par an, en moyenne sur{' '}
            {e.periode ?? 3} mois
          </small>
        </div>
        {categories}
        <div className="rc-chips">
          <span className={`rc-chip ${pastille[0]}`}>{pastille[1]}</span>
          <span className={`rc-chip ${e.tenue === 'tenue' ? 'ok' : 'warn'}`}>
            {e.tenue === 'tenue' ? 'Activité régulière' : 'Activité par vagues'}
          </span>
        </div>
      </div>

      <div className="panel rc-carte">
        <div className="rc-eyebrow">
          {previsionnel
            ? (t.libelleVmaPrev ?? 'Votre VMA prévisionnelle')
            : 'Votre VMA commerciale'}
        </div>
        <div className="rc-grand">
          {e.mesurable && e.vma !== null ? fmtEur(e.vma) : '—'}
          <small> de CA commandé par mois sur vos prestations ponctuelles</small>
        </div>
        <p className="small muted">
          {e.mesurable ? (t.definitionVma ?? '') : (t.nonMesurable ?? '')}
        </p>
        {typeof e.tauxObserve === 'number' && (
          <p className="small muted">
            Sur la période, les commandes représentent {pct(e.tauxObserve)} du montant des devis :
            un rapport de montants, pas le taux de signature habituel (en nombre de devis).
          </p>
        )}
      </div>

      <div className="panel rc-carte">
        <div className="rc-eyebrow">Votre objectif</div>
        <p>
          <strong>{e.niveau.label}</strong>
          {' · '}
          {fmtEur(o?.caMensuel ?? e.allureVisee)} par mois dans {ans(e.echeance)}, soit{' '}
          {fmtEur((o?.caMensuel ?? e.allureVisee) * 12)} par an
        </p>
        {pr && (
          <p>
            Sur sa lancée dans {ans(e.echeance)} : {fmtEur(pr.ca)} par mois
            {avecRec
              ? ` sans reconduction, ${fmtEur(pr.caAvecReconduction)} avec la reconduction indiquée`
              : ''}
            {pr.echu > 0
              ? `. ${fmtEur(pr.echu)} par mois d’engagements arrivent à terme avant l’échéance.`
              : '.'}
          </p>
        )}
        {conclusions && c && (
          <p>
            <strong>{conclusions.titreCa}</strong> {conclusions.ca[c.statut]}
            {c.statut !== 'a-confirmer' && c.ecart > 0
              ? ` Sans reconduction, il manquera ${fmtEur(c.ecart)} par mois à l’échéance.`
              : ''}
            {c.manque.length > 0 ? ` Ce qui manque pour conclure : ${c.manque.join(', ')}.` : ''}
          </p>
        )}
        {conclusions && comp && comp.statut !== 'non-demande' && (
          <p>
            <strong>{conclusions.titreComposition}</strong> {conclusions.composition[comp.statut]}
            {pr
              ? ` Part visée : ${pct(comp.partVisee ?? 0)}, soit ${fmtEur(comp.cible ?? 0)} par mois sous engagement (aujourd’hui ${pct(comp.partActuelle ?? 0)}) ; estimé à l’échéance : ${fmtEur(pr.engage)} par mois.`
              : ''}
          </p>
        )}
        <p>{e.niveau.phrase}</p>
      </div>

      {(e.mesurable || e.freins.length > 0) && (
        <div className="panel rc-carte">
          <div className="rc-eyebrow">
            Vos freins : {(t.titreConquete ?? 'Prestations ponctuelles').toLowerCase()}
          </div>
          {e.freins.length ? (
            <ListeFreinsV3 liste={e.freins} t={t} />
          ) : (
            <p>{t.aucunFrein ?? 'Aucun frein marqué.'}</p>
          )}
        </div>
      )}
      {(cm.regulier + cm.engage > 0 || portefeuille.length > 0) && (
        <div className="panel rc-carte">
          <div className="rc-eyebrow">
            Vos freins : {(t.titrePortefeuille ?? 'Clients réguliers et contrats').toLowerCase()}
          </div>
          {portefeuille.length ? (
            <ListeFreinsV3 liste={portefeuille} t={t} note={avecEnjeu} />
          ) : (
            <p>{t.aucunFrein ?? 'Aucun frein marqué.'}</p>
          )}
        </div>
      )}
      {avecEnjeu && portefeuille.length === 0 && t.noteEnjeu && (
        <p className="small muted">* {t.noteEnjeu}</p>
      )}
    </>
  );
}
