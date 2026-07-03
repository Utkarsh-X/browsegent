import type { ElementHandle } from 'playwright';

// ── Verdict types ───────────────────────────────────────────

export type SemanticRelation =
  | 'descendant'
  | 'ancestor'
  | 'label_control'
  | 'shadow_host'
  | 'shadow_content';

export interface BlockerDiagnostic {
  description: string;
  tagName: string;
  id?: string;
  classList?: string[];
  anchorDescription?: string;
  isFixedOrSticky: boolean;
  coversFullViewport: boolean;
  isTransparent: boolean;
  isNativeDialog: boolean;
}

export type HitTestVerdict =
  | { outcome: 'clear_target' }
  | { outcome: 'semantic_relation'; relation: SemanticRelation }
  | { outcome: 'soft_ambiguity'; reason: string; clearPosition?: { x: number; y: number } }
  | { outcome: 'hard_blocker'; blocker: BlockerDiagnostic }
  | { outcome: 'zero_size_or_hidden'; detail: string };

export interface HitTestResult {
  verdict: HitTestVerdict;
  position?: { x: number; y: number };
}

// ── Pure classification (testable without browser) ──────────

export interface ClassifyHitInput {
  hit: string | null;
  targetElement: string;
  hitIsDescendantOfTarget: boolean;
  targetIsDescendantOfHit: boolean;
  hitLabelControlsTarget: boolean;
  targetLabelContainsHit: boolean;
  hitOpacity: string;
}

export type ClassifyHitOutput =
  | { outcome: 'clear_target' }
  | { outcome: 'semantic_relation'; relation: SemanticRelation }
  | { outcome: 'soft_ambiguity_transparent_blocker'; reason: string }
  | null; // null = unrelated element (potential blocker)

export function classifyHitResult(input: ClassifyHitInput): ClassifyHitOutput {
  if (input.hit === null || input.hit === input.targetElement) {
    return { outcome: 'clear_target' };
  }

  if (input.hitIsDescendantOfTarget) {
    return { outcome: 'semantic_relation', relation: 'descendant' };
  }

  if (input.targetIsDescendantOfHit) {
    return { outcome: 'semantic_relation', relation: 'ancestor' };
  }

  if (input.hitLabelControlsTarget || input.targetLabelContainsHit) {
    return { outcome: 'semantic_relation', relation: 'label_control' };
  }

  if (input.hitOpacity === '0') {
    return { outcome: 'soft_ambiguity_transparent_blocker', reason: 'Hit element has opacity:0' };
  }

  return null;
}

// ── Blocker diagnostic builder (testable without browser) ───

export interface BuildBlockerDiagnosticInput {
  tagName: string;
  id: string;
  className: string;
  position: string;
  opacity: string;
  isDialog: boolean;
  viewportWidth: number;
  viewportHeight: number;
  blockerWidth: number;
  blockerHeight: number;
  anchorId: string | undefined;
  anchorTag: string | undefined;
}

export function buildBlockerDiagnostic(input: BuildBlockerDiagnosticInput): BlockerDiagnostic {
  const tag = input.tagName.toLowerCase();
  let description = tag;
  if (input.id) {
    description += `#${input.id}`;
  } else if (input.className.trim()) {
    const classes = input.className.trim().split(/\s+/).slice(0, 2);
    description += '.' + classes.join('.');
  }

  const classList = input.className.trim()
    ? input.className.trim().split(/\s+/).slice(0, 3)
    : undefined;

  let anchorDescription: string | undefined;
  if (!input.id && input.anchorId && input.anchorTag) {
    anchorDescription = `${input.anchorTag.toLowerCase()}#${input.anchorId}`;
  }

  return {
    description,
    tagName: tag,
    id: input.id || undefined,
    classList,
    anchorDescription,
    isFixedOrSticky: input.position === 'fixed' || input.position === 'sticky',
    coversFullViewport: input.blockerWidth >= input.viewportWidth * 0.9
                     && input.blockerHeight >= input.viewportHeight * 0.9,
    isTransparent: input.opacity === '0',
    isNativeDialog: input.isDialog,
  };
}

// ── Browser-side hit-test ───────────────────────────────────

