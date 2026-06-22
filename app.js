const GH_OWNER = 'Chross2996';
const GH_REPO = 'LOA-Plugin-Files';
const GH_BRANCH = 'main';
const GH_REGIONS = ['EDWW', 'EDMM']; // add more ICAO folders here as they're created in the repo
const FILE_NAMES = { loa: 'LOA.json', ownership: 'sector_ownership.json', volumes: 'volumes.json' };

const state = { loa:null, ownership:null, volumes:null, currentSector:null, loaKind:'destinationLoas', selectedWaypoint:null, selectedVolume:null, rawFile:'loa', issues:[],
  gh:{ token:null, region:null, shas:{loa:null,ownership:null,volumes:null}, baseline:{loa:null,ownership:null,volumes:null}, connected:false } };
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const clone = x => JSON.parse(JSON.stringify(x));

function ghHeaders(){
  return { 'Authorization': `Bearer ${state.gh.token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}
function ghPath(key){ return `${state.gh.region}/${FILE_NAMES[key]}`; }
function showToast(msg, kind){
  const t = document.createElement('div'); t.className = `toast ${kind||''}`; t.textContent = msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(), 4500);
}
async function ghGetFile(key){
  const path = ghPath(key);
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`, { headers: ghHeaders() });
  if(res.status===404) throw new Error(`${path} not found in ${GH_OWNER}/${GH_REPO}@${GH_BRANCH}`);
  if(res.status===401) throw new Error('GitHub rejected the token (401). Check it is valid and not expired.');
  if(res.status===403) throw new Error('GitHub denied access (403). Check the token has Contents: Read & write on this repo.');
  if(!res.ok) throw new Error(`GitHub error ${res.status} fetching ${path}`);
  const data = await res.json();
  state.gh.shas[key] = data.sha;
  const text = decodeURIComponent(escape(atob(data.content.replace(/\n/g,''))));
  return JSON.parse(text);
}
async function ghPutFile(key, jsonValue, message){
  const path = ghPath(key);
  const body = {
    message: message || `Update ${FILE_NAMES[key]} (${state.gh.region}) via JSON Airspace Configurator`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(jsonValue, null, 2)))),
    branch: GH_BRANCH,
  };
  if(state.gh.shas[key]) body.sha = state.gh.shas[key];
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT', headers: { ...ghHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify(body)
  });
  if(res.status===409) throw new Error(`${path} changed on GitHub since you loaded it. Reconnect & reload to get the latest version before committing.`);
  if(res.status===401) throw new Error('GitHub rejected the token (401). Check it is valid and not expired.');
  if(res.status===403) throw new Error('GitHub denied access (403). Check the token has Contents: Read & write on this repo.');
  if(!res.ok){ const t = await res.text().catch(()=> ''); throw new Error(`GitHub error ${res.status} committing ${path}: ${t.slice(0,200)}`); }
  const data = await res.json();
  state.gh.shas[key] = data.content.sha;
  return data;
}
function isDirty(key){
  if(!state.gh.connected) return false;
  const baseline = state.gh.baseline[key];
  if(baseline===null || baseline===undefined) return false;
  return JSON.stringify(state[key]) !== baseline;
}
function refreshCommitBar(){
  const bar = $('#commitBar'); if(!bar) return;
  const dirty = { loa:isDirty('loa'), ownership:isDirty('ownership'), volumes:isDirty('volumes') };
  const anyDirty = dirty.loa || dirty.ownership || dirty.volumes;
  $('#commitLoa').disabled = !state.gh.connected || !dirty.loa;
  $('#commitOwnership').disabled = !state.gh.connected || !dirty.ownership;
  $('#commitVolumes').disabled = !state.gh.connected || !dirty.volumes;
  $('#commitAll').disabled = !state.gh.connected || !anyDirty;
  const status = $('#dirtyStatus');
  if(!state.gh.connected){ status.innerHTML = '<span class="dot"></span>Not connected to GitHub — editing local/offline copy.'; return; }
  if(!anyDirty){ status.innerHTML = `<span class="dot saved"></span>Up to date with ${esc(state.gh.region)} on GitHub.`; return; }
  const changed = Object.entries(dirty).filter(([,v])=>v).map(([k])=>FILE_NAMES[k]).join(', ');
  status.innerHTML = `<span class="dot dirty"></span>Unsaved changes in ${esc(changed)}. Commit when ready.`;
}
async function commitFile(key, btn){
  const original = btn ? btn.textContent : null;
  try{
    if(btn){ btn.disabled = true; btn.textContent = 'Committing…'; }
    await ghPutFile(key, state[key]);
    state.gh.baseline[key] = JSON.stringify(state[key]);
    showToast(`Committed ${FILE_NAMES[key]} to ${state.gh.region} on GitHub.`, 'ok');
  } catch(err){
    showToast(err.message, 'bad');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = original; }
    refreshCommitBar();
  }
}
async function commitAllChanged(){
  const keys = ['loa','ownership','volumes'].filter(isDirty);
  if(!keys.length) return;
  const btn = $('#commitAll'); const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Committing…';
  const failed = [];
  for(const key of keys){
    try{ await ghPutFile(key, state[key]); state.gh.baseline[key] = JSON.stringify(state[key]); }
    catch(err){ failed.push(`${FILE_NAMES[key]}: ${err.message}`); }
  }
  btn.textContent = original;
  if(failed.length) showToast(`Some commits failed — ${failed.join(' | ')}`, 'bad');
  else showToast(`Committed ${keys.map(k=>FILE_NAMES[k]).join(', ')} to ${state.gh.region}.`, 'ok');
  refreshCommitBar();
}
async function ghConnectAndLoad(){
  const token = $('#ghToken').value.trim();
  const region = $('#ghRegion').value;
  if(!token){ showToast('Paste a GitHub token first.', 'bad'); return; }
  state.gh.token = token; state.gh.region = region;
  const statusEl = $('#ghStatus');
  statusEl.textContent = `Loading ${region} from ${GH_OWNER}/${GH_REPO}@${GH_BRANCH}…`;
  try{
    const [loa, ownership, volumes] = await Promise.all([ghGetFile('loa'), ghGetFile('ownership'), ghGetFile('volumes')]);
    Object.assign(state, { loa, ownership, volumes, currentSector: Object.keys(loa)[0] || null, selectedWaypoint:null, selectedVolume:null });
    state.gh.baseline = { loa: JSON.stringify(loa), ownership: JSON.stringify(ownership), volumes: JSON.stringify(volumes) };
    state.gh.connected = true;
    statusEl.textContent = `Connected. Editing ${region} (${GH_OWNER}/${GH_REPO}@${GH_BRANCH}).`;
    render();
  } catch(err){
    state.gh.connected = false;
    statusEl.textContent = `Failed to load ${region}: ${err.message}`;
    showToast(err.message, 'bad');
  }
  refreshCommitBar();
}
function ghForgetToken(){
  state.gh.token = null;
  $('#ghToken').value = '';
  showToast('Token cleared from memory.', 'ok');
}

