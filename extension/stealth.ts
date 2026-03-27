// extension/stealth.ts
// Runs in MAIN world at document_start — BEFORE page JS
// Patches JavaScript-detectable automation signals
// NEVER import from src/ — must be self-contained after build

(function() {
  'use strict';

  // ── 1. Remove webdriver flag ──────────────────────────────────────────────
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true,
    });
  } catch { /* already defined non-configurable */ }

  // ── 2. Hardware concurrency (headless default is 2, real machines are 4-16) ──
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
      configurable: true,
    });
  } catch { /* skip */ }

  // ── 3. Device memory (headless may expose undefined) ─────────────────────
  try {
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
      configurable: true,
    });
  } catch { /* skip */ }

  // ── 4. Navigator plugins (empty in headless — dead giveaway) ─────────────
  try {
    const fakePlugins = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ];

    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const list = Object.create(PluginArray.prototype);
        fakePlugins.forEach((p, i) => {
          const plugin = Object.create(Plugin.prototype);
          Object.defineProperty(plugin, 'name', { get: () => p.name });
          Object.defineProperty(plugin, 'filename', { get: () => p.filename });
          Object.defineProperty(plugin, 'description', { get: () => p.description });
          Object.defineProperty(list, i, { get: () => plugin, enumerable: true });
        });
        Object.defineProperty(list, 'length', { get: () => fakePlugins.length });
        return list;
      },
      configurable: true,
    });
  } catch { /* skip */ }

  // ── 5. MIME types (paired with plugins) ──────────────────────────────────
  try {
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const list = Object.create(MimeTypeArray.prototype);
        Object.defineProperty(list, 'length', { get: () => 2 });
        return list;
      },
      configurable: true,
    });
  } catch { /* skip */ }

  // ── 6. Speech synthesis voices (empty in headless) ───────────────────────
  try {
    const origGetVoices = speechSynthesis.getVoices.bind(speechSynthesis);
    const fakeVoices = [
      { name: 'Google US English', lang: 'en-US', localService: false, default: true, voiceURI: 'Google US English' },
      { name: 'Google UK English Female', lang: 'en-GB', localService: false, default: false, voiceURI: 'Google UK English Female' },
      { name: 'Google हिन्दी', lang: 'hi-IN', localService: false, default: false, voiceURI: 'Google हिन्दी' },
    ];

    speechSynthesis.getVoices = function() {
      const real = origGetVoices();
      if (real && real.length > 0) return real;
      return fakeVoices as unknown as SpeechSynthesisVoice[];
    };
  } catch { /* skip */ }

  // ── 7. Canvas fingerprint noise ───────────────────────────────────────────
  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    // Add imperceptible per-session noise to canvas output
    const NOISE_SEED = Math.floor(Math.random() * 10) + 1;

    HTMLCanvasElement.prototype.toDataURL = function(...args: Parameters<typeof origToDataURL>) {
      const result = origToDataURL.apply(this, args);
      if (this.width < 200 && this.height < 50) {
        return result.slice(0, -NOISE_SEED) + result.slice(-NOISE_SEED);
      }
      return result;
    };

    CanvasRenderingContext2D.prototype.getImageData = function(...args: Parameters<typeof origGetImageData>) {
      const imageData = origGetImageData.apply(this, args);
      if (imageData.width < 200) {
        for (let i = 0; i < NOISE_SEED; i++) {
          const idx = (i * 4) % imageData.data.length;
          imageData.data[idx] = (imageData.data[idx]! ^ 1) & 0xFF;
        }
      }
      return imageData;
    };
  } catch { /* skip — never block page */ }

  // ── 8. WebGL renderer spoof ───────────────────────────────────────────────
  try {
    const origGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return origGetParameter.call(this, parameter);
    };

    const origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter: number) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return origGetParameter2.call(this, parameter);
    };
  } catch { /* skip */ }

  // ── 9. Chrome runtime normalization ──────────────────────────────────────
  try {
    if (!(window as any).chrome) {
      (window as any).chrome = {
        runtime: {},
        loadTimes: function() { return {}; },
        csi: function() { return {}; },
        app: {},
      };
    }
  } catch { /* skip */ }

  // ── 10. Permissions API normalization ────────────────────────────────────
  try {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = async function(params: PermissionDescriptor) {
      if ((params as any).name === 'notifications') {
        return { state: 'prompt', onchange: null } as PermissionStatus;
      }
      return origQuery(params);
    };
  } catch { /* skip */ }

  // ── 11. Remove HeadlessChrome from User-Agent if present ─────────────────
  try {
    const ua = navigator.userAgent;
    if (ua.includes('HeadlessChrome')) {
      const cleanUA = ua.replace('HeadlessChrome', 'Chrome');
      Object.defineProperty(navigator, 'userAgent', {
        get: () => cleanUA,
        configurable: true,
      });
      Object.defineProperty(navigator, 'appVersion', {
        get: () => cleanUA.replace('Mozilla/', ''),
        configurable: true,
      });
    }
  } catch { /* skip */ }

  console.log('[browsegent:stealth] Stealth patches applied');
})();
