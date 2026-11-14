'use strict';
const Reminders = require('./custom-reminders');
// Increment when the wire protocol becomes incompatible. Independent of the app version.
const PROTOCOL_VERSION = 3;
// Stable envelope for pairing, authentication and link management.
const LINK_VERSION = 1;
const GROUPS = ['channels', 'reminders', 'wird', 'settings', 'location'];
const DIRECTIONS = ['phone-to-desktop', 'desktop-to-phone', 'two-way'];
const ID = /^[A-Za-z0-9_-]{22,64}$/;
const modes = ['both','reading_only','hifz_only','none'];
const units = ['juz','hizb','rub','surah','page'];
const prayers = ['fajr','dhuhr','asr','maghrib','isha'];
const pick = (obj, fields) => Object.fromEntries(fields.filter(k=>obj?.[k]!==undefined).map(k=>[k,obj[k]]));
const within = (v,min,max) => Number.isInteger(v)&&v>=min&&v<=max;
const str = (v,len) => typeof v==='string'&&v.length<=len;
const clock = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v||'');
const assert = (ok) => { if(!ok) throw Error('بيانات المزامنة غير صالحة.'); };

function block(row, hifz) {
  assert(row && units.includes(row.unit) && within(row.amount,1,650));
  const result = pick(row,['unit','amount','timingMode','afterPrayer','afterPrayerMinutes','customTimeEnabled','customTime']);
  if (row.timingMode !== undefined) assert(['fixed','prayer'].includes(row.timingMode));
  if (row.afterPrayer !== undefined) assert(prayers.includes(row.afterPrayer));
  if (row.afterPrayerMinutes !== undefined) assert(within(row.afterPrayerMinutes,0,240));
  if (row.customTimeEnabled !== undefined) assert(typeof row.customTimeEnabled==='boolean');
  if (row.customTime !== undefined) assert(clock(row.customTime));
  if (row.bookmark !== undefined) {
    const mark = row.bookmark;
    if (mark === null) result.bookmark = null;
    else {
      assert(['hafs', 'warsh'].includes(mark.riwaya) && within(mark.surah, 1, 114) && within(mark.ayah, 1, 286));
      result.bookmark = pick(mark, ['riwaya', 'surah', 'ayah', 'rangeStart', 'rangeEnd', 'spreadStart']);
      for (const key of ['rangeStart', 'rangeEnd', 'spreadStart']) {
        const value = mark[key];
        assert(value == null || within(value, 0, 6235));
      }
    }
  }
  if (row.cycleId !== undefined) {
    assert(row.cycleId === null || ID.test(row.cycleId));
    if (row.cycleId !== null) result.cycleId = row.cycleId;
  }
  const pos=row.currentPosition;
  if(pos){
    result.currentPosition=pick(pos,['juzNumber','hizbNumber','rubNumber','surahNumber','pageNumber']);
    const max={juzNumber:30,hizbNumber:60,rubNumber:240,surahNumber:114,pageNumber:650};
    for(const [key,value] of Object.entries(result.currentPosition))assert(within(value,1,max[key]));
  }
  if(hifz){
    assert(within(row.rangeStart,1,650)&&within(row.rangeEnd,row.rangeStart,650));
    Object.assign(result,pick(row,['rangeStart','rangeEnd','afterFajrMinutes']));
    if(row.afterFajrMinutes!==undefined)assert(within(row.afterFajrMinutes,0,240));
  }else{
    assert(['sequential','random'].includes(row.mode));
    Object.assign(result,pick(row,['mode','afterIshaMinutes']));
    if(row.afterIshaMinutes!==undefined)assert(within(row.afterIshaMinutes,0,240));
  }
  return result;
}

