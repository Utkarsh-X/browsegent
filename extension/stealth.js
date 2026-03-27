"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var require_stealth = __commonJS({
    "extension/stealth.ts"() {
      (function() {
        "use strict";
        try {
          Object.defineProperty(navigator, "webdriver", {
            get: () => false,
            configurable: true
          });
        } catch {
        }
        try {
          Object.defineProperty(navigator, "hardwareConcurrency", {
            get: () => 8,
            configurable: true
          });
        } catch {
        }
        try {
          Object.defineProperty(navigator, "deviceMemory", {
            get: () => 8,
            configurable: true
          });
        } catch {
        }
        try {
          const fakePlugins = [
            { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
            { name: "Native Client", filename: "internal-nacl-plugin", description: "" }
          ];
          Object.defineProperty(navigator, "plugins", {
            get: () => {
              const list = Object.create(PluginArray.prototype);
              fakePlugins.forEach((p, i) => {
                const plugin = Object.create(Plugin.prototype);
                Object.defineProperty(plugin, "name", { get: () => p.name });
                Object.defineProperty(plugin, "filename", { get: () => p.filename });
                Object.defineProperty(plugin, "description", { get: () => p.description });
                Object.defineProperty(list, i, { get: () => plugin, enumerable: true });
              });
              Object.defineProperty(list, "length", { get: () => fakePlugins.length });
              return list;
            },
            configurable: true
          });
        } catch {
        }
        try {
          Object.defineProperty(navigator, "mimeTypes", {
            get: () => {
              const list = Object.create(MimeTypeArray.prototype);
              Object.defineProperty(list, "length", { get: () => 2 });
              return list;
            },
            configurable: true
          });
        } catch {
        }
        try {
          const origGetVoices = speechSynthesis.getVoices.bind(speechSynthesis);
          const fakeVoices = [
            { name: "Google US English", lang: "en-US", localService: false, default: true, voiceURI: "Google US English" },
            { name: "Google UK English Female", lang: "en-GB", localService: false, default: false, voiceURI: "Google UK English Female" },
            { name: "Google \u0939\u093F\u0928\u094D\u0926\u0940", lang: "hi-IN", localService: false, default: false, voiceURI: "Google \u0939\u093F\u0928\u094D\u0926\u0940" }
          ];
          speechSynthesis.getVoices = function() {
            const real = origGetVoices();
            if (real && real.length > 0) return real;
            return fakeVoices;
          };
        } catch {
        }
        try {
          const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
          const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
          const NOISE_SEED = Math.floor(Math.random() * 10) + 1;
          HTMLCanvasElement.prototype.toDataURL = function(...args) {
            const result = origToDataURL.apply(this, args);
            if (this.width < 200 && this.height < 50) {
              return result.slice(0, -NOISE_SEED) + result.slice(-NOISE_SEED);
            }
            return result;
          };
          CanvasRenderingContext2D.prototype.getImageData = function(...args) {
            const imageData = origGetImageData.apply(this, args);
            if (imageData.width < 200) {
              for (let i = 0; i < NOISE_SEED; i++) {
                const idx = i * 4 % imageData.data.length;
                imageData.data[idx] = (imageData.data[idx] ^ 1) & 255;
              }
            }
            return imageData;
          };
        } catch {
        }
        try {
          const origGetParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return "Intel Inc.";
            if (parameter === 37446) return "Intel Iris OpenGL Engine";
            return origGetParameter.call(this, parameter);
          };
          const origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return "Intel Inc.";
            if (parameter === 37446) return "Intel Iris OpenGL Engine";
            return origGetParameter2.call(this, parameter);
          };
        } catch {
        }
        try {
          if (!window.chrome) {
            window.chrome = {
              runtime: {},
              loadTimes: function() {
                return {};
              },
              csi: function() {
                return {};
              },
              app: {}
            };
          }
        } catch {
        }
        try {
          const origQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = async function(params) {
            if (params.name === "notifications") {
              return { state: "prompt", onchange: null };
            }
            return origQuery(params);
          };
        } catch {
        }
        try {
          const ua = navigator.userAgent;
          if (ua.includes("HeadlessChrome")) {
            const cleanUA = ua.replace("HeadlessChrome", "Chrome");
            Object.defineProperty(navigator, "userAgent", {
              get: () => cleanUA,
              configurable: true
            });
            Object.defineProperty(navigator, "appVersion", {
              get: () => cleanUA.replace("Mozilla/", ""),
              configurable: true
            });
          }
        } catch {
        }
        console.log("[browsegent:stealth] Stealth patches applied");
      })();
    }
  });
  require_stealth();
})();
