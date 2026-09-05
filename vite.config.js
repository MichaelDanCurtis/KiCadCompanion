import { defineConfig } from 'vite';
export default defineConfig({build:{rollupOptions:{output:{manualChunks:{
  a2ui:['@a2ui/react/v0_9','@a2ui/web_core/v0_9'],
  markdown:['react-markdown'],
}}}}});
