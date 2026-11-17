import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const $=id=>document.getElementById(id);
let selectedDay='today';
let customDateKey='';
let loadedPosts=[];
let groups=new Map();
let promptsById=new Map();
let promptsByCode=new Map();
let latestMetric=new Map();
const metricState=new Map();

const esc=(s='')=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function vnDayStart(offset=0){
  const n=new Date(),v=new Date(n.getTime()+7*3600_000);
  return new Date(Date.UTC(v.getUTCFullYear(),v.getUTCMonth(),v.getUTCDate()+offset,-7,0,0));
}
function vnDateStart(key){
  const [y,m,d]=String(key).split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d,-7,0,0));
}
function fmtDate(d){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);}
function fmtPostTime(v){return v?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'—';}
function fmtChecked(v){return v?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'';}
const val=v=>v===null||v===undefined?'':String(v);
const metricNum=(postId,field)=>Number(latestMetric.get(postId)?.[field]??-1);
function copyMetric(m={}){return {reactions_count:m.reactions_count??null,comments_count:m.comments_count??null,shares_count:m.shares_count??null,likes_count:m.likes_count??null,views_count:m.views_count??null,comments_is_lower_bound:Boolean(m.comments_is_lower_bound),views_is_approx:Boolean(m.views_is_approx),metric_note:m.metric_note??null};}
function stateText(postId,msg,cls=''){
  const el=document.querySelector('[data-save-state="'+postId+'"]');
  if(!el)return;
  el.textContent=msg;
  el.className='save-state '+cls;
  clearTimeout(el._clearTimer);
  if(cls==='ok') el._clearTimer=setTimeout(()=>{el.textContent='';el.className='save-state';},1100);
}
function checkedText(postId,when){const el=document.querySelector('[data-checked-at="'+postId+'"]');if(el)el.textContent=fmtChecked(when);}

async function ensureDraft(postId,field,value){
  const current=metricState.get(postId);
  if(current?.checked_at===null){
    const {data,error}=await supabase.from('post_metrics').update({[field]:value}).eq('id',current.id).select('*').single();
    if(error)throw error;
    metricState.set(postId,data);
    latestMetric.set(postId,data);
    return data;
  }
  const payload={post_history_id:postId,checked_at:null,...(current?copyMetric(current):{}),[field]:value};
  const {data,error}=await supabase.from('post_metrics').insert(payload).select('*').single();
  if(error)throw error;
  metricState.set(postId,data);
  latestMetric.set(postId,data);
  return data;
}

async function saveMetric(input){
  const postId=Number(input.dataset.postId),field=input.dataset.field,raw=input.value.trim();
  const value=raw===''?null:Number(raw);
  if(!postId||!field||(value!==null&&(!Number.isInteger(value)||value<0))){stateText(postId,'Invalid','error');return;}
  input.disabled=true;
  stateText(postId,'Saving…','saving');
  try{
    await ensureDraft(postId,field,value);
    checkedText(postId,null);
    stateText(postId,'Saved','ok');
  }catch(e){stateText(postId,e.message||'Save failed','error');}
  finally{input.disabled=false;}
}

async function checkNow(button){
  const postId=Number(button.dataset.postId);
  if(!postId)return;
  button.disabled=true;
  stateText(postId,'Checking…','saving');
  try{
    const current=metricState.get(postId),now=new Date().toISOString();
    let res;
    if(current?.checked_at===null){
      res=await supabase.from('post_metrics').update({checked_at:now}).eq('id',current.id).select('*').single();
    }else{
      res=await supabase.from('post_metrics').insert({post_history_id:postId,checked_at:now,...(current?copyMetric(current):{})}).select('*').single();
    }
    if(res.error)throw res.error;
    metricState.set(postId,res.data);
    latestMetric.set(postId,res.data);
    checkedText(postId,res.data.checked_at);
    stateText(postId,'Checked','ok');
  }catch(e){stateText(postId,e.message||'Check failed','error');}
  finally{button.disabled=false;}
}

