'use client';

import { useState } from 'react';
import type { Difficulty, SideId } from '@warcommand/simulation-core';
import type { Scenario } from '@warcommand/scenario-system';
import { controllerFromSave, GameController } from './controller';
import { Editor } from './editor/Editor';
import { GameScreen } from './GameScreen';
import { MainMenu } from './MainMenu';
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

export function App() {
  const [game, setGame] = useState<{ id: number; controller: GameController } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const start = (o: NewGameOptions) => {
    const controller = GameController.create(o.scenario, { playerSide: o.side, difficulty: o.difficulty, seed: o.seed, wegoTurnMin: o.wegoTurnMin });
    setGame((g) => ({ id: (g?.id ?? 0) + 1, controller }));
  };

  /** Retourne la liste des erreurs ; vide si la sauvegarde a été chargée. */
  const load = (data: unknown): string[] => {
    const result = controllerFromSave(data);
    if (!result.ok) return result.errors;
    setGame((g) => ({ id: (g?.id ?? 0) + 1, controller: result.controller }));
    return [];
  };

  if (game) {
    const { controller } = game;
    return (
      <GameScreen
        key={game.id}
        controller={controller}
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

  return <MainMenu onStart={start} onLoad={load} onEdit={(scenario, unsaved) => setEditing((e) => ({ id: (e?.id ?? 0) + 1, draft: scenario, dirty: unsaved }))} />;
}
