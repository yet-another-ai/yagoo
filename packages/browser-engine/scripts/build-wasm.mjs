import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const version = '0.2.104'; // Must match crates/yagoo-web/Cargo.toml.
const toolsRoot = resolve(root, '.yagoo-data/wasm-tools');
const tool = process.env.WASM_BINDGEN ?? resolve(toolsRoot, 'bin', process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(tool)) run('cargo', ['install', 'wasm-bindgen-cli', '--version', version, '--locked', '--root', toolsRoot]);
const actual = spawnSync(tool, ['--version'], { encoding: 'utf8' });
if (actual.stdout?.trim() !== `wasm-bindgen ${version}`) throw new Error(`Expected wasm-bindgen ${version}: ${actual.stdout}`);
run('rustup', ['target', 'add', 'wasm32-unknown-unknown']);
run('cargo', ['build', '-p', 'yagoo-web', '--target', 'wasm32-unknown-unknown', '--release']);
run(tool, [resolve(root, 'target/wasm32-unknown-unknown/release/yagoo_web.wasm'), '--target', 'web', '--out-dir', resolve(root, 'packages/browser-engine/wasm')]);
