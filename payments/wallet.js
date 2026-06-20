import { DEFAULTS } from '../src/config.js'
import { fsPromises, joinPath } from '../utils/platform.js'

const WALLET_FILE = 'wallet.json'
const TRANSFERS_FILE = 'transfers.csv'
const ARC_EXPLORER_URL = 'https://testnet.arcscan.app'

export class PaymentWallet {
  constructor ({ directory = DEFAULTS.walletDirectory, logger } = {}) {
    this.directory = directory
    this.logger = logger
    this.wallet = null
  }

  async ready () {
    if (this.wallet) return this
    const fs = await fsPromises()
    await fs.mkdir(this.directory, { recursive: true })
    this.wallet = await this.readWallet(fs)
    return this
  }

  async readWallet (fs) {
    const file = joinPath(this.directory, WALLET_FILE)
    try {
      const existing = JSON.parse(await fs.readFile(file, 'utf8'))
      return normalizeWallet(existing)
    } catch (err) {
      if (err.code === 'ENOENT') return normalizeWallet({})
      throw err
    }
  }

  async importWallet ({ mnemonic, address }) {
    const next = normalizeWallet({
      ...this.wallet,
      mnemonic: String(mnemonic || '').trim(),
      address: String(address || '').trim(),
      createdAt: this.wallet?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    if (!next.mnemonic) throw new Error('Wallet mnemonic is required.')
    if (!isEvmAddress(next.address)) throw new Error('Wallet address must be a valid EVM address.')
    this.wallet = next
    await this.writeWallet()
    this.logger?.add('wallet_imported', { message: this.wallet.address })
    return this.snapshot({ includeSecret: true })
  }

  async updateSettings ({ forwardingAddress, forwardThreshold } = {}) {
    await this.ready()
    const patch = {}
    if (forwardingAddress !== undefined) {
      const trimmed = String(forwardingAddress || '').trim()
      if (trimmed && !isEvmAddress(trimmed)) throw new Error('Forwarding address must be a valid EVM address.')
      patch.forwardingAddress = trimmed
    }
    if (forwardThreshold !== undefined) {
      const threshold = String(forwardThreshold || '').trim()
      if (!threshold || Number(threshold) < 0) throw new Error('Forward threshold must be zero or higher.')
      patch.forwardThreshold = threshold
    }
    Object.assign(this.wallet, patch, { updatedAt: new Date().toISOString() })
    await this.writeWallet()
    return this.snapshot({ includeSecret: true })
  }

  async recordTransfer (transfer) {
    await this.ready()
    const fs = await fsPromises()
    await fs.mkdir(this.directory, { recursive: true })
    const file = joinPath(this.directory, TRANSFERS_FILE)
    const exists = await fs.stat(file).then(() => true).catch(() => false)
    const row = [
      new Date().toISOString(),
      transfer.type,
      transfer.status,
      transfer.role,
      transfer.streamId,
      this.wallet.address,
      transfer.to,
      transfer.amount,
      transfer.asset || this.wallet.asset,
      transfer.txHash,
      transfer.explorerUrl || explorerTxUrl(transfer.txHash)
    ].map(csvCell).join(',')
    if (!exists) {
      await fs.writeFile(file, 'timestamp,type,status,role,streamId,from,to,amount,asset,txHash,explorerUrl\n')
    }
    await fs.appendFile(file, `${row}\n`)
    return file
  }

  async writeWallet () {
    const fs = await fsPromises()
    await fs.mkdir(this.directory, { recursive: true })
    await fs.writeFile(joinPath(this.directory, WALLET_FILE), JSON.stringify(this.wallet, null, 2), { mode: 0o600 })
  }

  snapshot ({ includeSecret = false } = {}) {
    if (!this.wallet) return emptyWallet()
    return {
      address: this.wallet.address,
      mnemonic: includeSecret ? this.wallet.mnemonic : '',
      network: this.wallet.network,
      asset: this.wallet.asset,
      forwardingAddress: this.wallet.forwardingAddress,
      forwardThreshold: this.wallet.forwardThreshold,
      transfersFile: joinPath(this.directory, TRANSFERS_FILE),
      explorerBaseUrl: ARC_EXPLORER_URL
    }
  }
}

function normalizeWallet (wallet) {
  return {
    mnemonic: wallet.mnemonic || '',
    address: wallet.address || '',
    forwardingAddress: wallet.forwardingAddress || '',
    forwardThreshold: wallet.forwardThreshold || '0.1',
    network: wallet.network || 'arc-testnet',
    asset: wallet.asset || 'USDC',
    createdAt: wallet.createdAt || '',
    updatedAt: wallet.updatedAt || ''
  }
}

function emptyWallet () {
  return {
    address: '',
    mnemonic: '',
    network: 'arc-testnet',
    asset: 'USDC',
    forwardingAddress: '',
    forwardThreshold: '0.1',
    transfersFile: '',
    explorerBaseUrl: ARC_EXPLORER_URL
  }
}

function isEvmAddress (value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''))
}

function explorerTxUrl (hash) {
  return hash ? `${ARC_EXPLORER_URL}/tx/${hash}` : ''
}

function csvCell (value) {
  const text = String(value ?? '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}
