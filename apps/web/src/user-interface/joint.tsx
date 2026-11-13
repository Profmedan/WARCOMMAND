'use client';

/**
 * Fiches des composantes interarmées : formation terrestre, bâtiment, équipe d'opérations spéciales,
 * effets cyber et spatiaux. Comme le reste de l'interface, elles ne lisent que l'image du camp du
 * joueur et n'agissent que par des ordres soumis au moteur.
 */
import {
  clockZ,
  EFFECT_IDS,
  inCircle,
  SERVICE_IDS,
  type LandPosture,
  type LatLon,
  type SidePicture,
  type Unit,
} from '@warcommand/simulation-core';
import type { GameOrder } from '@warcommand/scenario-system';
import { Bar, Row } from './bits';
import {
  EFFECT_HELP,
  EFFECT_LABEL,
  formatLatLon,
  LAND_POSTURE_HELP,
  LAND_POSTURE_LABEL,
  SERVICE_HELP,
  SERVICE_LABEL,
  SOF_PHASE_LABEL,
  TERRAIN_LABEL,
} from './i18n';

/** Outil de désignation sur la carte propre à ces composantes. */
export type JointTool =
  | { type: 'land'; unitId: string; posture: 'move' | 'attack' | 'withdraw'; points: LatLon[] }
  | { type: 'beach'; shipId: string; unitId: string }
  | { type: 'sof'; unitId: string };

export interface JointProps {
  pic: SidePicture;
  unit: Unit;
  tool: JointTool | null;
  onOrder: (order: GameOrder) => void;
  onTool: (tool: JointTool | null) => void;
  /** Ouvre le planificateur sur une mission d'appui aérien centrée sur ce point. */
  onSupport: (at: LatLon) => void;
}

const pct = (v: number) => Math.round(v * 100);
const at = (pic: SidePicture, t: number) => `${clockZ(pic.startIso, t, false)} Z`;

function terrainOf(pic: SidePicture, pos: LatLon): keyof typeof TERRAIN_LABEL {
  return pic.terrain.find((zone) => inCircle(pos, zone))?.kind ?? 'ouvert';
}

const MOVING: { posture: 'move' | 'attack' | 'withdraw'; label: string }[] = [
  { posture: 'move', label: 'Déplacer' },
  { posture: 'attack', label: 'Attaquer' },
  { posture: 'withdraw', label: 'Décrocher' },
];

/* ------------------------------------------------------------------ Formation terrestre */

