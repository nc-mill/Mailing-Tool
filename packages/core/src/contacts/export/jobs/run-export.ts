import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { stringify } from 'csv-stringify';
import iconv from 'iconv-lite';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../../../config/index';
import { createSystemContext } from '../../../identity/context';
import type { WorkspaceContext } from '../../../identity/types';
import { compileAudienceToSql, type Audience } from '../../../segments/repo';
import { toSql } from '../../../segments/compile/params';
import { inWorkspaceTx } from '../../import/db';
import { guardCsvCell } from '../csv-injection';
import { COLUMN_SQL, TAGS_COLUMN_SQL, isFixedColumn } from '../columns';
import { loadExport } from '../service';

export type ExportJobPayload = { workspaceId: string; exportId: string };

const FETCH_SIZE = 5000;

/**
 * Kurzor na serveru, dávky 5 000 řádků, výstup se zapisuje proudem a gzipuje.
 * Nikdy se nenačítá celý výsledek do paměti, protože export pěti milionů
 * kontaktů by jinak spolkl gigabajty.
 */
export const handler = async (job: {
  data: ExportJobPayload;
}): Promise<{ rowCount: number; warnings: string[] }> => {
  const ctx: WorkspaceContext = createSystemContext(job.data.workspaceId, 'contacts.export');
  const row = await loadExport(ctx, job.data.exportId);
  const storageKey = join('exports', ctx.workspaceId, `${job.data.exportId}.csv.gz`);
  const target = join(loadConfig().DATA_DIR, storageKey);
  await mkdir(dirname(target), { recursive: true });

  const compiled = await compileAudienceToSql(ctx, row.filter as Audience, {
    alias: 'a',
    paramOffset: 0,
    asOf: new Date(),
    timezone: 'Europe/Prague',
  });

  const columns = row.columns;
  const selected = columns.filter((c) => isFixedColumn(c)).map((c) => `${COLUMN_SQL[c]} AS "${c}"`);
  if (columns.includes('tags')) selected.push(`${TAGS_COLUMN_SQL} AS "tags"`);
  if (selected.length === 0) selected.push(`${COLUMN_SQL.email} AS "email"`);
  const query = `SELECT ${selected.join(', ')} FROM contacts c WHERE c.id IN (${compiled.sql})`;

  let rowCount = 0;
  let lost = false;

  await inWorkspaceTx(ctx, async (tx) => {
    await tx.execute(
      toSql(`DECLARE mlain_export_cursor NO SCROLL CURSOR FOR ${query}`, compiled.params),
    );

    const stringifier = stringify({
      header: true,
      columns,
      delimiter: row.delimiter,
      cast: { string: (v: string) => guardCsvCell(v) },
    });
    // BOM patří DOVNITŘ gzipu, ne před něj. Kdyby se zapsal rovnou do souboru,
    // vznikl by soubor začínající třemi bajty a teprve pak gzip hlavičkou,
    // takže by ho žádný rozbalovač nepřečetl: `gunzip` hlásí „incorrect header
    // check" a uživatel by si stáhl něco, co nejde otevřít.
    let bomPending = row.encoding === 'utf-8-bom';
    const encode = new Transform({
      transform(chunk: Buffer, _enc, done) {
        const text = chunk.toString('utf8');
        let encoded =
          row.encoding === 'windows-1250'
            ? iconv.encode(text, 'windows-1250')
            : Buffer.from(text, 'utf8');
        if (bomPending) {
          bomPending = false;
          encoded = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded]);
        }
        // Znak, který cílová kódová stránka nezná, se zakóduje jako otazník.
        // Zpětné dekódování ho nevrátí a rozdíl je jediný spolehlivý test.
        if (row.encoding === 'windows-1250' && iconv.decode(encoded, 'windows-1250') !== text) {
          lost = true;
        }
        done(null, encoded);
      },
    });

    const out = createWriteStream(target);
    const gzip = createGzip();
    stringifier.pipe(encode).pipe(gzip).pipe(out);
    const finished = once(out, 'finish');

    for (;;) {
      const { rows: batch } = await tx.execute<Record<string, unknown>>(
        sql.raw(`FETCH FORWARD ${FETCH_SIZE} FROM mlain_export_cursor`),
      );
      if (batch.length === 0) break;
      for (const record of batch) {
        rowCount += 1;
        if (!stringifier.write(record)) await once(stringifier, 'drain');
      }
      if (batch.length < FETCH_SIZE) break;
    }
    stringifier.end();
    await finished;
    await tx.execute(sql.raw('CLOSE mlain_export_cursor'));
  });

  await inWorkspaceTx(ctx, (tx) =>
    tx.execute(sql`
      UPDATE exports SET status = 'completed', row_count = ${rowCount},
        storage_key = ${storageKey}, finished_at = now()
       WHERE id = ${job.data.exportId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`),
  );
  return { rowCount, warnings: lost ? ['characters_lost'] : [] };
};