function readFile(input, key){
  input.addEventListener('change', async e=>{
    const file = e.target.files[0]; if(!file) return;
    try{
      state[key] = JSON.parse(await file.text());
      if(key==='loa') state.currentSector=Object.keys(state.loa)[0];
      // Loaded from disk, not GitHub — stop tracking this file against a GitHub baseline
      // so the commit bar doesn't suggest pushing an unrelated local file over the repo.
      state.gh.baseline[key] = null;
      render();
    }
    catch(err){ alert(`Invalid JSON in ${file.name}: ${err.message}`); }
  });
}
function download(name, data){
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:name});
  a.click(); URL.revokeObjectURL(a.href);
}
function parseList(v){ return String(v ?? '').split(',').map(x=>x.trim()).filter(Boolean); }
function setPath(obj, path, val){ path.reduce((o,k,i)=> i===path.length-1 ? (o[k]=val) : o[k], obj); }
function input(label, value, onChange, type='text'){
  const id = 'i'+Math.random().toString(36).slice(2);
  setTimeout(()=>{const el=$('#'+id); if(el) el.addEventListener('change',e=>{onChange(type==='number'?Number(e.target.value):e.target.value); refreshCommitBar();});});
  return `<label class="field"><span>${esc(label)}</span><input id="${id}" type="${type}" value="${esc(value ?? '')}"></label>`;
}
function listInput(label, arr, onChange){ return input(label, (arr||[]).join(', '), v=>onChange(parseList(v))); }

