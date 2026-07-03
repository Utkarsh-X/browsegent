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
