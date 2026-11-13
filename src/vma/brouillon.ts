// Mail de résultat au dirigeant (cahier, §7.4). Le texte reprend l'écran que le dirigeant
// a déjà vu : pas de potentiel, pas de délai, pas de phrase sur la suite. Il part tout seul à la relève (releve.ts).

import {
  bouton,
  COULEURS,
  ENTETE_TEST_VMA,
  POLICE,
  echapper,
  habillerMail,
  paragraphe,
  salutation,
} from '../mail/gabarit.js';

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
const ans = (n: number) => (n < 1 ? `${Math.round(n * 12)} mois` : `${n} ${n < 2 ? 'an' : 'ans'}`);

// Méthode 3.3 : le résultat en trois questions, phrases et montants préparés par le site (mêmes textes partout).
export type FreinSynthese = {
  k: string;
  n: number;
  label: string;
  titre: string;
  phrase: string;
  // « gain », « perteEvitee » ou « securise ».
  nature: string;
  enjeu: number | null;
  hypothese: string;
  reponse?: string;
  cible?: string;
  debut?: string[];
  signe?: string;
};
export type SyntheseVma = {
  questions: string[];
  verdict: { cle: string; titre: string; phrase: string; points: string[]; remarques: string[] };
  vmaLigne: string | null;
  pratiques: { auMax: number; total: number; titre: string; forces: string[] };
  freins: FreinSynthese[];
  autres: FreinSynthese[];
  gainMensuel: number;
  texteFreins: string;
  texteAutres: string | null;
  noteMontants: string;
  action: { titre: string; label: string; debut: string[]; signe?: string; sous: string } | null;
  appel: string;
  libelles: Record<string, string>;
};

// Forme de l'écran dirigeant, telle que la relève la reçoit du site (v0.2 : avec le socle récurrent).
export type EcranDirigeant = {
  synthese?: SyntheseVma;
  entreprise: string;
  // Méthode 3.0 : trois catégories de revenus (régulier variable, engagé, ponctuel), flux séparés, deux conclusions.
  methode?: string;
  periode?: number;
  caMensuel?: { total: number; regulier: number; engage: number; ponctuel: number };
  tauxObserve?: number | null;
  objectif?: {
    caMensuel: number;
    echeance: number;
    partEngageeVisee: number | null;
    montantEngageMensuel: number | null;
  };
  projection?: {
    ca: number;
    caAvecReconduction: number | null;
    engage: number;
    engageAvecReconduction: number | null;
    echu: number;
  };
  conclusionCa?: {
    statut: string;
    manque: string[];
    ecart: number;
    ecartAvecReconduction: number | null;
    ecartPct: number | null;
  };
  composition?: {
    statut: string;
    partVisee?: number;
    cible?: number;
    partActuelle?: number;
  };
  vma: number | null;
  mesurable: boolean;
  statut: string;
  pastille?: string;
  // v2.3 (parcours Lancement) : VMA prévue faute de devis envoyés, ou calculée sur peu de devis.
  previsionnel?: boolean;
  indicatif?: boolean;
  parcours?: string;
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
    // Méthode 3.0 : null pour les freins sur les clients réguliers et les contrats ; `nature` dit ce que l'enjeu représente.
    enjeu?: number | null;
    nature?: string;
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
    libelleVmaPrev?: string;
    pastillePrev?: string;
    indicatif?: string;
    // Méthode 3.0
    libelleCaMensuel?: string;
    libellesRevenus?: Record<string, string>;
    natures?: Record<string, string>;
    conclusions?: {
      titreCa: string;
      titreComposition: string;
      ca: Record<string, string>;
      composition: Record<string, string>;
    };
  };
};

const C = COULEURS;

const p = paragraphe;

