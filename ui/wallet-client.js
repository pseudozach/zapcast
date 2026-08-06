import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from 'viem'
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts'
import { validateMnemonic } from '@scure/bip39'

const PAYMENT_RPC_PROXY = '/api/payment-rpc'

export function generateWallet () {
  const mnemonic = generateMnemonic(english)
  const account = mnemonicToAccount(mnemonic)
  return { mnemonic, address: account.address }
}

export function walletFromMnemonic (mnemonic) {
  const normalized = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) throw new Error('Wallet mnemonic is required.')
  if (!validateMnemonic(normalized, english)) throw new Error('Enter a valid BIP-39 mnemonic.')
  const account = mnemonicToAccount(normalized)
  return { mnemonic: normalized, address: account.address }
}

export async function getNativeBalance ({ address, network }) {
  const config = requireEvmNetwork(network)
  const client = publicClient(config)
  const value = await client.getBalance({ address })
  return {
    raw: value.toString(),
    formatted: formatUnits(value, config.decimals),
    symbol: config.asset
  }
}

export async function estimateNativeTransfer ({ mnemonic, to, amount, network }) {
  const config = requireEvmNetwork(network)
  const account = mnemonicToAccount(mnemonic)
  const client = publicClient(config)
  const value = parseUnits(String(amount), config.decimals)
  if (value <= 0n) throw new Error(`Tip amount must be greater than zero ${config.asset}.`)
  const [gas, gasPrice] = await Promise.all([
    client.estimateGas({ account: account.address, to, value }),
    client.getGasPrice()
  ])
  const fee = gas * gasPrice
  return {
    gas: gas.toString(),
    feeRaw: fee.toString(),
    feeFormatted: formatUnits(fee, config.decimals),
    symbol: config.asset
  }
}

export async function sendNativeTransfer ({ mnemonic, to, amount, network, onSubmitted }) {
  const config = requireEvmNetwork(network)
  const account = mnemonicToAccount(mnemonic)
  const chain = viemChain(config)
  const transport = http(PAYMENT_RPC_PROXY)
  const walletClient = createWalletClient({ account, chain, transport })
  const client = createPublicClient({ chain, transport })
  const txHash = await walletClient.sendTransaction({
    to,
    value: parseUnits(String(amount), config.decimals)
  })
  const explorerUrl = transactionUrl(config, txHash)
  onSubmitted?.({ txHash, explorerUrl })
  const receipt = await client.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') throw new Error('Transaction failed on-chain.')
  return { txHash, explorerUrl, status: 'confirmed' }
}

export async function forwardNativeBalance ({ mnemonic, to, network, onSubmitted }) {
  const config = requireEvmNetwork(network)
  const account = mnemonicToAccount(mnemonic)
  const chain = viemChain(config)
  const transport = http(PAYMENT_RPC_PROXY)
  const client = createPublicClient({ chain, transport })
  const balance = await client.getBalance({ address: account.address })
  const [gas, gasPrice] = await Promise.all([
    client.estimateGas({ account: account.address, to, value: balance / 2n }),
    client.getGasPrice()
  ])
  const fee = gas * gasPrice
  const value = balance - fee
  if (value <= 0n) throw new Error(`Balance is too low to cover the ${config.asset} network fee.`)

  const walletClient = createWalletClient({ account, chain, transport })
  const txHash = await walletClient.sendTransaction({ to, value, gas, gasPrice })
  const explorerUrl = transactionUrl(config, txHash)
  onSubmitted?.({ txHash, explorerUrl })
  const receipt = await client.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') throw new Error('Forwarding transaction failed on-chain.')
  return {
    txHash,
    explorerUrl,
    status: 'confirmed',
    amount: formatUnits(value, config.decimals)
  }
}

// Compatibility exports for older renderer code and saved development bundles.
export const getNativeUsdcBalance = getNativeBalance
export const sendNativeUsdc = sendNativeTransfer

function publicClient (config) {
  return createPublicClient({ chain: viemChain(config), transport: http(PAYMENT_RPC_PROXY) })
}

function requireEvmNetwork (network) {
  if (!network || network.kind !== 'evm' || !Number.isInteger(network.chainId)) {
    throw new Error(`${network?.name || 'Selected payment network'} does not support native EVM transfers.`)
  }
  return network
}

function viemChain (network) {
  return {
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      name: network.asset,
      symbol: network.asset,
      decimals: network.decimals
    },
    rpcUrls: { default: { http: [PAYMENT_RPC_PROXY], webSocket: [] } },
    blockExplorers: network.explorerUrl
      ? { default: { name: `${network.name} Explorer`, url: network.explorerUrl } }
      : undefined,
    testnet: Boolean(network.testnet)
  }
}

function transactionUrl (network, hash) {
  return network.explorerUrl && hash ? `${network.explorerUrl}/tx/${hash}` : ''
}
