#!/usr/bin/env node
import * as path from 'node:path';
import { createEcodeDevRuntime } from './runtime';
import type { EcodeDevLogger } from './types';

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readPort(value: string | undefined): number {
  const port = value === undefined ? 9090 : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${value}`);
  return port;
}

const logger: EcodeDevLogger = {
  debug: (message) => console.debug(message),
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message, data) => console.error(message, data || ''),
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'start';
  const projectRoot = path.resolve(readOption(args, '--project') || process.cwd());
  const proxyTarget = readOption(args, '--target') || process.env.ECODE_PROXY_TARGET;
  const runtime = createEcodeDevRuntime({
    projectRoot,
    proxyTarget,
    host: readOption(args, '--host') || '127.0.0.1',
    port: readPort(readOption(args, '--port')),
    strictSSL: !args.includes('--allow-insecure'),
    logger,
  });

  if (command === 'build') {
    await runtime.build();
    return;
  }
  if (command === 'watch') {
    await runtime.prepare();
    runtime.startWatching();
  } else if (command === 'proxy') {
    await runtime.startProxy();
  } else if (command === 'start') {
    await runtime.start();
  } else {
    throw new Error(`Unknown command "${command}". Use build, watch, proxy, or start.`);
  }

  const stop = async (): Promise<void> => {
    await runtime.dispose();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
