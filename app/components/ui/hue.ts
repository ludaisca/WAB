// Hue determinista por entidad (cuentas WhatsApp) — mismo hash *31 que el
// hashTone histórico de chat-workspace, pero sobre las 8 clases .hue-N de
// globals.css en vez de los 5 tonos semánticos de Badge. La clase hue-N solo
// setea --entity/--entity-bg; el color se consume vía las utilidades
// bg-entity / text-entity / bg-entity-bg (responden al toggle light/dark en CSS).
// Nunca interpolar `hue-${n}` — Tailwind v4 sin safelist exige strings literales.

export type HueIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function hueIndex(id: string): HueIndex {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (hash % 8) as HueIndex;
}

export const HUE_CLASS: Record<HueIndex, string> = {
  0: "hue-0",
  1: "hue-1",
  2: "hue-2",
  3: "hue-3",
  4: "hue-4",
  5: "hue-5",
  6: "hue-6",
  7: "hue-7",
};

export function hueClassFor(id: string): string {
  return HUE_CLASS[hueIndex(id)];
}
