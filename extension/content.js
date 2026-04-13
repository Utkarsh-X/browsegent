"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var require_content = __commonJS({
    "extension/content.ts"() {
      (function() {
        "use strict";
        const goal = window.__browsegent_goal ?? "";
        const HIGH_WINDOW = 300;
        const PAGE_INIT_MIN = 1200;
        const PAGE_INIT_MAX = 5e3;
        const QUIET_PERIOD = 600;
        const MAX_PENDING = 20;
        const MAX_DELTAS = 50;
        const MAX_NODES = 1e4;
        const MAX_OUTPUT_NODES = 240;
        const MIN_TEXT = 5;
        const NOISE_FETCH = /analytics|tracking|gtm|facebook|doubleclick|adservice|beacon|telemetry|hotjar|clarity|\/menu|\/nav|\/header|\/footer/i;
        const NOISE_CLICK = /nav|menu|header|footer|breadcrumb|sidebar/i;
        const SKIP_TAGS = /* @__PURE__ */ new Set(["script", "style", "noscript", "svg", "iframe", "canvas", "video", "audio", "head", "meta", "link", "br", "hr", "img"]);
        const FORM_TAGS = /* @__PURE__ */ new Set(["input", "select", "textarea"]);
        const INTERACTIVE_TAGS = /* @__PURE__ */ new Set(["button", "a", "summary", "label"]);
        const INTERACTIVE_ROLES = /* @__PURE__ */ new Set(["button", "link", "tab", "option", "menuitem", "checkbox", "radio", "switch", "textbox", "combobox", "searchbox"]);
        const GENERIC_CONTAINER_TAGS = /* @__PURE__ */ new Set(["body", "main", "section", "article", "div", "span", "ul", "ol", "li", "nav", "header", "footer", "form"]);
        const TOGGLE_ROLES = /* @__PURE__ */ new Set(["checkbox", "radio", "switch"]);
        const REGION_TAGS = /* @__PURE__ */ new Set(["article", "section", "form", "fieldset", "li", "tr", "main", "aside"]);
        const TRIGGER_KW = /buy|submit|login|load\s*more|next|add\s*to|search|sign\s*in|continue|proceed|checkout|confirm|apply|get|download|register|subscribe|show|view|open|filter|sort|menu/i;
        const SEARCH_HINTS = /search|magnify|glass|lookup|find|query|searchbox|search-btn|search-button/i;
        const REGION_HINTS = /\b(card|item|result|row|listing|product|job|entry|module|panel|tile)\b/i;
        const NOISE_CLS = /\b(loader|spinner|hidden|skeleton|placeholder|overlay|backdrop|tooltip|sr-only|visually-hidden)\b/i;
        const TYPE_CAPS = {
          input: 40,
          trigger: 60,
          data: 110,
          table_cell: 30
        };
        const pending = [];
        const deltas = [];
        let pageInitComplete = false;
        let lastMutationTs = Date.now();
        let domContentLoadedAt = Date.now();
        let rttSamples = [];
        let calibratedMax = 1200;
        let injectionTime = Date.now();
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", () => {
            domContentLoadedAt = Date.now();
          }, { once: true });
        } else {
          domContentLoadedAt = Date.now();
        }
        const readinessCheck = setInterval(() => {
          const age = Date.now() - domContentLoadedAt;
          const quietFor = Date.now() - lastMutationTs;
          if (age >= PAGE_INIT_MAX || age >= PAGE_INIT_MIN && quietFor >= QUIET_PERIOD) {
            pageInitComplete = true;
            clearInterval(readinessCheck);
          }
        }, 200);
        function addPending(cause) {
          pending.push(cause);
          if (pending.length > MAX_PENDING) pending.shift();
        }
        function evictStale() {
          const cutoff = Date.now() - calibratedMax * 1.5;
          let i = 0;
          while (i < pending.length && pending[i].timestamp < cutoff) i++;
          if (i > 0) pending.splice(0, i);
        }
        setInterval(evictStale, 300);
        function sampleRTT(url, startTs) {
          const rtt = Date.now() - startTs;
          const withinWindow = Date.now() - injectionTime < 1e4;
          if (withinWindow && rttSamples.length < 3 && !NOISE_FETCH.test(url)) {
            rttSamples.push(rtt);
            if (rttSamples.length >= 2) {
              const avg = rttSamples.reduce((a, b) => a + b, 0) / rttSamples.length;
              calibratedMax = Math.max(800, Math.min(4e3, avg * 2.5));
              console.log("[browsegent] RTT calibrated:", { samples: rttSamples, calibratedMax });
            }
          }
        }
        function normalizeText(value) {
          return (value ?? "").replace(/\s+/g, " ").trim();
        }
        function escapeCssValue(value) {
          return CSS.escape(value);
        }
        function getDirectText(el) {
          let text = "";
          for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              text += ` ${child.textContent ?? ""}`;
            }
          }
          return normalizeText(text);
        }
        function getElementText(el, tag) {
          if (FORM_TAGS.has(tag)) return "";
          if (INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(el.getAttribute("role") ?? "")) {
            return normalizeText((el.textContent ?? "").slice(0, 200));
          }
          const directText = getDirectText(el);
          if (directText) return directText.slice(0, 200);
          if (el.childElementCount <= 2) return normalizeText((el.textContent ?? "").slice(0, 200));
          return "";
        }
        function getElementFormValue(el, tag) {
          if (tag === "input") {
            const input = el;
            if (input.type === "password") return "";
            return normalizeText((input.value ?? "").slice(0, 200));
          }
          if (tag === "textarea") {
            return normalizeText((el.value ?? "").slice(0, 200));
          }
          if (tag === "select") {
            const select = el;
            const selected = select.selectedOptions?.[0]?.textContent ?? select.value ?? "";
            return normalizeText(selected.slice(0, 200));
          }
          if (el.isContentEditable) {
            return normalizeText((el.textContent ?? "").slice(0, 200));
          }
          return "";
        }
        function hashString(value) {
          let hash = 2166136261;
          for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
          }
          return (hash >>> 0).toString(36);
        }
        function hasFormControlDescendant(el, maxDepth = 2) {
          const queue = [{ element: el, depth: 0 }];
          while (queue.length) {
            const entry = queue.shift();
            if (entry.depth > maxDepth) continue;
            if (entry.element !== el) {
              const tag = entry.element.tagName.toLowerCase();
              if (FORM_TAGS.has(tag) || entry.element.isContentEditable) {
                return true;
              }
            }
            for (const child of Array.from(entry.element.children)) {
              queue.push({ element: child, depth: entry.depth + 1 });
            }
          }
          return false;
        }
        function hasSearchIndicator(el, attrs) {
          const className = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""} ${attrs.dataTestId ?? ""}`;
          return SEARCH_HINTS.test(className) || SEARCH_HINTS.test(attrs.placeholder ?? "") || SEARCH_HINTS.test(attrs.ariaLabel ?? "") || SEARCH_HINTS.test(attrs.name ?? "") || SEARCH_HINTS.test(attrs.role ?? "");
        }
        function assessVisibility(el) {
          try {
            const style = window.getComputedStyle(el);
            const disabled = el.disabled === true || el.getAttribute("disabled") !== null || el.getAttribute("aria-disabled") === "true";
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.getAttribute("aria-hidden") === "true") {
              return {
                state: "hidden",
                disabled,
                pointerEventsNone: style.pointerEvents === "none",
                isScrollable: false,
                rectWidth: 0,
                rectHeight: 0,
                largeEnough: false
              };
            }
            const rect = el.getBoundingClientRect();
            const rectWidth = rect.width;
            const rectHeight = rect.height;
            const tooSmall = rectWidth < 2 || rectHeight < 2;
            const largeEnough = rectWidth >= 8 && rectHeight >= 8;
            const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
            const isScrollable = (el.scrollHeight > el.clientHeight + 8 || el.scrollWidth > el.clientWidth + 8) && rectWidth > 20 && rectHeight > 20;
            return {
              state: tooSmall ? "hidden" : inViewport ? "visible" : "offscreen",
              disabled,
              pointerEventsNone: style.pointerEvents === "none",
              isScrollable,
              rectWidth,
              rectHeight,
              largeEnough
            };
          } catch {
            return {
              state: "visible",
              disabled: false,
              pointerEventsNone: false,
              isScrollable: false,
              rectWidth: 0,
              rectHeight: 0,
              largeEnough: false
            };
          }
        }
        function matchesOwnSelector(el, selector) {
          try {
            return el.matches(selector);
          } catch {
            return false;
          }
        }
        function countSelectorMatches(selector, cache) {
          const cached = cache?.get(selector);
          if (typeof cached === "number") return cached;
          let count = Number.MAX_SAFE_INTEGER;
          try {
            count = document.querySelectorAll(selector).length;
          } catch {
            count = Number.MAX_SAFE_INTEGER;
          }
          cache?.set(selector, count);
          return count;
        }
        function buildPositionalSelector(el) {
          const segments = [];
          let current = el;
          while (current && segments.length < 4 && current !== document.body && current !== document.documentElement) {
            const tag = current.tagName.toLowerCase();
            const parent = current.parentElement;
            if (!parent) {
              segments.unshift(tag);
              break;
            }
            const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
            const index = siblings.indexOf(current) + 1;
            segments.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
            current = parent;
          }
          return segments.join(" > ") || el.tagName.toLowerCase();
        }
        function getRegionSelector(el, cache, shadowHost) {
          if (shadowHost) {
            return getSelector(shadowHost, cache);
          }
          let current = el;
          while (current && current !== document.body && current !== document.documentElement) {
            const tag = current.tagName.toLowerCase();
            const role = normalizeText(current.getAttribute("role"));
            const classLike = `${current.getAttribute("class") ?? ""} ${current.getAttribute("data-testid") ?? ""} ${current.getAttribute("data-test") ?? ""}`;
            if (REGION_TAGS.has(tag) || role === "row" || role === "article" || role === "listitem" || role === "group" || REGION_HINTS.test(classLike) || current.hasAttribute("data-testid") || current.hasAttribute("data-test")) {
              return getSelector(current, cache);
            }
            current = current.parentElement;
          }
          return getSelector(el.parentElement ?? el, cache);
        }
        function getInteractionKind(el, tag, role, wrappedControl) {
          if (el.isContentEditable) return "editable";
          if (tag === "select" || role === "combobox") return "select";
          if (FORM_TAGS.has(tag) || role === "textbox" || role === "searchbox") return "input";
          if (tag === "a" || role === "link") return "link";
          if (TOGGLE_ROLES.has(role ?? "")) return "toggle";
          if (tag === "button" || tag === "summary" || role === "button" || role === "tab" || role === "menuitem" || wrappedControl) {
            return "button";
          }
          return "generic";
        }
        function computeActionabilityScore(visibility, interactionKind) {
          let score = 0;
          if (visibility.state === "visible") score += 62;
          if (visibility.state === "offscreen") score += 26;
          if (visibility.largeEnough) score += 10;
          if (visibility.pointerEventsNone) score -= 24;
          if (visibility.disabled) score -= 32;
          if (visibility.isScrollable && interactionKind !== "generic") score += 4;
          if (interactionKind === "generic") score -= 8;
          return Math.max(0, Math.min(score, 100));
        }
        function deriveConfidence(selectorScore, interactionScore, actionabilityScore, visibility) {
          if (visibility === "visible" && selectorScore >= 78 && interactionScore >= 55 && actionabilityScore >= 55) {
            return "high";
          }
          if (visibility !== "hidden" && selectorScore >= 48 && actionabilityScore >= 34) {
            return "medium";
          }
          return "low";
        }
        function buildNodeId(selector, tag, interactionKind, value) {
          return `n_${hashString(`${selector}|${tag}|${interactionKind}|${value.slice(0, 80)}`)}`;
        }
        function normalizeHashToken(value) {
          return normalizeText(value).toLowerCase().slice(0, 120);
        }
        function normalizeStableClassTokens(className) {
          const tokens = normalizeText(className).split(/\s+/).map((token) => token.toLowerCase()).filter(
            (token) => !!token && token.length >= 2 && !/\d{4,}/.test(token) && !/(^|[-_])(active|hover|focus|selected|open|closed|loading|loaded|enter|leave|anim|motion)($|[-_])/.test(token)
          );
          return tokens.slice(0, 3).join(".");
        }
        function getSiblingOrdinal(el) {
          const parent = el.parentElement;
          if (!parent) return 1;
          const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
          const index = siblings.indexOf(el);
          return index >= 0 ? index + 1 : 1;
        }
        function getStableAncestorPath(el) {
          const segments = [];
          let current = el.parentElement;
          let depth = 0;
          while (current && current !== document.body && current !== document.documentElement && depth < 4) {
            const tag = current.tagName.toLowerCase();
            const role = normalizeHashToken(current.getAttribute("role"));
            const dataTestId = normalizeHashToken(current.getAttribute("data-testid") ?? current.getAttribute("data-test"));
            const id = normalizeHashToken(current.getAttribute("id"));
            const classToken = normalizeStableClassTokens(current.getAttribute("class"));
            const marker = id ? `#${id}` : dataTestId ? `[${dataTestId}]` : classToken ? `.${classToken}` : "";
            segments.unshift(`${tag}${role ? `:${role}` : ""}${marker}`);
            current = current.parentElement;
            depth += 1;
          }
          return segments.join(">");
        }
        function computeStableHash(el, tag, attrs, primaryValue, text, formValue) {
          const role = normalizeHashToken(attrs.role);
          const nameLike = normalizeHashToken(
            attrs.ariaLabel || attrs.placeholder || attrs.name || text || formValue || primaryValue
          );
          const href = normalizeHashToken(attrs.href ? attrs.href.replace(/[?#].*$/, "") : "");
          const attrSignature = [
            normalizeHashToken(attrs.inputType),
            normalizeHashToken(attrs.name),
            normalizeHashToken(attrs.dataTestId),
            href
          ].filter(Boolean).join("|");
          const classSignature = normalizeStableClassTokens(el.getAttribute("class"));
          const ancestorPath = getStableAncestorPath(el);
          const ordinal = getSiblingOrdinal(el);
          const payload = `${tag}|${role}|${nameLike}|${attrSignature}|${classSignature}|${ancestorPath}|${ordinal}`;
          return `sh_${hashString(payload)}`;
        }
        function buildSelectorCandidates(target, cache) {
          const candidates = [];
          const seen = /* @__PURE__ */ new Set();
          const push = (selector, source, baseScore) => {
            if (!selector || seen.has(selector) || !matchesOwnSelector(target, selector)) return;
            const count = countSelectorMatches(selector, cache);
            let score = baseScore;
            if (count === 1) score += 18;
            else if (count === 2) score += 8;
            else if (count <= 5) score += 3;
            else score -= Math.min(22, (count - 5) * 2);
            candidates.push({ selector, source, score });
            seen.add(selector);
          };
          const tag = target.tagName.toLowerCase();
          const id = normalizeText(target.id);
          if (id) push(`#${escapeCssValue(id)}`, "id", 92);
          const dataTestId = normalizeText(target.getAttribute("data-testid"));
          if (dataTestId) push(`[data-testid="${escapeCssValue(dataTestId)}"]`, "testid", 88);
          const dataTest = normalizeText(target.getAttribute("data-test"));
          if (dataTest) push(`[data-test="${escapeCssValue(dataTest)}"]`, "testid", 86);
          const name = normalizeText(target.getAttribute("name"));
          if (name) push(`${tag}[name="${escapeCssValue(name)}"]`, "name", 82);
          const ariaLabel = normalizeText(target.getAttribute("aria-label"));
          if (ariaLabel) push(`${tag}[aria-label="${escapeCssValue(ariaLabel)}"]`, "aria", 76);
          const href = normalizeText(target.getAttribute("href"));
          if (href && tag === "a") push(`a[href="${escapeCssValue(href)}"]`, "href", 74);
          const placeholder = normalizeText(target.getAttribute("placeholder"));
          if (placeholder && FORM_TAGS.has(tag)) push(`${tag}[placeholder="${escapeCssValue(placeholder)}"]`, "placeholder", 66);
          const role = normalizeText(target.getAttribute("role"));
          if (role) push(`${tag}[role="${escapeCssValue(role)}"]`, "role", 58);
          const inputType = normalizeText(target.getAttribute("type"));
          if (inputType && tag === "input") push(`input[type="${escapeCssValue(inputType)}"]`, "type", 52);
          push(buildPositionalSelector(target), "positional", 28);
          candidates.sort((left, right) => right.score - left.score);
          return candidates;
        }
        function getSelector(el, cache, shadowHost) {
          const selectorTarget = shadowHost ?? el;
          const candidates = buildSelectorCandidates(selectorTarget, cache);
          return candidates[0]?.selector ?? selectorTarget.tagName.toLowerCase();
        }
        function getSelectorSource(el, cache, shadowHost) {
          const selectorTarget = shadowHost ?? el;
          const candidates = buildSelectorCandidates(selectorTarget, cache);
          return candidates[0]?.source ?? "positional";
        }
        function getSelectorScore(el, cache, shadowHost) {
          const selectorTarget = shadowHost ?? el;
          const candidates = buildSelectorCandidates(selectorTarget, cache);
          const score = candidates[0]?.score ?? 20;
          return shadowHost ? Math.max(12, score - 24) : score;
        }
        function buildGoalPatterns(goalText) {
          if (!goalText) return null;
          const STOP = /* @__PURE__ */ new Set(["get", "find", "the", "and", "for", "from", "with", "page", "site", "web", "this", "that", "into", "onto", "login", "sign", "bank", "account", "after", "what", "which", "where", "right", "shown", "first", "main", "title"]);
          const words = goalText.toLowerCase().split(/\s+/).filter((word) => word.length >= 4 && !STOP.has(word)).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          if (!words.length) return /password|username|user.?id|otp|search/i;
          return new RegExp(words.join("|"), "i");
        }
        function scoreGoalFit(goalPat, values) {
          if (!goalPat) return 0;
          let score = 0;
          for (const value of values) {
            const normalized = normalizeText(value);
            if (!normalized) continue;
            if (goalPat.test(normalized)) score += normalized.length <= 80 ? 22 : 14;
          }
          return Math.min(score, 36);
        }
        function computeInteractionScore(el, tag, visibility, attrs, text, formValue, interactionKind, wrappedControl, searchIndicator) {
          let score = 0;
          const tabindex = Number(el.getAttribute("tabindex") ?? "");
          const style = window.getComputedStyle(el);
          if (FORM_TAGS.has(tag)) score += 55;
          if (el.isContentEditable) score += 50;
          if (INTERACTIVE_TAGS.has(tag)) score += 36;
          if (wrappedControl) score += 24;
          if (attrs.href) score += 16;
          if (attrs.inputType === "submit" || attrs.inputType === "button" || attrs.inputType === "search") score += 18;
          if (INTERACTIVE_ROLES.has(attrs.role ?? "")) score += 36;
          if (Number.isFinite(tabindex) && tabindex >= 0) score += 16;
          if (el.getAttribute("onclick") || el.getAttribute("onmousedown") || el.getAttribute("onmouseup") || el.getAttribute("onkeydown")) score += 20;
          if (style.cursor === "pointer") score += 16;
          if (searchIndicator) score += 18;
          if (TRIGGER_KW.test(text) || TRIGGER_KW.test(formValue) || TRIGGER_KW.test(attrs.ariaLabel ?? "") || TRIGGER_KW.test(attrs.placeholder ?? "")) {
            score += 18;
          }
          if (visibility.isScrollable && tag !== "body") score += 8;
          if (visibility.state === "offscreen") score -= 10;
          if (visibility.pointerEventsNone) score -= 26;
          if (visibility.disabled) score -= 30;
          if (visibility.state === "hidden") score -= 50;
          if (interactionKind === "generic") score -= 6;
          return Math.max(0, Math.min(score, 100));
        }
        function classifyNode(el, tag, visibility, interactionScore, actionabilityScore, interactionKind, primaryValue, goalScore, text) {
          if (visibility.state === "hidden") return { type: null, rule: null };
          if ((tag === "td" || tag === "th") && primaryValue.length > 0) {
            return { type: "table_cell", rule: "table_cell" };
          }
          if (FORM_TAGS.has(tag) || el.isContentEditable || interactionKind === "input" || interactionKind === "select" || interactionKind === "editable") {
            return { type: "input", rule: "interactive_input" };
          }
          if (visibility.disabled && (INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(el.getAttribute("role") ?? "") || interactionKind !== "generic")) {
            return { type: "trigger", rule: "disabled_interactive_signal" };
          }
          if (interactionScore >= 42 || interactionKind !== "generic" && actionabilityScore >= 38) {
            return { type: "trigger", rule: "interactive_signal" };
          }
          if (NOISE_CLS.test(el.getAttribute("class") ?? "") && text.length <= MIN_TEXT && goalScore === 0) {
            return { type: null, rule: null };
          }
          if (GENERIC_CONTAINER_TAGS.has(tag) && el.childElementCount > 4 && goalScore < 16 && primaryValue.length > 120) {
            return { type: null, rule: null };
          }
          if (primaryValue.length >= MIN_TEXT) {
            return { type: "data", rule: goalScore > 0 ? "goal_relevant_data" : "text_data" };
          }
          return { type: null, rule: null };
        }
        function buildStageNode(el, goalPat, cache, shadowHost, inShadow = false) {
          const tag = el.tagName.toLowerCase();
          if (SKIP_TAGS.has(tag)) return null;
          if (tag === "input" && normalizeText(el.getAttribute("type")) === "hidden") return null;
          const attrs = {
            placeholder: normalizeText(el.getAttribute("placeholder")) || void 0,
            ariaLabel: normalizeText(el.getAttribute("aria-label")) || void 0,
            name: normalizeText(el.getAttribute("name")) || void 0,
            href: normalizeText(el.getAttribute("href")) || void 0,
            inputType: normalizeText(el.getAttribute("type")) || void 0,
            role: normalizeText(el.getAttribute("role")) || void 0,
            dataTestId: normalizeText(el.getAttribute("data-testid") ?? el.getAttribute("data-test")) || void 0
          };
          const text = getElementText(el, tag);
          const formValue = getElementFormValue(el, tag);
          const primaryValue = (text || formValue || attrs.placeholder || attrs.ariaLabel || attrs.name || attrs.href || "").slice(0, 200);
          if (!primaryValue && !attrs.role) return null;
          const visibility = assessVisibility(el);
          const goalScore = scoreGoalFit(goalPat, [
            primaryValue,
            attrs.placeholder,
            attrs.ariaLabel,
            attrs.name,
            attrs.href,
            attrs.role
          ]);
          const wrappedControl = hasFormControlDescendant(el, 2);
          const searchIndicator = hasSearchIndicator(el, attrs);
          const interactionKind = getInteractionKind(el, tag, attrs.role, wrappedControl);
          const interactionScore = computeInteractionScore(el, tag, visibility, attrs, text, formValue, interactionKind, wrappedControl, searchIndicator);
          const actionabilityScore = computeActionabilityScore(visibility, interactionKind);
          const confidence = deriveConfidence(
            getSelectorScore(el, cache, shadowHost),
            interactionScore,
            actionabilityScore,
            visibility.state
          );
          const classification = classifyNode(el, tag, visibility, interactionScore, actionabilityScore, interactionKind, primaryValue, goalScore, text);
          if (!classification.type || !classification.rule) return null;
          const sel = getSelector(el, cache, shadowHost);
          const selType = getSelectorSource(el, cache, shadowHost);
          const selectorScore = getSelectorScore(el, cache, shadowHost);
          const regionSelector = getRegionSelector(el, cache, shadowHost);
          const nth = getSiblingOrdinal(el);
          const stableHash = computeStableHash(el, tag, attrs, primaryValue, text, formValue);
          const totalScore = goalScore * 4 + interactionScore * 2 + actionabilityScore * 2 + selectorScore * 1.5 + (visibility.state === "visible" ? 18 : 6) + (confidence === "high" ? 12 : confidence === "medium" ? 4 : -8) - (inShadow ? 10 : 0) + (classification.type === "input" ? 10 : classification.type === "trigger" ? 8 : 0);
          return {
            type: classification.type,
            tag,
            value: primaryValue,
            sel,
            selType,
            rule: classification.rule,
            attrs,
            meta: {
              nodeId: buildNodeId(sel, tag, interactionKind, primaryValue),
              stableHash,
              nth,
              selectorScore,
              interactionScore,
              actionabilityScore,
              interactionKind,
              confidence,
              enrichmentState: "base",
              visibility: visibility.state,
              goalScore,
              regionSelector,
              disabled: visibility.disabled || void 0,
              shadow: inShadow || void 0,
              role: attrs.role,
              selectorSource: selType
            },
            totalScore
          };
        }
        function pushChildren(container, stack, inShadow, shadowHost) {
          const children = Array.from(container.children);
          for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ element: children[i], inShadow, shadowHost });
          }
        }
        try {
          const origFetch = window.fetch.bind(window);
          window.fetch = async function(...args) {
            const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "unknown";
            const startTs = Date.now();
            addPending({ type: "fetch", detail: url, timestamp: startTs });
            const result = origFetch(...args);
            result.then(() => sampleRTT(url, startTs), () => sampleRTT(url, startTs));
            return result;
          };
        } catch (e) {
          console.warn("[browsegent] fetch hook failed:", e);
        }
        try {
          const OrigXHR = window.XMLHttpRequest;
          const origOpen = OrigXHR.prototype.open;
          const origSend = OrigXHR.prototype.send;
          OrigXHR.prototype.open = function(method, url, ...rest) {
            this._bgUrl = url;
            return origOpen.call(this, method, url, ...rest);
          };
          OrigXHR.prototype.send = function(...args) {
            const url = this._bgUrl ?? "unknown";
            addPending({ type: "xhr", detail: url, timestamp: Date.now() });
            return origSend.apply(this, args);
          };
        } catch (e) {
          console.warn("[browsegent] XHR hook failed:", e);
        }
        try {
          document.addEventListener("click", (e) => {
            const target = e.target;
            if (!target) return;
            addPending({ type: "click", detail: getSelector(target), timestamp: Date.now() });
          }, true);
        } catch (e) {
          console.warn("[browsegent] click hook failed:", e);
        }
        try {
          let scrollDebounce = null;
          window.addEventListener("scroll", () => {
            if (scrollDebounce) clearTimeout(scrollDebounce);
            scrollDebounce = setTimeout(() => {
              addPending({ type: "scroll", detail: `scrollY:${Math.round(window.scrollY)}`, timestamp: Date.now() });
            }, 50);
          }, { passive: true });
        } catch (e) {
          console.warn("[browsegent] scroll hook failed:", e);
        }
        try {
          const origPush = history.pushState.bind(history);
          const origReplace = history.replaceState.bind(history);
          history.pushState = function(...args) {
            origPush(...args);
            window.dispatchEvent(new CustomEvent("browsegent:navigate", { detail: { url: location.href } }));
          };
          history.replaceState = function(...args) {
            origReplace(...args);
            window.dispatchEvent(new CustomEvent("browsegent:navigate", { detail: { url: location.href } }));
          };
          window.addEventListener("popstate", () => {
            window.dispatchEvent(new CustomEvent("browsegent:navigate", { detail: { url: location.href } }));
          });
        } catch (e) {
          console.warn("[browsegent] SPA nav hook failed:", e);
        }
        function buildChain(ts) {
          if (!pageInitComplete) {
            return { initiator: "page-init", transport: null, confidence: "high", windowMs: 0, unknownReason: void 0 };
          }
          const candidates = pending.filter((cause) => ts - cause.timestamp >= 0 && ts - cause.timestamp <= calibratedMax);
          if (!candidates.length) {
            const swActive = !!navigator.serviceWorker?.controller;
            return {
              initiator: "unknown",
              transport: null,
              confidence: "low",
              windowMs: 0,
              unknownReason: swActive ? "service_worker" : "no_pending_causes"
            };
          }
          const click = candidates.find((cause) => cause.type === "click");
          const net = candidates.find((cause) => cause.type === "fetch" || cause.type === "xhr");
          const timer = candidates.find((cause) => cause.type === "timer");
          const scroll = candidates.find((cause) => cause.type === "scroll");
          if (click && net) {
            const windowMs = ts - net.timestamp;
            return {
              initiator: "click",
              initiatorDetail: click.detail,
              transport: net.type,
              transportDetail: net.detail,
              confidence: NOISE_FETCH.test(net.detail) ? "low" : windowMs <= HIGH_WINDOW ? "high" : "medium",
              windowMs
            };
          }
          if (net) {
            const windowMs = ts - net.timestamp;
            return {
              initiator: "unknown",
              transport: net.type,
              transportDetail: net.detail,
              confidence: NOISE_FETCH.test(net.detail) ? "low" : windowMs <= HIGH_WINDOW ? "high" : "medium",
              windowMs
            };
          }
          if (scroll) return { initiator: "scroll", initiatorDetail: scroll.detail, transport: null, confidence: "medium", windowMs: ts - scroll.timestamp };
          if (timer) return { initiator: "timer", initiatorDetail: timer.detail, transport: null, confidence: "medium", windowMs: ts - timer.timestamp };
          if (click) {
            const windowMs = ts - click.timestamp;
            return { initiator: "click", initiatorDetail: click.detail, transport: "direct", confidence: windowMs <= HIGH_WINDOW ? "high" : "medium", windowMs };
          }
          return { initiator: "unknown", transport: null, confidence: "low", windowMs: 0, unknownReason: "timing_gap" };
        }
        function isNoise(chain) {
          return chain.initiator === "page-init" || chain.confidence === "low" && chain.unknownReason !== "service_worker" && NOISE_FETCH.test(chain.transportDetail ?? "") || chain.initiator === "click" && NOISE_CLICK.test(chain.initiatorDetail ?? "");
        }
        try {
          const observeTarget = document.documentElement || document.body;
          if (observeTarget) {
            new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                try {
                  const tag = mutation.target.tagName?.toLowerCase();
                  if (SKIP_TAGS.has(tag)) continue;
                  const now = Date.now();
                  lastMutationTs = now;
                  const chain = buildChain(now);
                  const noise = isNoise(chain);
                  if (mutation.type === "childList") {
                    for (const node of mutation.addedNodes) {
                      const el = node.nodeType === 1 ? node : node.parentElement;
                      if (!el) continue;
                      const value = normalizeText((el.textContent ?? "").slice(0, 200));
                      if (value.length < 3) continue;
                      deltas.push({
                        timestamp: now,
                        nodeSelector: getSelector(el),
                        nodeTag: el.tagName?.toLowerCase(),
                        oldValue: "",
                        newValue: value,
                        mutationType: "added",
                        chain,
                        isNoise: noise
                      });
                      if (deltas.length > MAX_DELTAS) deltas.shift();
                    }
                  }
                  if (mutation.type === "characterData") {
                    const newValue = normalizeText((mutation.target.textContent ?? "").slice(0, 200));
                    const oldValue = normalizeText((mutation.oldValue ?? "").slice(0, 200));
                    if (newValue === oldValue || newValue.length < 2) continue;
                    const parent = mutation.target.parentElement;
                    if (!parent) continue;
                    deltas.push({
                      timestamp: now,
                      nodeSelector: getSelector(parent),
                      nodeTag: parent.tagName?.toLowerCase(),
                      oldValue,
                      newValue,
                      mutationType: "textChanged",
                      chain,
                      isNoise: noise
                    });
                    if (deltas.length > MAX_DELTAS) deltas.shift();
                  }
                } catch {
                }
              }
            }).observe(observeTarget, {
              childList: true,
              subtree: true,
              characterData: true,
              characterDataOldValue: true,
              attributes: true,
              attributeFilter: ["value", "placeholder", "aria-label", "data-price"]
            });
          } else {
            console.warn("[browsegent] No observe target at document_start; mutation observer skipped");
          }
        } catch (e) {
          console.warn("[browsegent] MutationObserver setup failed:", e);
        }
        function brain1Scan(rootEl, goalText) {
          const start = performance.now();
          const stack = [{ element: rootEl, inShadow: false, shadowHost: null }];
          const candidates = [];
          const selectorCache = /* @__PURE__ */ new Map();
          const goalPat = buildGoalPatterns(goalText);
          const rulesTriggered = {};
          const selectorTypes = {};
          const errors = [];
          let walked = 0;
          let shadowDomCount = 0;
          try {
            while (stack.length && walked < MAX_NODES) {
              const entry = stack.pop();
              const el = entry.element;
              if (!el?.tagName) continue;
              walked++;
              const candidate = buildStageNode(el, goalPat, selectorCache, entry.shadowHost, entry.inShadow);
              if (candidate) candidates.push(candidate);
              const shadowRoot = el.shadowRoot;
              if (shadowRoot) {
                shadowDomCount++;
                pushChildren(shadowRoot, stack, true, el);
              }
              pushChildren(el, stack, entry.inShadow, entry.shadowHost);
            }
          } catch (err) {
            errors.push(String(err));
          }
          candidates.sort((left, right) => right.totalScore - left.totalScore);
          const bucketCounts = {
            input: 0,
            trigger: 0,
            data: 0,
            table_cell: 0
          };
          let emitted = 0;
          const nodes = candidates.filter((node) => {
            if (emitted >= MAX_OUTPUT_NODES) return false;
            if (bucketCounts[node.type] >= TYPE_CAPS[node.type]) return false;
            bucketCounts[node.type]++;
            emitted++;
            rulesTriggered[node.rule] = (rulesTriggered[node.rule] ?? 0) + 1;
            selectorTypes[node.selType] = (selectorTypes[node.selType] ?? 0) + 1;
            return true;
          }).map((node) => ({
            type: node.type,
            tag: node.tag,
            value: node.value,
            sel: node.sel,
            selType: node.selType,
            rule: node.rule,
            attrs: node.attrs,
            meta: node.meta
          }));
          return {
            nodes,
            metrics: {
              totalNodesWalked: walked,
              nodesKept: nodes.length,
              nodesDropped: Math.max(0, walked - nodes.length),
              walkTimeMs: performance.now() - start,
              shadowDomCount,
              rulesTriggered,
              selectorTypes
            },
            errors
          };
        }
        window.__browsegent_brain1 = function(rootEl, goalText) {
          return brain1Scan(rootEl ?? document.body, goalText ?? goal);
        };
        window.__browsegent_brain1_region = function(regionSelector, goalText) {
          let regionRoot = null;
          try {
            regionRoot = document.querySelector(regionSelector);
          } catch {
            regionRoot = null;
          }
          return brain1Scan(regionRoot ?? document.body, goalText ?? goal);
        };
        window.__browsegent_brain2 = {
          getDeltas: () => deltas.slice(),
          clearDeltas: () => {
            deltas.length = 0;
          },
          getPending: () => pending.slice(),
          isReady: () => pageInitComplete,
          getCalibration: () => ({ samples: rttSamples, calibratedMax }),
          disconnect: () => {
          },
          recordClick: (selector) => {
            addPending({ type: "click", detail: selector, timestamp: Date.now() });
          },
          getCalibratedMax: () => calibratedMax,
          getRttSamples: () => rttSamples.slice()
        };
        console.log("[browsegent] Content script loaded (MAIN world, document_start)");
      })();
    }
  });
  require_content();
})();
