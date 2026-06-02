import type { V2Ref, V2RefCapabilities } from './types';

const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'email',
  'url',
  'tel',
  'number',
  'password',
]);
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);
const CLICKABLE_ROLES = new Set(['button', 'link', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'tab']);

export function deriveRefCapabilities(ref: Pick<V2Ref,
  'tagName' | 'inputType' | 'role' | 'name' | 'text' | 'isContentEditable' | 'editableKind' | 'ariaAutocomplete' | 'ariaHasPopup'
>): V2RefCapabilities {
  const tagName = normalize(ref.tagName);
  const inputType = normalize(ref.inputType);
  const role = normalize(ref.role);
  const autocomplete = normalize(ref.ariaAutocomplete);
  const hasPopup = normalize(ref.ariaHasPopup);
  const contentEditable = ref.isContentEditable === true || ref.editableKind === 'contenteditable';

  const nativeTextInput = tagName === 'textarea'
    || (tagName === 'input' && TEXT_INPUT_TYPES.has(inputType));
  const nativeButtonInput = tagName === 'button'
    || (tagName === 'input' && BUTTON_INPUT_TYPES.has(inputType));
  const nativeSelect = tagName === 'select';
  const searchableCombobox = role === 'combobox'
    && (autocomplete === 'list' || autocomplete === 'both' || autocomplete === 'inline' || nativeTextInput);
  const selectLikeCombobox = role === 'combobox'
    && !searchableCombobox
    && (hasPopup === 'listbox' || nativeSelect || tagName === '');

  const typeable = nativeTextInput
    || contentEditable
    || role === 'textbox'
    || role === 'searchbox'
    || searchableCombobox;
  const selectable = nativeSelect
    || role === 'listbox'
    || selectLikeCombobox;
  const clickable = nativeButtonInput
    || tagName === 'a'
    || nativeSelect
    || searchableCombobox
    || selectLikeCombobox
    || CLICKABLE_ROLES.has(role);
  const readable = Boolean(ref.name?.trim() || ref.text?.trim() || typeable || clickable || selectable);

  return { clickable, typeable, selectable, readable };
}

function normalize(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}
