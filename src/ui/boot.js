/* A paintable startup shell; released by actual application readiness, never a fake timer. */
(()=>{
 const overlay=document.getElementById('app-boot'),html=document.documentElement;
 let finished=false,failed=false,complete;
 const whenReady=new Promise(resolve=>complete=resolve);
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 const releaseNative=()=>window.MihrabStartup?.bootMarkupReady?.();
 const fail=error=>{
  if(finished)return;failed=true;releaseNative();
  overlay.dataset.state='error';overlay.querySelector('.boot-progress').hidden=true;
  document.getElementById('boot-status').textContent='تعذر فتح محراب. '+(error?.message||'أعد المحاولة.');
  document.getElementById('boot-retry').hidden=false;
  console.error('[Mihrab startup]',error);
 };
 async function ready(){
  if(finished||failed)return;
  await document.fonts?.ready;
  const logo=overlay.querySelector('img');
  if(logo?.decode)await logo.decode().catch(()=>{});
  await frame();await frame();
  if(failed)return;
  finished=true;html.classList.remove('app-loading');html.classList.add('app-entering');
  overlay.classList.add('is-leaving');
  await Promise.all(overlay.getAnimations({subtree:true}).filter(x=>x.effect?.getTiming().iterations!==Infinity).map(x=>x.finished.catch(()=>{})));
  overlay.remove();html.classList.remove('app-entering');complete();
  window.dispatchEvent(new Event('mihrab-ready'));
 }
 document.getElementById('boot-retry').addEventListener('click',()=>location.reload());
 window.addEventListener('error',event=>{if(!finished)fail(event.error||Error(event.message||'تعذر تحميل أحد ملفات الواجهة.'));});
 window.addEventListener('unhandledrejection',event=>{if(!finished)fail(event.reason instanceof Error?event.reason:Error(String(event.reason)));});
 window.MihrabBoot={ready,fail,whenReady};
 releaseNative();
})();
