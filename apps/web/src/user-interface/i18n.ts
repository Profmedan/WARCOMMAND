/**
 * Tous les textes de l'interface, en français.
 *
 * Le moteur n'émet que des codes ; c'est ici qu'ils deviennent des phrases. Traduire le jeu
 * revient à fournir un autre module exposant les mêmes tables et les mêmes fonctions.
 */
import {
  clockZ,
  type ContactSource,
  type ControlStatus,
  type Difficulty,
  type Domain,
  type EffectId,
  type LandPosture,
  type MissionStatus,
  type MissionType,
  type Roe,
  type RtbReason,
  type ServiceId,
  type SideId,
  type SimEvent,
  type SofPhase,
  type TerrainKind,
  type UnitKind,
  type UnitStatus,
  type UnitTask,
} from '@warcommand/simulation-core';
import type { RejectCode } from '@warcommand/air-operations';
import type { LandRejectCode } from '@warcommand/land-operations';
import type { NavalRejectCode } from '@warcommand/naval-operations';
import type { EffectRejectCode } from '@warcommand/multi-domain-effects';
import type { Scenario } from '@warcommand/scenario-system';

export const SIDE_LABEL: Record<SideId, string> = { BLUE: 'BLEU', RED: 'ROUGE' };
export const CONTROL_LABEL: Record<ControlStatus, string> = { BLUE: 'BLEU', RED: 'ROUGE', CONTESTED: 'CONTESTÉ' };

export const KIND_LABEL: Record<UnitKind, string> = {
  fighter: 'Chasseur',
  aew: 'Surveillance aérienne',
  tanker: 'Ravitailleur',
  drone: 'Drone de reconnaissance',
  sam: 'Défense sol-air',
  ship: 'Bâtiment de surface',
  infantry: 'Infanterie',
  mech: 'Infanterie mécanisée',
  armor: 'Blindés',
  artillery: 'Artillerie',
  engineer: 'Génie',
  recon: 'Reconnaissance',
  logistics: 'Logistique',
  hq: 'Poste de commandement',
  sof: 'Opérations spéciales',
  carrier: 'Porte-avions',
  sub: 'Sous-marin',
  amphib: 'Navire amphibie',
  supply: 'Navire logistique',
};

/** Code court affiché dans le symbole. */
export const KIND_CODE: Record<UnitKind, string> = {
  fighter: 'CH',
  aew: 'AW',
  tanker: 'RV',
  drone: 'DR',
  sam: 'SA',
  ship: 'FG',
  infantry: 'INF',
  mech: 'MEC',
  armor: 'BLD',
  artillery: 'ART',
  engineer: 'GEN',
  recon: 'REC',
  logistics: 'LOG',
  hq: 'PC',
  sof: 'FS',
  carrier: 'PA',
  sub: 'SM',
  amphib: 'AMP',
  supply: 'RAV',
};

export const DOMAIN_LABEL: Record<Domain, string> = { air: 'air', surface: 'surface', ground: 'sol' };

export const STATUS_LABEL: Record<UnitStatus, string> = {
  ready: 'Disponible',
  airborne: 'En vol',
  turnaround: 'Remise en condition',
  maintenance: 'Indisponible (dommages)',
  destroyed: 'Perdu',
  active: 'En service',
  embarked: 'Hors carte',
};

export const LAND_POSTURE_LABEL: Record<LandPosture, string> = {
  hold: 'en attente',
  move: 'en déplacement',
  attack: 'à l’attaque',
  defend: 'en défense',
  withdraw: 'décroche',
};

/** Posture en un mot, pour les listes étroites. */
export const LAND_POSTURE_SHORT: Record<LandPosture, string> = { hold: 'attente', move: 'route', attack: 'attaque', defend: 'défense', withdraw: 'repli' };

export const LAND_POSTURE_HELP: Record<LandPosture, string> = {
  hold: 'Reste sur place et se repose : fatigue et cohésion se rétablissent vite, sans retranchement.',
  move: 'Se déplace ; s’arrête à la limite de la zone de contrôle d’une formation adverse.',
  attack: 'Avance jusqu’au contact de l’adversaire le plus proche et l’assaille.',
  defend: 'Tient sur place et se retranche progressivement.',
  withdraw: 'Rompt le contact et s’éloigne, même sous le feu.',
};

