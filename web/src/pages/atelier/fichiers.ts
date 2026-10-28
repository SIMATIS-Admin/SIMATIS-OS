// Téléchargement d'un texte par un lien temporaire, comme le faisait l'outil d'origine.
export function telecharger(nom: string, texte: string, mime: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texte], { type: mime }));
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
