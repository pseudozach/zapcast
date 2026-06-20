export async function postJson (url, body, { timeoutMs = 10000 } = {}) {
  if (typeof fetch === 'function') return postJsonWithFetch(url, body, { timeoutMs })
  if (!globalThis.Bare) return postJsonWithNodeHttp(url, body, { timeoutMs })
  return postJsonWithBareHttp(url, body, { timeoutMs })
}

async function postJsonWithFetch (url, body, { timeoutMs }) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller?.signal
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`)
    return text ? JSON.parse(text) : null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function postJsonWithBareHttp (url, body, { timeoutMs }) {
  const http = await import('bare-http1')
  const payload = JSON.stringify(body)
  return await new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString()
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 240)}`))
          return
        }
        try {
          resolve(text ? JSON.parse(text) : null)
        } catch (err) {
          reject(err)
        }
      })
    })
    const timer = setTimeout(() => {
      req.destroy?.(new Error(`HTTP request timed out after ${timeoutMs}ms`))
      reject(new Error(`HTTP request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    req.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    req.on('close', () => clearTimeout(timer))
    req.end(payload)
  })
}

async function postJsonWithNodeHttp (url, body, { timeoutMs }) {
  const target = new URL(url)
  const transport = target.protocol === 'https:' ? await import('node:https') : await import('node:http')
  const payload = JSON.stringify(body)
  return await new Promise((resolve, reject) => {
    const req = transport.request(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'content-length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString()
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 240)}`))
          return
        }
        try {
          resolve(text ? JSON.parse(text) : null)
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`))
    })
    req.on('error', reject)
    req.end(payload)
  })
}
