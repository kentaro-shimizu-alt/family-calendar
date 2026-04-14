'use client';

import { useEffect, useState } from 'react';
import { COLOR_PALETTE, Member, SubCalendar, colorVariants } from '@/lib/types';
import { KINENBI } from '@/lib/kinenbi';
import { HANABI_2026 } from '@/lib/hanabi';

// 仮想カレンダーのデータ件数
const KINENBI_COUNT = Object.keys(KINENBI).length; // 366
const HANABI_COUNT = HANABI_2026.length; // 67

// 仮想カレンダー localStorage キー定義
export const VIRTUAL_CAL_KEYS = {
  kinenbi: {
    color:         'cal-virtual-kinenbi-color',
    icon:          'cal-virtual-kinenbi-icon',
    hiddenFromBar: 'cal-virtual-kinenbi-hiddenFromBar',
  },
  hanabi: {
    color:         'cal-virtual-hanabi-color',
    icon:          'cal-virtual-hanabi-icon',
    hiddenFromBar: 'cal-virtual-hanabi-hiddenFromBar',
  },
} as const;

// デフォルト値
const VIRTUAL_DEFAULTS = {
  kinenbi: { color: '#ec4899', icon: '🎉', hiddenFromBar: false },
  hanabi:  { color: '#f97316', icon: '🎆', hiddenFromBar: false },
};

export interface VirtualCalSettings {
  color: string;
  icon: string;
  hiddenFromBar: boolean;
}

function loadVirtualSettings(key: 'kinenbi' | 'hanabi'): VirtualCalSettings {
  if (typeof window === 'undefined') return VIRTUAL_DEFAULTS[key];
  try {
    const k = VIRTUAL_CAL_KEYS[key];
    return {
      color:         localStorage.getItem(k.color)         ?? VIRTUAL_DEFAULTS[key].color,
      icon:          localStorage.getItem(k.icon)          ?? VIRTUAL_DEFAULTS[key].icon,
      hiddenFromBar: localStorage.getItem(k.hiddenFromBar) === '1',
    };
  } catch {
    return VIRTUAL_DEFAULTS[key];
  }
}

function saveVirtualSettings(key: 'kinenbi' | 'hanabi', s: VirtualCalSettings) {
  try {
    const k = VIRTUAL_CAL_KEYS[key];
    localStorage.setItem(k.color,         s.color);
    localStorage.setItem(k.icon,          s.icon);
    localStorage.setItem(k.hiddenFromBar, s.hiddenFromBar ? '1' : '0');
  } catch {}
}

interface Props {
  open: boolean;
  members: Member[];
  subCalendars: SubCalendar[];
  totalEventCount?: number;
  eventCountByCalendar?: Record<string, number>;
  eventCountByMember?: Record<string, number>;
  theme?: 'light' | 'dark';
  onThemeChange?: (t: 'light' | 'dark') => void;
  onClose: () => void;
  onSaved: (members: Member[], subCalendars: SubCalendar[]) => void;
  showKinenbi?: boolean;
  showHanabi?: boolean;
  onToggleKinenbi?: () => void;
  onToggleHanabi?: () => void;
  /** 仮想カレンダー設定変更コールバック（page.tsx側でフィルターバーの色・アイコンを更新するため） */
  onVirtualCalChange?: (key: 'kinenbi' | 'hanabi', s: VirtualCalSettings) => void;
}

const ICON_PALETTE = ['🏠', '💼', '🌟', '👨‍👩‍👧', '🎓', '⚽', '🎸', '🏥', '🛒', '✈️', '🍽️', '🐶', '📅', '🎉', '💪', '🎆', '🎇', '🎊', '🌸', '🍁'];

// 💣 削除（カレンダー・メンバー）操作用のPIN。将来変更する時はここだけ書き換える。
const DELETE_PIN = '0713';