async function savePostTime(input){
  const postId=Number(input.dataset.postId);
  const raw=input.value;
  if(!postId||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw))return;
  const parts=raw.split(':').map(Number);
  const start=vnDayStart(-1);
  const submitted=new Date(start.getTime()+parts[0]*3600_000+parts[1]*60_000);
  input.disabled=true;
  const status=document.querySelector('[data-time-state="'+postId+'"]');
  if(status) status.textContent='Saving…';
  try{
    const {data,error}=await supabase.from('post_history')
      .update({submitted_at:submitted.toISOString(),time_is_signal:false,updated_at:new Date().toISOString()})
      .eq('id',postId).eq('time_is_signal',true)
      .select('id').single();
    if(error||!data)throw error||new Error('Could not save time');
    if(status)status.textContent='Saved';
    await load();
  }catch(e){
    input.disabled=false;
    if(status)status.textContent=e.message||'Save failed';
  }
}

function unresolvedGroupLabel(post){
  const match=post?.notes?.match(/group\s+"([^"]+)"/i);
  return match?.[1]||'Unmapped';
}
function groupLabel(post){return groups.get(post.group_id)?.group_name||unresolvedGroupLabel(post);}
function shortGroupName(name=''){
  const words=String(name).trim().split(/\s+/).filter(Boolean);
  return words.length>3?words.slice(0,3).join(' ')+'…':words.join(' ');
}
function groupKey(post){return post.group_id?'g:'+post.group_id:'u:'+unresolvedGroupLabel(post);}

function postComparator(a,b,sort){
  const ga=groupLabel(a),gb=groupLabel(b);
  if(sort==='group_az') return ga.localeCompare(gb,'en',{sensitivity:'base'}) || timeValue(a)-timeValue(b);
  if(sort==='group_za') return gb.localeCompare(ga,'en',{sensitivity:'base'}) || timeValue(a)-timeValue(b);
  if(sort==='time_asc') return timeValue(a)-timeValue(b);
  if(sort==='time_desc') return timeValue(b)-timeValue(a);
  if(sort==='comments_desc') return metricNum(b.id,'comments_count')-metricNum(a.id,'comments_count') || timeValue(a)-timeValue(b);
  if(sort==='likes_desc') return metricNum(b.id,'likes_count')-metricNum(a.id,'likes_count') || timeValue(a)-timeValue(b);
  return 0;
}
function timeValue(post){return post.time_is_signal?Number.MAX_SAFE_INTEGER:new Date(post.submitted_at).getTime();}

function renderRow(p){
  const g=groups.get(p.group_id),pr=promptsById.get(p.prompt_id)||promptsByCode.get(p.prompt_code),m=latestMetric.get(p.id);
  const code=p.prompt_code||pr?.prompt_id||'—',quote=pr?.content||'—';
  const timeHtml=p.time_is_signal
    ? '<div class="missing-time-wrap"><input class="post-time-input" type="time" data-post-id="'+p.id+'" aria-label="Enter yesterday time for '+esc(code)+'"><span class="time-save-state" data-time-state="'+p.id+'"></span></div>'
    : esc(fmtPostTime(p.submitted_at));
  const groupHtml=g
    ? '<a class="report-group-link" href="'+esc(g.group_url||'#')+'" target="_blank" rel="noopener" title="'+esc(g.group_name)+'"><strong>'+esc(g.group_code)+'</strong><span>'+esc(shortGroupName(g.group_name))+'</span></a>'
    : '<span class="report-unmapped-group" title="'+esc(unresolvedGroupLabel(p))+'">'+esc(shortGroupName(unresolvedGroupLabel(p)))+'</span>';
  const metrics=[['likes_count','Like'],['comments_count','Comment'],['shares_count','Share']].map(pair=>{
    const field=pair[0],label=pair[1];
    return '<td data-label="'+label+'" class="report-metric-cell"><input class="metric-input" type="number" inputmode="numeric" min="0" step="1" data-post-id="'+p.id+'" data-field="'+field+'" value="'+esc(val(m?.[field]))+'" aria-label="'+label+' for '+esc(code)+'"></td>';
  }).join('');
  return '<tr class="report-data-row">'+
    '<td data-label="Time" class="report-time '+(p.time_is_signal?'missing-time':'')+'">'+timeHtml+'</td>'+
    '<td data-label="Prompt" class="report-prompt"><strong>'+esc(code)+'</strong></td>'+
    '<td data-label="Quote" class="report-quote" title="'+esc(quote)+'">'+esc(quote)+'</td>'+
    '<td data-label="Group" class="report-group">'+groupHtml+'</td>'+
    metrics+
    '<td data-label="Checked" class="report-check-cell"><button class="check-now-btn" data-action="check" data-post-id="'+p.id+'" title="Check now" aria-label="Check now">✓</button><span class="checked-at" data-checked-at="'+p.id+'">'+esc(fmtChecked(m?.checked_at))+'</span><span class="save-state" data-save-state="'+p.id+'"></span></td>'+
  '</tr>';
}

