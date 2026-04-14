import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const sb=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const calIds=['tt_work','tt_private','tt_misa','work','private','family','tecnest'];
for(const c of calIds){
  const {count}=await sb.from('events').select('*',{count:'exact',head:true}).eq('calendar_id',c);
  console.log(c+':',count);
}
const {data:subs}=await sb.from('sub_calendars').select('id,name,visible').limit(30);
console.log('subs:',JSON.stringify(subs,null,2));
const {data:sample}=await sb.from('events').select('id,calendar_id,title,date,images').not('images','is',null).limit(3);
console.log('img sample:',JSON.stringify(sample));
const {count:totEvts}=await sb.from('events').select('*',{count:'exact',head:true});
console.log('total events:',totEvts);
const sampleId='965a9e91e80e424fa5370659b72f8134';
const {data:byId}=await sb.from('events').select('id,calendar_id,title,images').eq('id',sampleId);
console.log('sample known event:',JSON.stringify(byId));
