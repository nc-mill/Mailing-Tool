import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const coreSrc = fileURLToPath(new URL('../../', import.meta.url));
const sdkDir = join(coreSrc, 'ai', 'sdk');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('hranice AI SDK', () => {
  it('mimo src/ai/sdk nikdo neimportuje ai ani @ai-sdk/*', () => {
    const offenders = walk(coreSrc)
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => !file.startsWith(sdkDir))
      .filter((file) => !file.endsWith('boundary.test.ts'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return /from\s+['"](ai|ai\/[a-z]+|@ai-sdk\/[a-z-]+|@openrouter\/ai-sdk-provider)['"]/.test(
          source,
        );
      });
    expect(offenders).toEqual([]);
  });

  it('adaptér vystavuje pět továrních funkcí a pomůcky pro strukturovaný výstup', async () => {
    const sdk = await import('./index');
    expect(typeof sdk.factories.createAnthropic).toBe('function');
    expect(typeof sdk.factories.createOpenAI).toBe('function');
    expect(typeof sdk.factories.createGoogleGenerativeAI).toBe('function');
    expect(typeof sdk.factories.createOpenRouter).toBe('function');
    expect(typeof sdk.factories.createOpenAICompatible).toBe('function');
    expect(typeof sdk.generateStructured).toBe('function');
    expect(typeof sdk.streamConversation).toBe('function');
    expect(typeof sdk.defineTool).toBe('function');
    expect(typeof sdk.isNoObjectGenerated).toBe('function');
    expect(typeof sdk.stopAfterSteps).toBe('function');
  });

  /**
   * Ověřeno proti NAINSTALOVANÉ verzi, ne proti paměti. Kdyby SDK některou
   * pomůcku přejmenovalo, spadne to tady, a ne až na produkci při prvním
   * volání modelu.
   */
  it('pomůcky, na kterých adaptér stojí, v nainstalované verzi existují', async () => {
    const ai = await import('ai');
    expect(typeof ai.generateText).toBe('function');
    expect(typeof ai.streamText).toBe('function');
    expect(typeof ai.tool).toBe('function');
    expect(typeof ai.isStepCount).toBe('function');
    expect(typeof ai.Output.object).toBe('function');
    expect(typeof ai.NoOutputGeneratedError.isInstance).toBe('function');
    expect(typeof ai.NoObjectGeneratedError.isInstance).toBe('function');
  });

  /**
   * `isNoObjectGenerated` musí poznat OBĚ chyby. `generateText` s nastavením
   * `output` hlásí nevalidní výstup jako `NoOutputGeneratedError`; plán se
   * ptal jen na `NoObjectGeneratedError` od zavrženého `generateObject`.
   * Kdyby tenhle test chyběl, opravný pokus v compose.ts by se tiše nespouštěl.
   */
  it('isNoObjectGenerated pozná NoOutputGeneratedError i NoObjectGeneratedError', async () => {
    const ai = await import('ai');
    const { isNoObjectGenerated } = await import('./index');

    expect(isNoObjectGenerated(new ai.NoOutputGeneratedError({ message: 'x' }))).toBe(true);
    expect(
      isNoObjectGenerated(
        new ai.NoObjectGeneratedError({
          message: 'x',
          text: '{}',
          finishReason: 'stop',
          response: { id: 'r1', timestamp: new Date(0), modelId: 'm' },
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            inputTokenDetails: {},
            outputTokenDetails: {},
          } as never,
        }),
      ),
    ).toBe(true);
    expect(isNoObjectGenerated(new Error('něco jiného'))).toBe(false);
  });

  /** `tool()` je v v7 v podstatě identita kvůli odvození typů; drží se `inputSchema`. */
  it('defineTool nechá definici nástroje beze změny a bere inputSchema', async () => {
    const { z } = await import('zod');
    const { defineTool } = await import('./index');
    const definition = {
      description: 'test',
      inputSchema: z.object({ a: z.string() }),
      execute: async () => ({ ok: true }),
    };
    const defined = defineTool(definition);
    expect(defined.description).toBe('test');
    expect(defined.inputSchema).toBe(definition.inputSchema);
  });
});
