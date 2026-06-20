import { build } from 'esbuild'

await build({
  entryPoints: ['ui/wallet-client.js'],
  outfile: 'ui/vendor/wallet-client.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info'
})
