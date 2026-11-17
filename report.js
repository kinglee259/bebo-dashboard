import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const $=id=>document.getElementById(id);
let selectedDay='today';
const metricState=new Map();

const esc=(s='')=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function vnDayStart(offset=0){const n=new Date(),v=new Date(n.getTime()+7*3600_000);return new Date(Date.UTC(v.getUTCFullYear(),v.getUTCMonth(),v.getUTCDate()+offset,-7,0,0));}
function fmtDate(d){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);}
function fmtTime(v){return v?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'Not checked';}
function fmtPostTime(v){return v?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'—';}
const val=v=>v===null||v===undefined?'':String(v);
function copyMetric(m={}){return {reactions_count:m.reactions_count??null,comments_count:m.comments_count??null,shares_count:m.shares_count??null,likes_count:m.likes_count??null,views_count:m.views_count??null,comments_is_lower_bound:Boolean(m.comments_is_lower_bound),views_is_approx:Boolean(m.views_is_approx),metric_note:m.metric_note??null};}
function stateText(postId,msg,cls=''){const el=document.querySelector(`[data-save-state="${postId}"]`);if(el){el.textContent=msg;el.className=`save-state ${cls}`;}}
function checkedText(postId,when){const el=document.querySelector(`[data-checked-at="${postId}"]`);if(el)el.textContent=fmtTime(when);}

async function ensureDraft(postId,field,value){
  const current=metricState.get(postId);
  if(current?.checked_at===null){
    const {data,error}=await supabase.from('post_metrics').update({[field]:value}).eq('id',current.id).select('*').single();
    if(error)throw error; metricState.set(postId,data); return data;
  }
  const payload={post_history_id:postId,checked_at:null,...(current?copyMetric(current):{}),[field]:value};
  const {data,error}=await supabase.from('post_metrics').insert(payload).select('*').single();
  if(error)throw error; metricState.set(postId,data); return data;
}

async function saveMetric(input){
  const postId=Number(input.dataset.postId),field=input.dataset.field,raw=input.value.trim();
  const value=raw===''?null:Number(raw);
  if(!postId||!field||(value!==null&&(!Number.isInteger(value)||value<0))){stateText(postId,'Invalid number','error');return;}
  input.disabled=true; stateText(postId,'Saving…','saving');
  try{await ensureDraft(postId,field,value);checkedText(postId,null);stateText(postId,'Saved','ok');}
  catch(e){stateText(postId,e.message||'Save failed','error');}
  finally{input.disabled=false;}
}

async function checkNow(button){
  const postId=Number(button.dataset.postId); if(!postId)return;
  button.disabled=true; stateText(postId,'Checking…','saving');
  try{
    const current=metricState.get(postId),now=new Date().toISOString();
    let res;
    if(current?.checked_at===null){
      res=await supabase.from('post_metrics').update({checked_at:now}).eq('id',current.id).select('*').single();
    }else{
      res=await supabase.from('post_metrics').insert({post_history_id:postId,checked_at:now,...(current?copyMetric(current):{})}).select('*').single();
    }
    if(res.error)throw res.error;
    metricState.set(postId,res.data); checkedText(postId,res.data.checked_at); stateText(postId,'Checked','ok');
  }catch(e){stateText(postId,e.message||'Check failed','error');}
  finally{button.disabled=false;}
}

