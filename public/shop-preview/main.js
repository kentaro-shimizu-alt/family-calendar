/*!
 * tecnest.biz/shop/ Frontend Logic
 * 材料販売HP フロント(カート/価格計算/承諾バリデ/送信)
 * 生成: 2026-04-19 くろ Round 4技術設計 実装版
 */
(() => {
  'use strict';

  const SHOP = {
    products: null,
    cart: [],
    TAX_RATE: 0.10,
    STORAGE_KEY: 'tecnest_shop_cart_v1',
    // 2026-04-20 改修: 8項目個別チェックから「全体同意1チェック」に変更。
    // consent-scroll を最下部までスクロールしたら consent-all のdisabled解除→チェック可能。
    CONSENT_KEYS: ['all'],
    _consentScrollRead: false,  // スクロール最下部到達フラグ

    /* ───────────── 初期化 ───────────── */
    async init() {
      try {
        // BCPくろ提言: 緊急停止チェック(最優先・AI障害時の受注停止用)
        const modeRes = await fetch('./mode.txt?_=' + Date.now());
        const mode = modeRes.ok ? (await modeRes.text()).trim() : 'live';
        if (mode === 'suspended' || mode === 'maintenance') {
          this.showSuspendedBanner(mode);
          return;
        }

        const verRes = await fetch('./version.txt?_=' + Date.now());
        const ver = verRes.ok ? (await verRes.text()).trim() : String(Date.now());
        const res = await fetch(`./products.json?v=${ver}`);
        if (!res.ok) throw new Error('products.json取得失敗: ' + res.status);
        this.products = await res.json();
        this.restoreCart();
        this.bindEvents();
        if (this.cart.length === 0) this.addRow();
        this.renderCart();
        this.initConsentScroll();
      } catch (e) {
        console.error('[shop] init失敗', e);
        this.showFatalError('商品データの読み込みに失敗しました。ページを再読み込みしてください。');
      }
    },

    /* ───────────── 緊急停止表示(BCP対応) ─────────────
     * 切替方法: Xserverにて ./mode.txt を
     *   "suspended" or "maintenance" にアップロード
     *   通常運用時は "live" or ファイル不在でOK
     */
    showSuspendedBanner(mode) {
      const el = document.getElementById('shop-app');
      if (!el) return;
      const title = mode === 'maintenance'
        ? 'ただいまメンテナンス中です'
        : 'ただいま新規ご注文受付を一時停止しております';
      const body = mode === 'maintenance'
        ? '申し訳ございません。サイトメンテナンス中のため、しばらくお待ちください。'
        : '申し訳ございません。体制整備のため、新規注文の受付を一時的に停止しております。';
      el.innerHTML = `
        <div class="suspended-banner">
          <h2>${title}</h2>
          <p>${body}</p>
          <p>お急ぎのお問い合わせは下記まで直接ご連絡ください。</p>
          <div class="contact">
            <strong>株式会社テクネスト</strong><br>
            TEL: <a href="tel:09050128754">090-5012-8754</a>(平日10:00-18:00)<br>
            メール: <a href="mailto:order@tecnest.biz">order@tecnest.biz</a>
          </div>
          <p class="note">再開のお知らせは <a href="https://tecnest.biz/">tecnest.biz</a> にてご案内いたします。</p>
        </div>`;
    },

    /* ───────────── 正規化 ─────────────
     * Python側(tools/build_shop_products_json.py)と完全一致
     */
    normalizePn(s) {
      if (!s) return '';
      s = s.normalize('NFKC').toUpperCase().trim();
      s = s.replace(/\s+/g, '');
      s = s.replace(/[\u2010-\u2015\u2212\uFF0D\u30FC\u2212]/g, '-');
      // 2026-04-20 Round1 QA対応: ハイフン欠落補完
      // 「AE1632」→「AE-1632」/「ME2281AR」→「ME-2281AR」等に自動補完
      if (!s.includes('-')) {
        const m = s.match(/^([A-Z]{2,4})(\d{3,5})([A-Z]{0,4})$/);
        if (m) s = `${m[1]}-${m[2]}${m[3]}`;
      }
      return s;
    },

    lookupProduct(input) {
      // 2026-04-20 変更: 前方一致fallback廃止(ME-001→ME-001EX誤bundle事故対策)
      // 客の意図は厳密一致のみ扱う。未登録時は findSuggestions で候補提案する。
      const pn = this.normalizePn(input);
      if (!pn || !this.products) return null;
      return this.products.products.find(p => p.pn === pn) || null;
    },

    /* ───────────── 価格計算 ─────────────
     * 2026-04-20 幅対応: unitOverride が指定されたら hp_price_m の代わりに使用
     *   (SH2CLAR等 width_options から選ばれた幅別価格用)
     */
    applyRevision(product, shipDate = new Date(), unitOverride = null) {
      const rev = this.products.price_revision;
      const d3m = new Date(rev['3m_date']);
      const dsg = new Date(rev.sangetsu_date);
      let mult = 1.0;
      if (product.maker === '3M' || product.brand === 'ダイノック' ||
          product.brand === '3Mフィルム' || product.brand === 'ファサラ') {
        if (shipDate >= d3m) mult = rev['3m_rate'];
      }
      if (product.maker === 'サンゲツ' || product.brand === 'リアテック') {
        if (shipDate >= dsg) mult = rev.sangetsu_rate;
      }
      const base = (unitOverride != null ? unitOverride : product.hp_price_m);
      return Math.ceil(base * mult / 10) * 10;
    },

    /* row の選択済み幅から単価基準を引く(width_options.hp_price_m または product.hp_price_m) */
    getRowBaseUnit(row) {
      if (!row.product) return 0;
      if (row.width_mm && Array.isArray(row.product.width_options)) {
        const opt = row.product.width_options.find(w => w.width_mm === row.width_mm);
        if (opt) return opt.hp_price_m;
      }
      return row.product.hp_price_m;
    },

    /* row の適用単価(価格改定反映済) */
    getRowUnit(row) {
      if (!row.product) return 0;
      return this.applyRevision(row.product, new Date(), this.getRowBaseUnit(row));
    },

    calcTotals() {
      let subtotal = 0;
      let totalMeters = 0;
      for (const item of this.cart) {
        const unit = item.product ? this.getRowUnit(item) : 0;
        const sub = unit * item.meters;
        item.unit_price = unit;
        item.subtotal = sub;
        subtotal += sub;
        totalMeters += item.meters;
      }
      const shipping = totalMeters >= this.products.shipping.free_threshold_m
        ? 0
        : this.products.shipping.flat_fee_yen;
      const taxable = subtotal + shipping;
      const tax = Math.floor(taxable * this.TAX_RATE);
      const total = taxable + tax;
      return { subtotal, shipping, tax, total, totalMeters };
    },

    /* ───────────── カート操作 ───────────── */
    addRow(pn = '', meters = 1) {
      const product = pn ? this.lookupProduct(pn) : null;
      this.cart.push({
        id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
        pn, product, meters,
        width_mm: product?.width_mm || null,
      });
      this.renderCart();
      this.persistCart();
    },

    updateRow(id, patch) {
      const row = this.cart.find(r => r.id === id);
      if (!row) return;
      let pnChanged = false;
      if ('pn' in patch) {
        row.pn = patch.pn;
        row.product = this.lookupProduct(patch.pn);
        pnChanged = true;
        // 品番が変わったら width_mm もリセット(product側の代表値 or 単一幅)
        row.width_mm = row.product?.width_mm || null;
      }
      if ('width_mm' in patch) {
        const w = parseInt(patch.width_mm, 10);
        if (!isNaN(w) && w > 0) row.width_mm = w;
      }
      if ('meters' in patch) {
        // 2026-04-20 修正: 0.1m単位対応(健太郎指示)。1.0〜200.0m
        let m = parseFloat(patch.meters);
        if (isNaN(m) || m < 1) m = 1;
        if (m > 200) m = 200;
        // 0.1刻みに丸める(浮動小数誤差回避)
        m = Math.round(m * 10) / 10;
        row.meters = m;
        const inMcell = document.querySelector(`#cart-rows tr[data-id="${id}"] .in-m`);
        if (inMcell && String(m) !== inMcell.value) inMcell.value = String(m);
      }
      // 2026-04-20 修正: pn変更時も renderCart()ではなく refreshRow()で差分更新
      // (全再描画だと1文字打つ毎にin-pn inputが置換されてフォーカス外れる問題)
      this.refreshRow(row);
      this.renderTotals();
      this.syncHiddenFields();
      this.validateSubmit();
      this.persistCart();
    },

    refreshRow(row) {
      const tr = document.querySelector(`#cart-rows tr[data-id="${row.id}"]`);
      if (!tr) return;
      const unit = row.product ? this.getRowUnit(row) : 0;
      const sub = unit * row.meters;
      // 2026-04-20 変更: 商品名列廃止、品番セル内のbrand+suggest+warn更新
      const pnTd = tr.querySelector('td[data-label="品番"]');
      const pnWarnSlot = tr.querySelector('.pn-warn-slot');
      const pnSuggestSlot = tr.querySelector('.pn-suggest-slot');
      const pnBrand = tr.querySelector('.pn-brand');
      if (pnTd) {
        if (row.product) {
          const brandText = `${row.product.brand}${row.product.name ? ' ' + row.product.name : ''}`;
          if (pnBrand) {
            pnBrand.textContent = brandText;
          } else {
            const input = tr.querySelector('.in-pn');
            const div = document.createElement('div');
            div.className = 'pn-brand';
            div.textContent = brandText;
            input.parentNode.insertBefore(div, input);
          }
          const { variants } = this.findSuggestions(row.pn);
          if (pnSuggestSlot) {
            pnSuggestSlot.innerHTML = variants.length > 0
              ? `<div class="variant-hint">💡 関連品番: ${variants.map(v => this.escapeHtml(v.pn)).join(' / ')}</div>`
              : '';
          }
          if (pnWarnSlot) {
            pnWarnSlot.innerHTML = row.product.special_note
              ? `<div class="special-warn">⚠️ ${this.escapeHtml(row.product.special_note)}</div>`
              : '';
          }
        } else {
          if (pnBrand) pnBrand.remove();
          if (pnWarnSlot) pnWarnSlot.innerHTML = '';
          if (pnSuggestSlot) {
            if (row.pn) {
              const normalized = this.normalizePn(row.pn);
              const { variants, similar } = this.findSuggestions(row.pn);
              const cands = [...variants, ...similar];
              pnSuggestSlot.innerHTML = cands.length > 0
                ? `<div class="pn-suggest not-found">「${this.escapeHtml(normalized)}」は登録にありません。もしかして: <strong>${cands.slice(0,5).map(p => this.escapeHtml(p.pn)).join(' / ')}</strong> ですか?</div>`
                : `<div class="pn-suggest not-found">「${this.escapeHtml(normalized)}」は登録にありません。品番ご確認のうえお問い合わせください</div>`;
            } else {
              pnSuggestSlot.innerHTML = '<div class="pn-suggest muted">品番を入力(例: PS-134)</div>';
            }
          }
        }
      }
      // 上代・掛率セル
      const joutaiCell = tr.querySelector('.td-joutai');
      if (joutaiCell) joutaiCell.textContent = row.product?.joutai_m2 ? '¥' + row.product.joutai_m2.toLocaleString() + '/㎡' : '-';
      const pptCell = tr.querySelector('.td-ppt');
      if (pptCell) {
        // 直接単価管理時は掛率非表示(ガラスフィルム等)
        pptCell.textContent = (row.product?.hp_kakeritsu_pt && row.product.joutai_m2 > 0)
          ? row.product.hp_kakeritsu_pt + 'pt'
          : '-';
      }
      const unitCell = tr.querySelector('.td-unit');
      if (unitCell) {
        if (unit > 0 && row.product) {
          const hasJoutai = row.product.joutai_m2 > 0;
          const formula = hasJoutai
            ? `上代¥${row.product.joutai_m2.toLocaleString()} × 巾1.2m × ${row.product.hp_kakeritsu_pt}pt ÷ 100 (10円切上)`
            : '※直接単価管理(上代非公開)';
          unitCell.innerHTML = `¥${unit.toLocaleString()}<div class="unit-formula">${formula}</div>`;
        } else {
          unitCell.textContent = '-';
        }
      }
      const subCell = tr.querySelector('.td-sub');
      if (subCell) subCell.textContent = sub > 0 ? '¥' + sub.toLocaleString() : '-';

      // 2026-04-20 追加: 幅セレクタの差分更新(pn変更時にフォーカス維持のため renderCart呼ばず)
      const pnTdForWidth = tr.querySelector('td[data-label="品番"]');
      let widthWrap = tr.querySelector('.width-select-wrap');
      const needWidth = row.product && Array.isArray(row.product.width_options) && row.product.width_options.length > 1;
      if (needWidth && pnTdForWidth) {
        const selectedW = row.width_mm || row.product.width_mm;
        const opts = row.product.width_options.map(w => {
          const sel = w.width_mm === selectedW ? ' selected' : '';
          return `<option value="${w.width_mm}"${sel}>${w.width_mm}mm (¥${w.hp_price_m.toLocaleString()}/m)</option>`;
        }).join('');
        const html = `<label>規格幅:<select class="in-width" aria-label="規格幅選択">${opts}</select></label>`;
        if (widthWrap) {
          // 既存selectにfocus当たってる時は壊さない(再描画で選択位置リセット防止)
          const activeSel = document.activeElement;
          const isFocusedHere = activeSel && widthWrap.contains(activeSel);
          if (!isFocusedHere) widthWrap.innerHTML = html;
        } else {
          const div = document.createElement('div');
          div.className = 'width-select-wrap';
          div.innerHTML = html;
          pnTdForWidth.appendChild(div);
        }
      } else if (widthWrap) {
        widthWrap.remove();
      }
    },

    removeRow(id) {
      this.cart = this.cart.filter(r => r.id !== id);
      if (this.cart.length === 0) this.addRow();
      this.renderCart();
      this.persistCart();
    },

    /* ───────────── 描画 ───────────── */
    renderCart() {
      const tbody = document.getElementById('cart-rows');
      if (!tbody) return;
      tbody.innerHTML = '';
      for (const row of this.cart) {
        const tr = document.createElement('tr');
        tr.dataset.id = row.id;
        const unit = row.product ? this.getRowUnit(row) : 0;
        const sub = unit * row.meters;
        // 2026-04-20 変更: 商品名列廃止、品番セル内に集約(ブランド名 上/ヒント 下)
        let brandTop = '';
        let pnSuggestSlot = '';
        if (row.product) {
          brandTop = `<div class="pn-brand">${this.escapeHtml(row.product.brand)}${row.product.name ? ' ' + this.escapeHtml(row.product.name) : ''}</div>`;
          const { variants } = this.findSuggestions(row.pn);
          if (variants.length > 0) {
            const list = variants.map(v => this.escapeHtml(v.pn)).join(' / ');
            pnSuggestSlot = `<div class="variant-hint">💡 関連品番: ${list}</div>`;
          }
        } else if (row.pn) {
          const normalized = this.normalizePn(row.pn);
          const { variants, similar } = this.findSuggestions(row.pn);
          const cands = [...variants, ...similar];
          if (cands.length > 0) {
            const list = cands.slice(0, 5).map(p => this.escapeHtml(p.pn)).join(' / ');
            pnSuggestSlot = `<div class="pn-suggest not-found">「${this.escapeHtml(normalized)}」は登録にありません。もしかして: <strong>${list}</strong> ですか?</div>`;
          } else {
            pnSuggestSlot = `<div class="pn-suggest not-found">「${this.escapeHtml(normalized)}」は登録にありません。品番ご確認のうえお問い合わせください</div>`;
          }
        } else {
          pnSuggestSlot = '<div class="pn-suggest muted">品番を入力(例: PS-134 半角/全角どちらでもOK)</div>';
        }
        const joutaiText = row.product?.joutai_m2 ? '¥' + row.product.joutai_m2.toLocaleString() + '/㎡' : '-';
        // 2026-04-20: 直接単価管理(上代0)の場合は掛率も非表示(ガラスフィルム等)
        const pptText = (row.product?.hp_kakeritsu_pt && row.product.joutai_m2 > 0)
          ? row.product.hp_kakeritsu_pt + 'pt'
          : '-';
        const pnWarn = row.product?.special_note
          ? `<div class="special-warn">⚠️ ${this.escapeHtml(row.product.special_note)}</div>`
          : '';
        // 2026-04-20 幅セレクタ: width_options が2件以上ある品番のみ表示 (SH2CLAR等)
        let widthSelector = '';
        if (row.product && Array.isArray(row.product.width_options) && row.product.width_options.length > 1) {
          const selectedW = row.width_mm || row.product.width_mm;
          const opts = row.product.width_options.map(w => {
            const sel = w.width_mm === selectedW ? ' selected' : '';
            return `<option value="${w.width_mm}"${sel}>${w.width_mm}mm (¥${w.hp_price_m.toLocaleString()}/m)</option>`;
          }).join('');
          widthSelector = `<div class="width-select-wrap"><label>規格幅:<select class="in-width" aria-label="規格幅選択">${opts}</select></label></div>`;
        }
        // m単価セル: 値の下に計算式(上代×1.2×掛率pt÷100)を小さく表示
        // 上代0は直接単価管理(3Mフィルム等)なので計算式は省略
        let unitText = unit > 0 ? '¥' + unit.toLocaleString() : '-';
        if (row.product && unit > 0 && row.product.joutai_m2 > 0) {
          unitText += `<div class="unit-formula">上代¥${row.product.joutai_m2.toLocaleString()} × 巾1.2m × ${row.product.hp_kakeritsu_pt}pt ÷ 100 (10円切上)</div>`;
        } else if (row.product && unit > 0) {
          unitText += `<div class="unit-formula">※直接単価管理(上代非公開)</div>`;
        }
        tr.innerHTML = `
          <td data-label="品番">
            ${brandTop}
            <input class="in-pn" value="${this.escapeHtml(row.pn)}" placeholder="例: PS-134" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text" aria-label="品番入力">
            <div class="pn-warn-slot">${pnWarn}</div>
            <div class="pn-suggest-slot">${pnSuggestSlot}</div>
            ${widthSelector}
          </td>
          <td data-label="上代(円/㎡)" class="td-joutai">${joutaiText}</td>
          <td data-label="掛率" class="td-ppt">${pptText}</td>
          <td data-label="m単価(税別)" class="td-unit">${unitText}</td>
          <td data-label="数量"><input class="in-m" type="number" min="1" max="200" step="0.1" value="${row.meters}" inputmode="decimal" aria-label="数量(メートル/0.1m単位)">m</td>
          <td data-label="小計(税別)" class="td-sub">${sub > 0 ? '¥' + sub.toLocaleString() : '-'}</td>
          <td><button type="button" class="btn-del" aria-label="この行を削除">×</button></td>`;
        tbody.appendChild(tr);
      }
      this.renderTotals();
      this.syncHiddenFields();
      this.validateSubmit();
    },

    renderTotals() {
      const t = this.calcTotals();
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('sum-meters', t.totalMeters);
      set('sum-subtotal', '¥' + t.subtotal.toLocaleString());
      set('sum-shipping', t.shipping === 0 ? '無料' : '¥' + t.shipping.toLocaleString());
      set('sum-tax', '¥' + t.tax.toLocaleString());
      set('sum-total', '¥' + t.total.toLocaleString());
    },

    /* ───────────── 承諾(2026-04-20 改修) ─────────────
     * tamatuf方式: consent-scroll を最下部までスクロール
     *   → consent-all の disabled 解除 + check-disabled クラス除去
     *   → 客がチェック → 同意完了
     */
    getConsentState() {
      const el = document.getElementById('consent-all');
      return { all: !!(el && el.checked), scroll_read: this._consentScrollRead };
    },

    allConsented() {
      const s = this.getConsentState();
      return s.all === true && s.scroll_read === true;
    },

    initConsentScroll() {
      const box = document.getElementById('consent-scroll');
      const chk = document.getElementById('consent-all');
      const wrap = document.getElementById('consent-wrap');
      if (!box || !chk || !wrap) return;
      chk.disabled = true;

      const onScroll = () => {
        // tamatuf式: scrollHeight - clientHeight - scrollTop <= 1px で最下部到達
        if (Math.abs(box.scrollHeight - box.clientHeight - box.scrollTop) <= 1) {
          if (!this._consentScrollRead) {
            this._consentScrollRead = true;
            chk.disabled = false;
            wrap.classList.remove('check-disabled');
            wrap.classList.add('check-enabled');
          }
        }
      };
      box.addEventListener('scroll', onScroll);
      // ボックスが短くてスクロール不要な時(コンテンツ≤表示領域)は即解放
      if (box.scrollHeight <= box.clientHeight + 1) {
        this._consentScrollRead = true;
        chk.disabled = false;
        wrap.classList.remove('check-disabled');
        wrap.classList.add('check-enabled');
      }
    },

    /* ───────────── 入力バリデーション(2026-04-20 追加) ─────────────
     * 電話: 日本国内固定/携帯 10〜11桁(ハイフン/スペース除去後、先頭0必須)
     *       +81から始まる国際表記も許容(11-12桁、先頭81で0始まり9-10桁)
     * 郵便: 7桁 (xxx-xxxx もしくは xxxxxxx)
     * 住所: 都道府県名を含み、かつ10文字以上
     * email: type=email のブラウザ検証+ドメイン形式
     */
    PREFECTURES: ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'],

    // 2026-04-20 追加(V-1 脆弱性対策): 配送可能地域限定
    // 本州・四国・九州の陸路/橋繋がり地域のみ
    NON_SHIPPABLE_PREFECTURES: ['北海道','沖縄県'],

    // 離島・島嶼部の判定キーワード(市区町村名・島名の一部含有で不可)
    ISLAND_KEYWORDS: [
      '八丈','三宅村','御蔵島','青ヶ島','小笠原','伊豆諸島','大島町','利島',
      '新島','神津島','渡嘉敷','座間味','粟国','渡名喜','南大東','北大東','伊平屋','伊是名',
      '宮古','石垣','竹富','与那国','多良間',
      '小豆郡','小豆島','直島','豊島','男木島','女木島',
      '壱岐','対馬','五島','新上五島','小値賀',
      '隠岐','海士町','西ノ島','知夫村',
      '佐渡','粟島浦',
      '屋久島','種子島','奄美','徳之島','沖永良部','与論',
      '利尻','礼文','奥尻','天売','焼尻',  // 北海道離島(すでに北海道NGだが念のため)
      '舳倉島','飛島','大島村','見島','江田島',
      '答志島','神島'
    ],

    validateTel(raw) {
      if (!raw) return { ok: false, msg: '電話番号を入力してください' };
      const s = String(raw).trim().replace(/[\s\-()（）]/g, '');
      if (!/^[\d+]+$/.test(s)) return { ok: false, msg: '電話番号は数字とハイフンのみで入力してください' };
      let digits = s;
      if (digits.startsWith('+81')) digits = '0' + digits.slice(3);
      else if (digits.startsWith('81') && digits.length >= 11) digits = '0' + digits.slice(2);
      if (!/^\d+$/.test(digits)) return { ok: false, msg: '電話番号の形式が正しくありません' };
      if (digits.length < 10 || digits.length > 11) return { ok: false, msg: '電話番号は10桁または11桁で入力してください(市外局番から)' };
      if (!digits.startsWith('0')) return { ok: false, msg: '電話番号は市外局番(0)から始めてください' };
      return { ok: true };
    },

    validateZip(raw) {
      if (!raw) return { ok: false, msg: '郵便番号を入力してください' };
      const s = String(raw).trim().replace(/[\s－ー―]/g, '');
      const digits = s.replace(/[-]/g, '');
      if (!/^\d{7}$/.test(digits)) return { ok: false, msg: '郵便番号は7桁の数字で入力してください(例: 580-0022)' };
      return { ok: true };
    },

    validateAddress(raw) {
      if (!raw) return { ok: false, msg: '住所を入力してください' };
      // NFKC正規化(全角数字→半角・全角英→半角 同一扱い)
      const s = String(raw).trim().normalize('NFKC');
      if (s.length < 10) return { ok: false, msg: '住所は番地まで入力してください(10文字以上)' };
      const hasPref = this.PREFECTURES.some(p => s.includes(p));
      if (!hasPref) return { ok: false, msg: '住所に都道府県名を含めてください(例: 大阪府松原市…)' };
      if (!/\d/.test(s)) return { ok: false, msg: '住所に番地(数字)を含めてください' };
      // V-1 配送地域チェック: 北海道・沖縄は不可
      const nonShippablePref = this.NON_SHIPPABLE_PREFECTURES.find(p => s.includes(p));
      if (nonShippablePref) {
        return { ok: false, msg: `誠に恐れ入りますが、${nonShippablePref}への配送は承っておりません(北海道・沖縄・離島・海外不可)` };
      }
      // V-1 離島キーワード検査(地域NG)
      const islandHit = this.ISLAND_KEYWORDS.find(kw => s.includes(kw));
      if (islandHit) {
        return { ok: false, msg: `申し訳ございませんが、離島地域(「${islandHit}」)への配送は承っておりません` };
      }
      // V-1 海外表記キーワード検査(USA/China/HK/海外/Foreign)
      const overseasPatterns = [/USA/i, /\bCHINA\b/i, /HONG\s*KONG/i, /TAIWAN/i, /\bKOREA\b/i, /海外/, /c\/o/i];
      const overseasHit = overseasPatterns.find(p => p.test(s));
      if (overseasHit) {
        return { ok: false, msg: '海外への配送は承っておりません。日本国内住所をご記入ください' };
      }
      // V-1 「北海道大阪府」等の複数都道府県名検出
      const prefHits = this.PREFECTURES.filter(p => s.includes(p));
      if (prefHits.length >= 2) {
        return { ok: false, msg: `住所に複数の都道府県名が含まれています(${prefHits.join('・')})。正確にご記入ください` };
      }
      return { ok: true };
    },

    validateEmail(raw) {
      if (!raw) return { ok: false, msg: 'メールアドレスを入力してください' };
      const s = String(raw).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return { ok: false, msg: 'メールアドレスの形式が正しくありません' };
      return { ok: true };
    },

    showFieldError(fieldName, msg) {
      const slot = document.getElementById('err-' + fieldName);
      const input = document.querySelector(`#order-form [name="${fieldName}"]`);
      const label = input ? input.closest('label') : null;
      if (slot) {
        if (msg) { slot.textContent = msg; slot.classList.add('show'); }
        else { slot.textContent = ''; slot.classList.remove('show'); }
      }
      if (label) {
        if (msg) label.classList.add('is-invalid');
        else label.classList.remove('is-invalid');
      }
    },

    validateContactFields(opts = {}) {
      const showErr = opts.showErrors !== false;
      const form = document.getElementById('order-form') || document.querySelector('.wpcf7-form');
      if (!form) return { ok: true };
      const get = n => (form.querySelector(`[name="${n}"]`)?.value || '').trim();
      const checks = {
        email: this.validateEmail(get('email') || get('your-email')),
        tel: this.validateTel(get('tel')),
        zip: this.validateZip(get('zip')),
        address: this.validateAddress(get('address')),
      };
      let allOk = true;
      for (const [name, r] of Object.entries(checks)) {
        if (showErr) this.showFieldError(name, r.ok ? '' : r.msg);
        if (!r.ok) allOk = false;
      }
      return { ok: allOk, checks };
    },

    validateSubmit() {
      const btn = document.getElementById('btn-submit');
      if (!btn) return false;
      const hasItems = this.cart.length > 0 && this.cart.every(r => r.product && r.meters > 0);
      const consent = this.allConsented();
      const contact = this.validateContactFields({ showErrors: false });
      btn.disabled = !(hasItems && consent && contact.ok);
      const hint = document.getElementById('submit-hint');
      if (hint) {
        // 200m到達時の注意喚起(2026-04-20 健太郎指示: 200m超は問合せ)
        const hasMaxedOut = this.cart.some(r => r.meters >= 200);
        if (!hasItems) {
          const unknown = this.cart.filter(r => r.pn && !r.product).length;
          if (unknown > 0) {
            hint.textContent = `登録にない品番があります(${unknown}件)。品番をご確認ください。`;
          } else {
            hint.textContent = '品番と数量を入力してください';
          }
        } else if (!this._consentScrollRead) {
          hint.textContent = '注文前のご確認事項を最後までスクロールしてお読みください';
        } else if (!consent) {
          hint.textContent = '同意チェックボックスにチェックを入れてください';
        } else if (!contact.ok) {
          hint.textContent = 'お客様情報に不備があります(赤枠の項目をご確認ください)';
          hint.style.color = '#c00';
        } else if (hasMaxedOut) {
          hint.textContent = '※200m超のご注文は備考欄にご記載のうえ、別途お問い合わせください';
          hint.style.color = '#8b6500';
        } else {
          hint.textContent = '';
          hint.style.color = '';
        }
      }
      return hasItems && consent && contact.ok;
    },

    /* ───────────── 送信 ───────────── */
    syncHiddenFields() {
      const cartSlim = this.cart
        .filter(r => r.product)
        .map(r => ({
          pn: r.product.pn,
          name: r.product.name || '',
          brand: r.product.brand,
          meters: r.meters,
          unit_price: this.getRowUnit(r),
          subtotal: this.getRowUnit(r) * r.meters,
          width_mm: r.width_mm || r.product.width_mm,
        }));
      const totals = this.calcTotals();

      // 人間可読版(CF7メールで顧客/管理者が直接読む形式、批判A-3対応)
      const cartReadable = cartSlim.length === 0
        ? '(品番未指定)'
        : cartSlim.map(it => {
            const nm = it.name ? ' ' + it.name : '';
            return `[${it.brand}] ${it.pn}${nm}\n`
              + `  m単価: ¥${it.unit_price.toLocaleString()} × ${it.meters}m = ¥${it.subtotal.toLocaleString()}`;
          }).join('\n');
      const totalsReadable =
        `合計m数: ${totals.totalMeters}m\n`
        + `小計(税別): ¥${totals.subtotal.toLocaleString()}\n`
        + `送料(税別): ${totals.shipping === 0 ? '無料(3m以上)' : '¥' + totals.shipping.toLocaleString()}\n`
        + `消費税(10%): ¥${totals.tax.toLocaleString()}\n`
        + `合計(税込): ¥${totals.total.toLocaleString()}`;

      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('cart-json-hidden', JSON.stringify(cartSlim));
      set('totals-json-hidden', JSON.stringify(totals));
      set('cart-readable-hidden', cartReadable);
      set('totals-readable-hidden', totalsReadable);
      set('consent-ts-hidden', new Date().toISOString());
      set('consent-state-hidden', JSON.stringify(this.getConsentState()));
    },

    /* ───────────── 状態保持 ───────────── */
    persistCart() {
      try {
        const slim = this.cart.map(r => ({ pn: r.pn, meters: r.meters, width_mm: r.width_mm }));
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
          ts: Date.now(),
          items: slim,
        }));
      } catch (e) {
        console.warn('[shop] persist失敗', e);
      }
    },

    restoreCart() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return;
        const { ts, items } = JSON.parse(raw);
        if (Date.now() - ts > 7 * 86400 * 1000) {
          localStorage.removeItem(this.STORAGE_KEY);
          return;
        }
        this.cart = items.map(i => {
          const product = this.lookupProduct(i.pn);
          return {
            id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
            pn: i.pn,
            product,
            meters: i.meters,
            width_mm: i.width_mm || product?.width_mm || null,
          };
        });
      } catch (e) {
        console.warn('[shop] restore失敗', e);
      }
    },

    /* ───────────── イベント束ね ───────────── */
    bindEvents() {
      const add = document.getElementById('btn-add-row');
      if (add) add.onclick = () => this.addRow();

      const rows = document.getElementById('cart-rows');
      if (rows) {
        rows.addEventListener('input', e => {
          const tr = e.target.closest('tr');
          if (!tr) return;
          const id = tr.dataset.id;
          if (e.target.classList.contains('in-pn')) this.updateRow(id, { pn: e.target.value });
          if (e.target.classList.contains('in-m')) this.updateRow(id, { meters: e.target.value });
        });
        rows.addEventListener('click', e => {
          if (e.target.classList.contains('btn-del')) {
            this.removeRow(e.target.closest('tr').dataset.id);
          }
        });
        // 2026-04-20 幅セレクタ change (SH2CLAR等)
        rows.addEventListener('change', e => {
          if (!e.target.classList.contains('in-width')) return;
          const tr = e.target.closest('tr');
          if (!tr) return;
          const row = this.cart.find(r => r.id === tr.dataset.id);
          if (!row) return;
          const w = parseInt(e.target.value, 10);
          if (!isNaN(w) && w > 0) {
            row.width_mm = w;
            this.refreshRow(row);
            this.renderTotals();
            this.syncHiddenFields();
            this.validateSubmit();
            this.persistCart();
          }
        });
      }

      document.addEventListener('change', e => {
        if (e.target.id === 'consent-all') {
          this.syncHiddenFields();  // 同意状態変化時もhidden同期
          this.validateSubmit();
        }
      });

      // 入力欄 blur/input でリアルタイムバリデーション
      const form = document.querySelector('.wpcf7-form') || document.getElementById('order-form');
      if (form) {
        const validateableNames = ['email', 'your-email', 'tel', 'zip', 'address'];
        form.addEventListener('blur', e => {
          const name = e.target && e.target.name;
          if (!name) return;
          const targetName = name === 'your-email' ? 'email' : name;
          if (!validateableNames.includes(name)) return;
          const val = (e.target.value || '').trim();
          let r;
          if (targetName === 'email') r = this.validateEmail(val);
          else if (targetName === 'tel') r = this.validateTel(val);
          else if (targetName === 'zip') r = this.validateZip(val);
          else if (targetName === 'address') r = this.validateAddress(val);
          else return;
          this.showFieldError(targetName, r.ok ? '' : r.msg);
          this.validateSubmit();
        }, true);
        form.addEventListener('input', e => {
          const name = e.target && e.target.name;
          if (!name) return;
          const targetName = name === 'your-email' ? 'email' : name;
          if (!validateableNames.includes(name)) return;
          // 入力中はエラー表示を控えめに(現にエラー表示中の項目のみ再評価)
          const slot = document.getElementById('err-' + targetName);
          if (slot && slot.classList.contains('show')) {
            const val = (e.target.value || '').trim();
            let r;
            if (targetName === 'email') r = this.validateEmail(val);
            else if (targetName === 'tel') r = this.validateTel(val);
            else if (targetName === 'zip') r = this.validateZip(val);
            else if (targetName === 'address') r = this.validateAddress(val);
            else return;
            if (r.ok) this.showFieldError(targetName, '');
          }
          this.validateSubmit();
        });

        // 送信時最終検証 (A-1対策: CF7のformはid="order-form"ではなくclass="wpcf7-form")
        form.addEventListener('submit', e => {
          // 送信直前に必ずhidden同期(最後の承諾状態を確実に送る)
          this.syncHiddenFields();
          const contact = this.validateContactFields({ showErrors: true });
          if (!this.validateSubmit() || !contact.ok) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!contact.ok) {
              // 最初のエラー項目にフォーカス
              const firstErr = Object.keys(contact.checks).find(k => !contact.checks[k].ok);
              if (firstErr) {
                const el = form.querySelector(`[name="${firstErr}"]`);
                if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
              }
              alert('お客様情報に不備があります。赤枠の項目をご確認ください。');
            } else {
              alert('カート内容または承諾事項に不足があります');
            }
            return;
          }
        }, true);  // capture=true で他のハンドラより先に走らせる
      }

      // 離脱防止(入力あり時のみ)
      window.addEventListener('beforeunload', e => {
        const hasInput = this.cart.some(r => r.product);
        if (hasInput) {
          e.preventDefault();
          e.returnValue = '';
        }
      });
    },

    /* ───────────── 近似品番/バリアント提案(2026-04-20改修) ─────────────
     * datalist廃止。代わりに未登録時に品番提案を動的に返す。
     * - バリアント検出: 「AE-1632」入力時、AE-1632AR/NEO/EX等も提示
     * - 近似候補: 接頭辞3文字一致で上位3件
     */
    findSuggestions(input) {
      if (!this.products) return { variants: [], similar: [] };
      const normalized = this.normalizePn(input || '');
      if (!normalized || normalized.length < 2) return { variants: [], similar: [] };
      const products = this.products.products;

      // バリアント: 入力PNで始まる別品番(入力と完全一致を除く)
      const variants = products
        .filter(p => p.pn !== normalized && p.pn.startsWith(normalized))
        .slice(0, 5);

      // 近似候補: 先頭3-4文字が一致する上位候補(バリアント除く)
      const prefix = normalized.slice(0, Math.min(normalized.length, 4));
      const similar = products
        .filter(p => p.pn !== normalized && p.pn.startsWith(prefix) && !variants.includes(p))
        .slice(0, 3);

      return { variants, similar };
    },

    /* ───────────── ユーティリティ ───────────── */
    escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    },

    showFatalError(msg) {
      const el = document.getElementById('shop-app');
      if (!el) return;
      el.innerHTML = `<div class="fatal-error">${this.escapeHtml(msg)}<br><button onclick="location.reload()">再読み込み</button></div>`;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SHOP.init());
  } else {
    SHOP.init();
  }

  window.TECNEST_SHOP = SHOP;  // デバッグ用
})();
