// bw-flasher-web — leqi.js
// LEQI binary flasher — 5A 12 packet protocol, 128-byte chunks
// ScooterTeam © 2024-2025 CC BY-NC-SA 4.0

'use strict'

// ═══════════════════════════════════════════════════════════════════════════
//  LEQI FLASHER (5A 12 Binary Protocol)
// ═══════════════════════════════════════════════════════════════════════════

const LEQI_FIRMWARE_OFFSET = 0x80
const LEQI_FIRMWARE_SIZE = 0x9880 // 39040 bytes
const LEQI_CHUNK_SIZE = 128

class LeqiFlasher {
	constructor(serial, { simulation = false, debug = false, onLog, onStatus, onProgress, abortSignal } = {}) {
		this.serial = serial
		this.simulation = simulation
		this.debug = debug
		this.log = onLog || (() => {})
		this.status = onStatus || (() => {})
		this.progress = onProgress || (() => {})
		this.abort = abortSignal || { aborted: false }

		this.fw = null
		this.encryptedFw = null
		this.fwSize = 0
	}

	loadFirmware(data) {
		this.fw = data
		this.encryptedFw = data
		if (data.length > LEQI_FIRMWARE_SIZE) {
			if (data.length < LEQI_FIRMWARE_OFFSET + LEQI_FIRMWARE_SIZE)
				throw new Error(`Image too small: ${data.length} bytes`)
			this.encryptedFw = data.slice(LEQI_FIRMWARE_OFFSET, LEQI_FIRMWARE_OFFSET + LEQI_FIRMWARE_SIZE)
		}
		this.fwSize = this._calcFirmwareSize(this.encryptedFw)
		this.log(`Loaded LEQI firmware: ${data.length} bytes`, 'info')
		this.log(
			`Firmware size (AA padding end): 0x${this.fwSize.toString(16).toUpperCase()} (${this.fwSize} bytes)`,
			'info',
		)
	}

	_calcFirmwareSize(data) {
		let maxLen = 0,
			maxEnd = 0
		let i = 0
		while (i < data.length) {
			if (data[i] === 0xaa) {
				const start = i
				while (i < data.length && data[i] === 0xaa) i++
				const len = i - start
				if (len > maxLen && len > 500) {
					maxLen = len
					maxEnd = i
				}
			} else i++
		}
		if (maxEnd > 0) return Math.ceil(maxEnd / 128) * 128
		return data.length
	}

	_crc16(data) {
		return crc16(data)
	} // CRC-16/XMODEM — same poly/init

	_buildPacket(type, payload) {
		const hdr = new Uint8Array([0x5a, 0x12, type, payload.length])
		const full = new Uint8Array(hdr.length + payload.length)
		full.set(hdr)
		full.set(payload, hdr.length)
		const crcVal = this._crc16(full)
		const out = new Uint8Array(full.length + 2)
		out.set(full)
		out[full.length] = (crcVal >> 8) & 0xff
		out[full.length + 1] = crcVal & 0xff
		return out
	}

	async run() {
		if (!this.encryptedFw) throw new Error('No firmware loaded')
		if (this.simulation) {
			await this._runSimulation()
			return
		}

		await this._sendStartCommand()
		await this._sendFirmwareData()
		await this._sendEndCommand()

		this.log('✓ LEQI firmware update completed', 'ok')
		this.progress(100)
	}

	async _sendAndReceive(pkt, desc, timeout = 2000) {
		const bytes = pkt instanceof Uint8Array ? pkt : new Uint8Array(pkt)
		if (this.debug) this.log(`TX [${desc}]: ${toHex(bytes)}`, 'tx')
		this.serial.clearBuffer()
		await this.serial.write(bytes)
		// Small delay for controller to process (matches Python's time.sleep(0.05))
		await sleep(50)
		// Read response: scan raw rxBuf for 0x5A header byte directly.
		// NOTE: do NOT use receiveResponse() here — it uses 0x5A as a "terminator"
		// which would CONSUME the start byte, breaking the response parsing.
		const full = await this._readLeqiResponse(timeout)
		if (this.debug && full) this.log(`RX [${desc}]: ${toHex(full)}`, 'rx')
		return full
	}

	async _readLeqiResponse(timeout = 2000) {
		const deadline = Date.now() + timeout
		// Wait for 0x5A header
		while (Date.now() < deadline) {
			if (this.serial.rxBuf.length > 0) {
				const b = this.serial.rxBuf.shift()
				if (b === 0x5a) {
					// Read 6 more bytes
					const rest = []
					const inner = Date.now() + 500
					while (rest.length < 6 && Date.now() < inner) {
						if (this.serial.rxBuf.length > 0) rest.push(this.serial.rxBuf.shift())
						else await this.serial._waitRx(10)
					}
					return new Uint8Array([0x5a, ...rest])
				}
			}
			await this.serial._waitRx(20)
		}
		return null
	}

	async _sendStartCommand() {
		this.status('Sending firmware update start command…')
		const payload = new Uint8Array(8)
		payload[0] = 0x31
		payload[1] = 0x00
		payload[2] = this.fwSize & 0xff
		payload[3] = (this.fwSize >> 8) & 0xff
		payload[4] = 0x00
		payload[5] = 0x00
		const pkt = this._buildPacket(0x03, payload.slice(0, 6))

		const resp = await this._sendAndReceive(pkt, 'Start')
		if (!resp || resp.length < 5 || resp[1] !== 0x21 || resp[2] !== 0x03)
			throw new Error('Invalid start response from controller')
		this.log('✓ Start command acknowledged', 'ok')
	}