async function load(){
  const offset=selectedDay==='today'?0:-1,start=vnDayStart(offset),end=vnDayStart(offset+1);
  $('reportDateLabel').textContent=`${selectedDay==='today'?'Today':'Yesterday'} · ${fmtDate(start)}`;

  const {data:posts,error}=await supabase.from('post_history')
    .select('id,group_id,prompt_id,prompt_code,submitted_at')
    .gte('submitted_at',start.toISOString()).lt('submitted_at',end.toISOString())
    .eq('time_is_signal',false).order('submitted_at',{ascending:true});
  if(error)throw error;
  const list=posts||[]; $('reportCount').textContent=`${list.length} posts`;
  $('reportRows').innerHTML=''; $('reportEmpty').classList.toggle('hidden',list.length>0); if(!list.length)return;

  const postIds=list.map(p=>p.id),groupIds=[...new Set(list.map(p=>p.group_id).filter(Boolean))],promptIds=[...new Set(list.map(p=>p.prompt_id).filter(Boolean))],promptCodes=[...new Set(list.map(p=>p.prompt_code).filter(Boolean))];
  const [gRes,pIdRes,pCodeRes,mRes]=await Promise.all([
    groupIds.length?supabase.from('facebook_groups').select('id,group_code,group_name').in('id',groupIds):Promise.resolve({data:[]}),
    promptIds.length?supabase.from('prompts').select('id,prompt_id,title').in('id',promptIds):Promise.resolve({data:[]}),
    promptCodes.length?supabase.from('prompts').select('id,prompt_id,title').in('prompt_id',promptCodes):Promise.resolve({data:[]}),
    supabase.from('post_metrics').select('*').in('post_history_id',postIds).order('created_at',{ascending:false})
  ]);
  for(const r of [gRes,pIdRes,pCodeRes,mRes])if(r.error)throw r.error;

  const groups=new Map((gRes.data||[]).map(x=>[x.id,x])),byId=new Map((pIdRes.data||[]).map(x=>[x.id,x])),byCode=new Map((pCodeRes.data||[]).map(x=>[x.prompt_id,x])),latest=new Map();
  for(const m of mRes.data||[])if(!latest.has(m.post_history_id))latest.set(m.post_history_id,m);
  metricState.clear(); for(const p of list){const m=latest.get(p.id);if(m)metricState.set(p.id,m);}

  $('reportRows').innerHTML=list.map(p=>{
    const g=groups.get(p.group_id),pr=byId.get(p.prompt_id)||byCode.get(p.prompt_code),m=latest.get(p.id),code=p.prompt_code||pr?.prompt_id||'—',title=pr?.title||'Title not saved yet';
    const metrics=[['likes_count','Like'],['comments_count','Comment'],['shares_count','Share'],['views_count','View']].map(([field,label])=>`<td data-label="${label}" class="report-metric-cell"><input class="metric-input" type="number" inputmode="numeric" min="0" step="1" data-post-id="${p.id}" data-field="${field}" value="${esc(val(m?.[field]))}" aria-label="${label} for ${esc(code)}"></td>`).join('');
    return `<tr>
      <td data-label="Time" class="report-time">${esc(fmtPostTime(p.submitted_at))}</td>
      <td data-label="Prompt" class="report-prompt"><strong>${esc(code)}</strong><span>${esc(title)}</span></td>
      <td data-label="Group" class="report-group"><strong>${esc(g?.group_code||'—')}</strong><span>${esc(g?.group_name||'Unknown group')}</span></td>
      ${metrics}
      <td data-label="Checked" class="report-check-cell"><button class="check-now-btn" data-action="check" data-post-id="${p.id}">Check now</button><span class="checked-at" data-checked-at="${p.id}">${esc(fmtTime(m?.checked_at))}</span><span class="save-state" data-save-state="${p.id}"></span></td>
    </tr>`;
  }).join('');
}

$('reportRows').addEventListener('change',e=>{const input=e.target.closest('.metric-input');if(input)saveMetric(input);});
$('reportRows').addEventListener('click',e=>{const b=e.target.closest('[data-action="check"]');if(b)checkNow(b);});
document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',async()=>{selectedDay=btn.dataset.day;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));try{await load();}catch(e){$('reportRows').innerHTML=`<tr><td colspan="8">Could not load report: ${esc(e.message)}</td></tr>`;}}));
try{await load();}catch(e){$('reportRows').innerHTML=`<tr><td colspan="8">Could not load report: ${esc(e.message)}</td></tr>`;}
