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
const LOGO = 'https://www.simatis.fr/assets/logo-simatis-crop.png';
const SITE = 'https://www.simatis.fr';

const C = COULEURS;

export const echapper = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Paragraphe du gabarit ; `contenu` est du HTML déjà échappé.
export const paragraphe = (contenu: string, extra = '') =>
  `<p style="margin:0 0 14px;font:16px/1.6 ${POLICE};color:${C.nuit};${extra}">${contenu}</p>`;

// Bouton plein, comme sur le site ; `libelle` est du texte brut, `lien` une adresse https.
export const bouton = (libelle: string, lien: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 16px;"><tr><td style="background:${C.marine};border-radius:4px;"><a href="${echapper(lien)}" style="display:inline-block;padding:12px 24px;font:700 16px/1.2 ${POLICE};color:#FFFFFF;text-decoration:none;">${echapper(libelle)}</a></td></tr></table>`;

// Signature : même police, même taille et même couleur que le texte ; seul le nom est en gras.
export const signature = () =>
  `<tr><td style="padding:28px 32px 30px;font:16px/1.6 ${POLICE};color:${C.nuit};">${paragraphe('Bien à vous,', 'margin:0 0 10px;')}
<div><strong>Marc Tabouret</strong></div>
<div>Directeur commercial en mode partagé · SIMATIS</div>
<div><a href="mailto:marc.tabouret@simatis.fr" style="color:${C.nuit};text-decoration:underline;">marc.tabouret@simatis.fr</a></div></td></tr>`;

// Habille des lignes de tableau (`<tr>…`) : logo, filet menthe, contenu, signature (sauf si le
// contenu porte la sienne), pied nuit.
export function habillerMail(lignes: string, options: { signature?: boolean } = {}): string {
  return `<div style="margin:0;padding:24px 12px;background:${C.glacier};">
<table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:8px;overflow:hidden;">
<tr><td style="padding:22px 32px 18px;border-bottom:4px solid ${C.menthe};"><a href="${SITE}"><img src="${LOGO}" alt="SIMATIS, conseil et formation" width="150" style="display:block;border:0;height:auto;"></a></td></tr>
${lignes}
${options.signature === false ? '' : signature()}
<tr><td style="background:${C.nuit};padding:14px 32px;font:12px/1.5 ${POLICE};color:${C.menthe};text-align:center;"><a href="${SITE}" style="color:${C.menthe};text-decoration:none;">simatis.fr</a></td></tr>
</table></div>`;
}

// Mail courant : du HTML libre (déjà échappé) dans une seule cellule du gabarit.
export const habillerTexte = (html: string, options: { signature?: boolean } = {}) =>
  habillerMail(
    `<tr><td style="padding:26px 32px 4px;font:16px/1.6 ${POLICE};color:${C.nuit};">${html}</td></tr>`,
    options,
  );
