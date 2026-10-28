import type { FreinVma, TestVma } from '../../api.js';
import { fmtEur } from '../TestsVma.js';

const NB = ' ';
const pct = (x: number) =>
  `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}${NB}%`;
const ans = (n: number) => (n < 1 ? `${Math.round(n * 12)} mois` : `${n} ${n < 2 ? 'an' : 'ans'}`);

// Reproduit l'écran « Votre résultat » du site, tel que le dirigeant l'a lu : mêmes textes, mêmes
// chiffres, rien du calcul réservé à Marc (potentiel, gains, blocs).
export function ResultatComplet({ test, onRetour }: { test: TestVma; onRetour: () => void }) {
  const e = test.resultat;
  if (!e) return null;
  const t = e.textes ?? {};
  const socle = e.recurrent !== null && e.recurrent !== undefined;
  const allure = e.allureActuelle ?? 0;
  const lancee = socle && typeof e.trajectoire === 'number';
  const previsionnel = e.previsionnel === true;
  const pastille =
    e.pastille === 'prévisionnelle'
      ? (['warn', t.pastillePrev ?? 'Chiffres prévisionnels'] as const)
      : e.pastille === 'estimés'
        ? (['warn', 'Chiffres en partie estimés'] as const)
        : e.pastille === 'non mesurable'
          ? (['risk', 'Non mesurable'] as const)
          : (['ok', 'Chiffres réels'] as const);

  const echelle =
    Math.max(allure, e.allureVisee, lancee ? (e.trajectoire as number) : 0) * 1.15 || 1;
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / echelle) * 100)).toFixed(1)}%`;
  const rec = socle ? (e.recurrent as number) : 0;
  const ecart = e.ecart;
  const ecartPct = e.ecartPct !== null && e.ecartPct !== undefined ? ` (+${pct(e.ecartPct)})` : '';
  // Même règle que le mail : le mode portefeuille exige un socle récurrent.
  const portefeuille = e.modePortefeuille === true && rec > 0;
  const avecEnjeu = e.freins.some((f) => (f.enjeu ?? 0) > 0);

  const listeFreins = (liste: FreinVma[]) => (
    <ol className="rc-freins">
      {liste.map((f, i) => (
        <li key={f.n}>
          <span className="rang">{i + 1}</span>
          <span className="corps">
            <span className="ft">{f.titre}</span>
            {(f.enjeu ?? 0) > 0 && (
              <span className="enjeu">
                {t.libelleEnjeu ?? 'Enjeu estimé'} : environ +{fmtEur(f.enjeu)} par mois*
              </span>
            )}
            <span>{f.phrase}</span>
            {f.reponse && (
              <span className="fd">
                <strong>{t.libelleReponse ?? 'Votre réponse'} : </strong>« {f.reponse} »
              </span>
            )}
            {f.cible && f.cible !== f.reponse && (
              <span className="fd">
                <strong>{t.libelleCible ?? 'Les plus avancés'} : </strong>« {f.cible} »
              </span>
            )}
            {f.debut && f.debut.length > 0 && (
              <>
                <strong className="fd">{t.libelleDebut ?? 'Par où commencer'}</strong>
                <ul>
                  {f.debut.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </>
            )}
            {f.signe && (
              <span className="fd">
                <strong>{t.libelleSigne ?? 'Signe que c’est en place'} : </strong>
                {f.signe}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
  const ecartCible = (nom: string, cible: number, vers: number, ecartV: number) =>
    ecartV > 0
      ? `${nom} : votre cible est de ${fmtEur(cible)} par mois ; sur votre lancée, ${fmtEur(vers)} dans ${ans(e.echeance)}, soit ${fmtEur(ecartV)} par mois d’écart.`
      : `${nom} : votre cible de ${fmtEur(cible)} par mois est couverte sur votre lancée (${fmtEur(vers)} dans ${ans(e.echeance)}).`;
  const sectionFreins = (titre: string, phrase: string, liste: FreinVma[]) => (
    <div key={titre}>
      <div className="rc-eyebrow">{titre}</div>
      <p>{phrase}</p>
      {listeFreins(liste)}
    </div>
  );

  return (
    <div className="stack rc">
      <div className="panel">
        <div className="panel-h">
          <div>
            <h2>Résultat complet · {test.entrepriseNom}</h2>
            <div className="small muted">
              Tel que le dirigeant l’a vu
              {test.recueLe
                ? ` · reçu le ${new Date(test.recueLe).toLocaleDateString('fr-FR')}`
                : ''}
              {test.type === 'essai' ? ' · essai (non compté dans l’historique)' : ''}
            </div>
          </div>
          <button className="btn" type="button" onClick={onRetour}>
            ← Retour
          </button>
        </div>
      </div>

      <div className="panel rc-carte">
        <div className="rc-eyebrow">
          {portefeuille
            ? (t.libelleAllureTotale ?? 'Votre allure commerciale')
            : previsionnel
              ? (t.libelleVmaPrev ?? 'Votre VMA prévisionnelle')
              : 'Votre VMA commerciale'}
        </div>
        <div className="rc-grand">
          {portefeuille ? fmtEur(allure) : e.mesurable ? fmtEur(e.vma) : '—'}
          <small>
            {portefeuille
              ? `de CA commandé par mois, soit ${fmtEur(allure * 12)} par an`
              : `de CA commandé par mois ${previsionnel ? 'attendu ' : ''}sur vos nouvelles affaires${
                  e.mesurable && e.vma !== null ? `, soit ${fmtEur(e.vma * 12)} par an` : ''
                }`}
          </small>
        </div>
        {portefeuille && (
          <>
            <p>
              {t.libelleSocleRecurrent ?? 'Socle récurrent'} : {fmtEur(e.recurrent)} par mois
            </p>
            <p>
              {t.libelleNouvellesAffaires ?? 'Nouvelles affaires'} : {fmtEur(allure - rec)} par mois
            </p>
          </>
        )}
        {socle && !portefeuille && (
          <>
            <p>+ socle récurrent : {fmtEur(e.recurrent)} par mois</p>
            <p>
              <strong>
                = allure actuelle : {fmtEur(allure)} par mois, soit {fmtEur(allure * 12)} par an
              </strong>
            </p>
          </>
        )}
        {(socle
          ? t.definitionAllure
          : e.mesurable
            ? previsionnel
              ? t.definitionVmaPrev
              : t.definitionVma
            : t.nonMesurable) && (
          <p className="small muted">
            {socle
              ? t.definitionAllure
              : e.mesurable
                ? previsionnel
                  ? t.definitionVmaPrev
                  : t.definitionVma
                : t.nonMesurable}
          </p>
        )}
        {e.indicatif === true && t.indicatif && <p className="small muted">{t.indicatif}</p>}
        <div className="rc-chips">
          <span className={`rc-chip ${pastille[0]}`}>{pastille[1]}</span>
          <span className={`rc-chip ${e.tenue === 'tenue' ? 'ok' : 'warn'}`}>
            {e.tenue === 'tenue' ? 'Activité régulière' : 'Activité par vagues'}
          </span>
        </div>
      </div>

      <div className="panel rc-carte">
        <div className="rc-eyebrow">Votre objectif</div>
        <div className="rc-niveau">
          <span className={`rc-level ${e.niveau.cle}`}>{e.niveau.label}</span>
          <span>
            {fmtEur(e.allureVisee)} par mois dans {ans(e.echeance)}, soit{' '}
            {fmtEur(e.allureVisee * 12)} par an
          </span>
        </div>
        {(e.mesurable || socle) && (
          <>
            <div
              className="rc-piste"
              role="img"
              aria-label={`Aujourd’hui ${fmtEur(allure)} par mois, objectif ${fmtEur(e.allureVisee)} par mois`}
            >
              <span className="fill rec" style={{ left: '0%', width: pos(rec) }} />
              <span className="fill vma" style={{ left: pos(rec), width: pos(e.vma ?? 0) }} />
              <span className="goal" style={{ left: pos(e.allureVisee) }} />
              {lancee && <span className="lancee" style={{ left: pos(e.trajectoire as number) }} />}
            </div>
            <div className="rc-legende">
              <span>Aujourd’hui : {fmtEur(allure)} / mois</span>
              {lancee && (
                <span className="lancee">
                  Sur votre lancée dans {ans(e.echeance)} : {fmtEur(e.trajectoire)} / mois
                </span>
              )}
              <span>Objectif : {fmtEur(e.allureVisee)} / mois</span>
            </div>
            {lancee && (
              <p>
                Sans rien changer, votre socle récurrent passerait de {fmtEur(e.recurrent)} à{' '}
                {fmtEur(e.socleEcheance)} par mois dans {ans(e.echeance)}.
              </p>
            )}
            {ecart !== null &&
              (lancee ? (
                <p>
                  {ecart > 0
                    ? `Sur votre lancée, il vous manquera ${fmtEur(ecart)} par mois à l’échéance${ecartPct}, soit ${fmtEur(ecart * 12)} par an.`
                    : `Sur votre lancée, vous dépasserez votre objectif de ${fmtEur(-ecart)} par mois à l’échéance, soit ${fmtEur(-ecart * 12)} par an.`}
                </p>
              ) : (
                <p>
                  {ecart > 0
                    ? `Il vous manque ${fmtEur(ecart)} de CA commandé par mois${ecartPct}, soit ${fmtEur(ecart * 12)} par an.`
                    : `Vous dépassez déjà votre objectif de ${fmtEur(-ecart)} par mois, soit ${fmtEur(-ecart * 12)} par an.`}
                </p>
              ))}
            {lancee && t.definitionTrajectoire && (
              <p className="small muted">{t.definitionTrajectoire}</p>
            )}
          </>
        )}
        <p>{e.niveau.phrase}</p>
      </div>

      <div className="panel rc-carte">
        <div className="rc-eyebrow">
          {socle ? 'Où se perd votre allure' : 'Où se perd votre VMA'}
        </div>
        {portefeuille ? (
          <>
            {sectionFreins(
              t.titreConquete ?? 'Conquête',
              ecartCible(
                t.libelleNouvellesAffaires ?? 'Nouvelles affaires',
                e.spotCible ?? 0,
                e.spotEcheance ?? 0,
                e.ecartSpot ?? 0,
              ),
              e.freinsConquete ?? [],
            )}
            {sectionFreins(
              t.titrePortefeuille ?? 'Portefeuille',
              ecartCible(
                t.libelleSocleRecurrent ?? 'Socle récurrent',
                e.recurrentCible ?? 0,
                e.socleEcheance ?? 0,
                e.ecartRecurrent ?? 0,
              ) +
                (e.partRecVisee != null && e.partRecActuelle != null
                  ? ` Part visée : ${pct(e.partRecVisee)} (aujourd’hui ${pct(e.partRecActuelle)}).`
                  : ''),
              e.freinsPortefeuille ?? [],
            )}
          </>
        ) : e.freins.length ? (
          listeFreins(e.freins)
        ) : (
          <p>{t.aucunFrein ?? 'Aucun frein majeur identifié.'}</p>
        )}
        {avecEnjeu && t.noteEnjeu && <p className="small muted">* {t.noteEnjeu}</p>}
      </div>
    </div>
  );
}