// v2.1 : le détail pratique d'un frein, absent des résultats plus anciens.
function detailFrein(f: EcranDirigeant['freins'][number], t: EcranDirigeant['textes']): string {
  const ligne = (contenu: string) =>
    `<div style="margin:6px 0 0;font:14px/1.5 ${POLICE};color:${C.roche};">${contenu}</div>`;
  const lignes: string[] = [];
  if (t.natures) {
    // Méthode 3.0 : l'enjeu dit sa nature (gain, perte évitée, revenu sécurisé) ; sans montant quand il n'est pas chiffré.
    const nature = t.natures[f.nature ?? 'gain'] ?? '';
    const texte =
      typeof f.enjeu === 'number' && f.enjeu > 0
        ? `${nature} estimé : environ +${euros(f.enjeu)} par mois*`
        : `${nature} · ${(t.natures.nonChiffre ?? 'enjeu non chiffré').toLowerCase()}`;
    lignes.push(ligne(`<span style="color:${C.teal};font-weight:700;">${esc(texte)}</span>`));
  } else if (typeof f.enjeu === 'number' && f.enjeu > 0)
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
  if (p0.ecran.synthese && p0.ecran.caMensuel) return brouillonResultatSynthese(p0);
  if (p0.ecran.methode?.startsWith('3') && p0.ecran.caMensuel) return brouillonResultatV3(p0);
  const e = p0.ecran;
  const salut = salutation(p0.contactNom);
  const socle =
    typeof e.recurrent === 'number' && e.recurrent > 0 && e.allureActuelle !== undefined;
  const mesure = e.mesurable && e.vma !== null;
  const portefeuille = e.modePortefeuille === true && socle;
  const previsionnel = e.previsionnel === true && mesure;
  const chiffres = portefeuille
    ? `${euros(e.allureActuelle ?? 0)} de CA commandé par mois, soit ${euros((e.allureActuelle ?? 0) * 12)} par an.`
    : mesure
      ? `${euros(e.vma ?? 0)} de CA commandé par mois ${previsionnel ? 'attendu ' : ''}sur vos nouvelles affaires, soit ${euros((e.vma ?? 0) * 12)} par an.`
      : e.textes.nonMesurable;
  const pastille = previsionnel
    ? (e.textes.pastillePrev ?? 'Chiffres prévisionnels').toLowerCase()
    : e.pastille === 'estimés' || e.statut === 'à confirmer'
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
<div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.menthe};">${esc(portefeuille ? (e.textes.libelleAllureTotale ?? 'Votre allure commerciale') : previsionnel ? (e.textes.libelleVmaPrev ?? 'Votre VMA prévisionnelle') : 'Votre VMA commerciale')}</div>
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
  const phrase = `<tr><td style="padding:16px 32px 0;">${p(esc(e.niveau.phrase), 'margin:0;')}${e.indicatif === true && e.textes.indicatif ? p(esc(e.textes.indicatif), 'margin:8px 0 0;') : ''}</td></tr>`;

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
      phraseEcart(
        t.libelleNouvellesAffaires ?? 'Nouvelles affaires',
        e.spotCible ?? 0,
        e.spotEcheance ?? 0,
        e.ecartSpot ?? 0,
      ),
    );
    const part =
      e.partRecVisee != null && e.partRecActuelle != null
        ? ` Part visée : ${pct(e.partRecVisee)} (aujourd’hui ${pct(e.partRecActuelle)}).`
        : '';
    const port = sectionFreins(
      e.freinsPortefeuille ?? [],
      t.titrePortefeuille ?? 'Portefeuille',
      phraseEcart(
        t.libelleSocleRecurrent ?? 'Socle récurrent',
        e.recurrentCible ?? 0,
        e.socleEcheance ?? 0,
        e.ecartRecurrent ?? 0,
      ) + part,
    );
    return `${conq}${port}${noteEnjeu}`;
  };
  const freins = portefeuille
    ? freinsPortefeuille()
    : e.freins.length
      ? `<tr><td style="padding:28px 32px 0;"><div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.teal};">Où se perd votre ${lancee ? 'allure' : 'VMA'} :</div></td></tr>${e.freins.map(carte).join('')}${noteEnjeu}`
      : `<tr><td style="padding:22px 32px 0;">${p(esc(e.textes.aucunFrein), 'margin:0;')}</td></tr>`;

  const html = habillerMail(
    `<tr><td style="padding:26px 32px 20px;">${p(salut, 'margin:0 0 10px;')}${p(`Voici votre résultat au Test de VMA pour ${esc(e.entreprise)}.`, 'margin:0;')}</td></tr>
${hero}
${allure}
${objectif}
${trajectoire}
${phrase}
${freins}`,
    { entete: ENTETE_TEST_VMA },
  );
  return { subject: 'Votre résultat au Test de VMA', html };
}

