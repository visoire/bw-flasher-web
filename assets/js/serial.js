// bw-flasher-web — serial.js
// Serial abstraction — FlasherSerial base + WebSerial / WebUSB / Simulation adapters
// ScooterTeam © 2024-2025 CC BY-NC-SA 4.0

'use strict'

// ═══════════════════════════════════════════════════════════════════════════
//  SERIAL ABSTRACTION
// ═══════════════════════════════════════════════════════════════════════════

class FlasherSerial {
	constructor() {
		this.rxBuf = []
		this._waiters = []
		this.connected = false
	}

	_onData(bytes) {
		for (const b of bytes) this.rxBuf.push(b)
		this._waiters.forEach(r => r())
		this._waiters = []
	}

	_waitRx(ms = 5) {
		return new Promise(resolve => {
			if (this.rxBuf.length > 0) {
				resolve()
				return
			}
			const tid = setTimeout(() => {
				this._waiters = this._waiters.filter(x => x !== notify)
				resolve()
			}, ms)
			const notify = () => {
				clearTimeout(tid)
				resolve()
			}
			this._waiters.push(notify)
		})
	}

	/**
	 * Python: serial_conn.read_until(expected_byte)[-expected_n_bytes:]
	 * Reads until terminator byte found or timeout, returns last nBytes.
	 */
	async receiveResponse(nBytes, termByte = 0x0d, timeoutMs = 2000) {
		const collected = []
		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline) {
			while (this.rxBuf.length > 0) {
				const b = this.rxBuf.shift()
				collected.push(b)
				if (b === termByte) {
					return new Uint8Array(collected.slice(Math.max(0, collected.length - nBytes)))
				}
			}
			await this._waitRx(Math.min(5, Math.max(1, deadline - Date.now())))
		}
		return new Uint8Array(collected.slice(Math.max(0, collected.length - nBytes)))
	}

	clearBuffer() {
		this.rxBuf = []
	}
	async write(_data) {
		throw new Error('abstract')
	}
	async disconnect() {
		throw new Error('abstract')
	}
}

// ── Web Serial API adapter ──
class WebSerialAdapter extends FlasherSerial {
	constructor() {
		super()
		this._port = null
		this._writer = null
		this._reader = null
	}

	async connect(baudRate = 19200) {
		this._port = await navigator.serial.requestPort()
		await this._port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' })
		this._writer = this._port.writable.getWriter()
		this._startReadLoop()
		this.connected = true
	}

	_startReadLoop() {
		const reader = this._port.readable.getReader()
		this._reader = reader
		;(async () => {
			try {
				while (true) {
					const { value, done } = await reader.read()
					if (done) break
					if (value) this._onData(value)
				}
			} catch (e) {
				/* disconnected */
			}
		})()
	}

	async write(data) {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
		await this._writer.write(bytes)
	}

	async disconnect() {
		this.connected = false
		try {
			if (this._reader) await this._reader.cancel()
		} catch (e) {}
		try {
			if (this._writer) await this._writer.releaseLock()
		} catch (e) {}
		try {
			if (this._port) await this._port.close()
		} catch (e) {}
	}
}

// ── WebUSB adapter — CH340 driver ported from serial.js (selevo/WebUsbSerialTerminal)
//    Based on Linux kernel ch341.c driver + felHR85/UsbSerial
// ──────────────────────────────────────────────────────────────────────────
const _CH340_CFG = {
	REQUEST_READ_VERSION: 0x5f,
	REQUEST_READ_REGISTRY: 0x95,
	REQUEST_WRITE_REGISTRY: 0x9a,
	REQUEST_SERIAL_INITIATION: 0xa1,
	REG_SERIAL: 0xc29c,
	REG_MODEM_CTRL: 0xa4,
	REG_MODEM_VALUE_OFF: 0xff,
	REG_MODEM_VALUE_ON: 0xdf,
	REG_MODEM_VALUE_CALL: 0x9f,
	REG_BAUD_FACTOR: 0x1312,
	REG_BAUD_OFFSET: 0x0f2c,
	REG_BAUD_LOW: 0x2518,
	REG_CONTROL_STATUS: 0x2727,
	BAUD_RATE: {
		600: { FACTOR: 0x6481, OFFSET: 0x76 },
		1200: { FACTOR: 0xb281, OFFSET: 0x3b },
		2400: { FACTOR: 0xd981, OFFSET: 0x1e },
		4800: { FACTOR: 0x6482, OFFSET: 0x0f },
		9600: { FACTOR: 0xb282, OFFSET: 0x08 },
		14400: { FACTOR: 0xd980, OFFSET: 0xeb },
		19200: { FACTOR: 0xd982, OFFSET: 0x07 },
		38400: { FACTOR: 0x6483, OFFSET: null },
		57600: { FACTOR: 0x9883, OFFSET: null },
		115200: { FACTOR: 0xcc83, OFFSET: null },
		230400: { FACTOR: 0xe683, OFFSET: null },
	},
}

