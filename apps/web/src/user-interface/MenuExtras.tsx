'use client';

/**
 * Cartes du menu principal ajoutées en phase 6 : campagnes, partie à deux joueurs.
 */
import { useEffect, useRef, useState } from 'react';
import { SIDES, type Difficulty, type SideId } from '@warcommand/simulation-core';
import type { Scenario } from '@warcommand/scenario-system';
import { CAMPAIGNS, campaignStanding, getCampaign, parseCampaignState, startCampaign } from '@warcommand/campaign-system';
import { campaignFileName, deleteCampaign, freshSlotId, listCampaigns, saveCampaign, type CampaignSlot } from './campaignStore';
import { downloadJson } from './controller';
import { DIFFICULTY_LABEL, SIDE_LABEL } from './i18n';
import { readResumeTicket, RemoteController, type NetEntry, type ResumeTicket } from './remote';

const DIFFICULTIES: Difficulty[] = ['recrue', 'standard', 'veteran'];

/* ------------------------------------------------------------------ Campagnes */

export function CampaignCard({ onOpen }: { onOpen: (slot: CampaignSlot) => void }) {
  const [slots, setSlots] = useState<CampaignSlot[]>([]);
  const [campaignId, setCampaignId] = useState(CAMPAIGNS[0]!.id);
  const [side, setSide] = useState<SideId>('BLUE');
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => setSlots(listCampaigns()), []);
  const def = getCampaign(campaignId) ?? CAMPAIGNS[0]!;

  const begin = () => {
    const state = startCampaign(def, {
      slotId: freshSlotId(slots.map((s) => s.state.slotId)),
      playerSide: side,
      difficulty,
      seed: Math.floor(Math.random() * 1_000_000_000),
      now: new Date().toISOString(),
    });
    const slot: CampaignSlot = { state, inProgress: null };
    if (!saveCampaign(slot)) {
      setNotice({ text: 'Stockage du navigateur indisponible ou plein : la campagne ne pourrait pas être conservée.', bad: true });
      return;
    }
    onOpen(slot);
  };

  const importFile = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setNotice({ text: 'Ce fichier n’est pas un JSON lisible.', bad: true });
      return;
    }
    const parsed = parseCampaignState(data);
    if (!parsed.ok) {
      setNotice({ text: parsed.errors.slice(0, 3).join(' · '), bad: true });
      return;
    }
    // Jamais d'écrasement : la campagne importée prend un emplacement libre.
    const slot: CampaignSlot = { state: { ...parsed.state, slotId: freshSlotId(slots.map((s) => s.state.slotId)) }, inProgress: null };
    if (!saveCampaign(slot)) {
      setNotice({ text: 'Stockage du navigateur indisponible ou plein : la campagne importée ne peut pas être conservée.', bad: true });
      return;
    }
    setSlots(listCampaigns());
    setNotice({ text: 'Campagne importée.', bad: false });
  };

  return (
    <section className="card">
      <h2>Campagne</h2>
      <div className="choices" role="radiogroup" aria-label="Campagne">
        {CAMPAIGNS.map((c) => (
          <label key={c.id} className={`choice${campaignId === c.id ? ' is-on' : ''}`}>
            <input type="radio" name="campaign" checked={campaignId === c.id} onChange={() => setCampaignId(c.id)} />
            <span>
              <strong>{c.title}</strong>
              <small>{c.description}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="row">
        <label className="field">
          <span>Votre camp</span>
          <select className="input" value={side} onChange={(e) => setSide(e.target.value as SideId)}>
            {SIDES.map((s) => (
              <option key={s} value={s}>
                {SIDE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Difficulté de l’IA</span>
          <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" className="btn btn--primary" onClick={begin}>
        Commencer la campagne
      </button>

      <h2>Campagnes en cours</h2>
      {slots.length === 0 ? <p className="muted">Aucune campagne dans ce navigateur.</p> : null}
      <ul className="saves saves--wide">
        {slots.map((slot) => {
          const s = slot.state;
          const d = getCampaign(s.campaignId);
          const standing = d ? campaignStanding(d, s) : null;
          const next = d?.missions.find((m) => m.id === s.current);
          return (
            <li key={s.slotId}>
              <span>
                <strong>
                  {d?.title ?? s.campaignId} — {SIDE_LABEL[s.playerSide]}
                </strong>
                <small>
                  {standing?.finished ? 'terminée' : next ? `à jouer : ${next.title}${slot.inProgress ? ' (mission interrompue)' : ''}` : ''} · BLEU {standing?.points.BLUE ?? 0} · ROUGE{' '}
                  {standing?.points.RED ?? 0} · {new Date(s.updatedAt).toLocaleString('fr-FR')}
                </small>
              </span>
              <button type="button" className="btn" onClick={() => onOpen(slot)}>
                {standing?.finished ? 'Voir' : 'Reprendre'}
              </button>
              <button type="button" className="btn" onClick={() => downloadJson(campaignFileName(s), s)}>
                Exporter
              </button>
              {confirmDelete === s.slotId ? (
                <button
                  type="button"
                  className="btn btn--danger"
                  onBlur={() => setConfirmDelete(null)}
                  onClick={() => {
                    deleteCampaign(s.slotId);
                    setConfirmDelete(null);
                    setSlots(listCampaigns());
                  }}
                >
                  Confirmer la suppression
                </button>
              ) : (
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmDelete(s.slotId)}>
                  Supprimer
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Fichier de campagne à importer"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = '';
        }}
      />
      <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
        Importer une campagne (.json)
      </button>
      {notice ? (
        <p className={notice.bad ? 'error' : 'notice'} role="status">
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ Partie à deux joueurs */

const NAME_KEY = 'warcommand.player.v1';

interface NetCardProps {
  /** Scénario choisi dans le menu : c'est lui que l'hôte propose. */
  scenario: Scenario;
  /** Scénario personnel : il est envoyé au serveur, qui le revalide. */
  custom: boolean;
  playable: boolean;
  side: SideId;
  seed: number;
  seedValid: boolean;
  wegoTurnMin: number;
  onConnected: (controller: RemoteController) => void;
}

export function NetCard({ scenario, custom, playable, side, seed, seedValid, wegoTurnMin, onConnected }: NetCardProps) {
  const [url, setUrl] = useState('ws://localhost:3211');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<ResumeTicket | null>(null);

  useEffect(() => {
    // Par défaut, le serveur est sur la machine qui sert le jeu : c'est le cas quand l'hôte invite sur son réseau local.
    setUrl(`ws://${window.location.hostname || 'localhost'}:3211`);
    setTicket(readResumeTicket());
    try {
      setName(window.localStorage.getItem(NAME_KEY) ?? '');
    } catch {
      // Stockage indisponible : le nom sera saisi à chaque fois.
    }
  }, []);

  const connect = (target: string, entry: NetEntry) => {
    setBusy(true);
    setError(null);
    try {
      if (name.trim()) window.localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      // Sans conséquence.
    }
    RemoteController.connect(target.trim(), entry)
      .then(onConnected)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };

  const named = name.trim().length > 0;
  return (
    <section className="card">
      <h2>Partie à deux joueurs</h2>
      <p>
        Chacun commande un camp, sans IA. La simulation tourne sur un serveur de parties, qui n’envoie à chaque joueur que l’image de son camp ; le temps
        avance à la plus lente des deux vitesses demandées.
      </p>
      <p className="muted">
        Lancez le serveur sur une machine avec <code>pnpm serve</code> (ou <code>pnpm serve --lan</code> pour le réseau local), puis indiquez ici son adresse.
      </p>
      <label className="field">
        <span>Adresse du serveur</span>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} aria-label="Adresse du serveur de parties" />
      </label>
      <label className="field">
        <span>Votre nom</span>
        <input className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Votre nom de joueur" />
      </label>

      <h2>Créer une partie</h2>
      <p className="muted">
        Scénario « {scenario.title} », camp {SIDE_LABEL[side]}, {wegoTurnMin === 0 ? 'temps continu' : `tours de ${wegoTurnMin} minutes`} — tels que choisis ci-contre. Vous recevrez un code à
        donner à votre adversaire.
      </p>
      <button
        type="button"
        className="btn btn--primary"
        disabled={busy || !named || !seedValid || !playable}
        onClick={() => connect(url, { type: 'create', name: name.trim(), side, seed, wegoTurnMin, ...(custom ? { scenario } : { scenarioId: scenario.id }) })}
      >
        {busy ? 'Connexion…' : 'Créer la partie'}
      </button>

      <h2>Rejoindre une partie</h2>
      <div className="row row--tight">
        <input className="input" value={code} maxLength={4} placeholder="Code" onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Code de la partie" spellCheck={false} />
        <button type="button" className="btn" disabled={busy || !named || code.trim().length !== 4} onClick={() => connect(url, { type: 'join', name: name.trim(), code: code.trim() })}>
          Rejoindre
        </button>
      </div>
      {ticket ? (
        <button type="button" className="btn" disabled={busy} onClick={() => connect(ticket.url, { type: 'resume', code: ticket.code, token: ticket.token })}>
          Reprendre ma place dans la partie {ticket.code}
        </button>
      ) : null}
      {!named ? <p className="hint">Indiquez votre nom pour créer ou rejoindre une partie.</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