function sanitize(group, value) {
  if(group==='settings'){
    assert(value&&['ar','en','id','ur','bn','fr','tr'].includes(value.language));
    assert(['amber-gold','andalusian-sand','copper-courtyard','dusk-atelier','emerald-sanctuary','royal-sapphire','classic-monochrome'].includes(value.theme));
    assert(['light','dark'].includes(value.mode));
    return pick(value,['language','theme','mode']);
  }
  if(group==='channels'){
    assert(Array.isArray(value)&&value.length<=300);
    const ids=new Set();
    return value.map(row=>{
      assert(/^UC[A-Za-z0-9_-]{22}$/.test(row?.channelId||'')&&!ids.has(row.channelId)&&str(row.name,300)&&row.name.trim());
      ids.add(row.channelId);
      assert(row.category===undefined||str(row.category,120));
      return pick(row,['channelId','name','category']);
    });
  }
  if(group==='reminders'){
    Reminders.validate(value);
    return Reminders.unique(value.map(row=>pick(row,['id','type','mode','start','hours','clock','prayer','offset','durationSeconds'])));
  }
  if(group==='wird'){
    assert(value && ['hafs','warsh'].includes(value.riwaya)&&modes.includes(value.notificationMode));
    return {...pick(value,['riwaya','notificationMode']),reading:block(value.reading,false),hifz:block(value.hifz,true)};
  }
  if(group==='location'){
    if(value==null)return null;
    assert(str(value.city,160)&&value.city.trim()&&str(value.country,160)&&value.country.trim());
    return {city:value.city.trim(),country:value.country.trim()};
  }
  throw Error('مجموعة مزامنة غير مدعومة.');
}
function phoneLocation(config, gpsAuthorized) {
  const loc=config.location;
  if(!loc||(loc.source!=='manual' && !(loc.source==='device'&&gpsAuthorized)))return null;
  if(!loc.country?.trim()||!loc.city?.trim()||loc.city==='موقعي الحالي')return null;
  return sanitize('location',loc);
}
function project(config, group) {
  return sanitize(group,rawGroup(config,group));
}
function patch(group,value) {
  const safe=sanitize(group,value);
  if(group==='settings')return {sharedSettings:safe};
  if(group==='channels')return {youtube:{channels:safe}};
  if(group==='reminders')return {notifications:{customReminders:safe}};
  if(group==='wird')return {quranWird:{
    ...safe,
    reading:{cycleId:null,...safe.reading},
    hifz:{cycleId:null,...safe.hifz},
  }};
  throw Error('تُحل أسماء المدن محلياً على الحاسوب.');
}
function locationAllowed(link) {
  return Boolean(link?.groups?.includes('location') &&
    ['phone-to-desktop','two-way'].includes(link.direction));
}
function validateLink(link) {
  assert(link && ID.test(link.phoneId||'') && ID.test(link.desktopId||'') && link.phoneId!==link.desktopId &&
    DIRECTIONS.includes(link.direction) && Array.isArray(link.groups) && link.groups.length>0 &&
    link.groups.every(group=>GROUPS.includes(group)) && new Set(link.groups).size===link.groups.length);
  assert(!link.groups.includes('location') || locationAllowed(link));
  return link;
}

