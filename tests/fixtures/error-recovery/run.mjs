// Isolated headless component verification. No existing browser or desktop window is touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.argv.includes('--run')) { console.log('Run isolated error-boundary checks with --run.'); process.exit(0); }
const root = fileURLToPath(new URL('../../../', import.meta.url));
const uiRoot = join(root, 'packages', 'ui');
const desktopRequire = createRequire(join(root, 'packages', 'desktop', 'package.json'));
const { createServer } = await import(pathToFileURL(desktopRequire.resolve('vite')).href);
const cache = join(process.env.LOCALAPPDATA, 'ms-playwright');
const folder = (await readdir(cache)).filter(value => value.startsWith('chromium_headless_shell-')).sort().reverse()[0];
assert(folder, 'Dedicated Chromium headless shell is required');
const browserPath = join(cache, folder, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
const output = join(root, 'out', 'review', 'error-recovery'); await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'run-'));
const fixturePath = join(uiRoot, `.boundary-review-${Date.now()}.tsx`);
const fixtureName = '/' + fixturePath.split(/[\\/]/).at(-1);
const baseCss = (await readFile(join(uiRoot, 'src', 'styles.css'), 'utf8')).replace(/^@(?:import|source).*$/gm, '');
const source = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ScopedErrorBoundary} from './src/components/ScopedErrorBoundary';
import {useChatStore} from './src/store';
window.__boundaryReview = {failed:true, diagnostics:[], copy:''};
const original = console.error; console.error = (...args) => { if(args.some(x=>String(x).includes('fixture-render-failure'))) return; original(...args); };
const state = window.__boundaryReview;
useChatStore.setState({bridge:{recordUiDiagnostic:async event=>{state.diagnostics.push(event)},exportDiagnostics:async days=>{state.days=days;return {path:'fixture.zip',entries:1,skipped:[]}}}});
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {writeText:async value=>{state.copy=value}} });
function Child(){if(state.failed) throw new Error('fixture-render-failure');return <p id="recovered">Preview restored</p>}
function App(){const [key,setKey]=useState(1);return <main style={{padding:20}}><button id="outside" onClick={()=>{state.outside=true}}>Outside remains usable</button><button id="change-file" onClick={()=>{state.failed=false;setKey(key+1)}}>Change file</button><ScopedErrorBoundary scope="preview" resetKeys={[key]}><Child/></ScopedErrorBoundary></main>}
createRoot(document.getElementById('root')).render(<App/>);`;
await writeFile(fixturePath, source);
let server, browser, socket, seq = 0;
const calls = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { status: 'running', checks: [] };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; const timer = setTimeout(() => { calls.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
  calls.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));
});
const evaluate = async expression => { const value = await send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true}); if(value.exceptionDetails) throw new Error(value.exceptionDetails.text); return value.result?.value; };
const waitFor = async expression => { for(let i=0;i<100;i++){if(await evaluate(expression)) return; await delay(50)} throw new Error(`Timed out: ${expression}`); };
try {
  server = await createServer({root:uiRoot,configFile:false,server:{host:'127.0.0.1',port:0},esbuild:{jsx:'automatic'},plugins:[{name:'boundary-fixture',configureServer(vite){vite.middlewares.use('/boundary-review',async (_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await vite.transformIndexHtml('/boundary-review',`<html><head><style>${baseCss}</style></head><body><div id="root"></div><script type="module" src="${fixtureName}"></script></body></html>`));})}}]});
  await server.listen();
  const address = server.httpServer.address(); const url = `http://127.0.0.1:${address.port}/boundary-review`;
  let devtools = '';
  browser = spawn(browserPath,['--headless','--disable-gpu','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${join(runDirectory,'profile')}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  browser.stderr.on('data', value => { devtools += value; });
  for(let i=0;i<100&&!devtools.includes('DevTools listening on ');i++) await delay(50);
  const endpoint = devtools.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1]; assert(endpoint, 'Headless startup failed');
  const port = new URL(endpoint).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  socket.onmessage = event => { const item=JSON.parse(event.data); const call=calls.get(item.id); if(!call)return;calls.delete(item.id);clearTimeout(call.timer);item.error?call.reject(new Error(item.error.message)):call.resolve(item.result); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride',{width:1000,height:720,deviceScaleFactor:1,mobile:false}); await send('Page.navigate',{url});
  await waitFor(`Boolean(document.querySelector('.pd-scoped-error'))`);
  await evaluate(`document.querySelector('#outside').click()`);
  assert.equal(await evaluate('window.__boundaryReview.outside'),true); report.checks.push('A throwing preview is isolated; sibling controls still work');
  await evaluate(`document.querySelector('.pd-error-details summary').click(); document.querySelector('.pd-error-tools button').click()`);
  await waitFor(`window.__boundaryReview.copy.includes('fixture-render-failure') && window.__boundaryReview.copy.includes('Diagnostic ID:')`); report.checks.push('Complete error copies with a correlation ID');
  await waitFor(`window.__boundaryReview.diagnostics.some(event=>window.__boundaryReview.copy.includes(event.id))`);
  assert.equal(await evaluate(`JSON.stringify(window.__boundaryReview.diagnostics).includes('fixture-render-failure')`),false);
  await evaluate(`document.querySelectorAll('.pd-error-tools button')[1].click()`);await waitFor(`window.__boundaryReview.days===1`);report.checks.push('Diagnostic export is linked by ID without logging raw errors');
  const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(runDirectory,'boundary-failure.png'),Buffer.from(shot.data,'base64'));
  await evaluate(`window.__boundaryReview.failed=false;document.querySelector('.pd-scoped-error > button').click()`);
  await waitFor(`Boolean(document.querySelector('#recovered'))`); report.checks.push('Retry remounts the failed region');
  await send('Page.reload'); await waitFor(`Boolean(document.querySelector('.pd-scoped-error'))`);
  await evaluate(`document.querySelector('#change-file').click()`);await waitFor(`Boolean(document.querySelector('#recovered'))`);report.checks.push('Changing resetKeys recovers without a manual retry');
  const recovered=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(runDirectory,'boundary-recovered.png'),Buffer.from(recovered.data,'base64'));
  report.status='passed';
} catch(error) {report.status='failed';report.error=error.stack??String(error);process.exitCode=1;}
finally {
  if(socket?.readyState===WebSocket.OPEN) await send('Browser.close').catch(()=>{});
  socket?.close();
  if(browser && browser.exitCode===null) {await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),delay(2000)]);if(browser.exitCode===null)browser.kill();}
  for(const call of calls.values())clearTimeout(call.timer);
  await server?.close();
  const safe=relative(resolve(uiRoot),resolve(fixturePath));if(safe.startsWith('..')||isAbsolute(safe))throw new Error('Unsafe fixture path');await rm(fixturePath,{force:true});
  await writeFile(join(runDirectory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,runDirectory},null,2));
}
