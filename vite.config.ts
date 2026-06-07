import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Client bundle config. The DeskThing CLI (`deskthing package`) builds the client
// via Vite using this file. The now-playing UI is the built-in DeskThing view;
// this client is a minimal required stub.
export default defineConfig({
  base: './',
  plugins: [react()],
})
