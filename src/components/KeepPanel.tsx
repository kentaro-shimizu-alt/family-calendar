'use client';

import { useEffect, useRef, useState } from 'react';
import { KeepItem } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type KeepType = 'memo' | 'todo' | 'shopping';

export default function KeepPanel({ open, onClose }: Props) {
  const [items, setItems] = useState<KeepItem[]>([]);
  const [tab, setTab] = useState<KeepType>('memo');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [editing, setEditing] = useState<KeepItem | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/keep');
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  // 2026-05-05 戻るボタンで閉じる(健太郎LW「何かと戻るボタンが効くようにしてほしい」)
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    history.pushState({ modal: 'keep' }, '');
    const handler = () => onCloseRef.current();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [open]);

  if (!open) return null;

  const filtered = items.filter((i) => i.type === tab);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    try {
      await fetch('/api/keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: tab,
          title: newTitle.trim(),
          body: tab === 'memo' ? newBody : undefined,
          items: tab !== 'memo' ? [] : undefined,
        }),
      });
      setNewTitle('');
      setNewBody('');
      setCreating(false);
      load();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('削除しますか？')) return;
    try {
      await fetch(`/api/keep/${id}`, { method: 'DELETE' });
      if (editing?.id === id) setEditing(null);
      load();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleUpdate(item: KeepItem) {
    try {
      await fetch(`/api/keep/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      load();
    } catch (e) {
      console.error(e);
    }
  }

  function toggleListItem(item: KeepItem, itemId: string) {
    const next: KeepItem = {
      ...item,
      items: (item.items || []).map((it) =>
        it.id === itemId ? { ...it, done: !it.done } : it
      ),
    };
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
    handleUpdate(next);
  }

  function addListItem(item: KeepItem, text: string) {
    if (!text.trim()) return;
    const next: KeepItem = {
      ...item,
      items: [
        ...(item.items || []),
        { id: Math.random().toString(36).slice(2, 9), text: text.trim(), done: false },
      ],
    };
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
    handleUpdate(next);
  }

  function removeListItem(item: KeepItem, itemId: string) {
    const next: KeepItem = {
      ...item,
      items: (item.items || []).filter((it) => it.id !== itemId),
    };
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
    handleUpdate(next);
  }

  const tabConfig: { id: KeepType; label: string; icon: string }[] = [
    { id: 'memo', label: 'メモ', icon: '📝' },
    { id: 'todo', label: 'ToDo', icon: '✅' },
    { id: 'shopping', label: '買い物', icon: '🛒' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-bold text-lg">📚 Keep</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-3 pt-2 sticky top-[52px] bg-white z-10">
          {tabConfig.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setCreating(false); }}
              className={`flex-1 text-sm py-2 border-b-2 transition ${
                tab === t.id ? 'border-blue-500 text-blue-600 font-bold' : 'border-transparent text-slate-400'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Create */}
          {creating ? (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="タイトル"
                autoFocus
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              />
              {tab === 'memo' && (
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  rows={4}
                  placeholder="内容..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white resize-y"
                />
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setCreating(false); setNewTitle(''); setNewBody(''); }}
                  className="text-slate-500 text-sm px-3 py-1.5 hover:bg-slate-100 rounded-lg"
                >キャンセル</button>
                <button
                  onClick={handleCreate}
                  className="bg-blue-500 text-white text-sm font-bold px-4 py-1.5 rounded-lg hover:bg-blue-600"
                >作成</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-400 hover:text-blue-500 rounded-lg py-3 text-sm transition"
            >
              + 新規{tabConfig.find((t) => t.id === tab)?.label}
            </button>
          )}

          {loading && <div className="text-xs text-slate-400 text-center">読み込み中...</div>}

          {/* Items */}
          {filtered.length === 0 && !loading && (
            <div className="text-xs text-slate-400 text-center py-4">まだありません</div>
          )}

          {filtered.map((item) => (
            <div key={item.id} className="border border-slate-200 rounded-lg p-3 group">
              <div className="flex items-start justify-between gap-2 mb-1">
                <input
                  type="text"
                  value={item.title}
                  onChange={(e) => {
                    const next = { ...item, title: e.target.value };
                    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
                  }}
                  onBlur={() => handleUpdate(item)}
                  className="flex-1 font-bold text-slate-800 bg-transparent focus:outline-none focus:bg-slate-50 rounded px-1"
                />
                <button
                  onClick={() => handleDelete(item.id)}
                  className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-600 text-sm transition"
                >削除</button>
              </div>

              {item.type === 'memo' && (
                <textarea
                  value={item.body || ''}
                  onChange={(e) => {
                    const next = { ...item, body: e.target.value };
                    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
                  }}
                  onBlur={() => handleUpdate(item)}
                  rows={3}
                  placeholder="メモ..."
                  className="w-full text-sm text-slate-700 bg-transparent focus:outline-none focus:bg-slate-50 rounded px-1 py-1 resize-y"
                />
              )}

              {(item.type === 'todo' || item.type === 'shopping') && (
                <div className="space-y-1 mt-1">
                  {(item.items || []).map((it) => (
                    <div key={it.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={it.done}
                        onChange={() => toggleListItem(item, it.id)}
                        className="w-4 h-4 accent-blue-500"
                      />
                      <span className={`flex-1 ${it.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                        {it.text}
                      </span>
                      <button
                        onClick={() => removeListItem(item, it.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 text-xs"
                      >×</button>
                    </div>
                  ))}
                  <input
                    type="text"
                    placeholder="+ 項目を追加（Enterで確定）"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value;
                        addListItem(item, v);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                    className="w-full text-sm text-slate-500 bg-transparent border-b border-dashed border-slate-200 focus:outline-none focus:border-blue-300 px-1 py-1"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
