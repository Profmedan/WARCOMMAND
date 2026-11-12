import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'WAR COMMAND — Air Operations Center',
  description: 'Simulateur de commandement d’opérations aériennes. Jeu : scénarios, unités et événements fictifs.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
