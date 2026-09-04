import { getJson } from '../utils/http-json.js'

export const COINSTORE_BOT_PRICE_URL = 'https://api.coinstore.com/api/v1/ticker/price;symbol=BOTUSDT'
export const DEFAULT_TIP_BOT = '0.01'
export const DEFAULT_TIP_USD_TARGET = '0.10'
export const FALLBACK_BOT_USD_PRICE = 10.325
export const BOT_PRICE_CACHE_MS = 60_000

let cachedPrice = null

export async function getBotPrice ({ environment = runtimeEnvironment(), force = false, now = Date.now() } = {}) {
  if (!force && cachedPrice && now - Date.parse(cachedPrice.fetchedAt) < BOT_PRICE_CACHE_MS) return cachedPrice

  const sourceUrl = String(environment.ZAPCAST_BOT_PRICE_URL || COINSTORE_BOT_PRICE_URL).trim()
  try {
    const payload = await getJson(sourceUrl)
    const priceUsd = parseCoinstoreBotPrice(payload)
    cachedPrice = priceSnapshot({ priceUsd, sourceUrl, fetchedAt: new Date(now).toISOString() })
    return cachedPrice
  } catch (err) {
    if (cachedPrice) return { ...cachedPrice, stale: true, error: err?.message || String(err) }
    return priceSnapshot({
      priceUsd: FALLBACK_BOT_USD_PRICE,
      sourceUrl,
      fetchedAt: new Date(now).toISOString(),
      stale: true,
      error: err?.message || String(err)
    })
  }
}

export function parseCoinstoreBotPrice (payload) {
  const ticker = payload?.data?.find?.(item => item?.symbol === 'BOTUSDT')
  const price = Number(ticker?.price)
  if (payload?.code !== 0 || !Number.isFinite(price) || price <= 0) {
    throw new Error('Coinstore returned an invalid BOTUSDT price.')
  }
  return price
}

export function botToUsd (botAmount, priceUsd) {
  const amount = Number(botAmount)
  const price = Number(priceUsd)
  return Number.isFinite(amount) && Number.isFinite(price) ? amount * price : NaN
}

export function usdToBot (usdAmount, priceUsd) {
  const amount = Number(usdAmount)
  const price = Number(priceUsd)
  return Number.isFinite(amount) && Number.isFinite(price) && price > 0 ? amount / price : NaN
}

function priceSnapshot ({ priceUsd, sourceUrl, fetchedAt, stale = false, error = '' }) {
  return {
    symbol: 'BOT',
    marketSymbol: 'BOTUSDT',
    quoteAsset: 'USDT',
    priceUsd,
    source: 'Coinstore',
    sourceUrl,
    fetchedAt,
    stale,
    error
  }
}

function runtimeEnvironment () {
  return globalThis.process?.env || globalThis.Bare?.env || {}
}
