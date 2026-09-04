import test from 'node:test'
import assert from 'node:assert/strict'
import { botToUsd, DEFAULT_TIP_BOT, DEFAULT_TIP_USD_TARGET, parseCoinstoreBotPrice, usdToBot } from '../payments/bot-price.js'

test('parses the Coinstore BOTUSDT ticker response', () => {
  assert.equal(parseCoinstoreBotPrice({
    data: [{ id: 1943, symbol: 'BOTUSDT', price: '10.326' }],
    code: 0
  }), 10.326)
})

test('rejects invalid Coinstore price responses', () => {
  assert.throws(() => parseCoinstoreBotPrice({ data: [], code: 0 }), /invalid BOTUSDT price/)
  assert.throws(() => parseCoinstoreBotPrice({ data: [{ symbol: 'BOTUSDT', price: '0' }], code: 0 }), /invalid BOTUSDT price/)
})

test('converts BOT and approximate USD amounts', () => {
  assert.equal(DEFAULT_TIP_BOT, '0.01')
  assert.equal(DEFAULT_TIP_USD_TARGET, '0.10')
  assert.equal(botToUsd(DEFAULT_TIP_BOT, 10.326), 0.10326)
  assert.ok(Math.abs(usdToBot(0.10, 10.326) - 0.009684292) < 0.000000001)
})