// Hardware table: vendorId (int) → vendorName → productId (int) → chipName
const _USB_TABLE = {
	0x1a86: { Quinheng: { 0x7523: 'CH340', 0x5523: 'CH341A' } },
	0x0403: { FTDI: { 0x6001: 'FT232R', 0x6010: 'FT2232H', 0x6011: 'FT4232H', 0x6014: 'FT232H', 0x6015: 'FT231X' } },
	0x10c4: { 'Silicon Labs': { 0xea60: 'CP210x', 0xea70: 'CP2105', 0xea71: 'CP2108' } },
	0x067b: { Prolific: { 0x2303: 'PL2303' } },
}

class WebUSBAdapter extends FlasherSerial {
	constructor() {
		super()
		this._dev = null
		this._port = null // serial.Port-like object
		this._running = false
		this.chipName = null
		this.deviceName = null
	}

	/** Build filter array for requestDevice — vendorId/productId must be integers */
	static _buildFilters() {
		const filters = []
		for (const [vid, vendors] of Object.entries(_USB_TABLE)) {
			for (const products of Object.values(vendors)) {
				for (const pid of Object.keys(products)) {
					filters.push({ vendorId: parseInt(vid), productId: parseInt(pid) })
				}
			}
		}
		return filters
	}

	async connect(baudRate = 19200) {
		// 1. Request device — show browser picker
		this._dev = await navigator.usb.requestDevice({ filters: WebUSBAdapter._buildFilters() })

		// 2. Identify chip
		const vid = this._dev.vendorId
		const pid = this._dev.productId
		const vendorEntry = _USB_TABLE[vid]
		if (!vendorEntry) throw new Error(`Unsupported USB vendor: 0x${vid.toString(16)}`)
		const vendorName = Object.keys(vendorEntry)[0]
		this.chipName = vendorEntry[vendorName][pid]
		this.deviceName = this._dev.productName || `${vendorName} ${this.chipName}`
		if (!this.chipName) throw new Error(`Unsupported USB product: 0x${pid.toString(16)}`)

		// 3. Open + configure
		await this._dev.open()
		if (this._dev.configuration === null) await this._dev.selectConfiguration(1)

		// 4. Find vendor-class interface (0xff) and bulk endpoints
		this._iface = null
		this._epIn = null
		this._epOut = null
		this._epInSize = 64
		this._epOutSize = 64

		for (const iface of this._dev.configuration.interfaces) {
			for (const alt of iface.alternates) {
				if (alt.interfaceClass === 0xff) {
					this._iface = iface.interfaceNumber
					for (const ep of alt.endpoints) {
						if (ep.type === 'bulk') {
							if (ep.direction === 'out') {
								this._epOut = ep.endpointNumber
								this._epOutSize = ep.packetSize
							}
							if (ep.direction === 'in') {
								this._epIn = ep.endpointNumber
								this._epInSize = ep.packetSize
							}
						}
					}
				}
			}
		}
		if (this._iface === null)
			throw new Error('No vendor-class interface found. Try Zadig (Windows) or check device support.')
		if (this._epIn === null || this._epOut === null) throw new Error('Could not find bulk IN/OUT endpoints.')

		// 5. Claim interface + select alternate
		await this._dev.claimInterface(this._iface)
		await this._dev.selectAlternateInterface(this._iface, 0)

		// 6. Chip-specific initialization
		await this._initChip(baudRate)

		// 7. Start read loop
		this._running = true
		this._startReadLoop()
		this.connected = true
	}

