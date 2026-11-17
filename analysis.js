import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const $=id=>document.getElementById(id);
const esc=(s='')=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=n=>new Intl.NumberFormat('en-US').format(Number(n||0));
const avg=(a,b)=>b?Math.round((a/b)*10)/10:0;
const eng=m=>(Number(m?.likes_count||0)+Number(m?.comments_count||0)+Number(m?.shares_count||0));

function tierRank(t){return t==='s'?0:t==='a'?1:t==='b'?2:t==='c'?3:4;}
function signalLabel(p){
  const e=p.bestEngagement;
  if(e>=100&&p.groupsTested<2)return 'Breakout · replicate';
  if(e>=60)return p.groupsTested>=2?'Strong':'Promising';
  if(e>=20)return 'Promising';
  if(e>=5)return 'Weak signal';
  return 'Insufficient';
}
function groupAction(g){
  if(g.tier==='s')return 'Scale';
  if(g.tier==='a')return 'High priority';
  if(g.posts<2)return 'Needs more data';
  if(g.avgEngagement>=15)return 'Retest';
  if(g.avgEngagement<5)return 'Reduce';
  return 'Watch';
}
function tierClass(t){return 'tier-chip tier-'+(t||'unranked');}

function barChart(target,rows,labelKey,valueKey){
  const max=Math.max(1,...rows.map(r=>Number(r[valueKey]||0)));
  target.innerHTML=rows.map(r=>{
    const v=Number(r[valueKey]||0),w=Math.max(2,(v/max)*100);
    return '<div class="bar-row"><div class="bar-label">'+esc(r[labelKey])+'</div><div class="bar-track"><span style="width:'+w+'%"></span></div><strong>'+esc(v)+'</strong></div>';
  }).join('');
}
function lineChart(target,rows){
  if(!rows.length){target.innerHTML='<div class="analysis-empty">No trend data.</div>';return;}
  const w=640,h=190,p=24;
  const max=Math.max(1,...rows.map(r=>Math.max(r.comments,r.shares)));
  const x=i=>rows.length===1?w/2:p+i*((w-p*2)/(rows.length-1));
  const y=v=>h-p-(v/max)*(h-p*2);
  const path=key=>rows.map((r,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(r[key]).toFixed(1)).join(' ');
  const labels=rows.map((r,i)=>'<text x="'+x(i)+'" y="'+(h-4)+'" text-anchor="middle">'+esc(r.day.slice(5))+'</text>').join('');
  target.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Daily comments and shares trend"><path class="line-comments" d="'+path('comments')+'"></path><path class="line-shares" d="'+path('shares')+'"></path>'+labels+'</svg><div class="chart-legend"><span>Comments</span><span>Shares</span></div>';
}

async function load(){
  const [postsRes,groupsRes,promptsRes,metricsRes]=await Promise.all([
    supabase.from('post_history').select('id,group_id,prompt_id,prompt_code,submitted_at,time_is_signal'),
    supabase.from('facebook_groups').select('id,group_code,group_name,engagement_tier,posting_status,group_url'),
    supabase.from('prompts').select('id,prompt_id,title,content,category,dna'),
    supabase.from('post_metrics').select('*').order('created_at',{ascending:false})
  ]);
  for(const r of [postsRes,groupsRes,promptsRes,metricsRes])if(r.error)throw r.error;

  const groups=new Map((groupsRes.data||[]).filter(g=>g.posting_status!=='left').map(g=>[g.id,g]));
  const promptById=new Map((promptsRes.data||[]).map(p=>[p.id,p]));
  const promptByCode=new Map((promptsRes.data||[]).map(p=>[p.prompt_id,p]));
  const latest=new Map();
  for(const m of metricsRes.data||[])if(!latest.has(m.post_history_id))latest.set(m.post_history_id,m);

  const posts=(postsRes.data||[]).filter(p=>p.group_id===null||groups.has(p.group_id));
  const mapped=posts.filter(p=>p.group_id&&groups.has(p.group_id));
  const totals={posts:posts.length,groups:new Set(mapped.map(p=>p.group_id)).size,likes:0,comments:0,shares:0};
  const groupAgg=new Map(),promptAgg=new Map(),dailyAgg=new Map();

  for(const p of posts){
    const m=latest.get(p.id)||{};
    const likes=Number(m.likes_count||0),comments=Number(m.comments_count||0),shares=Number(m.shares_count||0);
    totals.likes+=likes;totals.comments+=comments;totals.shares+=shares;

    if(p.group_id&&groups.has(p.group_id)){
      const g=groups.get(p.group_id);
      if(!groupAgg.has(p.group_id))groupAgg.set(p.group_id,{...g,tier:g.engagement_tier||'unranked',posts:0,likes:0,comments:0,shares:0});
      const a=groupAgg.get(p.group_id);a.posts++;a.likes+=likes;a.comments+=comments;a.shares+=shares;
    }

    const pr=promptById.get(p.prompt_id)||promptByCode.get(p.prompt_code);
    const key=pr?.prompt_id||p.prompt_code||('post-'+p.id);
    if(!promptAgg.has(key))promptAgg.set(key,{promptId:key,title:pr?.title||'',quote:pr?.content||'',dna:pr?.dna||'',category:pr?.category||'',posts:0,groups:new Set(),likes:0,comments:0,shares:0,bestEngagement:0});
    const pa=promptAgg.get(key);pa.posts++;if(p.group_id)pa.groups.add(p.group_id);pa.likes+=likes;pa.comments+=comments;pa.shares+=shares;pa.bestEngagement=Math.max(pa.bestEngagement,likes+comments+shares);

    if(!p.time_is_signal&&p.submitted_at){
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.submitted_at));
      if(!dailyAgg.has(day))dailyAgg.set(day,{day,posts:0,comments:0,shares:0});
      const d=dailyAgg.get(day);d.posts++;d.comments+=comments;d.shares+=shares;
    }
  }

  const groupRows=[...groupAgg.values()].map(g=>({...g,avgEngagement:avg(g.likes+g.comments+g.shares,g.posts)})).sort((a,b)=>b.avgEngagement-a.avgEngagement);
  const promptRows=[...promptAgg.values()].map(p=>({...p,groupsTested:p.groups.size})).sort((a,b)=>b.bestEngagement-a.bestEngagement);
  const dailyRows=[...dailyAgg.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const tiers=new Map();
  for(const g of groupRows){
    if(!tiers.has(g.tier))tiers.set(g.tier,{tier:g.tier,groups:0,posts:0,engagement:0});
    const t=tiers.get(g.tier);t.groups++;t.posts+=g.posts;t.engagement+=g.likes+g.comments+g.shares;
  }
  const tierRows=[...tiers.values()].map(t=>({...t,avgEngagement:avg(t.engagement,t.posts)})).sort((a,b)=>tierRank(a.tier)-tierRank(b.tier));

  $('analysisKpis').innerHTML=[
    ['Posts',totals.posts],
    ['Mapped Groups',totals.groups],
    ['Comments',fmt(totals.comments)],
    ['Shares',fmt(totals.shares)]
  ].map(([k,v])=>'<article class="analysis-kpi"><span>'+k+'</span><strong>'+v+'</strong></article>').join('');

  const topGroup=groupRows[0];
  const topPrompt=promptRows[0];
  const sTier=tierRows.find(t=>t.tier==='s');
  const bTier=tierRows.find(t=>t.tier==='b');
  const ratio=sTier&&bTier&&bTier.avgEngagement?Math.round((sTier.avgEngagement/bTier.avgEngagement)*10)/10:null;
  $('executiveSummary').innerHTML=[
    topGroup?'<p><strong>'+esc(topGroup.group_code)+' · '+esc(topGroup.group_name)+'</strong> đang có hiệu suất trung bình cao nhất: '+esc(topGroup.avgEngagement)+' engagement/post.</p>':'',
    topPrompt?'<p><strong>'+esc(topPrompt.promptId)+'</strong> là breakout signal mạnh nhất hiện tại với best engagement '+fmt(topPrompt.bestEngagement)+'.</p>':'',
    ratio?'<p>S-tier đang tạo engagement/post cao khoảng <strong>'+ratio+'×</strong> B-tier. Nên phân bổ bài có confidence cao vào S/A trước, B dùng nhiều hơn cho exploratory testing.</p>':'',
    '<p>Dataset vẫn còn nhỏ và nhiều prompt mới test 1 lần, nên mọi “winner” cần được replication trước khi coi là công thức ổn định.</p>'
  ].join('');

  barChart($('groupChart'),groupRows.slice(0,8).map(g=>({label:g.group_code,value:g.avgEngagement})),'label','value');
  barChart($('tierChart'),tierRows.map(t=>({label:t.tier.toUpperCase(),value:t.avgEngagement})),'label','value');
  lineChart($('dailyChart'),dailyRows);

  const weakMulti=groupRows.filter(g=>g.posts>=2&&g.avgEngagement<8);
  const underTested=groupRows.filter(g=>g.posts<2&&g.tier!=='s'&&g.tier!=='a');
  const recommendations=[];
  if(topPrompt)recommendations.push('Nhân bản <strong>mechanic</strong> của '+esc(topPrompt.promptId)+' thành 2–3 biến thể mới, nhưng đổi wording và góc kể. Sau đó test chéo ở ít nhất 1 A-tier và 1 B-tier để kiểm tra độ portable.');
  if(groupRows.some(g=>g.tier==='s'))recommendations.push('Ưu tiên S/A cho bài đã có tín hiệu mạnh. Đừng chia đều “winner” cho tất cả group; dùng B-tier để test ý tưởng mới trước.');
  if(weakMulti.length)recommendations.push('Giảm tần suất ở '+weakMulti.map(g=>'<strong>'+esc(g.group_code)+'</strong>').join(', ')+' cho tới khi có mechanic tốt hơn. Các group này đã có nhiều hơn một test nhưng signal vẫn yếu.');
  if(underTested.length)recommendations.push('Chưa loại '+underTested.slice(0,4).map(g=>'<strong>'+esc(g.group_code)+'</strong>').join(', ')+'. Sample còn mỏng; cho mỗi group thêm 2–3 controlled tests bằng DNA đã thắng rồi mới xếp hạng.');
  recommendations.push('Theo dõi <strong>shares</strong> tách riêng khỏi comments. Prompt tạo tranh luận và prompt khiến người ta share là hai loại tài sản khác nhau; group có share-rate tốt đáng được ưu tiên cho nội dung identity/family.');
  recommendations.push('Nên tiếp tục <strong>tìm thêm group</strong>. Pool S/A hiện còn hẹp, nên mục tiêu hợp lý là tìm thêm 5–10 group tương tự các group đang thắng, ưu tiên nữ U40+, comment culture mạnh và chủ đề women/everyday life/family/self-love. Test mỗi group mới bằng 2–3 proven mechanics trước khi tăng volume.');
  $('recommendations').innerHTML=recommendations.map((r,i)=>'<article><span>'+(i+1)+'</span><p>'+r+'</p></article>').join('');

  $('groupPerformanceRows').innerHTML=groupRows.map(g=>'<tr><td><strong>'+esc(g.group_code)+'</strong><span>'+esc(g.group_name)+'</span></td><td><span class="'+tierClass(g.tier)+'">'+esc(g.tier.toUpperCase())+'</span></td><td>'+g.posts+'</td><td>'+g.avgEngagement+'</td><td>'+fmt(g.comments)+'</td><td>'+fmt(g.shares)+'</td><td><span class="action-label">'+esc(groupAction(g))+'</span></td></tr>').join('');

  $('promptPerformanceRows').innerHTML=promptRows.slice(0,15).map(p=>'<tr><td><strong>'+esc(p.promptId)+'</strong><span title="'+esc(p.quote||p.title)+'">'+esc(p.quote||p.title||'—')+'</span></td><td>'+p.posts+'</td><td>'+p.groupsTested+'</td><td>'+fmt(p.comments)+'</td><td>'+fmt(p.shares)+'</td><td><span class="signal-label">'+esc(signalLabel(p))+'</span></td></tr>').join('');

  const topS=groupRows.filter(g=>g.tier==='s'||g.tier==='a').slice(0,4).map(g=>g.group_code).join(', ');
  const next=[
    topPrompt?'Tạo 2–3 biến thể mới dựa trên mechanic của '+topPrompt.promptId+'; không copy câu chữ.':'Tạo thêm biến thể từ mechanic đang có engagement cao nhất.',
    topS?'Đưa các biến thể có confidence cao vào '+topS+' trước; giữ B-tier làm nơi exploratory test.':'Ưu tiên group có avg engagement cao nhất cho prompt đã thắng.',
    'Mỗi winner chỉ được gọi là “proven” sau khi test ở nhiều hơn một group. Gắn nhãn Breakout / Promising / Weak dựa trên cả performance lẫn sample size.',
    'Tìm thêm 5–10 group lookalike từ các S/A hiện tại. Đừng chỉ nhìn member count; ưu tiên comment culture, audience fit và mức tương tác trên post gần đây.',
    'Mỗi group mới: chạy 2–3 proven mechanics có kiểm soát, sau đó mới quyết định Scale / Watch / Reduce.',
    'Review lại Analysis sau mỗi batch metrics mới để điều chỉnh phân bổ group và content.'
  ];
  $('nextSteps').innerHTML=next.map(x=>'<li>'+esc(x)+'</li>').join('');
}

try{await load();}catch(e){
  document.querySelector('.analysis-main').innerHTML='<section class="analysis-section"><h2>Could not load analysis</h2><p class="muted">'+esc(e.message)+'</p></section>';
}
