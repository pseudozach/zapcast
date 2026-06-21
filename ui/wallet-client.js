import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from 'viem'
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts'
import { validateMnemonic } from '@scure/bip39'

const ARC_RPC_PROXY = '/api/arc-rpc'
const ARC_EXPLORER_URL = 'https://testnet.arcscan.app'
const zapcastArcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [ARC_RPC_PROXY],
      webSocket: []
    }
  },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: ARC_EXPLORER_URL
    }
  },
  testnet: true
}

export function generateWallet () {
  const mnemonic = generateMnemonic(english)
  const account = mnemonicToAccount(mnemonic)
  return {
    mnemonic,
    address: account.address
  }
}

export function walletFromMnemonic (mnemonic) {
  const normalized = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) throw new Error('Wallet mnemonic is required.')
  if (!validateMnemonic(normalized, english)) throw new Error('Enter a valid BIP-39 mnemonic.')
  const account = mnemonicToAccount(normalized)
  return {
    mnemonic: normalized,
    address: account.address
  }
}

export async function sendNativeUsdc ({ mnemonic, to, amount }) {
  const account = mnemonicToAccount(mnemonic)
  const client = createWalletClient({
    account,
    chain: zapcastArcTestnet,
    transport: http(ARC_RPC_PROXY)
  })
  const txHash = await client.sendTransaction({
    to,
    value: parseUnits(amount, 18)
  })
  return {
    txHash,
    explorerUrl: `${ARC_EXPLORER_URL}/tx/${txHash}`
  }
}

export async function getNativeUsdcBalance ({ address }) {
  const client = createPublicClient({
    chain: zapcastArcTestnet,
    transport: http(ARC_RPC_PROXY)
  })
  const value = await client.getBalance({ address })
  return {
    raw: value.toString(),
    formatted: formatUnits(value, 18),
    symbol: 'USDC'
  }
}
