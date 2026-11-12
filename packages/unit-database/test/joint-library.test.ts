import { describe, expect, it } from 'vitest';
import { GROUND_FORCE_KINDS, type UnitKind } from '@warcommand/simulation-core';
import { getPlatform, JOINT_STAT_LABELS, PLATFORMS, toPerf, type PlatformRecord } from '../src/index';

const records: PlatformRecord[] = Object.values(PLATFORMS);
const ofKind = (kind: UnitKind) => records.filter((r) => r.kind === kind);

describe('bibliothèque interarmées', () => {
  it('offre une formation générique pour chaque type d’unité terrestre demandé', () => {
    for (const kind of [...GROUND_FORCE_KINDS, 'sof'] as UnitKind[]) {
      const found = ofKind(kind);
      expect(found.length, kind).toBeGreaterThan(0);
      for (const r of found) {
        const p = toPerf(r);
        expect(r.generic, r.id).toBe(true);
        expect(r.domain, r.id).toBe('ground');
        expect(p.combat, r.id).toBeGreaterThan(0);
        expect(p.spotKm, r.id).toBeGreaterThan(0);
        // Une formation terrestre n'a ni radar ni missiles : elle se bat au contact.
        expect(p.radarRangeKm, r.id).toBe(0);
        expect(p.weapon, r.id).toBe('none');
        if (kind !== 'sof') expect(p.cruiseKmh, r.id).toBeGreaterThan(0);
      }
    }
  });

  it('donne à chaque spécialité terrestre ce qui la distingue', () => {
    const perf = (kind: UnitKind) => toPerf(ofKind(kind)[0]!);
    expect(perf('armor').combat).toBeGreaterThan(perf('mech').combat);
    expect(perf('mech').combat).toBeGreaterThan(perf('infantry').combat);
    expect(perf('artillery').supportKm).toBeGreaterThan(10);
    expect(perf('artillery').support).toBeGreaterThan(0);
    expect(perf('recon').spotKm).toBeGreaterThan(perf('infantry').spotKm);
    expect(perf('recon').cruiseKmh).toBeGreaterThan(perf('armor').cruiseKmh);
    expect(perf('logistics').cargo).toBeGreaterThan(0);
    expect(perf('hq').commandKm).toBeGreaterThan(0);
    // Seule l'artillerie appuie à distance, seule la logistique transporte, seul le PC commande.
    expect(perf('infantry').supportKm).toBe(0);
    expect(perf('infantry').cargo).toBe(0);
    expect(perf('infantry').commandKm).toBe(0);
  });

  it('offre les classes de bâtiments demandées, toutes génériques', () => {
    const carrier = toPerf(ofKind('carrier')[0]!);
    expect(carrier.deck).toBeGreaterThan(0);
    expect(carrier.hull).toBeGreaterThanOrEqual(3);

    const sub = toPerf(ofKind('sub')[0]!);
    expect(sub.torpedoCount).toBeGreaterThan(0);
    expect(sub.torpedoKm).toBeGreaterThan(0);
    expect(sub.sonarKm).toBeGreaterThan(0);
    expect(sub.radarRangeKm).toBe(0);
    expect(sub.hull).toBe(1);

    expect(toPerf(ofKind('amphib')[0]!).lift).toBeGreaterThan(0);
    expect(ofKind('supply').length).toBe(1);

    const destroyer = toPerf(getPlatform('destroyer-generic'));
    expect(destroyer.kind).toBe('ship');
    expect(destroyer.ssmCount).toBeGreaterThan(0);
    expect(destroyer.ssmRangeKm).toBeGreaterThan(0);
    expect(destroyer.sonarKm).toBeGreaterThan(0);

    for (const kind of ['carrier', 'sub', 'amphib', 'supply', 'ship'] as UnitKind[]) {
      for (const r of ofKind(kind)) {
        expect(r.generic, r.id).toBe(true);
        expect(r.domain, r.id).toBe('surface');
        expect(toPerf(r).hull, r.id).toBeGreaterThan(0);
      }
    }
  });

  it('étiquette « estimation » toutes les valeurs interarmées et leur donne un libellé', () => {
    expect(records.filter((r) => r.joint && Object.keys(r.joint).length > 0).length).toBeGreaterThan(10);
    for (const r of records) {
      for (const [key, datum] of Object.entries(r.joint ?? {})) {
        expect(datum.provenance, `${r.id}.${key}`).toBe('estimation');
        expect(datum.basis.trim().length, `${r.id}.${key}`).toBeGreaterThan(0);
        expect(JOINT_STAT_LABELS[key as keyof typeof JOINT_STAT_LABELS], key).toBeDefined();
      }
    }
  });

  it('laisse à zéro les valeurs interarmées des matériels qui n’en relèvent pas', () => {
    const rafale = toPerf(getPlatform('rafale'));
    expect([rafale.combat, rafale.hull, rafale.ssmCount, rafale.cargo]).toEqual([0, 0, 0, 0]);
    expect(rafale.carrierCapable).toBe(true);
    expect(toPerf(getPlatform('su35s')).carrierCapable).toBe(false);
  });
});
