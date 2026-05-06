// _shared/agents/schema-validator.ts
// Lightweight JSON schema validation for stage outputs.

import JSON5 from "https://esm.sh/json5@2.2.3";

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  errors?: string[];
}

export function parseJSONStrict(raw: string): unknown {
  // Strip code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON5.parse(cleaned);
  }
}

export function validate<T>(
  raw: string,
  required: Array<keyof T>,
): ValidationResult<T> {
  let parsed: any;
  try {
    parsed = parseJSONStrict(raw);
  } catch (err) {
    return { ok: false, errors: [`JSON parse failed: ${(err as Error).message}`] };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errors: ['Output is not an object'] };
  }
  const missing = required.filter((k) => !(k in parsed) || parsed[k as string] === undefined || parsed[k as string] === null);
  if (missing.length > 0) {
    return { ok: false, errors: [`Missing required fields: ${missing.join(', ')}`] };
  }
  return { ok: true, data: parsed as T };
}

export async function callWithSchemaRetry<T>(
  llmFn: () => Promise<string>,
  required: Array<keyof T>,
  stageName: string,
  maxRetries = 2,
): Promise<T> {
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await llmFn();
    const result = validate<T>(raw, required);
    if (result.ok && result.data) return result.data;
    lastError = (result.errors || []).join('; ');
    console.warn(`[${stageName}] schema validation failed (attempt ${attempt + 1}): ${lastError}`);
  }
  throw new Error(`[${stageName}] schema validation failed after ${maxRetries + 1} attempts: ${lastError}`);
}
