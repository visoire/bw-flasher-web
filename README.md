# BW FLASHER WEB

A fully browser-based firmware flasher for Brightway and LEQI scooter controllers over UART. No Python, no pip, no Node.js, no installation of any kind. The entire application runs as a single HTML page directly in the browser using Web Serial and WebUSB APIs.

Ported from [bw-flasher](https://github.com/scooterteam/bw-flasher) by ScooterTeam.

---

## Table of Contents

- [Supported Devices](#supported-devices)
- [Browser and OS Support](#browser-and-os-support)
- [How to Use](#how-to-use)
- [Features](#features)
- [Protocol Reference](#protocol-reference)
- [Architecture](#architecture)
- [Changelog](#changelog)
- [Safety Warning](#safety-warning)
- [Disclaimer](#disclaimer)
- [License](#license)

---

## Supported Devices

### Firmware Types

| Type      | Protocol                           | Detection Method                                                                                 |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Brightway | DFU (Device Firmware Update)       | Signature `DEPRD5C\x00` at offset `0x800`, or a single `637C` byte pattern after offset `0x1000` |
| LEQI      | Binary packets with `5A 12` header | Dense `0xAA` and `0xAA 0xA2` patterns in the header region `0x80`–`0x400`                        |

### Compatible Scooter Models

The following models use Brightway or LEQI controllers and are supported by this tool:

- Xiaomi Electric Scooter 3 Lite
- Xiaomi Electric Scooter 4
- Xiaomi Electric Scooter 4 Pro
- Xiaomi Electric Scooter 4 Ultra
- Xiaomi Electric Scooter 5 Max
- Xiaomi Electric Scooter 5 Elite
- NAVEE models manufactured by Brightway

Any other scooter model whose firmware is produced by Brightway or LEQI and whose binary matches the detection criteria above should work as well.

### Supported USB-UART Adapters

| Chip    | Vendor       | VID:PID       | Web Serial | WebUSB Init        |
| ------- | ------------ | ------------- | ---------- | ------------------ |
| CH340   | Quinheng     | 0x1A86:0x7523 | OS driver  | Full init sequence |
| CH341A  | Quinheng     | 0x1A86:0x5523 | OS driver  | Full init sequence |
| FT232R  | FTDI         | 0x0403:0x6001 | OS driver  | Full init sequence |
| FT2232H | FTDI         | 0x0403:0x6010 | OS driver  | Detected only      |
| FT4232H | FTDI         | 0x0403:0x6011 | OS driver  | Detected only      |
| FT232H  | FTDI         | 0x0403:0x6014 | OS driver  | Detected only      |
| FT231X  | FTDI         | 0x0403:0x6015 | OS driver  | Detected only      |
| CP210x  | Silicon Labs | 0x10C4:0xEA60 | OS driver  | Full init sequence |
| CP2105  | Silicon Labs | 0x10C4:0xEA70 | OS driver  | Detected only      |
| CP2108  | Silicon Labs | 0x10C4:0xEA71 | OS driver  | Detected only      |
| PL2303  | Prolific     | 0x067B:0x2303 | OS driver  | Detected only      |

Serial configuration for all adapters: 19200 baud, 8 data bits, no parity, 1 stop bit, no flow control.

---

## Browser and OS Support

| Platform       | Web Serial    | WebUSB              |
| -------------- | ------------- | ------------------- |
| Windows        | Recommended   | Requires Zadig      |
| Linux          | Recommended   | Requires udev rules |
| macOS          | Recommended   | Works               |
| Android Chrome | Not supported | Works               |
| Firefox        | Not supported | Not supported       |
| Safari         | Not supported | Not supported       |

**Web Serial** uses the OS-installed UART driver. The adapter appears as a COM port on Windows or `/dev/ttyUSB*` on Linux/macOS. Recommended on desktop because it requires no driver replacement and supports all chip variants including those without a full WebUSB init sequence.

**WebUSB** communicates directly with the USB chip, bypassing the OS driver entirely. This is the only option on Android Chrome. On Windows, the OS driver must first be replaced with WinUSB using [Zadig](https://zadig.akeo.ie/). This removes the device from the COM port list until the original driver is restored. Only adapters with a full WebUSB init sequence (CH340, CH341A, FT232R, CP210x) are fully functional in WebUSB mode.

---

## How to Use

1. Open the page in Chrome, Edge, or Opera (version 89 or later)
2. Connect your USB-UART adapter to the PC and to the scooter's UART port
3. Load a firmware file (`.bin` raw binary or `.zip` archive containing the binary)
4. The firmware type is detected automatically and displayed in the info panel
5. Choose a connection method: Web Serial (desktop, recommended) or WebUSB (Android / no driver)
6. Click Connect and select your adapter from the browser's device picker
7. Optional: click Test Connection to verify the adapter and cable before writing anything
8. Click Flash Firmware to start the process
9. Monitor progress in the log panel and the progress bar
10. Do not disconnect the device until the log shows the completion message

---

## Features

### Connection Management

**Web Serial connect:** Opens a browser-native port picker filtered to serial devices. Configures the port at 19200 baud, 8N1, no flow control. Starts a continuous background read loop that feeds all incoming bytes into a shared ring buffer used by the flasher's receive logic.

**WebUSB connect:** Opens a browser-native USB device picker filtered to the known VID/PID combinations in the adapter table above. After selection, the code automatically locates the vendor-class interface (class 0xFF), finds the bulk IN and OUT endpoints, claims the interface, and runs the chip-specific initialization sequence. Displays the detected chip name and USB product name in the connection status bar.

**CH340/CH341A WebUSB initialization sequence:**

1. Serial initiation control transfer (request 0xA1, value 0xC29C, index 0xB2B9)
2. Modem control ON (value 0xDF), then CALL (value 0x9F)
3. Read version and status registers (value 0x0706)
4. Configure line control register (0x2727)
5. Set baud factor and offset for default 9600 baud
6. Read status again
7. Apply target baud rate 19200 via dedicated FACTOR/OFFSET register pair

**FT232R WebUSB initialization sequence:**

1. Reset (request 0x00)
2. Set baud rate divisor from lookup table (request 0x03)
3. Set line parameters 8N1 (request 0x04, value 0x0008)
4. Disable flow control (request 0x02, value 0x0000)
5. Assert DTR and RTS (request 0x01, value 0x0303)

**CP210x WebUSB initialization sequence:**

1. Enable UART (request 0x00, value 0x0001)
2. Set baud rate as 32-bit little-endian value (request 0x1E)
3. Set line parameters 8N1 (request 0x03, value 0x0800)
4. Disable flow control (request 0x13, value 0x0000)

**Disconnect:** Releases the writer lock, cancels the reader, and closes the serial port or USB interface cleanly. For CH340/CH341A, sends a modem-control-OFF control transfer before releasing the interface. All errors during disconnect are silently ignored to avoid secondary exceptions masking the original disconnect action.

**Connection test:** Runs only the initial handshake steps of the selected protocol (UID fetch and version query for Brightway) without performing any flash write operations. Confirms that the adapter is recognized, the cable is connected, and the device is responding correctly before committing to a full flash.

**Simulation mode:** Checkbox in the options tab. Replaces the hardware serial connection with a fully in-process simulated bus. All protocol steps execute normally including key generation and CRC computation. The simulator responds with realistic packets including a randomly generated MCU_RAND value on each run. No physical hardware is required. Useful for verifying firmware file parsing and testing the full UI flow end to end.

**Debug mode:** Checkbox in the options tab. Enables verbose TX/RX hex logging in the log panel for every byte sent and received. All internal command strings (nvm_write, wr_info, and so on) are also printed. When debug mode is active, status bar update messages are suppressed from the log panel to avoid duplication, matching the behavior of the Python desktop version.

### Firmware Loading

**File selection:** A standard file input in the firmware tab accepts `.bin` and `.zip` files. The file is read entirely into an ArrayBuffer via the browser FileReader API before any processing begins.

**ZIP extraction:** The raw bytes are tested against JSZip. If a valid ZIP archive is detected, the file list is scanned for a preferred entry whose name starts with `EC_ESC_Driver` or ends with `.enc`. If no such entry is found, the first file in the archive is used. The extracted bytes replace the raw input for all subsequent processing.

**Trailing checksum removal:** If the processed data is longer than 4096 bytes, the last 2 bytes are removed. Some third-party packaging tools append a 16-bit checksum at the end of firmware archives. This step matches the Python `process_firmware` function exactly.

**Automatic type detection:** After processing, the firmware is classified as BRIGHTWAY, LEQI, or UNKNOWN using the binary signature checks described in the Supported Devices section. If the type is UNKNOWN, the flash button remains disabled and a warning is shown.

**Firmware info panel:** Displayed after a successful load. Shows filename, type, size in bytes and hexadecimal, protocol name, signature string (Brightway), encryption type (LEQI), and signing key offset (Brightway).

### Brightway DFU Flash Process

The flash process runs as a 13-state machine. Each state transition is shown in the status bar and, when debug mode is off, also logged in the log panel.

| State      | Action                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| UID        | Send `53 2A 7D AC`, read 21-byte response, extract 16-byte UID from offset of `0x64` to first `0x9B`  |
| VER_INIT   | Send `down get_ver\r`, log MCU firmware version before flash                                          |
| INIT       | Send `down rd_info\r\x00\x00\x00`, await `ok\r` response                                              |
| BLE_RAND   | Send `down ble_rand <16 bytes>\r`, verify BLE_KEY in response against locally computed expected value |
| MCU_RAND   | Send `down mcu_rand\r`, extract 16-byte random challenge from response                                |
| MCU_KEY    | Compute MCU_KEY from UID and challenge using sign_rand, send `down mcu_key <16 bytes>\r`              |
| NVM_WRITE  | Send `down nvm_write <8-digit uppercase hex address>\r`, await `k\r` acknowledgment                   |
| SEND_FW    | Transmit current 2048-byte packet as 16 XMODEM chunks of 128 bytes, followed by EOT `04 04 04`        |
| WR_INFO    | Send `down wr_info <packet count> <crc32 hex> <total bytes sent>\r`                                   |
| DFU_VERIFY | Send `down dfu_verify\r`, await device CRC verification result                                        |
| DFU_ACTIVE | Send `down dfu_active\r`, trigger firmware bank swap and activation                                   |
| VER_DONE   | Send `down get_ver\r`, log MCU firmware version after flash                                           |
| DONE       | Flash complete, emit 100% progress                                                                    |

The machine loops NVM_WRITE → SEND_FW → WR_INFO → NVM_WRITE for every 2048-byte packet in the firmware. After the last real packet, one additional pass with an empty packet (address beyond the end of firmware) serves as a protocol terminator and advances the machine to DFU_VERIFY.

**XMODEM chunk format:** `01 N ~N <128 bytes data> CRC16_HIGH CRC16_LOW`, where N is the 1-based chunk index within the current packet and ~N is its one-byte bitwise complement (`0xFF - N`). Up to 20 retries per chunk. ACK byte `0x06` advances to the next chunk. NAK byte `0x15` raises an error immediately without further retries.

**Key generation (sign_rand):** BLE_KEY and MCU_KEY are computed from the device UID and a 16-byte random challenge. The algorithm reads two lookup tables from fixed offsets inside the firmware binary identified by the `637C` and `0102` byte patterns. It then runs a 10-round substitution-permutation network: each round applies XOR mixing with 16-byte key blocks, byte substitution via the 256-entry S-box table, and four circular byte rotations at fixed index sets within the 16-byte state. This is a direct port of the Python `keygen.py` module and produces byte-identical results.

**CRC-16:** Polynomial 0x1021, initial value 0, no input or output reflection (CRC-16/XMODEM). Identical to Python `binascii.crc_hqx(data, 0x0)`. Used for XMODEM chunk validation.

**CRC-32:** Standard CRC-32/ISO-HDLC with reflected polynomial 0xEDB88320, initial value 0xFFFFFFFF, final XOR 0xFFFFFFFF. Identical to Python `binascii.crc32`. Used in the `wr_info` command and formatted as an 8-character lowercase hex string. The CRC is computed cumulatively over all padded firmware packets sent so far, including the `0xFF` padding bytes added to the final packet.

### LEQI Binary Flash Process

1. Compute firmware payload size by scanning the firmware bytes for the end of the trailing `0xAA` padding block. The result is rounded up to the next 128-byte boundary.
2. If the input image is larger than the expected payload size, extract the payload starting at offset `0x80`.
3. Send start packet `5A 12 03 06 31 00 <size_LE16> 00 00 <CRC16>`. Expect `5A 21 03` response.
4. Send firmware data in 128-byte chunks. Each packet: `5A 12 04 84 <offset_LE32> <128 bytes data> <CRC16>`. Expect `5A 21 04 01 01` acknowledgment per chunk. Missing or invalid ACKs are counted as failures.
5. After all chunks, wait 690 ms for device internal processing.
6. Send end packet `5A 12 05 00 <CRC16>` with up to 10 retries at 60 ms intervals. Expect `5A 21 05` response. If no valid response is received after 10 attempts, an error is thrown.

The LEQI receive path bypasses the standard `receiveResponse` terminator loop and scans the raw ring buffer directly for a `0x5A` header byte, then reads 6 additional bytes. This is necessary because `0x5A` appears as a data value in firmware packets and cannot safely be used as a stream terminator.

### Abort

The abort button sets `abortSignal.aborted = true` on a shared object passed to the flasher at construction time. The Brightway flasher checks this signal before transmitting each XMODEM chunk. The LEQI flasher checks it before each firmware data chunk. The current in-flight write completes normally before the abort takes effect. No partial packets are left pending in the serial buffer.

### Log Panel

Timestamped entries with millisecond precision in `HH:MM:SS.mmm` format. Each entry is color-coded by message type:

| Tag    | Color   | Usage                                |
| ------ | ------- | ------------------------------------ |
| `ok`   | Green   | Successful operations                |
| `err`  | Red     | Errors and failures                  |
| `warn` | Yellow  | Warnings and retry notices           |
| `info` | Default | Informational messages               |
| `tx`   | Blue    | Transmitted bytes in debug mode      |
| `rx`   | Cyan    | Received bytes in debug mode         |
| `dbg`  | Dim     | Internal debug strings in debug mode |

All strings are HTML-escaped before insertion to prevent XSS from firmware file names or raw device responses appearing in the log.

### Progress Display

An animated CSS progress bar shows completion percentage from 0 to 100. The percentage is computed as `packets_sent / total_packets * 100` and capped at 99 until the final completion event. A text status badge shows the current machine state: IDLE, FLASHING, DONE, or ERROR.

### Update Check

Triggered once after the disclaimer is accepted. Sends a single GET request to the GitHub Releases API (`https://api.github.com/repos/scooterteam/bw-flasher/releases`) with a 5-second timeout using `AbortSignal.timeout`. If the latest release tag is numerically newer than the embedded version string, a dismissible banner is prepended to the page body with the version number and a direct download link to the release.

### Chiptune Audio

Attempts to load `./chiptune.mp3` from the same directory as the HTML file using an Audio element with `loop = true` and a 2-second load timeout. On `file://` origins where `fetch` would fail due to CORS, the Audio element's `canplaythrough` and `error` events are used instead. If the MP3 loads successfully, it plays at 35% volume in a loop. If the file is not found or fails to load within the timeout, a Web Audio API synthesizer takes over. The synthesizer plays a 32-note looping melody on a square-wave oscillator with a triangle-wave bass line at half the note duration and an optional octave-up accent square wave on beat boundaries. A custom MP3 can be loaded at runtime via the music button's file input without reloading the page.

### Internationalization

Three languages are included: English, German, Polish. Translation JSON files are at `assets/language/english.json`, `assets/language/deutsch.json`, and `assets/language/polski.json`. All UI text, `aria-label`, `title`, and `placeholder` attributes are driven by `data-i18n`, `data-i18n-html`, `data-i18n-aria`, `data-i18n-title`, and `data-i18n-ph` attributes on DOM elements. The selected language is persisted in `localStorage` under the key `bwf_lang` and restored on every page load. The default language is German. Language switching applies immediately with no page reload.

---

## Protocol Reference

### Brightway Command Table

| Command                             | Direction | Description                                     |
| ----------------------------------- | --------- | ----------------------------------------------- |
| `53 2A 7D AC`                       | TX        | Request device UID                              |
| `down get_ver\r`                    | TX        | Request MCU firmware version string             |
| `down rd_info\r\x00\x00\x00`        | TX        | Begin DFU session                               |
| `down ble_rand <16 bytes>\r`        | TX        | Send BLE challenge, receive computed BLE_KEY    |
| `down mcu_rand\r`                   | TX        | Request 16-byte MCU random challenge            |
| `down mcu_key <16 bytes>\r`         | TX        | Send computed MCU authentication key            |
| `down nvm_write <addr8>\r`          | TX        | Announce packet start at 8-digit hex address    |
| `01 N ~N <128 bytes> CRC16`         | TX        | XMODEM data chunk                               |
| `04 04 04`                          | TX        | XMODEM end of transmission                      |
| `down wr_info <n> <crc32> <size>\r` | TX        | Cumulative packet count, CRC32 hex, total bytes |
| `down dfu_verify\r`                 | TX        | Request firmware integrity verification         |
| `down dfu_active\r`                 | TX        | Activate the newly written firmware             |
| `06`                                | RX        | XMODEM ACK                                      |
| `15`                                | RX        | XMODEM NAK (CRC error)                          |
| `ok\r`                              | RX        | Generic command acknowledgment                  |
| `ok <16 bytes>\r`                   | RX        | BLE_KEY or MCU_RAND payload                     |
| `64 2A 10 <16 bytes> 10 9B`         | RX        | UID response frame                              |

### LEQI Packet Structure

```
Offset  Length  Field
0       1       Start byte: always 0x5A
1       1       Protocol byte: 0x12 (command) or 0x21 (response)
2       1       Type: 0x03 = start, 0x04 = data, 0x05 = end
3       1       Payload length in bytes
4+      var     Payload (type-dependent)
last 2  2       CRC-16/XMODEM over all preceding bytes, big-endian
```

---

## Architecture

The application consists of ten JavaScript modules loaded as plain script tags with no build step, no bundler, and no npm. All state is held in module-level variables or class instances. There are no global side effects except for the `window.switchTab`, `window.disclaimerAccept`, and `window.disclaimerDecline` functions exposed for inline HTML event handlers.

### Module Descriptions

**helpers.js** - Utility functions shared by all other modules. `sleep(ms)` returns a Promise that resolves after `ms` milliseconds. `hexToBytes(hex)` converts a hex string to `Uint8Array`. `toHex(bytes)` formats a `Uint8Array` as space-separated uppercase hex. `strToBytes(s)` encodes a string to `Uint8Array` via `TextEncoder`. `bytesToAscii(bytes)` decodes bytes to a string ignoring invalid characters. `startsWithOk(bytes)` checks whether the first two bytes are `6F 6B` (ASCII `ok`). `arrEq(a, b)` performs element-wise comparison of two typed arrays. Conditional polyfills for `Uint8Array.prototype.includes`, `indexOf`, and `lastIndexOf` are added only if the methods are not already natively present.

**crc.js** - Two pure stateless CRC functions. `crc16(data, init)` implements CRC-16/XMODEM (polynomial 0x1021, no reflection, default init 0), byte-identical to Python `binascii.crc_hqx(data, 0x0)`. `crc32(data)` implements CRC-32/ISO-HDLC using a precomputed 256-entry lookup table (reflected polynomial 0xEDB88320), byte-identical to Python `binascii.crc32`. The lookup table is computed once at module load time.

**keygen.js** - Direct port of `keygen.py`. Exports `signRand(uid, rand, fw, fwOffset0, fwOffset1)`. Internal functions: `genKey(dst, src, lt0, lt1)` expands a 16-byte UID into a 176-byte key schedule using the AES-like round structure with the firmware S-box and round constant table. `xorByteBlocks(dst, src, blockIndex)` XORs a 16-byte block from `src` at position `blockIndex * 16` into the first 16 bytes of `dst`. `manipulateBytes(arr)` performs an in-place GF(2⁸) mixing step with coefficient `c = -0x1b` (expressed as `0xE5` in unsigned arithmetic). `rollBytes(arr, indices)` performs a one-position left circular rotation of the byte values at the given index positions. `signRandWithKey(dst, src, lt)` applies 10 rounds of xorByteBlocks, manipulateBytes, S-box substitution, and four rollBytes calls, then a final xorByteBlocks, to sign the challenge.

**firmware.js** - `findPatternOffsets(patternHex, data, startOffset)` searches a `Uint8Array` for all byte occurrences of a hex-encoded pattern, equivalent to Python `utils.find_pattern_offsets`. `processFirmware(rawData, log)` attempts ZIP extraction via JSZip, removes the trailing 2-byte checksum, and returns the processed `Uint8Array`. The optional `log` callback receives informational messages. `detectFirmwareType(data)` classifies the firmware as `BRIGHTWAY`, `LEQI`, or `UNKNOWN`. `getFirmwareInfo(data)` returns a structured plain object with type, size, protocol, signature, encryption type, and signing offset.

**serial.js** - `FlasherSerial` base class with a `rxBuf` byte array acting as a ring buffer, a waiter/notify mechanism for efficient async waiting, and `receiveResponse(nBytes, termByte, timeoutMs)` that reads until the terminator byte is found or the deadline is reached, then returns the last `nBytes` as `Uint8Array`. `WebSerialAdapter extends FlasherSerial` wraps the Web Serial API. `WebUSBAdapter extends FlasherSerial` wraps the WebUSB API with chip detection from a hardware VID/PID table, interface and endpoint enumeration, chip-specific init methods, a promise-chaining read loop compatible with Android Chrome, and graceful disconnect with CH340 modem-off. `SimulationSerial extends FlasherSerial` is an in-memory bus where the `write` call synchronously invokes the flasher's `_onWrite` callback, and `injectResponse` pushes bytes into `rxBuf` via a `setTimeout` to simulate transmission latency.

**brightway.js** - `BrightwayFlasher` class. Constructor accepts a serial adapter instance and an options object: `simulation` (boolean), `debug` (boolean), `onLog` (function), `onStatus` (function), `onProgress` (function), `abortSignal` (object with `.aborted` boolean). `loadFirmware(data)` validates the firmware against the expected patterns, extracts the two lookup table offsets, and computes the total packet count. `run()` drives the state machine until `DONE`. `testConnection()` runs only the handshake states and stops at `INIT`. All thirteen protocol handler methods are private.

**leqi.js** - `LeqiFlasher` class with the same constructor signature. `loadFirmware(data)` extracts the firmware payload and computes the active size. `run()` dispatches to either the real hardware path or `_runSimulation`. `testConnection()` sends a minimal start packet and checks for `5A 21` response. `_readLeqiResponse(timeout)` bypasses `receiveResponse` and scans the ring buffer directly for the `0x5A` header byte.

**chiptune.js** - IIFE module exported as `Chiptune`. Public API: `start()` (async, loads MP3 or starts synth), `stop()`, `toggle()` (returns new playing state), `isPlaying()`, `loadFile(file)` (replaces current audio source at runtime), `isUsingMp3()`.

**script.js** - `I18n` IIFE with `load(lang)`, `get(key)`, `init()`, and `getCurrent()`. `Tabs` IIFE with `activate(tabId)`. Bootstrap runs on `DOMContentLoaded`: calls `I18n.init()` and `Tabs.activate('connect')`.

**ui.js** - `UI` plain object initialized on `DOMContentLoaded`. Wires event listeners to all buttons, file input, and checkboxes. `connectWebSerial()` and `connectWebUSB()` instantiate the correct adapter and call `connect`. `onFileSelect(e)` calls `processFirmware` with a log callback, calls `getFirmwareInfo`, and updates the firmware info panel and button state. `startFlash()` instantiates the correct flasher class based on `this._fwType`, wires callbacks, and calls `f.loadFirmware` then `f.run`. `testConnection()` does the same but calls `f.testConnection` instead. `addLog(msg, type)` appends a timestamped, HTML-escaped, color-coded line. `setProgress(pct)` updates the bar and label. `setFlashState(state)` updates the status badge. `_checkUpdate()` queries the GitHub API and calls `_showUpdateBanner` if needed.

### Load Order

```
script.js  (i18n bootstrap, must be first)
    |
helpers.js  crc.js  keygen.js  firmware.js  serial.js
                                                 |
                                   brightway.js  leqi.js
                                                 |
                                   chiptune.js  ui.js
```

---

## Changelog

All changes listed below are relative to the original `bwflasher-web` version as of 2026-04-12.

---

### FIX-1 (Critical): CRC32 mismatch for non-aligned firmware images

**Affected file:** `assets/js/brightway.js`
**Affected function:** `_sendFwPacket`

**Root cause:**
The Python reference implementation (`brightway_flasher.py`, function `send_fw_packet`) pads every firmware packet to exactly 2048 bytes with `0xFF` using `self.packet += b'\xFF' * (PACKET_SIZE - len(self.packet))` and then appends the padded packet to `self.data_sent`. The CRC32 value sent in each `wr_info` command is computed over `self.data_sent`, which therefore always contains full 2048-byte padded entries regardless of the actual firmware size.

The web version created a `padded` buffer correctly and sent the right bytes to the device, but then stored `this.packet.slice()` (the original unpadded slice) in `_dataSentChunks` instead of the padded buffer. When `_sendWrInfo` rebuilt `this.dataSent` from `_dataSentChunks` and called `crc32`, it computed the checksum over a shorter array than the device received for any firmware whose length is not a multiple of 2048 bytes.

**Impact:**
Every firmware image whose size is not a multiple of 2048 bytes fails to flash. The device receives a CRC32 that does not match the padded bytes it stored in NVM and returns an error at the `dfu_verify` step. In practice this affects the majority of real firmware files.

**Verification:**
For a 3000-byte test firmware, the old code produced a CRC32 over 3000 bytes. The device computes the CRC32 over 4096 bytes (2 packets of 2048 bytes, with the last 1096 bytes filled with `0xFF`). The mismatch causes the device to reject the flash.

**Fix:**
Introduced a `paddedToSave` variable scoped to `_sendFwPacket`. It is assigned the reference to the full 2048-byte padded buffer immediately after it is created. After the chunk-sending loop and the EOT transfer, `paddedToSave` (not `this.packet`) is pushed into `_dataSentChunks`. The empty terminating packet (beyond the end of firmware) pushes nothing, exactly as in Python where `self.data_sent += b''` is a no-op. The `_dataSentCache` field replaces the former anonymous `dataSent` field and is rebuilt from `_dataSentChunks` only when the total accumulated size has changed.

```js
// Before - stored unpadded original slice
if (this.packet && this.packet.length > 0) this._dataSentChunks.push(this.packet.slice())

// After - stored full padded 2048-byte buffer
let paddedToSave = null
if (this.packet && this.packet.length > 0) {
	const padded = new Uint8Array(PACKET_SIZE).fill(0xff)
	padded.set(this.packet)
	paddedToSave = padded // save before leaving scope
	// ... send chunks using padded ...
}
// ... EOT ...
if (paddedToSave) this._dataSentChunks.push(paddedToSave)
```

---

### FIX-2 (Medium): Wrong end-offset in UID parsing causing BLE_KEY failure

**Affected file:** `assets/js/brightway.js`
**Affected function:** `_getUid`

**Root cause:**
The Python reference uses `response.index(byte_end)` which returns the index of the **first** occurrence of byte `0x9B` in the response. The web version used `resp.lastIndexOf(0x9B)` which returns the index of the **last** occurrence. Under real serial conditions, line noise, framing errors, or ring buffer residue can introduce extra `0x9B` bytes after the UID payload. In that case `lastIndexOf` returns a larger offset, the extracted slice is longer than 16 bytes, `this.uid` contains garbage after the real 16-byte UID, and the BLE_KEY computed by `signRand` from the corrupted UID does not match the device's expected value. The flash aborts at the BLE_RAND step with a `BLE_KEY mismatch` error.

**Fix:** Changed `resp.lastIndexOf(0x9B)` to `resp.indexOf(0x9B)`.

```js
// Before
const end = resp.lastIndexOf(0x9b)

// After
const end = resp.indexOf(0x9b)
```

---

### FIX-3 (Medium): NVM_WRITE timeout too short for flash erase cycles

**Affected file:** `assets/js/brightway.js`
**Affected function:** `_sendNvmWrite`

**Root cause:**
The `down nvm_write` command instructs the device to erase the target flash sector before the XMODEM data transfer begins. Flash sector erase times vary by controller hardware and can reach up to 700 milliseconds on some Brightway variants. The previous timeout of 300 ms caused `receiveResponse` to return an empty buffer before the device sent the acknowledgment. The check `resp.includes(0x6B) && resp.includes(0x0D)` then evaluated to false, the state machine did not advance, the same `nvm_write` command was retried on the next loop iteration, and the retried command was received while the device was still processing the first one, producing unpredictable behavior.

**Fix:** Timeout increased from 300 ms to 1000 ms.

```js
// Before
const resp = await this._recv(3, 0x0d, 300)

// After
const resp = await this._recv(3, 0x0d, 1000)
```

---

### FIX-4 (Low): Unconditional Uint8Array prototype overrides

**Affected file:** `assets/js/helpers.js`

**Root cause:**
The original code assigned `includes`, `indexOf`, and `lastIndexOf` unconditionally to `Uint8Array.prototype`. These methods have been natively available on typed arrays in Chrome since version 49 (2016), Firefox since version 46, and Safari since version 9. All targeted browsers support them natively. Overriding native methods with custom single-argument implementations shadows the native signature, preventing the use of the optional `fromIndex` parameter that exists on `Array.prototype.includes` and could be added natively to typed arrays in future browser versions. It also introduces a risk of subtle behavior differences if any other code in the page or any loaded library relies on the native typed array method signatures.

**Fix:** Each assignment is guarded by a `typeof` feature check.

```js
// Before - unconditional override
Uint8Array.prototype.includes    = function(val) { ... };
Uint8Array.prototype.indexOf     = function(val) { ... };
Uint8Array.prototype.lastIndexOf = function(val) { ... };

// After - polyfill only if not already native
if (typeof Uint8Array.prototype.includes    !== 'function') { Uint8Array.prototype.includes    = function(val) { ... }; }
if (typeof Uint8Array.prototype.indexOf     !== 'function') { Uint8Array.prototype.indexOf     = function(val) { ... }; }
if (typeof Uint8Array.prototype.lastIndexOf !== 'function') { Uint8Array.prototype.lastIndexOf = function(val) { ... }; }
```

---

### FIX-5 (Critical): ReferenceError when loading ZIP firmware files

**Affected files:** `assets/js/firmware.js`, `assets/js/ui.js`
**Affected function:** `processFirmware`

**Root cause:**
The ZIP extraction path inside `processFirmware` contained the call `logMsg(\`Extracted from ZIP: ${preferred}\`, 'info')`. The function `logMsg`is not defined anywhere in the project. On every attempt to load a ZIP-packaged firmware file, JavaScript threw`ReferenceError: logMsg is not defined`. This exception was raised inside the `try`block surrounding the JSZip call, so it was silently caught and discarded. The code then fell through to use the raw ZIP container bytes as if no extraction had taken place.`detectFirmwareType`then ran on the ZIP file header bytes rather than the actual firmware binary, always returned`UNKNOWN`, and the flash button was never enabled. Users loading ZIP firmware files saw only a firmware type of UNKNOWN with no explanation.

**Impact:** ZIP-packaged firmware files could never be detected as a valid type and could never be flashed. The failure was entirely silent from the user's perspective.

**Fix in `firmware.js`:** Removed the `logMsg` call. The function now accepts an optional `log` callback as its second argument. The callback is called as `_log(message, type)`. If no callback is provided, a no-op function is used.

**Fix in `ui.js`:** Updated the call site to pass the UI log callback.

```js
// firmware.js - Before
async function processFirmware(rawData) {
    // ...
    logMsg(`Extracted from ZIP: ${preferred}`, 'info'); // ReferenceError

// firmware.js - After
async function processFirmware(rawData, log) {
    const _log = (typeof log === 'function') ? log : () => {};
    // ...
    _log(`Extracted from ZIP: ${preferred}`, 'info'); // safe

// ui.js - Before
const data = await processFirmware(new Uint8Array(raw));

// ui.js - After
const data = await processFirmware(new Uint8Array(raw), (m, t) => this.addLog(m, t));
```

---

### Summary of Changed Files

| File                     | Status    | Applied Fixes            |
| ------------------------ | --------- | ------------------------ |
| `assets/js/brightway.js` | Modified  | FIX-1, FIX-2, FIX-3      |
| `assets/js/helpers.js`   | Modified  | FIX-4                    |
| `assets/js/firmware.js`  | Modified  | FIX-5                    |
| `assets/js/ui.js`        | Modified  | FIX-5 (call site update) |
| `assets/js/serial.js`    | Unchanged | No bugs found            |
| `assets/js/crc.js`       | Unchanged | No bugs found            |
| `assets/js/keygen.js`    | Unchanged | No bugs found            |
| `assets/js/leqi.js`      | Unchanged | No bugs found            |
| `assets/js/chiptune.js`  | Unchanged | No bugs found            |
| `assets/js/script.js`    | Unchanged | No bugs found            |
| `index.html`             | Unchanged | No bugs found            |

---

## Safety Warning

Modifying device firmware can be dangerous and may be illegal in your jurisdiction.

- Using modified firmware may void your warranty
- Removing or bypassing speed limits may violate road traffic laws in your country
- Operating an unlocked scooter in public may result in fines or criminal liability for accidents
- Incorrect flashing procedures can permanently brick the scooter controller
- Modified devices may behave unpredictably at speeds above the factory limit

You assume full responsibility for all injuries, accidents, property damage, legal consequences, and hardware damage resulting from the use of this tool. Test any modified device in a controlled environment before operating it in traffic.

---

## Disclaimer

This software is not affiliated with, endorsed by, or associated with Brightway, Xiaomi, NAVEE, or any other manufacturer or vendor. It is provided as-is without any warranties of any kind. The developers assume no responsibility for damage, malfunctions, warranty voidance, or legal consequences resulting from its use. This tool is intended for educational and research purposes only. By using this software you acknowledge and accept these terms in full.

---

## Principles

You own what you buy. If you purchased a device, you have the right to understand how it works, repair it, and modify it for personal use. Vendors should not lock you out of hardware you own.

Knowledge should be free. Reverse engineering findings belong in the public domain. Documenting weak encryption and absent authentication pushes manufacturers toward better security rather than relying on security through obscurity.

Personal responsibility matters. We provide tools for research and education. What you do with them and the consequences are yours. Know your local laws. Prioritize safety above speed.

No commercial exploitation. This work is shared freely under a NonCommercial license and is not intended for building products that profit from bypassing safety features.

---

## License

[Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](http://creativecommons.org/licenses/by-nc-sa/4.0/) - ScooterTeam © 2024-2025
