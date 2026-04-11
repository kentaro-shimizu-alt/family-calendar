#!/usr/bin/env python3
"""
console_messages の TT_CHUNK_N: データを timetree_events.json に変換
"""
import json
import re
import sys

INPUT = r"C:\Users\film_\.claude\projects\C--Users-film--Documents-Claudecode\687a6291-5ff5-4d31-bef4-7edb55261503\tool-results\mcp-Claude_in_Chrome-read_console_messages-1775911655379.txt"
OUTPUT = r"C:\Users\film_\Documents\family_calendar\scripts\_snapshots\timetree_events.json"

# consoleメッセージのJSONを読む
with open(INPUT, encoding='utf-8') as f:
    data = json.load(f)

# data は [{type, text}] の配列。text の中に全メッセージが含まれる
full_text = '\n'.join(item.get('text', '') for item in data)

# TT_CHUNK_N:[...] を正規表現で全部抽出
all_events = []
pattern = re.compile(r'TT_CHUNK_(\d+):((?:\[(?:[^[\]]*|\[[^[\]]*\])*\]))', re.DOTALL)

# 大きなテキストから全チャンクを抽出
# 各チャンクは改行で区切られているので行単位で処理
for line in full_text.split('\n'):
    m = re.match(r'TT_CHUNK_\d+:(\[.+\])$', line)
    if not m:
        continue
    try:
        chunk = json.loads(m.group(1))
        all_events.extend(chunk)
    except json.JSONDecodeError as e:
        # 行が途中で切れていた場合、別途処理
        print(f"WARN: parse error on line: {e}", file=sys.stderr)

# 行分割で取得できなかった場合、全文字列から再試行
if not all_events:
    matches = re.findall(r'TT_CHUNK_\d+:(\[[^\n]+\])', full_text)
    for m in matches:
        try:
            chunk = json.loads(m)
            all_events.extend(chunk)
        except json.JSONDecodeError as e:
            print(f"WARN: {e}", file=sys.stderr)

# compact版 → full版に変換（nullフィールドを明示的に追加）
full_events = []
for e in all_events:
    full = {
        "id": e.get("id"),
        "title": e.get("title", "(無題)"),
        "date": e.get("date"),
        "endDate": e.get("endDate", None),
        "startTime": e.get("startTime", None),
        "endTime": e.get("endTime", None),
        "allDay": e.get("allDay", True),
        "location": e.get("location", None),
        "note": e.get("note", None),
        "calendarName": e.get("calendarName"),
        "creatorName": e.get("creatorName", None),
        "color": None,
        "recurrence": e.get("recurrence", None),
    }
    full_events.append(full)

# 重複排除（id基準）
seen = set()
deduped = []
for e in full_events:
    if e["id"] not in seen:
        seen.add(e["id"])
        deduped.append(e)

# 日付順ソート
deduped.sort(key=lambda e: e["date"])

# 書き出し
with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(deduped, f, ensure_ascii=False, indent=2)

sys.stdout.buffer.write(b"\nSaved OK: " + OUTPUT.encode('ascii', errors='replace') + b"\n")
