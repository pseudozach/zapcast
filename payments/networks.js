export const DEFAULT_PAYMENT_NETWORK = 'botchain-mainnet'

export const PAYMENT_NETWORKS = Object.freeze({
  'botchain-mainnet': Object.freeze({
    key: 'botchain-mainnet',
    name: 'BOTChain Mainnet',
    kind: 'evm',
    chainId: 677,
    rpcUrls: Object.freeze(['https://rpc.botchain.ai']),
    asset: 'BOT',
    decimals: 18,
    totalSupply: '150 Million',
    explorerUrl: 'https://scan.botchain.ai',
    faucetUrl: '',
    testnet: false
  }),
  'botchain-testnet': Object.freeze({
    key: 'botchain-testnet',
    name: 'BOTChain Testnet',
    kind: 'evm',
    chainId: 968,
    rpcUrls: Object.freeze(['https://rpc.bohr.life']),
    asset: 'BOT',
    decimals: 18,
    totalSupply: '150 Million',
    explorerUrl: 'https://scan.bohr.life',
    faucetUrl: 'https://faucet.botchain.ai/basic',
    testnet: true
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
    totalSupply: network.totalSupply,
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