	/** Unified control transfer helper (mirrors serial.controlledTransfer) */
	async _ct(direction, request, value, dataOrLen = null) {
		const setup = { requestType: 'vendor', recipient: 'device', request, value, index: this._iface }
		if (direction === 'out') {
			let data
			if (dataOrLen === null || dataOrLen === 0) {
				data = new Uint8Array([0])
			} else if (typeof dataOrLen === 'number') {
				// numeric value → single byte
				data = new Uint8Array([dataOrLen & 0xff])
			} else {
				data = dataOrLen
			}
			return this._dev.controlTransferOut(setup, data)
		} else {
			// 'in' — dataOrLen is byte count
			return this._dev.controlTransferIn(setup, dataOrLen || 2).then(r => {
				if (r.data) return r.data.buffer
				return null
			})
		}
	}

	async _initChip(baudRate) {
		if (this.chipName === 'CH340' || this.chipName === 'CH341A') {
			await this._initCH340(baudRate)
		} else if (this.chipName === 'FT232R') {
			await this._initFT232(baudRate)
		} else if (this.chipName === 'CP210x') {
			await this._initCP210x(baudRate)
		} else {
			// FT2232H, FT4232H, FT232H, FT231X, CP2105, CP2108, PL2303 — log only
			console.warn(`No init implemented for ${this.chipName}. Data may not work.`)
		}
	}

	/** CH340/CH341 init — exact sequence from Linux kernel ch341.c / serial.js */
	async _initCH340(baudRate) {
		const C = _CH340_CFG
		const d0 = new Uint8Array([0]) // null data

		// Step 1: serial initiation
		await this._ctIdx('out', C.REQUEST_SERIAL_INITIATION, C.REG_SERIAL, d0, 0xb2b9)
		// Step 2: modem control ON
		await this._ctIdx('out', C.REG_MODEM_CTRL, C.REG_MODEM_VALUE_ON, d0, 0)
		await this._ctIdx('out', C.REG_MODEM_CTRL, C.REG_MODEM_VALUE_CALL, d0, 0)
		// Step 3: read version/status
		let r = await this._ctIdx('in', C.REQUEST_READ_REGISTRY, 0x0706, 2, 0)
		// Step 4: configure line control
		await this._ctIdx('out', C.REQUEST_WRITE_REGISTRY, C.REG_CONTROL_STATUS, d0, 0)
		await this._ctIdx('out', C.REQUEST_WRITE_REGISTRY, C.REG_BAUD_FACTOR, d0, 0xb282) // 9600 default
		await this._ctIdx('out', C.REQUEST_WRITE_REGISTRY, C.REG_BAUD_OFFSET, d0, 0x0008)
		await this._ctIdx('out', C.REQUEST_WRITE_REGISTRY, C.REG_BAUD_LOW, d0, 0x00c3)
		// Step 5: read again
		r = await this._ctIdx('in', C.REQUEST_READ_REGISTRY, 0x0706, 2, 0)
		// Step 6: control status
		await this._ctIdx('out', C.REQUEST_WRITE_REGISTRY, C.REG_CONTROL_STATUS, d0, 0)
		// Step 7: set actual baud rate
		await this._ch340SetBaud(baudRate)
	}

	async _ch340SetBaud(baudRate) {
		const C = _CH340_CFG
		const entry = C.BAUD_RATE[baudRate]
		if (!entry) throw new Error(`CH340: baud rate ${baudRate} not in table`)
		const d0 = new Uint8Array([0])
		const offset = entry.OFFSET !== null ? entry.OFFSET : 0
		await this._ctIdx('out', C.REQUEST_WRITE_REGISTRY, C.REG_BAUD_FACTOR, d0, entry.FACTOR)
		await this._ctIdx('out', C.REQUEST_WRITE_REGISTRY, C.REG_BAUD_OFFSET, d0, offset)
		await this._ctIdx('out', C.REQUEST_WRITE_REGISTRY, C.REG_CONTROL_STATUS, d0, 0)
	}

