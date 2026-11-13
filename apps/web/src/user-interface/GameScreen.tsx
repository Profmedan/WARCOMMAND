'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { clockZ, distanceKm, type LatLon } from '@warcommand/simulation-core';
import type { GameOrder, GameOrderResult, Session } from '@warcommand/scenario-system';
import type { SaveGame } from '@warcommand/replay-engine';
import { MapView } from '../world-map/MapView';
import { ALL_DOMAINS, DEFAULT_LAYERS, sceneFromPicture, type DomainFilter, type LayerToggles, type Selection } from '../world-map/scene';
import { downloadJson, storeSave, type GameLink } from './controller';
import { Debrief } from './Debrief';
import { defaultsFor, DetailPanel, Planner, planToOrder, rejectText, usesWaypoints, type PlanDraft } from './detail';
import { SIDE_LABEL } from './i18n';
import type { JointTool } from './joint';
import { BottomPanel, ForcesPanel, TopBar } from './panels';

interface Props {
  controller: GameLink;
  onQuit: () => void;
  /** Où mène la sortie : le menu principal, l'éditeur quand la partie en est un essai, la campagne. */
  quitLabel?: string;
  /** Rejouer la mission ; absent quand cela n'a pas de sens (campagne, partie à deux joueurs). */
  onRestart?: (seed: number) => void;
  /** Où va la sauvegarde ; par défaut, dans les sauvegardes du navigateur. Rend `false` si elle a échoué. */
  onSave?: (title: string, save: SaveGame) => boolean;
  /** Appelé une fois, quand la mission est terminée et que la partie complète est disponible. */
  onEnded?: (session: Session) => void;
}

type Tool = { type: 'none' } | { type: 'measure' } | { type: 'ship'; unitId: string } | JointTool;

/** Confirmation affichée quand un ordre des composantes interarmées est accepté. */
const ORDER_ACCEPTED: Partial<Record<GameOrder['type'], string>> = {
  LAND_ORDER: 'Ordre transmis à la formation.',
  LAND_TROOPS: 'Débarquement lancé.',
  USE_EFFECT: 'Effet employé.',
  SOF_INSERT: 'Équipe en route.',
  SOF_EXTRACT: 'Exfiltration ordonnée.',
};

const KM_PER_NM = 1.852;

