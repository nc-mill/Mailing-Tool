import { spawn } from 'node:child_process';

export type RunResult = { code: number; stdout: string; stderr: string };

export type RunOptions = {
  /** Přidá se k process.env. Hodnoty se nikdy nevypisují do chybové hlášky. */
  env?: Record<string, string>;
  timeoutMs?: number;
  cwd?: string;
  stdin?: string;
};

export class ProcessFailedError extends Error {
  constructor(
    readonly file: string,
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`${file} skončil s kódem ${code}: ${stderr.trim().slice(0, 2000)}`);
    this.name = 'ProcessFailedError';
  }
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Spustí binárku se `shell: false`. Bez shellu proto, že argumenty pocházejí
 * z cest a z konfigurace, a se zapnutým shellem by z metaznaku v cestě
 * byl další příkaz.
 */
export async function runProcess(
  file: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(file, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${file} se nepodařilo spustit: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${file} překročil timeout ${timeoutMs} ms a byl ukončen`));
        return;
      }
      const result = { code: code ?? -1, stdout, stderr };
      if (result.code !== 0) {
        reject(new ProcessFailedError(file, result.code, stderr));
        return;
      }
      resolve(result);
    });

    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

/** Major verze z prvního čísla ve tvaru X.Y ve výpisu. */
export function majorVersionOf(versionOutput: string): number | null {
  const m = /(\d+)\.(\d+)/.exec(versionOutput);
  return m ? Number(m[1]) : null;
}

/** Major verze binárky, nebo null, když binárka není na PATH. */
export async function binaryMajorVersion(file: string): Promise<number | null> {
  try {
    const r = await runProcess(file, ['--version'], { timeoutMs: 10_000 });
    return majorVersionOf(r.stdout || r.stderr);
  } catch {
    return null;
  }
}
