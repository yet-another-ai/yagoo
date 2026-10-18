"""Targeted V7/legality references from official C++ KataGo, without a model.

Ladder and cycle shapes derive from MIT KataGo testboardbasic.cpp/testrules.cpp
at the pinned revision. Rectangular source shapes are padded to square boards.
"""
import argparse
import json
from pathlib import Path
import subprocess


def gtp(point, size):
    return 'pass' if point is None else 'ABCDEFGHJKLMNOPQRST'[point[0]] + str(size-point[1])


def setup(rows, size):
    return [['B' if c == 'x' else 'W', gtp((x,y),size)]
            for y,row in enumerate(rows.split()) for x,c in enumerate(row) if c in 'xo']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--oracle', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    cases = []
    def add(name, size=9, rules='chinese', komi=7.5, initial=None, moves=None, toPlay='B', **extras):
        cases.append(dict(name=name,size=size,rules=rules,komi=komi,initial=initial or [],moves=moves or [],toPlay=toPlay,includeFeatures=True,**extras))
    for rules in ['chinese','chinese-ogs','japanese']:
        for count in [1,2,4,5]:
            moves = [['B','C7'],['W','G3'],['B','pass'],['W','E5'],['B','D5']][:count]
            add(f'{rules}-history-{count}', rules=rules,moves=moves)
        add(f'{rules}-pass-probe',rules=rules,moves=[['B','D4'],['W','pass']])
    for komi in [-90,90]:
        add(f'komi-{komi}',komi=komi)
    add('handicap-history',initial=[['B','C3'],['B','G7']],toPlay='W',moves=[['W','E5'],['B','pass']])
    shapes = {
        'ladder-one-lib': 'xo.x..oxo xoxo..o.. xxo...... ..o.x.... xo..xox.. o..ooxo.. .....xo.. xoox..xo. .xxoo.xxo',
        'ladder-two-lib': 'xo.x..oxo xo.o..o.. xxo...... ..o.x.... xo..xo... ...ooxo.. .....xo.. xoox..xo. .xx.o.xxo',
        'ladder-ko': '......... ......... ....ox... ..xooox.. ..xoxox.. ..xx.x... ...ox.... ....o.... .........',
    }
    for name, shape in shapes.items():
        for player in ['B','W']:
            add(name+'-'+player,initial=setup(shape,9),toPlay=player)
    ko = [['B',gtp(p,9)] for p in [(2,1),(1,2),(2,3),(3,2)]] + [['W',gtp(p,9)] for p in [(3,1),(4,2),(3,3)]]
    sequence = [['W','C7'],['B','A9'],['W','J1'],['B','D7']]
    for count in [0,1,2,3,4]:
        add(f'ko-history-{count}', initial=ko,toPlay='W',moves=sequence[:count])
    triple = setup('ooooooo oxo.o.o x.xoxox xxxxxxx ooooooo ....... .......',7)
    cycle = [(3,1),(1,2),(5,1),(3,2),(1,1),(5,2)] * 2
    moves = [['B' if i%2 == 0 else 'W',gtp(p,7)] for i,p in enumerate(cycle)]
    add('superko-banned',size=7,rules='chinese-ogs',initial=triple,moves=moves[:5])
    add('before-no-result',size=7,initial=triple,moves=moves[:11], rejectedNext=moves[11])
    add('no-result',size=7,initial=triple,moves=moves,expectedReject='Long-cycle')
    # A pass resets the cycle repetition count, but not the record of earlier passes.
    cleared = moves[:6] + [['B','pass']]
    add('pass-clears-cycle',size=7,initial=triple,moves=cleared)
    base = setup('.o.xxo oxxxo. o.x.oo xx.oo. oooo.o ......',6)
    seq = [(5,1),None,(2,3),(5,0),(3,2),(2,0),(0,0),(1,0),None,(2,0),(0,0),(1,0),None]
    passing = [['B' if i%2 == 0 else 'W',gtp(p,6)] for i,p in enumerate(seq)]
    for rules in ['chinese','japanese']:
        add(rules+'-before-repeated-pass',size=6,rules=rules,initial=base,moves=passing[:-1],rejectedNext=passing[-1])
        add(rules+'-repeated-pass',size=6,rules=rules,initial=base,moves=passing,expectedReject='Repeated-pass')
    add('japanese-encore',rules='japanese',moves=[['B','pass'],['W','pass']],expectedReject='encore')
    for rules in ['chinese','chinese-ogs']:
        add(rules+'-terminal-features',rules=rules,moves=[['B','pass'],['W','pass']])
    result = subprocess.run([str(args.oracle.resolve())],input=''.join(json.dumps(c)+'\n' for c in cases),capture_output=True,text=True,check=True)
    outputs = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(outputs) == len(cases)
    for case, output in zip(cases, outputs):
        assert 'error' not in output, (case['name'],output)
        if 'expectedReject' in case:
            assert output['finished'] or output['encorePhase'] > 0, case['name']
        case['expected'] = output
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(cases,separators=(',',':'))+'\n',encoding='utf-8')
    print(f'{len(cases)} targeted official C++ V7/history fixtures written')


if __name__ == '__main__':
    main()
