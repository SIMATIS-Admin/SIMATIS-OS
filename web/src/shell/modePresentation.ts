import { createContext, useContext } from 'react';

// Mode présentation : l'OS cache sa barre du haut et sa console pour montrer une présentation en grand.
// L'état vit dans App (qui masque le cadre) ; les diaporamas ne font que le lire et le basculer.
export type ModePresentation = { actif: boolean; basculer: () => void };

export const ModePresentationContext = createContext<ModePresentation>({
  actif: false,
  basculer: () => {},
});

export const useModePresentation = () => useContext(ModePresentationContext);

// Les écrans de présentation : seuls eux peuvent passer en mode présentation.
export const VUES_PRESENTATION = [
  'presentation-diagnostic',
  'presentation-vma',
  'presentation-simatis',
];
export const estVuePresentation = (view: string) => VUES_PRESENTATION.includes(view);
