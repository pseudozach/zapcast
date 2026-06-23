import { build } from 'esbuild'

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info'
}

await build({
  ...common,
  entryPoints: ['ui/wallet-client.js'],
  outfile: 'ui/vendor/wallet-client.js'
})

await build({
  ...common,
  entryPoints: ['ui/nostr-client.js'],
  outfile: 'ui/vendor/nostr-client.js'
})
