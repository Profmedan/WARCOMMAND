'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { clockZ, type ContactView, type SidePicture, type SimEvent, type Unit } from '@warcommand/simulation-core';
import type { DomainFilter, LayerToggles, Selection } from '../world-map/scene';
import { SPEEDS, type NetStatus, type Speed } from './controller';
import {
  ALERT_CODES,
  CONTROL_LABEL,
  DOMAIN_LABEL,
  LAND_POSTURE_SHORT,
  SOF_PHASE_LABEL,
  formatCountdown,
  formatEvent,
  formatMinutes,
  KIND_CODE,
  KIND_LABEL,
  MISSION_STATUS_LABEL,
  MISSION_TYPE_LABEL,
  ROE_LABEL,
  SIDE_LABEL,
  STATUS_LABEL,
  TASK_LABEL,
} from './i18n';

const tone = (side: 'BLUE' | 'RED') => (side === 'BLUE' ? 'blue' : 'red');

/* ------------------------------------------------------------------ Bandeau supérieur */

interface TopBarProps {
  pic: SidePicture;
  events: SimEvent[];
  speed: Speed;
  ended: boolean;
  /** Fait-il nuit au-dessus du secteur ? */
  night: boolean;
  /** Durée d'un tour en secondes (mode par tours) ; 0 en temps continu. */
  turnS: number;
  /** Les ordres sont-ils recevables maintenant ? */
  planning: boolean;
  /** Partie à deux joueurs : état de la table. */
  net?: NetStatus | null;
  onSpeed: (speed: Speed) => void;
  /** Avance d'une minute ; absent quand la simulation ne tourne pas ici. */
  onStep?: () => void;
  onSave?: () => void;
  onExport?: () => void;
  onBriefing: () => void;
  onQuit: () => void;
  quitLabel: string;
  onDebrief: () => void;
}