export async function semanticHitTest(target: ElementHandle): Promise<HitTestResult> {
  const raw = await target.evaluate((element) => {
    const targetElement = element as Element;
    const rect = targetElement.getBoundingClientRect();

    // 1. Zero-size / hidden check
    if (rect.width <= 0 || rect.height <= 0) {
      const style = window.getComputedStyle(targetElement);
      return {
        verdict: {
          outcome: 'zero_size_or_hidden' as const,
          detail: style.display === 'none' ? 'Element has display:none'
            : style.visibility === 'hidden' ? 'Element has visibility:hidden'
            : `Element has zero dimensions (${rect.width}x${rect.height})`,
        },
      };
    }

    // 2. Candidate positions (7-point grid)
    const insetX = Math.min(8, Math.max(1, rect.width / 4));
    const insetY = Math.min(8, Math.max(1, rect.height / 4));
    const candidates = [
      { x: rect.width / 2, y: rect.height / 2 },
      { x: insetX, y: insetY },
      { x: rect.width - insetX, y: insetY },
      { x: insetX, y: rect.height - insetY },
      { x: rect.width - insetX, y: rect.height - insetY },
      { x: rect.width * 0.25, y: rect.height / 2 },
      { x: rect.width * 0.75, y: rect.height / 2 },
    ];

    // Shadow-including ancestor walk
    const helpers = {
      up(n: Node): Node | null {
        return n.parentNode
          || (n as unknown as { host?: Node }).host
          || (n.getRootNode && (n.getRootNode() as unknown as { host?: Node }).host)
          || null;
      },
      isDescendantOf(child: Node, ancestor: Node): boolean {
        for (let n: Node | null = child; n; n = this.up(n)) {
          if (n === ancestor) return true;
        }
        return false;
      },
      checkLabelControl(hit: Element, tgt: Element): boolean {
        const hitLabel = hit.closest ? hit.closest('label') : null;
        if (hitLabel && ((hitLabel as HTMLLabelElement).control === tgt || hitLabel.contains(tgt))) {
          return true;
        }
        const targetLabel = tgt.closest ? tgt.closest('label') : null;
        if (targetLabel && targetLabel.contains(hit)) {
          return true;
        }
        return false;
      },
      classifyHit(hit: Element | null, tgt: Element): { outcome: 'clear_target' | 'semantic_relation' | 'soft_ambiguity' | 'blocker'; relation?: string; reason?: string } {
        if (!hit || hit === tgt) return { outcome: 'clear_target' };

        if (this.isDescendantOf(hit, tgt)) {
          return { outcome: 'semantic_relation', relation: 'descendant' };
        }
        if (this.isDescendantOf(tgt, hit)) {
          return { outcome: 'semantic_relation', relation: 'ancestor' };
        }
        if (this.checkLabelControl(hit, tgt)) {
          return { outcome: 'semantic_relation', relation: 'label_control' };
        }

        const hitStyle = window.getComputedStyle(hit);
        if (hitStyle.opacity === '0') {
          return { outcome: 'soft_ambiguity', reason: 'Hit element has opacity:0' };
        }

        return { outcome: 'blocker' };
      }
    };

    // 3. Probe all candidate positions
    let bestClearPosition: { x: number; y: number } | undefined;
    let bestRelation: { result: { outcome: 'clear_target' | 'semantic_relation' | 'soft_ambiguity' | 'blocker'; relation?: string; reason?: string }; position: { x: number; y: number } } | undefined;
    let bestSoftAmbiguity: { result: { outcome: 'clear_target' | 'semantic_relation' | 'soft_ambiguity' | 'blocker'; relation?: string; reason?: string }; position: { x: number; y: number } } | undefined;
    let lastBlockerHit: Element | undefined;

    for (const candidate of candidates) {
      const vx = Math.max(0, Math.min(window.innerWidth - 1, rect.left + candidate.x));
      const vy = Math.max(0, Math.min(window.innerHeight - 1, rect.top + candidate.y));
      const hit = document.elementFromPoint(vx, vy);
      const probe = helpers.classifyHit(hit, targetElement);
      const position = {
        x: Math.max(0, Math.min(rect.width, vx - rect.left)),
        y: Math.max(0, Math.min(rect.height, vy - rect.top)),
      };

      if (probe.outcome === 'clear_target') {
        if (!bestClearPosition) bestClearPosition = position;
      } else if (probe.outcome === 'semantic_relation' && !bestRelation) {
        bestRelation = { result: probe, position };
      } else if (probe.outcome === 'soft_ambiguity' && !bestSoftAmbiguity) {
        bestSoftAmbiguity = { result: probe, position };
      } else if (probe.outcome === 'blocker' && hit) {
        lastBlockerHit = hit;
      }
    }

    // 4. Return best result in priority order
    if (bestClearPosition) {
      return { verdict: { outcome: 'clear_target' as const }, position: bestClearPosition };
    }
    if (bestRelation) {
      return {
        verdict: {
          outcome: 'semantic_relation' as const,
          relation: bestRelation.result.relation!,
        },
        position: bestRelation.position,
      };
    }
    if (bestSoftAmbiguity) {
      return {
        verdict: {
          outcome: 'soft_ambiguity' as const,
          reason: bestSoftAmbiguity.result.reason!,
        },
        position: bestSoftAmbiguity.position,
      };
    }

    // 5. All points blocked → build diagnostic
    if (lastBlockerHit) {
      const style = window.getComputedStyle(lastBlockerHit);
      const bRect = lastBlockerHit.getBoundingClientRect();
      let desc = lastBlockerHit.tagName.toLowerCase();
      if (lastBlockerHit.id) {
        desc += '#' + lastBlockerHit.id;
      } else if (typeof lastBlockerHit.className === 'string' && lastBlockerHit.className.trim()) {
        desc += '.' + lastBlockerHit.className.trim().split(/\s+/).slice(0, 2).join('.');
      }

      let anchorDescription: string | undefined;
      if (!lastBlockerHit.id && lastBlockerHit.closest) {
        const anchored = lastBlockerHit.closest('[id]');
        if (anchored && anchored !== lastBlockerHit) {
          anchorDescription = anchored.tagName.toLowerCase() + '#' + anchored.id;
        }
      }

      return {
        verdict: {
          outcome: 'hard_blocker' as const,
          blocker: {
            description: desc,
            tagName: lastBlockerHit.tagName.toLowerCase(),
            id: lastBlockerHit.id || undefined,
            classList: lastBlockerHit.className
              ? String(lastBlockerHit.className).trim().split(/\s+/).slice(0, 3) : undefined,
            anchorDescription,
            isFixedOrSticky: style.position === 'fixed' || style.position === 'sticky',
            coversFullViewport: bRect.width >= window.innerWidth * 0.9
                             && bRect.height >= window.innerHeight * 0.9,
            isTransparent: style.opacity === '0',
            isNativeDialog: lastBlockerHit.tagName === 'DIALOG',
          },
        },
      };
    }

    return {
      verdict: {
        outcome: 'zero_size_or_hidden' as const,
        detail: 'No hit element found at any probe point',
      },
    };
  }) as HitTestResult;

  return raw;
}
