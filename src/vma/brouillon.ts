// Mail de résultat au dirigeant (cahier, §7.4). Le texte reprend l'écran que le dirigeant
// a déjà vu : pas de potentiel, pas de délai, pas de phrase sur la suite. Il part tout seul à la relève (releve.ts).

import { COULEURS, POLICE, echapper, habillerMail, paragraphe } from '../mail/gabarit.js';

const NB = '\u00a0';

const esc = echapper;

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
  // v2.1 : réponse du dirigeant, pratique la plus avancée, par où commencer et signe que c'est en place.
  // v2.2 (mode portefeuille : le récurrent domine l'allure) : l'objectif en CA total se découpe en récurrent et spot.
  modePortefeuille?: boolean;
  partRecActuelle?: number | null;
  partRecVisee?: number | null;
  recurrentCible?: number | null;
  spotCible?: number | null;
  spotEcheance?: number | null;
  ecartRecurrent?: number | null;
  ecartSpot?: number | null;
  freinsConquete?: EcranDirigeant['freins'];
  freinsPortefeuille?: EcranDirigeant['freins'];
  freins: {
    n: number;
    titre: string;
    phrase: string;
    // Enjeu estimé en € par mois, présenté comme une estimation moyenne (décision de Marc, 21 octobre 2026).
    enjeu?: number;
    reponse?: string;
    cible?: string;
    debut?: string[];
    signe?: string;
  }[];
  textes: {
    definitionVma: string;
    nonMesurable: string;
    aucunFrein: string;
    libelleReponse?: string;
    libelleCible?: string;
    libelleDebut?: string;
    libelleSigne?: string;
    libelleEnjeu?: string;
    noteEnjeu?: string;
    libelleAllureTotale?: string;
    titreConquete?: string;
    titrePortefeuille?: string;
    libelleSocleRecurrent?: string;
    libelleNouvellesAffaires?: string;
  };
};

const C = COULEURS;

const p = paragraphe;

// v2.1 : le détail pratique d'un frein, absent des résultats plus anciens.
function detailFrein(f: EcranDirigeant['freins'][number], t: EcranDirigeant['textes']): string {
  const ligne = (contenu: string) =>
    `<div style="margin:6px 0 0;font:14px/1.5 ${POLICE};color:${C.roche};">${contenu}</div>`;
  const lignes: string[] = [];
  if (typeof f.enjeu === 'number' && f.enjeu > 0)
    lignes.push(
      ligne(
        `<span style="color:${C.teal};font-weight:700;">${esc(t.libelleEnjeu ?? 'Enjeu estimé')} : environ +${esc(euros(f.enjeu))} par mois*</span>`,
      ),
    );
  if (f.reponse)
    lignes.push(ligne(`${esc(t.libelleReponse ?? 'Votre réponse')} : « ${esc(f.reponse)} »`));
  if (f.cible && f.cible !== f.reponse)
    lignes.push(ligne(`${esc(t.libelleCible ?? 'Les plus avancés')} : « ${esc(f.cible)} »`));
  if (f.debut?.length)
    lignes.push(
      `<div style="margin:12px 0 0;padding:12px 16px;background:${C.mentheClair};border-left:3px solid ${C.teal};font:14px/1.5 ${POLICE};color:${C.nuit};"><strong style="color:${C.marine};">${esc(t.libelleDebut ?? 'Par où commencer')}</strong><ul style="margin:6px 0 0;padding-left:18px;">${f.debut.map((a) => `<li style="margin:3px 0;">${esc(a)}</li>`).join('')}</ul></div>`,
    );
  if (f.signe)
    lignes.push(ligne(`${esc(t.libelleSigne ?? 'Signe que c’est en place')} : ${esc(f.signe)}`));
  return lignes.join('');
}

