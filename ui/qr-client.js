import QRCode from 'qrcode'

export async function lightningAddressQrDataUrl (address) {
  const normalized = String(address || '').trim()
  if (!normalized) return ''
  return QRCode.toDataURL('lightning:' + normalized, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 180,
    color: {
      dark: '#172026',
      light: '#ffffff'
    }
  })
}