export default function SettingsModal({ open, members, subCalendars, totalEventCount, eventCountByCalendar, eventCountByMember, theme, onThemeChange, onClose, onSaved, showKinenbi, showHanabi, onToggleKinenbi, onToggleHanabi, onVirtualCalChange }: Props) {
  const [tab, setTab] = useState<'members' | 'calendars' | 'display' | 'export'>('members');
  const [localMembers, setLocalMembers] = useState<Member[]>(members);
  const [localCals, setLocalCals] = useState<SubCalendar[]>(subCalendars);
  const [saving, setSaving] = useState(false);

  // 仮想カレンダー設定（color/icon/hiddenFromBar）
  const [kinenbiSettings, setKinenbiSettings] = useState<VirtualCalSettings>(VIRTUAL_DEFAULTS.kinenbi);
  const [hanabiSettings, setHanabiSettings] = useState<VirtualCalSettings>(VIRTUAL_DEFAULTS.hanabi);

  useEffect(() => {
    if (open) {
      setLocalMembers(members);
      setLocalCals(subCalendars);
      // 仮想カレンダー設定を localStorage から読み込む
      setKinenbiSettings(loadVirtualSettings('kinenbi'));
      setHanabiSettings(loadVirtualSettings('hanabi'));
    }
  }, [open, members, subCalendars]);

  if (!open) return null;

  function updateMember(id: string, patch: Partial<Member>) {
    setLocalMembers((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const merged = { ...m, ...patch };
        if (patch.color) {
          const v = colorVariants(patch.color);
          merged.bgColor = v.bgColor;
          merged.textColor = v.textColor;
        }
        return merged;
      })
    );
  }

  function addMember() {
    const id = 'm_' + Math.random().toString(36).slice(2, 7);
    const color = COLOR_PALETTE[localMembers.length % COLOR_PALETTE.length];
    const v = colorVariants(color);
    setLocalMembers((prev) => [
      ...prev,
      { id, name: '新メンバー', color, bgColor: v.bgColor, textColor: v.textColor },
    ]);
  }

  function removeMember(id: string) {
    const target = localMembers.find((m) => m.id === id);
    if (!target) return;
    const ok1 = confirm(
      `⚠️ メンバー「${target.name}」を削除しようとしています。\n本当に削除してよろしいですか？`
    );
    if (!ok1) return;
    const pin = prompt('🔒 削除の最終確認：PINを入力してください（4桁）');
    if (pin !== DELETE_PIN) {
      alert('❌ PINが違います。削除を中止しました。');
      return;
    }
    setLocalMembers((prev) => prev.filter((m) => m.id !== id));
  }

  function updateCal(id: string, patch: Partial<SubCalendar>) {
    setLocalCals((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function addCal() {
    const id = 'c_' + Math.random().toString(36).slice(2, 7);
    const color = COLOR_PALETTE[localCals.length % COLOR_PALETTE.length];
    setLocalCals((prev) => [
      ...prev,
      { id, name: '新カレンダー', color, icon: '📅', visible: true },
    ]);
  }

  function removeCal(id: string) {
    const target = localCals.find((c) => c.id === id);
    if (!target) return;
    // 💣 核ボタンガード：3段階確認
    const ok1 = confirm(
      `⚠️ カレンダー「${target.name}」を削除しようとしています。\n\n` +
        `このカレンダーに紐づく予定は表示されなくなります（DB自体は残る）。\n` +
        `本当に削除してよろしいですか？`
    );
    if (!ok1) return;
    const pin = prompt('🔒 削除の最終確認：PINを入力してください（4桁）');
    if (pin !== DELETE_PIN) {
      alert('❌ PINが違います。削除を中止しました。');
      return;
    }
    const ok2 = confirm(
      `最後の確認です。\n\n「${target.name}」を本当に削除しますか？\nこの操作は元に戻せません。`
    );
    if (!ok2) return;
    setLocalCals((prev) => prev.filter((c) => c.id !== id));
  }

  /** 仮想カレンダー設定を更新して localStorage に保存し、親へ通知 */
  function updateVirtualCal(key: 'kinenbi' | 'hanabi', patch: Partial<VirtualCalSettings>) {
    const setter = key === 'kinenbi' ? setKinenbiSettings : setHanabiSettings;
    const current = key === 'kinenbi' ? kinenbiSettings : hanabiSettings;
    const next = { ...current, ...patch };
    setter(next);
    saveVirtualSettings(key, next);
    onVirtualCalChange?.(key, next);
  }

  /** 仮想カレンダーの「削除」= visible を OFF にする（表示OFFと同義） */
  function hideVirtualCal(key: 'kinenbi' | 'hanabi') {
    if (key === 'kinenbi') {
      onToggleKinenbi?.();
    } else {
      onToggleHanabi?.();
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await Promise.all([
        fetch('/api/members', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ members: localMembers }),
        }),
        fetch('/api/subcalendars', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subCalendars: localCals }),
        }),
      ]);
      onSaved(localMembers, localCals);
      onClose();
    } catch (e: any) {
      alert('保存失敗: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  /** 仮想カレンダーを通常カレンダーと同じUIでレンダリング */
  function renderVirtualCalCard(
    key: 'kinenbi' | 'hanabi',
    label: string,
    count: number,
    isVisible: boolean,
    settings: VirtualCalSettings
  ) {
    return (
      <div
        key={`virtual-${key}`}
        className={`border rounded-lg p-3 space-y-2 ${settings.hiddenFromBar ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-slate-200'}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">{settings.icon}</span>
          {/* 名前は静的（編集不可） */}
          <span className="flex-1 text-sm font-medium text-slate-700">{label}</span>
          {/* 件数表示 */}
          <span className="text-[10px] text-slate-400 whitespace-nowrap">{count}件</span>
          {/* 表示チェック */}
          <label className="text-xs flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={isVisible ?? false}
              onChange={() => hideVirtualCal(key)}
              className="w-3.5 h-3.5"
            />
            表示
          </label>
          {/* バー非表示チェック */}
          <label className="text-xs flex items-center gap-1 cursor-pointer text-slate-400">
            <input
              type="checkbox"
              checked={!!settings.hiddenFromBar}
              onChange={(e) => updateVirtualCal(key, { hiddenFromBar: e.target.checked })}
              className="w-3.5 h-3.5"
            />
            バー非表示
          </label>
          {/* 削除ボタン = 非表示にする */}
          <button
            onClick={() => {
              if (isVisible) {
                hideVirtualCal(key);
              }
              alert(`「${label}」を非表示にしました。\n（静的データのため実データ削除はできません）`);
            }}
            className="text-rose-400 hover:text-rose-600 text-xs px-2 py-1"
          >削除</button>
        </div>
        {/* 色選択パレット */}
        <div>
          <div className="text-[10px] text-slate-400 mb-1">色</div>
          <div className="flex flex-wrap gap-1">
            {COLOR_PALETTE.map((col) => (
              <button
                key={col}
                onClick={() => updateVirtualCal(key, { color: col })}
                className={`w-6 h-6 rounded-full border-2 transition ${
                  settings.color === col ? 'border-slate-800 scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: col }}
              />
            ))}
          </div>
        </div>
        {/* アイコン選択パレット */}
        <div>
          <div className="text-[10px] text-slate-400 mb-1">アイコン</div>
          <div className="flex flex-wrap gap-1">
            {ICON_PALETTE.map((ic) => (
              <button
                key={ic}
                onClick={() => updateVirtualCal(key, { icon: ic })}
                className={`w-7 h-7 rounded text-lg transition ${
                  settings.icon === ic ? 'bg-blue-100 ring-2 ring-blue-400' : 'hover:bg-slate-50'
                }`}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-bold text-lg">⚙️ 設定</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        <div className="flex border-b border-slate-100 px-3 sticky top-[52px] bg-white z-10">
          {[
            { id: 'members' as const, label: '👤 メンバー' },
            { id: 'calendars' as const, label: '📅 カレンダー' },
            { id: 'display' as const, label: '🎨 表示' },
            { id: 'export' as const, label: '📤 エクスポート' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 text-sm py-2 border-b-2 transition ${
                tab === t.id ? 'border-blue-500 text-blue-600 font-bold' : 'border-transparent text-slate-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 space-y-3">
          {tab === 'members' && (
            <>
              {localMembers.map((m) => (
                <div key={m.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full" style={{ backgroundColor: m.color }} />
                    <input
                      type="text"
                      value={m.name}
                      onChange={(e) => updateMember(m.id, { name: e.target.value })}
                      className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-sm"
                    />
                    {eventCountByMember && eventCountByMember[m.id] != null && (
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{eventCountByMember[m.id].toLocaleString()}件</span>
                    )}
                    <button
                      onClick={() => removeMember(m.id)}
                      className="text-rose-400 hover:text-rose-600 text-xs px-2 py-1"
                    >削除</button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        onClick={() => updateMember(m.id, { color: c })}
                        className={`w-6 h-6 rounded-full border-2 transition ${
                          m.color === c ? 'border-slate-800 scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <button
                onClick={addMember}
                className="w-full border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-400 hover:text-blue-500 rounded-lg py-2 text-sm transition"
              >
                + メンバーを追加
              </button>
            </>
          )}

          {tab === 'calendars' && (
            <>
              {totalEventCount != null && (
                <div className="text-xs text-slate-500 text-right pb-1">
                  総予定件数: <span className="font-bold text-slate-700">{totalEventCount.toLocaleString()}</span> 件
                </div>
              )}
              {localCals.map((c) => (
                <div key={c.id} className={`border rounded-lg p-3 space-y-2 ${c.hiddenFromBar ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-slate-200'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{c.icon}</span>
                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => updateCal(c.id, { name: e.target.value })}
                      className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-sm"
                    />
                    {eventCountByCalendar && eventCountByCalendar[c.id] != null && (
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{eventCountByCalendar[c.id]}件</span>
                    )}
                    <label className="text-xs flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.visible}
                        onChange={(e) => updateCal(c.id, { visible: e.target.checked })}
                        className="w-3.5 h-3.5"
                      />
                      表示
                    </label>
                    <label className="text-xs flex items-center gap-1 cursor-pointer text-slate-400">
                      <input
                        type="checkbox"
                        checked={!!c.hiddenFromBar}
                        onChange={(e) => updateCal(c.id, { hiddenFromBar: e.target.checked })}
                        className="w-3.5 h-3.5"
                      />
                      バー非表示
                    </label>
                    <button
                      onClick={() => removeCal(c.id)}
                      className="text-rose-400 hover:text-rose-600 text-xs px-2 py-1"
                    >削除</button>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">色</div>
                    <div className="flex flex-wrap gap-1">
                      {COLOR_PALETTE.map((col) => (
                        <button
                          key={col}
                          onClick={() => updateCal(c.id, { color: col })}
                          className={`w-6 h-6 rounded-full border-2 transition ${
                            c.color === col ? 'border-slate-800 scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: col }}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">アイコン</div>
                    <div className="flex flex-wrap gap-1">
                      {ICON_PALETTE.map((ic) => (
                        <button
                          key={ic}
                          onClick={() => updateCal(c.id, { icon: ic })}
                          className={`w-7 h-7 rounded text-lg transition ${
                            c.icon === ic ? 'bg-blue-100 ring-2 ring-blue-400' : 'hover:bg-slate-50'
                          }`}
                        >
                          {ic}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              {/* 仮想カレンダー: 今日は何の日（記念日） */}
              {renderVirtualCalCard('kinenbi', '今日は何の日', KINENBI_COUNT, showKinenbi ?? false, kinenbiSettings)}

              {/* 仮想カレンダー: 花火大会 */}
              {renderVirtualCalCard('hanabi', '花火大会', HANABI_COUNT, showHanabi ?? false, hanabiSettings)}

              <button
                onClick={addCal}
                className="w-full border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-400 hover:text-blue-500 rounded-lg py-2 text-sm transition"
              >
                + カレンダーを追加
              </button>
            </>
          )}

          {tab === 'display' && (
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-lg p-4">
                <div className="font-bold text-slate-800 mb-3">🌓 テーマ</div>
                <div className="flex gap-3">
                  {[
                    { value: 'light' as const, label: '☀️ ライト', desc: '明るい背景' },
                    { value: 'dark' as const, label: '🌙 ダーク', desc: '暗い背景' },
                  ].map((t) => (
                    <button
                      key={t.value}
                      onClick={() => onThemeChange?.(t.value)}
                      className={`flex-1 rounded-xl border-2 p-4 text-center transition ${
                        theme === t.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="text-2xl mb-1">{t.label.split(' ')[0]}</div>
                      <div className="text-sm font-semibold">{t.label.split(' ')[1]}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'export' && (
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-lg p-4">
                <div className="font-bold text-slate-800 mb-1">📅 iCal形式でエクスポート</div>
                <div className="text-xs text-slate-500 mb-3">
                  Googleカレンダー・Apple カレンダー・Outlookなどに取り込める標準形式（.ics）
                </div>
                <a
                  href="/api/ical"
                  download="shimizu-calendar.ics"
                  className="inline-block bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-lg"
                >
                  ダウンロード (.ics)
                </a>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <div className="font-bold text-slate-800 mb-1">🔗 購読用URL</div>
                <div className="text-xs text-slate-500 mb-2">
                  他のカレンダーアプリで「URLで購読」する場合に使用
                </div>
                <code className="block bg-slate-50 text-xs p-2 rounded break-all">
                  {typeof window !== 'undefined' ? `${window.location.origin}/api/ical` : '/api/ical'}
                </code>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 sticky bottom-0 bg-white">
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={saving}
            className="text-slate-500 text-sm hover:bg-slate-50 px-4 py-2 rounded-lg disabled:opacity-50"
          >キャンセル</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-500 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
