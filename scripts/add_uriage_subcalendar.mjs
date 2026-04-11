// 売上 sub_calendar を family_calendar の settings に追加
// 冪等: 既に 'uriage' があれば何もしない
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
const e = {};
env.forEach(l => { const [k, ...v] = l.split('='); if (k) e[k.trim()] = v.join('=').trim(); });
const sb = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);

const { data: row, error: readErr } = await sb.from('settings').select('*').eq('key', 'sub_calendars').single();
if (readErr) { console.error('read err:', readErr.message); process.exit(1); }

const subs = row.value || [];
if (subs.find(s => s.id === 'uriage')) {
  console.log('⏭  uriage sub_calendar already exists, skipping');
  process.exit(0);
}

subs.push({
  id: 'uriage',
  icon: '💰',
  name: '売上',
  color: '#dc2626',
  visible: false, // 家族ビューでは非表示、健太郎が手動ON
});

const { error: wErr } = await sb.from('settings').update({
  value: subs,
  updated_at: new Date().toISOString(),
}).eq('key', 'sub_calendars');

if (wErr) { console.error('write err:', wErr.message); process.exit(1); }
console.log('✅ added "uriage" sub_calendar. Total sub_calendars:', subs.length);
