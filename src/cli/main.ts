// @sigil implements design/cli.sigil Cli (process entry)
//
// node dist/cli.js, the `subzero` command. The entry point of the command line
// process is outside Cli: it imports the child driver this process needs and
// registers it with the Kernel before the first command, then hands the Kernel to Cli.
import { Kernel } from '../kernel/kernel.js';
import { PI_HOST, PiDriver } from '../pi/driver.js';
import { runCli } from './cli.js';

const kernel = new Kernel();
const pi = process.env.SUBZERO_PI;
kernel.registerChildDriver(PI_HOST, new PiDriver(pi ? { piCommand: [pi] } : {}));

const code = await runCli(
  process.argv.slice(2),
  {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
  },
  { kernel },
);
process.exit(code);