function render(){
  const sort=$('sortBy').value;
  const groupBy=$('groupBy').value;
  const list=[...loadedPosts];
  $('reportCount').textContent=list.length+' post'+(list.length===1?'':'s');
  $('reportEmpty').classList.toggle('hidden',list.length>0);
  if(!list.length){$('reportRows').innerHTML='';return;}

  if(groupBy==='none'){
    list.sort((a,b)=>postComparator(a,b,sort));
    $('reportRows').innerHTML=list.map(renderRow).join('');
    return;
  }

  const grouped=new Map();
  for(const p of list){
    const key=groupKey(p);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(p);
  }
  let keys=[...grouped.keys()];
  keys.sort((a,b)=>{
    const an=groupLabel(grouped.get(a)[0]),bn=groupLabel(grouped.get(b)[0]);
    return sort==='group_za'?bn.localeCompare(an,'en',{sensitivity:'base'}):an.localeCompare(bn,'en',{sensitivity:'base'});
  });

  const chunks=[];
  for(const key of keys){
    const rows=grouped.get(key);
    const sample=rows[0];
    const group=groups.get(sample.group_id);
    const innerSort=(sort==='group_az'||sort==='group_za')?'time_asc':sort;
    rows.sort((a,b)=>postComparator(a,b,innerSort));
    const groupTitle=group
      ? '<a href="'+esc(group.group_url||'#')+'" target="_blank" rel="noopener">'+esc(group.group_code)+' · '+esc(group.group_name)+'</a>'
      : esc(unresolvedGroupLabel(sample));
    chunks.push('<tr class="report-group-header"><td colspan="8"><div><strong>'+groupTitle+'</strong></div></td></tr>');
    chunks.push(rows.map(renderRow).join(''));
  }
  $('reportRows').innerHTML=chunks.join('');
}

