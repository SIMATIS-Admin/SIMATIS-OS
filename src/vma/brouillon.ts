// Brouillon du mail de résultat au dirigeant (cahier, §7.4). Le texte reprend l'écran que le dirigeant
// a déjà vu : pas de potentiel, pas de délai, pas de phrase sur la suite. Marc l'envoie lui-même.

const NB = '\u00a0';

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const euros = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${NB}M€`;
  if (a >= 1000)
    return `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NB}k€`;
  return `${Math.round(v).toLocaleString('fr-FR')}${NB}€`;
};

const pct = (x: number) =>
  `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}${NB}%`;
const ans = (n: number) => `${n} ${n < 2 ? 'an' : 'ans'}`;

// Forme de l'écran dirigeant, telle que la relève la reçoit du site (v0.2 : avec le socle récurrent).
export type EcranDirigeant = {
  entreprise: string;
  vma: number | null;
  mesurable: boolean;
  statut: string;
  pastille?: string;
  tenue: string;
  // Socle récurrent par mois, absent sans récurrent ; allure actuelle = VMA + récurrent.
  recurrent?: number | null;
  allureActuelle?: number;
  // v2.0 (module Portefeuille) : allure et socle à l'échéance si rien ne change, absents sans récurrent.
  // Avec une trajectoire, l'écart est calculé sur elle, plus sur l'allure actuelle.
  trajectoire?: number | null;
  socleEcheance?: number | null;
  allureVisee: number;
  echeance: number;
  niveau: { cle: string; label: string; phrase: string };
  ecart: number | null;
  ecartPct: number | null;
  freins: { n: number; titre: string; phrase: string }[];
  textes: { definitionVma: string; nonMesurable: string; aucunFrein: string };
};

export function brouillonResultat(p: { contactNom: string | null; ecran: EcranDirigeant }): {
  subject: string;
  html: string;
} {
  const e = p.ecran;
  const salut = p.contactNom ? `Bonjour ${esc(p.contactNom)},` : 'Bonjour,';
  const socle =
    typeof e.recurrent === 'number' && e.recurrent > 0 && e.allureActuelle !== undefined;
  const chiffres =
    e.mesurable && e.vma !== null
      ? `${euros(e.vma)} de CA commandé par mois sur vos nouvelles affaires, soit ${euros(e.vma * 12)} par an.`
      : e.textes.nonMesurable;
  const allure = socle
    ? `<p>+ socle récurrent : ${esc(euros(e.recurrent ?? 0))} par mois<br>= allure actuelle : ${esc(euros(e.allureActuelle ?? 0))} par mois, soit ${esc(euros((e.allureActuelle ?? 0) * 12))} par an.</p>`
    : '';
  const pastille =
    e.pastille === 'estimés' || e.statut === 'à confirmer'
      ? 'chiffres en partie estimés'
      : e.statut === 'prouvée' && e.pastille !== 'non mesurable'
        ? 'chiffres réels'
        : 'non mesurable';
  const tenue = e.tenue === 'tenue' ? 'activité régulière' : 'activité par vagues';
  const lancee = socle && typeof e.trajectoire === 'number' && typeof e.socleEcheance === 'number';
  const trajectoire = lancee
    ? `<p>Sans rien changer, votre socle récurrent passerait de ${esc(euros(e.recurrent ?? 0))} à ${esc(euros(e.socleEcheance ?? 0))} par mois dans ${esc(ans(e.echeance))}.</p>`
    : '';
  const ecart =
    e.ecart !== null && lancee
      ? e.ecart > 0
        ? `Sur votre lancée, il vous manquera ${euros(e.ecart)} par mois à l’échéance${e.ecartPct !== null ? ` (+${pct(e.ecartPct)})` : ''}, soit ${euros(e.ecart * 12)} par an.`
        : `Sur votre lancée, vous dépasserez votre objectif de ${euros(-e.ecart)} par mois à l’échéance.`
      : e.ecart !== null
        ? e.ecart > 0
          ? `Il vous manque ${euros(e.ecart)} de CA commandé par mois${e.ecartPct !== null ? ` (+${pct(e.ecartPct)})` : ''}, soit ${euros(e.ecart * 12)} par an.`
          : `Vous dépassez déjà votre objectif de ${euros(-e.ecart)} par mois.`
        : '';
  const freins = e.freins.length
    ? `<ol>${e.freins.map((f) => `<li><strong>${esc(f.titre)}</strong> : ${esc(f.phrase)}</li>`).join('')}</ol>`
    : `<p>${esc(e.textes.aucunFrein)}</p>`;

  const html = [
    `<p>${salut}</p>`,
    `<p>Voici votre résultat au Test de VMA pour ${esc(e.entreprise)}.</p>`,
    `<p><strong>Votre VMA commerciale : ${esc(chiffres)}</strong><br>${esc(pastille)} · ${esc(tenue)}</p>`,
    allure,
    `<p><strong>Votre objectif : ${esc(e.niveau.label)}</strong><br>${esc(euros(e.allureVisee))} par mois dans ${esc(ans(e.echeance))}, soit ${esc(euros(e.allureVisee * 12))} par an.${ecart ? ` ${esc(ecart)}` : ''}</p>`,
    trajectoire,
    `<p>${esc(e.niveau.phrase)}</p>`,
    `<p><strong>Où se perd votre ${lancee ? 'allure' : 'VMA'} :</strong></p>`,
    freins,
    `<p>Bien à vous,</p>`,
  ]
    .filter(Boolean)
    .join('\n');
  return { subject: 'Votre résultat au Test de VMA', html };
}