export function GameScreen({ controller, onQuit, quitLabel = 'Quitter vers le menu', onRestart, onSave, onEnded }: Props) {
  useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const pic = controller.picture();
  const events = controller.events();
  const brief = controller.brief;
  const net = controller.net();
  const final = controller.finalSession();
  const [view3d, setView3d] = useState(false);

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

  // La partie complète n'existe qu'à la fin (en réseau, quand le serveur l'a envoyée) : on la remet une fois.
  const endedHandler = useRef(onEnded);
  endedHandler.current = onEnded;
  useEffect(() => {
    if (final) endedHandler.current?.(final);
  }, [final]);

  const netError = net?.error ?? null;
  useEffect(() => {
    if (netError) setNotice({ text: netError, bad: true });
  }, [netError]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const say = (text: string, bad = false) => setNotice({ text, bad });

  // La réponse vient du moteur : aussitôt en partie solitaire, après un aller-retour au serveur à deux joueurs.
  const sendOrder = useCallback(
    async (order: GameOrder): Promise<GameOrderResult> => {
      const result = await controller.order(order);
      if (!result.ok) setNotice({ text: rejectText(controller.picture(), result, order.type), bad: true });
      else if (order.type === 'CREATE_MISSION' && result.missionId) setSelection({ type: 'mission', id: result.missionId });
      else if (ORDER_ACCEPTED[order.type]) setNotice({ text: ORDER_ACCEPTED[order.type]!, bad: false });
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
      void sendOrder({ type: 'MOVE_SHIP', side: pic.side, unitId: tool.unitId, dest: pos }).then((result) => {
        if (!result.ok) return;
        say('Ordre de déplacement transmis.');
        setTool({ type: 'none' });
      });
      return;
    }
    if (tool.type === 'land') {
      if (tool.points.length >= 8) say('Huit points au maximum.', true);
      else setTool({ ...tool, points: [...tool.points, pos] });
      return;
    }
    if (tool.type === 'beach') {
      void sendOrder({ type: 'LAND_TROOPS', side: pic.side, shipId: tool.shipId, unitId: tool.unitId, beach: pos }).then((result) => {
        if (result.ok) setTool({ type: 'none' });
      });
      return;
    }
    if (tool.type === 'sof') {
      void sendOrder({ type: 'SOF_INSERT', side: pic.side, unitId: tool.unitId, target: pos }).then((result) => {
        if (result.ok) setTool({ type: 'none' });
      });
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
        draft: plan && usesWaypoints(plan.type) ? plan.waypoints : tool.type === 'land' ? tool.points : [],
        measure,
        showNavalZone: tool.type === 'ship' || tool.type === 'beach' || (selection?.type === 'unit' && pic.units.find((u) => u.id === selection.id)?.naval != null),
      }),
    [pic, layers, domains, selection, plan, measure, tool],
  );

  const measured = measure.length === 2 ? distanceKm(measure[0]!, measure[1]!) : null;
  const stamp = `${clockZ(pic.startIso, pic.time, false).replace(':', 'h')}Z`;

  if (debriefOpen && ended && final) {
    return <Debrief session={final} playerSide={controller.playerSide} onBack={() => setDebriefOpen(false)} onQuit={onQuit} quitLabel={quitLabel} onRestart={onRestart} />;
  }

  const opponent = net ? net.players[pic.side === 'BLUE' ? 'RED' : 'BLUE'] : null;
  const save = () => {
    const data = controller.save();
    if (!data) return;
    const title = `${brief.title} — ${SIDE_LABEL[pic.side]} — ${clockZ(pic.startIso, pic.time, false)} Z`;
    const ok = onSave ? onSave(title, data) : storeSave(title, data);
    say(ok ? 'Partie sauvegardée dans ce navigateur.' : 'Sauvegarde impossible : stockage du navigateur indisponible ou plein.', !ok);
  };

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
        net={net}
        onSpeed={(s) => controller.setSpeed(s)}
        onStep={controller.canStep ? () => controller.advance(60) : undefined}
        onBriefing={() => setBriefingOpen(true)}
        onSave={controller.canSave ? save : undefined}
        onExport={controller.canSave ? () => downloadJson(`war-command-${brief.scenarioId}-${stamp}.json`, controller.save()) : undefined}
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
        <MapView scene={scene} view={brief.region} fit={brief.fit} picking={picking} showGraticule={layers.graticule} view3d={view3d} onMapClick={onMapClick} onSelect={setSelection} />
        <button type="button" className={`btn mapzone__mode${view3d ? ' is-on' : ''}`} aria-pressed={view3d} onClick={() => setView3d((v) => !v)} title="Globe en relief : altitude des aéronefs, courbure de la Terre. Clic droit ou Ctrl + glisser pour tourner et incliner.">
          {view3d ? 'Vue 2D' : 'Vue 3D'}
        </button>
        {net && !opponent ? (
          <div className="maphint maphint--wait">
            En attente d’un adversaire — donnez-lui le code <b>{net.code}</b>. Vous pouvez déjà étudier la carte et préparer vos ordres.
          </div>
        ) : null}
        {net && opponent && !opponent.connected && !ended ? <div className="maphint maphint--wait">{opponent.name} est déconnecté : la partie est en pause jusqu’à son retour.</div> : null}
        {net && !net.online && !ended ? <div className="maphint maphint--wait">Liaison perdue avec le serveur — reconnexion en cours…</div> : null}
        {placingWaypoints ? <div className="maphint">Cliquez sur la carte pour placer {plan?.type === 'SWEEP' ? 'la route' : 'la station'} · Échap pour abandonner</div> : null}
        {resolving && !placingWaypoints && tool.type === 'none' ? (
          <div className="maphint">
            Tour en cours de résolution — ordres à {clockZ(pic.startIso, (Math.floor(pic.time / turnS) + 1) * turnS, false)} Z
          </div>
        ) : null}
        {tool.type === 'ship' ? <div className="maphint">Cliquez la destination du bâtiment, en mer, dans sa zone de manœuvre · Échap pour abandonner</div> : null}
        {tool.type === 'land' ? <div className="maphint">Cliquez l’itinéraire de la formation ({tool.points.length} point{tool.points.length > 1 ? 's' : ''}), puis « Donner l’ordre » · Échap pour abandonner</div> : null}
        {tool.type === 'beach' ? <div className="maphint">Cliquez la plage du débarquement, à moins de 8 km du bâtiment · Échap pour abandonner</div> : null}
        {tool.type === 'sof' ? <div className="maphint">Cliquez le point d’observation de l’équipe, à terre · Échap pour abandonner</div> : null}
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
          <button type="button" className="btn btn--primary mapzone__cta" disabled={!final} onClick={() => setDebriefOpen(true)}>
            {final ? 'Mission terminée — voir le compte rendu' : 'Mission terminée — réception du compte rendu…'}
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
              void sendOrder(planToOrder(pic, plan)).then((result) => {
                if (result.ok) setPlan(null);
              });
            }}
          />
        ) : (
          <DetailPanel
            pic={pic}
            selection={selection}
            briefing={brief.briefing}
            onSelect={setSelection}
            onPlan={openPlanner}
            onOrder={sendOrder}
            movingShip={tool.type === 'ship' ? tool.unitId : null}
            jointTool={tool.type === 'land' || tool.type === 'beach' || tool.type === 'sof' ? tool : null}
            onJointTool={(next) => {
              setPlan(null);
              setMeasure([]);
              setTool(next ?? { type: 'none' });
            }}
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
              {brief.title} · {SIDE_LABEL[pic.side]}
            </p>
            <h2 id="briefing-title">Briefing</h2>
            <p>{brief.description}</p>
            <p>{brief.briefing}</p>
            <ul className="tips">
              <li>
                {turnS > 0
                  ? `Mode par tours : donnez vos ordres, puis choisissez une vitesse pour résoudre le tour de ${turnS / 60} minutes. La simulation s’arrête d’elle-même à la fin de chaque tour.`
                  : 'La simulation démarre en pause : préparez vos ordres, puis choisissez une vitesse (barre d’espace : pause).'}
              </li>
              {net ? <li>Partie à deux joueurs : le temps avance à la plus lente des deux vitesses demandées. Chacun peut donc mettre en pause.</li> : null}
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
