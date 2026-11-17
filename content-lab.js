import { loadIntelligence, esc, fmt, shortText, promptAction } from './intelligence.js';
const $=id=>document.getElementById(id);
try{
  const d=await loadIntelligence();
  $('conceptRows').innerHTML=d.mechanics.slice(0,15).map(m=>{
    const ex=m.examplePrompt||{};
    const example=(m.exampleCode?m.exampleCode+' · ':'')+(ex.title||shortText(ex.content||'Chưa có ví dụ',58));
    return '<tr><td class="identity-cell"><strong>'+esc(m.mechanic)+'</strong></td><td>'+esc(example)+'</td><td>'+m.posts+' lần</td><td>'+m.groupsTested+'</td><td>'+m.avgEngagement+'</td><td>'+esc(m.confidence)+'</td></tr>';
  }).join('')||'<tr><td colspan="6" class="analysis-empty">Chưa đủ dữ liệu concept.</td></tr>';

  const byComments=[...d.prompts].sort((a,b)=>b.comments-a.comments)[0];
  const byShares=[...d.prompts].sort((a,b)=>b.shares-a.shares)[0];
  const balanced=[...d.prompts].sort((a,b)=>Math.min(b.comments,b.shares*4)-Math.min(a.comments,a.shares*4))[0];
  const roleItems=[
    ['Kéo bình luận tốt nhất',byComments,byComments?fmt(byComments.comments)+' bình luận':'—'],
    ['Kéo chia sẻ tốt nhất',byShares,byShares?fmt(byShares.shares)+' chia sẻ':'—'],
    ['Cân bằng tốt',balanced,balanced?fmt(balanced.comments)+' bình luận · '+fmt(balanced.shares)+' chia sẻ':'—']
  ].filter(x=>x[1]);
  $('roleRows').innerHTML=roleItems.map(([label,p,metric])=>'<article><div><strong>'+esc(label)+'</strong><span>'+esc(p.promptId)+' · '+esc(p.prompt?.title||shortText(p.prompt?.content||'',75))+'</span></div><b>'+esc(metric)+'</b></article>').join('');

  $('contentWinnerRows').innerHTML=d.prompts.filter(p=>p.wins>0).slice(0,12).map(p=>'<tr><td class="identity-cell"><strong>'+esc(p.promptId)+'</strong><span>'+esc(p.prompt?.title||shortText(p.prompt?.content||'Chưa có tiêu đề',76))+'</span></td><td>'+esc(p.role)+'</td><td>'+fmt(p.comments)+' bình luận · '+fmt(p.shares)+' chia sẻ</td><td>'+p.posts+' lần · '+p.groupsTested+' nhóm</td><td>'+esc(promptAction(p))+'</td></tr>').join('');
}catch(e){document.querySelector('.analysis-main').innerHTML='<section class="analysis-section"><p class="analysis-empty">'+esc(e.message)+'</p></section>';}