	/** Control transfer with explicit index (different from interface number for CH340) */
	async _ctIdx(direction, request, value, dataOrLen, index) {
		const setup = { requestType: 'vendor', recipient: 'device', request, value, index }
		if (direction === 'out') {
			let data = typeof dataOrLen === 'number' ? new Uint8Array([dataOrLen & 0xff]) : dataOrLen || new Uint8Array([0])
			return this._dev.controlTransferOut(setup, data)
		} else {
			return this._dev.controlTransferIn(setup, dataOrLen || 2).then(r => (r.data ? r.data.buffer : null))
		}
	}

	/** FT232R init */
	async _initFT232(baudRate) {
		const setup = (req, val, idx = 0) => ({
			requestType: 'vendor',
			recipient: 'device',
			request: req,
			value: val,
			index: idx,
		})
		await this._dev.controlTransferOut(setup(0x00, 0)) // Reset
		// Baud rate divisors for FT232R (3MHz / divisor)
		const bauds = {
			300: 0x2710,
			600: 0x1388,
			1200: 0x09c4,
			2400: 0x04e2,
			4800: 0x0271,
			9600: 0xc04e,
			14400: 0x80d2,
			19200: 0x809c,
			38400: 0xc04e,
			57600: 0x8060,
			115200: 0x001a,
		}
		await this._dev.controlTransferOut(setup(0x03, bauds[baudRate] || bauds[19200])) // Set baud
		await this._dev.controlTransferOut(setup(0x04, 0x0008)) // 8N1
		await this._dev.controlTransferOut(setup(0x02, 0x0000)) // No flow control
		await this._dev.controlTransferOut(setup(0x01, 0x0303)) // Assert DTR+RTS
	}

	/** CP210x init */
	async _initCP210x(baudRate) {
		const setup = (req, val) => ({
			requestType: 'vendor',
			recipient: 'interface',
			request: req,
			value: val,
			index: this._iface,
		})
		await this._dev.controlTransferOut(setup(0x00, 0x0001)) // Enable UART
		// Set baud rate
		const buf = new ArrayBuffer(4)
		new DataView(buf).setUint32(0, baudRate, true)
		await this._dev.controlTransferOut(
			{ requestType: 'vendor', recipient: 'interface', request: 0x1e, value: 0, index: this._iface },
			new Uint8Array(buf),
		)
		await this._dev.controlTransferOut(setup(0x03, 0x0800)) // 8N1
		await this._dev.controlTransferOut(setup(0x13, 0x0000)) // No flow control
	}

	/** Read loop — promise-chaining style from serial.js (works on Android) */
	_startReadLoop() {
		const loop = () => {
			if (!this._running || !this._dev.opened) return
			this._dev.transferIn(this._epIn, this._epInSize).then(
				result => {
					if (result.data && result.data.byteLength > 0) {
						this._onData(new Uint8Array(result.data.buffer))
					}
					loop() // chain next read
				},
				err => {
					if (this._running) {
						console.warn('WebUSB read error:', err)
						setTimeout(loop, 50)
					}
				},
			)
		}
		loop()
	}

	async write(data) {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
		await this._dev.transferOut(this._epOut, bytes)
	}

	async disconnect() {
		this._running = false
		this.connected = false
		try {
			// CH340 modem off
			if (this.chipName === 'CH340' || this.chipName === 'CH341A') {
				const C = _CH340_CFG
				await this._ctIdx('out', C.REG_MODEM_CTRL, C.REG_MODEM_VALUE_OFF, new Uint8Array([0]), 0).catch(() => {})
			}
		} catch (e) {}
		try {
			await this._dev.releaseInterface(this._iface)
		} catch (e) {}
		try {
			await this._dev.close()
		} catch (e) {}
	}
}

// ── Simulation serial (no hardware) ──
class SimulationSerial extends FlasherSerial {
	constructor() {
		super()
		this._onWrite = null
		this.connected = true
	}
	async connect() {
		this.connected = true
	}
	async write(data) {
		if (this._onWrite) await this._onWrite(new Uint8Array(data))
	}
	injectResponse(bytes) {
		setTimeout(() => this._onData(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), 8)
	}
	async disconnect() {
		this.connected = false
	}
}
