"""Small functional comparison with official native KataGo, never a benchmark.

Consumes the fixed browser-smoke corpus; the reference run uses one visit and
all eight symmetries. Deep runs report differences without claiming search parity.
"""
import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine',type=Path,required=True)
    parser.add_argument('--model',type=Path,required=True)
    parser.add_argument('--browser-dir',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    config=args.out/'analysis.cfg'
    # Analysis defaults hide pre-root move features. The browser deliberately
    # retains game history, so disable that native analysis-only default here.
    config.write_text('numAnalysisThreads=1\nnumSearchThreads=1\nnumEigenThreadsPerModel=4\nnnMaxBatchSize=1\nnnCacheSizePowerOfTwo=8\nnnMutexPoolSizePowerOfTwo=4\nreportAnalysisWinratesAs=BLACK\nrootNumSymmetriesToSample=8\nrootPolicyOptimism=0\npolicyOptimism=0\nuseUncertainty=false\nignorePreRootHistory=false\nlogToStderr=false\n',encoding='utf-8')
    queries=[]
    reference={}
    for filename,phase in [('events.ndjson','scan'),('deep-events.ndjson','deep')]:
        events=[json.loads(line) for line in (args.browser_dir/filename).read_text().splitlines()]
        for event in events:
            if event['type']!='positionCompleted' or event['phase']!=phase: continue
            snap=event['snapshot']
            ply=snap['ply']
            moves=[['B','C7'],['W','G3']][:ply]
            for stage,key in [('root','root'),('pass_probe','passProbe')]:
                if key not in snap: continue
                engine_result=snap[key]
                qid=f'{phase}-{ply}-{stage}'
                queries.append(dict(id=qid,boardXSize=9,boardYSize=9,rules='chinese',komi=7.5,
                    moves=moves+([['B' if ply%2==0 else 'W','pass']] if stage=='pass_probe' else []),
                    maxVisits=engine_result['visits'],includeOwnership=True,includeOwnershipStdev=True,
                    includeMovesOwnership=True,includeMovesOwnershipStdev=True,includePolicy=True,includePVVisits=True,
                    overrideSettings={'reportAnalysisWinratesAs':'BLACK'}))
                reference[qid]=engine_result
    command=[str(args.engine.resolve()),'analysis','-model',str(args.model.resolve()),'-config',str(config.resolve())]
    # Liveness bound only; no elapsed time is measured or used for acceptance.
    result=subprocess.run(command,input=''.join(json.dumps(q)+'\n' for q in queries),capture_output=True,text=True,timeout=180,check=True)
    (args.out/'stderr.log').write_text(result.stderr,encoding='utf-8')
    (args.out/'native.ndjson').write_text(result.stdout,encoding='utf-8')
    report=[]
    for line in result.stdout.splitlines():
        native=json.loads(line)
        if native.get('isDuringSearch'): continue
        assert 'error' not in native,native
        web=reference[native['id']]
        row={'id':native['id'],'visits':web['visits']}
        for field in ['winrate','scoreLead']:
            row[field+'AbsDiff']=abs(web[field]-native['rootInfo'][field])
        for field in ['ownership','ownershipStdev','policy']:
            a,b=web.get(field),native.get(field)
            if a is None or b is None: continue
            assert len(a)==len(b)
            # Native protocol uses -1 for illegal policy points; Rust uses zero.
            row[field+'MaxAbsDiff']=max(abs(x-max(y,0) if field=='policy' else x-y) for x,y in zip(a,b))
        if web['visits']==1:
            assert row['winrateAbsDiff']<.002,row
            assert row['scoreLeadAbsDiff']<.05,row
            assert row['ownershipMaxAbsDiff']<.002,row
            assert row.get('policyMaxAbsDiff',0)<.002,row
        report.append(row)
    assert len(report)==len(queries),(len(report),len(queries))
    (args.out/'comparison.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
