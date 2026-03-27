// Tool System — maps plan steps to browser actions
import { logger } from '../logger';
import * as actions from './actions';
import type { PlanStep } from '../agent/llm';
import type { ActionContext } from './actions';

export type ToolResult = {
  success: boolean;
  value?: string;
  error?: string;
};

export class ToolSystem {
  constructor(private ctx: ActionContext) {}

  async execute(step: PlanStep): Promise<ToolResult> {
    logger.info('executor:toolSystem', `Executing: ${step.tool}`, {
      sel: step.sel,
      text: step.text?.slice(0, 30),
    });

    try {
      switch (step.tool) {
        case 'click': {
          if (!step.sel) return { success: false, error: 'click requires sel' };
          const r = await actions.doClick(step.sel, this.ctx);
          return { success: r === 'ok', error: r !== 'ok' ? r : undefined };
        }
        case 'type': {
          if (!step.sel || step.text === undefined) return { success: false, error: 'type requires sel and text' };
          const r = await actions.doType(step.sel, step.text, this.ctx);
          return { success: r === 'ok', error: r !== 'ok' ? r : undefined };
        }
        case 'scroll': {
          const r = await actions.doScroll(step.direction ?? 'down', this.ctx);
          return { success: r === 'ok', error: r !== 'ok' ? r : undefined };
        }
        case 'wait': {
          await new Promise(r => setTimeout(r, step.timeout ?? 2000));
          return { success: true };
        }
        case 'get': {
          if (!step.sel) return { success: false, error: 'get requires sel' };
          const value = await actions.doGetValue(step.sel, this.ctx);
          return { success: true, value };
        }
        case 'close': {
          if (!step.sel) return { success: false, error: 'close requires sel' };
          const r = await actions.doCloseModal(step.sel, this.ctx);
          return { success: r === 'ok', error: r !== 'ok' ? r : undefined };
        }
        case 'select': {
          if (!step.sel || !step.value) return { success: false, error: 'select requires sel and value' };
          const r = await actions.doSelectOption(step.sel, step.value, this.ctx);
          return { success: r === 'ok', error: r !== 'ok' ? r : undefined };
        }
        default:
          return { success: false, error: `Unknown tool: ${(step as PlanStep).tool}` };
      }
    } catch (err) {
      logger.error('executor:toolSystem', `Tool crashed: ${step.tool}`, err);
      return { success: false, error: String(err) };
    }
  }
}
