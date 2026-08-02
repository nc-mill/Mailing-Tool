import { defineAuditActions } from '../audit/action';

/**
 * Auditní akce domény AI. Podle 3.7 si každá doména vlastní názvy sama;
 * sdílený union by byl sdílený soubor a konflikt v každém plánu.
 *
 * Hodnota klíče se do metadat nikdy nedostane, ani redigovaná. Do auditu jde
 * jen provider a jmenovka.
 */
export const AI_AUDIT = defineAuditActions([
  'ai_credential.created',
  'ai_credential.deleted',
  'ai_credential.tested',
  'ai_credential.default_changed',
]);
