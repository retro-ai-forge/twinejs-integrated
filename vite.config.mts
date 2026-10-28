import react from '@vitejs/plugin-react';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import {defineConfig} from 'vite';
import checker from 'vite-plugin-checker';
import {nodePolyfills} from 'vite-plugin-node-polyfills';
import {VitePWA} from 'vite-plugin-pwa';
import packageJson from './package.json' with {type: 'json'};

export default defineConfig({
	// Served under /twine/ inside the Wudlands app (both the dev proxy and the
	// static production build). Override with VITE_BASE for other targets
	// (e.g. Electron, which wants './').
	base: process.env.VITE_BASE ?? '/twine/',
	build: {
		outDir: 'dist/web',
		target: browserslistToEsbuild(['>0.2%', 'not dead', 'not op_mini all'])
	},
	define: {
		// Make app name and version available to code.
		// https://stackoverflow.com/a/74860417/7569568
		'process.env.VITE_APP_NAME': JSON.stringify(packageJson.name),
		'process.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
	},
	plugins: [
		checker({
			eslint: {lintCommand: 'eslint src'},
			overlay: {
				initialIsOpen: false
			},
			typescript: true
		}),
		nodePolyfills(
			// We only need a `global` injected, for CodeMirror.
			{include: [], globals: {global: true}}
		),
		react(),
		VitePWA({
			manifest: {
				icons: [
					{
						src: './icons/pwa.png',
						sizes: '1024x1024',
						type: 'image/png'
					},
					{
						src: './icons/pwa-maskable.png',
						purpose: 'maskable',
						sizes: '1024x1024',
						type: 'image/png'
					}
				]
			},
			registerType: 'autoUpdate',
			includeAssets: ['locales/**', 'pwa/**', 'story-formats/**'],
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,woff,woff2}']
			}
		})
	],
	server: {
		// Don't auto-open a tab: Twine is launched alongside the Wudlands app via
		// the root `npm run dev`, and is reached at /twine/ (proxied to this server
		// by Next) through the "Open the Story Editor" link on the Create → Tools
		// for Artists page.
		open: false,
		// Allow the Next dev server (different origin/port) to proxy us.
		cors: true,
		// The page is served from the Next origin, so point the HMR client straight
		// at this vite server instead of the page origin.
		hmr: {host: 'localhost', clientPort: 5173},
		// Poll instead of using inotify watchers, to avoid the system file-watcher
		// limit (ENOSPC) when running next + vite together. node_modules is ignored
		// by default, so polling only covers source files.
		watch: {usePolling: true, interval: 1000}
	}
});
