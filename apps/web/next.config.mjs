/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Les paquets de simulation sont distribués en TypeScript source dans le monorepo.
  transpilePackages: [
    '@warcommand/simulation-core',
    '@warcommand/unit-database',
    '@warcommand/doctrine-engine',
    '@warcommand/air-operations',
    '@warcommand/ai-commander',
    '@warcommand/scenario-system',
    '@warcommand/replay-engine',
    '@warcommand/mission-editor',
    '@warcommand/land-operations',
    '@warcommand/naval-operations',
    '@warcommand/multi-domain-effects',
  ],
};

export default nextConfig;
