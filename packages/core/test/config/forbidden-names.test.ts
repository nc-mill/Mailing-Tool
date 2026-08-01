import { describe, expect, it } from 'vitest';
import { AI_PROVIDER_ENV_EXCEPTIONS, aiKeyVariablesPresent } from '../../src/config/ai-keys';
import { configVariableNames } from '../../src/config/schema';

describe('zákazy v názvech konfiguračních proměnných', () => {
  it('žádná proměnná nekončí na _API_KEY (kritérium 7c)', () => {
    const offenders = configVariableNames().filter((name) => name.endsWith('_API_KEY'));
    expect(offenders, 'entrypoint takové proměnné maže, konfigurace by tím zmizela').toEqual([]);
  });

  it('žádná proměnná neobsahuje license ani telemetry (železné pravidlo 4)', () => {
    const offenders = configVariableNames().filter((name) =>
      /license|telemetry|phone_home/i.test(name),
    );
    expect(offenders).toEqual([]);
  });

  it('detekuje ponechaný klíč AI providera v prostředí', () => {
    expect(aiKeyVariablesPresent({ ANTHROPIC_API_KEY: 'sk-test' })).toEqual(['ANTHROPIC_API_KEY']);
    expect(aiKeyVariablesPresent({ OPENAI_API_KEY: 'x', HF_TOKEN: 'y' }).sort()).toEqual([
      'HF_TOKEN',
      'OPENAI_API_KEY',
    ]);
    expect(aiKeyVariablesPresent({ SECRET_KEY: 'x', S3_ACCESS_KEY_ID: 'y' })).toEqual([]);
  });

  it('výčet výjimek odpovídá tabulce z části 1, kapitoly 3.12', () => {
    expect([...AI_PROVIDER_ENV_EXCEPTIONS].sort()).toEqual([
      'AWS_BEARER_TOKEN_BEDROCK',
      'AZURE_OPENAI_ENDPOINT',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'GOOGLE_GENAI_USE_VERTEXAI',
      'HF_TOKEN',
      'OLLAMA_HOST',
    ]);
  });
});
