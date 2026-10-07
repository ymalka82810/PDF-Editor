/** טעינת כל הכלים מ-src/tools/<name>/index.ts ורישום התרגומים שלהם */

import { addLocale } from '../core/i18n';
import { registry, type Tool } from '../core/registry';

const modules = import.meta.glob<{ default: Tool | Tool[] }>('../tools/*/index.ts', { eager: true });

export function loadTools() {
  for (const path of Object.keys(modules).sort()) {
    const tools = modules[path].default;
    for (const tool of Array.isArray(tools) ? tools : [tools]) {
      registry.register(tool);
      if (tool.locales) addLocale(tool.id, tool.locales);
    }
  }
}