export function LandSection({ pic, unit, tool, onOrder, onTool, onSupport }: JointProps) {
  const l = unit.land;
  if (!l) return null;
  const p = pic.platforms[unit.platformId];
  const carrier = unit.status === 'embarked' ? pic.units.find((u) => u.naval?.troops.includes(unit.id)) : undefined;
  const routing = tool?.type === 'land' && tool.unitId === unit.id ? tool : null;
  const order = (posture: LandPosture, route: LatLon[]) => onOrder({ type: 'LAND_ORDER', side: pic.side, unitId: unit.id, posture, route });
  const state = [LAND_POSTURE_LABEL[l.posture], l.inContact ? 'au contact' : null, l.broken ? 'rompue' : null].filter(Boolean).join(' · ');

  return (
    <>
      <dl className="kvlist kvlist--spaced">
        {carrier ? <Row label="À bord de">{carrier.name}</Row> : null}
        {unit.status === 'active' ? <Row label="Posture">{state}</Row> : null}
        <Row label="Effectifs">
          <Bar value={pct(l.strength)} low={35} /> {pct(l.strength)} %
        </Row>
        <Row label="Moral">
          <Bar value={pct(l.morale)} low={30} /> {pct(l.morale)} %
        </Row>
        <Row label="Cohésion">
          <Bar value={pct(l.cohesion)} low={30} /> {pct(l.cohesion)} %
        </Row>
        <Row label="Fatigue">
          <Bar value={pct(l.fatigue)} low={30} inverse /> {pct(l.fatigue)} %
        </Row>
        <Row label="Ravitaillement">
          <Bar value={pct(l.supply)} /> {pct(l.supply)} %
        </Row>
        {l.dugIn > 0 ? <Row label="Retranchement">{pct(l.dugIn)} %</Row> : null}
        {p && p.cargo > 0 ? (
          <Row label="Chargement">
            {Math.round(l.cargo)} / {p.cargo} points{l.supplyPoint ? ` · distribue autour de ${formatLatLon(l.supplyPoint.lat, l.supplyPoint.lon)}` : ''}
          </Row>
        ) : null}
        {unit.status === 'active' ? (
          <>
            <Row label="Commandement">{l.inCommand ? 'dans le rayon d’un poste de commandement' : 'hors de tout rayon de commandement : délais doublés, puissance réduite'}</Row>
            <Row label="Terrain">{TERRAIN_LABEL[terrainOf(pic, unit.pos)]}</Row>
          </>
        ) : null}
        {l.pending ? (
          <Row label="Ordre transmis">
            {LAND_POSTURE_LABEL[l.pending.posture]}, exécution à {at(pic, l.pending.at)}
          </Row>
        ) : null}
        {l.casSince >= 0 ? <Row label="Appui aérien">demandé depuis {at(pic, l.casSince)}</Row> : null}
      </dl>

      {unit.status === 'active' ? (
        <>
          {routing ? (
            <div className="estimate">
              <strong>
                {MOVING.find((m) => m.posture === routing.posture)?.label} — {routing.points.length === 0 ? 'cliquez l’itinéraire sur la carte' : `${routing.points.length} point${routing.points.length > 1 ? 's' : ''} posé${routing.points.length > 1 ? 's' : ''}`}
              </strong>
              <small className="hint">{LAND_POSTURE_HELP[routing.posture]} Chaque tronçon doit rester à terre.</small>
              <div className="row">
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  disabled={routing.points.length === 0}
                  onClick={() => {
                    order(routing.posture, routing.points);
                    onTool(null);
                  }}
                >
                  Donner l’ordre
                </button>
                <button type="button" className="btn btn--small" onClick={() => onTool(null)}>
                  Abandonner
                </button>
              </div>
            </div>
          ) : (
            <div className="actions">
              {MOVING.map((m) => (
                <button key={m.posture} type="button" className="btn" title={LAND_POSTURE_HELP[m.posture]} disabled={m.posture === 'attack' && l.broken} onClick={() => onTool({ type: 'land', unitId: unit.id, posture: m.posture, points: [] })}>
                  {m.label}
                </button>
              ))}
              <button type="button" className="btn" title={LAND_POSTURE_HELP.defend} disabled={l.posture === 'defend' && unit.route.length === 0} onClick={() => order('defend', [])}>
                Défendre
              </button>
              <button type="button" className="btn" title={LAND_POSTURE_HELP.hold} disabled={l.posture === 'hold' && unit.route.length === 0} onClick={() => order('hold', [])}>
                Tenir
              </button>
              {l.inContact ? (
                <button type="button" className="btn btn--primary" onClick={() => onSupport(unit.pos)}>
                  Appui aérien
                </button>
              ) : null}
            </div>
          )}
          <p className="hint">Un ordre met du temps à parvenir à la formation : doctrine, état de vos réseaux, présence d’un poste de commandement à portée.</p>
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ Bâtiment */

export function NavalSection({ pic, unit, tool, onTool }: JointProps) {
  const n = unit.naval;
  if (!n) return null;
  const p = pic.platforms[unit.platformId];
  const leader = n.leaderId ? pic.units.find((u) => u.id === n.leaderId) : undefined;
  const escorts = pic.units.filter((u) => u.naval?.leaderId === unit.id && u.status === 'active');
  const hosted = pic.bases.filter((b) => b.hostUnitId === unit.id);
  const troops = n.troops.map((id) => pic.units.find((u) => u.id === id)).filter((u): u is Unit => u !== undefined);
  const landing = n.landing ? pic.units.find((u) => u.id === n.landing!.unitId) : undefined;

  return (
    <dl className="kvlist kvlist--spaced">
      {p && p.hull > 0 ? (
        <Row label="Coque">
          {n.hull} / {p.hull} point{p.hull > 1 ? 's' : ''}
          {unit.damaged ? ' — avarié : ni radar, ni tir, vitesse réduite de moitié' : ''}
        </Row>
      ) : null}
      {p && p.ssmCount > 0 ? (
        <Row label="Missiles antinavires">
          {n.ssm} / {p.ssmCount} · portée {p.ssmRangeKm} km
        </Row>
      ) : null}
      {p && p.torpedoCount > 0 ? (
        <Row label="Torpilles">
          {n.torpedoes} / {p.torpedoCount} · portée {p.torpedoKm} km
        </Row>
      ) : null}
      {p && p.sonarKm > 0 ? <Row label="Sonar">{p.sonarKm} km{unit.kind === 'sub' ? '' : ' (sous-marins seulement)'}</Row> : null}
      {leader ? <Row label="Escorte de">{leader.name}</Row> : null}
      {escorts.length > 0 ? <Row label="Escorté par">{escorts.map((u) => u.name).join(', ')}</Row> : null}
      {hosted.map((b) => (
        <Row key={b.id} label={p && p.deck > 0 ? 'Pont d’envol' : 'Dépôt flottant'}>
          {b.closed ? 'hors service' : p && p.deck > 0 ? `${pic.units.filter((u) => u.baseId === b.id && u.status !== 'destroyed').length} aéronef(s) rattaché(s)` : `${Math.round(b.supplyStock)} points de ravitaillement`}
        </Row>
      ))}
      {troops.map((t) => {
        const picking = tool?.type === 'beach' && tool.unitId === t.id;
        return (
          <Row key={t.id} label="À bord">
            {t.name}{' '}
            {landing?.id === t.id ? (
              <span className="muted">— débarquement en cours, à terre vers {at(pic, n.landing!.doneAt)}</span>
            ) : (
              <button type="button" className={`btn btn--small${picking ? ' is-on' : ''}`} disabled={unit.damaged || n.landing !== null} onClick={() => onTool(picking ? null : { type: 'beach', shipId: unit.id, unitId: t.id })}>
                {picking ? 'Cliquez la plage, à moins de 8 km' : 'Mettre à terre'}
              </button>
            )}
          </Row>
        );
      })}
    </dl>
  );
}

/* ------------------------------------------------------------------ Équipe d'opérations spéciales */

export function SofSection({ pic, unit, tool, onOrder, onTool }: JointProps) {
  const sof = unit.sof;
  if (!sof) return null;
  const p = pic.platforms[unit.platformId];
  const picking = tool?.type === 'sof' && tool.unitId === unit.id;
  const resting = sof.phase === 'ready' && unit.availableAt > pic.time;
  const moving = sof.phase === 'inserting' || sof.phase === 'extracting';

  return (
    <>
      <dl className="kvlist kvlist--spaced">
        <Row label="Situation">
          {SOF_PHASE_LABEL[sof.phase]}
          {sof.compromised ? ' · découverte' : ''}
          {moving ? ` — fin vers ${at(pic, sof.arriveAt)}` : ''}
          {resting ? ` — se reconditionne jusqu’à ${at(pic, unit.availableAt)}` : ''}
        </Row>
        {sof.target ? <Row label="Point d’observation">{formatLatLon(sof.target.lat, sof.target.lon)}</Row> : null}
        {p ? <Row label="Observation">{p.spotKm} km à la ronde, formations et bâtiments</Row> : null}
        <Row label="Rayon d’action">{pic.rules.sofRangeKm} km depuis sa base</Row>
      </dl>
      <div className="actions">
        {sof.phase === 'ready' && unit.status === 'ready' ? (
          <button type="button" className={`btn btn--primary${picking ? ' is-on' : ''}`} disabled={resting} onClick={() => onTool(picking ? null : { type: 'sof', unitId: unit.id })}>
            {picking ? 'Cliquez le point d’observation, à terre' : 'Infiltrer'}
          </button>
        ) : null}
        {sof.phase === 'observing' ? (
          <button type="button" className="btn" onClick={() => onOrder({ type: 'SOF_EXTRACT', side: pic.side, unitId: unit.id })}>
            Exfiltrer
          </button>
        ) : null}
      </div>
      <p className="hint">Résolution abstraite : l’infiltration peut échouer, l’équipe peut être découverte — d’autant plus que des formations adverses sont proches. Sans liaison par satellite, elle ne transmet rien.</p>
    </>
  );
}

/* ------------------------------------------------------------------ Effets cyber et spatiaux */

export function EffectsPanel({ pic, onOrder }: { pic: SidePicture; onOrder: (order: GameOrder) => void }) {
  const hasEffects = EFFECT_IDS.some((id) => pic.effects[id] > 0);
  const degraded = SERVICE_IDS.some((id) => pic.services.level[id] < 1);
  // Scénario sans composante multi-domaines : rien à montrer.
  if (!hasEffects && !degraded && pic.satellites.length === 0 && !pic.units.some((u) => u.land || u.sof)) return null;

  return (
    <details className="fold" open={degraded || hasEffects}>
      <summary>Cyber et espace</summary>
      <dl className="kvlist">
        {SERVICE_IDS.map((id) => {
          const level = pct(pic.services.level[id]);
          return (
            <Row key={id} label={SERVICE_LABEL[id]}>
              <span title={SERVICE_HELP[id]}>
                <Bar value={level} low={49} /> {level} %{level < 100 && pic.services.disruptedUntil[id] > pic.time ? ` · perturbés au moins jusqu’à ${at(pic, pic.services.disruptedUntil[id])}` : level < 100 ? ' · rétablissement en cours' : ''}
              </span>
            </Row>
          );
        })}
      </dl>
      {pic.satellites.map((pass) => (
        <p key={pass.id} className="muted">
          Satellite {pass.name} : {pass.phase === 'done' ? 'passage terminé' : pass.phase === 'open' ? `passage en cours jusqu’à ${at(pic, pass.endS)}` : `passage de ${at(pic, pass.startS)} à ${at(pic, pass.endS)}`} — empreinte de {Math.round(pass.footprint.radiusKm)} km.
        </p>
      ))}
      <div className="actions">
        {EFFECT_IDS.map((id) => (
          <button key={id} type="button" className="btn" title={EFFECT_HELP[id]} disabled={pic.effects[id] <= 0} onClick={() => onOrder({ type: 'USE_EFFECT', side: pic.side, effect: id })}>
            {EFFECT_LABEL[id]} ({pic.effects[id]})
          </button>
        ))}
      </div>
      <p className="hint">Effets abstraits, accordés par le scénario : ils abaissent pour un temps un service de l’adversaire, plus ou moins longtemps selon sa résilience.</p>
    </details>
  );
}
