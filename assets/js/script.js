/**
 * BW Flasher Web — assets/js/script.js
 * Modules: I18n (internationalisation) · Tabs · Disclaimer
 * Designed by Visoire (www.visoire.com)
 */

'use strict'

/* ═══════════════════════════════════════════════════════════
   I18N MODULE
═══════════════════════════════════════════════════════════ */
var I18n = (function () {
	var FILE_MAP = { de: 'deutsch', en: 'english', pl: 'polski' }
	var state = { lang: 'de', data: {} }

	/**
	 * Resolve a dot-notation key against loaded translation data.
	 * Returns the key itself if nothing is found, so the UI never shows undefined.
	 */
	function get(key) {
		var parts = key.split('.')
		var node = state.data
		for (var i = 0; i < parts.length; i++) {
			if (node == null || typeof node !== 'object') return key
			node = node[parts[i]]
		}
		return typeof node === 'string' ? node : key
	}

	/** Apply all data-i18n* attributes to the current document. */
	function apply() {
		/* text content */
		document.querySelectorAll('[data-i18n]').forEach(function (el) {
			el.textContent = get(el.getAttribute('data-i18n'))
		})

		/* innerHTML — use only for strings that contain trusted HTML (e.g. links) */
		document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
			el.innerHTML = get(el.getAttribute('data-i18n-html'))
		})

		/* aria-label */
		document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
			el.setAttribute('aria-label', get(el.getAttribute('data-i18n-aria')))
		})

		/* title attribute */
		document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
			el.setAttribute('title', get(el.getAttribute('data-i18n-title')))
		})

		/* placeholder */
		document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
			el.setAttribute('placeholder', get(el.getAttribute('data-i18n-ph')))
		})

		/* html[lang] */
		document.documentElement.lang = state.lang
	}

	/** Sync the switcher button active states with the current language. */
	function syncSwitcher() {
		document.querySelectorAll('.lang-btn').forEach(function (btn) {
			var active = btn.getAttribute('data-lang') === state.lang
			btn.classList.toggle('active', active)
			btn.setAttribute('aria-pressed', active ? 'true' : 'false')
		})
	}

	/**
	 * Load a language file and re-render all translations.
	 * Persists the choice to localStorage so it survives page reloads.
	 */
	function load(lang) {
		if (!FILE_MAP[lang]) {
			console.warn('[I18n] Unknown language:', lang)
			return
		}
		var file = 'assets/language/' + FILE_MAP[lang] + '.json'

		fetch(file)
			.then(function (r) {
				if (!r.ok) throw new Error('HTTP ' + r.status)
				return r.json()
			})
			.then(function (data) {
				state.data = data
				state.lang = lang
				apply()
				syncSwitcher()
				try {
					localStorage.setItem('bwf_lang', lang)
				} catch (_) {}
			})
			.catch(function (err) {
				console.error('[I18n] Failed to load "' + file + '":', err)
			})
	}

	/** Bootstrap: restore last saved language, default to English. */
	function init() {
		var saved = 'en'
		try {
			saved = localStorage.getItem('bwf_lang') || 'en'
		} catch (_) {}
		load(saved)
	}

	return {
		load: load,
		get: get,
		init: init,
		getCurrent: function () {
			return state.lang
		},
	}
})()

/* ═══════════════════════════════════════════════════════════
   TAB SWITCHER
   Note: On desktop (>=768px), all sections are visible.
═══════════════════════════════════════════════════════════ */
var Tabs = (function () {
	var TABS = ['connect', 'firmware', 'options', 'actions', 'log']

	function activate(tab) {
		TABS.forEach(function (id) {
			var sec = document.getElementById('section-' + id)
			var btn = document.getElementById('nav-' + id)
			if (!sec || !btn) return
			var isActive = id === tab
			sec.classList.toggle('active', isActive)
			btn.classList.toggle('active', isActive)
			btn.setAttribute('aria-current', isActive ? 'page' : 'false')
		})
		/* scroll the new section into view on mobile */
		var target = document.getElementById('section-' + tab)
		if (target && window.innerWidth < 768) {
			window.scrollTo({ top: 0, behavior: 'smooth' })
		}
	}

	return { activate: activate }
})()

/* global shortcut so inline onclick calls still work */
window.switchTab = function (tab) {
	Tabs.activate(tab)
}

/* ═══════════════════════════════════════════════════════════
   DISCLAIMER HANDLERS
═══════════════════════════════════════════════════════════ */

/**
 * Accept: remove the modal, then boot the original app modules.
 * The check for typeof guards against running in a context where
 * the original JS files are not present.
 */
window.disclaimerAccept = function () {
	var overlay = document.getElementById('disclaimerOverlay')
	if (overlay) overlay.remove()

	try {
		localStorage.setItem('bwf_accept', 'true')
	} catch (_) {}

	if (typeof UI !== 'undefined' && typeof UI._checkUpdate === 'function') {
		UI._checkUpdate()
	}

	// Music will only start if user previously had it ON (handled in ui.js restore logic)
	// or if they manually click the music button.

	var musicBtn = document.getElementById('btnMusic')
	if (musicBtn) {
		musicBtn.textContent = '♫'
		musicBtn.style.color = 'var(--primary)'
	}
}

/**
 * Decline: redirect the user away from the site.
 */
window.disclaimerDecline = function () {
	window.location.href = 'https://www.google.com'
}

/* ═══════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
	/* Start i18n — language is read from localStorage or defaults to EN */
	I18n.init()

	/* Auto-accept disclaimer if previously saved */
	try {
		if (localStorage.getItem('bwf_accept') === 'true') {
			var overlay = document.getElementById('disclaimerOverlay')
			if (overlay) overlay.style.display = 'none'
			// Delay slightly to ensure UI/Chiptune are defined if they load after this
			setTimeout(function () {
				window.disclaimerAccept()
			}, 100)
		}
	} catch (_) {}

	/* First tab active on mobile */
	Tabs.activate('connect')
})