function render(){ renderLoa(); renderOwnership(); renderVolumes(); renderRaw(); validate(); refreshCommitBar(); }
function renderLoa(){
 const root=$('#loa'); if(!state.loa){root.innerHTML='<div class="card">Load an LOA JSON file to begin.</div>'; return;}
 const sectors=Object.keys(state.loa).sort(); if(!state.currentSector) state.currentSector=sectors[0];
 const rules=state.loa[state.currentSector]?.[state.loaKind] || [];
 const waypointGroups=getWaypointGroups(rules);
 if(state.selectedWaypoint && !waypointGroups.some(g=>g.key===state.selectedWaypoint)) state.selectedWaypoint=null;
 root.innerHTML=`<div class="loa-layout"><aside class="side card"><h3>Sectors</h3><input id="sectorSearch" placeholder="Search sectors"><div class="sector-list">${sectors.map(s=>`<button class="${s===state.currentSector?'active':''}" data-sector="${s}">${s}</button>`).join('')}</div><button id="addSector">+ Add sector</button></aside><section><div class="toolbar loa-toolbar"><input id="waypointSearch" placeholder="Search waypoint/COP, origin, destination, sector"><select id="loaKind"><option value="destinationLoas">Destination LOAs</option><option value="departureLoas">Departure LOAs</option></select><button id="addRule" class="primary">+ Add rule</button></div><h2>${state.currentSector} · ${state.loaKind} <span class="muted">(${rules.length} rules)</span></h2><div class="loa-workspace"><div class="card waypoint-panel"><h3>Waypoints / COPs</h3><p class="small">Click a waypoint or COP to open its customization window.</p><div id="waypointList"></div></div><div id="waypointDetails" class="card details-panel"></div></div></section></div><div id="editModal" class="modal hidden"><div class="modal-backdrop" data-close-modal></div><div class="modal-card"><div class="rule-head"><h2 id="modalTitle">Customize LOA</h2><button data-close-modal>Close</button></div><div id="modalBody"></div></div></div>`;
 $('#loaKind').value=state.loaKind;
 document.querySelectorAll('[data-sector]').forEach(b=>b.onclick=()=>{state.currentSector=b.dataset.sector; state.selectedWaypoint=null; renderLoa();});
 $('#loaKind').onchange=e=>{state.loaKind=e.target.value; state.selectedWaypoint=null; renderLoa();};
 $('#addSector').onclick=()=>{const n=prompt('New sector ID'); if(n&&!state.loa[n]){state.loa[n]={destinationLoas:[],departureLoas:[]}; state.currentSector=n; state.selectedWaypoint=null; render();}};
 $('#addRule').onclick=()=>{rules.push({origins:[],destinations:[],xfl:0,nextSectors:[],copText:'NEW',waypoints:['NEW']}); state.selectedWaypoint='NEW'; renderLoa(); openWaypointEditor('NEW'); refreshCommitBar();};
 $('#sectorSearch').oninput=e=>{const q=e.target.value.toUpperCase(); document.querySelectorAll('[data-sector]').forEach(b=>b.style.display=b.textContent.includes(q)?'block':'none')};
 $('#waypointSearch').oninput=e=>drawWaypoints(e.target.value.toLowerCase());
 document.querySelectorAll('[data-close-modal]').forEach(x=>x.onclick=closeModal);
 drawWaypoints('');
 drawWaypointDetails();
}
function getRuleWaypointKeys(rule){
 const keys=[];
 (rule.waypoints||[]).forEach(w=>keys.push(w));
 if(rule.copText && !keys.includes(rule.copText)) keys.push(rule.copText);
 if(!keys.length) keys.push('(No waypoint/COP)');
 return keys;
}
function getWaypointGroups(rules){
 const map=new Map();
 rules.forEach((r,i)=>getRuleWaypointKeys(r).forEach(k=>{
   if(!map.has(k)) map.set(k,{key:k,rules:[],dest:new Set(),orig:new Set(),next:new Set(),xfl:new Set()});
   const g=map.get(k); g.rules.push(i);
   (r.destinations||[]).forEach(x=>g.dest.add(x)); (r.origins||[]).forEach(x=>g.orig.add(x));
   (r.nextSectors||[]).forEach(x=>g.next.add(x)); if(r.xfl!==undefined) g.xfl.add(r.xfl);
 }));
 return [...map.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
function drawWaypoints(q){
 const rules=state.loa[state.currentSector]?.[state.loaKind] || [];
 const groups=getWaypointGroups(rules).filter(g=>!q || g.key.toLowerCase().includes(q) || g.rules.some(i=>JSON.stringify(rules[i]).toLowerCase().includes(q)));
 $('#waypointList').innerHTML=groups.map(g=>`<button class="waypoint-item ${g.key===state.selectedWaypoint?'active':''}" data-waypoint="${esc(g.key)}"><strong>${esc(g.key)}</strong><span>${g.rules.length} rule${g.rules.length===1?'':'s'}</span><small>${esc([...g.next].slice(0,4).join(', ') || 'No next sector')}</small></button>`).join('') || '<div class="empty">No matching waypoints.</div>';
 document.querySelectorAll('[data-waypoint]').forEach(b=>b.onclick=()=>{state.selectedWaypoint=b.dataset.waypoint; drawWaypoints(q); drawWaypointDetails();});
}
function drawWaypointDetails(){
 const box=$('#waypointDetails'); if(!box) return;
 const rules=state.loa[state.currentSector]?.[state.loaKind] || [];
 if(!state.selectedWaypoint){ box.innerHTML='<h3>Select a waypoint</h3><p class="small">Choose a waypoint/COP from the list to review and edit matching LOA rules.</p>'; return; }
 const idxs=rules.map((r,i)=>({r,i})).filter(({r})=>getRuleWaypointKeys(r).includes(state.selectedWaypoint));
 box.innerHTML=`<div class="rule-head"><div><h3>${esc(state.selectedWaypoint)}</h3><p class="small">${idxs.length} matching rule${idxs.length===1?'':'s'} in ${esc(state.currentSector)}</p></div><button class="primary" id="customizeWaypoint">Customize</button></div><div class="summary-grid">${idxs.map(({r,i})=>`<button class="summary-card" data-rule-open="${i}"><strong>#${i+1} · ${esc(r.copText||'No COP')}</strong><span>XFL ${esc(r.xfl ?? '')} · Next: ${esc((r.nextSectors||[]).join(', ')||'—')}</span><small>${esc([...(r.destinations||[]),...(r.origins||[])].slice(0,8).join(', ')||'No origins/destinations')}</small></button>`).join('')}</div>`;
 $('#customizeWaypoint').onclick=()=>openWaypointEditor(state.selectedWaypoint);
 document.querySelectorAll('[data-rule-open]').forEach(b=>b.onclick=()=>openRuleEditor(+b.dataset.ruleOpen));
}
function openModal(title, body){ $('#modalTitle').textContent=title; $('#modalBody').innerHTML=body; $('#editModal').classList.remove('hidden'); bindRuleButtons(); }
function closeModal(){ const m=$('#editModal'); if(m) m.classList.add('hidden'); }
function openWaypointEditor(key){
 state.selectedWaypoint=key;
 const rules=state.loa[state.currentSector]?.[state.loaKind] || [];
 const idxs=rules.map((r,i)=>({r,i})).filter(({r})=>getRuleWaypointKeys(r).includes(key));
 openModal(`${state.currentSector} · ${key}`, idxs.map(({r,i})=>ruleHtml(r,i)).join('') || '<div class="card">No matching rules.</div>');
}
function openRuleEditor(i){
 const rules=state.loa[state.currentSector]?.[state.loaKind] || [];
 openModal(`${state.currentSector} · Rule #${i+1}`, ruleHtml(rules[i],i));
}
function ruleHtml(rule,i){
 const keys=['origins','destinations','excludeOrigins','excludeDestinations','runways','startVolumes','predictedEnterVolumes','predictedFromVolumes','predictedToVolumes','predictedEndVolumes','notViaWaypoints'];
 const fields=keys.map(k=>listInput(k,rule[k]||[],v=>{ if(v.length) rule[k]=v; else delete rule[k]; })).join('');
 return `<div class="rule"><div class="rule-head"><h3>#${i+1} · ${esc(rule.copText||'No COP')}</h3><div><button data-save-rule="${i}">Save</button><button data-dup="${i}">Duplicate</button><button class="danger" data-del="${i}">Delete</button></div></div><div class="split">${input('xfl',rule.xfl,v=>{rule.xfl=v;},'number')}${input('copText',rule.copText,v=>{rule.copText=v;})}</div><div class="grid">${fields}${listInput('nextSectors',rule.nextSectors||[],v=>{rule.nextSectors=v;})}${listInput('waypoints',rule.waypoints||[],v=>{rule.waypoints=v;})}</div></div>`;
}
function bindRuleButtons(){
 const rules=state.loa[state.currentSector]?.[state.loaKind] || [];
 document.querySelectorAll('[data-save-rule]').forEach(b=>b.onclick=()=>{renderLoa(); if(state.selectedWaypoint) openWaypointEditor(state.selectedWaypoint); refreshCommitBar();});
 document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{rules.splice(+b.dataset.del,1); closeModal(); renderLoa(); refreshCommitBar();});
 document.querySelectorAll('[data-dup]').forEach(b=>b.onclick=()=>{rules.splice(+b.dataset.dup+1,0,clone(rules[+b.dataset.dup])); renderLoa(); openRuleEditor(+b.dataset.dup+1); refreshCommitBar();});
}
function drawRules(q){ drawWaypoints(q); }
function renderOwnership(){
 const root=$('#ownership'); if(!state.ownership){root.innerHTML='<div class="card">Load sector ownership JSON to begin.</div>'; return;}
 root.innerHTML=`<div class="toolbar"><select id="ownGroup"><option value="ownership">Ownership</option><option value="priority">Priority</option></select><input id="ownSearch" placeholder="Search key or sector"><button id="addOwn" class="primary">+ Add entry</button></div><div id="ownList" class="grid"></div>`;
 let group='ownership'; $('#ownGroup').onchange=e=>{group=e.target.value; draw('')}; $('#ownSearch').oninput=e=>draw(e.target.value.toUpperCase()); $('#addOwn').onclick=()=>{const k=prompt('New key'); if(k){state.ownership[group][k]=[]; draw(''); refreshCommitBar();}};
 function draw(q){ const obj=state.ownership[group]||{}; $('#ownList').innerHTML=Object.keys(obj).sort().filter(k=>!q||k.includes(q)||obj[k].join(',').includes(q)).map(k=>`<div class="list-card"><h3>${k}</h3>${listInput('sectors',obj[k],v=>{obj[k]=v;})}<button class="danger" data-own-del="${k}">Delete</button></div>`).join(''); document.querySelectorAll('[data-own-del]').forEach(b=>b.onclick=()=>{delete obj[b.dataset.ownDel]; draw(q); refreshCommitBar();}); }
 draw('');
}
function renderVolumes(){
 const root=$('#volumes'); if(!state.volumes){root.innerHTML='<div class="card">Load volumes JSON to begin.</div>'; return;}
 const vols=state.volumes.volumes||[];
 if(state.selectedVolume!==null && !vols[state.selectedVolume]) state.selectedVolume=null;
 root.innerHTML=`<div class="toolbar"><input id="volSearch" placeholder="Search volume id"><button id="addVolume" class="primary">+ Add volume</button><button id="drawAll">Preview all</button></div><div class="volumes-layout"><div class="card volume-browser"><h3>Defined volumes <span class="muted">(${vols.length})</span></h3><p class="small">Click a volume to open its dropdown configuration.</p><div id="volumeList"></div></div><div class="side card"><h3>Polygon preview</h3><canvas id="map" width="700" height="420"></canvas><p class="small">Coordinates are drawn in relative lat/lon space for quick shape checking.</p></div></div>`;
 $('#addVolume').onclick=()=>{vols.push({id:'NEW_VOL',lowerFL:0,upperFL:660,polygon:[]}); state.selectedVolume=vols.length-1; renderVolumes(); setTimeout(()=>drawMap([vols[state.selectedVolume]]),0); refreshCommitBar();};
 $('#drawAll').onclick=()=>drawMap(vols);
 $('#volSearch').oninput=e=>drawVolumeList(e.target.value.toUpperCase());
 drawVolumeList('');
 setTimeout(()=>drawMap(state.selectedVolume!==null?[vols[state.selectedVolume]]:vols.slice(0,3)),0);
}
function drawVolumeList(q){
 const vols=state.volumes.volumes||[];
 const rows=vols.map((v,i)=>({v,i})).filter(({v})=>!q||String(v.id||'').toUpperCase().includes(q));
 $('#volumeList').innerHTML=rows.map(({v,i})=>{
   const open=i===state.selectedVolume;
   return `<div class="volume-list-item ${open?'open':''}"><button class="volume-row" data-volume-select="${i}"><strong>${esc(v.id||'(no id)')}</strong><span>FL ${esc(v.lowerFL)}–${esc(v.upperFL)}</span><small>${(v.polygon||[]).length} points</small></button>${open?volumeConfigHtml(v,i):''}</div>`;
 }).join('') || '<div class="empty">No matching volumes.</div>';
 document.querySelectorAll('[data-volume-select]').forEach(b=>b.onclick=()=>{const i=+b.dataset.volumeSelect; state.selectedVolume=state.selectedVolume===i?null:i; drawVolumeList(q); if(state.selectedVolume!==null) drawMap([vols[state.selectedVolume]]);});
 bindVolumeConfig();
}
function volumeConfigHtml(v,i){
 return `<div class="volume-config"><div class="rule-head"><h3>Configure ${esc(v.id||'(no id)')}</h3><div><button data-vol-show="${i}">Preview</button><button data-vol-dup="${i}">Duplicate</button><button class="danger" data-vol-del="${i}">Delete</button></div></div><div class="split">${input('id',v.id,x=>{v.id=x;})}${input('lowerFL',v.lowerFL,x=>{v.lowerFL=x;},'number')}${input('upperFL',v.upperFL,x=>{v.upperFL=x;},'number')}</div><label class="field"><span>polygon coordinates — one lat,lon pair per line</span><textarea class="poly-text" data-poly="${i}">${esc((v.polygon||[]).map(p=>p.join(', ')).join('\n'))}</textarea></label></div>`;
}
function bindVolumeConfig(){
 const vols=state.volumes.volumes||[];
 document.querySelectorAll('[data-poly]').forEach(t=>t.onchange=e=>{vols[+t.dataset.poly].polygon=e.target.value.split('\n').map(l=>l.split(',').map(x=>x.trim())).filter(p=>p.length===2&&p[0]&&p[1]); drawMap([vols[+t.dataset.poly]]); refreshCommitBar();});
 document.querySelectorAll('[data-vol-show]').forEach(b=>b.onclick=e=>{e.stopPropagation(); drawMap([vols[+b.dataset.volShow]]);});
 document.querySelectorAll('[data-vol-del]').forEach(b=>b.onclick=e=>{e.stopPropagation(); vols.splice(+b.dataset.volDel,1); state.selectedVolume=null; renderVolumes(); refreshCommitBar();});
 document.querySelectorAll('[data-vol-dup]').forEach(b=>b.onclick=e=>{e.stopPropagation(); const i=+b.dataset.volDup; const copy=clone(vols[i]); copy.id=(copy.id||'VOLUME')+'_COPY'; vols.splice(i+1,0,copy); state.selectedVolume=i+1; renderVolumes(); refreshCommitBar();});
}
function coordToNum(s){ s=String(s); const sign=s.startsWith('-')?-1:1; s=s.replace('-',''); const deg=s.length===6?+s.slice(0,2):+s.slice(0,3); const min=+s.slice(-4,-2); const sec=+s.slice(-2); return sign*(deg+min/60+sec/3600); }
function drawMap(vols){
 const c=$('#map'); if(!c)return; const ctx=c.getContext('2d');
 ctx.clearRect(0,0,c.width,c.height);
 ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,c.width,c.height);
 ctx.strokeStyle='#dbeafe'; ctx.lineWidth=1;
 for(let x=40;x<c.width;x+=70){ctx.beginPath();ctx.moveTo(x,20);ctx.lineTo(x,c.height-20);ctx.stroke();}
 for(let y=40;y<c.height;y+=70){ctx.beginPath();ctx.moveTo(20,y);ctx.lineTo(c.width-20,y);ctx.stroke();}
 let pts=[]; vols.forEach(v=>(v.polygon||[]).forEach(p=>pts.push([coordToNum(p[1]),coordToNum(p[0])])));
 if(!pts.length){ctx.fillStyle='#64748b';ctx.font='16px system-ui';ctx.fillText('No polygon points',20,34);return;}
 const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]); const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
 const tx=(x)=>40+(x-minX)/(maxX-minX||1)*(c.width-80), ty=(y)=>c.height-40-(y-minY)/(maxY-minY||1)*(c.height-80);
 const strokes=['#2563eb','#16a34a','#ea580c','#9333ea','#0891b2','#be123c'];
 vols.forEach((v,vi)=>{const poly=v.polygon||[]; if(!poly.length)return; ctx.beginPath(); poly.forEach((p,i)=>{const x=tx(coordToNum(p[1])), y=ty(coordToNum(p[0])); i?ctx.lineTo(x,y):ctx.moveTo(x,y)}); ctx.closePath(); ctx.fillStyle='rgba(96,165,250,.18)'; ctx.strokeStyle=strokes[vi%strokes.length]; ctx.lineWidth=2.5; ctx.fill(); ctx.stroke(); ctx.fillStyle='#0f172a'; ctx.font='14px system-ui'; ctx.fillText(v.id,tx(coordToNum(poly[0][1]))+6,ty(coordToNum(poly[0][0]))-6);});
}
function renderRaw(){ const root=$('#raw'); root.innerHTML=`<div class="json-row"><aside class="side card file-list"><button data-raw="loa">LOA</button><button data-raw="ownership">Sector ownership</button><button data-raw="volumes">Volumes</button><button id="applyRaw" class="primary">Apply raw changes</button></aside><textarea id="rawText"></textarea></div>`; document.querySelectorAll('[data-raw]').forEach(b=>b.onclick=()=>{state.rawFile=b.dataset.raw; renderRaw();}); $('#rawText').value=JSON.stringify(state[state.rawFile],null,2); $('#applyRaw').onclick=()=>{try{state[state.rawFile]=JSON.parse($('#rawText').value); render();}catch(e){alert(e.message)}}; }
function validate(){ const issues=[]; const volIds=new Set((state.volumes?.volumes||[]).map(v=>v.id)); const sectors=new Set(state.loa?Object.keys(state.loa):[]); if(state.loa) Object.entries(state.loa).forEach(([s,groups])=>['destinationLoas','departureLoas'].forEach(g=>(groups[g]||[]).forEach((r,i)=>{ if(!r.copText) issues.push(`${s}/${g} #${i+1}: missing copText`); if(r.xfl!==undefined && (!Number.isFinite(Number(r.xfl))||Number(r.xfl)<0)) issues.push(`${s}/${g} #${i+1}: invalid xfl`); ['predictedEnterVolumes','predictedFromVolumes','predictedToVolumes','predictedEndVolumes','startVolumes'].forEach(k=>(r[k]||[]).forEach(v=>{if(!volIds.has(v)) issues.push(`${s}/${g} #${i+1}: ${k} references unknown volume ${v}`)})); (r.nextSectors||[]).forEach(ns=>{ if(!sectors.has(ns) && !state.ownership?.priority?.[ns] && !state.ownership?.ownership?.[ns]) issues.push(`${s}/${g} #${i+1}: nextSector ${ns} not found as sector/ownership key`); }); }))); (state.volumes?.volumes||[]).forEach((v,i)=>{if(!v.id) issues.push(`Volume #${i+1}: missing id`); if(+v.lowerFL>+v.upperFL) issues.push(`${v.id}: lowerFL is above upperFL`); if(!Array.isArray(v.polygon)||v.polygon.length<3) issues.push(`${v.id}: polygon has fewer than 3 points`);}); state.issues=issues; const root=$('#issues'); root.innerHTML=`<div class="card"><h2>Validation ${issues.length?`<span class="pill danger">${issues.length} issues</span>`:'<span class="pill ok">No issues found</span>'}</h2>${issues.map(i=>`<div class="issue">${esc(i)}</div>`).join('')||'<p>No validation issues found.</p>'}</div>`; }

document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active')); b.classList.add('active'); $('#'+b.dataset.tab).classList.add('active'); if(b.dataset.tab==='issues') validate();});
$('#validateAll').onclick=()=>{validate(); document.querySelector('[data-tab="issues"]').click();};
$('#exportAll').onclick=()=>{ if(state.loa)download('LOA.json',state.loa); if(state.ownership)download('sector_ownership.json',state.ownership); if(state.volumes)download('volumes.json',state.volumes); };
readFile($('#loaFile'),'loa'); readFile($('#ownershipFile'),'ownership'); readFile($('#volumesFile'),'volumes');

$('#ghRegion').innerHTML = GH_REGIONS.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
$('#ghConnect').onclick = ghConnectAndLoad;
$('#ghForget').onclick = ghForgetToken;
$('#commitLoa').onclick = ()=>commitFile('loa', $('#commitLoa'));
$('#commitOwnership').onclick = ()=>commitFile('ownership', $('#commitOwnership'));
$('#commitVolumes').onclick = ()=>commitFile('volumes', $('#commitVolumes'));
$('#commitAll').onclick = commitAllChanged;

refreshCommitBar();
