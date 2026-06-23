import { DEFAULTS } from '../src/config.js'
import { fsPromises, joinPath } from '../utils/platform.js'

const WALLET_FILE = 'wallet.json'
const WALLET_ARCHIVE_DIRECTORY = 'wallets'
const TRANSFERS_FILE = 'transfers.csv'
const ARC_EXPLORER_URL = 'https://testnet.arcscan.app'

export class PaymentWallet {
  constructor ({ directory = DEFAULTS.walletDirectory, legacyDirectory = '', slot = 1, logger } = {}) {
    this.directory = directory
    this.legacyDirectory = legacyDirectory
    this.slot = Number(slot) || 1
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
      if (err.code === 'ENOENT') {
        if (this.legacyDirectory) return await this.migrateSlotWallet(fs)
        return await this.migrateLegacyWallet(fs)
      }
      throw err
    }
  }

  async migrateSlotWallet (fs) {
    const candidates = await this.readLegacyCandidates(fs)
    const selected = candidates[this.slot - 1]
    if (!selected) return normalizeWallet({})

    await this.writeWalletFiles(fs, selected.wallet)
    if (selected.transferFile) {
      await fs.writeFile(
        joinPath(this.directory, TRANSFERS_FILE),
        await fs.readFile(selected.transferFile)
      )
    }
    this.logger?.add('wallet_restored', {
      message: `slot ${this.slot}: ${selected.wallet.address}`
    })
    return selected.wallet
  }

  async readLegacyCandidates (fs) {
    const candidates = new Map()
    const addCandidate = candidate => {
      if (!candidate?.wallet?.mnemonic || !isEvmAddress(candidate.wallet.address)) return
      const key = candidate.wallet.address.toLowerCase()
      const existing = candidates.get(key)
      if (!existing) {
        candidates.set(key, candidate)
        return
      }
      existing.active ||= candidate.active
      if (candidate.usedAt > existing.usedAt) {
        existing.usedAt = candidate.usedAt
        existing.transferFile = candidate.transferFile
      }
      if (candidate.updatedAt > existing.updatedAt) {
        existing.updatedAt = candidate.updatedAt
        existing.wallet = candidate.wallet
      }
    }

    addCandidate(await this.readCandidate(fs, this.legacyDirectory, true))
    const entries = await fs.readdir(this.legacyDirectory).catch(() => [])
    for (const entry of entries) {
      if (entry === 'slots' || entry === WALLET_ARCHIVE_DIRECTORY) continue
      addCandidate(await this.readCandidate(fs, joinPath(this.legacyDirectory, entry), false))
    }

    const archiveDirectory = joinPath(this.legacyDirectory, WALLET_ARCHIVE_DIRECTORY)
    const archives = await fs.readdir(archiveDirectory).catch(() => [])
    for (const archive of archives) {
      if (!archive.endsWith('.json')) continue
      try {
        const file = joinPath(archiveDirectory, archive)
        const wallet = normalizeWallet(JSON.parse(await fs.readFile(file, 'utf8')))
        const stat = await fs.stat(file)
        addCandidate({ wallet, active: false, usedAt: 0, updatedAt: walletTimestamp(wallet, stat.mtimeMs) })
      } catch {}
    }

    return [...candidates.values()].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return (b.usedAt || b.updatedAt) - (a.usedAt || a.updatedAt)
    })
  }

  async readCandidate (fs, directory, active) {
    try {
      const walletFile = joinPath(directory, WALLET_FILE)
      const wallet = normalizeWallet(JSON.parse(await fs.readFile(walletFile, 'utf8')))
      const walletStat = await fs.stat(walletFile)
      const transferFile = joinPath(directory, TRANSFERS_FILE)
      const transferStat = await fs.stat(transferFile).catch(() => null)
      return {
        wallet,
        active,
        transferFile: transferStat ? transferFile : '',
        usedAt: transferStat?.mtimeMs || 0,
        updatedAt: walletTimestamp(wallet, walletStat.mtimeMs)
      }
    } catch {
      return null
    }
  }

  async migrateLegacyWallet (fs) {
    const entries = await fs.readdir(this.directory).catch(err => {
      if (err.code === 'ENOENT') return []
      throw err
    })
    const candidates = []

    for (const entry of entries) {
      const walletFile = joinPath(this.directory, entry, WALLET_FILE)
      try {
        const wallet = normalizeWallet(JSON.parse(await fs.readFile(walletFile, 'utf8')))
        if (!wallet.mnemonic || !isEvmAddress(wallet.address)) continue
        const walletStat = await fs.stat(walletFile)
        const transferFile = joinPath(this.directory, entry, TRANSFERS_FILE)
        const transferStat = await fs.stat(transferFile).catch(() => null)
        candidates.push({
          wallet,
          directory: joinPath(this.directory, entry),
          usedAt: transferStat?.mtimeMs || 0,
          updatedAt: Date.parse(wallet.updatedAt || wallet.createdAt) || walletStat.mtimeMs || 0
        })
        await this.writeArchive(fs, wallet)
      } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err
      }
    }

    if (!candidates.length) return normalizeWallet({})
    const used = candidates.filter(candidate => candidate.usedAt > 0)
    const selected = (used.length ? used : candidates)
      .sort((a, b) => (b.usedAt || b.updatedAt) - (a.usedAt || a.updatedAt))[0]
    this.logger?.add('wallet_restored', { message: selected.wallet.address })
    await this.writeWalletFiles(fs, selected.wallet)
    if (selected.usedAt) {
      const transfers = await fs.readFile(joinPath(selected.directory, TRANSFERS_FILE))
      await fs.writeFile(joinPath(this.directory, TRANSFERS_FILE), transfers)
    }
    return selected.wallet
  }

  async importWallet ({ mnemonic, address, createIfEmpty = false }) {
    await this.ready()
    const fs = await fsPromises()
    if (createIfEmpty) {
      const active = await this.readActiveWallet(fs)
      if (active?.address) {
        this.wallet = active
        return this.snapshot({ includeSecret: true })
      }
    }

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

  async updateSettings ({ forwardingAddress, forwardThreshold, lightningAddress } = {}) {
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
    if (lightningAddress !== undefined) {
      const trimmed = String(lightningAddress || '').trim()
      if (trimmed && !isLightningAddress(trimmed)) throw new Error('Lightning address must look like name@domain.')
      patch.lightningAddress = trimmed
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
    this.wallet.lastUsedAt = new Date().toISOString()
    await this.writeWallet()
    return file
  }

  async writeWallet () {
    const fs = await fsPromises()
    await fs.mkdir(this.directory, { recursive: true })
    await this.writeWalletFiles(fs, this.wallet)
  }

  async writeWalletFiles (fs, wallet) {
    await fs.writeFile(joinPath(this.directory, WALLET_FILE), JSON.stringify(wallet, null, 2), { mode: 0o600 })
    await this.writeArchive(fs, wallet)
  }

  async writeArchive (fs, wallet) {
    if (!isEvmAddress(wallet.address)) return
    const archiveDirectory = joinPath(this.directory, WALLET_ARCHIVE_DIRECTORY)
    await fs.mkdir(archiveDirectory, { recursive: true })
    await fs.writeFile(joinPath(archiveDirectory, `${wallet.address.toLowerCase()}.json`), JSON.stringify(wallet, null, 2), { mode: 0o600 })
  }

  async readActiveWallet (fs) {
    try {
      return normalizeWallet(JSON.parse(await fs.readFile(joinPath(this.directory, WALLET_FILE), 'utf8')))
    } catch (err) {
      if (err.code === 'ENOENT') return null
      throw err
    }
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
      lightningAddress: this.wallet.lightningAddress,
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
    lightningAddress: wallet.lightningAddress || '',
    network: wallet.network || 'arc-testnet',
    asset: wallet.asset || 'USDC',
    createdAt: wallet.createdAt || '',
    updatedAt: wallet.updatedAt || '',
    lastUsedAt: wallet.lastUsedAt || ''
  }
}

function walletTimestamp (wallet, fallback = 0) {
  return Date.parse(wallet.lastUsedAt || wallet.updatedAt || wallet.createdAt) || fallback || 0
}

function emptyWallet () {
  return {
    address: '',
    mnemonic: '',
    network: 'arc-testnet',
    asset: 'USDC',
    forwardingAddress: '',
    forwardThreshold: '0.1',
    lightningAddress: '',
    transfersFile: '',
    explorerBaseUrl: ARC_EXPLORER_URL
  }
}

function isEvmAddress (value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''))
}

function isLightningAddress (value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''))
}

function explorerTxUrl (hash) {
  return hash ? `${ARC_EXPLORER_URL}/tx/${hash}` : ''
}

function csvCell (value) {
  const text = String(value ?? '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}
