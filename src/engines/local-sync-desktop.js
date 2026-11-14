'use strict';

const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const https=require('node:https');
const {X509Certificate,randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const selfsigned=require('selfsigned');
const QRCode=require('qrcode');
const Contract=require('./local-sync-contract');
const MAX=256*1024;
const PORT=17777;
// Temporary override for testing version mismatch on an unpackaged desktop.
const protocolVersion=process.env.MIHRAB_SYNC_TEST_VERSION==='3'?3:Contract.PROTOCOL_VERSION;
const privateIp=ip=>/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const secret=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest();
const match=(value,stored)=>typeof value==='string'&&typeof stored==='string'&&timingSafeEqual(digest(value),digest(stored));

function higherWird(desktop,phone,side){
  const chosen=side==='desktop'?desktop:phone;
  if(desktop.riwaya!==phone.riwaya)return chosen;
  const metadata=require('../../data/quran-meta-'+chosen.riwaya+'.json');
  const fields={juz:'juzNumber',hizb:'hizbNumber',rub:'rubNumber',surah:'surahNumber',page:'pageNumber'};
  function position(block){
    const number=block.currentPosition?.[fields[block.unit]]??block.rangeStart??1;
    const start=metadata.units[block.unit]?.[number-1]?.start;
    const mark=block.bookmark?.riwaya===chosen.riwaya?block.bookmark:null;
    const markedStart=mark && metadata.units.surah[mark.surah-1]?.start.verseIndex;
    return Math.max(start?.verseIndex??0, markedStart==null?0:markedStart+mark.ayah-1);
  }
  function highest(a,b,preferred){
    const left=position(a),right=position(b);
    const difference=left-right;
    return difference>0?a:difference<0?b:preferred;
  }
  return {...chosen,reading:highest(desktop.reading,phone.reading,chosen.reading),
    hifz:highest(desktop.hifz,phone.hifz,chosen.hifz)};
}

class LocalSync {
  constructor({ directory, safeStorage, getConfig, applyPatch, resolveLocation, onLinkChanged }) {
    Object.assign(this,{directory,safeStorage,getConfig,applyPatch,resolveLocation,onLinkChanged});
    this.file=path.join(directory,'local-sync.sealed');
    this.state=null;
    this.server=null;
    this.ticket=null;
    this.queue=Promise.resolve();
  }
  addresses(){
    return [...new Set(Object.values(os.networkInterfaces()).flat().filter(item=>item.family==='IPv4'&&!item.internal&&privateIp(item.address)).map(item=>item.address))];
  }
  async load(){
    try {this.state=JSON.parse(this.safeStorage.decryptString(await fs.readFile(this.file)));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(this.state&&this.addresses().includes(this.state.host))await this.listen();
  }
  async persist(){
    if(!this.safeStorage.isEncryptionAvailable())throw Error('مخزن مفاتيح Windows غير متاح.');
    const temporary=this.file+'.tmp';
    await fs.mkdir(this.directory,{recursive:true});
    await fs.writeFile(temporary,this.safeStorage.encryptString(JSON.stringify(this.state)),{mode:0o600});
    await fs.rename(temporary,this.file);
  }
  async listen(){
    if(this.server)return;
    const state=this.state;
    const server=https.createServer({key:state.key,cert:state.cert,minVersion:'TLSv1.3',requestTimeout:6000,headersTimeout:5000,keepAliveTimeout:1000},
      (req,res)=>this.handle(req,res));
    server.on('error',error=>console.warn('[Mihrab local sync]',error.code||'listener'));
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(PORT,state.host,()=>{server.removeListener('error',reject);resolve();});
    });
    this.server=server;
  }
  status(){
    return {ownsLocation:this.ownsLocation(),addresses:this.addresses(),host:this.state?.host||null,linked:Boolean(this.state?.link),
      online:Boolean(this.server), protocolMismatch:this.protocolMismatch===true, awaitingPhone:Boolean(this.state?.pairReceipt),link:this.state?.link?{...this.state.link,token:undefined}:null,
      candidate:this.ticket?.candidate&&this.ticket.until>Date.now()&&!this.state?.link
        ? {code:this.ticket.candidate.code,direction:this.ticket.candidate.link.direction,groups:this.ticket.candidate.link.groups}:null};
  }
  ownsLocation(){return !this.state?.pairReceipt&&Contract.locationAllowed(this.state?.link);}
  async offer(host){
    if(this.state?.link)throw Error('افصل الهاتف المرتبط قبل إنشاء رمز آخر.');
    if(!this.addresses().includes(host))throw Error('اختر عنواناً خاصاً من الشبكة المحلية.');
    if(!this.state||this.state.host!==host){
      if(this.server){const old=this.server;this.server=null;await new Promise(resolve=>old.close(resolve));}
      const pair=await selfsigned.generate([{name:'commonName',value:'Mihrab Local'}],{
        keyType:'ec',curve:'P-256',algorithm:'sha256',
        notBeforeDate:new Date(Date.now()-300000), notAfterDate:new Date(Date.now()+365*86400000),
        extensions:[{name:'subjectAltName',altNames:[{type:7,ip:host}]}],
      });
      this.state={host,id:secret(),key:pair.private,cert:pair.cert,link:null};
      await this.persist();
    }
    await this.listen();
    const invitation=secret();
    this.ticket={invitation,until:Date.now()+120000,candidate:null};
    const fingerprint=new X509Certificate(this.state.cert).fingerprint256.replaceAll(':','').toLowerCase();
    const qr=JSON.stringify({version:Contract.LINK_VERSION,protocolVersion,host,port:PORT,desktopId:this.state.id,pin:fingerprint,invitation});
    return {image:await QRCode.toDataURL(qr,{errorCorrectionLevel:'M',width:420,margin:4}),qr};
  }
  async approve(code){
    const ticket=this.ticket;
    if(!ticket?.candidate||ticket.until<=Date.now()||ticket.candidate.code!==code||this.state.link)
      throw Error('انتهت دعوة الربط أو تغيّرت.');
    this.state.link={...ticket.candidate.link,token:secret()};
    this.state.pairReceipt={invitation:ticket.invitation,until:Date.now()+10*60*1000};
    delete this.state.transaction;
    this.state.baseline={};
    this.state.pending={};
    this.state.sequence=0;
    this.state.lastResponse=null;
    try{await this.persist();}
    catch(error){this.state.link=null;delete this.state.pairReceipt;throw error;}
    this.onLinkChanged?.(this.status());
    return this.status();
  }
  async unlink(){
    const unlink=this.queue.then(async()=>{
      if(this.state){
        const previous=this.state;
        this.state={...previous,link:null,pairReceipt:null,transaction:undefined,baseline:{},pending:{},sequence:0,lastResponse:null,lastRequestHash:null};
        try{await this.persist();}
        catch(error){this.state=previous;throw error;}
      }
      this.ticket=null;
      this.protocolMismatch=false;
      this.onLinkChanged?.(this.status());
      return this.status();
    });
    this.queue=unlink.catch(()=>{});
    return unlink;
  }
  setProtocolMismatch(blocked){
    if(Boolean(this.protocolMismatch)===blocked)return;
    this.protocolMismatch=blocked;
    this.onLinkChanged?.(this.status());
  }
  async handle(req,res){
    const send=(status,data)=>{
      res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});
      res.end(JSON.stringify({...data,protocolVersion}));
    };
    if(req.method!=='POST'||!privateIp(req.socket.remoteAddress||''))return send(403,{error:'local_only'});
    try{
      let count=0;
      const chunks=[];
      for await(const chunk of req){
        count+=chunk.length;
        if(count>MAX){req.destroy();return;}
        chunks.push(chunk);
      }
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(data?.version!==Contract.LINK_VERSION)return send(409,{error:'link_version'});
      const compatible=data.protocolVersion===protocolVersion;
      const process=async()=>{
        const ticket=this.ticket;
        if(req.url==='/pair'||req.url==='/pair-status'){
          const receipt=this.state.pairReceipt;
          if(req.url==='/pair-status'&&receipt&&receipt.until>Date.now()&&
            this.state.link?.phoneId===data.phoneId&&match(data.invitation,receipt.invitation))
            return [200,{link:this.state.link}];
          if(!ticket||ticket.until<=Date.now()||!match(data.invitation,ticket.invitation))return [403,{error:'expired_invitation'}];
          if(req.url==='/pair'){
            const link=Contract.validateLink({phoneId:data.phoneId,desktopId:this.state.id,direction:data.direction,groups:data.groups});
            if(this.state.link||ticket.candidate&&ticket.candidate.link.phoneId!==link.phoneId)return [409,{error:'already_claimed'}];
            if(!ticket.candidate)ticket.candidate={link,code:String(randomBytes(4).readUInt32BE()%1000000).padStart(6,'0')};
            return [200,{code:ticket.candidate.code}];
          }
          if(ticket.candidate?.link.phoneId!==data.phoneId)return [403,{error:'unknown_candidate'}];
          return [200,this.state.link?{link:this.state.link}:{waiting:true}];
        }
        const link=this.state.link;
        if(!link||!match(req.headers.authorization,'Bearer '+link.token))return [403,{error:'unpaired'}];
        this.setProtocolMismatch(!compatible);
        if(req.url==='/unlink'){
          const previous=this.state;
          this.state={...previous,link:null,pairReceipt:null,transaction:undefined,baseline:{},pending:{},sequence:0,lastResponse:null,lastRequestHash:null};
          try{await this.persist();}
          catch(error){this.state=previous;throw error;}
          this.ticket=null;
          this.protocolMismatch=false;
          this.onLinkChanged?.(this.status());
          return [200,{unlinked:true}];
        }
        if(req.url==='/exchange'&&!compatible)return [409,{error:'protocol_version'}];
        if(this.state.pairReceipt){
          const receipt=this.state.pairReceipt;
          delete this.state.pairReceipt;
          try{await this.persist();}
          catch(error){this.state.pairReceipt=receipt;throw error;}
          this.ticket=null;
          this.onLinkChanged?.(this.status());
        }
        if(req.url==='/status')return [200,{linked:true}];
        if(req.url==='/configure'){
          if(this.state.transaction&&!compatible)return [409,{error:'protocol_version'}];
          if(this.state.transaction)await this.finishExchange();
          const next=Contract.validateLink({...link,direction:data.direction,groups:data.groups});
          const current={direction:link.direction,groups:link.groups};
          if(!Contract.same(current,{direction:next.direction,groups:next.groups})){
            if(!Contract.same(current,data.previous))return [409,{error:'settings_changed'}];
            const previous=structuredClone(this.state);
            const retained=next.direction===link.direction?link.groups.filter(group=>next.groups.includes(group)):[];
            this.state.link=next;
            this.state.baseline=Object.fromEntries(Object.entries(this.state.baseline||{}).filter(([key])=>retained.includes(key)));
            this.state.pending=Object.fromEntries(Object.entries(this.state.pending||{}).filter(([key])=>retained.includes(key)));
            // A prior reply may contain groups whose consent has just been revoked.
            this.state.lastRequestHash=null;
            this.state.lastResponse=null;
            try{await this.persist();}catch(error){this.state=previous;throw error;}
            this.onLinkChanged?.(this.status());
          }
          return [200,{direction:next.direction,groups:next.groups}];
        }
        if(req.url==='/drop-location'){
          if(!link.groups.includes('location'))return [200,{groups:link.groups}];
          if(link.groups.length<=1)return [409,{error:'invalid_scope'}];
          const previous=link.groups;
          link.groups=previous.filter(group=>group!=='location');
          try{await this.persist();}catch(error){link.groups=previous;throw error;}
          this.onLinkChanged?.(this.status());
          return [200,{groups:link.groups}];
        }
        if(req.url!=='/exchange')return [404,{error:'unknown_route'}];
        this.ticket=null;
        return [200,await this.exchange(link,data)];
      };
      const job=this.queue.catch(()=>{}).then(process);
      this.queue=job;
      const [status,dataOut]=await job;
      send(status,dataOut);
    }catch(error){
      send(400,{error:'request_rejected'});
      console.warn('[Mihrab local sync]',error.code||error.name);
    }
  }
  async exchange(link,data){
    if(this.state.transaction)await this.finishExchange();
    if(!Number.isSafeInteger(data.sequence)||data.sequence<1)throw Error('invalid_sequence');
    if(data.sequence<(this.state.sequence||0))throw Error('stale_sequence');
    const scope=data.scope??'all';
    if(scope!=='all'&&(scope!=='location'||!Contract.locationAllowed(link)))throw Error('invalid_scope');
    const requestHash=digest(JSON.stringify(data.applied||data.resolution||data.clocks?[scope,data.groups,data.applied??null,data.resolution??null,...(data.clocks?[data.clocks]:[])]:[scope,data.groups])).toString('hex');
    if(data.sequence===this.state.sequence){
      if(requestHash!==this.state.lastRequestHash)throw Error('sequence_payload_mismatch');
      return this.state.lastResponse;
    }
    const previous=structuredClone(this.state);
    try {
      const changes={};
      const conflicts=[];
      const details=[];
      const desktopPatch={};
      const expected={};
      const config=this.getConfig();
      for(const group of scope==='location'?['location']:link.groups){
        if(group==='location'){
          if(Contract.locationAllowed(link)&&data.groups?.location){
            const value=Contract.sanitize(group,data.groups.location);
            if(!Contract.same(this.state.baseline.location,value)){
              const location=this.resolveLocation(value);
              if(location){
                desktopPatch.location=location;
                expected.location=Contract.sanitize(group,config.location);
                this.state.baseline.location=value;
              }else conflicts.push(group);
            }
          }
          continue;
        }
        const desktop=Contract.project(config,group);
        if(group==='settings'&&!Object.hasOwn(data.groups||{},group))continue;
        const phone=Contract.sanitize(group,data.groups?.[group]);
        const pending=this.state.pending[group];
        const base=this.state.baseline[group];
        if(pending){
          const applied=(pending.sequence!==undefined && data.applied?.[group]===pending.sequence) || Contract.same(phone,pending.value);
          if(applied){
            this.state.baseline[group]=pending.baseline ?? pending.value;
            delete this.state.pending[group];
          }else if(Contract.same(phone,pending.phone)&&Contract.same(desktop,pending.desktop ?? pending.value)&&!data.resolution){
            changes[group]=pending.value;
            pending.sequence=data.sequence;
            details.push(...(pending.details||[]));
            if(pending.details?.length)conflicts.push(group);
            continue;
          }
        }
        const agreed=this.state.baseline[group];
        const initial=agreed===undefined&&link.direction==='two-way';
        const resultWithoutChoice=initial&&!Contract.same(desktop,phone)
          ? {conflict:true,items:[{id:'all',desktop,phone}]}
          : Contract.reconcile(group,agreed,desktop,phone,link.direction,agreed===undefined,{},config.syncClocks?.[group],data.clocks?.[group]||{});
        const makeDetails=result=>{
          const items=initial&&result.conflict&&!result.items?.length
            ? [{id:'all',desktop,phone}] : result.items||[];
          return items.map(item=>({...item,group,initial,
            version:digest(JSON.stringify([group,item])).toString('hex')}));
        };
        const requested=data.resolution;
        const currentDetails=makeDetails(resultWithoutChoice);
        const selected=currentDetails.find(item=>requested?.version===item.version);
        const validSide=['desktop','phone'].includes(requested?.side);
        const initialChoice=initial&&validSide&&Array.isArray(requested?.versions)&&currentDetails.length&&
          currentDetails.every(item=>requested.versions.includes(item.version));
        let result=resultWithoutChoice;
        if(initialChoice){
          result={value:group==='wird'?higherWird(desktop,phone,requested.side):
            requested.side==='desktop'?desktop:phone};
        }else if(selected&&validSide){
          result=Contract.reconcile(group,agreed,desktop,phone,link.direction,initial,
            {[selected.id]:requested.side},config.syncClocks?.[group],data.clocks?.[group]||{});
        }
        const groupDetails=makeDetails(result);
        details.push(...groupDetails);
        if(result.conflict||groupDetails.length)conflicts.push(group);
        if(result.conflict)continue;
        const desktopValue=result.desktopValue ?? result.value;
        const phoneValue=result.phoneValue ?? result.value;
        const baseline=result.baseline ?? result.value;
        if(!Contract.same(desktopValue,desktop)){
          expected[group]=desktop;
          Object.assign(desktopPatch,Contract.patch(group,desktopValue));
        }
        if(!Contract.same(phoneValue,phone)){
          changes[group]=phoneValue;
          this.state.pending[group]={value:phoneValue,phone,desktop:desktopValue,baseline,sequence:data.sequence,details:groupDetails};
        }else{
          this.state.baseline[group]=baseline;
          delete this.state.pending[group];
        }
      }
      const next={
        baseline:this.state.baseline,pending:this.state.pending,sequence:data.sequence,
        lastRequestHash:requestHash,lastResponse:{changes,conflicts,details,ack:data.sequence},
      };
      this.state={...previous,transaction:{expected,desktopPatch,next}};
      await this.persist();
    }catch(error){this.state=previous;throw error;}
    await this.finishExchange();
    return this.state.lastResponse;
  }

  async finishExchange(){
    const transaction=this.state.transaction;
    if(!transaction)return;
    const {expected,desktopPatch,next}=transaction;
    const config=this.getConfig();
    for(const [group,value] of Object.entries(expected)){
      const current=group==='location'?Contract.sanitize(group,config.location):Contract.project(config,group);
      const proposed=group==='location'?Contract.sanitize(group,desktopPatch.location):Contract.project(desktopPatch,group);
      if(!Contract.same(current,value)&&!Contract.same(current,proposed)){
        // A local edit after a crash supersedes the uncommitted transaction.
        delete this.state.transaction;
        try{await this.persist();}catch(error){this.state.transaction=transaction;throw error;}
        return;
      }
    }
    const needsPatch=Object.entries(expected).some(([group])=>{
      const current=group==='location'?Contract.sanitize(group,config.location):Contract.project(config,group);
      const proposed=group==='location'?Contract.sanitize(group,desktopPatch.location):Contract.project(desktopPatch,group);
      return !Contract.same(current,proposed);
    });
    if(needsPatch)await this.applyPatch(desktopPatch);
    const previous=this.state;
    this.state={...previous,...next};
    delete this.state.transaction;
    try{await this.persist();}catch(error){this.state=previous;throw error;}
  }

}
module.exports=LocalSync;

