import { chromium } from "file:///D:/event-shopping-planner-routeplanning-1.9.6.7/node_modules/@playwright/test/index.mjs";
const eventName = "応答速度検証";
const makeBackup = (count) => {
  const item = (id, index) => ({
    id,
    eventDate: "1日目",
    circle: "ユーザー登録" + index,
    title: "新刊" + index,
    block: "A",
    number: String(index + 1),
    price: 500,
    quantity: 1,
    purchaseStatus: "None",
    remarks: "エラーが発生しました",
  });
  const items = Array.from({ length: count }, (_, index) =>
    item("perf-" + index, index),
  );
  const histories = Object.fromEntries(
    Array.from({ length: 10 }, (_, event) => [
      "過去イベント" + event,
      Array.from({ length: 1000 }, (_, index) =>
        item(`past-${event}-${index}`, index),
      ),
    ]),
  );
  const coords = (index) => ({
    row: 2 + Math.floor(index / 99) * 2,
    col: 2 + (index % 99) * 2,
  });
  const numbered = new Map(
    items.map((_, index) => {
      const point = coords(index);
      return [`${point.row}-${point.col}`, index + 1];
    }),
  );
  const map = {
    maxRow: 200,
    maxCol: 200,
    mergedCells: [],
    cells: Array.from({ length: 40000 }, (_, index) => {
      const row = Math.floor(index / 200) + 1,
        col = (index % 200) + 1;
      return {
        row,
        col,
        value: numbered.get(`${row}-${col}`) ?? null,
        backgroundColor: null,
        borders: { top: null, right: null, bottom: null, left: null },
      };
    }),
    blocks: [
      {
        name: "A",
        startRow: 1,
        startCol: 1,
        endRow: 200,
        endCol: 200,
        numberCells: items.map((_, index) => ({
          ...coords(index),
          value: index + 1,
        })),
      },
    ],
  };
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-08T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: items, ...histories },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: { "1日目": items.map((entry) => entry.id) },
      },
      dayModes: { [eventName]: { "1日目": "execute" } },
      mapData: { [eventName]: { "1日目マップ": map } },
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
};
const counts = JSON.parse(process.env.BENCH_COUNTS ?? '[150,500,1500]');
const rounds = Number(process.env.BENCH_ROUNDS ?? 5);
const warmups = Number(process.env.BENCH_WARMUPS ?? 1);
const urls = {before: 'http://127.0.0.1:4271', after: 'http://127.0.0.1:4272'};
const log = value => console.log(JSON.stringify(value));
const browser = await chromium.launch({headless: true});
log({type:'environment',browser:browser.version(),viewport:{width:1280,height:720},serviceWorkers:'block',counts,rounds,warmups,measuredAt:new Date().toISOString()});
async function runCase(version, count, round, warmup) {
  const caseStart = performance.now();
  const context = await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'});
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__bench = {routeJobs:0, routePending:0, longTasks:[]};
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.__route = String(url).includes('route.worker');
        this.__waiting = 0;
        this.addEventListener('message', () => {
          if (this.__route && this.__waiting) {
            this.__waiting--;
            window.__bench.routePending--;
          }
        });
      }
      postMessage(...args) {
        if (this.__route) {
          this.__waiting++;
          window.__bench.routeJobs++;
          window.__bench.routePending++;
        }
        return super.postMessage(...args);
      }
      terminate() {
        if (this.__route) window.__bench.routePending -= this.__waiting;
        this.__waiting = 0;
        return super.terminate();
      }
    };
    new PerformanceObserver(list => {
      window.__bench.longTasks.push(...list.getEntries().map(entry => ({start:entry.startTime,duration:entry.duration})));
    }).observe({type:'longtask'});
  });
  const samples = [];
  const addSample = sample => {
    samples.push(sample);
    log({type:'scenario',version,count,round,warmup,...sample});
  };
  try {
    await page.goto(urls[version]);
    await page.locator('input[aria-label="バックアップファイルを選択"]').setInputFiles({
      name:'comparison.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(makeBackup(count)), 'utf8')
    });
    const restoreDialog = page.getByRole('dialog',{name:'バックアップからイベントを復元'});
    await restoreDialog.getByRole('radio',{name:/同名で置換/}).check();
    await restoreDialog.getByRole('button',{name:'置換して復元'}).click();
    await restoreDialog.waitFor({state:'hidden'});
    await page.locator('[data-item-id="perf-0"]').waitFor({state:'visible'});
    await page.waitForTimeout(350);
    await page.evaluate(async () => {
      window.__benchDb = await new Promise((resolve,reject) => {
        const req = indexedDB.open('EventShoppingPlannerDB');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      window.__readBenchItems = () => new Promise((resolve,reject) => {
        const req = window.__benchDb.transaction('eventLists','readonly').objectStore('eventLists').get('data');
        req.onsuccess = () => resolve(req.result['応答速度検証']);
        req.onerror = () => reject(req.error);
      });
      window.__frame = () => new Promise(requestAnimationFrame);
      window.__dom = () => ({
        cards:document.querySelectorAll('[data-item-id]').length,
        options:document.querySelectorAll('option').length,
        nodes:document.querySelectorAll('*').length,
        renderer:[...document.querySelectorAll('[data-list-renderer]')].map(node => ({engine:node.dataset.listRenderer,strategy:node.dataset.listRendererStrategy}))
      });
    });
    const domInitial = await page.evaluate(() => window.__dom());
    async function edit(scenario, kind, ids, value, expected) {
      const result = await page.evaluate(async ({kind,ids,value,expected}) => {
        const t0 = performance.now(), routeJobs = window.__bench.routeJobs;
        const field = kind === 'memo' ? 'input[aria-label="利用者メモ"]' : kind === 'quantity' ? 'select[aria-label="購入予定数量"]' : 'button[aria-label^="Current status:"]';
        for (const id of ids) {
          const el = document.querySelector(`[data-item-id="${id}"] ${field}`);
          if (!el) throw Error('Missing field '+id+' '+kind);
          if (kind === 'purchase') el.click();
          else if (kind === 'memo') {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
            el.dispatchEvent(new Event('input',{bubbles:true}));
          } else {
            el.value = value;
            el.dispatchEvent(new Event('change',{bubbles:true}));
          }
        }
        const handlerMs = performance.now() - t0;
        await window.__frame();
        const nextFrameMs = performance.now() - t0;
        await window.__frame();
        const inputResponseMs = performance.now() - t0;
        let matched = false;
        while (performance.now() - t0 < 120000) {
          const items = await window.__readBenchItems();
          matched = ids.every(id => {
            const item = items.find(item => item.id === id);
            return Object.entries(expected).every(([key,value]) => item[key] === value);
          });
          if (matched) break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        if (!matched) throw Error('Durable item mismatch '+kind);
        const completionMs = performance.now() - t0;
        await new Promise(resolve=>setTimeout(resolve,80));
        const longTasks = window.__bench.longTasks.filter(task => task.start>=t0 && task.start<t0+completionMs);
        return {handlerMs,nextFrameMs,inputResponseMs,completionMs,routeJobs:window.__bench.routeJobs-routeJobs,maxLongTaskMs:Math.max(0,...longTasks.map(task=>task.duration)),longTaskCount:longTasks.length};
      },{kind,ids,value,expected});
      addSample({scenario,...result});
    }
    await edit('quantity-initial','quantity',['perf-0'],'7',{quantity:7});
    await edit('purchase-burst','purchase',['perf-0','perf-1','perf-2'],null,{purchaseStatus:'Purchased'});
    const traversal = await page.evaluate(async count => {
      const seen = new Set();
      const collect = () => document.querySelectorAll('[data-item-id]').forEach(el=>seen.add(el.dataset.itemId));
      collect();
      const observer = new MutationObserver(collect);
      observer.observe(document.body,{subtree:true,childList:true});
      const started = performance.now();
      const anchors = [...document.querySelectorAll('[data-row-key][aria-posinset]')];
      if (anchors.length !== count) throw Error('Unexpected item anchor count '+anchors.length);
      for (let index=0;index<anchors.length;index+=4) {
        const key = anchors[index].dataset.rowKey;
        const anchor = [...document.querySelectorAll('[data-row-key][aria-posinset]')].find(el=>el.dataset.rowKey===key);
        anchor.scrollIntoView({block:'center',behavior:'instant'});
        await window.__frame();
        await window.__frame();
        collect();
      }
      for (let index=0;index<count;index++) {
        const id='perf-'+index;
        if (seen.has(id)) continue;
        const anchor = [...document.querySelectorAll('[data-row-key][aria-posinset]')].find(el=>el.getAttribute('aria-label')?.includes('新刊'+index));
        if (!anchor) throw Error('Missing traversal anchor '+id);
        anchor.scrollIntoView({block:'center',behavior:'instant'});
        await window.__frame(); await window.__frame(); await window.__frame();
        collect();
        if (!seen.has(id)) throw Error('Not visited '+id);
      }
      observer.disconnect();
      scrollTo({top:0,behavior:'instant'});
      await window.__frame();await window.__frame();
      await new Promise(resolve=>setTimeout(resolve,200));
      return {elapsedMs:performance.now()-started,seen:seen.size,dom:window.__dom()};
    },count);
    if (traversal.seen!==count) throw Error('Traversal did not visit all items');
    log({type:'traversal',version,count,round,warmup,...traversal});
    await edit('memo-after-traversal','memo',['perf-0'],'全件閲覧後の日本語入力',{remarks:'全件閲覧後の日本語入力'});
    const searchResult = await page.evaluate(async count => {
      const input = document.querySelector('input[placeholder="検索..."]');
      const started = performance.now();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'ユーザー登録'+(count-1));
      input.dispatchEvent(new Event('input',{bubbles:true}));
      await window.__frame();await window.__frame();
      const inputResponseMs = performance.now()-started;
      [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='次を検索').click();
      let found=false, stable=0, previous=-1;
      while (performance.now()-started<120000) {
        await window.__frame();
        const target = document.querySelector(`[data-item-id="perf-${count-1}"]`);
        const rect=target?.getBoundingClientRect();
        found=Boolean(rect && rect.bottom>0 && rect.top<innerHeight);
        stable=scrollY===previous?stable+1:0; previous=scrollY;
        if (found && stable>=2) break;
      }
      if (!found) throw Error('Search target not in viewport');
      return {inputResponseMs,completionMs:performance.now()-started};
    },count);
    addSample({scenario:'Japanese-search',...searchResult});
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    await page.waitForTimeout(150);
    if(!await page.locator('#app-display-zoom').isVisible())
      await page.getByTitle('表示項目の設定',{exact:true}).evaluate(button=>button.click());
    await page.locator('#app-display-zoom').waitFor({state:'visible',timeout:10000});
    addSample({scenario:'zoom-125',...await page.evaluate(async()=>{
      const select = document.querySelector('#app-display-zoom');
      const started=performance.now();
      select.value='125';select.dispatchEvent(new Event('change',{bubbles:true}));
      await window.__frame();await window.__frame();
      return {inputResponseMs:performance.now()-started,completionMs:performance.now()-started,dom:window.__dom()};
    })});
    if(await page.locator('#app-display-zoom').isVisible())
      await page.getByTitle('表示項目の設定',{exact:true}).evaluate(button=>button.click());
    await page.locator('#app-display-zoom').waitFor({state:'hidden',timeout:10000});
    const card = page.locator('[data-item-id="perf-0"] > div.rounded-lg').first();
    await card.hover({position:{x:90,y:16}});
    await page.mouse.down();
    const editButton=page.locator('[data-item-id="perf-0"]').getByRole('button',{name:'編集',exact:true});
    await editButton.waitFor({state:'visible',timeout:10000});
    await page.mouse.up();
    const dialogResult = await editButton.evaluate(async button=>{
      const started=performance.now();button.click();
      await window.__frame();await window.__frame();
      if (![...document.querySelectorAll('[role="dialog"]')].some(el=>el.getAttribute('aria-label')==='アイテム編集' || el.textContent.includes('アイテム編集'))) throw Error('Edit dialog not visible');
      return {inputResponseMs:performance.now()-started,completionMs:performance.now()-started,dom:window.__dom()};
    });
    addSample({scenario:'edit-dialog-at-125',...dialogResult});
    await page.getByRole('dialog',{name:'アイテム編集'}).getByRole('button',{name:'キャンセル',exact:true}).click();
    if(!await page.locator('#app-display-zoom').isVisible())
      await page.getByTitle('表示項目の設定',{exact:true}).evaluate(button=>button.click());
    await page.locator('#app-display-zoom').waitFor({state:'visible',timeout:10000});
    await page.locator('#app-display-zoom').selectOption('100');
    if(await page.locator('#app-display-zoom').isVisible())
      await page.getByTitle('表示項目の設定',{exact:true}).evaluate(button=>button.click());
    await page.locator('#app-display-zoom').waitFor({state:'hidden',timeout:10000});
    addSample({scenario:'focus-open',...await page.getByTitle('集中モード',{exact:true}).evaluate(async button=>{
      const started=performance.now();button.click();
      while(!document.querySelector('button[title="次の訪問先"]')){
        if(performance.now()-started>120000)throw Error('Focus did not open');
        await window.__frame();
      }
      await window.__frame();await window.__frame();
      const inputResponseMs=performance.now()-started;
      while(window.__bench.routePending>0){
        if(performance.now()-started>120000)throw Error('Focus routing did not finish');
        await window.__frame();
      }
      await window.__frame();await window.__frame();
      return {inputResponseMs,completionMs:performance.now()-started};
    })});
    for (let index=0;index<3;index++) await page.getByTitle('次の訪問先',{exact:true}).click();
    await page.locator('[data-item-id="perf-3"]').waitFor({state:'visible'});
    addSample({scenario:'purchase-then-next',...await page.evaluate(async()=>{
      const started=performance.now();
      document.querySelector('[data-item-id="perf-3"] button[aria-label^="Current status:"]').click();
      document.querySelector('button[title="次の訪問先"]').click();
      await window.__frame();await window.__frame();
      if (!document.querySelector('[data-item-id="perf-4"]')) throw Error('Next visit incorrect');
      const inputResponseMs=performance.now()-started;
      while ((await window.__readBenchItems()).find(item=>item.id==='perf-3').purchaseStatus!=='Purchased') {
        if (performance.now()-started>120000) throw Error('Purchase-next not durable');
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      return {inputResponseMs,completionMs:performance.now()-started};
    })});
    const showMap = await page.getByTitle('マップを表示',{exact:true}).evaluate(async button=>{
      const started=performance.now();button.click();
      await window.__frame();await window.__frame();
      window.__mapStart=started;
      return {inputResponseMs:performance.now()-started};
    });
    const canvas=page.locator('canvas').first();
    await canvas.waitFor({state:'visible'});
    async function settleCanvas() {
      return page.evaluate(async()=>{
        let previous='',stable=0;const started=performance.now();
        while(performance.now()-started<120000){
          const canvas=document.querySelector('canvas');
          const current=canvas?.toDataURL();
          stable=current && current===previous && window.__bench.routePending===0 ? stable+1:0;
          previous=current;
          if(stable>=3)return performance.now();
          await new Promise(resolve=>setTimeout(resolve,60));
        }
        throw Error('Canvas did not settle');
      });
    }
    await settleCanvas();
    addSample({scenario:'map-open',...showMap,completionMs:await page.evaluate(()=>performance.now()-window.__mapStart)});
    await edit('quantity-map-visible','quantity',['perf-4'],'8',{quantity:8});
    addSample({scenario:'continuous-pinch',...await canvas.evaluate(async element=>{
      const rect=element.getBoundingClientRect(),root=element.parentElement;
      const touch=(identifier,delta)=>new Touch({identifier,target:root,clientX:rect.left+rect.width/2+delta,clientY:rect.top+rect.height/2});
      const emit=(type,distance)=>{const touches=[touch(1,-distance),touch(2,distance)];root.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches,changedTouches:touches}));};
      const started=performance.now(),frameGaps=[];let previous=started;
      emit('touchstart',40);
      for(let frame=0;frame<10;frame++){
        for(let event=0;event<3;event++)emit('touchmove',41+frame*3+event);
        await window.__frame();
        const now=performance.now();frameGaps.push(now-previous);previous=now;
      }
      root.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[touch(1,-70),touch(2,70)],touches:[]}));
      await window.__frame();await window.__frame();
      window.__pinchStart=started;
      return {inputResponseMs:frameGaps[0],gestureMs:performance.now()-started,maxFrameGapMs:Math.max(...frameGaps),frameGaps};
    })});
    await settleCanvas();
    samples[samples.length-1].completionMs=await page.evaluate(()=>performance.now()-window.__pinchStart);
    const persisted=await page.evaluate(async()=>{
      const items=await window.__readBenchItems();
      return {quantity:items[0].quantity,remarks:items[0].remarks,purchases:items.slice(0,4).map(item=>item.purchaseStatus),mapQuantity:items[4].quantity};
    });
    await page.evaluate(()=>window.__benchDb.close());
    await page.reload();
    const reloaded=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open('EventShoppingPlannerDB');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      try{
        const items=await new Promise((resolve,reject)=>{
          const req=db.transaction('eventLists','readonly').objectStore('eventLists').get('data');
          req.onsuccess=()=>resolve(req.result['応答速度検証']);req.onerror=()=>reject(req.error);
        });
        return {quantity:items[0].quantity,remarks:items[0].remarks,purchases:items.slice(0,4).map(item=>item.purchaseStatus),mapQuantity:items[4].quantity};
      }finally{db.close();}
    });
    if(JSON.stringify(reloaded)!==JSON.stringify(persisted))throw Error('Reloaded fields mismatch');
    if(errors.length)throw Error('Page errors: '+errors.join('; '));
    log({type:'case',version,count,round,warmup,samples,domInitial,traversal,persisted,reloadVerified:true,errors,durationMs:performance.now()-caseStart});
  } catch(error) {
    log({type:'failure',version,count,round,warmup,error:String(error),stack:error.stack,errors,samples});
    throw error;
  } finally {await context.close();}
}
try {
  for(let round=0;round<warmups;round++)for(const count of counts)for(const version of ['before','after'])await runCase(version,count,round,true);
  for(let round=1;round<=rounds;round++)for(const count of counts)for(const version of round%2 ? ['before','after'] : ['after','before'])await runCase(version,count,round,false);
} finally {await browser.close();}
