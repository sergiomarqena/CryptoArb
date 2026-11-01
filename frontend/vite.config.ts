import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/CryptoArb/' : '/',
  plugins: [react()],
  preview: {
    allowedHosts: ['nordvex-web-production.up.railway.app'],
  },
}));
// Railway preview host is explicitly allow-listed above.
