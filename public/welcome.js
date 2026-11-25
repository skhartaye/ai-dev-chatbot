// Keep existing conversation bookmarks and pre-landing email links working.
const url=new URL(location.href);
if(url.searchParams.has('conversation')||url.searchParams.has('code')||url.searchParams.has('signin')||url.hash.includes('access_token=')||url.hash.includes('error=')) {
  url.pathname='/chat';location.replace(url.pathname+url.search+url.hash);
}
const examples={
  pdf:['Project brief.pdf','Launch plan',['Gather feedback from the pilot group.','Refine the onboarding flow.','Prepare a focused first release.'],'“Pull out the key decisions and next steps.”'],
  word:['Team update.docx','A clearer first draft',['The pilot is ready for a closer look.','We’ll collect notes from the first group.','Their feedback will shape the next version.'],'“Make this shorter and more direct.”'],
  excel:['Project budget.xlsx','A small launch budget',['Design review · ₱2,000','Pilot materials · ₱1,500','Team workshop · ₱3,000'],'“Add a formula to calculate the total.”'],
  image:['Whiteboard.png','Notes from the room',['A rough idea.','A few useful questions.','One clear place to start.'],'“Read the notes and turn them into a plan.”'],
};
for(const button of document.querySelectorAll('[data-file-demo]')) button.addEventListener('click',()=>{
  for(const other of document.querySelectorAll('[data-file-demo]')) other.setAttribute('aria-pressed',String(other===button));
  const [name,title,lines,question]=examples[button.dataset.fileDemo];
  document.querySelector('#demo-filename').textContent=name;
  const preview=document.querySelector('#demo-preview'),heading=document.createElement('span');heading.textContent=title;
  preview.replaceChildren(heading,...lines.map(text=>{const p=document.createElement('p');p.textContent=text;return p}));
  document.querySelector('#demo-question').textContent=question;
});
