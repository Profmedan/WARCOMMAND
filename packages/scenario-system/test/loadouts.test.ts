import { describe, expect, it } from 'vitest';
import { hashState, stepState, type SimState } from '@warcommand/simulation-core';
import { AIR_SYSTEMS, applyOrder, observe, type Order } from '@warcommand/air-operations';
import { draft, freshState } from './helpers';

/** État avec un stock de munitions air-surface à la base bleue et une frégate rouge identifiée. */
function seadSetup(asmStock: number): { s: SimState; target: string } {
  const s = freshState();
  s.bases['base-bouclier']!.asmStock = asmStock;
  const contact = observe(s, 'BLUE', s.units['red-frg']!, true);
  return { s, target: contact.id };
}

const sead = (target: string, unitIds: string[], over: Partial<Parameters<typeof draft>[0]> = {}): Order => ({
  type: 'CREATE_MISSION',
  side: 'BLUE',
  draft: draft({ type: 'SEAD', unitIds, waypoints: [], targetContactId: target, altM: 500, roe: 'free', launchAt: 0, ...over }),
});

describe('emports', () => {
  it('une mission SEAD fait passer l’appareil au sol en emport air-surface, sur les stocks de la base', () => {
    const { s, target } = seadSetup(8);
    const base = s.bases['base-bouclier']!;
    const u = s.units['blue-raf-1']!;
    expect([u.loadoutId, u.weapons, u.asm]).toEqual(['air-air', 6, 0]);

    const res = applyOrder(s, sead(target, [u.id]));
    expect(res.ok).toBe(true);
    expect([u.loadoutId, u.weapons, u.asm]).toEqual(['sead', 2, 4]);
    // 6 missiles air-air rendus, 2 repris ; 4 munitions air-surface prélevées.
    expect(base.weaponStock).toBe(24 + 6 - 2);
    expect(base.asmStock).toBe(8 - 4);
  });

  it('le changement d’emport retarde le décollage de dix minutes', () => {
    const { s, target } = seadSetup(8);
    const u = s.units['blue-raf-1']!;
    const res = applyOrder(s, sead(target, [u.id]));
    const mission = s.missions[(res as { missionId: string }).missionId]!;
    expect(mission.launchAt).toBe(600);
    for (let i = 0; i < 599; i++) stepState(s, AIR_SYSTEMS);
    expect(u.status).toBe('ready');
    stepState(s, AIR_SYSTEMS);
    stepState(s, AIR_SYSTEMS);
    expect(u.status).toBe('airborne');
  });

  it('refuse la mission SEAD sans munition air-surface, sans rien modifier', () => {
    const { s, target } = seadSetup(0);
    const before = hashState(s);
    expect(applyOrder(s, sead(target, ['blue-raf-1']))).toMatchObject({ ok: false, code: 'NO_ORDNANCE' });
    expect(hashState(s)).toBe(before);
  });

  it('sert un stock partiel plutôt que de refuser', () => {
    const { s, target } = seadSetup(3);
    const u = s.units['blue-raf-1']!;
    expect(applyOrder(s, sead(target, [u.id])).ok).toBe(true);
    expect(u.asm).toBe(3);
    expect(s.bases['base-bouclier']!.asmStock).toBe(0);
  });

  it('répartit un stock insuffisant entre les appareils de la mission, au lieu de tout donner au premier', () => {
    const { s, target } = seadSetup(4);
    expect(applyOrder(s, sead(target, ['blue-raf-1', 'blue-raf-2'])).ok).toBe(true);
    expect([s.units['blue-raf-1']!.asm, s.units['blue-raf-2']!.asm]).toEqual([2, 2]);
    expect(s.bases['base-bouclier']!.asmStock).toBe(0);

    const odd = seadSetup(5);
    expect(applyOrder(odd.s, sead(odd.target, ['blue-raf-1', 'blue-raf-2'])).ok).toBe(true);
    expect([odd.s.units['blue-raf-1']!.asm, odd.s.units['blue-raf-2']!.asm]).toEqual([3, 2]);
  });

  it('un appareil en vol ne peut pas changer d’emport', () => {
    const { s, target } = seadSetup(8);
    const u = s.units['blue-raf-1']!;
    u.status = 'airborne';
    u.altM = 9000;
    expect(applyOrder(s, sead(target, [u.id]))).toMatchObject({ ok: false, code: 'NO_ORDNANCE' });
    expect(applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: [u.id], loadoutId: 'sead' }) })).toMatchObject({ ok: false, code: 'BAD_LOADOUT' });
    expect(u.loadoutId).toBe('air-air');
  });

  it('refuse une cible qui n’est pas une défense sol-air identifiée, et un emport inconnu', () => {
    const { s } = seadSetup(8);
    const air = observe(s, 'BLUE', s.units['red-aew']!, true);
    expect(applyOrder(s, sead(air.id, ['blue-raf-1']))).toMatchObject({ ok: false, code: 'UNKNOWN_CONTACT' });
    expect(applyOrder(s, { type: 'CREATE_MISSION', side: 'BLUE', draft: draft({ unitIds: ['blue-raf-1'], loadoutId: 'bombes' }) })).toMatchObject({ ok: false, code: 'BAD_LOADOUT' });
  });

  it('la remise en condition réarme selon l’emport en cours', () => {
    const { s, target } = seadSetup(8);
    const u = s.units['blue-raf-1']!;
    applyOrder(s, sead(target, [u.id]));
    // L'appareil rentre à vide et se pose.
    u.status = 'turnaround';
    u.readyAt = s.time + 60;
    u.missionId = null;
    u.asm = 0;
    u.weapons = 0;
    for (let i = 0; i < 61; i++) stepState(s, AIR_SYSTEMS);
    expect(u.status).toBe('ready');
    expect([u.weapons, u.asm]).toEqual([2, 4]);
    expect(s.bases['base-bouclier']!.asmStock).toBe(0);
  });
});
