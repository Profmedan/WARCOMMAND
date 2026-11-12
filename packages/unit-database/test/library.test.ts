import { describe, expect, it } from 'vitest';
import { libraryGroups, PLATFORMS, toPerf, type PlatformRecord } from '../src/index';

const records = Object.values(PLATFORMS);
const of = (coalition: string, kind: string) => records.filter((r) => r.coalition === coalition && r.kind === kind);

describe('bibliothèque des forces', () => {
  it('offre à chaque coalition plusieurs chasseurs, un avion-radar et un ravitailleur', () => {
    for (const coalition of ['occidentale', 'rouge']) {
      expect(of(coalition, 'fighter').length, `chasseurs ${coalition}`).toBeGreaterThanOrEqual(4);
      expect(of(coalition, 'aew').length, `avion-radar ${coalition}`).toBeGreaterThanOrEqual(1);
      expect(of(coalition, 'tanker').length, `ravitailleur ${coalition}`).toBeGreaterThanOrEqual(1);
    }
    expect(of('générique', 'sam').length).toBeGreaterThanOrEqual(2);
    expect(of('générique', 'ship').length).toBeGreaterThanOrEqual(2);
  });

  it('chaque fiche donne au moteur des valeurs cohérentes', () => {
    for (const record of records) {
      const p = toPerf(record);
      const tag = record.id;
      expect(p.id).toBe(record.id);
      expect(p.reliability, tag).toBeGreaterThan(0);
      expect(p.reliability, tag).toBeLessThanOrEqual(1);
      if (record.domain === 'air') {
        expect(p.cruiseKmh, tag).toBeGreaterThan(0);
        expect(p.dashKmh, tag).toBeGreaterThanOrEqual(p.cruiseKmh);
        expect(p.ceilingM, tag).toBeGreaterThanOrEqual(8000);
        expect(p.burnDashKgMin, tag).toBeGreaterThanOrEqual(p.burnCruiseKgMin);
        // Endurance de jeu en croisière : entre une heure et trente heures.
        const enduranceMin = p.fuelCapacityKg / p.burnCruiseKgMin;
        expect(enduranceMin, tag).toBeGreaterThanOrEqual(60);
        expect(enduranceMin, tag).toBeLessThanOrEqual(30 * 60);
        expect(p.turnaroundMin, tag).toBeGreaterThan(0);
      } else if (p.weapon === 'sam') {
        // Plate-forme sol-air ou bâtiment armé : le radar porte plus loin que les missiles.
        expect(p.antennaHeightM, tag).toBeGreaterThan(0);
        expect(p.radarRangeKm, tag).toBeGreaterThan(p.weaponRangeKm);
      } else {
        // Formation terrestre, sous-marin, navire logistique : aucun missile sol-air.
        expect(p.weapon, tag).toBe('none');
        expect(p.weaponCount, tag).toBe(0);
      }
      if (record.kind === 'fighter') {
        expect(p.weapon, tag).toBe('aam');
        expect(p.radarRangeKm, tag).toBeGreaterThan(0);
        expect(p.radarArcDeg, tag).toBeLessThan(360);
        expect(p.loadouts.length, tag).toBeGreaterThanOrEqual(1);
        // L'emport par défaut est l'emport air-air complet ; aucun emport ne dépasse la capacité.
        expect(p.loadouts[0]!.aam, tag).toBe(p.weaponCount);
        for (const l of p.loadouts) expect(l.aam, `${tag}/${l.id}`).toBeLessThanOrEqual(p.weaponCount);
        if (p.loadouts.some((l) => l.asm > 0)) expect(p.asmRangeKm, tag).toBeGreaterThan(0);
        expect(p.ecm, tag).toBeLessThanOrEqual(0.3);
      }
      if (record.kind === 'aew') {
        expect(p.radarArcDeg, tag).toBe(360);
        expect(p.radarRangeKm, tag).toBeGreaterThanOrEqual(300);
      }
      if (record.kind === 'tanker') expect(p.transferFuelKg, tag).toBeGreaterThan(0);
      if (record.kind === 'drone') expect(p.eoRangeKm, tag).toBeGreaterThan(0);
    }
  });

  it('étiquette la provenance de chaque valeur et n’avance aucune donnée publique sans source', () => {
    for (const record of records) {
      expect(record.sources.length, record.id).toBeGreaterThan(0);
      expect(record.dataDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const [key, datum] of Object.entries(record.game)) {
        expect(['publique', 'estimation'], `${record.id}.${key}`).toContain(datum.provenance);
        expect(datum.basis.trim().length, `${record.id}.${key}`).toBeGreaterThan(0);
      }
      for (const ref of record.reference) {
        expect(ref.source.trim().length, `${record.id} : ${ref.label}`).toBeGreaterThan(0);
        expect(['élevée', 'moyenne', 'faible']).toContain(ref.confidence);
      }
      // Un matériel générique ne se réclame d'aucun système réel.
      if (record.generic) {
        expect(record.reference, record.id).toEqual([]);
        expect(record.coalition).toBe('générique');
      }
    }
  });

  it('classe tous les matériels, une seule fois, pour la palette de l’éditeur', () => {
    const groups = libraryGroups();
    expect(groups.map((g) => g.coalition)).toEqual(['occidentale', 'rouge', 'générique']);
    const listed: PlatformRecord[] = groups.flatMap((g) => g.records);
    expect(listed.map((r) => r.id).sort()).toEqual(records.map((r) => r.id).sort());
    // Dans chaque groupe : chasseurs d'abord, puis soutien, puis bâtiments, puis sol-air et formations terrestres.
    const order = [
      'fighter', 'aew', 'tanker', 'drone',
      'carrier', 'ship', 'sub', 'amphib', 'supply',
      'sam', 'infantry', 'mech', 'armor', 'artillery', 'engineer', 'recon', 'logistics', 'hq', 'sof',
    ];
    for (const g of groups) {
      const ranks = g.records.map((r) => order.indexOf(r.kind));
      expect(ranks, g.coalition).toEqual([...ranks].sort((a, b) => a - b));
      expect(g.label.length).toBeGreaterThan(0);
    }
  });
});
