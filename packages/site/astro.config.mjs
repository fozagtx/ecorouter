import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://fozagtx.github.io',
  base: '/ecorouter',
  outDir: '../../docs',
  integrations: [
    tailwind({
      applyBaseStyles: false,
    })
  ]
});
