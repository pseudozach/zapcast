import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PAYMENT_NETWORK, PAYMENT_NETWORKS, getPaymentNetwork, publicPaymentNetwork } from '../payments/networks.js'
import { PaymentWallet } from '../payments/wallet.js'

test('BOTChain Mainnet is the default payment network', () => {
  const network = getPaymentNetwork({})
  assert.equal(DEFAULT_PAYMENT_NETWORK, 'botchain-mainnet')
  assert.equal(network.chainId, 677)
  assert.equal(network.rpcUrls[0], 'https://rpc.botchain.ai')
  assert.equal(network.asset, 'BOT')
  assert.equal(network.totalSupply, '150 Million')
  assert.equal(network.explorerUrl, 'https://scan.botchain.ai')
  assert.equal(network.faucetUrl, '')
})

test('only BOTChain Mainnet and Testnet are supported', () => {
  assert.deepEqual(Object.keys(PAYMENT_NETWORKS), ['botchain-mainnet', 'botchain-testnet'])
})

test('one environment value selects BOTChain Testnet', () => {
  const network = publicPaymentNetwork(getPaymentNetwork({ ZAPCAST_PAYMENT_NETWORK: 'botchain-testnet' }))
  assert.equal(network.key, 'botchain-testnet')
  assert.equal(network.chainId, 968)
  assert.equal(network.asset, 'BOT')
  assert.equal(network.totalSupply, '150 Million')
  assert.equal(network.explorerUrl, 'https://scan.bohr.life')
  assert.equal(network.faucetUrl, 'https://faucet.botchain.ai/basic')
})

test('unsupported payment network values fail clearly', () => {
  assert.throws(
    () => getPaymentNetwork({ ZAPCAST_PAYMENT_NETWORK: 'testnet' }),
    /Unsupported ZAPCAST_PAYMENT_NETWORK/
  )
})

test('switching BOTChain networks does not overwrite existing wallet material', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zapcast-wallet-'))
  const existing = {
    mnemonic: 'existing wallet material',
    address: '0x1111111111111111111111111111111111111111',
    network: 'botchain-testnet',
    asset: 'BOT'
  }
  try {
    await writeFile(join(directory, 'wallet.json'), JSON.stringify(existing))
    const wallet = new PaymentWallet({ directory, network: getPaymentNetwork({}) })
    await wallet.ready()

    assert.equal(wallet.snapshot().network, 'botchain-mainnet')
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'wallet.json'), 'utf8')), existing)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
