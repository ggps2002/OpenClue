import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { env } from '../config/env';

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}

interface JsonRequest<T> {
  system: string;
  prompt: string;
  /** JSON Schema sent to the API as the output format. */
  jsonSchema: Record<string, unknown>;
  /** Zod schema the parsed response must satisfy. */
  schema: z.ZodType<T>;
  maxTokens?: number;
}

/**
 * Claude access for scripts, docs, translation and planning. Callers check `isOnline` and produce
 * their own deterministic placeholder output when it is false (no API key, or tests).
 */
export class ClaudeClient {
  private readonly client: Anthropic | null;

  constructor(
    apiKey: string | undefined = env.anthropicApiKey,
    readonly model: string = env.AI_MODEL,
  ) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  get isOnline(): boolean {
    return this.client !== null;
  }

  /** Asks Claude for JSON matching `jsonSchema` (structured outputs) and validates it with `schema`. */
  async generateJson<T>({ system, prompt, jsonSchema, schema, maxTokens = 16000 }: JsonRequest<T>): Promise<T> {
    if (!this.client) throw new AiError('Claude is not configured (offline mode)');
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema: jsonSchema } },
    });
    if (response.stop_reason === 'refusal') throw new AiError('Claude declined this request');
    if (response.stop_reason === 'max_tokens') throw new AiError('Claude ran out of room before finishing');
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AiError('Claude returned invalid JSON');
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new AiError('Claude returned JSON in an unexpected shape');
    return parsed.data;
  }
}
