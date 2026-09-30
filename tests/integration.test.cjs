const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function component(file, extras={}) {
 const html=read(file), code=html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
 class Logic { constructor(){this.props={};} setState(s,cb){this.state={...this.state,...(typeof s==='function'?s(this.state):s)};if(cb)cb();} }
 const context={DCLogic:Logic,React:{createRef:()=>({current:null})},window:{},document:{},localStorage:{setItem(){}},console,...extras};
 vm.createContext(context);vm.runInContext(code+'\nthis.TestComponent=Component;',context);
 return {c:new context.TestComponent(),context};
}
function root(id,entry){return {getAttribute:k=>({'data-analytics-project-id':id,'data-analytics-project-title':'A public project','data-analytics-entry':entry}[k])};}
test('both pages use only shared bootstrap; generated runtime unchanged',()=>{
 for(const f of ['index.html','portfolio-2026.html']){ const html=read(f);assert.match(html,/<script src="\.\/analytics.js"><\/script>/);assert.doesNotMatch(html,/googletagmanager\.com|gtag\('config'/); }
});
test('modal repeated renders, close, reopen, and selected resume have bounded lifetimes',()=>{
 const events=[],watches=[];let modal=null, selected=null, stops=0;
 const {c}=component('index.html',{document:{querySelector:s=>s==='[data-m="modal"]'?modal:selected},window:{PortfolioAnalytics:{track:(...a)=>events.push(a),watchProject:(...a)=>{watches.push(a);return()=>stops++;}}}});
 c.syncAnalytics();assert.equal(events.length,0);
 modal=root('one','work_grid');c.syncAnalytics();c.syncAnalytics();assert.equal(events.length,1);
 modal=null;c.syncAnalytics();assert.equal(stops,1);
 modal=root('one','work_grid');c.syncAnalytics();assert.equal(events.length,2);
 modal=null;c.state.view='list';selected=root('two','selected_panel');c.syncAnalytics();assert.equal(events.length,3);
 modal=root('two','selected_modal');c.syncAnalytics();assert.equal(events.length,4);
 modal=null;c.syncAnalytics();assert.equal(events.length,4);
 selected=root('three','selected_panel');c.syncAnalytics();assert.equal(events.length,5);
 c.state.view='grid';c.syncAnalytics();assert.equal(stops,6);
});
test('template binds stable IDs, descriptions, and both entry points',()=>{
 const html=read('index.html');assert.match(html,/analyticsId: key\(p\)/);assert.match(html,/data-analytics-project-id="{{ active.analyticsId }}"/);assert.match(html,/data-analytics-project-id="{{ r.analyticsId }}"/);
 assert.equal((html.match(/data-analytics-description-end="1"/g)||[]).length,2);
 const {c}=component('index.html',{window:{innerWidth:1440}});const v=c.renderVals();assert.ok(v.projects.every(p=>p.analyticsId));assert.equal(new Set(v.projects.map(p=>p.analyticsId)).size,v.projects.length);
});
test('PDF emits only after drawing latest accepted render; navigation clears pending view',async()=>{
 const events=[];let stops=0;const pending=[];
 const canvas={getBoundingClientRect:()=>({width:100}),getContext:()=>({drawImage(){}})};
 const {c}=component('portfolio-2026.html',{window:{devicePixelRatio:1,PortfolioAnalytics:{pdfPage:(...a)=>{events.push(a);return()=>stops++;}}},document:{createElement:()=>({getContext:()=>({})})}});
 c.canvasRef.current=canvas;c.pdf={numPages:10,getPage:async()=>({getViewport:()=>({width:100,height:60}),render:()=>({promise:new Promise(r=>pending.push(r))})})};
 const a=c.render(1);await new Promise(setImmediate);c.state.page=2;const b=c.render(2);await new Promise(setImmediate);pending[1]();await b;pending[0]();await a;assert.equal(events.length,1);assert.equal(events[0][1],2);
 c.render=()=>{};c.go(3);assert.equal(stops,1);assert.equal(c.state.page,3);
});