// Méthode 3.0 : le mail reprend l'écran du dirigeant. Le CA mensuel et ses trois catégories ouvrent le résultat ; la VMA
// ne désigne que les prestations ponctuelles ; deux conclusions distinctes (CA couvert ? part sous engagement atteinte ?).
function brouillonResultatV3(p0: { contactNom: string | null; ecran: EcranDirigeant }): {
  subject: string;
  html: string;
} {
  const e = p0.ecran;
  const t = e.textes;
  const cm = e.caMensuel!;
  const lib = t.libellesRevenus ?? {};
  const o = e.objectif;
  const pr = e.projection;
  const c = e.conclusionCa;
  const comp = e.composition;
  const mesure = e.mesurable && e.vma !== null;
  const previsionnel = e.previsionnel === true && mesure;
  const pastille = previsionnel
    ? (t.pastillePrev ?? 'Chiffres prévisionnels').toLowerCase()
    : e.pastille === 'estimés' || e.statut === 'à confirmer'
      ? 'chiffres en partie estimés'
      : e.pastille === 'non mesurable'
        ? 'non mesurable'
        : 'chiffres réels';
  const tenue = e.tenue === 'tenue' ? 'activité régulière' : 'activité par vagues';
  const puce = (x: string) =>
    `<span style="display:inline-block;margin:10px 6px 0 0;padding:3px 10px;border:1px solid ${C.menthe};border-radius:12px;font:12px/1.4 ${POLICE};color:${C.menthe};">${esc(x)}</span>`;
  const ligne = (x: string, fort = false) =>
    `<div style="font:${fort ? '700 ' : ''}15px/1.7 ${POLICE};color:${C.nuit};">${esc(x)}</div>`;
  const part = (k: 'regulier' | 'engage' | 'ponctuel') =>
    cm.total > 0 ? ` (${pct(cm[k] / cm.total)})` : '';
  // Le parcours Lancement n'a pas de revenus sous engagement : la catégorie n'est ni affichée ni comptée.
  const cles =
    e.parcours === 'lancement'
      ? (['regulier', 'ponctuel'] as const)
      : (['regulier', 'engage', 'ponctuel'] as const);
  const categories = cles.map((k) => `${lib[k] ?? k} : ${euros(cm[k])} par mois${part(k)}`);
  const hero = `<tr><td style="background:${C.nuit};padding:28px 32px 26px;">
<div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.menthe};">${esc(t.libelleCaMensuel ?? 'Votre chiffre d’affaires mensuel')}</div>
<div style="margin:8px 0 4px;font:800 44px/1.1 ${POLICE};color:#FFFFFF;">${esc(euros(cm.total))}<span style="font:400 16px/1.4 ${POLICE};color:#FFFFFF;"> par mois</span></div>
<div style="font:16px/1.5 ${POLICE};color:#FFFFFF;">${esc(`Soit ${euros(cm.total * 12)} par an, en moyenne sur ${e.periode ?? 3} mois.`)}</div>
<div>${puce(pastille)}${puce(tenue)}</div>
</td></tr>
<tr><td style="padding:22px 32px 0;"><div style="padding:14px 18px;background:${C.glacier};border-radius:6px;">${categories.map((x) => ligne(x)).join('')}</div></td></tr>`;

  const vma = `<tr><td style="padding:22px 32px 0;"><div style="padding:14px 18px;border:1px solid ${C.trait};border-radius:6px;">
<div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.teal};">${esc(previsionnel ? (t.libelleVmaPrev ?? 'Votre VMA prévisionnelle') : 'Votre VMA commerciale')}</div>
<div style="margin-top:6px;font:15px/1.6 ${POLICE};color:${C.nuit};">${esc(mesure ? `${euros(e.vma ?? 0)} de CA commandé par mois ${previsionnel ? 'attendu ' : ''}sur vos prestations ponctuelles, soit ${euros((e.vma ?? 0) * 12)} par an.` : t.nonMesurable)}</div>
<div style="margin-top:4px;font:14px/1.5 ${POLICE};color:${C.roche};">${esc(t.definitionVma)}</div>
${typeof e.tauxObserve === 'number' ? `<div style="margin-top:4px;font:14px/1.5 ${POLICE};color:${C.roche};">${esc(`Sur la période, vos commandes représentent ${pct(e.tauxObserve)} du montant de vos devis : un rapport de montants, pas votre taux de signature habituel.`)}</div>` : ''}
${e.indicatif === true && t.indicatif ? `<div style="margin-top:4px;font:14px/1.5 ${POLICE};color:${C.roche};">${esc(t.indicatif)}</div>` : ''}
</div></td></tr>`;

  const conclusions = t.conclusions;
  const conclusionsTextes = conclusions;
  const bloc = (titre: string, texte: string, detail = '') =>
    `<div style="margin-top:12px;font:15px/1.6 ${POLICE};color:${C.nuit};"><strong style="color:${C.marine};">${esc(titre)}</strong> ${esc(texte)}${detail ? `<div style="font:14px/1.5 ${POLICE};color:${C.roche};">${esc(detail)}</div>` : ''}</div>`;
  const avecRec = typeof pr?.caAvecReconduction === 'number';
  // Même lecture que la page de résultat du site : pour une activité purement ponctuelle, le niveau d'ambition nuance
  // le « non » (écart que la levée des freins peut combler, ou non). Un résultat plus ancien sans ces textes garde le sien.
  const texteCa = (() => {
    if (!conclusionsTextes || !c) return '';
    const ca = conclusionsTextes.ca;
    if (
      c.statut === 'non-couvert' &&
      ['real', 'amb'].includes(e.niveau.cle) &&
      ca['non-couvert-atteignable']
    )
      return ca['non-couvert-atteignable'];
    if (c.statut === 'non-couvert' && e.niveau.cle === 'tres' && ca['non-couvert-hors-portee'])
      return ca['non-couvert-hors-portee'];
    return ca[c.statut] ?? '';
  })();
  // « Sans reconduction » n'est dit que s'il y a des engagements qui arrivent à terme.
  const ecartTexte =
    c && c.statut !== 'a-confirmer' && c.ecart > 0
      ? `${pr && (pr.echu > 0 || avecRec) ? 'Sans reconduction de vos engagements, il' : 'Il'} vous manquera ${euros(c.ecart)} par mois à l’échéance, soit ${euros(c.ecart * 12)} par an${c.ecartPct !== null ? ` (+${pct(c.ecartPct)} par rapport à votre trajectoire estimée).` : '.'}`
      : '';
  const detailCa = c
    ? [ecartTexte, c.manque.length ? `Ce qui manque pour conclure : ${c.manque.join(', ')}.` : '']
        .filter(Boolean)
        .join(' ')
    : '';
  const detailComposition =
    comp && comp.statut !== 'non-demande' && pr
      ? `Part visée : ${pct(comp.partVisee ?? 0)}, soit ${euros(comp.cible ?? 0)} par mois sous engagement (aujourd’hui ${pct(comp.partActuelle ?? 0)}). Estimé à l’échéance : ${euros(pr.engage)} par mois${typeof pr.engageAvecReconduction === 'number' ? `, ${euros(pr.engageAvecReconduction)} avec la reconduction indiquée` : ''}.`
      : '';
  const objectif = `<tr><td style="padding:22px 32px 0;"><div style="padding:16px 18px;border:1px solid ${C.trait};border-left:4px solid ${C.teal};border-radius:6px;">
<div style="font:700 17px/1.4 ${POLICE};color:${C.marine};">Votre objectif : ${esc(e.niveau.label)}</div>
<div style="margin-top:4px;font:15px/1.6 ${POLICE};color:${C.nuit};">${esc(`${euros(o?.caMensuel ?? e.allureVisee)} par mois dans ${ans(e.echeance)}, soit ${euros((o?.caMensuel ?? e.allureVisee) * 12)} par an.`)}${pr ? ` ${esc(`Sur votre lancée, ${euros(pr.ca)} par mois${avecRec ? ` sans reconduction, ${euros(pr.caAvecReconduction as number)} avec la reconduction indiquée` : ''}.`)}` : ''}</div>
${conclusions && c ? bloc(conclusions.titreCa, texteCa, detailCa) : ''}
${conclusions && comp && comp.statut !== 'non-demande' ? bloc(conclusions.titreComposition, conclusions.composition[comp.statut] ?? '', detailComposition) : ''}
</div></td></tr>
<tr><td style="padding:16px 32px 0;">${p(esc(e.niveau.phrase), 'margin:0;')}</td></tr>`;

  const noteEnjeu =
    t.noteEnjeu && e.freins.some((f) => typeof f.enjeu === 'number' && f.enjeu > 0)
      ? `<tr><td style="padding:4px 32px 0;"><div style="font:12px/1.5 ${POLICE};color:${C.roche};">* ${esc(t.noteEnjeu)}</div></td></tr>`
      : '';
  const carte = (f: EcranDirigeant['freins'][number], i: number) =>
    `<tr><td style="padding:12px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.trait};border-radius:6px;"><tr>
<td valign="top" width="44" style="padding:16px 0 16px 16px;"><div style="width:28px;height:28px;border-radius:14px;background:${C.marine};font:700 14px/28px ${POLICE};color:${C.menthe};text-align:center;">${i + 1}</div></td>
<td valign="top" style="padding:16px 18px 16px 8px;"><div style="font:700 16px/1.4 ${POLICE};color:${C.marine};">${esc(f.titre)}</div><div style="margin-top:2px;font:15px/1.5 ${POLICE};color:${C.nuit};">${esc(f.phrase)}</div>${detailFrein(f, t)}</td>
</tr></table></td></tr>`;
  const section = (titre: string, liste: EcranDirigeant['freins']) =>
    `<tr><td style="padding:28px 32px 0;"><div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.teal};">${esc(titre)}</div></td></tr>${liste.length ? liste.map(carte).join('') : `<tr><td style="padding:12px 32px 0;">${p(esc(t.aucunFrein), 'margin:0;')}</td></tr>`}`;
  const freins = `${e.freins.length || mesure ? section(`Vos freins : ${(t.titreConquete ?? 'Prestations ponctuelles').toLowerCase()}`, e.freins) : ''}${cm.regulier + cm.engage > 0 || (e.freinsPortefeuille ?? []).length ? section(`Vos freins : ${(t.titrePortefeuille ?? 'Clients réguliers et contrats').toLowerCase()}`, e.freinsPortefeuille ?? []) : ''}${noteEnjeu}`;

  // Synthèse en tête, comme sur la page : le verdict, l'écart (ou ce qui manque, ou la trajectoire), le premier frein.
  const premier = e.freins[0] ?? (e.freinsPortefeuille ?? [])[0];
  const ligneBref = (titre: string, texte: string) =>
    `<div style="margin-top:8px;font:15px/1.6 ${POLICE};color:${C.nuit};"><strong style="color:${C.marine};">${esc(titre)}</strong> ${esc(texte)}</div>`;
  const brefSuite = ecartTexte
    ? ligneBref('L’écart :', ecartTexte)
    : c?.statut === 'a-confirmer' && c.manque.length
      ? ligneBref('Pour conclure, il manque :', `${c.manque.join(', ')}.`)
      : pr
        ? ligneBref(
            'Votre trajectoire :',
            `${euros(pr.ca)} par mois dans ${ans(e.echeance)}, pour un objectif de ${euros(o?.caMensuel ?? e.allureVisee)} par mois.`,
          )
        : '';
  const bref = `<tr><td style="padding:0 32px 22px;"><div style="padding:16px 18px;border:1px solid ${C.trait};border-left:4px solid ${C.teal};border-radius:6px;">
<div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.teal};">En bref</div>
<div style="margin-top:6px;font:700 17px/1.4 ${POLICE};color:${C.marine};">${esc(e.niveau.label)}</div>
${texteCa ? ligneBref('Votre objectif :', texteCa) : ''}${brefSuite}${premier ? ligneBref('Le premier frein à lever :', `${premier.titre.charAt(0).toLowerCase()}${premier.titre.slice(1)}.`) : ''}
</div></td></tr>`;

  const html = habillerMail(
    `<tr><td style="padding:26px 32px 20px;">${p(salutation(p0.contactNom), 'margin:0 0 10px;')}${p(`Voici votre résultat au Test de VMA pour ${esc(e.entreprise)}.`, 'margin:0;')}</td></tr>
${bref}
${hero}
${vma}
${objectif}
${freins}`,
    {
      entete: ENTETE_TEST_VMA,
      apercu: `${e.niveau.label}. Votre chiffre d’affaires mensuel, votre VMA et les freins à lever en premier.`,
    },
  );
  return { subject: 'Votre résultat au Test de VMA', html };
}

