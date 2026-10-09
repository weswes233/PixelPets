// Minimal CDP driver: node cdp.mjs <commands...>   commands: goto:URL shot:name click:x,y wait:ms type:text
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const port = 9333;
const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', `--window-size=420,${process.env.H ?? 800}`, `--user-data-dir=${process.env.PROFILE ?? '/tmp/ui-smoke-profile'}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); if (target) break; } catch {} await sleep(200); }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description).join(' ')); if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: Number(process.env.H ?? 800), deviceScaleFactor: 1, mobile: false });
for (const cmd of process.argv.slice(2)) {
  const [op, ...rest] = cmd.split(':'); const arg = rest.join(':');
  if (op === 'goto') await send('Page.navigate', { url: arg });
  else if (op === 'wait') await sleep(Number(arg));
  else if (op === 'shot') { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`/workspace/ui-smoke/${arg}.png`, Buffer.from(r.result.data, 'base64')); }
  else if (op === 'click') { const [x, y] = arg.split(',').map(Number);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(300); }
  else if (op === 'wheel') { const [x, y, dy] = arg.split(',').map(Number); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy }); await sleep(300); }
  else if (op === 'type') await send('Input.insertText', { text: arg });
}
console.log(logs.slice(-15).join('\n'));
ws.close(); chrome.kill();
