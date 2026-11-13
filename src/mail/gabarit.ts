// Gabarit commun des mails envoyés par SIMATIS OS (charte du site : parcours.css). Un mail ne charge
// pas les polices du site : Archivo si le client de messagerie l'a, sinon Helvetica / Arial. Tout est
// en styles en ligne et en tableaux, pour tenir dans les clients de messagerie.

export const COULEURS = {
  nuit: '#071E3D',
  marine: '#0C376B',
  glacier: '#F3F7FA',
  roche: '#4E5D72',
  trait: '#D6DFEA',
  menthe: '#9FF7E8',
  teal: '#2E8C7C',
  mentheClair: '#E6FBF8',
} as const;

export const POLICE = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";
const SITE = 'https://www.simatis.fr';
const LOGO = `${SITE}/assets/logo-simatis-crop.png`;
// Images des mails, servies par le site (formats lus par toutes les messageries : PNG et JPEG, jamais SVG).
const PHOTO_MARC = `${SITE}/assets/mail/marc-tabouret-192.jpg`;
export const LOGOS_OUTILS = {
  testVma: `${SITE}/assets/mail/logo-test-vma.png`,
  testVmaBlanc: `${SITE}/assets/mail/logo-test-vma-blanc.png`,
} as const;

const C = COULEURS;

export const echapper = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const CIVILITES = /^(m\.|mme|mlle|monsieur|madame|mademoiselle|dr|pr)\.?$/i;
const enMajuscules = (m: string) => m.length > 1 && m === m.toUpperCase() && m !== m.toLowerCase();

// Les mails saluent par le prénom seul. Le nom de famille est souvent saisi en majuscules, avant ou
// après le prénom (« Jeanne DUPONT », « DUPONT Jeanne ») : on garde le premier mot qui ne l'est pas.
export function prenomDe(nomComplet: string): string {
  const mots = nomComplet
    .trim()
    .split(/\s+/)
    .filter((m) => m && !CIVILITES.test(m));
  return mots.find((m) => !enMajuscules(m)) ?? mots[0] ?? '';
}

// « Bonjour Jeanne, » ; `Bonjour,` sans nom. Renvoie du HTML déjà échappé.
export function salutation(nomComplet: string | null | undefined): string {
  const prenom = nomComplet ? prenomDe(nomComplet) : '';
  return prenom ? `Bonjour ${echapper(prenom)},` : 'Bonjour,';
}

// Paragraphe du gabarit ; `contenu` est du HTML déjà échappé.
export const paragraphe = (contenu: string, extra = '') =>
  `<p style="margin:0 0 14px;font:16px/1.6 ${POLICE};color:${C.nuit};${extra}">${contenu}</p>`;

// Bouton plein, comme sur le site ; `libelle` est du texte brut, `lien` une adresse https.
export const bouton = (libelle: string, lien: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr><td style="background:${C.marine};border-radius:6px;"><a href="${echapper(lien)}" style="display:inline-block;padding:14px 28px;font:700 16px/1.2 ${POLICE};color:#FFFFFF;text-decoration:none;border-radius:6px;">${echapper(libelle)}&nbsp;&rarr;</a></td></tr></table>`;

// Signature : photo, nom en gras, fonction, adresse et site. Même police que le texte, séparée par un filet.
export const signature = (tutoiement = false) =>
  `<tr><td style="padding:26px 32px 30px;">${paragraphe(tutoiement ? 'Bien à toi,' : 'Bien à vous,', 'margin:0 0 18px;')}
<table role="presentation" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.trait};width:100%;"><tr>
<td valign="top" width="76" style="padding:18px 16px 0 0;width:76px;"><img src="${PHOTO_MARC}" alt="Marc Tabouret" width="64" height="64" style="display:block;border:0;width:64px;height:64px;border-radius:32px;"></td>
<td valign="top" style="padding:18px 0 0;font:15px/1.5 ${POLICE};color:${C.nuit};">
<div style="font:700 16px/1.4 ${POLICE};color:${C.marine};">Marc Tabouret</div>
<div style="color:${C.roche};">Directeur commercial en mode partagé · SIMATIS</div>
<div style="margin-top:4px;"><a href="mailto:marc.tabouret@simatis.fr" style="color:${C.teal};text-decoration:none;font-weight:600;">marc.tabouret@simatis.fr</a> <span style="color:${C.trait};">|</span> <a href="${SITE}" style="color:${C.teal};text-decoration:none;font-weight:600;">simatis.fr</a></div>
</td></tr></table></td></tr>`;

// Signature courte (mails d'outil, comme le résultat du Test de VMA) : photo, nom, fonction et site, sans formule.
export const signatureCourte = () =>
  `<tr><td style="padding:30px 32px 28px;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.trait};width:100%;"><tr>
