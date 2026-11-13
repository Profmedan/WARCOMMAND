'use client';

import { useState } from 'react';
import type { Difficulty, SideId } from '@warcommand/simulation-core';
import type { Scenario, Session } from '@warcommand/scenario-system';
import { getCampaign, recordMission, type PreparedMission } from '@warcommand/campaign-system';
import type { SaveGame } from '@warcommand/replay-engine';
import { CampaignScreen } from './CampaignScreen';
import { saveCampaign, type CampaignSlot } from './campaignStore';
import { controllerFromSave, GameController, type GameLink } from './controller';
import { Debrief } from './Debrief';
import { Editor } from './editor/Editor';
import { GameScreen } from './GameScreen';
import { MainMenu } from './MainMenu';
import type { RemoteController } from './remote';
import { saveCustomScenario } from './scenarioStore';

export interface NewGameOptions {
  scenario: Scenario;
  side: SideId;
  difficulty: Difficulty;
  seed: number;
  /** 0 = temps continu ; sinon durée d'un tour en minutes. */
  wegoTurnMin: number;
}

/** Séance d'édition : le brouillon survit à un essai en jeu, on y revient en quittant la partie. */
interface Editing {
  id: number;
  draft: Scenario;
  dirty: boolean;
}

/** Partie affichée : solitaire (la simulation tourne ici), mission de campagne, ou partie à deux joueurs. */
type Game =
  | { id: number; kind: 'solo'; controller: GameController }
  | { id: number; kind: 'campaign'; controller: GameController; prepared: PreparedMission }
  | { id: number; kind: 'net'; controller: RemoteController };

export function App() {
  const [game, setGame] = useState<Game | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [campaign, setCampaign] = useState<CampaignSlot | null>(null);
  const [review, setReview] = useState<Session | null>(null);
  const nextId = () => (game?.id ?? 0) + 1;

  const start = (o: NewGameOptions) => {
    const controller = GameController.create(o.scenario, { playerSide: o.side, difficulty: o.difficulty, seed: o.seed, wegoTurnMin: o.wegoTurnMin });
    setGame((g) => ({ id: (g?.id ?? 0) + 1, kind: 'solo', controller }));
  };

  /** Retourne la liste des erreurs ; vide si la sauvegarde a été chargée. */
  const load = (data: unknown): string[] => {
    const result = controllerFromSave(data);
    if (!result.ok) return result.errors;
    setGame((g) => ({ id: (g?.id ?? 0) + 1, kind: 'solo', controller: result.controller }));
    return [];
  };

  /** Lance la mission en cours de la campagne, ou reprend sa sauvegarde. */
  const playCampaign = (prepared: PreparedMission, wegoTurnMin: number, resume: SaveGame | null) => {
    if (resume) {
      const result = controllerFromSave(resume);
      if (result.ok) {
        setGame({ id: nextId(), kind: 'campaign', controller: result.controller, prepared });
        return;
      }
    }
    setGame({ id: nextId(), kind: 'campaign', controller: GameController.create(prepared.scenario, { ...prepared.options, wegoTurnMin }), prepared });
  };

  if (game) {
    const link: GameLink = game.controller;

    if (game.kind === 'net') {
      return (
        <GameScreen
          key={game.id}
          controller={link}
          quitLabel="Quitter la partie"
          onQuit={() => {
            game.controller.leave();
            setGame(null);
          }}
        />
      );
    }

    if (game.kind === 'campaign' && campaign) {
      const { controller, prepared } = game;
      const def = getCampaign(campaign.state.campaignId);
      /** Conserve la mission interrompue dans l'emplacement de la campagne. */
      const suspend = (save: SaveGame): boolean => {
        const next: CampaignSlot = { state: campaign.state, inProgress: save };
        const ok = saveCampaign(next);
        if (ok) setCampaign(next);
        return ok;
      };
      return (
        <GameScreen
          key={game.id}
          controller={link}
          quitLabel={controller.ended ? 'Revenir à la campagne' : 'Suspendre la mission et revenir à la campagne'}
          onSave={(_title, save) => suspend(save)}
          onEnded={(session) => {
            // La mission terminée est consignée aussitôt : points, pertes à reporter, mission suivante.
            if (!def || campaign.state.current !== prepared.mission.id) return;
            const result = recordMission(def, campaign.state, prepared, session.state, new Date().toISOString());
            if (!result.ok) return;
            const next: CampaignSlot = { state: result.state, inProgress: null };
            saveCampaign(next);
            setCampaign(next);
          }}
          onQuit={() => {
            controller.stop();
            if (!controller.ended) suspend(controller.save());
            setGame(null);
          }}
        />
      );
    }

    const controller = game.controller as GameController;
    return (
      <GameScreen
        key={game.id}
        controller={link}
        quitLabel={editing ? 'Revenir à l’éditeur' : 'Quitter vers le menu'}
        onQuit={() => {
          controller.stop();
          setGame(null);
        }}
        onRestart={(seed) => {
          controller.stop();
          start({
            scenario: controller.session.scenario,
            side: controller.playerSide,
            difficulty: controller.session.options.difficulty,
            seed,
            wegoTurnMin: controller.session.options.wegoTurnMin ?? 0,
          });
        }}
      />
    );
  }

  if (review) {
    return <Debrief session={review} playerSide={review.options.versus ? null : review.options.playerSide} onQuit={() => setReview(null)} quitLabel="Revenir au menu" />;
  }

  if (campaign) {
    return <CampaignScreen slot={campaign} onPlay={playCampaign} onQuit={() => setCampaign(null)} />;
  }

  if (editing) {
    return (
      <Editor
        key={editing.id}
        initial={editing.draft}
        initialDirty={editing.dirty}
        onDraftChange={(draft) => setEditing((e) => (e ? { ...e, draft, dirty: true } : e))}
        onSave={(draft) => {
          const saved = saveCustomScenario(draft);
          if (saved) setEditing((e) => (e ? { ...e, draft, dirty: false } : e));
          return saved;
        }}
        onPlay={(scenario, side, difficulty) => start({ scenario, side, difficulty, seed: scenario.seed, wegoTurnMin: 0 })}
        onQuit={() => setEditing(null)}
      />
    );
  }

  return (
    <MainMenu
      onStart={start}
      onLoad={load}
      onEdit={(scenario, unsaved) => setEditing((e) => ({ id: (e?.id ?? 0) + 1, draft: scenario, dirty: unsaved }))}
      onCampaign={setCampaign}
      onNet={(controller) => setGame({ id: nextId(), kind: 'net', controller })}
      onReview={setReview}
    />
  );
}
