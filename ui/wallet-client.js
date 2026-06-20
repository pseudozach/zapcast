import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from 'viem'
import { arcTestnet } from 'viem/chains'
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts'

export function generateWallet () {
  const mnemonic = generateMnemonic(english)
  const account = mnemonicToAccount(mnemonic)
  return {
    mnemonic,
    address: account.address
  }
}

export async function sendNativeUsdc ({ mnemonic, to, amount }) {
  const account = mnemonicToAccount(mnemonic)
  const client = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http()
  })
  const txHash = await client.sendTransaction({
    to,
    value: parseUnits(amount, 18)
  })
  return {
    txHash,
    explorerUrl: `${arcTestnet.blockExplorers.default.url}/tx/${txHash}`
  }
}

export async function getNativeUsdcBalance ({ address }) {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http()
  })
  const value = await client.getBalance({ address })
  return {
    raw: value.toString(),
    formatted: formatUnits(value, 18),
    symbol: 'USDC'
  }
}
