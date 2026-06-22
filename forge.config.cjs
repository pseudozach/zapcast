const fs = require('node:fs')
const path = require('node:path')

const iconDirectory = path.join(__dirname, 'build', 'icon')

module.exports = {
  packagerConfig: {
    // Holepunch native addons resolve sibling prebuilds at runtime and must remain unpacked.
    asar: false,
    appBundleId: 'live.zapcast.desktop',
    appCategoryType: 'public.app-category.entertainment',
    derefSymlinks: true,
    icon: path.join(__dirname, 'build', 'icon'),
    ignore: [
      /^\/\.git($|\/)/,
      /^\/\.github($|\/)/,
      /^\/data($|\/)/,
      /^\/out($|\/)/,
      /^\/tmp($|\/)/,
      /^\/initial_prompt\.md$/
    ]
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: { format: 'ULFO' }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
      config: {}
    },
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'zapcast',
        setupExe: 'ZapCastSetup.exe',
        setupIcon: path.join(__dirname, 'build', 'icon.ico')
      }
    },
    {
      name: 'pear-electron-forge-maker-appimage',
      platforms: ['linux'],
      config: {
        icons: [16, 32, 64, 128, 256].map(size => ({
          file: path.join(iconDirectory, `icon-${size}x${size}.png`),
          size
        }))
      }
    }
  ],
  hooks: {
    readPackageJson: async (_forgeConfig, packageJson) => ({
      ...packageJson,
      main: 'electron/main.cjs'
    }),
    preMake: async () => {
      fs.rmSync(path.join(__dirname, 'out', 'make'), { recursive: true, force: true })
    }
  }
}
