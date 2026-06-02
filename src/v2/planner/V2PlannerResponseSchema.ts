export function buildV2PlannerResponseSchema(): Record<string, unknown> {
  const plannerStepSchema = {
    type: 'object',
    properties: {
      tool: {
        type: 'string',
        enum: [
          'click',
          'type',
          'navigate',
          'scroll',
          'wait',
          'press',
          'get',
          'close',
          'select',
          'search_page',
          'find_elements',
          'count_elements',
          'inspect_region',
        ],
      },
      ref: { type: 'string' },
      text: { type: 'string' },
      value: { type: 'string' },
      url: { type: 'string' },
      direction: { type: 'string', enum: ['down', 'up'] },
      timeout: { type: 'number' },
      pattern: { type: 'string' },
      key: { type: 'string', enum: ['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp'] },
    },
    required: ['tool'],
  };

  return {
    type: 'object',
    properties: {
      plan: {
        type: 'array',
        items: plannerStepSchema,
      },
      done: { type: 'boolean' },
      val: { type: 'string' },
      escalate: { type: 'string', enum: ['user_needed', 'captcha', 'dead_end'] },
      reason: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  };
}
