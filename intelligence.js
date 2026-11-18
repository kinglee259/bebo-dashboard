import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
export const esc=(s='')=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export const fmt=n=>new Intl.NumberFormat('en-US').format(Number(n||0));
export const avg=(a,b)=>b?Math.round((a/b)*10)/10:0;
export const median=arr=>{const a=[...arr].map(Number).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
export const shortText=(s='',n=88)=>{const v=String(s||'').trim();return v.length>n?v.slice(0,n-1).trim()+'…':v};
export const promptQuote=(prompt={},n=88)=>shortText(prompt?.content||prompt?.title||'Chưa có nội dung',n);

const cleanToken=s=>String(s||'').replace(/^DNA[- ]?\d+\s*/i,'').replace(/^[+\-\s]+|[+\-\s]+$/g,'').trim();
export function mechanicTokens(dna,category=''){
  let parts=[];const raw=String(dna||'').trim();
  if(raw)parts=raw.split(/\s*\/\s*|\s*\+\s*/).map(cleanToken).filter(Boolean);
  parts=parts.filter(x=>x.length>2&&!/^CAT-\d+$/i.test(x));
  if(!parts.length&&category)parts=[String(category).trim()];
  return [...new Set(parts)].slice(0,5);
}
export function familyOf(p={}){
  const s=((p.category||'')+' '+(p.dna||'')+' '+(p.title||'')+' '+(p.content||'')).toLowerCase();
  if(/mother|mom|family|grand|child|parent/.test(s))return'Gia đình';
  if(/women|woman|female|clothing|bra|shoe|pocket/.test(s))return'Phụ nữ';
  if(/relationship|partner|dating|love|single/.test(s))return'Tình cảm';
  if(/money|grocery|cost|price|bill|tip/.test(s))return'Đời sống';
  if(/emotion|feeling|tired|stress|self love|boundary|solitude/.test(s))return'Cảm xúc';
  if(/work|coworker|boss|shift/.test(s))return'Công việc';
  if(/nostalgia|memory|old-fashioned|childhood/.test(s))return'Hoài niệm';
  return'Khác';
}
export function roleOf(r){
  const c=+r.comments||0,s=+r.shares||0,l=+r.likes||0;
  if(c>=20&&s>=Math.max(5,c*.18))return'Cân bằng bình luận & chia sẻ';
  if(s>=5&&s>c*.28)return'Kéo chia sẻ';
  if(c>=10&&c>=s*2)return'Kéo bình luận';
  if(l>=10&&c<5&&s<5)return'Thiên về lượt thích';
  return'Chưa rõ';
}
export function confidenceOf(r){
  const tests=+r.posts||0,groups=+r.groupsTested||0,wins=+r.wins||0;
  if(groups>=3&&tests>=4&&wins/tests>=.6)return'Đã xác nhận';
  if(groups>=2&&wins>=2)return'Đã lặp lại tốt';
  if(wins>=1)return'Cần thử thêm';
  if(tests>=2)return'Tín hiệu yếu';
  return'Chưa đủ dữ liệu';
}
export function groupAction(g){
  if(g.tier==='s')return'Ưu tiên cao';
  if(g.tier==='a')return'Ưu tiên';
  if(g.posts<2)return'Cần thêm dữ liệu';
  if(g.avgEngagement<5)return'Giảm ưu tiên';
  return'Thử thêm';
}
export function promptAction(p){
  if(p.groupsTested>=3&&p.wins>=2)return'Tạo thêm biến thể';
  if(p.wins>=1)return'Thử ở '+Math.max(1,2-p.groupsTested)+'–2 nhóm khác';
  if(p.posts>=2)return'Đổi góc hoặc dừng';
  return'Cần thêm dữ liệu';
}
export function signalText(p){
  if(p.bestOutlier>=4)return'Vượt trội rõ';
  if(p.bestOutlier>=2)return'Vượt trội';
  if(p.bestOutlier>=1.3)return'Tốt hơn bình thường';
  return p.wins>0?'Kết quả tốt':'Chưa rõ';
}

export async function loadIntelligence(){
  const [postRes,groupRes,promptRes,metricRes]=await Promise.all([
    supabase.from('post_history').select('id,group_id,prompt_id,prompt_code,submitted_at,time_is_signal,status'),
    supabase.from('facebook_groups').select('id,group_code,group_name,engagement_tier,posting_status,group_url,member_count,target_fit'),
    supabase.from('prompts').select('id,prompt_id,title,content,category,dna,status,source_prompt_id,root_prompt_id'),
    supabase.from('post_metrics').select('*').order('created_at',{ascending:false}).order('id',{ascending:false})
  ]);
  for(const r of [postRes,groupRes,promptRes,metricRes])if(r.error)throw r.error;

  const groups=new Map((groupRes.data||[]).filter(g=>g.posting_status!=='left').map(g=>[g.id,g]));
  const promptById=new Map((promptRes.data||[]).map(p=>[p.id,p]));
  const promptByCode=new Map((promptRes.data||[]).map(p=>[p.prompt_id,p]));
  const latest=new Map();
  for(const m of metricRes.data||[])if(!latest.has(m.post_history_id))latest.set(m.post_history_id,m);

  let posts=(postRes.data||[])
    .filter(p=>p.group_id===null||groups.has(p.group_id))
    .map(p=>{
      const m=latest.get(p.id)||{};
      const prompt=promptById.get(p.prompt_id)||promptByCode.get(p.prompt_code)||{};
      const group=groups.get(p.group_id)||null;
      const likes=+m.likes_count||0,comments=+m.comments_count||0,shares=+m.shares_count||0;
      return {...p,prompt,group,likes,comments,shares,engagement:likes+comments+shares,family:familyOf(prompt)};
    });

  const groupPosts=new Map();
  for(const p of posts.filter(x=>x.group)){
    if(!groupPosts.has(p.group_id))groupPosts.set(p.group_id,[]);
    groupPosts.get(p.group_id).push(p);
  }
  const baselines=new Map();
  for(const [gid,rows] of groupPosts)baselines.set(gid,Math.max(1,median(rows.map(r=>r.engagement))));

  posts=posts
    .map(p=>({...p,baseline:p.group?baselines.get(p.group_id)||1:1,outlierRatio:p.group?Math.round(p.engagement/(baselines.get(p.group_id)||1)*10)/10:0}))
    .map(p=>({...p,isWin:(p.engagement>=20&&p.outlierRatio>=1.5)||p.comments>=20||p.shares>=8}));

  const groupRows=[...groupPosts.entries()].map(([gid,rows])=>{
    const g=groups.get(gid);
    const likes=rows.reduce((a,x)=>a+x.likes,0),comments=rows.reduce((a,x)=>a+x.comments,0),shares=rows.reduce((a,x)=>a+x.shares,0);
    const families={};
    for(const r of rows)(families[r.family]??=[]).push(r);
    const familyScores=Object.entries(families)
      .map(([family,list])=>({family,posts:list.length,avg:avg(list.reduce((a,x)=>a+x.engagement,0),list.length),wins:list.filter(x=>x.isWin).length}))
      .sort((a,b)=>b.avg-a.avg);
    return {...g,tier:g.engagement_tier||'unranked',posts:rows.length,likes,comments,shares,avgEngagement:avg(likes+comments+shares,rows.length),wins:rows.filter(x=>x.isWin).length,topFamily:familyScores[0]||null,familyScores};
  }).sort((a,b)=>b.avgEngagement-a.avgEngagement);

  const promptMap=new Map();
  for(const p of posts){
    const key=p.prompt?.prompt_id||p.prompt_code||('post-'+p.id);
    if(!promptMap.has(key))promptMap.set(key,{promptId:key,prompt:p.prompt,posts:0,groups:new Set(),likes:0,comments:0,shares:0,bestEngagement:0,bestOutlier:0,wins:0,family:p.family});
    const q=promptMap.get(key);
    q.posts++;if(p.group_id)q.groups.add(p.group_id);q.likes+=p.likes;q.comments+=p.comments;q.shares+=p.shares;
    q.bestEngagement=Math.max(q.bestEngagement,p.engagement);q.bestOutlier=Math.max(q.bestOutlier,p.outlierRatio);if(p.isWin)q.wins++;
  }
  const promptRows=[...promptMap.values()]
    .map(p=>({...p,groupsTested:p.groups.size,role:roleOf(p),confidence:confidenceOf({...p,groupsTested:p.groups.size})}))
    .sort((a,b)=>b.bestEngagement-a.bestEngagement);

  const mechanicMap=new Map();
  for(const p of posts){
    for(const token of mechanicTokens(p.prompt?.dna,p.prompt?.category)){
      if(!mechanicMap.has(token))mechanicMap.set(token,{mechanic:token,posts:0,prompts:new Set(),groups:new Set(),likes:0,comments:0,shares:0,wins:0,outliers:[],examplePrompt:p.prompt,exampleCode:p.prompt?.prompt_id||p.prompt_code||''});
      const q=mechanicMap.get(token);
      q.posts++;q.prompts.add(p.prompt?.prompt_id||p.prompt_code||p.id);if(p.group_id)q.groups.add(p.group_id);
      q.likes+=p.likes;q.comments+=p.comments;q.shares+=p.shares;if(p.isWin)q.wins++;if(p.outlierRatio)q.outliers.push(p.outlierRatio);
      if(p.engagement>(q.exampleEngagement||-1)){q.exampleEngagement=p.engagement;q.examplePrompt=p.prompt;q.exampleCode=p.prompt?.prompt_id||p.prompt_code||'';}
    }
  }
  const mechanicRows=[...mechanicMap.values()]
    .map(m=>({...m,promptCount:m.prompts.size,groupsTested:m.groups.size,avgEngagement:avg(m.likes+m.comments+m.shares,m.posts),confidence:confidenceOf({posts:m.posts,groupsTested:m.groups.size,wins:m.wins})}))
    .sort((a,b)=>(b.wins-a.wins)||(b.avgEngagement-a.avgEngagement));

  const totals={posts:posts.length,groups:groupRows.length,prompts:promptRows.length,likes:posts.reduce((a,x)=>a+x.likes,0),comments:posts.reduce((a,x)=>a+x.comments,0),shares:posts.reduce((a,x)=>a+x.shares,0)};
  return {posts,groups:groupRows,prompts:promptRows,mechanics:mechanicRows,totals};
}