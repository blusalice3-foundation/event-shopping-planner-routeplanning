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
    purchaseStatus: index < 8 ? "Purchased" : "None",
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
const urls = {before:'http://127.0.0.1:4271',after:'http://127.0.0.1:4272'};
const counts = JSON.parse(process.env.SOLDOUT_COUNTS ?? '[150,500,1500]');
const modes = JSON.parse(process.env.SOLDOUT_MODES ?? '["execute","focus","focus-map"]');
const log = value => console.log(JSON.stringify(value));
const browser = await chromium.launch({headless:true});
log({type:'environment',browser:browser.version(),viewport:{width:1280,height:720},serviceWorkers:'block',counts,modes,measuredAt:new Date().toISOString(),samples:'one discarded first visit, three consecutive measured visits per isolated case'});
async function runCase(version,count,mode) {
  const context = await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'});
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  log({type:'start',version,count,mode});
  try {
    await page.addInitScript(()=>{
      window.__routePending=0;
      const NativeWorker=window.Worker;
      window.Worker=class extends NativeWorker {
        constructor(url,options){
          super(url,options);this.__route=String(url).includes('route.worker');this.__waiting=0;
          this.addEventListener('message',()=>{if(this.__route&&this.__waiting){this.__waiting--;window.__routePending--;}});
        }
        postMessage(...args){if(this.__route){this.__waiting++;window.__routePending++;}return super.postMessage(...args);}
        terminate(){if(this.__route)window.__routePending-=this.__waiting;this.__waiting=0;return super.terminate();}
      };
    });
    await page.goto(urls[version]);
    await page.locator('input[aria-label="バックアップファイルを選択"]').setInputFiles({name:'soldout.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(makeBackup(count)),'utf8')});
    const restore=page.getByRole('dialog',{name:'バックアップからイベントを復元'});
    await restore.getByRole('radio',{name:/同名で置換/}).check();
    await restore.getByRole('button',{name:'置換して復元'}).click();
    await restore.waitFor({state:'hidden'}); log({type:'restored',version,count,mode});
    await page.locator('[data-item-id="perf-0"]').waitFor({state:'visible'});
    if(mode!=='execute'){
      await page.getByTitle('集中モード',{exact:true}).click();
      await page.getByTitle('次の訪問先',{exact:true}).first().waitFor({state:'visible'});
    }
    if(mode==='focus-map'){
      await page.getByTitle('マップを表示',{exact:true}).click();
      await page.locator('canvas').first().waitFor({state:'visible'});
    }
    await page.waitForTimeout(500); log({type:'ready',version,count,mode});
    await page.evaluate(async()=>{
      window.__frame=()=>new Promise(requestAnimationFrame);
      window.__db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open('EventShoppingPlannerDB');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      window.__read=()=>new Promise((resolve,reject)=>{
        const req=window.__db.transaction('eventLists','readonly').objectStore('eventLists').get('data');
        req.onsuccess=()=>resolve(req.result['応答速度検証']);req.onerror=()=>reject(req.error);
      });
    });
    const samples=[];
    for(let index=0;index<4;index++){
      await page.locator(`[data-item-id="perf-${index}"]`).waitFor({state:'visible'});
      const sample=await page.evaluate(async ({index,mode})=>{
        const timeout=12000, answer='通販･別イベ頒布無';
        const visible=el=>Boolean(el&&el.getBoundingClientRect().height>0&&el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden');
        const within=el=>{if(!visible(el))return false;const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;};
        const card=document.querySelector(`[data-item-id="perf-${index}"]`);
        const status=card?.querySelector('button[aria-label^="Current status:"]');
        if(!status)throw Error('Status button missing '+index);
        const start=performance.now();status.click();
        const dialog=()=>document.querySelector('[role="dialog"][aria-labelledby="post-event-distribution-check-title"]');
        while(!visible(dialog())){if(performance.now()-start>timeout)throw Error('SoldOut confirmation missing');await window.__frame();}
        await window.__frame();await window.__frame();
        const dialogMs=performance.now()-start;
        const select=dialog().querySelector('select[aria-label="回答内容"]');
        if(!select)throw Error('Answer select missing');
        select.value=answer;select.dispatchEvent(new Event('change',{bubbles:true}));
        await window.__frame();await window.__frame();
        const recordButton=[...dialog().querySelectorAll('button')].find(button=>button.textContent.trim()==='記録');
        const recordStart=performance.now();recordButton.click();
        while(visible(dialog())){if(performance.now()-recordStart>timeout)throw Error('Record dialog did not close');await window.__frame();}
        await window.__frame();await window.__frame();
        const recordResponseMs=performance.now()-recordStart;
        let nextButton;
        if(mode==='execute'){
          const currentCard=document.querySelector(`[data-item-id="perf-${index}"]`);
          const group=currentCard?.closest('[role="listitem"][data-row-key]:not([aria-posinset])');
          nextButton=group&&[...group.querySelectorAll('button')].find(button=>button.textContent.includes('スペースを閉じて次のスペースを展開'));
        }else nextButton=document.querySelector('button[title="次の訪問先"]');
        if(!nextButton)throw Error('Next button missing '+mode+' '+index);
        const nextStart=performance.now();nextButton.click();
        await window.__frame();await window.__frame();
        const nextResponseMs=performance.now()-nextStart;
        let target;
        while(true){
          target=document.querySelector(`[data-item-id="perf-${index+1}"]`);
          const previous=document.querySelector(`[data-item-id="perf-${index}"]`);
          if(within(target)&&target.querySelector('button[aria-label^="Current status:"]')&&!visible(previous?.querySelector('button[aria-label^="Current status:"]')))break;
          if(performance.now()-nextStart>timeout)throw Error('Next visit incorrect or not visible '+index);
          await window.__frame();
        }
        const nextVisibleMs=performance.now()-nextStart;
        if(!target.textContent.includes('ユーザー登録'+(index+1)))throw Error('Next circle differs');
        let mapReadyMs=null;
        if(mode==='focus-map'){
          let previous='',stable=0;
          while(performance.now()-nextStart<timeout){
            await new Promise(resolve=>setTimeout(resolve,60));
            const image=document.querySelector('canvas')?.toDataURL();
            stable=image&&image===previous&&window.__routePending===0?stable+1:0;previous=image;
            if(stable>=3)break;
          }
          if(stable<3)throw Error('Map did not settle');
          mapReadyMs=performance.now()-nextStart;
        }
        while(true){
          const item=(await window.__read()).find(item=>item.id==='perf-'+index);
          if(item?.purchaseStatus==='SoldOut'&&item.remarks.includes('通販･頒布確認: '+answer))break;
          if(performance.now()-recordStart>timeout)throw Error('SoldOut/answer not persisted '+index);
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        return {dialogMs,recordResponseMs,nextResponseMs,nextVisibleMs,mapReadyMs,recordToDurableMs:performance.now()-recordStart,actualNext:{id:'perf-'+(index+1),circle:'ユーザー登録'+(index+1),space:'A'+(index+2)},domCards:document.querySelectorAll('[data-item-id]').length};
      },{index,mode});
      samples.push({warmup:index===0,visit:index,...sample});
      log({type:'sample',version,count,mode,warmup:index===0,visit:index,...sample});
    }
    await page.reload();
    await page.locator('input[aria-label="バックアップファイルを選択"]').waitFor({state:'attached'});
    const persisted=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('EventShoppingPlannerDB');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
      const items=await new Promise((resolve,reject)=>{const req=db.transaction('eventLists','readonly').objectStore('eventLists').get('data');req.onsuccess=()=>resolve(req.result['応答速度検証']);req.onerror=()=>reject(req.error);});
      return items.slice(0,4).map(item=>({id:item.id,status:item.purchaseStatus,remarks:item.remarks}));
    });
    if(persisted.some(item=>item.status!=='SoldOut'||!item.remarks.includes('通販･頒布確認: 通販･別イベ頒布無')))throw Error('Reload does not match recorded values');
    if(errors.length)throw Error(errors.join('; '));
    log({type:'case',version,count,mode,samples,reloadMatched:true,errors});
  }catch(error){log({type:'error',version,count,mode,message:error.stack,errors,debug:await page.evaluate(()=>({text:document.body.innerText.slice(0,12000),cards:[...document.querySelectorAll('[data-item-id]')].map(el=>el.dataset.itemId).slice(0,20)})).catch(()=>null)});throw error;}
  finally{await context.close();}
}
try{
  for(const count of counts){
    for(const mode of modes){
      const versions=mode==='focus'?['after','before']:['before','after'];
      for(const version of versions)await runCase(version,count,mode);
    }
  }
}finally{await browser.close();}
