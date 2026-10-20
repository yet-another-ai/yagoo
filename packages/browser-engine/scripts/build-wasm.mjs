import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const version = '0.2.104'; // Must match crates/yagoo-web/Cargo.toml.
const toolsRoot = resolve(root, '.yagoo-data/wasm-tools');
const binName = process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen';
const tool = process.env.WASM_BINDGEN ?? resolve(toolsRoot, 'bin', binName);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function tryRun(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  return !result.error && result.status === 0;
}

function releaseTriple() {
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : null;
  if (!arch) return null;
  if (process.platform === 'linux') return `${arch}-unknown-linux-musl`;
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  if (process.platform === 'win32' && arch === 'x86_64') return 'x86_64-pc-windows-msvc';
  return null;
}

// Official release binaries avoid compiling wasm-bindgen-cli on every clean CI machine.
function installPrebuilt() {
  const triple = releaseTriple();
  if (!triple || process.env.WASM_BINDGEN) return false;
  const base = `wasm-bindgen-${version}-${triple}`;
  const archive = resolve(toolsRoot, `${base}.tar.gz`);
  const url = `https://github.com/rustwasm/wasm-bindgen/releases/download/${version}/${base}.tar.gz`;
  mkdirSync(toolsRoot, { recursive: true });
  if (!tryRun('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', archive, url])) return false;
  if (!tryRun('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', `${archive}.sha256sum`, `${url}.sha256sum`])) return false;
  const expected = readFileSync(`${archive}.sha256sum`, 'utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (expected !== actual) throw new Error(`wasm-bindgen ${version} checksum mismatch`);
  if (!tryRun('tar', ['-xzf', archive, '-C', toolsRoot])) return false;
  const extracted = resolve(toolsRoot, base, binName);
  if (!existsSync(extracted)) return false;
  mkdirSync(resolve(toolsRoot, 'bin'), { recursive: true });
  renameSync(extracted, tool);
  if (process.platform !== 'win32') chmodSync(tool, 0o755);
  rmSync(archive, { force: true });
  rmSync(`${archive}.sha256sum`, { force: true });
  rmSync(resolve(toolsRoot, base), { recursive: true, force: true });
  return existsSync(tool);
}

if (!existsSync(tool)) {
  let installed = false;
  try {
    installed = installPrebuilt();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  if (!installed) {
    run('cargo', ['install', 'wasm-bindgen-cli', '--version', version, '--locked', '--root', toolsRoot]);
  }
}

const actual = spawnSync(tool, ['--version'], { encoding: 'utf8' });
if (actual.stdout?.trim() !== `wasm-bindgen ${version}`) throw new Error(`Expected wasm-bindgen ${version}: ${actual.stdout}`);
run('rustup', ['target', 'add', 'wasm32-unknown-unknown']);
run('cargo', ['build', '-p', 'yagoo-web', '--target', 'wasm32-unknown-unknown', '--release']);
run(tool, [resolve(root, 'target/wasm32-unknown-unknown/release/yagoo_web.wasm'), '--target', 'web', '--out-dir', resolve(root, 'packages/browser-engine/wasm')]);