async function load(){
  if(selectedDay==='custom'&&!customDateKey){
    loadedPosts=[];
    groups=new Map();
    promptsById=new Map();
    promptsByCode=new Map();
    latestMetric=new Map();
    metricState.clear();
    $('reportDateLabel').textContent='Custom · Select date';
    $('reportCount').textContent='—';
    $('reportRows').innerHTML='';
    $('reportEmpty').textContent='Select a date.';
    $('reportEmpty').classList.remove('hidden');
    return;
  }

  const start=selectedDay==='custom'
    ? vnDateStart(customDateKey)
    : vnDayStart(selectedDay==='today'?0:-1);
  const end=new Date(start.getTime()+86400_000);
  const dayLabel=selectedDay==='today'?'Today':selectedDay==='yesterday'?'Yesterday':'Custom';
  $('reportDateLabel').textContent=dayLabel+' · '+fmtDate(start);
  $('reportEmpty').textContent='No posts found for this day.';

  const realQuery=supabase.from('post_history')
    .select('id,group_id,prompt_id,prompt_code,submitted_at,time_is_signal,group_mapping_status,notes')
    .gte('submitted_at',start.toISOString()).lt('submitted_at',end.toISOString())
    .eq('time_is_signal',false).order('submitted_at',{ascending:true});

  const signalQuery=selectedDay==='yesterday'
    ? supabase.from('post_history').select('id,group_id,prompt_id,prompt_code,submitted_at,time_is_signal,group_mapping_status,notes').eq('time_is_signal',true).order('id',{ascending:true})
    : Promise.resolve({data:[],error:null});

  const [realRes,signalRes]=await Promise.all([realQuery,signalQuery]);
  if(realRes.error)throw realRes.error;
  if(signalRes.error)throw signalRes.error;

  const seen=new Set();
  loadedPosts=[];
  for(const p of [...(realRes.data||[]),...(signalRes.data||[])]){
    if(seen.has(p.id))continue;
    seen.add(p.id);
    loadedPosts.push(p);
  }

  const groupIds=[...new Set(loadedPosts.map(p=>p.group_id).filter(Boolean))];
  const promptIds=[...new Set(loadedPosts.map(p=>p.prompt_id).filter(Boolean))];
  const promptCodes=[...new Set(loadedPosts.map(p=>p.prompt_code).filter(Boolean))];
  const postIds=loadedPosts.map(p=>p.id);

  const [gRes,pIdRes,pCodeRes,mRes]=await Promise.all([
    groupIds.length?supabase.from('facebook_groups').select('id,group_code,group_name,group_url,posting_status').in('id',groupIds):Promise.resolve({data:[],error:null}),
    promptIds.length?supabase.from('prompts').select('id,prompt_id,title,content').in('id',promptIds):Promise.resolve({data:[],error:null}),
    promptCodes.length?supabase.from('prompts').select('id,prompt_id,title,content').in('prompt_id',promptCodes):Promise.resolve({data:[],error:null}),
    postIds.length?supabase.from('post_metrics').select('*').in('post_history_id',postIds).order('created_at',{ascending:false}):Promise.resolve({data:[],error:null})
  ]);
  for(const r of [gRes,pIdRes,pCodeRes,mRes])if(r.error)throw r.error;

  const activeGroups=(gRes.data||[]).filter(x=>x.posting_status!=='left');
  const hiddenGroupIds=new Set((gRes.data||[]).filter(x=>x.posting_status==='left').map(x=>x.id));
  loadedPosts=loadedPosts.filter(p=>!hiddenGroupIds.has(p.group_id));
  groups=new Map(activeGroups.map(x=>[x.id,x]));
  promptsById=new Map((pIdRes.data||[]).map(x=>[x.id,x]));
  promptsByCode=new Map((pCodeRes.data||[]).map(x=>[x.prompt_id,x]));
  latestMetric=new Map();
  for(const m of mRes.data||[])if(!latestMetric.has(m.post_history_id))latestMetric.set(m.post_history_id,m);
  metricState.clear();
  for(const p of loadedPosts){const m=latestMetric.get(p.id);if(m)metricState.set(p.id,m);}
  render();
}

$('reportRows').addEventListener('change',e=>{
  const metric=e.target.closest('.metric-input');
  if(metric)return saveMetric(metric);
  const time=e.target.closest('.post-time-input');
  if(time)return savePostTime(time);
});
$('reportRows').addEventListener('click',e=>{const b=e.target.closest('[data-action="check"]');if(b)checkNow(b);});
$('sortBy').addEventListener('change',render);
$('groupBy').addEventListener('change',render);
$('customDate').addEventListener('change',async()=>{
  if(selectedDay!=='custom')return;
  customDateKey=$('customDate').value;
  try{await load();}catch(e){$('reportRows').innerHTML='<tr><td colspan="8">Could not load report: '+esc(e.message)+'</td></tr>';}
});
document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',async()=>{
  selectedDay=btn.dataset.day;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));
  const isCustom=selectedDay==='custom';
  $('customDateField').classList.toggle('hidden',!isCustom);
  if(isCustom){
    customDateKey='';
    $('customDate').value='';
  }
  try{await load();}catch(e){$('reportRows').innerHTML='<tr><td colspan="8">Could not load report: '+esc(e.message)+'</td></tr>';}
}));

try{await load();}catch(e){$('reportRows').innerHTML='<tr><td colspan="8">Could not load report: '+esc(e.message)+'</td></tr>';}
