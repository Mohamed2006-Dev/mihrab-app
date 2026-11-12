'use strict';
const Reminders = require('./custom-reminders');
const GROUPS = ['channels', 'reminders', 'wird', 'location'];
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
  const value={channels:config.youtube?.channels||[],reminders:config.notifications?.customReminders||[],wird:config.quranWird}[group];
  return sanitize(group,value);
}
function patch(group,value) {
  const safe=sanitize(group,value);
  if(group==='channels')return {youtube:{channels:safe}};
  if(group==='reminders')return {notifications:{customReminders:safe}};
  if(group==='wird')return {quranWird:safe};
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
function reconcile(group,base,desktop,phone,direction,first) {
  if(same(desktop,phone))return {value:desktop};
  if(first&&(group==='channels'||group==='reminders')){
    const key=group==='channels'?'channelId':'id';
    const phoneMap=new Map(phone.map(item=>[item[key],item]));
    const merged=[...phone];
    for(const item of desktop){
      if(phoneMap.has(item[key])){
        if(!same(phoneMap.get(item[key]),item)&&direction==='two-way')return {conflict:true};
        if(direction==='desktop-to-phone')merged[merged.findIndex(row=>row[key]===item[key])]=item;
      }else merged.push(item);
    }
    return {value:sanitize(group,merged)};
  }
  if(direction==='phone-to-desktop')return {value:phone};
  if(direction==='desktop-to-phone')return {value:desktop};
  if(first)return {conflict:true};
  if(same(desktop,base))return {value:phone};
  if(same(phone,base))return {value:desktop};
  return {conflict:true};
}
module.exports={GROUPS,ID,sanitize,phoneLocation,project,patch,validateLink,locationAllowed,same,reconcile};
