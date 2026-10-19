"""Generate scoring fixtures using a compiled, separately supplied KataGo oracle."""
import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--oracle', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    features = json.loads((root / 'crates/yagoo-core/tests/fixtures/v7.json').read_text())
    letters = 'ABCDEFGHJKLMNOPQRST'
    def gtp(p, size):
        return 'pass' if p is None else letters[p[0]] + str(size - p[1])
    cases = []
    for f in features:
        if f['rules'] == 'japanese' or len(f['moves']) not in (0, 5, 20, 60):
            continue
        moves = [['B' if i % 2 == 0 else 'W', gtp(p, f['size'])] for i, p in enumerate(f['moves'])]
        moves += [['B' if len(moves) % 2 == 0 else 'W', 'pass'], ['W' if len(moves) % 2 == 0 else 'B', 'pass']]
        cases.append(dict(name=f['name'] + '-ended', size=f['size'], rules=f['rules'], komi=f['komi'], moves=moves))
    for rules in ('chinese', 'chinese-ogs'):
        cases += [
            dict(name=rules+'-draw', size=9, rules=rules, komi=0, moves=[['B','pass'],['W','pass']]),
            dict(name=rules+'-handicap', size=9, rules=rules, komi=7.5, initial=[['B','C3'],['B','G7']], toPlay='W', moves=[['W','pass'],['B','pass']]),
        ]
        # One dead white stone with one liberty, inside a Benson-alive black chain.
        initial = [['W' if (x,y)==(1,1) else 'B',gtp((x,y),4)] for y in range(4) for x in range(4) if (x,y) not in [(0,0),(3,3),(1,2)]]
        cases.append(dict(name=rules+'-benson-dead-stone', size=4, rules=rules, komi=0, initial=initial, moves=[['B','pass'],['W','pass']]))
    for passes in (2,4,6):
        cases.append(dict(name=f'japanese-{passes}-passes', size=9, rules='japanese', komi=6.5, moves=[['B' if i%2==0 else 'W','pass'] for i in range(passes)]))
    result = subprocess.run([str(args.oracle.resolve())], input=''.join(json.dumps(c)+'\n' for c in cases), text=True, capture_output=True, check=True)
    expected = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(expected) == len(cases)
    for case, output in zip(cases, expected):
        assert 'error' not in output, (case, output)
        case['expected'] = output
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(cases, separators=(',', ':'))+'\n')
    print(f'{len(cases)} upstream rules fixtures written to {args.out}')


if __name__ == '__main__':
    main()