export function TopBar({ pic, events, speed, ended, night, turnS, planning, net = null, onSpeed, onStep, onSave, onExport, onBriefing, onQuit, quitLabel, onDebrief }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const fighters = pic.units.filter((u) => u.kind === 'fighter');
  const ready = fighters.filter((u) => u.status === 'ready').length;
  const flying = fighters.filter((u) => u.status === 'airborne').length;
  const out = fighters.filter((u) => u.status === 'destroyed' || u.status === 'maintenance').length;
  const per = pic.objective.perceived;
  const own = per.sec[pic.side];

  let alert: SimEvent | null = null;
  for (let i = events.length - 1; i >= 0 && i >= events.length - 40; i--) {
    const e = events[i]!;
    if (pic.time - e.t > 90) break;
    if (ALERT_CODES.has(e.code)) {
      alert = e;
      break;
    }
  }
  const alertLine = alert ? formatEvent(alert, { startIso: pic.startIso, sectorName: pic.objective.name }) : null;

  return (
    <header className="topbar">
      <div className="topbar__title">
        <strong>WAR COMMAND</strong>
        <span>Air Operations Center</span>
      </div>

      <div className="topbar__status" aria-label="État de la coalition">
        <span className={`pill pill--${tone(pic.side)}`}>{SIDE_LABEL[pic.side]}</span>
        <span title="Chasseurs disponibles au sol · en vol · hors de combat">
          Chasse : {ready} prêts · {flying} en vol · {out} hors combat
        </span>
        <span title="Contrôle du secteur tel que vos capteurs le perçoivent. Le décompte réel est révélé au compte rendu.">
          {pic.objective.name} (estimé) : <b className={`txt--${per.status === 'CONTESTED' ? 'amber' : tone(per.status)}`}>{CONTROL_LABEL[per.status]}</b> ·{' '}
          {formatMinutes(own)} à vous
        </span>
      </div>

      <div className={`topbar__alert${alertLine ? ` tone--${alertLine.tone}` : ''}`} role="status">
        {alertLine ? alertLine.text : ''}
      </div>

      <div className="topbar__time">
        <div className="speed" role="group" aria-label="Contrôle du temps">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={`speed__btn${speed === s ? ' is-on' : ''}`} disabled={ended} onClick={() => onSpeed(s)} aria-pressed={speed === s}>
              {s === 0 ? 'PAUSE' : `×${s}`}
            </button>
          ))}
          {turnS === 0 && onStep ? (
            <button type="button" className="speed__btn" disabled={ended || speed !== 0} onClick={onStep} title="Avancer d’une minute de simulation">
              +1 min
            </button>
          ) : null}
        </div>
        {net && !ended ? <NetPill net={net} side={pic.side} /> : null}
        {turnS > 0 && !ended ? (
          <span className={`pill ${planning ? 'pill--plan' : 'pill--run'}`} title="Mode par tours : les ordres se donnent entre deux tours">
            Tour {Math.floor(pic.time / turnS) + 1} · {planning ? 'ordres' : 'résolution'}
          </span>
        ) : null}
        <div className="clock" title="Heure de simulation (Zulu), jour ou nuit au-dessus du secteur, temps restant">
          <strong>{clockZ(pic.startIso, pic.time)} Z</strong>
          <small>
            {night ? 'nuit' : 'jour'} · {ended ? 'mission terminée' : `reste ${formatCountdown(pic.endTime - pic.time)}`}
          </small>
        </div>
        <div className="menuwrap">
          <button type="button" className="iconbtn" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-label="Menu de la partie">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
              <circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="8" cy="17" r="2.2" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          {menuOpen ? (
            <div className="dropdown" onClick={() => setMenuOpen(false)}>
              <button type="button" onClick={onBriefing}>
                Briefing et objectif
              </button>
              {onSave ? (
                <button type="button" onClick={onSave}>
                  Sauvegarder dans le navigateur
                </button>
              ) : null}
              {onExport ? (
                <button type="button" onClick={onExport}>
                  Exporter la sauvegarde (.json)
                </button>
              ) : null}
              {ended ? (
                <button type="button" onClick={onDebrief}>
                  Compte rendu après action
                </button>
              ) : null}
              <button type="button" onClick={onQuit}>
                {quitLabel}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Partie à deux joueurs : qui est là, et à quelle vitesse la partie avance réellement. */
function NetPill({ net, side }: { net: NetStatus; side: SidePicture['side'] }) {
  const other = net.players[side === 'BLUE' ? 'RED' : 'BLUE'];
  const mine = net.requested[side];
  const theirs = net.requested[side === 'BLUE' ? 'RED' : 'BLUE'];
  const label = (v: number) => (v === 0 ? 'pause' : `×${v}`);
  let text: string;
  if (!net.online) text = 'hors ligne';
  else if (!other) text = `code ${net.code} · en attente`;
  else if (!other.connected) text = `${other.name} déconnecté`;
  else if (net.effective === 0 && mine > 0) text = `${other.name} demande la pause`;
  else text = `${other.name} : ${label(theirs)} · partie ${label(net.effective)}`;
  return (
    <span className={`pill ${net.online && other?.connected ? 'pill--plan' : 'pill--run'}`} title="Partie à deux joueurs : le temps avance à la plus lente des deux vitesses demandées.">
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------ Panneau gauche */

interface ForcesProps {
  pic: SidePicture;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  layers: LayerToggles;
  onLayers: (layers: LayerToggles) => void;
  domains: DomainFilter;
  onDomains: (domains: DomainFilter) => void;
  measuring: boolean;
  onMeasure: () => void;
}

const LAYER_LABEL: Record<keyof LayerToggles, string> = {
  units: 'Unités amies',
  contacts: 'Contacts',
  routes: 'Routes et missions',
  radar: 'Portées radar',
  weapons: 'Zones sol-air',
  sector: 'Secteur d’objectif',
  terrain: 'Terrain',
  graticule: 'Graticule',
};

function unitState(pic: SidePicture, u: Unit): string {
  if (u.status === 'airborne') {
    const cap = pic.platforms[u.platformId]?.fuelCapacityKg ?? 0;
    return `${TASK_LABEL[u.task]} · ${cap > 0 ? Math.round((100 * u.fuelKg) / cap) : 0} %`;
  }
  if ((u.status === 'turnaround' || u.status === 'maintenance') && u.readyAt !== null) {
    return `${u.status === 'maintenance' ? 'réparé' : u.fault ? 'panne, prêt' : 'prêt'} à ${clockZ(pic.startIso, u.readyAt, false)}`;
  }
  if (u.land) {
    if (u.status === 'embarked') return 'à bord';
    if (u.status === 'active') return `${u.land.broken ? 'rompue' : u.land.inContact ? 'contact' : LAND_POSTURE_SHORT[u.land.posture]} ${Math.round(u.land.strength * 100)} %`;
  }
  if (u.sof && u.status !== 'destroyed') return SOF_PHASE_LABEL[u.sof.phase];
  if (u.status === 'active') return u.damaged ? (u.naval ? 'avarié' : 'hors de combat') : u.suppressedUntil > pic.time ? 'radar coupé' : TASK_LABEL[u.task];
  return STATUS_LABEL[u.status].toLowerCase();
}

function contactText(c: ContactView): string {
  const what = c.identified ? (c.label ?? '') : `? (${DOMAIN_LABEL[c.domain]})`;
  return `${c.id} ${what}`;
}

export function ForcesPanel({ pic, selection, onSelect, layers, onLayers, domains, onDomains, measuring, onMeasure }: ForcesProps) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const match = (text: string) => q === '' || text.toLowerCase().includes(q);
  const enemy = pic.side === 'BLUE' ? 'RED' : 'BLUE';
  const contacts = pic.contacts.filter((c) => domains[c.domain] && match(contactText(c)));

  return (
    <aside className="panel forces">
      <h2>Forces</h2>
      <input className="input input--small" placeholder="Rechercher une unité…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher une unité" />

      <div className="forces__scroll">
        <h3 className={`txt--${tone(pic.side)}`}>{SIDE_LABEL[pic.side]}</h3>
        {pic.groups.map((g) => {
          const units = pic.units.filter((u) => u.groupId === g.id && domains[u.domain] && match(`${u.name} ${g.name}`));
          if (units.length === 0) return null;
          return (
            <div key={g.id} className="group">
              <div className="group__name">{g.name}</div>
              {units.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={`unitrow${selection?.type === 'unit' && selection.id === u.id ? ' is-selected' : ''}${u.status === 'destroyed' ? ' is-lost' : ''}`}
                  onClick={() => onSelect({ type: 'unit', id: u.id })}
                >
                  <span className={`dot dot--${u.status}${u.damaged ? ' dot--damaged' : ''}`} aria-hidden="true" />
                  <span className="unitrow__name">{u.name}</span>
                  <span className="unitrow__state">{unitState(pic, u)}</span>
                </button>
              ))}
            </div>
          );
        })}

        <h3 className={`txt--${tone(enemy)}`}>{SIDE_LABEL[enemy]}</h3>
        {contacts.length === 0 ? <p className="muted">Aucun contact.</p> : null}
        {contacts.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`unitrow${selection?.type === 'contact' && selection.id === c.id ? ' is-selected' : ''}${c.stale ? ' is-stale' : ''}`}
            onClick={() => onSelect({ type: 'contact', id: c.id })}
          >
            <span className={`dot ${c.identified ? `dot--${tone(enemy)}` : 'dot--unknown'}`} aria-hidden="true" />
            <span className="unitrow__name">{contactText(c)}</span>
            <span className="unitrow__state">{c.fixed && c.stale ? 'rens. ancien' : c.stale ? `ancien ${Math.max(1, Math.round(c.ageS / 60))} min` : 'suivi'}</span>
          </button>
        ))}
      </div>

      <div className="forces__tools">
        <h3>Domaines</h3>
        <div className="chips">
          {(Object.keys(domains) as (keyof DomainFilter)[]).map((d) => (
            <button key={d} type="button" className={`chip${domains[d] ? ' is-on' : ''}`} aria-pressed={domains[d]} onClick={() => onDomains({ ...domains, [d]: !domains[d] })}>
              {DOMAIN_LABEL[d]}
            </button>
          ))}
        </div>
        <h3>Couches</h3>
        <div className="layers">
          {(Object.keys(layers) as (keyof LayerToggles)[]).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={layers[k]} onChange={() => onLayers({ ...layers, [k]: !layers[k] })} />
              {LAYER_LABEL[k]}
            </label>
          ))}
        </div>
        <button type="button" className={`btn btn--small${measuring ? ' is-on' : ''}`} aria-pressed={measuring} onClick={onMeasure}>
          {measuring ? 'Mesure en cours — cliquez deux points' : 'Mesurer une distance'}
        </button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ Panneau inférieur */

