import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  preview: {
    allowedHosts: ['nordvex-web-production.up.railway.app'],
  },
});