function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function entries(group, value) {
  if(group==='channels'||group==='reminders'){
    const key=group==='channels'?'channelId':'id';
    return Object.fromEntries((value||[]).map(row=>[row[key],row]));
  }
  if(group==='settings')return value||{};
  return {all:value};
}
function recordEdits(previous, next, groups=GROUPS, now=Date.now()) {
  const clocks=structuredClone(previous.syncClocks||{});
  for(const group of groups){
    if(group==='location')continue;
    const a=entries(group,rawGroup(previous,group)),b=entries(group,rawGroup(next,group));
    for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
      if(same(a[key],b[key]))continue;
      const clock=clocks[group]||={};
      if(now===null)delete clock[key];
      else clock[key]=Math.max(now,(clock[key]||0)+1);
    }
  }
  return clocks;
}
function rawGroup(config,group){
  return {channels:config.youtube?.channels||[],reminders:config.notifications?.customReminders||[],
    wird:config.quranWird,settings:config.sharedSettings}[group];
}
function latest(a,b){
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<1||b<1)return undefined;
  return b>a?'phone':'desktop';
}
function mergeItems(group, base, desktop, phone, choices, desktopClock, phoneClock) {
  const key = group === 'channels' ? 'channelId' : 'id';
  const index = rows => new Map((rows || []).map(row => [row[key], row]));
  const [before, left, right] = [base, desktop, phone].map(index);
  const ids = new Set([...left.keys(), ...right.keys(), ...before.keys()]);
  const desktopValue = [], phoneValue = [], baseline = [], items = [];
  for (const id of ids) {
    const old = before.get(id), a = left.get(id), b = right.get(id);
    const side=choices[id] || (base && latest(desktopClock[id],phoneClock[id]));
    let value;
    if (same(a,b)) value = a;
    else if (same(a,old)) value = b;
    else if (same(b,old)) value = a;
    else if (side === 'desktop' || side === 'phone') value = side === 'desktop' ? a : b;
    else {
      items.push({id, desktop:a ?? null, phone:b ?? null});
      if (a) desktopValue.push(a);
      if (b) phoneValue.push(b);
      if (old) baseline.push(old);
      continue;
    }
    if (value) {
      desktopValue.push(value);
      phoneValue.push(value);
      baseline.push(value);
    }
  }
  try {
    const a = sanitize(group,desktopValue), b = sanitize(group,phoneValue);
    // Duplicate reminder schedules cannot be represented on a single device.
    if(a.length!==desktopValue.length||b.length!==phoneValue.length)return {conflict:true};
    return {desktopValue:a,phoneValue:b,baseline,items};
  } catch {
    // The union can exceed the device's supported capacity. Keep both copies.
    return {conflict:true};
  }
}

function reconcile(group,base,desktop,phone,direction,first,choices={},desktopClock={},phoneClock={}) {
  if(direction==='two-way'&&(group==='channels'||group==='reminders'))
    return mergeItems(group,base,desktop,phone,choices,desktopClock,phoneClock);
  if(same(desktop,phone))return {value:desktop};
  if(first&&direction!=='two-way'&&(group==='channels'||group==='reminders')){
    const key=group==='channels'?'channelId':'id';
    const [other,source]=direction==='desktop-to-phone'?[phone,desktop]:[desktop,phone];
    try{return {value:sanitize(group,[...new Map([...other,...source].map(item=>[item[key],item])).values()])};}
    catch{return {conflict:true};}
  }
  if(direction==='phone-to-desktop')return {value:phone};
  if(direction==='desktop-to-phone')return {value:desktop};
  if(!first&&same(desktop,base))return {value:phone};
  if(!first&&same(phone,base))return {value:desktop};
  if(group==='settings'&&!first){
    const merged={};
    for(const key of Object.keys(desktop)){
      const a=desktop[key],b=phone[key],old=base[key];
      const side=a===old?'phone':b===old||a===b?'desktop':latest(desktopClock[key],phoneClock[key])||choices.all;
      if(!side)return {conflict:true,items:[{id:'all',desktop,phone}]};
      merged[key]=side==='desktop'?a:b;
    }
    return {value:merged};
  }
  if(!first&&group==='wird'&&!choices.all){
    const side=latest(desktopClock.all,phoneClock.all);
    if(side)return {value:side==='desktop'?desktop:phone};
  }
  if(choices.all==='desktop'||choices.all==='phone')return {value:choices.all==='desktop'?desktop:phone};
  return {conflict:true,items:[{id:'all',desktop,phone}]};
}
module.exports={LINK_VERSION,PROTOCOL_VERSION,GROUPS,ID,sanitize,phoneLocation,project,patch,validateLink,locationAllowed,same,reconcile,recordEdits};
