import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/elo': 'http://localhost:3000',
      '/wc': 'http://localhost:3000',
      '/collector': 'http://localhost:3000',
      '/api/ensemble': 'http://localhost:3000',
    },
  },
});
