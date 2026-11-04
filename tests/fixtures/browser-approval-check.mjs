// Explicit browser qualification; not part of the default test suite.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const [mode, origin, packagePath, executablePath, output] = process.argv.slice(2);
assert.ok(['--scripted-once', '--scripted-multiwindow', '--scripted-zoom', '--authenticated-once'].includes(mode));
const headed=mode==='--scripted-zoom';
if(headed)assert.equal(process.stdin.isTTY,true,'Native zoom verification requires an interactive terminal.');
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok([packagePath, executablePath, output].every(p => p && resolve(p) === p));
const {chromium} = await import(pathToFileURL(join(packagePath, 'index.mjs')));
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: !headed, executablePath});
const errors = [], events = [];
let page,review,nativeZoom;
const multiwindow=mode==='--scripted-multiwindow';
const multiEvidence=[];
const authenticated = mode === '--authenticated-once';
async function evidence() {
  const response = await page.request.get(origin + '/fixture/evidence');
  assert.equal(response.status(), 200);
  return response.json();
}
async function reachable(control){
  await control.scrollIntoViewIfNeeded();assert.ok(await control.evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.left>=-1&&r.right<=innerWidth+1&&(top===el||el.contains(top));}));
}
async function captureNativeViewport(name){
  await page.bringToFront();const session=await page.context().newCDPSession(page);
  try{
    // The clip uses device-independent pixels from layoutViewport. CSS metrics
    // differ at native browser zoom; using them crops the evidence incorrectly.
    const {layoutViewport:viewport}=await session.send('Page.getLayoutMetrics');
    const clip={x:viewport.pageX,y:viewport.pageY,width:viewport.clientWidth,height:viewport.clientHeight,scale:1};
    const shot=await session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
    await writeFile(join(output,name),Buffer.from(shot.data,'base64'));return clip;
  }finally{await session.detach();}
}
try {
  page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {if (m.type() === 'error') errors.push({text: m.text(), location: m.location()});});
  page.on('request', r => {
    if (r.method() === 'POST') events.push({method: r.method(), path: new URL(r.url()).pathname});
  });
  await page.goto(origin, {waitUntil: 'networkidle'});
  const initial = await evidence();
  assert.equal(initial.dispatches, 0);
  assert.equal(initial.productionEnabled, false);
  if (authenticated) {
    assert.equal(initial.authenticatedCandidate, true);
    assert.equal(initial.turnAttempts, 0);
    assert.equal(initial.profileAttempts, 0);
  } else assert.equal(initial.modelUsed, false);
  if(multiwindow){
    await page.getByRole('status').filter({hasText:'This window controls this project.'}).waitFor();
    await page.getByRole('button',{name:'Select fixture label',exact:true}).click();
    const opened=page.context().waitForEvent('page');await page.getByRole('button',{name:'Detach review & AI',exact:true}).click();review=await opened;
    review.on('pageerror',e=>errors.push(e.message));
    await review.getByRole('heading',{name:'Benchline review',exact:true}).waitFor();
    await review.getByRole('region',{name:'Selected artifact context'}).getByRole('heading',{name:'In-memory fixture label',exact:true}).waitFor();
    assert.equal(await review.evaluate(()=>window.opener===null),true);
  }
  if(headed){
    await page.getByRole('status').filter({hasText:'This window controls this project.'}).waitFor();
    await page.getByRole('button',{name:'Select fixture label',exact:true}).click();
    await page.setViewportSize({width:1200,height:1000});
    console.log(JSON.stringify({origin,readyForNativeZoom:true}));process.stdin.resume();
    for await(const chunk of process.stdin){if(String(chunk).includes('verify-zoom'))break;}process.stdin.pause();
    nativeZoom=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));assert.equal(nativeZoom.dpr,2);
    await page.getByRole('tab',{name:'AI & approvals',exact:true}).click();
  }
  await page.getByRole('combobox', {name: 'Product agent mode'}).selectOption('agent');
  await page.getByRole('checkbox', {name: 'In-memory fixture label'}).check();
  await page.getByRole('button', {name: 'Connect selected product', exact: true}).click();
  const send = page.getByRole('button', {name: 'Send to product agent', exact: true});
  if (!authenticated) await page.getByRole('textbox', {name: 'Product agent message'}).fill('Headless scripted approval fixture');
  await send.waitFor({state: 'visible'});
  // Click waits for enabled; never retry a submitted turn.
  await send.click({timeout: 30000});
  await page.getByRole('button', {name: 'Allow once', exact: true}).waitFor({timeout: 45000});
  const held = await evidence();
  assert.equal(held.dispatches, 0);
  assert.equal(held.journal.actions.length, 1);
  assert.equal(held.journal.actions[0].state, 'awaiting-approval');
  if (authenticated) {
    assert.equal(held.heldApprovalObserved, true);
    assert.equal(held.turnAttempts, 1);
    assert.equal(held.decisions.length, 0);
  }
  if(multiwindow){
    await review.getByRole('button',{name:'Allow once',exact:true}).waitFor();
    assert.equal(await review.getByRole('button',{name:'Allow once',exact:true}).isDisabled(),true);
    const actionId=held.journal.actions[0].id;
    assert.equal((await review.request.post(origin+`/api/actions/${actionId}/decide`,{data:{decision:'once'}})).status(),403);
    assert.equal((await review.request.post(origin+'/api/provider/product/turn',{data:{message:'Observer must not dispatch'}})).status(),403);
    for(let i=0;i<3;i++){await review.reload({waitUntil:'networkidle'});await review.getByRole('heading',{name:'Benchline review',exact:true}).waitFor();}
    const unchanged=await evidence();assert.equal(unchanged.dispatches,0);assert.equal(unchanged.runs.length,1);assert.equal(unchanged.journal.actions.length,1);
    assert.equal(unchanged.requests.filter(r=>r.method==='thread/start').length,1);assert.equal(unchanged.requests.filter(r=>r.method==='turn/start').length,1);
    await review.getByRole('region',{name:'Shared AI conversation'}).getByText('Headless scripted approval fixture',{exact:true}).waitFor();
    multiEvidence.push({phase:'review-reloads-held',dispatches:unchanged.dispatches,turns:unchanged.runs.length});
  }
  await page.screenshot({path: join(output, 'pending.png'), fullPage: true});
  if(headed){
    nativeZoom.widthChecks=[];
    for(const width of [512,720,960,1024,1440,1920]){
      await page.setViewportSize({width:width*2,height:1800});
      const observed=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));assert.equal(observed.dpr,2);assert.equal(observed.width,width);
      if(width<=900)await page.getByRole('tab',{name:'Workspace',exact:true}).click();
      await reachable(page.getByRole('button',{name:'Select fixture label',exact:true}));
      observed.selectionCapture=await captureNativeViewport(`native-zoom-${width}-selection.png`);
      if(width<=900)await page.getByRole('tab',{name:'AI & approvals',exact:true}).click();
      await reachable(page.getByRole('region',{name:'Selected artifact context'}).last());
      await reachable(page.getByLabel('Product agent message'));
      observed.composerCapture=await captureNativeViewport(`native-zoom-${width}-composer.png`);
      for(const control of [...await page.getByRole('button',{name:'Stop future work',exact:true}).all(),...['Allow once','Decline','Always allow'].map(name=>page.getByRole('button',{name,exact:true}))]){
        await reachable(control);
      }
      observed.capture=await captureNativeViewport(`native-zoom-${width}.png`);
      nativeZoom.widthChecks.push(observed);
    }
    await page.screenshot({path:join(output,'native-zoom-pending.png'),fullPage:true});
    assert.equal((await evidence()).dispatches,0);
  }
  if (!authenticated && !headed) {
    // Narrow reflow coverage is distinct from actual browser zoom qualification.
    for (const width of [1024, 1440, 1920, 512, 720, 960]) {
      await page.setViewportSize({width, height: width < 1000 ? 500 : 1000});
      if (width <= 900) await page.getByRole('tab', {name:'AI & approvals', exact:true}).click();
      for (const name of ['Allow once','Decline','Always allow']) {
        const control=page.getByRole('button',{name,exact:true});
        await control.scrollIntoViewIfNeeded();
        const box=await control.boundingBox();
        assert.ok(box && box.x>=0 && box.x+box.width<=width+1, `${name} overflows at ${width}`);
        assert.ok(await control.evaluate(el=>{
          const r=el.getBoundingClientRect(), top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return top===el || el.contains(top);
        }), `${name} obscured at ${width}`);
      }
      await page.screenshot({path:join(output,`approval-${width}.png`)});
    }
    await page.setViewportSize({width:1440,height:1000});
    assert.equal((await evidence()).dispatches,0);
  }
  console.log(JSON.stringify({phase: 'held', dispatches: held.dispatches, automatedTestApproval: true}));
  await page.getByRole('button', {name: 'Allow once', exact: true}).click();
  await page.locator('.model-action .product-tag').filter({hasText: /^verified$/}).waitFor({timeout: 45000});
  await page.getByRole('log', {name: 'Product agent conversation'}).locator('article').filter({has: page.getByRole('heading', {name: 'Benchline', exact: true})}).waitFor({timeout: 30000});
  if (authenticated) {
    const deadline = Date.now() + 30000;
    while ((await evidence()).turnStatus !== 'completed' && Date.now() < deadline) await delay(250);
    assert.equal((await evidence()).turnStatus, 'completed');
    await page.getByRole('status').filter({hasText: /^Product agent: ready$/}).waitFor({timeout: 5000});
  }
  const final = await evidence();
  assert.equal(final.dispatches, 1);
  assert.equal(final.journal.actions.length, 1);
  assert.equal(final.journal.actions[0].state, 'verified');
  assert.equal(final.journal.grants.length, 0);
  assert.equal(final.value, authenticated ? 'Authenticated product UI fixture' : 'Headless scripted approval fixture');
  if (authenticated) {
    assert.equal(final.profileAttempts, 1); assert.equal(final.turnAttempts, 1);
    assert.equal(final.acceptedTurns, 1); assert.equal(final.proposals, 1);
    assert.equal(final.turnStatus, 'completed');
    assert.deepEqual(final.decisions, ['once']); assert.equal(final.timedOut, false);
  }
  assert.equal(events.filter(e => e.path === '/api/provider/product/turn').length, 1);
  assert.equal(events.filter(e => e.path === '/api/actions/prepare' || e.path.endsWith('/execute')).length, 0);
  assert.deepEqual(errors, []);
  await page.screenshot({path: join(output, 'verified.png'), fullPage: true});
  await writeFile(join(output, 'rendered.txt'), await page.locator('body').innerText());
  if(multiwindow){
    await review.getByRole('region',{name:'Shared AI conversation'}).getByText(/Scripted fixture result: verified/).waitFor();
    async function sendSame(){await page.getByRole('textbox',{name:'Product agent message'}).fill('Headless scripted approval fixture');await send.click();}
    await sendSame();await page.getByRole('button',{name:'Always allow',exact:true}).waitFor();
    assert.equal((await evidence()).dispatches,1);await page.getByRole('button',{name:'Always allow',exact:true}).click();
    await page.getByRole('button',{name:'Revoke permission',exact:true}).waitFor();
    await page.locator('.model-action .product-tag').filter({hasText:/^verified$/}).nth(1).waitFor();
    assert.equal((await evidence()).dispatches,2);
    await sendSame();await page.locator('.model-action .product-tag').filter({hasText:/^verified$/}).nth(2).waitFor();
    const recurring=await evidence();assert.equal(recurring.dispatches,3);assert.equal(recurring.journal.grants.length,1);assert.equal(recurring.journal.actions.length,3);
    assert.equal(recurring.journal.actions.at(-1).decision,'always');assert.equal(await page.getByRole('button',{name:'Always allow',exact:true}).count(),0);
    await page.getByRole('button',{name:'Revoke permission',exact:true}).click();await page.getByText('No recurring permissions.',{exact:true}).waitFor();
    await sendSame();await page.getByRole('button',{name:'Decline',exact:true}).waitFor();assert.equal((await evidence()).dispatches,3);
    await page.getByRole('button',{name:'Decline',exact:true}).click();await page.locator('.model-action .product-tag').filter({hasText:/^declined$/}).waitFor();
    const declined=await evidence();assert.equal(declined.dispatches,3);assert.equal(declined.journal.actions.at(-1).state,'declined');assert.equal(declined.journal.grants.length,0);
    await review.reload({waitUntil:'networkidle'});await review.getByRole('heading',{name:'Benchline review',exact:true}).waitFor();
    const afterReload=await evidence();assert.equal(afterReload.runs.length,4);assert.equal(afterReload.requests.filter(r=>r.method==='turn/start').length,4);
    assert.equal(afterReload.requests.filter(r=>r.method==='thread/start').length,1);assert.equal(afterReload.dispatches,3);
    multiEvidence.push({phase:'once-always-reuse-revoke-decline',dispatches:3,turns:4,threads:1,journal:afterReload.journal});
    await review.screenshot({path:join(output,'shared-conversation.png'),fullPage:true});
    await page.getByRole('button',{name:'Release window control',exact:true}).click();await page.getByRole('status').filter({hasText:'No workspace controller connected.'}).waitFor();
    await review.getByRole('alert').filter({hasText:'Workspace view expired'}).waitFor();
    await page.getByRole('button',{name:'Reconnect workspace view',exact:true}).click();await page.getByRole('status').filter({hasText:'This window controls this project.'}).waitFor();
    const released=await evidence();assert.equal(released.requests.filter(r=>r.method==='thread/start').length,1);assert.equal(released.runs.length,4);assert.equal(released.dispatches,3);
    multiEvidence.push({phase:'controller-release-reconnect',dispatches:released.dispatches,turns:released.runs.length});
    assert.deepEqual(errors,[]);
  }
  await writeFile(join(output, 'browser-evidence.json'), JSON.stringify({automatedBrowserVerified: true,
    humanAcceptance: false, authenticated, multiwindow, nativeZoom, browser:browser.version(), node:process.version, multiEvidence, initial, held, final, events, errors}, null, 2));
  console.log(JSON.stringify({phase: 'verified', authenticated, dispatches: final.dispatches, model: final.model, output}));
} catch (error) {
  if (page) {
    await page.screenshot({path: join(output, 'failure.png'), fullPage: true}).catch(() => {});
    await writeFile(join(output, 'failure.json'), JSON.stringify({error: error.message, evidence: await evidence().catch(() => null), events, errors}, null, 2));
    console.error(await page.locator('body').innerText().catch(() => 'Page unavailable'));
  }
  throw error;
} finally {await browser.close();}
