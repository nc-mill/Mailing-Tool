export type JobStatus =
  'running' | 'paused' | 'completed' | 'completedWithErrors' | 'failed' | 'cancelled';

/**
 * Popisky ODZNAKU V HLAVIČCE. Dřív jich bylo dvanáct, protože týž objekt
 * bral i `JobsCenter`, tedy seznam úloh kreslený jako karty. Ten 7. 8. zanikl:
 * seznam se kreslí `DataTable` jako všechny ostatní seznamy v produktu, takže
 * druhý způsob, jak se v aplikaci kreslí seznam, přestal existovat a s ním
 * i deset popisků, které ho obsluhovaly.
 */
export type JobsLabels = {
  title: string;
  runningCount: (count: number) => string;
};

/**
 * DVA POJMY, NE JEDEN. Doslova `UNFINISHED_JOB_STATUSES` a `RUNNING_JOB_STATUSES`
 * z `packages/core/src/platform/jobs/registry.ts`; zdůvodnění je tam.
 *
 * `UNFINISHED` dělí seznam na rozdělanou práci a historii, takže `paused` sem
 * patří. `RUNNING` říká, na čem se právě pracuje, a rozsvěcí odznak v hlavičce;
 * `paused` sem nepatří, protože pozastavená úloha čeká na člověka a odznak by
 * u ní svítil klidně navždy.
 */
export const UNFINISHED_STATUSES: JobStatus[] = ['running', 'paused'];
export const RUNNING_STATUSES: JobStatus[] = ['running'];
