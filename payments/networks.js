export const DEFAULT_PAYMENT_NETWORK = 'botchain-testnet'

export const PAYMENT_NETWORKS = Object.freeze({
  'botchain-testnet': Object.freeze({
    key: 'botchain-testnet',
    name: 'BOTChain Testnet',
    kind: 'evm',
    chainId: 968,
    rpcUrls: Object.freeze(['https://rpc.bohr.life']),
    asset: 'BOT',
    decimals: 18,
    explorerUrl: 'https://scan.bohr.life',
    faucetUrl: 'https://faucet.botchain.ai/basic',
    testnet: true
  }),
  'botchain-mainnet': Object.freeze({
    key: 'botchain-mainnet',
    name: 'BOTChain Mainnet',
    kind: 'evm',
    chainId: 677,
    rpcUrls: Object.freeze(['https://rpc.botchain.ai']),
    asset: 'BOT',
    decimals: 18,
    explorerUrl: 'https://scan.botchain.ai',
    faucetUrl: '',
    testnet: false
  }),
  'arc-testnet': Object.freeze({
    key: 'arc-testnet',
    name: 'Arc Testnet',
    kind: 'evm',
    chainId: 5042002,
    rpcUrls: Object.freeze([
      'https://rpc.quicknode.testnet.arc.network',
      'https://rpc.blockdaemon.testnet.arc.network',
      'https://rpc.testnet.arc.network'
    ]),
    asset: 'USDC',
    decimals: 18,
    explorerUrl: 'https://testnet.arcscan.app',
    faucetUrl: '',
    testnet: true
  }),
  lightning: Object.freeze({
    key: 'lightning',
    name: 'Lightning',
    kind: 'lightning',
    chainId: null,
    rpcUrls: Object.freeze([]),
    asset: 'BTC',
    decimals: 8,
    explorerUrl: '',
    faucetUrl: '',
    testnet: false
  })
})

export function getPaymentNetwork (environment = runtimeEnvironment()) {
  const key = String(environment?.ZAPCAST_PAYMENT_NETWORK || DEFAULT_PAYMENT_NETWORK).trim()
  const network = PAYMENT_NETWORKS[key]
  if (!network) {
    throw new Error(`Unsupported ZAPCAST_PAYMENT_NETWORK: ${key}. Use ${Object.keys(PAYMENT_NETWORKS).join(', ')}.`)
  }
  return network
}

export function publicPaymentNetwork (network = getPaymentNetwork()) {
  return {
    key: network.key,
    name: network.name,
    kind: network.kind,
    chainId: network.chainId,
    asset: network.asset,
    decimals: network.decimals,
    explorerUrl: network.explorerUrl,
    faucetUrl: network.faucetUrl,
    testnet: network.testnet
  }
}

export function explorerTransactionUrl (network, hash) {
  return network?.explorerUrl && hash ? `${network.explorerUrl}/tx/${hash}` : ''
}

function runtimeEnvironment () {
  return globalThis.process?.env || globalThis.Bare?.env || {}
}