// Méthode 3.3 : trois questions (où en êtes-vous, qu'est-ce qui vous freine, par où commencer), comme la page du site.
// Les phrases viennent du site ; le mail ne calcule rien. Signature courte, sans pied nuit.
const LIEN_ECHANGE = 'https://www.simatis.fr/contact.html?objet=echange';
const TEINTES = {
  ambre: '#E0A100',
  ambreFond: '#FFF6E5',
  ambreTexte: '#6B4A00',
  vertFond: '#E6FBF8',
  vertTexte: '#1F6B5E',
};

const titreQuestion = (n: number, texte: string) =>
  `<div style="font:700 12px/1.4 ${POLICE};letter-spacing:2px;text-transform:uppercase;color:${C.teal};">${n} · ${esc(texte)}</div>`;

// Barre en cellules de tableau (lue par toutes les messageries) : une cellule pleine, le reste vide.
const barre = (partPct: number, couleur: string, hauteur = 8) => {
  const w = Math.max(0, Math.min(100, Math.round(partPct)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${w > 0 ? `<td width="${w}%" style="height:${hauteur}px;background:${couleur};border-radius:${hauteur / 2}px;font-size:0;line-height:0;">&nbsp;</td>` : ''}${w < 100 ? `<td width="${100 - w}%" style="font-size:0;line-height:0;">&nbsp;</td>` : ''}</tr></table>`;
};

export function montantFrein(f: FreinSynthese): string {
  if (!(typeof f.enjeu === 'number' && f.enjeu > 0)) return '';
  if (f.nature === 'securise') return `${euros(f.enjeu)} à sécuriser`;
  return `+${euros(f.enjeu)}${f.nature === 'perteEvitee' ? ' préservés' : ''}`;
}

function brouillonResultatSynthese(p0: { contactNom: string | null; ecran: EcranDirigeant }): {
  subject: string;
  html: string;
} {
  const e = p0.ecran;
  const s = e.synthese!;
  const cm = e.caMensuel!;
  const v = s.verdict;
  const alerte = v.cle === 'suspendu' || v.cle === 'objectif-bas';
  const cles =
    e.parcours === 'lancement'
      ? (['regulier', 'ponctuel'] as const)
      : (['engage', 'regulier', 'ponctuel'] as const);
  const couleurs = { engage: C.marine, regulier: C.teal, ponctuel: C.menthe };
  const pct0 = (x: number) => (cm.total > 0 ? Math.round((x / cm.total) * 100) : 0);

  // 1. Où en êtes-vous ?
  const verdict = `<div style="margin-top:12px;padding:16px 18px;background:${alerte ? TEINTES.ambreFond : C.glacier};border-left:4px solid ${alerte ? TEINTES.ambre : C.teal};border-radius:6px;font:15px/1.6 ${POLICE};color:${C.nuit};">
<div style="font:700 17px/1.4 ${POLICE};color:${alerte ? TEINTES.ambreTexte : C.marine};">${esc(v.titre)}</div>
${v.phrase ? `<div style="margin-top:6px;">${esc(v.phrase)}</div>` : ''}
${v.points.length ? `<ul style="margin:8px 0 0;padding-left:18px;">${v.points.map((x) => `<li style="margin:3px 0;">${esc(x)}</li>`).join('')}</ul>` : ''}
${v.remarques.map((x) => `<div style="margin-top:8px;">${esc(x)}</div>`).join('')}
</div>`;
  const segments = cles
    .filter((k) => cm[k] > 0)
    .map(
      (k) =>
        `<td width="${pct0(cm[k])}%" style="height:22px;background:${couleurs[k]};font-size:0;line-height:0;">&nbsp;</td>`,
    )
    .join('');
  const legende = cles
    .map(
      (k) =>
        `<tr><td width="18" valign="top" style="padding:3px 0;"><div style="width:10px;height:10px;margin-top:5px;background:${couleurs[k]};border-radius:2px;${k === 'ponctuel' ? `border:1px solid ${C.teal};` : ''}"></div></td><td style="padding:3px 0;">${esc(s.libelles[k] ?? k)}${k === 'ponctuel' && s.vmaLigne ? ` <span style="color:${C.roche};">(${esc(s.vmaLigne)})</span>` : ''}</td><td align="right" width="110" style="padding:3px 0;white-space:nowrap;"><strong>${esc(euros(cm[k]))}</strong> · ${pct0(cm[k])}${NB}%</td></tr>`,
    )
    .join('');
  const objectifMensuel = e.objectif?.caMensuel ?? e.allureVisee;
  const echelle = Math.max(cm.total, objectifMensuel) || 1;
  const ligneComparee = (libelle: string, valeur: number, couleur: string) =>
    `<tr><td style="padding:6px 0 0;">${esc(libelle)}</td><td align="right" style="padding:6px 0 0;white-space:nowrap;"><strong>${esc(euros(valeur))}</strong></td></tr><tr><td colspan="2" style="padding:4px 0 0;">${barre((valeur / echelle) * 100, couleur, 12)}</td></tr>`;
  const q1 = `<tr><td style="padding:26px 32px 0;">${titreQuestion(1, s.questions[0] ?? 'Où en êtes-vous ?')}${verdict}
<div style="margin-top:20px;font:800 40px/1.1 ${POLICE};color:${C.nuit};">${esc(euros(cm.total))}</div>
<div style="font:15px/1.4 ${POLICE};color:${C.roche};">de chiffre d’affaires par mois, en moyenne sur ${e.periode ?? 3} mois</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr>${segments}</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;font:14px/1.5 ${POLICE};color:${C.nuit};">${legende}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;font:14px/1.5 ${POLICE};color:${C.nuit};">${ligneComparee('Aujourd’hui', cm.total, C.marine)}${ligneComparee(`Objectif à ${ans(e.echeance)}`, objectifMensuel, C.trait)}</table>
</td></tr>`;

  // 2. Qu'est-ce qui vous freine ?
  const chip = (x: string) =>
    `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;background:${TEINTES.vertFond};border-radius:12px;font:13px/1.4 ${POLICE};color:${TEINTES.vertTexte};">✓ ${esc(x)}</span>`;
  const max = Math.max(1, ...s.freins.map((f) => f.enjeu ?? 0));
  const frein = (f: FreinSynthese, i: number) =>
    `<tr><td style="padding:${i ? 14 : 10}px 0 2px;"><strong>${esc(f.label)}</strong></td><td width="140" align="right" style="padding:${i ? 14 : 10}px 0 2px;font-weight:700;color:${C.teal};white-space:nowrap;">${esc(montantFrein(f))}</td></tr>
<tr><td colspan="2">${barre(f.enjeu && f.enjeu > 0 ? Math.max(4, (f.enjeu / max) * 100) : 0, f.nature === 'securise' ? C.roche : C.teal)}</td></tr>
<tr><td colspan="2" style="padding:4px 0 0;font:13px/1.5 ${POLICE};color:${C.roche};">${esc(f.hypothese)}</td></tr>`;
  const q2 = `<tr><td style="padding:34px 32px 0;">${titreQuestion(2, s.questions[1] ?? 'Qu’est-ce qui vous freine ?')}
<div style="margin-top:10px;font:700 19px/1.4 ${POLICE};color:${C.marine};">${esc(s.pratiques.titre)}</div>
${s.pratiques.forces.length ? `<div style="margin-top:10px;">${s.pratiques.forces.map(chip).join('')}</div>` : ''}
<div style="margin-top:12px;font:15px/1.6 ${POLICE};color:${C.nuit};">${esc(s.texteFreins)}</div>
${s.freins.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;font:15px/1.5 ${POLICE};color:${C.nuit};">${s.freins.map(frein).join('')}</table>` : ''}
${s.texteAutres ? `<div style="margin-top:10px;font:13px/1.5 ${POLICE};color:${C.roche};">${esc(s.texteAutres)}</div>` : ''}
${s.gainMensuel > 0 ? `<div style="margin-top:12px;font:13px/1.5 ${POLICE};color:${C.roche};">${esc(s.noteMontants)}</div>` : ''}
</td></tr>`;

  // 3. Par où commencer ?
  const a = s.action;
  const etape = (x: string, i: number) =>
    `<tr><td valign="top" width="30" style="padding:4px 0;"><div style="width:22px;height:22px;border-radius:11px;background:${C.menthe};color:${C.nuit};font:700 13px/22px ${POLICE};text-align:center;">${i + 1}</div></td><td style="padding:4px 0;">${esc(x)}</td></tr>`;
  const q3 = `<tr><td style="padding:34px 32px 0;">${titreQuestion(3, s.questions[2] ?? 'Par où commencer ?')}
${
  a
    ? `<div style="margin-top:12px;padding:20px 22px;background:${C.nuit};border-radius:8px;font:15px/1.6 ${POLICE};color:#FFFFFF;">
<div style="font:700 18px/1.4 ${POLICE};color:${C.menthe};">${esc(a.label)}</div>
<div style="margin-top:4px;color:#C9D6E8;">${esc(a.sous)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;font:15px/1.5 ${POLICE};color:#FFFFFF;">${a.debut.map(etape).join('')}</table>
</div>`
    : ''
}
<div style="margin-top:22px;font:16px/1.6 ${POLICE};color:${C.nuit};">${esc(s.appel)}</div>
${bouton('Échanger 15 minutes', LIEN_ECHANGE)}
</td></tr>`;

  const html = habillerMail(
    `<tr><td style="padding:26px 32px 6px;">${p(salutation(p0.contactNom), 'margin:0 0 10px;')}${p(`Voici le résultat de ${esc(e.entreprise)} au Test de VMA, en trois questions.`, 'margin:0;')}</td></tr>
${q1}
${q2}
${q3}`,
    {
      entete: ENTETE_TEST_VMA,
      apercu: `${v.titre}. Où vous en êtes, ce qui vous freine, par où commencer.`,
      signatureCourte: true,
      piedDiscret: 'Vous recevez ce mail parce que vous avez passé le Test de VMA sur simatis.fr.',
    },
  );
  return { subject: 'Votre résultat au Test de VMA', html };
}
