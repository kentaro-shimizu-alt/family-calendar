import React from 'react';

// URL検出: http:// / https:// / yjcarnavi:// で始まり、空白・全角空白・改行・<>"）)」】]の直前まで
// 末尾の句読点 . , ; : ! ? ） ) 」 】 、 。 は含めない（自然文の区切り保全）
const URL_REGEX = /((?:https?|yjcarnavi):\/\/[^\s<>"'（）()「」【】]+)/g;
const TRAIL_PUNCT = /[.,;:!?）)」】、。]+$/;

/**
 * 文字列中の URL を <a> リンクに変換して React ノード配列を返す。
 * 改行は whitespace-pre-wrap 親要素側で保持される想定。
 * - target=_blank / rel=noopener noreferrer
 * - 末尾の全角/半角句読点はリンクから除外
 */
export function linkifyUrls(text: string | null | undefined): React.ReactNode {
  if (!text) return text ?? '';
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const m of text.matchAll(URL_REGEX)) {
    const raw = m[0];
    const start = m.index ?? 0;
    // 末尾句読点を本文側に戻す
    let url = raw;
    let trailing = '';
    const tm = url.match(TRAIL_PUNCT);
    if (tm) {
      trailing = tm[0];
      url = url.slice(0, -trailing.length);
    }
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }
    parts.push(
      <a
        key={`u${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline hover:text-blue-800 break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    if (trailing) parts.push(trailing);
    lastIndex = start + raw.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