<td valign="middle" width="64" style="padding:18px 14px 0 0;width:64px;"><img src="${PHOTO_MARC}" alt="Marc Tabouret" width="52" height="52" style="display:block;border:0;width:52px;height:52px;border-radius:26px;"></td>
<td valign="middle" style="padding:18px 0 0;font:14px/1.5 ${POLICE};color:${C.roche};">
<div style="font:700 15px/1.4 ${POLICE};color:${C.marine};">Marc Tabouret</div>
<div>Directeur commercial en mode partagé · SIMATIS</div>
<div><a href="${SITE}" style="color:${C.teal};text-decoration:none;font-weight:600;">simatis.fr</a></div>
</td></tr></table></td></tr>`;

// En-tête d'un outil (Test de VMA…) : son logo et son nom, à droite du logo SIMATIS.
export type EnteteOutil = { logo: string; titre: string };
// Les mails du Test de VMA portent le logo de l'outil, comme les pages du test sur le site.
export const ENTETE_TEST_VMA: EnteteOutil = { logo: LOGOS_OUTILS.testVma, titre: 'Test de VMA' };

// Habille des lignes de tableau (`<tr>…`) : en-tête (logo SIMATIS, outil éventuel), filet aux couleurs du site,
// contenu, signature (sauf si le contenu porte la sienne), pied nuit. `apercu` : la ligne que la messagerie
// affiche sous l'objet, cachée dans le mail lui-même.
export function habillerMail(
  lignes: string,
  options: {
    signature?: boolean;
    tutoiement?: boolean;
    entete?: EnteteOutil;
    apercu?: string;
    // Mails d'outil : signature courte et, à la place du pied nuit, une ligne discrète sous le cadre.
    signatureCourte?: boolean;
    piedDiscret?: string;
  } = {},
): string {
  const apercu = options.apercu
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${C.glacier};">${echapper(options.apercu)}</div>`
    : '';
  const outil = options.entete
    ? `<td align="right" valign="middle" style="padding:0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding:0 10px 0 0;font:700 12px/1.3 ${POLICE};letter-spacing:1.5px;text-transform:uppercase;color:${C.teal};text-align:right;white-space:nowrap;">${echapper(options.entete.titre)}</td><td valign="middle"><img src="${echapper(options.entete.logo)}" alt="" width="80" height="67" style="display:block;border:0;width:80px;height:auto;"></td></tr></table></td>`
    : '';
  return `<div style="margin:0;padding:32px 12px;background:${C.glacier};">${apercu}
<table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${C.trait};border-radius:12px;overflow:hidden;border-collapse:separate;">
<tr><td style="padding:20px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding:0;"><a href="${SITE}"><img src="${LOGO}" alt="SIMATIS, conseil et formation" width="140" style="display:block;border:0;width:140px;height:auto;"></a></td>${outil}</tr></table></td></tr>
<tr><td style="padding:0;font-size:0;line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="28%" style="height:4px;background:${C.teal};font-size:0;line-height:0;">&nbsp;</td><td style="height:4px;background:${C.menthe};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
${lignes}
${options.signature === false ? '' : options.signatureCourte ? signatureCourte() : signature(options.tutoiement)}
${options.piedDiscret === undefined ? `<tr><td style="background:${C.nuit};padding:18px 32px;font:12px/1.6 ${POLICE};color:#C9D6E8;text-align:center;"><div style="font:700 12px/1.6 ${POLICE};letter-spacing:1.5px;text-transform:uppercase;color:${C.menthe};">SIMATIS</div><div>Direction commerciale en mode partagé · Conseil et formation</div><div><a href="${SITE}" style="color:${C.menthe};text-decoration:none;">simatis.fr</a></div></td></tr>` : ''}
</table>${options.piedDiscret ? `<div style="max-width:600px;margin:14px auto 0;font:12px/1.5 ${POLICE};color:${C.roche};text-align:center;">${echapper(options.piedDiscret)}</div>` : ''}</div>`;
}

// Mail courant : du HTML libre (déjà échappé) dans une seule cellule du gabarit.
export const habillerTexte = (
  html: string,
  options: {
    signature?: boolean;
    tutoiement?: boolean;
    entete?: EnteteOutil;
    apercu?: string;
  } = {},
) =>
  habillerMail(
    `<tr><td style="padding:28px 32px 4px;font:16px/1.6 ${POLICE};color:${C.nuit};">${html}</td></tr>`,
    options,
  );
