/**
 * Odlozeny start je SKUTECNE undo: kampan se materializuje ihned, ale sender ji
 * nezacne odbavovat driv nez v release_at. Realizuje se jedinym sloupcem v outboxu
 * (next_attempt_at), zadna nova logika, a claim dotaz kontraktu uz podminku
 * next_attempt_at <= now() obsahuje, takze sender se nemeni vubec.
 *
 * Zdvodneni vychozi minuty: nejcastejsi chyba neni spatne publikum (to uzivatel vidi
 * v preflightu), ale preklep v predmetu, ktery si precte az v okamziku, kdy zmackne
 * Odeslat. Sedesat sekund tuhle chybu zachyti a zpozdi kampan zanedbatelne.
 *
 * Zastaveni rozjete kampane je NECO JINEHO: to je pause nebo cancel a UI o tom nikdy
 * nemluvi jako o vraceni, protoze odeslany mail vratit nejde.
 */
export function resolveUndoWindow(
  settings: { undo_window_seconds?: number },
  limits: { CAMPAIGN_UNDO_WINDOW_SECONDS: number },
): number {
  const wanted = settings.undo_window_seconds ?? limits.CAMPAIGN_UNDO_WINDOW_SECONDS;
  return Math.max(0, Math.min(wanted, limits.CAMPAIGN_UNDO_WINDOW_SECONDS));
}

export function computeReleaseAt(audienceBuiltAt: Date, windowSeconds: number): Date | null {
  if (windowSeconds <= 0) return null;
  return new Date(audienceBuiltAt.getTime() + windowSeconds * 1000);
}

export type UndoState =
  | { canUndo: true; remainingSeconds: number }
  | { canUndo: false; reason: 'campaign_undo_window_expired'; remainingSeconds: 0 };

export function undoState(input: {
  sentCount: number;
  releaseAt: Date | null;
  now: Date;
}): UndoState {
  if (!input.releaseAt || input.sentCount > 0 || input.now >= input.releaseAt) {
    return { canUndo: false, reason: 'campaign_undo_window_expired', remainingSeconds: 0 };
  }
  return {
    canUndo: true,
    remainingSeconds: Math.ceil((input.releaseAt.getTime() - input.now.getTime()) / 1000),
  };
}
