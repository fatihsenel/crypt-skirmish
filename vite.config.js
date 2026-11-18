import { defineConfig } from 'vite';

// GitHub Pages serves the site from /crypt-skirmish/ (so does `npm run preview`);
// the dev server stays at /.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/crypt-skirmish/' : '/',
}));