interface BottomProps {
  pic: SidePicture;
  events: SimEvent[];
  speed: Speed;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

type Tab = 'journal' | 'ato' | 'legend';
const JOURNAL_LIMIT = 250;

export function BottomPanel({ pic, events, speed, selection, onSelect }: BottomProps) {
  const [tab, setTab] = useState<Tab>('journal');
  const scroller = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const ctx = useMemo(() => ({ startIso: pic.startIso, sectorName: pic.objective.name }), [pic.startIso, pic.objective.name]);
  const shown = events.length > JOURNAL_LIMIT ? events.slice(events.length - JOURNAL_LIMIT) : events;

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length, tab]);

  const missions = [...pic.missions].sort((a, b) => a.launchAt - b.launchAt || a.name.localeCompare(b.name));

  return (
    <section className="panel bottom">
      <div className="bottom__head">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'journal'} className={tab === 'journal' ? 'is-on' : ''} onClick={() => setTab('journal')}>
            Journal des opérations
          </button>
          <button type="button" role="tab" aria-selected={tab === 'ato'} className={tab === 'ato' ? 'is-on' : ''} onClick={() => setTab('ato')}>
            Ordre de missions ({missions.filter((m) => m.status === 'planned' || m.status === 'active').length})
          </button>
          <button type="button" role="tab" aria-selected={tab === 'legend'} className={tab === 'legend' ? 'is-on' : ''} onClick={() => setTab('legend')}>
            Légende
          </button>
        </div>
        <span className="muted">{speed === 0 ? 'Simulation en pause' : `Simulation ×${speed}`}</span>
      </div>

      {tab === 'journal' ? (
        <div
          className="journal"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {shown.map((e, i) => {
            const line = formatEvent(e, ctx);
            return (
              <p key={`${e.t}-${events.length - shown.length + i}`} className={`tone--${line.tone}`}>
                <time>{clockZ(pic.startIso, e.t, false)}</time> — {line.text}
              </p>
            );
          })}
        </div>
      ) : null}

      {tab === 'ato' ? (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Mission</th>
                <th>Type</th>
                <th>Appareils</th>
                <th>Départ</th>
                <th>Fin</th>
                <th>Règles d’engagement</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {missions.map((m) => (
                <tr key={m.id} className={`${selection?.type === 'mission' && selection.id === m.id ? 'is-selected' : ''}${m.status === 'completed' || m.status === 'cancelled' ? ' is-done' : ''}`} onClick={() => onSelect({ type: 'mission', id: m.id })}>
                  <td>
                    <button type="button" className="linkbtn" onClick={() => onSelect({ type: 'mission', id: m.id })}>
                      {m.name}
                    </button>
                  </td>
                  <td>{MISSION_TYPE_LABEL[m.type]}</td>
                  <td>{m.unitIds.length}</td>
                  <td>{clockZ(pic.startIso, m.launchAt, false)} Z</td>
                  <td>{m.endAt !== null ? `${clockZ(pic.startIso, m.endAt, false)} Z` : '—'}</td>
                  <td>{ROE_LABEL[m.roe]}</td>
                  <td>{MISSION_STATUS_LABEL[m.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Tableau inspiré d’un ordre de missions aériennes : adaptation ludique, pas une reproduction de procédure.</p>
        </div>
      ) : null}

      {tab === 'legend' ? (
        <div className="legend">
          <div>
            <h4>Cadre</h4>
            <p>
              <i className="lg lg--friend" /> Unité amie
            </p>
            <p>
              <i className="lg lg--hostile" /> Hostile identifié
            </p>
            <p>
              <i className="lg lg--unknown" /> Contact non identifié
            </p>
            <p>
              <i className="lg lg--base" /> Base aérienne
            </p>
          </div>
          <div>
            <h4>Rôle</h4>
            {(Object.keys(KIND_CODE) as (keyof typeof KIND_CODE)[]).map((k) => (
              <p key={k}>
                <b>{KIND_CODE[k]}</b> {KIND_LABEL[k]}
              </p>
            ))}
          </div>
          <div>
            <h4>Tracés</h4>
            <p>
              <i className="ln ln--route" /> Route ou circuit de mission
            </p>
            <p>
              <i className="ln ln--weapon" /> Portée sol-air amie
            </p>
            <p>
              <i className="ln ln--threat" /> Menace sol-air adverse (portée supposée)
            </p>
            <p>
              <i className="ln ln--uncertainty" /> Incertitude d’une piste ancienne
            </p>
            <p>
              <i className="ln ln--shot" /> Tir ami en vol
            </p>
          </div>
          <div>
            <h4>Lecture</h4>
            <p>Le trait partant d’un symbole indique son cap.</p>
            <p>Un symbole estompé est une information ancienne.</p>
            <p>Symboles inspirés des conventions cartographiques publiques, simplifiés pour le jeu.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
