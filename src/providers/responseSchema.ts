export function buildPlanStepJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      tool: {
        type: 'string',
        enum: [
          'click',
          'fill',
          'hover',
          'scroll',
          'navigate',
          'keyPress',
          'wait',
          'select',
          'focus',
          'check',
          'uncheck',
          'readPage',
          'solveCaptcha',
        ],
      },
      sel: { type: 'string' },
      text: { type: 'string' },
      value: { type: 'string' },
      direction: { type: 'string', enum: ['up', 'down'] },
      amount: { type: 'number' },
      url: { type: 'string' },
      key: { type: 'string' },
      pattern: { type: 'string' },
      timeout: { type: 'number' },
    },
    required: ['tool'],
  };
}

export function buildGeminiResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      plan: {
        type: 'array',
        items: buildPlanStepJsonSchema(),
      },
      done: { type: 'boolean' },
      val: { type: 'string' },
      escalate: { type: 'string', enum: ['user_needed', 'captcha', 'dead_end'] },
      reason: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  };
}
