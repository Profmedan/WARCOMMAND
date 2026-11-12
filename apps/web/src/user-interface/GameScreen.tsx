'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { clockZ, destination, distanceKm, type LatLon } from '@warcommand/simulation-core';
import type { Order } from '@warcommand/air-operations';
import { MapView } from '../world-map/MapView';
import { ALL_DOMAINS, boundsOf, DEFAULT_LAYERS, sceneFromPicture, type DomainFilter, type LayerToggles, type Selection } from '../world-map/scene';
import { downloadJson, storeSave, type GameController } from './controller';
import { Debrief } from './Debrief';
import { defaultsFor, DetailPanel, Planner, planToOrder, rejectText, usesWaypoints, type PlanDraft } from './detail';
import { SIDE_LABEL } from './i18n';
import { BottomPanel, ForcesPanel, TopBar } from './panels';

interface Props {
  controller: GameController;
  onQuit: () => void;
  /** Où mène la sortie : le menu principal, ou l'éditeur quand la partie en est un essai. */
  quitLabel?: string;
  onRestart: (seed: number) => void;
}

type Tool = { type: 'none' } | { type: 'measure' } | { type: 'ship'; unitId: string };

const KM_PER_NM = 1.852;

export function GameScreen({ controller, onQuit, quitLabel = 'Quitter vers le menu', onRestart }: Props) {
  useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const pic = controller.picture();
  const events = controller.events();
  const scenario = controller.session.scenario;

  const [selection, setSelection] = useState<Selection>(null);
  const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYERS);
  const [domains, setDomains] = useState<DomainFilter>(ALL_DOMAINS);
  const [tool, setTool] = useState<Tool>({ type: 'none' });
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [measure, setMeasure] = useState<LatLon[]>([]);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(controller.time === 0);
  const [debriefOpen, setDebriefOpen] = useState(false);

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  const ended = controller.ended;
  useEffect(() => {
    if (ended) setDebriefOpen(true);
  }, [ended]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const say = (text: string, bad = false) => setNotice({ text, bad });

  const sendOrder = useCallback(
    (order: Order) => {
      const result = controller.order(order);
      if (!result.ok) setNotice({ text: rejectText(controller.picture(), result), bad: true });
      else if (order.type === 'CREATE_MISSION' && result.missionId) setSelection({ type: 'mission', id: result.missionId });
      return result;
    },
    [controller],
  );

  const openPlanner = (seed: Partial<PlanDraft>) => {
    setTool({ type: 'none' });
    setMeasure([]);
    const type = seed.type ?? 'CAP';
    setPlan({
      type,
      unitIds: [],
      waypoints: [],
      altM: 9000,
      speed: 'cruise',
      delayMin: 0,
      windowMin: null,
      roe: pic.defaultRoe,
      allowRefuel: pic.units.some((u) => u.kind === 'tanker' && u.status !== 'destroyed'),
      targetContactId: null,
      loadoutId: null,
      emcon: false,
      escortUnitId: null,
      ...defaultsFor(pic, type),
      ...seed,
    });
  };

  const cancelTools = useCallback(() => {
    setPlan(null);
    setTool({ type: 'none' });
    setMeasure([]);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        controller.setSpeed(controller.speed === 0 ? 1 : 0);
      } else if (e.key === 'Escape') {
        cancelTools();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, cancelTools]);

  const placingWaypoints = plan !== null && usesWaypoints(plan.type);
  const picking = placingWaypoints || tool.type !== 'none';

  const onMapClick = (pos: LatLon) => {
    if (placingWaypoints && plan) {
      if (plan.waypoints.length >= 8) say('Huit points au maximum.', true);
      else setPlan({ ...plan, waypoints: [...plan.waypoints, pos] });
      return;
    }
    if (tool.type === 'measure') {
      setMeasure((m) => (m.length >= 2 ? [pos] : [...m, pos]));
      return;
    }
    if (tool.type === 'ship') {
      const result = sendOrder({ type: 'MOVE_SHIP', side: pic.side, unitId: tool.unitId, dest: pos });
      if (result.ok) {
        say('Ordre de déplacement transmis.');
        setTool({ type: 'none' });
      }
      return;
    }
    setSelection(null);
  };

  const check = plan ? controller.check(planToOrder(pic, plan)) : null;
  const estimate = plan ? controller.estimate(planToOrder(pic, plan)) : null;
  const turnS = controller.wegoTurnS;
  const resolving = turnS > 0 && !controller.planning;

  const scene = useMemo(
    () =>
      sceneFromPicture(pic, {
        layers,
        domains,
        selection,
        draft: plan && usesWaypoints(plan.type) ? plan.waypoints : [],
        measure,
        showNavalZone: tool.type === 'ship' || (selection?.type === 'unit' && pic.units.find((u) => u.id === selection.id)?.kind === 'ship') === true,
      }),
    [pic, layers, domains, selection, plan, measure, tool],
  );

  // Cadrage initial : les bases, les unités et le secteur d'objectif du scénario (information de briefing).
  const fit = useMemo(() => {
    const o = scenario.objective;
    const edge = (bearing: number) => destination(o.center, bearing, o.radiusKm);
    return boundsOf([
      ...scenario.bases.map((b) => b.pos),
      ...scenario.units.flatMap((u) => (u.pos ? [u.pos] : u.airborne ? [u.airborne.pos] : [])),
      edge(0),
      edge(90),
      edge(180),
      edge(270),
    ]);
  }, [scenario]);

  const measured = measure.length === 2 ? distanceKm(measure[0]!, measure[1]!) : null;
  const stamp = `${clockZ(pic.startIso, pic.time, false).replace(':', 'h')}Z`;

  if (debriefOpen && ended) {
    return <Debrief controller={controller} onBack={() => setDebriefOpen(false)} onQuit={onQuit} quitLabel={quitLabel} onRestart={onRestart} />;
  }

  return (
    <div className="aoc">
      <TopBar
        pic={pic}
        events={events}
        speed={controller.speed}
        ended={ended}
        night={controller.night()}
        turnS={turnS}
        planning={controller.planning}
        onSpeed={(s) => controller.setSpeed(s)}
        onStep={() => controller.advance(60)}
        onBriefing={() => setBriefingOpen(true)}
        onSave={() => {
          const ok = storeSave(`${scenario.title} — ${SIDE_LABEL[pic.side]} — ${clockZ(pic.startIso, pic.time, false)} Z`, controller.save());
          say(ok ? 'Partie sauvegardée dans ce navigateur.' : 'Sauvegarde impossible : stockage du navigateur indisponible ou plein.', !ok);
        }}
        onExport={() => downloadJson(`war-command-${scenario.id}-${stamp}.json`, controller.save())}
        onQuit={onQuit}
        quitLabel={quitLabel}
        onDebrief={() => setDebriefOpen(true)}
      />

      <ForcesPanel
        pic={pic}
        selection={selection}
        onSelect={(s) => {
          setSelection(s);
          if (plan) setPlan(null);
        }}
        layers={layers}
        onLayers={setLayers}
        domains={domains}
        onDomains={setDomains}
        measuring={tool.type === 'measure'}
        onMeasure={() => {
          setPlan(null);
          setMeasure([]);
          setTool(tool.type === 'measure' ? { type: 'none' } : { type: 'measure' });
        }}
      />

      <main className="mapzone">
        <MapView scene={scene} view={{ center: scenario.region.center, zoom: scenario.region.zoom }} fit={fit} picking={picking} showGraticule={layers.graticule} onMapClick={onMapClick} onSelect={setSelection} />
        {placingWaypoints ? <div className="maphint">Cliquez sur la carte pour placer {plan?.type === 'SWEEP' ? 'la route' : 'la station'} · Échap pour abandonner</div> : null}
        {resolving && !placingWaypoints && tool.type === 'none' ? (
          <div className="maphint">
            Tour en cours de résolution — ordres à {clockZ(pic.startIso, (Math.floor(pic.time / turnS) + 1) * turnS, false)} Z
          </div>
        ) : null}
        {tool.type === 'ship' ? <div className="maphint">Cliquez la destination du bâtiment, dans sa zone de manœuvre · Échap pour abandonner</div> : null}
        {tool.type === 'measure' ? (
          <div className="maphint">
            {measured === null ? 'Mesure : cliquez deux points' : `Distance : ${Math.round(measured)} km · ${Math.round(measured / KM_PER_NM)} NM`} · Échap pour terminer
          </div>
        ) : null}
        {notice ? (
          <div className={`toast${notice.bad ? ' toast--bad' : ''}`} role="status">
            {notice.text}
          </div>
        ) : null}
        {ended ? (
          <button type="button" className="btn btn--primary mapzone__cta" onClick={() => setDebriefOpen(true)}>
            Mission terminée — voir le compte rendu
          </button>
        ) : null}
      </main>

      <aside className="panel detail">
        {plan && check ? (
          <Planner
            pic={pic}
            plan={plan}
            check={check}
            estimate={estimate}
            onChange={setPlan}
            onCancel={() => setPlan(null)}
            onSubmit={() => {
              const result = sendOrder(planToOrder(pic, plan));
              if (result.ok) setPlan(null);
            }}
          />
        ) : (
          <DetailPanel
            pic={pic}
            selection={selection}
            briefing={scenario.sides[pic.side].briefing}
            onSelect={setSelection}
            onPlan={openPlanner}
            onOrder={sendOrder}
            movingShip={tool.type === 'ship' ? tool.unitId : null}
            onMoveShip={(unitId) => {
              setPlan(null);
              setMeasure([]);
              setTool(tool.type === 'ship' && tool.unitId === unitId ? { type: 'none' } : { type: 'ship', unitId });
            }}
          />
        )}
      </aside>

      <BottomPanel pic={pic} events={events} speed={controller.speed} selection={selection} onSelect={setSelection} />

      {briefingOpen ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
          <div className="modal__box">
            <p className="sheet__eyebrow">
              {scenario.title} · {SIDE_LABEL[pic.side]}
            </p>
            <h2 id="briefing-title">Briefing</h2>
            <p>{scenario.description}</p>
            <p>{scenario.sides[pic.side].briefing}</p>
            <ul className="tips">
              <li>
                {turnS > 0
                  ? `Mode par tours : donnez vos ordres, puis choisissez une vitesse pour résoudre le tour de ${turnS / 60} minutes. La simulation s’arrête d’elle-même à la fin de chaque tour.`
                  : 'La simulation démarre en pause : préparez vos ordres, puis choisissez une vitesse (barre d’espace : pause).'}
              </li>
              <li>Sélectionnez une unité ou une mission pour agir ; « Nouvelle mission » ouvre le planificateur, et les points se posent sur la carte.</li>
              <li>Vous ne voyez que ce que vos capteurs détectent. Une piste « ? » n’est pas identifiée : vos appareils ne l’engagent pas.</li>
              <li>Vos équipages gèrent seuls la tenue de station, la poursuite, le ravitaillement et le retour au carburant minimal.</li>
            </ul>
            <button type="button" className="btn btn--primary" onClick={() => setBriefingOpen(false)} autoFocus>
              Prendre le commandement
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
