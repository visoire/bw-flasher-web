// bw-flasher-web — chiptune.js
// Chiptune audio — plays chiptune.mp3 if present, falls back to Web Audio synth
// ScooterTeam © 2024-2025 CC BY-NC-SA 4.0

'use strict'

// ═══════════════════════════════════════════════════════════════════════════
//  CHIPTUNE — plays chiptune.mp3 if available, else Web Audio synth fallback
// ═══════════════════════════════════════════════════════════════════════════
const Chiptune = (() => {
	// ── MP3 player ──
	let audio = null
	let usingMp3 = false

	// ── Web Audio synth fallback ──
	let ctx = null,
		gainNode = null,
		synthPlaying = false,
		scheduleTimer = null
	let noteIdx = 0

	const MELODY = [
		261.63, 311.13, 392.0, 466.16, 392.0, 311.13, 261.63, 207.65, 233.08, 261.63, 311.13, 392.0, 311.13, 261.63, 233.08,
		196.0, 261.63, 311.13, 392.0, 523.25, 466.16, 392.0, 311.13, 261.63, 207.65, 233.08, 261.63, 311.13, 261.63, 233.08,
		196.0, 0,
	]
	const BASS = [
		130.81, 0, 0, 0, 130.81, 0, 0, 0, 116.54, 0, 0, 0, 116.54, 0, 0, 0, 130.81, 0, 0, 0, 130.81, 0, 0, 0, 103.83, 0, 0,
		0, 103.83, 0, 0, 0,
	]
	const NOTE_DUR = 0.11,
		NOTE_GAP = 0.015,
		TEMPO = NOTE_DUR + NOTE_GAP,
		VOLUME = 0.08

	function makeOsc(freq, type, startT, dur, vol) {
		if (!ctx || freq === 0) return
		const osc = ctx.createOscillator()
		const env = ctx.createGain()
		osc.connect(env)
		env.connect(gainNode)
		osc.type = type
		osc.frequency.value = freq
		env.gain.setValueAtTime(0, startT)
		env.gain.linearRampToValueAtTime(vol, startT + 0.005)
		env.gain.setValueAtTime(vol, startT + dur - 0.02)
		env.gain.linearRampToValueAtTime(0, startT + dur)
		osc.start(startT)
		osc.stop(startT + dur + 0.01)
	}

	function scheduleChunk() {
		if (!synthPlaying || !ctx) return
		const now = ctx.currentTime,
			CHUNK = 8
		for (let i = 0; i < CHUNK; i++) {
			const idx = (noteIdx + i) % MELODY.length,
				t = now + i * TEMPO
			makeOsc(MELODY[idx], 'square', t, NOTE_DUR, VOLUME * 0.7)
			makeOsc(BASS[idx], 'triangle', t, NOTE_DUR * 2, VOLUME * 0.5)
			if (idx % 4 === 0 && MELODY[idx] > 0)
				makeOsc(MELODY[idx] * 2, 'square', t + TEMPO / 2, NOTE_DUR * 0.5, VOLUME * 0.25)
		}
		noteIdx = (noteIdx + CHUNK) % MELODY.length
		scheduleTimer = setTimeout(scheduleChunk, CHUNK * TEMPO * 900)
	}

	function startSynth() {
		if (!ctx) {
			ctx = new (window.AudioContext || window.webkitAudioContext)()
			gainNode = ctx.createGain()
			gainNode.gain.value = 1
			gainNode.connect(ctx.destination)
		}
		if (ctx.state === 'suspended') ctx.resume()
		synthPlaying = true
		scheduleChunk()
	}

	function stopSynth() {
		synthPlaying = false
		if (scheduleTimer) clearTimeout(scheduleTimer)
	}

	// ── Try loading ./chiptune.mp3 relative to the HTML file ──
	// NOTE: fetch() fails on file:// — use Audio canplaythrough/error instead
	function tryLoadRelativeMp3() {
		return new Promise(resolve => {
			const a = new Audio('./chiptune.mp3')
			a.loop = true
			a.volume = 0.35
			const done = ok => {
				a.removeEventListener('canplaythrough', onOk)
				a.removeEventListener('error', onErr)
				if (ok) {
					audio = a
					usingMp3 = true
				}
				resolve(ok)
			}
			const onOk = () => done(true)
			const onErr = () => done(false)
			a.addEventListener('canplaythrough', onOk, { once: true })
			a.addEventListener('error', onErr, { once: true })
			// Timeout fallback — if neither fires within 2s, assume missing
			setTimeout(() => done(false), 2000)
			a.load()
		})
	}

	return {
		// Called once after disclaimer accept (user gesture required for autoplay)
		async start() {
			if (!usingMp3) {
				// Try relative path first (HTML and mp3 in same folder)
				usingMp3 = await tryLoadRelativeMp3()
			}
			if (usingMp3 && audio) {
				try {
					await audio.play()
					return
				} catch (e) {
					usingMp3 = false
					audio = null
				}
			}
			// Fallback: synth
			startSynth()
		},

		stop() {
			if (usingMp3 && audio) {
				audio.pause()
				audio.currentTime = 0
			} else stopSynth()
		},

		toggle() {
			const wasPlaying = this.isPlaying()
			wasPlaying ? this.stop() : this.start()
			return !wasPlaying
		},

		isPlaying() {
			if (usingMp3 && audio) return !audio.paused
			return synthPlaying
		},

		// Called when user manually selects a file via <input type=file>
		loadFile(file) {
			if (audio) {
				audio.pause()
				audio = null
			}
			stopSynth()
			const url = URL.createObjectURL(file)
			audio = new Audio(url)
			audio.loop = true
			audio.volume = 0.35
			usingMp3 = true
			audio.play().catch(() => {})
		},

		isUsingMp3() {
			return usingMp3
		},
	}
})()
