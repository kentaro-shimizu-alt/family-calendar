// 全国 花火大会データ 2026
// 注意: 日程は2025年実績+例年の開催パターンから推定した「予定」です。
// 確定情報は各主催者の公式発表を必ず確認してください。
// date: 'YYYY-MM-DD', 雨天順延がある場合は主に予定日のみ記載
export interface HanabiEvent {
  date: string;       // 'YYYY-MM-DD'
  name: string;       // 大会名
  place: string;      // 開催地（都道府県＋市区町村）
  region: 'hokkaido' | 'tohoku' | 'kanto' | 'chubu' | 'kansai' | 'chugoku' | 'shikoku' | 'kyushu' | 'okinawa';
  note?: string;
}

export const HANABI_2026: HanabiEvent[] = [
  // === 関西 ===
  { date: '2026-07-25', name: '天神祭奉納花火', place: '大阪府大阪市', region: 'kansai', note: '大川沿い、約3000〜5000発' },
  { date: '2026-08-08', name: 'なにわ淀川花火大会', place: '大阪府大阪市', region: 'kansai', note: '淀川河川敷、関西最大級' },
  { date: '2026-08-01', name: 'PL花火芸術（教祖祭PL花火芸術）', place: '大阪府富田林市', region: 'kansai', note: '日本最大級、数万発' },
  { date: '2026-08-15', name: '猪名川花火大会', place: '兵庫県川西市・大阪府池田市', region: 'kansai' },
  { date: '2026-08-01', name: '岸和田港まつり花火大会', place: '大阪府岸和田市', region: 'kansai' },
  { date: '2026-07-11', name: 'みなとこうべ海上花火大会', place: '兵庫県神戸市', region: 'kansai', note: '予定。2024年で一旦終了・復活時の日程' },
  { date: '2026-08-05', name: '芦屋サマーカーニバル花火大会', place: '兵庫県芦屋市', region: 'kansai' },
  { date: '2026-08-08', name: 'みなと神戸海上花火大会', place: '兵庫県神戸市', region: 'kansai' },
  { date: '2026-07-25', name: '宮津燈籠流し花火大会', place: '京都府宮津市', region: 'kansai', note: '日本三大燈籠流し' },
  { date: '2026-08-09', name: '亀岡平和祭保津川花火大会', place: '京都府亀岡市', region: 'kansai' },
  { date: '2026-08-16', name: '京都五山送り火', place: '京都府京都市', region: 'kansai', note: '花火ではないが夏の風物詩' },
  { date: '2026-08-05', name: 'びわ湖大花火大会', place: '滋賀県大津市', region: 'kansai', note: '約10000発' },
  { date: '2026-08-15', name: '長浜・北びわ湖大花火大会', place: '滋賀県長浜市', region: 'kansai' },
  { date: '2026-07-18', name: '熊野大花火大会', place: '三重県熊野市', region: 'kansai', note: '海上自爆・三尺玉' },
  { date: '2026-07-26', name: '和歌山みなと祭花火大会', place: '和歌山県和歌山市', region: 'kansai' },
  { date: '2026-08-01', name: '白浜花火フェスティバル', place: '和歌山県白浜町', region: 'kansai' },
  { date: '2026-08-10', name: '奈良大文字送り火', place: '奈良県奈良市', region: 'kansai', note: '高円山大文字' },

  // === 関東 ===
  { date: '2026-07-25', name: '隅田川花火大会', place: '東京都台東区・墨田区', region: 'kanto', note: '約20000発、日本最古' },
  { date: '2026-08-08', name: '江戸川区花火大会', place: '東京都江戸川区', region: 'kanto' },
  { date: '2026-07-18', name: '足立の花火', place: '東京都足立区', region: 'kanto' },
  { date: '2026-08-15', name: '神宮外苑花火大会', place: '東京都新宿区', region: 'kanto' },
  { date: '2026-08-08', name: '東京湾大華火祭', place: '東京都中央区', region: 'kanto' },
  { date: '2026-08-02', name: '鎌倉花火大会', place: '神奈川県鎌倉市', region: 'kanto' },
  { date: '2026-08-01', name: '横浜開港祭花火大会', place: '神奈川県横浜市', region: 'kanto' },
  { date: '2026-07-25', name: 'みなとみらいスマートフェスティバル', place: '神奈川県横浜市', region: 'kanto' },
  { date: '2026-08-22', name: '土浦全国花火競技大会', place: '茨城県土浦市', region: 'kanto', note: '日本三大花火' },

  // === 中部 ===
  { date: '2026-07-25', name: '長岡まつり大花火大会', place: '新潟県長岡市', region: 'chubu', note: '日本三大花火、正三尺玉' },
  { date: '2026-07-26', name: '長岡まつり大花火大会（2日目）', place: '新潟県長岡市', region: 'chubu' },
  { date: '2026-09-05', name: '片貝まつり浅原神社秋季例大祭奉納大煙火', place: '新潟県小千谷市', region: 'chubu', note: '世界一の四尺玉' },
  { date: '2026-09-06', name: '片貝まつり（2日目）', place: '新潟県小千谷市', region: 'chubu' },
  { date: '2026-07-18', name: '豊田おいでんまつり花火大会', place: '愛知県豊田市', region: 'chubu' },
  { date: '2026-08-22', name: '岡崎城下家康公夏まつり花火大会', place: '愛知県岡崎市', region: 'chubu', note: '三河花火の競演' },
  { date: '2026-07-25', name: '熱田まつり（尚武祭）', place: '愛知県名古屋市', region: 'chubu' },
  { date: '2026-08-01', name: '長良川全国花火大会', place: '岐阜県岐阜市', region: 'chubu' },
  { date: '2026-08-08', name: '長良川中日花火大会', place: '岐阜県岐阜市', region: 'chubu' },
  { date: '2026-08-15', name: '諏訪湖祭湖上花火大会', place: '長野県諏訪市', region: 'chubu', note: '約40000発' },
  { date: '2026-08-23', name: '全国新作花火競技大会', place: '長野県諏訪市', region: 'chubu' },

  // === 東北 ===
  { date: '2026-08-26', name: '大曲の花火（全国花火競技大会）', place: '秋田県大仙市', region: 'tohoku', note: '日本三大花火の頂点' },
  { date: '2026-07-11', name: '古川まつり花火大会', place: '宮城県大崎市', region: 'tohoku' },
  { date: '2026-08-05', name: '仙台七夕花火祭', place: '宮城県仙台市', region: 'tohoku' },
  { date: '2026-08-02', name: 'ねぶた祭花火大会', place: '青森県青森市', region: 'tohoku', note: '青森花火大会' },
  { date: '2026-08-16', name: '北上・みちのく芸能まつり花火大会', place: '岩手県北上市', region: 'tohoku' },
  { date: '2026-08-23', name: '山形花火大会', place: '山形県山形市', region: 'tohoku' },
  { date: '2026-08-07', name: '赤川花火大会', place: '山形県鶴岡市', region: 'tohoku' },
  { date: '2026-08-22', name: '湯野浜温泉花火大会', place: '山形県鶴岡市', region: 'tohoku' },

  // === 北海道 ===
  { date: '2026-07-18', name: '道新・UHB花火大会', place: '北海道札幌市', region: 'hokkaido' },
  { date: '2026-08-01', name: '函館港まつり花火大会', place: '北海道函館市', region: 'hokkaido' },
  { date: '2026-07-29', name: 'モエレ沼芸術花火', place: '北海道札幌市', region: 'hokkaido' },

  // === 中国 ===
  { date: '2026-08-08', name: '宮島水中花火大会', place: '広島県廿日市市', region: 'chugoku', note: '厳島の水中花火（開催有無は要確認）' },
  { date: '2026-07-25', name: '広島みなと夢花火大会', place: '広島県広島市', region: 'chugoku' },
  { date: '2026-08-15', name: '萩夏まつり花火大会', place: '山口県萩市', region: 'chugoku' },
  { date: '2026-08-13', name: '関門海峡花火大会', place: '福岡県北九州市・山口県下関市', region: 'chugoku', note: '2都市同時打ち上げ、約15000発' },
  { date: '2026-07-25', name: '松江水郷祭湖上花火大会', place: '島根県松江市', region: 'chugoku' },
  { date: '2026-08-08', name: '玉野まつり花火大会', place: '岡山県玉野市', region: 'chugoku' },

  // === 四国 ===
  { date: '2026-08-09', name: 'さぬき高松まつり花火大会', place: '香川県高松市', region: 'shikoku' },
  { date: '2026-08-15', name: '阿波おどり花火大会', place: '徳島県徳島市', region: 'shikoku' },
  { date: '2026-08-05', name: '松山港まつり三津浜花火大会', place: '愛媛県松山市', region: 'shikoku' },
  { date: '2026-08-09', name: 'よさこい花火大会', place: '高知県高知市', region: 'shikoku' },

  // === 九州・沖縄 ===
  { date: '2026-07-18', name: '博多湾大花火大会', place: '福岡県福岡市', region: 'kyushu' },
  { date: '2026-08-01', name: '筑後川花火大会', place: '福岡県久留米市', region: 'kyushu', note: '西日本最大級' },
  { date: '2026-08-02', name: '大牟田「大蛇山」まつり花火大会', place: '福岡県大牟田市', region: 'kyushu' },
  { date: '2026-07-25', name: '長崎みなとまつり花火大会', place: '長崎県長崎市', region: 'kyushu' },
  { date: '2026-08-15', name: 'ハウステンボス全国花火競技大会', place: '長崎県佐世保市', region: 'kyushu' },
  { date: '2026-07-25', name: '川内川花火大会', place: '鹿児島県薩摩川内市', region: 'kyushu' },
  { date: '2026-08-22', name: '水前寺江津湖花火大会', place: '熊本県熊本市', region: 'kyushu' },
  { date: '2026-08-08', name: '宮崎納涼花火大会', place: '宮崎県宮崎市', region: 'kyushu' },
  { date: '2026-07-11', name: '琉球海炎祭', place: '沖縄県宜野湾市', region: 'okinawa', note: '日本一早い夏花火' },
];

export function getHanabiByDate(date: Date): HanabiEvent[] {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return HANABI_2026.filter((h) => h.date === key);
}
