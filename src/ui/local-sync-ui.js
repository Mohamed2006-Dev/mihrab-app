function bindLocalSync() {
  const panel=document.getElementById('data-settings-section-panel-sync');
  const message=panel.querySelector('[data-sync-message]');
  const content=panel.querySelector('[data-sync-content]');
  const mobile=Boolean(window.MihrabLocalSync);
  const api=mobile?window.MihrabLocalSync:window.mihrabApi;
  let renderTimer=null;
  let busy=false;
  const devices=document.getElementById('sync-device-dialog');
  const deviceList=devices.querySelector('[data-sync-devices]');
  const deviceStatus=devices.querySelector('[data-sync-device-status]');
  let editDirection;
  let editingDevice=false;
  let stream=null;
  let scanFrame=0;
  let cameraGeneration=0;
  let pairingSelect=null;
  const codePrefix='mihrab1.';
  const isInvite=raw=>{
    try {
      const invite=JSON.parse(raw);
      return invite.version===1 && invite.port===17777 &&
        /^[A-Za-z0-9_-]{43}$/.test(invite.invitation||'') &&
        /^[a-f0-9]{64}$/.test(invite.pin||'');
    } catch { return false; }
  };
  const encodeInvite=raw=>codePrefix+btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const decodeInvite=code=>{
    const value=code.replace(/\s+/g,'');
    if(!/^mihrab1\.[A-Za-z0-9_-]{1,700}$/.test(value))throw Error('رمز الربط النصي غير صالح.');
    try{return atob(value.slice(codePrefix.length).replace(/-/g,'+').replace(/_/g,'/'));}
    catch{throw Error('رمز الربط النصي غير صالح.');}
  };
  function showSelect(label,options){
    if(!pairingSelect){
      pairingSelect=document.createElement('select');
      pairingSelect.id='local-sync-select';
      pairingSelect.className='select-field';
      pairingSelect.setAttribute('aria-label',label);
      content.append(pairingSelect);
      installCustomSelect(pairingSelect);
    }
    const selected=pairingSelect.value;
    pairingSelect.replaceChildren(...options.map(([value,text])=>new Option(text,value)));
    if(options.some(([value])=>value===selected))pairingSelect.value=selected;
    content.append(pairingSelect.closest('.custom-select'));
    customSelects.get(pairingSelect)?.sync();
    return pairingSelect;
  }
  const scanner=mobile?document.getElementById('sync-camera-dialog'):null;
  const camera=scanner?.querySelector('video');
  const cameraStatus=scanner?.querySelector('[data-sync-camera-status]');
  scanner?.addEventListener('close',stopCamera);
  const labels={channels:'القنوات المتابعة',reminders:'التذكيرات المخصّصة',wird:'إعدادات الأوراد وتقدّمها',location:'الموقع من الهاتف'};
  const directions={'phone-to-desktop':'من الهاتف إلى الحاسوب','desktop-to-phone':'من الحاسوب إلى الهاتف','two-way':'تبادلي'};
  function button(label,action,style='btn-secondary'){
    const node=document.createElement('button');
    node.type='button';node.className='btn '+style;node.textContent=label;
    node.onclick=()=>run(action);return node;
  }
  function note(text){
    const p=document.createElement('p');p.textContent=text;return p;
  }
  async function run(action){
    if(busy)return;
    busy=true;message.textContent='';deviceStatus.textContent='';
    try{await action();}
    catch(error){(devices.open?deviceStatus:message).textContent=error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');}
    finally{busy=false;}
  }
  function stopCamera(){
    cameraGeneration++;
    cancelAnimationFrame(scanFrame);
    stream?.getTracks().forEach(track=>track.stop());
    stream=null;
    if(camera)camera.srcObject=null;
  }
  function makeChoices(selected=[]){
    const fieldset=document.createElement('fieldset');
    const legend=document.createElement('legend');legend.textContent='البيانات التي ستتزامن';fieldset.append(legend);
    for(const [value,label] of Object.entries(labels)){
      const row=document.createElement('label');row.className='settings-switch';
      const check=document.createElement('input');check.type='checkbox';check.value=value;
      check.checked=selected.includes(value);check.setAttribute('role','switch');
      const span=document.createElement('span');span.textContent=label;
      row.append(span,check);fieldset.append(row);
    }
    return fieldset;
  }
  function bindLocationChoice(select,choices){
    const location=choices.querySelector('input[value="location"]');
    const update=()=>{
      const allowed=select.value!=='desktop-to-phone';
      location.closest('label').hidden=!allowed;
      location.disabled=!allowed;
      if(!allowed)location.checked=false;
    };
    update();
    return update;
  }
  function editDevice(peer,state){
    editingDevice=true;
    deviceList.replaceChildren(note('تعديل اتصال '+peer.host));
    if(!editDirection){
      editDirection=document.createElement('select');
      editDirection.id='sync-edit-direction';
      editDirection.className='select-field';
      editDirection.setAttribute('aria-label','اتجاه الربط');
      deviceList.append(editDirection);
      installCustomSelect(editDirection);
    }
    editDirection.replaceChildren(...Object.entries(directions)
      .filter(([value])=>state.links.length<=1||value==='phone-to-desktop')
      .map(([value,label])=>new Option(label,value)));
    editDirection.value=peer.link.direction;
    deviceList.append(editDirection.closest('.custom-select'));
    customSelects.get(editDirection)?.sync();
    const choices=makeChoices(peer.link.groups);
    editDirection.onchange=bindLocationChoice(editDirection,choices);
    const actions=document.createElement('div');actions.className='local-sync-actions';
    actions.append(button('حفظ خصائص الربط',async()=>{
      const groups=[...choices.querySelectorAll('input:checked:not(:disabled)')].map(input=>input.value);
      if(!groups.length)throw Error('اختر مجموعة بيانات واحدة على الأقل.');
      const updated=await api.syncConfigure(peer.link.desktopId,editDirection.value,groups);
      showDevices(updated);
      showSuccessFeedback('تم تحديث خصائص الربط.');
    },'btn-primary'),button('رجوع',async()=>showDevices(await api.syncStatus())));
    deviceList.append(choices,actions);
  }
  function showDevices(state){
    editingDevice=false;
    if(editDirection)customSelects.get(editDirection)?.close();
    deviceList.replaceChildren();
    const peers=mobile?state.links:state.linked?[{host:state.host,link:state.link}]:[];
    if(!peers.length){deviceList.append(note('لا توجد أجهزة مرتبطة.'));return;}
    for(const peer of peers){
      const row=document.createElement('div');row.className='local-sync-row';
      const details=directions[peer.link.direction]+' · '+peer.link.groups.map(group=>labels[group]).join('، ');
      const summary=mobile?(peer.conflicts?.length?'تعارض: '+peer.conflicts.map(group=>labels[group]).join('، '):
        peer.last?'آخر اتصال '+new Date(peer.last).toLocaleTimeString('ar'):'بانتظار اتصال'):
        state.online?'بانتظار الهاتف على '+state.host:'عنوان الشبكة غير متاح.';
      const actions=document.createElement('div');actions.className='local-sync-actions';
      if(mobile)actions.append(button('تعديل الاتصال',()=>editDevice(peer,state)));
      actions.append(button('فك الربط',async()=>{
        if(!window.confirm('فك ربط هذا الجهاز؟'))return;
        await api.syncUnlink(mobile?peer.link.desktopId:undefined);
        devices.close();await render();showSuccessFeedback('تم فك ربط الجهاز.');
      },'btn-danger'));
      row.append(note(mobile?peer.host:'الهاتف المرتبط'),note(details),note(summary),actions);
      if(!mobile)row.append(note('يمكن تعديل اتجاه الاتصال والبيانات من الهاتف المرتبط.'));
      deviceList.append(row);
    }
  }
  api.onSyncLinkChanged?.(()=>{
    if(!panel.hidden&&document.getElementById('tab-settings').classList.contains('active'))run(render);
  });
  window.addEventListener('mihrab-sync-applied',()=>{
    if(devices.open&&!editingDevice)api.syncStatus().then(showDevices).catch(()=>{});
  });
  async function render(){
    const state=await api.syncStatus();
    if(pairingSelect)customSelects.get(pairingSelect)?.close();
    content.replaceChildren();
    if(mobile){
      if(state.links.length)content.append(button('الأجهزة المرتبطة ('+state.links.length+')',async()=>{
        showDevices(await api.syncStatus());
        devices.showModal();
      }));
      if(state.links.length)content.append(button('زامن الآن',async()=>{await api.syncNow();await render();}));
      if(state.candidate){
        content.append(note('طابق الرمز '+state.candidate+' في نافذة الحاسوب، ثم وافق عليه من الحاسوب.'),
          button('إكمال الربط',async()=>{
            const result=await api.syncFinish();
            if(result.waiting)message.textContent='بانتظار موافقة الحاسوب.';
            else {await render();showSuccessFeedback('تم ربط الهاتف بالحاسوب.');}
          },'btn-primary'),
          button('إلغاء الدعوة',async()=>{await api.syncCancel();await render();}));
        return;
      }
      if(state.links.length>=4||state.links.some(peer=>peer.link.direction!=='phone-to-desktop'))return;
      const select=showSelect('اتجاه المزامنة',Object.entries(directions)
        .filter(([value])=>!state.links.length||value==='phone-to-desktop'));
      const choices=makeChoices();
      select.onchange=bindLocationChoice(select,choices);
      content.append(choices);
      const pair=async raw=>{
        const groups=[...choices.querySelectorAll('input:checked')].map(input=>input.value);
        if(!groups.length)throw Error('اختر مجموعة بيانات واحدة على الأقل.');
        if(!isInvite(raw))throw Error('استخدم رمز ربط محراب الظاهر على الحاسوب.');
        await api.syncPair(raw,select.value,groups);
        if(scanner.open)scanner.close();
        stopCamera();await render();
      };
      const file=document.createElement('input');file.type='file';file.accept='image/*';file.hidden=true;
      const canvas=document.createElement('canvas');
      const context=canvas.getContext('2d',{willReadFrequently:true});
      const decode=(image,crop=false)=>{
        const width=image.videoWidth||image.width,height=image.videoHeight||image.height;
        if(!width||!height)return null;
        const side=Math.min(width,height)*.88;
        const sw=crop?side:width,sh=crop?side:height;
        const scale=Math.min(1,(crop?1100:1800)/Math.max(sw,sh));
        canvas.width=Math.round(sw*scale);canvas.height=Math.round(sh*scale);
        context.drawImage(image,(width-sw)/2,(height-sh)/2,sw,sh,0,0,canvas.width,canvas.height);
        const data=context.getImageData(0,0,canvas.width,canvas.height);
        return window.jsQR(data.data,data.width,data.height,{inversionAttempts:'attemptBoth'})?.data;
      };
      file.onchange=()=>run(async()=>{
        if(!file.files[0])return;
        try{
          const bitmap=await createImageBitmap(file.files[0]);
          try{
            const raw=decode(bitmap)||decode(bitmap,true);
            if(!raw)throw Error('تعذر قراءة رمز QR من الصورة. جرّب صورة أقرب أو استخدم رمز الربط النصي.');
            await pair(raw);
          }finally{bitmap.close();}
        }finally{file.value='';}
      });
      const fallback=document.createElement('details');fallback.className='sync-text-fallback';
      const summary=document.createElement('summary');summary.textContent='إدخال رمز الربط النصي';
      const code=document.createElement('textarea');code.className='input-field';code.dir='ltr';
      code.rows=3;code.maxLength=768;code.spellcheck=false;code.autocomplete='off';
      code.setAttribute('aria-label','رمز الربط النصي من الحاسوب');
      fallback.append(summary,code,button('متابعة بالرمز النصي',()=>pair(decodeInvite(code.value))));
      const scanButton=button('مسح الرمز',async()=>{
        if(!choices.querySelector('input:checked'))throw Error('اختر مجموعة بيانات أولاً.');
        stopCamera();
        await api.syncCameraPermission();
        if(panel.hidden||!document.getElementById('tab-settings').classList.contains('active'))return;
        cameraStatus.textContent='ضع رمز محراب داخل المربع وقرّب الهاتف حتى يصبح الرمز واضحاً.';
        scanner.showModal();
        const generation=cameraGeneration;
        let captured;
        try{
          captured=await navigator.mediaDevices.getUserMedia({
            video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false,
          });
          if(generation!==cameraGeneration||!scanner.open){captured.getTracks().forEach(track=>track.stop());return;}
          stream=captured;
          camera.srcObject=stream;
          await camera.play();
        }catch(error){
          if(scanner.open)scanner.close();
          stopCamera();throw error;
        }
        let lastScan=0,attempts=0;
        const scan=time=>{
          if(!stream||!scanner.open||generation!==cameraGeneration)return;
          if(time-lastScan>=180&&camera.readyState>=2){
            lastScan=time;
            const result=decode(camera,++attempts%3!==0);
            if(result&&isInvite(result)){
              stopCamera();
              cameraStatus.textContent='تم العثور على الرمز. جارٍ الاتصال بالحاسوب…';
              run(async()=>{
                try{await pair(result);}
                catch(error){if(scanner.open)scanner.close();throw error;}
              });
              return;
            }
            if(result)cameraStatus.textContent='هذا الرمز غير مخصص لربط محراب.';
          }
          scanFrame=requestAnimationFrame(scan);
        };
        scanFrame=requestAnimationFrame(scan);
      },'btn-primary sync-qr-button');
      scanButton.title='مسح رمز QR';
      scanButton.setAttribute('aria-label','مسح رمز QR');
      scanButton.insertAdjacentHTML('afterbegin','<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h4v4h-3m-4 0v-3m7-4v1"/></svg>');
      content.append(scanButton,button('قراءة الرمز من صورة',()=>file.click()),file,fallback);
    }else{
      if(state.linked){
        const row=document.createElement('div');row.className='local-sync-desktop-peer';
        row.append(note(state.awaitingPhone?'بانتظار تأكيد استلام الربط من الهاتف.':'الهاتف المرتبط'),
          note(directions[state.link.direction]+' · '+state.link.groups.map(group=>labels[group]).join('، ')),
          note(state.online?'عنوان الاتصال '+state.host:'عنوان الشبكة غير متاح.'),
          note('يمكن تعديل اتجاه الاتصال والبيانات من الهاتف المرتبط.'),
          button('فك الربط',async()=>{
            if(!window.confirm('فك ربط الهاتف؟'))return;
            await api.syncUnlink();await render();showSuccessFeedback('تم فك ربط الهاتف.');
          },'btn-danger'));
        content.append(row);
        return;
      }
      if(state.candidate){
        content.append(note('تحقق من ظهور الرمز '+state.candidate.code+' على الهاتف.'),
          note(directions[state.candidate.direction]+' · '+state.candidate.groups.map(group=>labels[group]).join('، ')),
          button('تأكيد ربط الهاتف',async()=>{await api.syncApprove(state.candidate.code);await render();showSuccessFeedback('تم تأكيد ربط الهاتف.');},'btn-primary'),
          button('إلغاء الطلب',async()=>{await api.syncUnlink();await render();},'btn-secondary'));
        return;
      }
      if(!state.addresses.length){content.append(note('لم يُعثر على عنوان شبكة محلية خاص.'));return;}
      const select=showSelect('عنوان الشبكة المحلية',state.addresses.map(address=>[address,address]));
      content.append(button('توليد رمز QR',async()=>{
        const offer=await api.syncOffer(select.value);
        const image=document.createElement('img');image.className='local-sync-qr';image.alt='رمز اقتران محراب';image.src=offer.image;
        const alternative=document.createElement('details');alternative.className='sync-text-fallback';
        const summary=document.createElement('summary');summary.textContent='رمز الربط النصي';
        const code=document.createElement('textarea');code.className='input-field';code.dir='ltr';code.rows=3;
        code.readOnly=true;code.value=encodeInvite(offer.qr);code.setAttribute('aria-label','رمز الربط النصي');
        alternative.append(summary,code,button('نسخ رمز الربط',async()=>{
          code.focus();code.select();
          if(!document.execCommand('copy'))throw Error('انسخ النص المحدد باستخدام Ctrl+C.');
          message.textContent='نُسخ رمز الربط المؤقت.';
        }));
        customSelects.get(select)?.close();
        content.replaceChildren(image,note('امسح الرمز بهاتفك خلال دقيقتين. أبقِ نافذة الربط مفتوحة.'),alternative);
        const deadline=Date.now()+120000;
        clearInterval(renderTimer);
        renderTimer=setInterval(async()=>{
          if(panel.hidden||!document.getElementById('tab-settings').classList.contains('active')){
            clearInterval(renderTimer);return;
          }
          try{
            if((await api.syncStatus()).candidate||Date.now()>=deadline){
              clearInterval(renderTimer);await run(render);
            }
          }catch(error){clearInterval(renderTimer);message.textContent=error.message;}
        },1000);
      },'btn-primary'));
    }
  }
  document.getElementById('data-settings-section-sync').addEventListener('click',()=>run(render));
  const observer=new MutationObserver(()=>{
    if(panel.hidden||!document.getElementById('tab-settings').classList.contains('active')){
      if(scanner?.open)scanner.close();
      stopCamera();clearInterval(renderTimer);
    }
  });
  observer.observe(panel,{attributes:true,attributeFilter:['hidden']});
  observer.observe(document.getElementById('tab-settings'),{attributes:true,attributeFilter:['class']});
  window.addEventListener('pagehide',stopCamera);
  if(mobile)document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&scanner.open){scanner.close();stopCamera();}
  });
}
