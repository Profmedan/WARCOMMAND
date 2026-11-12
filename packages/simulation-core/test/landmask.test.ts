import { describe, expect, it } from 'vitest';
import { distanceKm, firstLandToward, isLand, pathAtSea, pathOnLand } from '../src/index';

const ICELAND_CENTER = { lat: 64.9, lon: -18.5 };
const ICELAND_EAST = { lat: 65.2, lon: -15.2 };
const NORWEGIAN_SEA = { lat: 67.0, lon: -11.0 };
const SEA_EAST_OF_ICELAND = { lat: 64.9, lon: -11.5 };
const NORWAY_INLAND = { lat: 61.5, lon: 9.0 };

describe('masque terre-mer', () => {
  it('distingue la terre de la mer sur des points connus', () => {
    expect(isLand(ICELAND_CENTER)).toBe(true);
    expect(isLand(NORWAY_INLAND)).toBe(true);
    expect(isLand({ lat: 48.85, lon: 2.35 })).toBe(true);
    expect(isLand(NORWEGIAN_SEA)).toBe(false);
    expect(isLand({ lat: 0, lon: -30 })).toBe(false);
    expect(isLand({ lat: 35, lon: 18 })).toBe(false);
  });

  it('un trajet terrestre ne peut pas traverser la mer', () => {
    expect(pathOnLand(ICELAND_CENTER, ICELAND_EAST)).toBe(true);
    expect(pathOnLand(ICELAND_EAST, NORWAY_INLAND)).toBe(false);
    expect(pathOnLand(ICELAND_EAST, SEA_EAST_OF_ICELAND)).toBe(false);
  });

  it('un trajet maritime ne peut pas traverser la terre', () => {
    expect(pathAtSea(NORWEGIAN_SEA, SEA_EAST_OF_ICELAND)).toBe(true);
    // De part et d'autre de l'Islande : la ligne droite coupe l'île.
    expect(pathAtSea(SEA_EAST_OF_ICELAND, { lat: 64.9, lon: -26.5 })).toBe(false);
    expect(pathAtSea(SEA_EAST_OF_ICELAND, ICELAND_CENTER)).toBe(false);
  });

  it('trouve le premier point à terre en allant du large vers l’intérieur', () => {
    const beach = firstLandToward(SEA_EAST_OF_ICELAND, ICELAND_CENTER);
    expect(beach).not.toBeNull();
    expect(isLand(beach!)).toBe(true);
    // Le point trouvé est bien sur la côte est, pas au centre de l'île.
    expect(distanceKm(beach!, SEA_EAST_OF_ICELAND)).toBeLessThan(140);
    expect(distanceKm(beach!, ICELAND_CENTER)).toBeGreaterThan(150);
    // En pleine mer, vers un autre point en mer : aucune côte.
    expect(firstLandToward(NORWEGIAN_SEA, SEA_EAST_OF_ICELAND)).toBeNull();
  });
});