export function brouillonResultat(p0: { contactNom: string | null; ecran: EcranDirigeant }): {
  subject: string;
  html: string;
} {
  const e = p0.ecran;
  const salut = p0.contactNom ? `Bonjour ${esc(p0.contactNom)},` : 'Bonjour,';
  const socle =
    typeof e.recurrent === 'number' && e.recurrent > 0 && e.allureActuelle !== undefined;
  const mesure = e.mesurable && e.vma !== null;
  const portefeuille = e.modePortefeuille === true && socle;
  const chiffres = portefeuille
    ? `${euros(e.allureActuelle ?? 0)} de CA commandé par mois, soit ${euros((e.allureActuelle ?? 0) * 12)} par an.`
    : mesure
      ? `${euros(e.vma ?? 0)} de CA commandé par mois sur vos nouvelles affaires, soit ${euros((e.vma ?? 0) * 12)} par an.`
      : e.textes.nonMesurable;
  const pastille =
    e.pastille === 'estimés' || e.statut === 'à confirmer'
      ? 'chiffres en partie estimés'
      : e.statut === 'prouvée' && e.pastille !== 'non mesurable'
        ? 'chiffres réels'
        : 'non mesurable';
  const tenue = e.tenue === 'tenue' ? 'activité régulière' : 'activité par vagues';
  const lancee = socle && typeof e.trajectoire === 'number' && typeof e.socleEcheance === 'number';
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

  const puce = (t: string) =>
    `<span style="display:inline-block;margin:10px 6px 0 0;padding:3px 10px;border:1px solid ${C.menthe};border-radius:12px;font:12px/1.4 ${POLICE};color:${C.menthe};">${esc(t)}</span>`;
  const hero = `<tr><td style="background:${C.nuit};padding:28px 32px 26px;">
<div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.menthe};">${esc(portefeuille ? (e.textes.libelleAllureTotale ?? 'Votre allure commerciale') : 'Votre VMA commerciale')}</div>
${portefeuille || mesure ? `<div style="margin:8px 0 4px;font:800 44px/1.1 ${POLICE};color:#FFFFFF;">${esc(euros(portefeuille ? (e.allureActuelle ?? 0) : (e.vma ?? 0)))}<span style="font:400 16px/1.4 ${POLICE};color:#FFFFFF;"> par mois</span></div>` : ''}
<div style="font:16px/1.5 ${POLICE};color:#FFFFFF;">${esc(chiffres)}</div>
<div>${puce(pastille)}${puce(tenue)}</div>
</td></tr>`;

  const ligneAllure = (t: string, fort = false) =>
    `<div style="font:${fort ? '700 ' : ''}15px/1.7 ${POLICE};color:${C.nuit};">${esc(t)}</div>`;
  const allure = portefeuille
    ? `<tr><td style="padding:22px 32px 0;"><div style="padding:14px 18px;background:${C.glacier};border-radius:6px;">${ligneAllure(`${e.textes.libelleSocleRecurrent ?? 'Socle récurrent'} : ${euros(e.recurrent ?? 0)} par mois`)}${ligneAllure(`${e.textes.libelleNouvellesAffaires ?? 'Nouvelles affaires'} : ${euros((e.allureActuelle ?? 0) - (e.recurrent ?? 0))} par mois`)}</div></td></tr>`
    : socle
    ? `<tr><td style="padding:22px 32px 0;"><div style="padding:14px 18px;background:${C.glacier};border-radius:6px;">${ligneAllure(`+ socle récurrent : ${euros(e.recurrent ?? 0)} par mois`)}${ligneAllure(`= allure actuelle : ${euros(e.allureActuelle ?? 0)} par mois, soit ${euros((e.allureActuelle ?? 0) * 12)} par an.`, true)}</div></td></tr>`
    : '';

  const objectif = `<tr><td style="padding:22px 32px 0;"><div style="padding:16px 18px;border:1px solid ${C.trait};border-left:4px solid ${C.teal};border-radius:6px;">
<div style="font:700 17px/1.4 ${POLICE};color:${C.marine};">Votre objectif : ${esc(e.niveau.label)}</div>
<div style="margin-top:4px;font:15px/1.6 ${POLICE};color:${C.nuit};">${esc(euros(e.allureVisee))} par mois dans ${esc(ans(e.echeance))}, soit ${esc(euros(e.allureVisee * 12))} par an.${ecart ? ` ${esc(ecart)}` : ''}</div>
</div></td></tr>`;

  const trajectoire = lancee
    ? `<tr><td style="padding:16px 32px 0;">${p(`Sans rien changer, votre socle récurrent passerait de ${esc(euros(e.recurrent ?? 0))} à ${esc(euros(e.socleEcheance ?? 0))} par mois dans ${esc(ans(e.echeance))}.`, 'margin:0;')}</td></tr>`
    : '';
  const phrase = `<tr><td style="padding:16px 32px 0;">${p(esc(e.niveau.phrase), 'margin:0;')}</td></tr>`;

  const noteEnjeu =
    e.textes.noteEnjeu && e.freins.some((f) => typeof f.enjeu === 'number' && f.enjeu > 0)
      ? `<tr><td style="padding:4px 32px 0;"><div style="font:12px/1.5 ${POLICE};color:${C.roche};">* ${esc(e.textes.noteEnjeu)}</div></td></tr>`
      : '';
  const carte = (f: EcranDirigeant['freins'][number], i: number) =>
    `<tr><td style="padding:12px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.trait};border-radius:6px;"><tr>
<td valign="top" width="44" style="padding:16px 0 16px 16px;"><div style="width:28px;height:28px;border-radius:14px;background:${C.marine};font:700 14px/28px ${POLICE};color:${C.menthe};text-align:center;">${i + 1}</div></td>
<td valign="top" style="padding:16px 18px 16px 8px;"><div style="font:700 16px/1.4 ${POLICE};color:${C.marine};">${esc(f.titre)}</div><div style="margin-top:2px;font:15px/1.5 ${POLICE};color:${C.nuit};">${esc(f.phrase)}</div>${detailFrein(f, e.textes)}</td>
</tr></table></td></tr>`;
  const sectionFreins = (liste: EcranDirigeant['freins'], titre: string, phrase: string) =>
    `<tr><td style="padding:28px 32px 0;"><div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.teal};">${esc(titre)}</div>${phrase ? `<div style="margin-top:8px;font:15px/1.6 ${POLICE};color:${C.nuit};">${esc(phrase)}</div>` : ''}</td></tr>${liste.map(carte).join('')}`;
  const phraseEcart = (nom: string, cible: number, lancee: number, ecartV: number) =>
    ecartV > 0
      ? `${nom} : votre cible est de ${euros(cible)} par mois ; sur votre lancée, ${euros(lancee)} dans ${ans(e.echeance)}, soit ${euros(ecartV)} par mois d’écart.`
      : `${nom} : votre cible de ${euros(cible)} par mois est couverte sur votre lancée (${euros(lancee)} dans ${ans(e.echeance)}).`;
  const freinsPortefeuille = () => {
    const t = e.textes;
    const conq = sectionFreins(
      e.freinsConquete ?? [],
      t.titreConquete ?? 'Conquête',
      phraseEcart(t.libelleNouvellesAffaires ?? 'Nouvelles affaires', e.spotCible ?? 0, e.spotEcheance ?? 0, e.ecartSpot ?? 0),
    );
    const part =
      e.partRecVisee != null && e.partRecActuelle != null
        ? ` Part visée : ${pct(e.partRecVisee)} (aujourd’hui ${pct(e.partRecActuelle)}).`
        : '';
    const port = sectionFreins(
      e.freinsPortefeuille ?? [],
      t.titrePortefeuille ?? 'Portefeuille',
      phraseEcart(t.libelleSocleRecurrent ?? 'Socle récurrent', e.recurrentCible ?? 0, e.socleEcheance ?? 0, e.ecartRecurrent ?? 0) + part,
    );
    return `${conq}${port}${noteEnjeu}`;
  };
  const freins = portefeuille
    ? freinsPortefeuille()
    : e.freins.length
      ? `<tr><td style="padding:28px 32px 0;"><div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.teal};">Où se perd votre ${lancee ? 'allure' : 'VMA'} :</div></td></tr>${e.freins.map(carte).join('')}${noteEnjeu}`
      : `<tr><td style="padding:22px 32px 0;">${p(esc(e.textes.aucunFrein), 'margin:0;')}</td></tr>`;

  const html =
    habillerMail(`<tr><td style="padding:26px 32px 20px;">${p(salut, 'margin:0 0 10px;')}${p(`Voici votre résultat au Test de VMA pour ${esc(e.entreprise)}.`, 'margin:0;')}</td></tr>
${hero}
${allure}
${objectif}
${trajectoire}
${phrase}
${freins}`);
  return { subject: 'Votre résultat au Test de VMA', html };
}
