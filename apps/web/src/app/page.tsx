'use client';

import dynamic from 'next/dynamic';

// Le jeu s'exécute entièrement dans le navigateur (carte WebGL, stockage local) : pas de rendu serveur.
const App = dynamic(() => import('../user-interface/App').then((m) => m.App), {
  ssr: false,
  loading: () => <div className="boot">WAR COMMAND — chargement…</div>,
});

export default function Page() {
  return <App />;
}
