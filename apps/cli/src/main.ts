import { dispatch } from './dispatch';

const code = await dispatch(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
});
process.exit(code);
