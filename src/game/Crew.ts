/**
 * Your crew.
 *
 * Justin's rules: you make it yourself - name, colour, and a shape - and it
 * grows on aura. **One rider for every 100 aura, four at the most**, and the
 * number of riders IS the crew's level. So a crew of four is a level four crew,
 * which is as high as it goes and takes four hundred aura to get to.
 *
 * Aura only comes from taking wheelie battles off people, so a crew is a thing
 * you are seen to have earned rather than a thing you bought.
 */

export type CrewShape = 'star' | 'skull' | 'bolt' | 'crown' | 'flag' | 'anchor';

export const CREW_SHAPES: CrewShape[] = ['star', 'skull', 'bolt', 'crown', 'flag', 'anchor'];

export const SHAPE_LABELS: Record<CrewShape, string> = {
  star: 'STAR',
  skull: 'CALAVERA',
  bolt: 'RAYO',
  crown: 'CORONA',
  flag: 'BANDERA',
  anchor: 'ANCLA',
};

/** The colours a crew can fly. Named, because "#d8232a" is not a choice. */
export const CREW_COLORS: Array<{ id: string; name: string; hex: string; ink: string }> = [
  { id: 'rojo', name: 'ROJO', hex: '#d8232a', ink: '#ffffff' },
  { id: 'azul', name: 'AZUL', hex: '#1c3d8f', ink: '#ffffff' },
  { id: 'cielo', name: 'CIELO', hex: '#7fc8e8', ink: '#0d1117' },
  { id: 'verde', name: 'VERDE', hex: '#1f8f5a', ink: '#ffffff' },
  { id: 'oro', name: 'ORO', hex: '#e0a13a', ink: '#14161c' },
  { id: 'morado', name: 'MORADO', hex: '#7a3fc0', ink: '#ffffff' },
  { id: 'negro', name: 'NEGRO', hex: '#14161c', ink: '#f2f2ee' },
  { id: 'blanco', name: 'BLANCO', hex: '#f2f2ee', ink: '#14161c' },
];

export interface Crew {
  /** Up to twelve characters, upper case. Empty means no crew yet. */
  name: string;
  /** Index into CREW_COLORS. */
  color: string;
  shape: CrewShape;
}

export const NO_CREW: Crew = { name: '', color: 'rojo', shape: 'star' };

/** Aura per rider. Justin's number. */
export const AURA_PER_RIDER = 100;
/** And the ceiling. A crew is four, and four is level four. */
export const MAX_CREW = 4;

/**
 * How many riders your aura holds together, which is also the crew's level.
 *
 * Deliberately the same number: Justin asked for "each number represents their
 * level as a crew", so a level three crew is three riders and there is nothing
 * else to explain.
 */
export function crewSize(aura: number): number {
  return Math.max(0, Math.min(MAX_CREW, Math.floor(aura / AURA_PER_RIDER)));
}

/** Aura still needed for the next one, or 0 once the crew is full. */
export function auraToNext(aura: number): number {
  const size = crewSize(aura);
  if (size >= MAX_CREW) return 0;
  return (size + 1) * AURA_PER_RIDER - aura;
}

export function colorOf(id: string): { hex: string; ink: string; name: string } {
  return CREW_COLORS.find((c) => c.id === id) ?? CREW_COLORS[0];
}

/** A name is legal if it is one to fourteen of letters, digits, spaces or dashes. */
export function cleanCrewName(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9ÑÁÉÍÓÚ \-']/g, '').slice(0, 14).trim();
}
