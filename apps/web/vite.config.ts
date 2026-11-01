import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path';
import fs from 'fs';

// getUserMedia (camera/mic) requires a secure context - https://, or
// http://localhost. Testing from another device over the LAN needs real
// HTTPS (a chrome://flags override doesn't reliably unlock it on mobile
// Chrome), so if a mkcert-generated cert exists at infra/certs/, use it.
// See SETUP.md for how to generate one. Falls back to plain HTTP (fine for
// same-machine localhost testing) if the certs aren't there.
const certPath = path.resolve(__dirname, '../../infra/certs/dev-cert.pem');
const keyPath = path.resolve(__dirname, '../../infra/certs/dev-key.pem');
const httpsConfig =
  fs.existsSync(certPath) && fs.existsSync(keyPath)
    ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
    : undefined;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@airbond/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    host: true, // listen on 0.0.0.0 so other devices on the LAN can reach the dev server
    port: 5173,
    https: httpsConfig,
  },
})
