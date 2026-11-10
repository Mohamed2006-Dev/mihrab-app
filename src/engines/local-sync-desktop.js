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
const privateIp=ip=>/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const secret=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest();
const match=(value,stored)=>typeof value==='string'&&typeof stored==='string'&&timingSafeEqual(digest(value),digest(stored));

class LocalSync {
  constructor({ directory, safeStorage, getConfig, applyPatch, onLinkChanged }) {
    Object.assign(this,{directory,safeStorage,getConfig,applyPatch,onLinkChanged});
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
    if(this.state?.link&&this.addresses().includes(this.state.host))await this.listen();
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
      online:Boolean(this.server),link:this.state?.link?{...this.state.link,token:undefined}:null,
      candidate:this.ticket?.candidate&&this.ticket.until>Date.now()&&!this.state?.link
        ? {code:this.ticket.candidate.code,direction:this.ticket.candidate.link.direction,groups:this.ticket.candidate.link.groups}:null};
  }
  ownsLocation(){return Contract.locationAllowed(this.state?.link);}
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
    const qr=JSON.stringify({version:1,host,port:PORT,desktopId:this.state.id,pin:fingerprint,invitation});
    return {image:await QRCode.toDataURL(qr,{errorCorrectionLevel:'M',width:420,margin:4}),qr};
  }
  async approve(code){
    const ticket=this.ticket;
    if(!ticket?.candidate||ticket.until<=Date.now()||ticket.candidate.code!==code||this.state.link)
      throw Error('انتهت دعوة الربط أو تغيّرت.');
    this.state.link={...ticket.candidate.link,token:secret()};
    this.state.baseline={};
    this.state.pending={};
    this.state.sequence=0;
    this.state.lastResponse=null;
    try{await this.persist();}
    catch(error){this.state.link=null;throw error;}
    this.onLinkChanged?.(this.status());
    return this.status();
  }
  async unlink(){
    this.ticket=null;
    if(this.state){
      this.state.link=null;
      this.state.baseline={};
      this.state.pending={};
    this.state.sequence=0;
    this.state.lastResponse=null;
      await this.persist();
    }
    if(this.server){
      this.server.closeAllConnections();
      this.server.close();
      this.server=null;
    }
    this.onLinkChanged?.(this.status());
    return this.status();
  }
  async handle(req,res){
    const send=(status,data)=>{
      res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});
      res.end(JSON.stringify(data));
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
      if(data.version!==1)return send(400,{error:'protocol_version'});
      const process=async()=>{
        const ticket=this.ticket;
        if(req.url==='/pair'||req.url==='/pair-status'){
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
        if(req.url==='/unlink'){
          this.ticket=null;this.state.link=null;this.state.baseline={};this.state.pending={};
          await this.persist();
          this.onLinkChanged?.(this.status());
          return [200,{unlinked:true}];
        }
        if(req.url==='/configure'){
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
    if(!Number.isSafeInteger(data.sequence)||data.sequence<1)throw Error('invalid_sequence');
    if(data.sequence<(this.state.sequence||0))throw Error('stale_sequence');
    const scope=data.scope??'all';
    if(scope!=='all'&&(scope!=='location'||!Contract.locationAllowed(link)))throw Error('invalid_scope');
    const requestHash=digest(JSON.stringify([scope,data.groups])).toString('hex');
    if(data.sequence===this.state.sequence){
      if(requestHash!==this.state.lastRequestHash)throw Error('sequence_payload_mismatch');
      return this.state.lastResponse;
    }
    const previous=structuredClone(this.state);
    try {
      const changes={};
      const conflicts=[];
      const desktopPatch={};
      const config=this.getConfig();
      for(const group of scope==='location'?['location']:link.groups){
        if(group==='location'){
          if(Contract.locationAllowed(link)&&data.groups?.location){
            const value=Contract.sanitize(group,data.groups.location);
            if(!Contract.same(this.state.baseline.location,value)){
              Object.assign(desktopPatch,Contract.patch(group,value));
              this.state.baseline.location=value;
            }
          }
          continue;
        }
        const desktop=Contract.project(config,group);
        const phone=Contract.sanitize(group,data.groups?.[group]);
        const pending=this.state.pending[group];
        const base=this.state.baseline[group];
        if(pending&&Contract.same(pending.value,desktop)){
          if(Contract.same(phone,pending.value)){
            this.state.baseline[group]=desktop;
            delete this.state.pending[group];
            continue;
          }
          if(Contract.same(phone,pending.phone)){changes[group]=pending.value;continue;}
        }
        const result=Contract.reconcile(group,base,desktop,phone,link.direction,base===undefined);
        if(result.conflict){conflicts.push(group);continue;}
        if(!Contract.same(result.value,desktop))Object.assign(desktopPatch,Contract.patch(group,result.value));
        if(!Contract.same(result.value,phone)){
          changes[group]=result.value;
          this.state.pending[group]={value:result.value,phone};
        }else{
          this.state.baseline[group]=result.value;
          delete this.state.pending[group];
        }
      }
      if(Object.keys(desktopPatch).length)await this.applyPatch(desktopPatch);
      this.state.sequence=data.sequence;
      this.state.lastRequestHash=requestHash;
      this.state.lastResponse={changes,conflicts,ack:data.sequence};
      await this.persist();
      return this.state.lastResponse;
    }catch(error){this.state=previous;throw error;}
  }
}
module.exports=LocalSync;

