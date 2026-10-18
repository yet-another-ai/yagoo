"""Build the small rules oracle from a separately supplied MIT KataGo checkout.

On Windows run from a Visual Studio x64 developer shell with --compiler cl.
This builds board/rules code only; it neither downloads nor runs a neural model.
"""
import argparse
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--katago-source', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--compiler', default='c++')
    args = parser.parse_args()
    revision = subprocess.check_output(
        ['git', '-C', str(args.katago_source), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != 'd91ea855110dae533f0aada947b2b7d78cc8a4e1':
        raise ValueError('Use the pinned KataGo source revision recorded in THIRD_PARTY_NOTICES.md')
    source = args.katago_source.resolve() / 'cpp'
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    units = ['game/board.cpp', 'game/boardhistory.cpp', 'game/rules.cpp', 'neuralnet/nninputs.cpp',
             'core/global.cpp', 'core/hash.cpp', 'core/rand.cpp', 'core/md5.cpp',
             'core/sha2.cpp', 'core/timer.cpp', 'core/bsearch.cpp']
    sources = [str(Path(__file__).with_name('rules_reference.cpp').resolve())]
    sources += [str(source / name) for name in units]
    msvc = Path(args.compiler).stem.lower() == 'cl'
    executable = out / ('rules_reference.exe' if msvc else 'rules_reference')
    if msvc:
        command = [args.compiler, '/nologo', '/EHsc', '/std:c++17', '/O1',
                   '/D_CRT_SECURE_NO_WARNINGS', '/DBYTE_ORDER=1234',
                   '/DLITTLE_ENDIAN=1234', '/DBIG_ENDIAN=4321', '/DNOMINMAX',
                   '/I' + str(source), *sources, '/Fe:' + str(executable),
                   '/link', 'ws2_32.lib']
    else:
        command = [args.compiler, '-std=c++17', '-O1', '-pthread', '-I', str(source),
                   *sources, '-o', str(executable)]
    subprocess.run(command, cwd=out, check=True)
    print(executable)


if __name__ == '__main__':
    main()
