import * as esbuild from 'esbuild';
import { cp, rm } from 'node:fs/promises';

const prod = process.argv.includes('--prod');
const mobile = process.argv.includes('--mobile');
const common = {
  bundle: true,
  sourcemap: !prod,
  minify: prod,
  logLevel: prod ? 'warning' : 'info',
};

const targets = [
  {
    ...common,
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main/index.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  },
  {
    ...common,
    entryPoints: ['src/preload/ui.ts'],
    outfile: 'dist/preload/ui.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  },
  ...['toolbar', 'panel', 'grid', 'settings'].map((name) => ({
    ...common,
    entryPoints: [`src/renderer/${name}/${name}.ts`],
    outfile: `dist/renderer/${name}/${name}.js`,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  })),
];

const notTs = (src) => !src.endsWith('.ts');

if (mobile) {
  const out = 'dist-mobile';
  await rm(out, { recursive: true, force: true });
  await esbuild.build({
    ...common,
    entryPoints: ['src/mobile/app.ts'],
    outfile: `${out}/app.js`,
    platform: 'browser',
    format: 'iife',
    target: ['safari16', 'chrome110'],
  });
  await Promise.all([
    cp('src/mobile', out, { recursive: true, filter: notTs }),
    cp('src/renderer/common/theme.css', `${out}/theme.css`),
    cp('src/renderer/common/streams.css', `${out}/streams.css`),
    cp('src/renderer/grid/tiles.css', `${out}/tiles.css`),
  ]);
} else {
  await rm('dist', { recursive: true, force: true });
  await Promise.all(targets.map((t) => esbuild.build(t)));
  await cp('src/renderer', 'dist/renderer', { recursive: true, filter: notTs });
}
