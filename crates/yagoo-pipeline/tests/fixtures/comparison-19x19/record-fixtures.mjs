#!/usr/bin/env node
/**
 * Record authentic KataGo protocol responses locally. Never run this in CI.
 * No network access, package installation, or model download is performed.
 * Example:
 * node record-fixtures.mjs --engine C:\...\katago.exe --model C:\...\official-swa.bin
 *   --sgf C:\...\sample.sgf --out C:\...\recorded --plies 44,50,61,96 --visits 64
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, list) => {
  if (arg.startsWith("--")) pairs.push([arg.slice(2), list[i + 1]]);
  return pairs;
}, []));
for (const key of ["engine", "model", "sgf", "out"]) if (!args[key]) throw new Error(`Missing --${key}`);
if (process.env.CI) throw new Error("Live fixture recording is forbidden in CI");
const engine = path.resolve(args.engine), model = path.resolve(args.model), sgfPath = path.resolve(args.sgf);
const out = path.resolve(args.out);
if (fs.existsSync(path.join(out, "queries.ndjson"))) throw new Error(`Refusing to overwrite existing recording ${out}`);
fs.mkdirSync(out, {recursive:true});
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const sgf = fs.readFileSync(sgfPath, "utf8");
const sgfStructure=sgf.replace(/\[(?:\\[\s\S]|[^\]\\])*\]/g,"[]");
if ((sgfStructure.match(/\(/g)||[]).length !== 1) throw new Error("Recorder accepts single mainline SGFs only");
if (/(?:AB|AW|AE|PL)\[/.test(sgfStructure)) throw new Error("Recorder requires an empty board with Black first; setup stones/PL need explicit handling");
const size = Number(sgf.match(/SZ\[(\d+)\]/)?.[1]);
const komi = Number(sgf.match(/KM\[([-\d.]+)\]/)?.[1] ?? 0);
const sourceRules = sgf.match(/RU\[([^\]]+)\]/)?.[1];
if (size !== 19 || sourceRules?.toLowerCase() !== "chinese") throw new Error("Review recorder for this board size/rules before use");
const cols = "ABCDEFGHJKLMNOPQRST";
const moves = [...sgf.matchAll(/;([BW])\[([a-s]{2}|)\]/g)].map(([,color,loc]) =>
  [color,loc ? `${cols[loc.charCodeAt(0)-97]}${size-(loc.charCodeAt(1)-97)}` : "pass"]);
if (moves.some(([color],i)=>color!==(i%2?"W":"B"))) throw new Error("Recorder requires alternating Black/White mainline moves");
const plies = (args.plies ?? "44,50,61,96").split(",").map(Number);
const visits = Number(args.visits ?? 64);
if (!Number.isSafeInteger(visits) || visits<8 || plies.some(p=>!Number.isSafeInteger(p)||p<1||p>moves.length)) throw new Error("Invalid visits or plies");
const config = [
  "numAnalysisThreads=1", "numSearchThreads=1", "numEigenThreadsPerModel=4",
  "nnMaxBatchSize=1", "nnCacheSizePowerOfTwo=14", "nnMutexPoolSizePowerOfTwo=4",
  "reportAnalysisWinratesAs=BLACK", "rootNumSymmetriesToSample=8",
  "rootPolicyOptimism=0", "policyOptimism=0", "useUncertainty=false",
  "ignorePreRootHistory=false", "logToStderr=false", "analysisPVLen=15",
  "searchRandSeed=yagoo-comparison-sacrifice-20261021",
  "nnRandSeed=yagoo-fixture-network-20261021", "",
].join("\n");
const cfgPath = path.join(out,"analysis.cfg");
fs.writeFileSync(cfgPath,config);
fs.copyFileSync(sgfPath,path.join(out,"source.sgf"));
const versionRun = spawnSync(engine, ["version"], {encoding:"utf8",cwd:out,windowsHide:true});
if (versionRun.error || versionRun.status !== 0) throw versionRun.error ?? new Error(`Version command failed: ${versionRun.stderr}`);
const version = `${versionRun.stdout}${versionRun.stderr}`.trim();
fs.writeFileSync(path.join(out,"engine-version.txt"),version+"\n");
const manifest = {
  schemaVersion:1,recordedAt:new Date().toISOString(),state:"recording",
  source:{path:sgfPath,sha256:hash(sgfPath),fixture:"source.sgf",name:sgf.match(/GN\[([^\]]+)\]/)?.[1],
    credit:"Public-domain historical game: Yasuda Shusaku (Black, 4d) vs Inoue Gennan Inseki (White, 8d), 1846; bundled first 100 moves.",
    upstreamArchive:"https://homepages.cwi.nl/~aeb/go/games/",archiveGame:126,
    provenance:"Copied byte-for-byte from repository docs/public/app/sample.sgf. No new source fetch."},
  engine:{path:engine,sha256:hash(engine),version,backend:"Eigen AVX2 CPU Windows"},
  model:{path:model,sha256:hash(model),bytes:fs.statSync(model).size,
    name:"kata1-b18c384nbt-s9996604416-d4316597426",
    provenance:"Existing local official-swa.bin exported using KataGo python/export_model_pytorch.py -use-swa from existing model.ckpt; see model-export-command.txt. No model downloaded/uploaded."},
  config:{file:"analysis.cfg",sha256:hash(cfgPath)},rules:"chinese",komi,boardSize:size,
  coordinates:"GTP; ownership arrays row-major A19 to T1",perspective:"BLACK for winrate, scoreLead, root and move ownership",
  visits,requestedPlies:plies,cases:[],queryCount:0,
  caveats:["Finite-visit engine evidence is not expert-labelled sacrifice ground truth.","Raw responses are replay artifacts; regeneration may differ across hardware or engine versions.","The sample game is historical but uses its repository Chinese rules and zero komi, not a reconstructed historical rule set."]
};
const writeManifest = () => fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
writeManifest();
const requestLog = fs.createWriteStream(path.join(out,"queries.ndjson"));
const responseLog = fs.createWriteStream(path.join(out,"responses.ndjson"));
const stderrLog = fs.createWriteStream(path.join(out,"stderr.log"));
const child = spawn(engine,["analysis","-model",model,"-config",cfgPath],{cwd:out,windowsHide:true,stdio:["pipe","pipe","pipe"]});
let pending = null;
let alive = true;
const responses = [];
child.stderr.on("data",data=>stderrLog.write(data));
child.on("error",err=>{if(pending)pending.reject(err);});
child.on("exit",(code,signal)=>{alive=false;if(pending)pending.reject(new Error(`KataGo exited ${code}/${signal}`));});
const lines = readline.createInterface({input:child.stdout});
lines.on("line",line=>{
  responseLog.write(line+"\n");
  responses.push(line);
  let response;
  try {response=JSON.parse(line);} catch(err) {if(pending)pending.reject(err);return;}
  if (response.isDuringSearch) return;
  if (!pending || response.id!==pending.id) {if(pending)pending.reject(new Error(`Unexpected id ${response.id}`));return;}
  const job=pending;pending=null;
  if (response.error) job.reject(new Error(JSON.stringify(response)));
  else job.resolve(response);
});
const query = async(id,history,extra={})=>{
  if(!alive) throw new Error("Engine stopped");
  const q={id,initialStones:[],moves:history,rules:"chinese",komi,boardXSize:size,boardYSize:size,
    maxVisits:visits,includeOwnership:true,includeOwnershipStdev:true,includeMovesOwnership:true,
    includeMovesOwnershipStdev:true,includePVVisits:true,analysisPVLen:15,...extra};
  requestLog.write(JSON.stringify(q)+"\n");
  manifest.queryCount++;
  console.log(`START ${id} history=${history.length} visits=${visits}`);
  const started=Date.now();
  const result=await new Promise((resolve,reject)=>{
    pending={id,resolve,reject};
    child.stdin.write(JSON.stringify(q)+"\n");
  });
  if(result.ownership?.length!==size*size || !Number.isFinite(result.rootInfo?.scoreLead)) throw new Error(`Incomplete evidence ${id}`);
  console.log(`DONE ${id} ${(Date.now()-started)/1000}s score=${result.rootInfo.scoreLead} top=${result.moveInfos?.[0]?.move}`);
  return result;
};
const opponent = c => c==="B" ? "W" : "B";
try {
  for(const ply of plies){
    const prefix=`p${ply}`, history=moves.slice(0,ply-1), [mover,actualMove]=moves[ply-1];
    const c={ply,rootPly:ply-1,mover,actualMove,queries:{}};
    const ask=async(role,h,extra={})=>{const id=`${prefix}-${role}`;c.queries[role]=id;return query(id,h,extra);};
    const root=await ask("root",history);
    const top=[...root.moveInfos].sort((a,b)=>a.order-b.order)[0];
    if(!top)throw new Error(`No preferred move ${prefix}`);
    c.aiMove=top.move;c.aiRootOrder=top.order;
    let actual=root.moveInfos.find(m=>m.move===actualMove);
    c.actualInUnrestrictedRoot=Boolean(actual);
    c.actualCandidateSource=c.queries.root;
    if(!actual){
      const forced=await ask("actual-forced",history,{allowMoves:[{player:mover,moves:[actualMove],untilDepth:1}]});
      actual=forced.moveInfos.find(m=>m.move===actualMove);
      if(!actual)throw new Error(`Forced query missing ${actualMove}`);
      c.actualCandidateSource=c.queries["actual-forced"];
      if(forced.rootInfo.thisHash!==root.rootInfo.thisHash) throw new Error("Forced query changed root position hash");
    }
    c.rootHash=root.rootInfo.thisHash;
    c.actualRootVisits=actual.visits;c.aiRootVisits=top.visits;
    c.sameRootDeltaBlack=actual.scoreLead-top.scoreLead;
    c.sameRootDeltaMover=(mover==="B"?1:-1)*c.sameRootDeltaBlack;
    await ask("root-pass",[...history,[mover,"pass"]]);
    const actualHistory=[...history,[mover,actualMove]];
    await ask("actual-branch-root",actualHistory);
    await ask("actual-branch-pass",[...actualHistory,[opponent(mover),"pass"]]);
    if(top.move===actualMove){
      c.queries["ai-branch-root"]=c.queries["actual-branch-root"];
      c.queries["ai-branch-pass"]=c.queries["actual-branch-pass"];
    } else {
      const aiHistory=[...history,[mover,top.move]];
      await ask("ai-branch-root",aiHistory);
      await ask("ai-branch-pass",[...aiHistory,[opponent(mover),"pass"]]);
    }
    c.aiPv=top.pv;
    c.aiPvVisits=top.pvVisits;
    if(top.pv?.[0]!==top.move)throw new Error("Preferred PV must start with preferred move");
    const pvHistory=[...history,...top.pv.map((move,i)=>[i%2?opponent(mover):mover,move])];
    const endpoint=await ask("ai-pv-end",pvHistory);
    c.endpointPly=pvHistory.length;c.rootScoreBlack=root.rootInfo.scoreLead;c.aiScoreBlack=top.scoreLead;c.endpointScoreBlack=endpoint.rootInfo.scoreLead;
    manifest.cases.push(c);
    writeManifest();
  }
  manifest.state="complete";
} catch(err) {
  manifest.state="failed";manifest.error=String(err);process.exitCode=1;console.error(err);
} finally {
  child.stdin.end();
  const exit=await new Promise(resolve=>alive?child.once("exit",(code,signal)=>resolve({code,signal})):resolve({alreadyExited:true}));
  manifest.engineExit=exit;
  manifest.finishedAt=new Date().toISOString();
  await Promise.all([requestLog,responseLog,stderrLog].map(stream=>new Promise(resolve=>stream.end(resolve))));
  fs.writeFileSync(path.join(out,"responses.json.gz"),zlib.gzipSync(JSON.stringify(responses)));
  manifest.files=Object.fromEntries(["queries.ndjson","responses.ndjson","responses.json.gz","source.sgf","analysis.cfg","stderr.log","engine-version.txt"].map(file=>[file,{sha256:hash(path.join(out,file)),bytes:fs.statSync(path.join(out,file)).size}]));
  writeManifest();
  console.log(`Recording ${manifest.state}; ${responses.length} responses at ${out}`);
}
