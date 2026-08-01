import { DateTime } from 'luxon';
import { SCHEDULE_MAX_AHEAD_DAYS, SCHEDULE_MIN_LEAD_MINUTES } from '../constants';

/**
 * scheduled_at je absolutni okamzik v UTC, schedule_timezone je IANA zona, ve ktere
 * uzivatel cas zadal. Oboji se uklada: pro spusteni staci scheduled_at, pro zobrazeni
 * a opakovanou editaci je potreba vedet, v jake zone uzivatel myslel "v 9 rano".
 * Bez toho by se pri zmene letniho casu posunul cas, ktery uzivatel videl.
 */
export type ScheduleValidation =
  | { ok: true; at: Date; timezone: string; localHour: number }
  | {
      ok: false;
      code: 'campaign_schedule_too_soon' | 'campaign_schedule_too_far' | 'validation_failed';
      detail: string;
    };

export function truncateToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

export function validateSchedule(input: {
  at: Date;
  timezone: string;
  now: Date;
}): ScheduleValidation {
  const dt = DateTime.fromJSDate(input.at, { zone: input.timezone });
  if (!dt.isValid) {
    return {
      ok: false,
      code: 'validation_failed',
      detail: `Neznámá časová zóna ${input.timezone}.`,
    };
  }
  const at = truncateToMinute(input.at);
  const leadMs = at.getTime() - input.now.getTime();

  if (leadMs < SCHEDULE_MIN_LEAD_MINUTES * 60_000) {
    return {
      ok: false,
      code: 'campaign_schedule_too_soon',
      detail: `Naplánovat lze nejdříve za ${SCHEDULE_MIN_LEAD_MINUTES} minut.`,
    };
  }
  if (leadMs > SCHEDULE_MAX_AHEAD_DAYS * 24 * 3_600_000) {
    return {
      ok: false,
      code: 'campaign_schedule_too_far',
      detail: `Naplánovat lze nejdále na ${SCHEDULE_MAX_AHEAD_DAYS} dní dopředu.`,
    };
  }
  return { ok: true, at, timezone: input.timezone, localHour: dt.hour };
}

export function isCatchupWindow(input: {
  scheduledAt: Date;
  now: Date;
  catchupHours: number;
}): boolean {
  const age = input.now.getTime() - input.scheduledAt.getTime();
  return age >= 0 && age <= input.catchupHours * 3_600_000;
}

/**
 * Ve stavu scheduled je obsah ZAMCENY. Jinak by se stalo, ze kampan odesla s obsahem,
 * ktery nikdo nikdy nevidel v nahledu. Uzivatel musi nejdriv unschedule, upravit
 * a naplanovat znovu.
 */
export const EDITABLE_WHILE_SCHEDULED = ['name', 'scheduled_at', 'schedule_timezone'] as const;
