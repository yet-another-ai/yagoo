#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
const dir=path.resolve(process.argv[2]??"recorded-comparison-sacrifice");
const read=name=>fs.readFileSync(path.join(dir,name),"utf8");
const manifest=JSON.parse(read("manifest.json"));
assert.equal(manifest.state,"complete");
assert.equal(manifest.engineExit.code,0,"engine exited successfully after the complete transcript");
const columns="ABCDEFGHJKLMNOPQRST";
const sourceMoves=[...read("source.sgf").matchAll(/;([BW])\[([a-s]{2}|)\]/g)].map(([,color,loc])=>
  [color,loc?`${columns[loc.charCodeAt(0)-97]}${19-(loc.charCodeAt(1)-97)}`:"pass"]);
const queries=read("queries.ndjson").trim().split(/\r?\n/).map(JSON.parse);
const rawResponses=read("responses.ndjson").trim().split(/\r?\n/);
const responses=rawResponses.map(JSON.parse);
const qMap=new Map(queries.map(q=>[q.id,q]));
const rMap=new Map(responses.map(r=>[r.id,r]));
assert.equal(qMap.size,queries.length,"unique request ids");
assert.equal(rMap.size,responses.length,"unique final response ids");
assert.equal(queries.length,responses.length,"every request has one final response");
assert.equal(manifest.queryCount,queries.length);
assert.deepEqual(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,"responses.json.gz")))),rawResponses);
const arrayOK=(v,n,label)=>{
  assert.equal(v?.length,n,label);
  assert(v.every(x=>Number.isFinite(x)&&x>=-1&&x<=1),label+" finite bounded values");
};
const verified=[];
for(const q of queries){
  const r=rMap.get(q.id);
  assert(r&&!r.error&&!r.isDuringSearch);
  assert.equal(r.turnNumber,q.moves.length);
  assert.equal(r.rootInfo.currentPlayer,q.moves.length%2?"W":"B");
  assert.equal(r.rootInfo.visits,q.maxVisits);
  assert(Number.isFinite(r.rootInfo.scoreLead));
  arrayOK(r.ownership,361,q.id+" root ownership");
  arrayOK(r.ownershipStdev,361,q.id+" root ownership stdev");
  for(const m of r.moveInfos) {
    arrayOK(m.ownership,361,q.id+" "+m.move+" ownership");
    assert(Number.isFinite(m.scoreLead));
  }
}
for(const c of manifest.cases){
  const rootQ=qMap.get(c.queries.root),rootR=rMap.get(c.queries.root);
  assert.equal(c.rootPly,c.ply-1);
  assert.equal(rootQ.moves.length,c.rootPly);
  assert.deepEqual(rootQ.moves,sourceMoves.slice(0,c.rootPly),"exact source SGF prefix at root");
  assert.deepEqual([c.mover,c.actualMove],sourceMoves[c.ply-1],"actual move from source SGF");
  assert.equal(rootR.rootInfo.currentPlayer,c.mover);
  const actualSource=rMap.get(c.actualCandidateSource);
  const actual=actualSource.moveInfos.find(m=>m.move===c.actualMove);
  const top=[...rootR.moveInfos].sort((a,b)=>a.order-b.order)[0];
  assert.equal(c.aiMove,top.move);
  assert.equal(actualSource.rootInfo.thisHash,rootR.rootInfo.thisHash,"same position/player/ko hash");
  if(!c.actualInUnrestrictedRoot){
    const forcedQ=qMap.get(c.queries["actual-forced"]);
    assert.deepEqual(forcedQ.moves,rootQ.moves);
    for(const key of ["initialStones","rules","komi","boardXSize","boardYSize"]) assert.deepEqual(forcedQ[key],rootQ[key]);
    assert.deepEqual(forcedQ.allowMoves,[{player:c.mover,moves:[c.actualMove],untilDepth:1}]);
  }
  const opposite=c.mover==="B"?"W":"B";
  assert.deepEqual(qMap.get(c.queries["root-pass"]).moves,[...rootQ.moves,[c.mover,"pass"]]);
  for(const branch of ["actual","ai"]){
    const branchHistory=[...rootQ.moves,[c.mover,c[`${branch}Move`]]];
    assert.deepEqual(qMap.get(c.queries[`${branch}-branch-root`]).moves,branchHistory);
    assert.deepEqual(qMap.get(c.queries[`${branch}-branch-pass`]).moves,[...branchHistory,[opposite,"pass"]]);
  }
  assert.deepEqual(c.aiPv,top.pv);
  assert.equal(c.aiPv[0],c.aiMove);
  assert.deepEqual(qMap.get(c.queries["ai-pv-end"]).moves,
    [...rootQ.moves,...c.aiPv.map((move,i)=>[i%2?opposite:c.mover,move])]);
  const delta=actual.scoreLead-top.scoreLead;
  assert.equal(c.sameRootDeltaBlack,delta);
  assert.equal(c.sameRootDeltaMover || 0,((c.mover==="B"?1:-1)*delta) || 0);
  if(c.actualMove===c.aiMove){
    assert.equal(delta,0);
    assert.deepEqual(actual.ownership,top.ownership);
  }
  verified.push({ply:c.ply,rootPly:c.rootPly,mover:c.mover,actualMove:c.actualMove,aiMove:c.aiMove,
    forcedActual:!c.actualInUnrestrictedRoot,actualVisits:actual.visits,aiVisits:top.visits,
    actualScoreBlack:actual.scoreLead,aiScoreBlack:top.scoreLead,lossForMover:-c.sameRootDeltaMover,
    pvLength:c.aiPv.length,endpointScoreBlack:c.endpointScoreBlack});
}
for(const [file,meta] of Object.entries(manifest.files)){
  const bytes=fs.readFileSync(path.join(dir,file));
  assert.equal(bytes.length,meta.bytes);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),meta.sha256);
}
const result={validatedAt:new Date().toISOString(),queryCount:queries.length,responseCount:responses.length,
  engineVersion:manifest.engine.version.split(/\r?\n/)[0],checks:[
    "Raw final responses match every recorded request and compressed replay byte strings",
    "All root and move ownership arrays have 361 finite bounded values",
    "Every actual move p uses exactly p-1 SGF moves at the comparison root",
    "Forced actual queries preserve history, side, rules, komi, dimensions, and engine root hash",
    "Actual and AI branch root/pass histories are exact",
    "Preferred PV endpoint is the full reported top-ranked PV appended to the comparison root",
    "Scores preserve Black-positive and mover-relative signs",
    "Equal actual/AI moves have exactly zero score and ownership differences",
    "All manifest file lengths and SHA-256 hashes verify",
  ],cases:verified};
fs.writeFileSync(path.join(dir,"validation.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
