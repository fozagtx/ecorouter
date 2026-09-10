import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

const site = process.env.SITE_URL || 'https://ecorouter.xyz';
const base = process.env.BASE_PATH || '/';

// https://astro.build/config
export default defineConfig({
  site,
  base,
  outDir: '../../docs',
  integrations: [
    tailwind({
      applyBaseStyles: false,
    })
  ]
});
