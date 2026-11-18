import { loadIntelligence, esc, fmt, promptQuote, promptAction } from './intelligence.js';
const $=id=>document.getElementById(id);
try{
  const d=await loadIntelligence();
  const winners=d.prompts.filter(p=>p.wins>0&&p.groupsTested<2).slice(0,5);
  const groupsNeed=d.groups.filter(g=>g.posts<2).slice(0,4);
  const queue=[];
  for(const p of winners)queue.push('<article><div><strong>'+esc(p.promptId)+' · '+esc(promptQuote(p.prompt,96))+'</strong><span>'+fmt(p.comments)+' bình luận · '+fmt(p.shares)+' chia sẻ · mới thử ở '+p.groupsTested+' nhóm</span></div><b>'+esc(promptAction(p))+'</b></article>');
  for(const g of groupsNeed)queue.push('<article><div><strong>'+esc(g.group_code)+' · '+esc(g.group_name)+'</strong><span>Mới có '+g.posts+' bài, chưa đủ để đánh giá nhóm.</span></div><b>Thử thêm 2–3 bài tốt</b></article>');
  $('testQueue').innerHTML=queue.join('')||'<p class="analysis-empty">Chưa có test cần ưu tiên.</p>';

  $('replicationRows').innerHTML=d.prompts.filter(p=>p.wins>0).slice(0,12).map(p=>'<tr><td class="identity-cell"><strong>'+esc(p.promptId)+'</strong><span>'+esc(promptQuote(p.prompt,96))+'</span></td><td>'+fmt(p.comments)+' bình luận · '+fmt(p.shares)+' chia sẻ</td><td>'+p.posts+' lần · '+p.groupsTested+' nhóm</td><td>'+esc(promptAction(p))+'</td></tr>').join('');
}catch(e){document.querySelector('.analysis-main').innerHTML='<section class="analysis-section"><p class="analysis-empty">'+esc(e.message)+'</p></section>';}