export const SERVICE_LABEL: Record<ServiceId, string> = {
  network: 'Réseaux de commandement',
  satcom: 'Liaisons par satellite',
  nav: 'Navigation par satellite',
};

export const SERVICE_HELP: Record<ServiceId, string> = {
  network: 'Dégradés, ils allongent le délai entre un ordre et son exécution (décollages, formations terrestres).',
  satcom: 'Dégradées, elles privent le camp des images de ses satellites et des comptes rendus de ses équipes spéciales.',
  nav: 'Dégradée, elle rend moins précis les munitions air-surface et les missiles antinavires.',
};

export const EFFECT_LABEL: Record<EffectId, string> = {
  cyber: 'Perturber les réseaux adverses',
  jam: 'Brouiller les services spatiaux adverses',
};

/** Forme nominale, pour le journal et le compte rendu de l'IA. */
export const EFFECT_NOUN: Record<EffectId, string> = {
  cyber: 'perturbation des réseaux adverses',
  jam: 'brouillage des services spatiaux adverses',
};

export const EFFECT_HELP: Record<EffectId, string> = {
  cyber: 'Dégrade pour un temps les réseaux de commandement adverses : leurs ordres mettent plus longtemps à être exécutés.',
  jam: 'Dégrade pour un temps les liaisons et la navigation par satellite adverses.',
};

export const TERRAIN_LABEL: Record<TerrainKind | 'ouvert', string> = {
  ouvert: 'terrain ouvert',
  urbain: 'zone urbaine',
  foret: 'forêt',
  montagne: 'relief',
  marais: 'terrain marécageux',
};

export const SOF_PHASE_LABEL: Record<SofPhase, string> = {
  ready: 'à sa base',
  inserting: 'infiltration en cours',
  observing: 'en observation',
  extracting: 'exfiltration en cours',
};

export const TASK_LABEL: Record<UnitTask, string> = {
  ground: 'au sol',
  transit: 'en transit',
  station: 'en station',
  pursue: 'en poursuite',
  attack: 'en attaque',
  escort: 'en escorte',
  refuel: 'rejoint le ravitailleur',
  refueling: 'ravitaille',
  evade: 'se replie',
  rtb: 'rentre à la base',
  hold: 'en position',
  move: 'fait route',
};

export const MISSION_TYPE_LABEL: Record<MissionType, string> = {
  CAP: 'Patrouille',
  INTERCEPT: 'Interception',
  SWEEP: 'Balayage',
  ESCORT: 'Escorte',
  SEAD: 'Attaque des défenses sol-air (SEAD)',
  CAS: 'Appui aérien rapproché',
  AEW: 'Surveillance aérienne',
  TANKER: 'Ravitaillement en vol',
  RECON: 'Reconnaissance',
};

export const MISSION_TYPE_HELP: Record<MissionType, string> = {
  CAP: 'Tient une station et engage, selon ses règles d’engagement, ce qui s’en approche.',
  INTERCEPT: 'Rejoint et engage la piste désignée.',
  SWEEP: 'Parcourt la route une seule fois en engageant ce qu’elle croise, puis rentre.',
  ESCORT: 'Suit un appareil ami et engage ce qui le menace à moins de 100 km.',
  SEAD: 'Attaque à la munition air-surface le site sol-air ou le bâtiment désigné, par passes successives.',
  CAS: 'Tient une zone d’appui et frappe à la munition air-surface les formations terrestres adverses repérées, celles au contact de vos troupes d’abord.',
  AEW: 'Tient une station radar au profit de toute la coalition.',
  TANKER: 'Tient une station de ravitaillement.',
  RECON: 'Tient une station d’observation : repère et identifie les unités de surface et au sol.',
};

export const SOURCE_LABEL: Record<ContactSource, string> = {
  radar: 'piste radar',
  esm: 'émissions radar captées (pas de tir possible sans piste radar)',
  eo: 'observation optronique',
  fire: 'repéré à son tir',
  intel: 'renseignement',
  ground: 'observation par une formation terrestre',
  sat: 'satellite d’observation',
  sonar: 'écoute sous-marine',
  sof: 'compte rendu d’une équipe spéciale',
};

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  planned: 'Planifiée',
  active: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

export const ROE_LABEL: Record<Roe, string> = { hold: 'riposte seule', defensive: 'défensives', free: 'tir libre' };

