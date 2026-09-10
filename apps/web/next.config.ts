import type { NextConfig } from 'next';

const config: NextConfig = {
  // Docker on-prem: keluarkan server mandiri, tidak perlu node_modules penuh.
  output: 'standalone',
  outputFileTracingRoot: '../../',
  reactStrictMode: true,
  // mysql2 tidak boleh ikut di-bundle; biarkan di-require saat runtime server.
  serverExternalPackages: ['mysql2'],
};

export default config;
