// bw-flasher-web — firmware.js
// Firmware utilities — ZIP extraction, type detection, info parsing
// ScooterTeam © 2024-2025 CC BY-NC-SA 4.0

'use strict'

/**
 * Find all byte offsets of patternHex within data, starting at startOffset.
 */
function findPatternOffsets(patternHex, data, startOffset = 0) {
	const pattern = hexToBytes(patternHex)
	const offsets = []
	let pos = startOffset
	while (pos <= data.length - pattern.length) {
		let found = true
		for (let i = 0; i < pattern.length; i++) {
			if (data[pos + i] !== pattern[i]) {
				found = false
				break
			}
		}
		if (found) offsets.push(pos)
		pos++
	}
	return offsets
}

/**
 * Extract firmware from a ZIP archive if necessary, then trim the trailing
 * 2-byte checksum appended by some tools (mirrors Python process_firmware).
 *
 * @param {Uint8Array} rawData  Raw file bytes from the user's file input.
 * @param {Function}   [log]   Optional log callback(msg, type) — avoids
 *                             global dependency on UI module (FIX-5).
 * @returns {Promise<Uint8Array>} Processed firmware bytes.
 */
async function processFirmware(rawData, log) {
	let data = new Uint8Array(rawData)
	const _log = typeof log === 'function' ? log : () => {}

	// Try ZIP extraction (JSZip must be loaded before this module)
	try {
		const zip = await JSZip.loadAsync(data)
		const names = Object.keys(zip.files).filter(n => !zip.files[n].dir)
		if (names.length > 0) {
			const preferred = names.find(n => n.startsWith('EC_ESC_Driver') || n.endsWith('.enc')) || names[0]
			const content = await zip.files[preferred].async('uint8array')
			data = content
			// FIX-5: log via callback instead of undefined global logMsg
			_log(`Extracted from ZIP: ${preferred}`, 'info')
		}
	} catch (e) {
		/* not a ZIP — use raw bytes */
	}

	// Trim trailing 2-byte appended checksum (mirrors Python: processed_fw[:-2])
	if (data.length > 4096) {
		data = data.slice(0, data.length - 2)
	}

	return data
}

/**
 * Detect firmware type from binary data.
 * Mirrors Python base_flasher.detect_firmware_type + leqi_flasher.detect_firmware_type.
 */
function detectFirmwareType(data) {
	if (data.length < 0x400) return 'UNKNOWN'

	// Brightway: signature "DEPRD5C\x00" at offset 0x800
	if (data.length > 0x808) {
		const sig = String.fromCharCode(...data.slice(0x800, 0x808))
		if (sig === 'DEPRD5C\x00') return 'BRIGHTWAY'
	}

	// Brightway alternative: exactly one 637C pattern past 0x1000
	if (data.length > 0x1000) {
		const offsets = findPatternOffsets('637C', data)
		if (offsets.length === 1 && offsets[0] > 0x1000) return 'BRIGHTWAY'
	}

	// LEQI: dense 0xAA / 0xAA 0xA2 patterns in the header region 0x80–0x400
	if (data.length >= 0x400) {
		const slice = data.slice(0x80, 0x400)
		let aaCount = 0,
			aaA2Count = 0
		for (let i = 0; i < slice.length; i++) {
			if (slice[i] === 0xaa) {
				aaCount++
				if (i + 1 < slice.length && slice[i + 1] === 0xa2) aaA2Count++
			}
		}
		if (aaA2Count > 10 && aaCount > 50) return 'LEQI'
	}

	return 'UNKNOWN'
}

function getFirmwareInfo(data) {
	const type = detectFirmwareType(data)
	const info = { type, size: data.length }

	if (type === 'BRIGHTWAY') {
		if (data.length > 0x808) info.signature = String.fromCharCode(...data.slice(0x800, 0x807))
		info.protocol = 'DFU (Device Firmware Update)'
		const offsets = findPatternOffsets('637C', data)
		if (offsets.length > 0) info.signingOffset = `0x${offsets[0].toString(16).toUpperCase()}`
	} else if (type === 'LEQI') {
		info.encryption = 'XOR 0xAA'
		info.protocol = 'Binary packets (5A 12 header)'
	}

	return info
}
