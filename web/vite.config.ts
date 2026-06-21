import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/elo': 'http://localhost:3000',
      '/wc': 'http://localhost:3000',
      '/collector': 'http://localhost:3000',
      '/api/ensemble': 'http://localhost:3000',
    },
  },
});
