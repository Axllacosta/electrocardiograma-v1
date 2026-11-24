import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Si el puerto 3000 está ocupado, Vite usa el siguiente libre en lugar de
// cerrarse, y abre el navegador en la dirección que haya tomado.
// host 'localhost' es necesario: Web Serial solo funciona en localhost o https.
const server = { host: 'localhost', port: 3000, strictPort: false, open: true };

export default defineConfig({
  plugins: [react()],
  server,
  preview: server,
});