	async _sendFirmwareData() {
		this.status('Sending firmware data…')
		let offset = 0,
			chunkNum = 0,
			failedChunks = 0
		const totalChunks = Math.ceil(this.fwSize / LEQI_CHUNK_SIZE)

		while (offset < this.fwSize) {
			if (this.abort.aborted) throw new Error('Aborted')

			const end = Math.min(offset + LEQI_CHUNK_SIZE, this.fwSize)
			let chunk = this.encryptedFw.slice(offset, end)
			if (chunk.length < LEQI_CHUNK_SIZE) {
				const padded = new Uint8Array(LEQI_CHUNK_SIZE).fill(0xff)
				padded.set(chunk)
				chunk = padded
			}

			// Packet: [5A][12][04][0x84][offset_32LE][data_128][crc_16BE]
			const payload = new Uint8Array(4 + LEQI_CHUNK_SIZE)
			const view = new DataView(payload.buffer)
			view.setUint32(0, offset, true) // LE offset
			payload.set(chunk, 4)

			const hdr = new Uint8Array([0x5a, 0x12, 0x04, 0x84])
			const full = new Uint8Array(hdr.length + payload.length)
			full.set(hdr)
			full.set(payload, 4)
			const crcVal = this._crc16(full)
			const pkt = new Uint8Array(full.length + 2)
			pkt.set(full)
			pkt[full.length] = (crcVal >> 8) & 0xff
			pkt[full.length + 1] = crcVal & 0xff

			chunkNum++
			const resp = await this._sendAndReceive(pkt, `Chunk ${chunkNum} @ 0x${offset.toString(16)}`)

			if (!resp) {
				this.log(`WARNING: No response for chunk ${chunkNum}`, 'warn')
				failedChunks++
			} else if (resp.length < 5 || resp[1] !== 0x21 || resp[2] !== 0x04) {
				this.log(`WARNING: Invalid response for chunk ${chunkNum}`, 'warn')
				failedChunks++
			} else if (resp[4] !== 0x01) {
				this.log(`ERROR: Chunk ${chunkNum} REJECTED (status=0x${resp[4].toString(16)})`, 'err')
				failedChunks++
			}

			offset = end
			const pct = Math.floor((chunkNum / totalChunks) * 90)
			this.progress(pct)

			if (chunkNum % 10 === 0) {
				this.log(`Progress: ${chunkNum}/${totalChunks} chunks (${pct}%)`, 'info')
			}

			await sleep(44)
		}

		if (failedChunks > 0) throw new Error(`${failedChunks} chunks had invalid/missing responses`)
		this.log(`✓ Sent ${chunkNum} chunks`, 'ok')
		await sleep(690)
	}

	async _sendEndCommand() {
		this.status('Finalizing firmware update…')
		const pkt = this._buildPacket(0x05, new Uint8Array(0))

		for (let attempt = 1; attempt <= 10; attempt++) {
			if (attempt > 1) {
				this.log(`Retry ${attempt}/10…`, 'warn')
				await sleep(60)
			}
			const resp = await this._sendAndReceive(pkt, `End (attempt ${attempt})`, 400)
			if (resp && resp.length >= 5 && resp[1] === 0x21 && resp[2] === 0x05) {
				this.log('✓ End command acknowledged', 'ok')
				return
			}
		}
		throw new Error('No valid response to end command after 10 attempts')
	}

	async testConnection() {
		if (this.simulation) {
			this.log('Simulation: LEQI connection test OK', 'ok')
			this.progress(100)
			return
		}
		// Send a minimal start packet and check for 5A 21 03 response
		const payload = new Uint8Array([0x31, 0x00, 0x00, 0x10, 0x00, 0x00])
		const pkt = this._buildPacket(0x03, payload)
		const resp = await this._sendAndReceive(pkt, 'TestConn')
		if (resp && resp.length >= 3 && resp[1] === 0x21) {
			this.log('✓ LEQI connection OK', 'ok')
			this.progress(100)
		} else {
			throw new Error('No valid LEQI response — check connection and baud rate')
		}
	}

	async _runSimulation() {
		this.status('SIMULATION: Starting LEQI firmware flash…')
		await sleep(100)
		this.log('[SIM] Start command → ACK', 'dbg')
		this.progress(5)

		const totalChunks = Math.ceil(this.fwSize / LEQI_CHUNK_SIZE)
		for (let i = 1; i <= totalChunks; i++) {
			if (this.abort.aborted) throw new Error('Aborted')
			await sleep(5)
			const pct = 5 + Math.floor((i / totalChunks) * 85)
			this.progress(pct)
			if (i % 50 === 0 || i === totalChunks) {
				this.log(`[SIM] Chunk ${i}/${totalChunks} (${pct}%)`, 'dbg')
			}
		}

		this.status('SIMULATION: Finalizing…')
		this.progress(95)
		await sleep(200)
		this.log('✓ SIMULATION: LEQI firmware update completed!', 'ok')
		this.progress(100)
	}
}