export const ROE_HELP: Record<Roe, string> = {
  hold: 'Ne tire que sur une piste qui a ouvert le feu.',
  defensive: 'Engage un hostile identifié dans le secteur, près de la patrouille ou près d’un moyen ami.',
  free: 'Engage tout hostile identifié à portée.',
};

export const RTB_LABEL: Record<RtbReason, string> = {
  fuel: 'carburant',
  weapons: 'munitions épuisées',
  damage: 'dommages',
  order: 'sur ordre',
  mission_end: 'fin de mission',
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { recrue: 'Recrue', standard: 'Standard', veteran: 'Vétéran' };

export const DIFFICULTY_HELP: Record<Difficulty, string> = {
  recrue: 'Décide rarement, avec beaucoup d’aléa, sans anticiper les relèves ; n’emploie ni ses effets multi-domaines ni son équipe spéciale.',
  standard: 'Anticipe les relèves, évite les menaces sol-air connues, protège ses moyens de soutien.',
  veteran: 'Décide vite et juste, étudie davantage de stations, chasse vos moyens de soutien ; son sous-marin va au-devant de vos bâtiments.',
};

/** Refus qui ne viennent pas du moteur mais de la liaison avec le serveur, en partie à deux joueurs. */
type LinkRejectCode = 'CHECKING' | 'OFFLINE' | 'NO_REPLY' | 'MALFORMED';

export const REJECT_LABEL: Record<RejectCode | LandRejectCode | NavalRejectCode | EffectRejectCode | LinkRejectCode, string> = {
  MISSION_OVER: 'La mission est terminée.',
  NO_UNITS: 'Sélectionnez au moins un appareil.',
  DUPLICATE_UNIT: 'Un appareil est sélectionné deux fois.',
  UNKNOWN_UNIT: 'Unité inconnue.',
  WRONG_SIDE: 'Cette unité n’est pas sous votre commandement.',
  WRONG_KIND: 'Ce type d’appareil ne peut pas effectuer cette mission.',
  UNIT_UNAVAILABLE: 'Appareil indisponible à l’heure demandée.',
  NO_WAYPOINT: 'Placez au moins un point sur la carte.',
  TOO_MANY_WAYPOINTS: 'Huit points au maximum.',
  OUT_OF_THEATER: 'Un point est hors du théâtre d’opérations.',
  BAD_ALTITUDE: 'Altitude hors du domaine de vol de l’appareil.',
  BAD_TIME: 'Horaire invalide.',
  OUT_OF_RANGE: 'Hors rayon d’action : le carburant ne permet pas l’aller et le retour.',
  UNKNOWN_CONTACT: 'Cette piste n’existe plus.',
  UNKNOWN_MISSION: 'Cette mission n’est plus en cours.',
  NOT_AIRBORNE: 'L’appareil n’est pas en vol.',
  NOT_A_SHIP: 'Cet ordre ne concerne que les bâtiments de surface.',
  OUT_OF_NAVAL_ZONE: 'Destination hors de la zone de manœuvre maritime.',
  NO_ORDNANCE: 'Aucune munition air-surface : ni emportée, ni en stock à la base.',
  BAD_LOADOUT: 'Emport impossible : inconnu pour cet appareil, ou appareil déjà en vol.',
  BAD_ESCORT: 'Choisissez un aéronef ami à escorter, en vol ou affecté à une mission.',
  NOT_PLANNING_PHASE: 'Mode par tours : les ordres se donnent entre deux tours.',
  CHECKING: 'Vérification auprès du serveur…',
  OFFLINE: 'Liaison perdue avec le serveur : l’ordre n’est pas parti.',
  NO_REPLY: 'Le serveur n’a pas répondu : l’ordre n’est peut-être pas passé.',
  MALFORMED: 'Ordre illisible pour le serveur.',
  NOT_AT_SEA: 'Un bâtiment reste en mer : la destination ou le trajet passe par la terre.',
  BASE_CLOSED: 'Le pont d’envol est hors service : aucun décollage possible.',
  NOT_A_GROUND_UNIT: 'Cet ordre ne concerne que les formations terrestres.',
  UNIT_BROKEN: 'Cette formation est rompue : elle ne peut pas attaquer avant de s’être reconstituée.',
  NOT_ON_LAND: 'Le point choisi est en mer, ou l’itinéraire traverse la mer.',
  NOT_A_TRANSPORT: 'Ce bâtiment ne transporte pas de troupes.',
  NOT_ABOARD: 'Cette formation n’est pas à bord de ce bâtiment.',
  NO_EFFECT_LEFT: 'Cet effet a déjà été employé.',
  NOT_SOF: 'Cet ordre ne concerne que les équipes d’opérations spéciales.',
};

/** Motifs dont le sens dépend de l'ordre refusé. */
const REJECT_BY_ORDER: Record<string, string> = {
  'LAND_ORDER:UNIT_UNAVAILABLE': 'Cette formation n’est pas à terre ou n’est plus en état de recevoir un ordre.',
  'LAND_ORDER:NO_WAYPOINT': 'Indiquez au moins un point de l’itinéraire sur la carte.',
  'LAND_TROOPS:UNIT_UNAVAILABLE': 'Ce bâtiment est avarié, ou débarque déjà une formation.',
  'LAND_TROOPS:OUT_OF_RANGE': 'Le bâtiment doit être à moins de 8 km de la plage.',
  'LAND_TROOPS:NOT_ON_LAND': 'La plage doit être à terre : cliquez sur la côte, pas en mer.',
  'SOF_INSERT:UNIT_UNAVAILABLE': 'L’équipe est déjà engagée, ou se reconditionne après sa dernière mission.',
  'SOF_INSERT:OUT_OF_RANGE': 'Ce point est hors de portée de l’équipe depuis sa base.',
  'SOF_INSERT:NOT_ON_LAND': 'Une équipe s’infiltre à terre : choisissez un point sur la terre ferme.',
  'SOF_EXTRACT:UNIT_UNAVAILABLE': 'L’équipe n’est pas en observation : rien à exfiltrer.',
  'MOVE_SHIP:UNIT_UNAVAILABLE': 'Ce bâtiment n’est plus en état de manœuvrer.',
};

/** Texte d'un refus du moteur, selon son motif et l'ordre concerné. */
export function rejectReason(code: string, orderType?: string): string {
  return (orderType ? REJECT_BY_ORDER[`${orderType}:${code}`] : undefined) ?? (REJECT_LABEL as Record<string, string>)[code] ?? `Ordre refusé (${code}).`;
}

export const POSTURE_LABEL: Record<string, string> = {
  STANDING_CAP: 'Patrouille permanente par paires',
  REINFORCED_CAP: 'Patrouille renforcée',
  ROTATING_PRESENCE: 'Présence par rotation de paires',
  MASS_SWEEP: 'Balayage en masse',
  HVA_HUNT: 'Chasse aux moyens de soutien',
  WITHDRAW: 'Repli',
};

const STATION_LABEL: Record<string, string> = {
  center: 'centre du secteur',
  back: 'arrière du secteur',
  forward: 'avant du secteur',
  left: 'flanc gauche',
  right: 'flanc droit',
  reprise: 'station existante',
};

const REASON_LABEL: Record<string, string> = {
  presence: 'établir une présence',
  complement: 'compléter la patrouille',
  masse: 'engagement groupé',
  renfort: 'renfort',
  releve_carburant: 'relève (carburant)',
  releve_munitions: 'relève (munitions)',
  chasse_soutien: 'chasse à un moyen de soutien',
  protection_soutien: 'protection d’un moyen de soutien',
  soutien: 'protection d’un moyen de soutien menacé',
  attaque: 'accompagnement de l’attaque',
};

const SHOT_RESULT_LABEL: Record<string, string> = {
  destroyed: 'cible détruite',
  damaged: 'cible touchée',
  miss: 'tir manqué',
  unobserved: 'résultat non observé',
  lost: 'tir perdu',
  suppressed: 'cible neutralisée',
  attrition: 'formation touchée',
  hit: 'bâtiment touché',
  sunk: 'bâtiment coulé',
};

export const RESULT_LABEL: Record<string, string> = {
  destroyed: 'détruit',
  damaged: 'endommagé',
  miss: 'manqué',
  suppressed: 'neutralisé',
  attrition: 'effectifs entamés',
  hit: 'touché',
  sunk: 'coulé',
  lost: 'perdu',
};

export const WEAPON_LABEL: Record<string, string> = {
  aam: 'air-air',
  sam: 'sol-air',
  asm: 'air-surface',
  ssm: 'antinavire',
  torpedo: 'à la torpille',
  asw: 'anti-sous-marin',
};

export function formatMinutes(sec: number): string {
  return `${Math.floor(sec / 60)} min`;
}

export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatLatLon(lat: number, lon: number): string {
  const part = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;
  return `${part(lat, 'N', 'S')}  ${part(lon, 'E', 'O')}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** Moment clé d'une partie, tel que l'analyse après action le relève. */
export function describeMoment(kind: string, side: SideId | null, p: Record<string, string | number>): string {
  const camp = side ? SIDE_LABEL[side] : '';
  switch (kind) {
    case 'contact':
      return `Premier contact ${camp}`;
    case 'shot':
      return `Premier tir ${camp} : ${String(p.unit)}`;
    case 'loss':
      return `${camp} perd ${String(p.unit)} (${KIND_LABEL[p.kind as UnitKind] ?? String(p.kind)})`;
    case 'control':
      return `Le contrôle passe à : ${CONTROL_LABEL[p.status as ControlStatus] ?? String(p.status)}`;
    case 'landing':
      return `${camp} met à terre ${String(p.unit)}`;
    case 'effect':
      return `${camp} emploie un effet : ${EFFECT_LABEL[p.effect as EffectId] ?? String(p.effect)}`;
    case 'broken':
      return `${String(p.unit)} (${camp}) est rompue`;
    case 'end':
      return 'Fin de la mission';
    default:
      return kind;
  }
}

export type EventTone = 'info' | 'intel' | 'alert' | 'good' | 'system';

export interface EventLine {
  text: string;
  tone: EventTone;
}

export interface EventContext {
  startIso: string;
  sectorName: string;
}

/** Décision de l'IA en clair (compte rendu et journal de l'observateur). */
export function describeAiDecision(code: string, p: Record<string, string | number>): string {
  switch (code) {
    case 'POSTURE':
      return `Posture : ${POSTURE_LABEL[String(p.posture)] ?? p.posture}${p.forced === 1 ? ' (imposée par le scénario)' : ''}`;
    case 'LAUNCH_CAP':
      return `Patrouille de ${plural(Number(p.n), 'appareil', 'appareils')} — ${STATION_LABEL[String(p.station)] ?? p.station} (${REASON_LABEL[String(p.reason)] ?? p.reason})${p.emcon === 1 ? ', en silence radar' : ''}`;
    case 'LAUNCH_SEAD':
      return `Attaque de la défense ${p.contact} par ${plural(Number(p.n), 'appareil', 'appareils')}, approche à ${Number(p.altitude).toLocaleString('fr-FR')} m`;
    case 'LAUNCH_ESCORT':
      return `Escorte de ${p.unit} par ${plural(Number(p.n), 'appareil', 'appareils')} (${REASON_LABEL[String(p.reason)] ?? p.reason})`;
    case 'HOLD_FOR_SEAD':
      return `Secteur entièrement couvert par des défenses : ${plural(Number(p.waiting), 'chasseur attend', 'chasseurs attendent')} l’effet de l’attaque`;
    case 'LAUNCH_INTERCEPT':
      return `Interception de ${p.contact} par ${plural(Number(p.n), 'appareil', 'appareils')} (${REASON_LABEL[String(p.reason)] ?? p.reason})`;
    case 'RESTATION':
      return `${p.mission} déplacée vers ${STATION_LABEL[String(p.station)] ?? p.station} : menace sol-air ${p.threat}`;
    case 'ROE_FREE':
      return 'Acte hostile constaté : passage en tir libre';
    case 'WITHDRAW':
      return `Repli : ${plural(Number(p.missions), 'mission annulée', 'missions annulées')}`;
    case 'ORDER_REJECTED':
      return `Ordre refusé par le moteur (${p.order} : ${p.reason})`;
    case 'GROUND_ATTACK':
      return `Attaque terrestre — ${p.objective} : ${plural(Number(p.n), 'formation engagée', 'formations engagées')} ; appuis et soutiens suivent`;
    case 'GROUND_DEFENCE':
      return `Défense — ${p.objective} : ${plural(Number(p.n), 'formation installée ou appelée', 'formations installées ou appelées')} dans la zone`;
    case 'CAS':
      return `Appui aérien rapproché par ${plural(Number(p.n), 'appareil', 'appareils')} au profit de ${plural(Number(p.troops), 'formation au contact', 'formations au contact')}`;
    case 'EFFECT':
      return `Effet multi-domaines : ${EFFECT_NOUN[p.effect as EffectId]}`;
    case 'SOF_INSERT':
      return `${p.unit} : infiltration ordonnée`;
    case 'SOF_EXTRACT':
      return `${p.unit} : rappel avant la fin de la mission`;
    case 'LANDING':
      return `${p.ship} : mise à terre des troupes embarquées`;
    case 'SUB_HUNT':
      return `${p.unit} va au-devant du bâtiment ${p.contact}`;
    default:
      return code;
  }
}

/** Traduit un événement du moteur en ligne de journal. */
export function formatEvent(e: SimEvent, ctx: EventContext): EventLine {
  const p = e.p;
  const at = (t: unknown) => clockZ(ctx.startIso, Number(t), false);
  switch (e.code) {
    case 'MISSION_PLANNED':
      return { tone: 'info', text: `${p.mission} : ordre reçu — ${plural(Number(p.n), 'appareil', 'appareils')}, départ ${at(p.at)} Z` };
    case 'MISSION_LAUNCHED':
      return { tone: 'info', text: `${p.mission} : décollage de ${plural(Number(p.n), 'appareil', 'appareils')}` };
    case 'MISSION_ON_STATION':
      return { tone: 'good', text: `${p.mission} : en station` };
    case 'MISSION_ENDED':
      return { tone: 'info', text: `${p.mission} : mission terminée` };
    case 'MISSION_CANCELLED':
      return { tone: 'info', text: `${p.mission} : mission annulée` };
    case 'ROE_CHANGED':
      return { tone: 'info', text: `${p.mission} : règles d’engagement → ${ROE_LABEL[p.roe as Roe]}` };
    case 'UNIT_RTB':
      return { tone: 'info', text: `${p.unit} : retour à la base (${RTB_LABEL[p.reason as RtbReason]})` };
    case 'UNIT_LANDED':
      return p.state === 'maintenance'
        ? { tone: 'alert', text: `${p.unit} : posé, endommagé — en réparation jusqu’à ${at(p.readyAt)} Z` }
        : { tone: 'info', text: `${p.unit} : posé — remise en condition jusqu’à ${at(p.readyAt)} Z` };
    case 'UNIT_READY':
      return { tone: 'good', text: `${p.unit} : de nouveau disponible` };
    case 'REFUEL_START':
      return { tone: 'info', text: `${p.unit} : ravitaillement auprès de ${p.tanker}` };
    case 'REFUEL_END':
      return { tone: 'good', text: `${p.unit} : ravitaillement terminé (${p.pct} %)` };
    case 'CONTACT_NEW':
      return { tone: 'intel', text: `Nouveau contact ${p.contact} — ${DOMAIN_LABEL[p.domain as Domain]}${p.source && p.source !== 'radar' ? `, ${SOURCE_SHORT[String(p.source)] ?? p.source}` : ''}` };
    case 'CONTACT_IDENTIFIED':
      return { tone: 'intel', text: `Contact ${p.contact} identifié : ${p.label}` };
    case 'CONTACT_LOST':
      return { tone: 'intel', text: `Contact ${p.contact} : piste abandonnée` };
    case 'CONTACT_DESTROYED':
      return { tone: 'good', text: `Contact ${p.contact} : destruction constatée` };
    case 'SHOT_FIRED':
      return { tone: 'alert', text: `${p.unit} : tir ${WEAPON_LABEL[String(p.weapon)] ?? p.weapon} sur ${p.contact}` };
    case 'MISSILE_WARNING':
      return { tone: 'alert', text: `${p.unit} : alerte missile` };
    case 'SHOT_RESULT':
      return { tone: p.result === 'destroyed' || p.result === 'damaged' || p.result === 'suppressed' ? 'good' : 'info', text: `${p.unit} → ${p.contact} : ${SHOT_RESULT_LABEL[String(p.result)] ?? p.result}` };
    case 'UNIT_DESTROYED':
      return { tone: 'alert', text: `${p.unit} : unité perdue` };
    case 'UNIT_DAMAGED':
      return { tone: 'alert', text: `${p.unit} : touché, endommagé` };
    case 'MISSILE_EVADED':
      return { tone: 'good', text: `${p.unit} : missile esquivé` };
    case 'UNIT_LOST_FUEL':
      return { tone: 'alert', text: `${p.unit} : perdu — panne sèche` };
    case 'UNIT_FAULT':
      return { tone: 'alert', text: `${p.unit} : panne constatée à l’atterrissage — réparation jusqu’à ${at(p.readyAt)} Z` };
    case 'UNIT_SUPPRESSED':
      return { tone: 'alert', text: `${p.unit} : pris pour cible — radar coupé jusqu’à ${at(p.until)} Z` };
    case 'UNIT_RECOVERED':
      return { tone: 'good', text: `${p.unit} : radar de nouveau en service` };
    case 'UNIT_EVADING':
      return { tone: 'alert', text: `${p.unit} : menace proche (${p.contact}) — repli` };
    case 'SHIP_MOVING':
      return { tone: 'info', text: `${p.unit} : fait route vers sa nouvelle position` };
    case 'PERCEIVED_CONTROL':
      return { tone: 'intel', text: `${ctx.sectorName} : contrôle estimé → ${CONTROL_LABEL[p.status as ControlStatus]}` };
    case 'TRIGGER_MESSAGE':
      return { tone: 'system', text: String(p.text) };
    case 'MISSION_END':
      return { tone: 'system', text: 'Fin de la mission.' };
    case 'CONTROL_CHANGED':
      return { tone: 'system', text: `Contrôle réel du secteur → ${CONTROL_LABEL[p.status as ControlStatus]}` };
    case 'SHOT_RESOLVED':
      return { tone: 'system', text: `${p.shooter} → ${p.target} : probabilité ${p.pk}, tirage ${p.roll} → ${RESULT_LABEL[String(p.result)] ?? p.result}` };
    case 'AI_DECISION':
      return { tone: 'system', text: `IA ${SIDE_LABEL[p.side as SideId]} — ${describeAiDecision(String(p.code), p)}` };
    case 'LAND_ORDER':
      return { tone: 'info', text: `${p.unit} : ordre transmis (${LAND_POSTURE_LABEL[p.posture as LandPosture]}), exécution vers ${at(p.at)} Z` };
    case 'LAND_IN_CONTACT':
      return { tone: 'alert', text: `${p.unit} : au contact de l’adversaire` };
    case 'LAND_BROKEN':
      return { tone: 'alert', text: `${p.unit} : formation rompue, elle décroche` };
    case 'LAND_RALLIED':
      return { tone: 'good', text: `${p.unit} : formation reconstituée` };
    case 'CAS_REQUEST':
      return { tone: 'alert', text: `${p.unit} : demande un appui aérien` };
    case 'SUPPLY_LOW':
      return { tone: 'alert', text: `${p.unit} : ravitaillement bas` };
    case 'TROOPS_LANDING':
      return { tone: 'info', text: `${p.ship} : débarquement de ${p.unit} en cours — à terre vers ${at(p.at)} Z` };
    case 'TROOPS_LANDED':
      return { tone: 'good', text: `${p.unit} : à terre` };
    case 'BASE_CLOSED':
      return { tone: 'alert', text: `${p.base} : hors service — ni décollage ni atterrissage` };
    case 'UNIT_DIVERTED':
      return { tone: 'info', text: `${p.unit} : dérouté vers ${p.base}` };
    case 'EFFECT_USED':
      return { tone: 'info', text: `Effet employé : ${EFFECT_NOUN[p.effect as EffectId]}` };
    case 'SERVICE_DEGRADED':
      return { tone: 'alert', text: `${SERVICE_LABEL[p.service as ServiceId]} : perturbation en cours (niveau ${Math.round(Number(p.level) * 100)} %), au moins jusqu’à ${at(p.until)} Z` };
    case 'SERVICE_RESTORED':
      return { tone: 'good', text: `${SERVICE_LABEL[p.service as ServiceId]} : service rétabli` };
    case 'SAT_PASS_START':
      return { tone: 'intel', text: `Satellite ${p.sat} : passage en cours jusqu’à ${at(p.until)} Z` };
    case 'SAT_PASS_END':
      return { tone: 'intel', text: `Satellite ${p.sat} : fin du passage` };
    case 'SOF_INSERTING':
      return { tone: 'info', text: `${p.unit} : infiltration en cours — sur zone vers ${at(p.at)} Z` };
    case 'SOF_ON_STATION':
      return { tone: 'good', text: `${p.unit} : en observation` };
    case 'SOF_ABORTED':
      return { tone: 'alert', text: `${p.unit} : infiltration manquée — l’équipe rentre` };
    case 'SOF_COMPROMISED':
      return { tone: 'alert', text: `${p.unit} : équipe découverte — exfiltration` };
    case 'SOF_RECOVERED':
      return { tone: 'good', text: `${p.unit} : équipe récupérée` };
    case 'SOF_LOST':
      return { tone: 'alert', text: `${p.unit} : équipe perdue` };
    case 'INTEL_REPORT':
      return { tone: 'intel', text: `${p.unit} rend compte : ${p.label} localisé (${p.contact})` };
  }
}

/** Origine d'un nouveau contact, en bref. */
const SOURCE_SHORT: Record<string, string> = {
  esm: 'émissions radar captées',
  eo: 'observation optronique',
  ground: 'observation terrestre',
  sat: 'satellite',
  sonar: 'sonar',
  sof: 'équipe spéciale',
  fire: 'repéré à son tir',
  intel: 'renseignement',
};

/** Événements dignes d'une alerte dans le bandeau supérieur. */
export const ALERT_CODES: ReadonlySet<string> = new Set([
  'MISSILE_WARNING',
  'UNIT_DESTROYED',
  'UNIT_DAMAGED',
  'UNIT_LOST_FUEL',
  'UNIT_SUPPRESSED',
  'UNIT_EVADING',
  'CONTACT_NEW',
  'CONTACT_IDENTIFIED',
  'PERCEIVED_CONTROL',
  'LAND_IN_CONTACT',
  'LAND_BROKEN',
  'CAS_REQUEST',
  'SUPPLY_LOW',
  'BASE_CLOSED',
  'SERVICE_DEGRADED',
  'SOF_COMPROMISED',
  'SOF_LOST',
]);

/* ------------------------------------------------------------------ Éditeur de missions */

type TriggerCondition = Scenario['triggers'][number]['condition'];
type TriggerAction = Scenario['triggers'][number]['actions'][number];

export const CONDITION_LABEL: Record<TriggerCondition['type'], string> = {
  TIME_ELAPSED: 'Un délai est écoulé',
  LOSSES_AT_LEAST: 'Un niveau de pertes est atteint',
  UNIT_IN_ZONE: 'Une unité atteint une zone',
  GROUP_UNAVAILABLE: 'Un groupe devient indisponible',
  CONTROL_IS: 'Le secteur change de contrôle',
};

export function describeCondition(c: TriggerCondition, sc: Scenario): string {
  switch (c.type) {
    case 'TIME_ELAPSED':
      return `${c.atMin} min après le début`;
    case 'LOSSES_AT_LEAST':
      return `${SIDE_LABEL[c.side]} a perdu au moins ${c.count} ${KIND_LABEL[c.kind].toLowerCase()}${c.count > 1 ? 's' : ''}`;
    case 'UNIT_IN_ZONE':
      return `un ${KIND_LABEL[c.kind].toLowerCase()} ${SIDE_LABEL[c.side]} entre dans une zone de ${Math.round(c.zone.radiusKm)} km autour de ${formatLatLon(c.zone.center.lat, c.zone.center.lon)}`;
    case 'GROUP_UNAVAILABLE':
      return `le groupe « ${sc.groups.find((g) => g.id === c.groupId)?.name ?? c.groupId} » n’a plus aucune unité disponible`;
    case 'CONTROL_IS':
      return `le contrôle réel du secteur devient ${CONTROL_LABEL[c.status]}`;
  }
}

export function describeAction(a: TriggerAction): string {
  if (a.type === 'MESSAGE') {
    const who = a.vis.length === 2 ? 'aux deux camps' : a.vis.length === 1 ? `au camp ${SIDE_LABEL[a.vis[0]!]}` : 'à l’arbitre seul';
    return `message ${who} : « ${a.text} »`;
  }
  return a.winner === 'DRAW' ? 'fin de la mission, résultat indécis' : `fin de la mission, victoire ${SIDE_LABEL[a.winner]}`;
}
