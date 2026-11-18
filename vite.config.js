import { defineConfig } from 'vite';

// GitHub Pages serves the site from /crypt-skirmish/ (so does `npm run preview`);
// the dev server stays at /.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/crypt-skirmish/' : '/',
  build: {
    // three.js alone minifies to ~690 kB and can't be split further; everything else is
    // well under the default 500 kB.
    chunkSizeWarningLimit: 750,
    rolldownOptions: {
      output: {
        // three.js in a chunk of its own: it only changes when the library is upgraded, so
        // browsers keep it cached across game updates.
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
}));
