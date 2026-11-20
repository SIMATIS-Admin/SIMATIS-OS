// Durée du test chronométrée par le site : 432 s -> « 7 min 12 s », 45 s -> « 45 s ».
export function dureeLisible(s: number): string {
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return min === 0 ? `${sec} s` : `${min} min ${String(sec).padStart(2, '0')} s`;
}
