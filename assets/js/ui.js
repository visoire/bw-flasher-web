// bw-flasher-web — ui.js
// UI controller — connects DOM to flasher classes, handles all user interaction
// ScooterTeam © 2024-2025 CC BY-NC-SA 4.0

'use strict'

// ═══════════════════════════════════════════════════════════════════════════
//  UI CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

const UI = {
	$: id => document.getElementById(id),

	_logEl: null,
	_abortCtrl: null,
	_serial: null,
	_fwData: null,
	_fwType: null,

	init() {
		this._logEl = this.$('log')
		this.$('btnWebSerial').addEventListener('click', () => this.connectWebSerial())
		this.$('btnWebUSB').addEventListener('click', () => this.connectWebUSB())
		this.$('btnDisconnect').addEventListener('click', () => this.disconnect())
		this.$('btnTestConn').addEventListener('click', () => this.testConnection())
		this.$('btnFlash').addEventListener('click', () => this.startFlash())
		this.$('btnAbort').addEventListener('click', () => this.abortFlash())
		this.$('btnClearLog').addEventListener('click', () => {
			this._logEl.innerHTML = ''
		})
		this.$('btnExportLog').addEventListener('click', () => this.exportLog())
		this.$('fwFile').addEventListener('change', e => this.onFileSelect(e))
		this.$('chkSim').addEventListener('change', () => this._updateSimMode())

		// Check API availability
		if (!navigator.serial && !navigator.usb) {
			this.addLog('⚠ Neither Web Serial nor WebUSB is available. Use Chrome/Edge/Opera browser.', 'err')
		} else {
			if (navigator.serial) this.addLog('✓ Web Serial API available', 'ok')
			if (navigator.usb) this.addLog('✓ WebUSB API available', 'ok')
		}

		this._updateSimMode()

		// Restore music state
		try {
			const musicSaved = localStorage.getItem('bwf_music')
			if (musicSaved === 'on' && typeof Chiptune !== 'undefined') {
				// We wait a bit for Chiptune to be ready if it's auto-started by disclaimerAccept
				setTimeout(() => {
					if (!Chiptune.isPlaying()) {
						Chiptune.toggle()
						this.$('btnMusic').textContent = '♫'
						this.$('btnMusic').style.color = 'var(--amber)'
					}
				}, 500)
			}
		} catch (_) {}

		// Music toggle button (left-click = play/pause, right-click = load file)
		this.$('btnMusic').addEventListener('click', () => {
			const on = Chiptune.toggle()
			this.$('btnMusic').textContent = on ? '♫' : '♪'
			this.$('btnMusic').style.color = on ? 'var(--amber)' : ''
			try {
				localStorage.setItem('bwf_music', on ? 'on' : 'off')
			} catch (_) {}
		})
		this.$('inputMusicFile').addEventListener('change', e => {
			const file = e.target.files[0]
			if (!file) return
			Chiptune.loadFile(file)
			this.$('btnMusic').textContent = '♫'
			this.$('btnMusic').style.color = 'var(--amber)'
			this.addLog(`Music: loaded ${file.name}`, 'info')
			try {
				localStorage.setItem('bwf_music', 'on')
			} catch (_) {}
			e.target.value = '' // reset so same file can be re-selected
		})

		// Global Drag & Drop firmware loading
		const overlay = this.$('globalDropOverlay')
		let dragCounter = 0

		window.addEventListener('dragenter', e => {
			e.preventDefault()
			dragCounter++
			if (overlay) overlay.classList.add('active')
		})

		window.addEventListener('dragover', e => {
			e.preventDefault()
		})

		window.addEventListener('dragleave', e => {
			e.preventDefault()
			dragCounter--
			if (dragCounter <= 0 && overlay) {
				overlay.classList.remove('active')
				dragCounter = 0
			}
		})

		window.addEventListener('drop', async e => {
			e.preventDefault()
			dragCounter = 0
			if (overlay) overlay.classList.remove('active')

			const file = e.dataTransfer.files[0]
			if (file) {
				// Switch to firmware tab on mobile so user sees progress
				if (typeof Tabs !== 'undefined') Tabs.activate('firmware')
				await this.loadFirmwareFile(file)
			}
		})
	},

	_updateSimMode() {
		const sim = this.$('chkSim').checked
		this.$('btnWebSerial').disabled = sim
		this.$('btnWebUSB').disabled = sim
		if (sim) {
			this.setConnected(true, 'Simulation mode')
		} else if (!this._serial || !this._serial.connected) {
			this.setConnected(false, 'Not connected')
		}
		this._updateFlashButton()
	},

	async connectWebSerial() {
		if (!navigator.serial) {
			this.addLog('Web Serial not supported in this browser', 'err')
			return
		}
		try {
			const adapter = new WebSerialAdapter()
			await adapter.connect(19200)
			this._serial = adapter
			this.setConnected(true, 'Connected via Web Serial')
			this.addLog('✓ Web Serial connected @ 19200 baud', 'ok')
		} catch (e) {
			this.addLog(`Connection failed: ${e.message}`, 'err')
		}
	},

	async connectWebUSB() {
		if (!navigator.usb) {
			this.addLog('WebUSB not supported in this browser', 'err')
			return
		}
		this.$('alertWebApi').classList.add('show')
		try {
			const adapter = new WebUSBAdapter()
			await adapter.connect(19200)
			this._serial = adapter
			const name = adapter.deviceName || (adapter._dev && adapter._dev.productName) || 'USB device'
			const chip = adapter.chipName || '?'
			this.setConnected(true, `WebUSB: ${name} [${chip}]`)
			this.addLog(`✓ WebUSB connected: ${name} (${chip}) @ 19200 baud`, 'ok')
		} catch (e) {
			this.$('alertWebApi').classList.remove('show')
			this.addLog(`WebUSB connection failed: ${e.message}`, 'err')
		}
	},

	async disconnect() {
		if (this._serial) {
			await this._serial.disconnect().catch(() => {})
			this._serial = null
		}
		this.setConnected(false, 'Disconnected')
		this.$('alertWebApi').classList.remove('show')
		this.addLog('Disconnected', 'warn')
		this._updateFlashButton()
	},

	setConnected(connected, text) {
		const dot = this.$('connDot')
		const status = this.$('connStatusText')
		dot.className = 'conn-dot' + (connected ? ' ok' : '')
		status.textContent = text
		this.$('btnDisconnect').disabled = !connected
		this.$('btnTestConn').disabled = !connected
		this._updateFlashButton()
	},

	async loadFirmwareFile(file) {
		if (!file) return
		this.addLog(`Loading: ${file.name} (${file.size} bytes)…`, 'info')
		try {
			const raw = await file.arrayBuffer()
			const data = await processFirmware(new Uint8Array(raw), (m, t) => this.addLog(m, t))
			const info = getFirmwareInfo(data)

			this._fwData = data
			this._fwType = info.type

			this._renderFwInfo(info, file.name)
			this.addLog(`✓ Firmware detected: ${info.type} (${data.length} bytes)`, info.type !== 'UNKNOWN' ? 'ok' : 'warn')
			this._updateFlashButton()
		} catch (e) {
			this.addLog(`Error loading firmware: ${e.message}`, 'err')
			this._fwData = null
			this._fwType = null
			this.$('fwInfoBox').style.display = 'none'
			this._updateFlashButton()
		}
	},

	async onFileSelect(e) {
		await this.loadFirmwareFile(e.target.files[0])
	},

	_renderFwInfo(info, filename) {
		const box = this.$('fwInfoBox')
		const typeClass = info.type === 'UNKNOWN' ? 'unk' : 'ok'
		let html = `
      <span class="k">File</span><span class="v">${filename}</span>
      <span class="k">Type</span><span class="v ${typeClass}">${info.type}</span>
      <span class="k">Size</span><span class="v">${info.size} bytes (0x${info.size.toString(16).toUpperCase()})</span>
    `
		if (info.protocol) html += `<span class="k">Protocol</span><span class="v">${info.protocol}</span>`
		if (info.signature) html += `<span class="k">Signature</span><span class="v">${info.signature}</span>`
		if (info.encryption) html += `<span class="k">Encryption</span><span class="v">${info.encryption}</span>`
		if (info.signingOffset) html += `<span class="k">Key offset</span><span class="v">${info.signingOffset}</span>`
		box.innerHTML = html
		box.style.display = 'grid'
	},

	_updateFlashButton() {
		const sim = this.$('chkSim').checked
		const hasConn = sim || (this._serial && this._serial.connected)
		const hasFw = this._fwData && this._fwType && this._fwType !== 'UNKNOWN'
		this.$('btnFlash').disabled = !(hasConn && hasFw)
	},

	async testConnection() {
		if (!this._fwData && !this.$('chkSim').checked) {
			this.addLog('Load a firmware file first to detect the protocol for test connection', 'warn')
			return
		}
		const type = this._fwType || 'BRIGHTWAY'
		const sim = this.$('chkSim').checked
		const debug = this.$('chkDebug').checked
		const serial = sim ? new SimulationSerial() : this._serial
		if (sim) await serial.connect()
		this._abortCtrl = { aborted: false }

		const opts = {
			simulation: sim,
			debug,
			onLog: (m, t) => this.addLog(m, t),
			onStatus: s => this.setStatus(s),
			onProgress: p => this.setProgress(p),
			abortSignal: this._abortCtrl,
		}

		try {
			this.setFlashState('running')
			if (type === 'BRIGHTWAY') {
				const f = new BrightwayFlasher(serial, opts)
				if (this._fwData) f.loadFirmware(this._fwData)
				await f.testConnection()
			} else if (type === 'LEQI') {
				const f = new LeqiFlasher(serial, opts)
				if (this._fwData) f.loadFirmware(this._fwData)
				await f.testConnection()
			}
			this.addLog('✓ Connection test passed', 'ok')
			this.setFlashState('done')
		} catch (e) {
			this.addLog(`Connection test failed: ${e.message}`, 'err')
			this.setFlashState('error')
		}
	},

	async startFlash() {
		if (!this._fwData) {
			this.addLog('No firmware loaded', 'err')
			return
		}
		const sim = this.$('chkSim').checked
		const debug = this.$('chkDebug').checked
		const serial = sim ? new SimulationSerial() : this._serial
		if (sim) await serial.connect()

		this._abortCtrl = { aborted: false }
		this.$('btnFlash').disabled = true
		this.$('btnAbort').disabled = false

		const opts = {
			simulation: sim,
			debug,
			onLog: (m, t) => this.addLog(m, t),
			onStatus: s => this.setStatus(s),
			onProgress: p => this.setProgress(p),
			abortSignal: this._abortCtrl,
		}

		this.setFlashState('running')
		this.setStatus('Starting…')
		this.setProgress(0)

		try {
			if (this._fwType === 'BRIGHTWAY') {
				this.addLog('Starting Brightway DFU flash…', 'info')
				const f = new BrightwayFlasher(serial, opts)
				f.loadFirmware(this._fwData)
				await f.run()
			} else if (this._fwType === 'LEQI') {
				this.addLog('Starting LEQI binary flash…', 'info')
				const f = new LeqiFlasher(serial, opts)
				f.loadFirmware(this._fwData)
				await f.run()
			} else {
				throw new Error('Unknown firmware type')
			}
			this.addLog('🎉 Flash completed successfully!', 'ok')
			this.setFlashState('done')
		} catch (e) {
			this.addLog(`❌ Flash error: ${e.message}`, 'err')
			this.setFlashState('error')
		} finally {
			this.$('btnAbort').disabled = true
			this._updateFlashButton()
		}
	},

	abortFlash() {
		if (this._abortCtrl) this._abortCtrl.aborted = true
		this.addLog('Abort requested…', 'warn')
		this.$('btnAbort').disabled = true
	},

	addLog(msg, type = '') {
		const el = this._logEl
		const now = new Date()
		const ts = now.toTimeString().substring(0, 8) + '.' + now.getMilliseconds().toString().padStart(3, '0')
		const line = document.createElement('div')
		line.className = 'line'
		line.innerHTML = `<span class="ts">[${ts}]</span><span class="msg ${type}">${escHtml(msg)}</span>`
		el.appendChild(line)
		el.scrollTop = el.scrollHeight
	},

	exportLog() {
		let text = 'BW Flasher Web — System Log\n'
		text += 'Generated: ' + new Date().toLocaleString() + '\n'
		text += '----------------------------------------------------------\n\n'
		const lines = this._logEl.querySelectorAll('.line')
		lines.forEach(l => {
			const ts = l.querySelector('.ts').textContent
			const msg = l.querySelector('.msg').textContent
			text += `${ts} ${msg}\n`
		})

		const blob = new Blob([text], { type: 'text/plain' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = 'system.log'
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	},

	setStatus(text) {
		this.$('progressStatus').textContent = text
		// Match original: when debug=OFF, status messages go to log
		// When debug=ON, they only show in status bar (as in Python's QStatusBar)
		if (!this.$('chkDebug').checked) {
			this.addLog(text, 'info')
		}
	},

	setProgress(pct) {
		const bar = this.$('progressBar')
		const label = this.$('progressPct')
		bar.style.width = pct + '%'
		label.textContent = pct + '%'
		if (pct > 0 && pct < 100) bar.classList.add('active')
		else bar.classList.remove('active')
	},

	async _checkUpdate() {
		try {
			const r = await fetch('https://api.github.com/repos/scooterteam/bw-flasher/releases', {
				headers: { Accept: 'application/vnd.github.v3+json' },
				signal: AbortSignal.timeout(5000),
			})
			if (!r.ok) return
			const releases = await r.json()
			if (!releases || !releases[0]) return
			const latest = releases[0].tag_name.replace(/^v/, '')
			const current = '0.6.0'

			const newer = latest.split('.').map(Number)
			const cur = current.split('.').map(Number)
			let isNewer = false
			for (let i = 0; i < 3; i++) {
				if ((newer[i] || 0) > (cur[i] || 0)) {
					isNewer = true
					break
				}
				if ((newer[i] || 0) < (cur[i] || 0)) break
			}
			if (isNewer) this._showUpdateBanner(latest, releases[0].html_url)
		} catch (e) {}
	},

	_showUpdateBanner(version, url) {
		const banner = document.createElement('div')
		banner.style.cssText =
			'position:fixed;top:0;left:0;right:0;background:rgba(232,163,54,0.15);' +
			'border-bottom:1px solid var(--amber-lo);padding:8px 16px;font-family:var(--font);font-size:11px;' +
			'color:var(--amber);display:flex;align-items:center;gap:10px;z-index:1000'
		banner.innerHTML =
			`⬆ BWFlasher v${version} is available! ` +
			`<a href="${escHtml(url)}" target="_blank" style="color:var(--amber-hi)">Download on GitHub</a>` +
			`<button onclick="this.parentElement.remove()" style="margin-left:auto;background:none;border:none;` +
			`color:var(--amber-lo);cursor:pointer;font-size:14px">✕</button>`
		document.body.prepend(banner)
		this.addLog(`Update available: BWFlasher v${version} — ${url}`, 'warn')
	},

	setFlashState(state) {
		const badge = this.$('flashStatus')
		badge.className = 'status-badge'
		switch (state) {
			case 'running':
				badge.classList.add('running')
				badge.textContent = '● FLASHING'
				break
			case 'done':
				badge.classList.add('done')
				badge.textContent = '✓ DONE'
				break
			case 'error':
				badge.classList.add('error')
				badge.textContent = '✕ ERROR'
				break
			default:
				badge.classList.add('idle')
				badge.textContent = '● IDLE'
				break
		}
	},
}

function escHtml(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

document.addEventListener('DOMContentLoaded', () => UI.init())
