// bw-flasher-web — keygen.js
// Key generation — ported from keygen.py (sign_rand, gen_key, etc.)
// ScooterTeam © 2024-2025 CC BY-NC-SA 4.0

'use strict'

// ═══════════════════════════════════════════════════════════════════════════
//  KEYGEN — ported from keygen.py
// ═══════════════════════════════════════════════════════════════════════════

function genKey(dst, src, lt0, lt1) {
	for (let i = 0; i < 16; i++) dst[i] = src[i]
	const local = new Uint8Array(4)
	for (let j = 16; j < 176; j += 4) {
		dst[j] = dst[j - 16]
		dst[j + 1] = dst[j - 15]
		dst[j + 2] = dst[j - 14]
		dst[j + 3] = dst[j - 13]
		if (j % 16 !== 0) {
			local[0] = dst[j - 4]
			local[1] = dst[j - 3]
			local[2] = dst[j - 2]
			local[3] = dst[j - 1]
		} else {
			local[0] = lt0[dst[j - 3]] ^ lt1[j >> 4]
			local[1] = lt0[dst[j - 2]]
			local[2] = lt0[dst[j - 1]]
			local[3] = lt0[dst[j - 4]]
		}
		dst[j] ^= local[0]
		dst[j + 1] ^= local[1]
		dst[j + 2] ^= local[2]
		dst[j + 3] ^= local[3]
	}
}

function xorByteBlocks(dst, src, blockIndex) {
	for (let j = blockIndex * 16; j < (blockIndex + 1) * 16; j++) {
		dst[j % 16] ^= src[j]
	}
}

/** c defaults to -0x1b=-27, so (-27)&0xFF = 0xE5 */
function manipulateBytes(arr) {
	for (let off = 0; off < 16; off += 4) {
		const l0 = arr[off] ^ arr[off + 1]
		const l1 = arr[off + 1] ^ arr[off + 2]
		const l2 = arr[off + 2] ^ arr[off + 3]
		const l3 = arr[off + 3] ^ arr[off + 0]
		const l4 = l0 ^ l2
		const ls = [l0, l1, l2, l3]
		for (let i = 0; i < 4; i++) {
			let v = arr[off + i]
			v ^= (ls[i] << 1) & 0xff
			if (ls[i] & 0x80) v ^= 0xe5 // sign * (-27) & 0xFF = 0xE5
			v ^= l4
			arr[off + i] = v & 0xff
		}
	}
}

function rollBytes(arr, indices) {
	const first = arr[indices[0]]
	for (let i = 0; i < indices.length - 1; i++) arr[indices[i]] = arr[indices[i + 1]]
	arr[indices[indices.length - 1]] = first
}

function signRandWithKey(dst, src, lt) {
	for (let block = 0; block < 10; block++) {
		if (block > 0) manipulateBytes(dst)
		xorByteBlocks(dst, src, block)
		for (let outer = 0; outer < 16; outer += 4) {
			for (let inner = 0; inner < 4; inner++) {
				dst[inner + outer] = lt[dst[inner + outer]]
			}
		}
		rollBytes(dst, [1, 5, 9, 13])
		rollBytes(dst, [2, 10])
		rollBytes(dst, [3, 15, 11, 7])
		rollBytes(dst, [6, 14])
	}
	xorByteBlocks(dst, src, 10)
}

/**
 * Sign challenge `rand` with key derived from `uid`,
 * using lookup tables read from firmware at fw_offset_0 and fw_offset_1.
 */
function signRand(uid, rand, fw, fwOffset0, fwOffset1) {
	const lt0 = new Uint8Array(256)
	for (let i = 0; i < 256; i++) lt0[i] = fw[fwOffset0 + i]

	const lt1 = new Uint8Array(11) // index 0 unused
	for (let i = 1; i <= 10; i++) lt1[i] = fw[fwOffset1 + i]

	const key = new Uint8Array(176)
	genKey(key, uid, lt0, lt1)

	const dst = new Uint8Array(rand)
	signRandWithKey(dst, key, lt0)
	return dst
}
