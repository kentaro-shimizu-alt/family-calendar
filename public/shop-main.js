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

    // 2026-04-23 T220 HPI-3 テスト注文モード
    // 備考欄に合言葉 or URLに ?test=合言葉 を入れると件名に [TEST] prefix付与→管理者側で実注文と判別可能
    TEST_PASSPHRASE: 'TECNEST-TEST-0423',
    _testMode: false,
    _testReason: '',  // 'url' | 'note' | 'both'

    /* ───────────── 初期化 ───────────── */
    async init() {
      try {
        // 2026-04-22 HPI-Vercel対応: basePath自動判定
        // 本番(tecnest.biz/shop/) = /wp-content/uploads/shop/
        // Vercel preview(/shop-preview/) = /shop-preview
        const basePath = window.location.pathname.startsWith('/shop-preview')
          ? '/shop-preview'
          : '/wp-content/uploads/shop';

        // BCPくろ提言: 緊急停止チェック(最優先・AI障害時の受注停止用)
        // 2026-04-23 T221: mode.json(拡張版)を優先→無ければ mode.txt(後方互換)
        let modeData = null;
        try {
          const jsonRes = await fetch(`${basePath}/mode.json?_=` + Date.now());
          if (jsonRes.ok) modeData = await jsonRes.json();
        } catch (_e) {}
        if (!modeData) {
          try {
            const txtRes = await fetch(`${basePath}/mode.txt?_=` + Date.now());
            const txt = txtRes.ok ? (await txtRes.text()).trim() : 'live';
            modeData = { mode: txt };
          } catch (_e) {
            modeData = { mode: 'live' };
          }
        }
        const mode = modeData.mode || 'live';
        if (mode === 'suspended' || mode === 'maintenance') {
          this.showSuspendedBanner(mode);
          return;
        }
        // T221: scheduled モードは 時刻により 予告 or 停止 or 通常
        if (mode === 'scheduled' && modeData.scheduled) {
          const sch = modeData.scheduled;
          const now = Date.now();
          const bannerFrom = sch.banner_from ? new Date(sch.banner_from).getTime() : null;
          const start = sch.start ? new Date(sch.start).getTime() : null;
          const end = sch.end ? new Date(sch.end).getTime() : null;
          if (start && end && now >= start && now < end) {
            // メンテ中: 受注停止画面(既存流用)
            this.showSuspendedBanner('maintenance');
            return;
          }
          if (start && (!bannerFrom || now >= bannerFrom) && now < start) {
            // 予告中: 通常ページ継続+黄色バナー
            this.showScheduledBanner(sch);
          }
          // それ以外(end以降 or banner_from前) → 通常
        }

        const verRes = await fetch(`${basePath}/version.txt?_=` + Date.now());
        const ver = verRes.ok ? (await verRes.text()).trim() : String(Date.now());
        const res = await fetch(`${basePath}/products.json?v=${ver}`);
        if (!res.ok) throw new Error('products.json取得失敗: ' + res.status);
        this.products = await res.json();
        // 2026-04-23 T220: URLパラメータ ?test=TECNEST-TEST-0423 検知
        try {
          const params = new URLSearchParams(window.location.search);
          if (params.get('test') === this.TEST_PASSPHRASE) {
            this._testMode = true;
            this._testReason = 'url';
            this.showTestBanner();
          }
        } catch (_e) {}
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

    /* ───────────── T221 スケジュール予告バナー(2026-04-23) ───────────── */
    showScheduledBanner(sch) {
      if (document.getElementById('scheduled-banner')) return;
      const body = document.body;
      if (!body) return;
      const banner = document.createElement('div');
      banner.id = 'scheduled-banner';
      banner.className = 'scheduled-banner';
      banner.setAttribute('role', 'alert');
      const fmt = (iso) => {
        try {
          return new Date(iso).toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo',
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });
        } catch (_e) { return iso; }
      };
      const reason = sch.reason ? `(${this.escapeHtml(sch.reason)})` : '';
      banner.innerHTML = `⚠️ <span class="time">${fmt(sch.start)}</span> 〜 <span class="time">${fmt(sch.end)}</span> まで メンテナンスのため受注停止予定です ${reason}`;
      body.insertBefore(banner, body.firstChild);
    },

    /* ───────────── T220 テスト注文モード(2026-04-23) ───────────── */
    showTestBanner() {
      if (document.getElementById('test-mode-banner')) {
        this.updateTestBanner();
        return;
      }
      const app = document.getElementById('shop-app');
      if (!app) return;
      const banner = document.createElement('div');
      banner.id = 'test-mode-banner';
      banner.setAttribute('role', 'alert');
      banner.style.cssText = 'background:#fff4b8;border:2px solid #d4a017;color:#664d03;padding:10px 14px;border-radius:6px;margin-bottom:14px;font-weight:bold;font-size:0.95em;text-align:center;';
      banner.innerHTML = this.makeTestBannerText();
      app.insertBefore(banner, app.firstChild);
    },
    updateTestBanner() {
      const banner = document.getElementById('test-mode-banner');
      if (!banner) return;
      if (this._testMode) {
        banner.innerHTML = this.makeTestBannerText();
        banner.style.display = '';
      } else {
        banner.remove();
      }
    },
    makeTestBannerText() {
      const reasonMap = { url: 'URLパラメータ', note: '備考欄の合言葉', both: 'URL+備考' };
      const why = reasonMap[this._testReason] || '';
      return `⚠️ テストモード中 - 実注文にはなりません(${why}検知) / 送信時 件名に [TEST] 付与`;
    },
    detectTestModeFromNote() {
      // 備考欄に合言葉含まれていればテストモード ON (URL検知と合体する場合は both)
      const noteEl = document.querySelector('#order-form textarea[name="note"], .wpcf7-form textarea[name="note"]');
      const text = noteEl ? String(noteEl.value || '') : '';
      const hasPhrase = text.includes(this.TEST_PASSPHRASE);
      const wasUrlTest = this._testReason === 'url' || this._testReason === 'both';
      if (hasPhrase && wasUrlTest) {
        this._testMode = true;
        this._testReason = 'both';
      } else if (hasPhrase) {
        this._testMode = true;
        this._testReason = 'note';
      } else if (wasUrlTest) {
        // 備考は合言葉なくてもURL検知済ならモード維持
        this._testMode = true;
        this._testReason = 'url';
      } else {
        this._testMode = false;
        this._testReason = '';
      }
      this.updateTestBanner();
      if (this._testMode && !document.getElementById('test-mode-banner')) {
        this.showTestBanner();
      }
    },

    /* ───────────── 緊急停止表示(BCP対応) ─────────────
     * 切替方法: Xserverにて /wp-content/uploads/shop/mode.txt を
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
            メール: <a href="mailto:order@tecnest.biz" style="color:#0066cc; font-weight:bold;">order@tecnest.biz</a><br>
            <span style="font-size:0.85em; color:#888;">TEL: <a href="tel:09050128754" style="color:#888;">090-5012-8754</a>(平日10-17時・緊急時のみ)</span>
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
      // 2026-04-23 HPI-11c(健太郎指摘): 数字1桁〜もサジェスト対象化(「PS00」「PS0」で候補消える問題)
      if (!s.includes('-')) {
        const m = s.match(/^([A-Z]{2,4})(\d{1,5})([A-Z]{0,4})$/);
        if (m) s = `${m[1]}-${m[2]}${m[3]}`;
      }
      return s;
    },

    lookupProduct(input) {
      // 2026-04-20 変更: 前方一致fallback廃止(ME-001→ME-001EX誤bundle事故対策)
      // 客の意図は厳密一致のみ扱う。未登録時は findSuggestions で候補提案する。
      // 2026-04-23 HPI-23 致命バグFIX: ハイフン除去版fallback追加
      //   normalizePnが NANO40S → NANO-40S に勝手にハイフン挿入するが、
      //   products.jsonの実品番はNANO40S(ハイフンなし)。検索ヒットせず全NANO系11品番が死んでいた。
      //   ハイフンあり版でヒットしなければハイフン除去版でも探す。
      const pn = this.normalizePn(input);
      if (!pn || !this.products) return null;
      const hit = this.products.products.find(p => p.pn === pn);
      if (hit) return hit;
      // NANO系/GF系 等ハイフンなし品番の救済
      const pnNoHyphen = pn.replace(/-/g, '');
      return this.products.products.find(p => p.pn === pnNoHyphen) || null;
    },

    /* ───────────── 価格計算 ───────────── */
    // 2026-04-23 HPI-23: 幅選択時の価格を優先使用(width_options持ち品番対応)
    applyRevision(product, shipDate = new Date(), selectedWidth = null) {
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
      // 選択幅がwidth_optionsに該当すればその価格を使用、そうでなければ代表hp_price_m
      let basePrice = product.hp_price_m;
      if (selectedWidth && Array.isArray(product.width_options)) {
        const opt = product.width_options.find(w => w.width_mm === selectedWidth);
        if (opt && opt.hp_price_m) basePrice = opt.hp_price_m;
      }
      return Math.ceil(basePrice * mult / 10) * 10;
    },

    calcTotals() {
      let subtotal = 0;
      let totalMeters = 0;
      const brandMeters = {};  // 2026-04-22 HPI-8: ブランド別m数集計
      for (const item of this.cart) {
        const unit = item.product ? this.applyRevision(item.product, new Date(), item.width_mm) : 0;
        const sub = unit * item.meters;
        item.unit_price = unit;
        item.subtotal = sub;
        subtotal += sub;
        totalMeters += item.meters;
        if (item.product && item.product.brand) {
          const b = item.product.brand;
          brandMeters[b] = (brandMeters[b] || 0) + item.meters;
        }
      }
      // 2026-04-22 HPI-8: 送料はブランド別3m判定(各ブランドが3m未満なら¥1500加算)
      const threshold = this.products.shipping.free_threshold_m;
      const flatFee = this.products.shipping.flat_fee_yen;
      let shipping = 0;
      const shippingBreakdown = [];
      for (const [brand, m] of Object.entries(brandMeters)) {
        if (m < threshold) {
          shipping += flatFee;
          shippingBreakdown.push({ brand, meters: m, fee: flatFee });
        } else {
          shippingBreakdown.push({ brand, meters: m, fee: 0 });
        }
      }
      const taxable = subtotal + shipping;
      const tax = Math.floor(taxable * this.TAX_RATE);
      const total = taxable + tax;
      return { subtotal, shipping, tax, total, totalMeters, brandMeters, shippingBreakdown };
    },

    /* ───────────── カート操作 ───────────── */
    // 2026-04-23 HPI-23: width_mm を row に保持(複数幅品番対応)
    addRow(pn = '', meters = 1, width_mm = null) {
      const product = pn ? this.lookupProduct(pn) : null;
      const defaultWidth = (product && Array.isArray(product.width_options) && product.width_options.length > 0)
        ? product.width_options[0].width_mm
        : (product?.width_mm || null);
      this.cart.push({
        id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
        pn, product, meters,
        width_mm: width_mm || defaultWidth,
      });
      this.renderCart();
      this.persistCart();
    },

    updateRow(id, patch) {
      const row = this.cart.find(r => r.id === id);
      if (!row) return;
      if ('pn' in patch) {
        row.pn = patch.pn;
        row.product = this.lookupProduct(patch.pn);
        // 品番変更時は幅も再設定(widthsオプションあれば先頭・なければ代表値)
        row.width_mm = (row.product && Array.isArray(row.product.width_options) && row.product.width_options.length > 0)
          ? row.product.width_options[0].width_mm
          : (row.product?.width_mm || null);
      }
      // 2026-04-23 HPI-23: 幅切替対応
      if ('width_mm' in patch) {
        const w = parseInt(patch.width_mm, 10);
        if (w && row.product && Array.isArray(row.product.width_options) &&
            row.product.width_options.some(o => o.width_mm === w)) {
          row.width_mm = w;
        }
      }
      if ('meters' in patch) {
        // 2026-04-23 HPI-12+HPI-7b: 小数点対応・parseFloatに変更+入力中の空文字尊重(美砂さん指摘)
        const raw = String(patch.meters).trim();
        const inMcell = document.querySelector(`#cart-rows tr[data-id="${id}"] .in-m`);
        if (raw === '') {
          // 入力中の空文字は上書きしない(消してから再入力する時に「1」に戻される問題対策)
          row.meters = 1;
          // input.valueは空のまま維持
        } else {
          let m = parseFloat(raw);
          if (isNaN(m) || m < 0.1) m = 1;
          if (m > 200) m = 200; // 2026-04-20 上限200m(健太郎指示)
          m = Math.round(m * 10) / 10; // 0.1刻みに丸め
          row.meters = m;
          // clamp発生(200超過等)でrawと異なる時のみinput.value上書き(入力カーソル位置維持)
          if (inMcell && parseFloat(inMcell.value) !== m && inMcell.value !== String(m)) {
            inMcell.value = String(m);
          }
        }
      }
      // 2026-04-20 バグ修正: renderCart全再生成だと1文字打つ毎にinputが置換され
      // iOS Safari でフォーカス外れる問題→ 該当行の商品名/単価/小計セルだけ差分更新
      this.refreshRow(row);
      this.renderTotals();
      this.syncHiddenFields();
      this.validateSubmit();
      this.persistCart();
    },

    refreshRow(row) {
      const tr = document.querySelector(`#cart-rows tr[data-id="${row.id}"]`);
      if (!tr) return;
      // 2026-04-23 HPI-23: 選択幅考慮の価格再計算
      const unit = row.product ? this.applyRevision(row.product, new Date(), row.width_mm) : 0;
      const sub = unit * row.meters;
      // 2026-04-20 変更: 商品名列廃止、品番セル内のbrand+suggest+warn更新
      const pnTd = tr.querySelector('td[data-label="品番"]');
      const pnWarnSlot = tr.querySelector('.pn-warn-slot');
      const pnSuggestSlot = tr.querySelector('.pn-suggest-slot');
      const pnBrand = tr.querySelector('.pn-brand');
      if (pnTd) {
        if (row.product) {
          const brandHtml = this.makeBrandBlockHtml(row.product);
          if (pnBrand) {
            pnBrand.innerHTML = brandHtml;
          } else {
            const input = tr.querySelector('.in-pn');
            const div = document.createElement('div');
            div.className = 'pn-brand';
            div.innerHTML = brandHtml;
            input.parentNode.insertBefore(div, input);
          }
          const { variants } = this.findSuggestions(row.pn);
          if (pnSuggestSlot) {
            pnSuggestSlot.innerHTML = variants.length > 0
              ? `<div class="variant-hint">💡 関連品番(タップで選択): ${this.makeSuggestBtns(variants, 10)}</div>`
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
                ? `<div class="pn-suggest not-found">「${this.escapeHtml(normalized)}」は登録にありません。<br>もしかして(タップで選択): ${this.makeSuggestBtns(cands, 10)}</div>`
                : `<div class="pn-suggest not-found">「${this.escapeHtml(normalized)}」は登録にありません。品番ご確認のうえお問い合わせください</div>`;
            } else {
              pnSuggestSlot.innerHTML = '<div class="pn-suggest muted">品番を入力(例: PS-134)</div>';
            }
          }
        }
      }
      // 上代・掛率セル + 幅ドロップダウン維持
      // 2026-04-23 バグfix: 従来textContent上書きでwidth-select消失→幅変更不可
      const joutaiCell = tr.querySelector('.td-joutai');
      if (joutaiCell) {
        const joutaiText = row.product?.joutai_m2 ? '¥' + row.product.joutai_m2.toLocaleString() + '/㎡' : '-';
        let widthSelectHtml = '';
        if (row.product && Array.isArray(row.product.width_options) && row.product.width_options.length > 0) {
          const opts = row.product.width_options.map(o =>
            `<option value="${o.width_mm}"${o.width_mm === row.width_mm ? ' selected' : ''}>${o.width_mm}mm</option>`
          ).join('');
          widthSelectHtml = `<div class="width-select">規格幅: <select class="in-width" aria-label="規格幅選択">${opts}</select></div>`;
        } else if (row.product && row.product.width_mm) {
          widthSelectHtml = `<div class="width-static">規格幅: ${row.product.width_mm}mm</div>`;
        }
        joutaiCell.innerHTML = joutaiText + widthSelectHtml;
      }
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
        // 2026-04-23 HPI-23: 選択幅を考慮した価格算出
        const unit = row.product ? this.applyRevision(row.product, new Date(), row.width_mm) : 0;
        const sub = unit * row.meters;
        // 2026-04-20 変更: 商品名列廃止、品番セル内に集約(ブランド名 上/ヒント 下)
        let brandTop = '';
        let pnSuggestSlot = '';
        if (row.product) {
          brandTop = `<div class="pn-brand">${this.makeBrandBlockHtml(row.product)}</div>`;
          const { variants } = this.findSuggestions(row.pn);
          if (variants.length > 0) {
            pnSuggestSlot = `<div class="variant-hint">💡 関連品番(タップで選択): ${this.makeSuggestBtns(variants, 10)}</div>`;
          }
        } else if (row.pn) {
          const normalized = this.normalizePn(row.pn);
          const { variants, similar } = this.findSuggestions(row.pn);
          const cands = [...variants, ...similar];
          if (cands.length > 0) {
            pnSuggestSlot = `<div class="pn-suggest not-found">「${this.escapeHtml(normalized)}」は登録にありません。<br>もしかして(タップで選択): ${this.makeSuggestBtns(cands, 10)}</div>`;
          } else {
            pnSuggestSlot = `<div class="pn-suggest not-found">「${this.escapeHtml(normalized)}」は登録にありません。品番ご確認のうえお問い合わせください</div>`;
          }
        } else {
          pnSuggestSlot = '<div class="pn-suggest muted">品番を入力(例: PS-134 半角/全角どちらでもOK)</div>';
        }
        const joutaiText = row.product?.joutai_m2 ? '¥' + row.product.joutai_m2.toLocaleString() + '/㎡' : '-';
        // 2026-04-23 HPI-23: width_options持ち品番は幅ドロップダウン併記(td-joutai内)
        let widthSelectHtml = '';
        if (row.product && Array.isArray(row.product.width_options) && row.product.width_options.length > 0) {
          const opts = row.product.width_options.map(o =>
            `<option value="${o.width_mm}"${o.width_mm === row.width_mm ? ' selected' : ''}>${o.width_mm}mm</option>`
          ).join('');
          widthSelectHtml = `<div class="width-select">規格幅: <select class="in-width" aria-label="規格幅選択">${opts}</select></div>`;
        } else if (row.product && row.product.width_mm) {
          widthSelectHtml = `<div class="width-static">規格幅: ${row.product.width_mm}mm</div>`;
        }
        // 2026-04-20: 直接単価管理(上代0)の場合は掛率も非表示(ガラスフィルム等)
        const pptText = (row.product?.hp_kakeritsu_pt && row.product.joutai_m2 > 0)
          ? row.product.hp_kakeritsu_pt + 'pt'
          : '-';
        const pnWarn = row.product?.special_note
          ? `<div class="special-warn">⚠️ ${this.escapeHtml(row.product.special_note)}</div>`
          : '';
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
          </td>
          <td data-label="上代(円/㎡)" class="td-joutai">${joutaiText}${widthSelectHtml}</td>
          <td data-label="掛率" class="td-ppt">${pptText}</td>
          <td data-label="m単価(税別)" class="td-unit">${unitText}</td>
          <td data-label="数量"><input class="in-m" type="text" value="${row.meters}" inputmode="decimal" pattern="[0-9.]*" autocomplete="off" aria-label="数量(メートル)" onfocus="this.select()" onclick="this.select()" ontouchend="this.select()">m</td>
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
      // 2026-04-22 HPI-8: ブランド別送料内訳表示
      let shippingText;
      if (t.shipping === 0) {
        shippingText = '無料';
      } else if (t.shippingBreakdown && t.shippingBreakdown.length > 0) {
        const parts = t.shippingBreakdown
          .filter(x => x.fee > 0)
          .map(x => `${x.brand} ¥${x.fee.toLocaleString()}`);
        shippingText = '¥' + t.shipping.toLocaleString() + (parts.length > 0 ? ` (${parts.join(' / ')})` : '');
      } else {
        shippingText = '¥' + t.shipping.toLocaleString();
      }
      set('sum-shipping', shippingText);
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

    validateCustomerInfo() {
      const tel = (document.querySelector('input[name="tel"]')?.value || '').trim().replace(/[-\s　]/g,'');
      const zip = (document.querySelector('input[name="zip"]')?.value || '').trim().replace(/[-\s　]/g,'');
      const addr = (document.querySelector('[name="address"]')?.value || '').trim();
      const email = (document.querySelector('input[name="email"]')?.value || '').trim();
      const name = (document.querySelector('input[name="customer_name"]')?.value || '').trim();
      const note = (document.querySelector('[name="note"]')?.value || '').trim();
      const errs = [];
      if (!name) errs.push('お名前を入力してください');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('メールアドレスの形式が正しくありません');
      if (!/^\d{10,13}$/.test(tel)) errs.push('電話番号は数字10〜13桁で入力してください(ハイフンなし)');
      if (!/^\d{7}$/.test(zip)) errs.push('郵便番号は数字7桁で入力してください(例: 5800022)');
      if (!addr) errs.push('住所を入力してください');
      // 配送不可エリア
      const ngPatterns = [
        { re: /沖縄県?/, label: '沖縄県' },
        { re: /(離島|佐渡|奄美|宮古島|石垣島|久米島|与那国|小笠原|伊豆諸島|大東島|父島|母島|青ヶ島|八丈島|三宅島|御蔵島|神津島|新島|式根島|利尻|礼文|焼尻|天売|渡嘉敷|座間味|粟国|渡名喜|南大東|北大東|多良間|来間|池間|伊良部|下地島|与論|沖永良部|徳之島|喜界|請島|加計呂麻|与路|硫黄|口永良部|屋久島|種子島|甑島)/, label: '離島' }
      ];
      for (const p of ngPatterns) {
        if (p.re.test(addr)) {
          errs.push('配送不可エリア(' + p.label + ')です。本州・四国・九州本土の住所のみ承っております');
          break;
        }
      }
      // 備考欄: 文字数制限 + 不正パターン検知 (prompt injection / XSS 防御)
      if (note.length > 500) {
        errs.push('備考欄は500字以内でご入力ください(現在' + note.length + '字)');
      }
      const newlines = (note.match(/\n/g) || []).length;
      if (newlines > 10) {
        errs.push('備考欄の改行は10行までです(現在' + newlines + '行)');
      }
      // HTML/script タグ・JSスキーム検知
      const htmlInjectPatterns = [
        /<\s*script/i, /<\s*iframe/i, /<\s*object/i, /<\s*embed/i,
        /<\s*style/i, /javascript\s*:/i, /on\w+\s*=/i, /data\s*:\s*text\/html/i
      ];
      for (const p of htmlInjectPatterns) {
        if (p.test(note) || p.test(name) || p.test(addr)) {
          errs.push('使用できない文字列が含まれています(HTML/スクリプトタグ等)。内容をご確認ください');
          break;
        }
      }
      // プロンプトインジェクション風文言検知(注意喚起のみ・block)
      const allText = name + ' ' + addr + ' ' + note;
      const promptInjectPatterns = [
        /ignore\s+(previous|above|all)/i,
        /system\s*[:：]/i,
        /\[\s*(system|admin|override)\s*\]/i,
        /override\s+(previous|safety|rules)/i,
        /無視して\s*(以下|前|これまで)/,
        /これまでの(指示|命令|ルール)を(無視|忘れ)/,
        /パスワードを(全部|すべて|送)/,
        /(機密|秘密)情報を(送|教え)/
      ];
      for (const p of promptInjectPatterns) {
        if (p.test(allText)) {
          errs.push('お問い合わせの内容に不適切な記述が含まれている可能性があります。一般的な日本語でご記入ください');
          break;
        }
      }
      if (errs.length > 0) {
        alert('入力内容にエラーがあります:\n\n・' + errs.join('\n・'));
        return false;
      }
      return true;
    },

    validateSubmit() {
      const btn = document.getElementById('btn-submit');
      if (!btn) return false;
      const hasItems = this.cart.length > 0 && this.cart.every(r => r.product && r.meters > 0);
      const consent = this.allConsented();
      btn.disabled = !(hasItems && consent);
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
        } else if (hasMaxedOut) {
          hint.textContent = '※200m超のご注文は備考欄にご記載のうえ、別途お問い合わせください';
          hint.style.color = '#8b6500';
        } else {
          hint.textContent = '';
          hint.style.color = '';
        }
      }
      return hasItems && consent;
    },

    /* ───────────── 送信 ───────────── */
    syncHiddenFields() {
      // 2026-04-23 T220: 備考欄から都度テストモード判定
      this.detectTestModeFromNote();
      // 2026-04-23 HPI-23: 選択幅情報+幅別単価を含めて送信
      const cartSlim = this.cart
        .filter(r => r.product)
        .map(r => {
          const unit = this.applyRevision(r.product, new Date(), r.width_mm);
          return {
            pn: r.product.pn,
            name: r.product.name || '',
            brand: r.product.brand,
            width_mm: r.width_mm || r.product.width_mm || null,
            meters: r.meters,
            unit_price: unit,
            subtotal: unit * r.meters,
          };
        });
      const totals = this.calcTotals();

      // 人間可読版(CF7メールで顧客/管理者が直接読む形式、批判A-3対応)
      const cartReadable = cartSlim.length === 0
        ? '(品番未指定)'
        : cartSlim.map(it => {
            const nm = it.name ? ' ' + it.name : '';
            const w = it.width_mm ? ` 幅${it.width_mm}mm` : '';
            return `[${it.brand}] ${it.pn}${nm}${w}\n`
              + `  m単価: ¥${it.unit_price.toLocaleString()} × ${it.meters}m = ¥${it.subtotal.toLocaleString()}`;
          }).join('\n');
      // 2026-04-22 HPI-8: 送料内訳をメーカー別で明記
      let shipLine;
      if (totals.shipping === 0) {
        shipLine = `送料(税別): 無料(各メーカー3m以上)`;
      } else if (totals.shippingBreakdown && totals.shippingBreakdown.length > 0) {
        const details = totals.shippingBreakdown
          .map(x => `${x.brand} ${x.meters}m → ${x.fee === 0 ? '無料' : '¥' + x.fee.toLocaleString()}`)
          .join(' / ');
        shipLine = `送料(税別): ¥${totals.shipping.toLocaleString()} [${details}]`;
      } else {
        shipLine = `送料(税別): ¥${totals.shipping.toLocaleString()}`;
      }
      const totalsReadable =
        `合計m数: ${totals.totalMeters}m\n`
        + `小計(税別): ¥${totals.subtotal.toLocaleString()}\n`
        + shipLine + '\n'
        + `消費税(10%): ¥${totals.tax.toLocaleString()}\n`
        + `合計(税込): ¥${totals.total.toLocaleString()}`;

      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('cart-json-hidden', JSON.stringify(cartSlim));
      set('totals-json-hidden', JSON.stringify(totals));
      set('cart-readable-hidden', cartReadable);
      set('totals-readable-hidden', totalsReadable);
      set('consent-ts-hidden', new Date().toISOString());
      set('consent-state-hidden', JSON.stringify(this.getConsentState()));
      // 2026-04-23 T220: テストモード情報をhiddenに送信(CF7メール件名で参照)
      // test_mode_tag は '[TEST] ' or '' で件名テンプレ `[TECNEST-ORDER] [test_mode_tag]...` に流用可能
      set('test-mode-hidden', this._testMode ? '1' : '0');
      set('test-reason-hidden', this._testReason || '');
      set('test-mode-tag-hidden', this._testMode ? '[TEST] ' : '');
    },

    /* ───────────── 状態保持 ───────────── */
    persistCart() {
      try {
        // 2026-04-23 HPI-23: width_mm も復元時に使う
        const slim = this.cart.map(r => ({ pn: r.pn, meters: r.meters, width_mm: r.width_mm || null }));
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
          // 2026-04-23 HPI-23: width_mm復元・不正なら代表値にフォールバック
          let width_mm = i.width_mm || null;
          if (product && Array.isArray(product.width_options) && product.width_options.length > 0) {
            const valid = product.width_options.some(o => o.width_mm === width_mm);
            if (!valid) width_mm = product.width_options[0].width_mm;
          } else if (product && !width_mm) {
            width_mm = product.width_mm || null;
          }
          return {
            id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
            pn: i.pn,
            product,
            meters: i.meters,
            width_mm,
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
        // 2026-04-23 HPI-23: 幅セレクタ変更で単価再計算
        rows.addEventListener('change', e => {
          if (e.target.classList.contains('in-width')) {
            const tr = e.target.closest('tr');
            if (!tr) return;
            this.updateRow(tr.dataset.id, { width_mm: parseInt(e.target.value, 10) });
          }
        });
        rows.addEventListener('click', e => {
          // 2026-04-23 HPI-11b: サジェスト候補タップで品番自動入力(美砂さん案)
          if (e.target.classList.contains('pn-suggest-btn')) {
            e.preventDefault();
            const pn = e.target.dataset.pn;
            const tr = e.target.closest('tr');
            if (!tr || !pn) return;
            const inPn = tr.querySelector('.in-pn');
            if (inPn) inPn.value = pn;
            this.updateRow(tr.dataset.id, { pn });
            return;
          }
          if (e.target.classList.contains('btn-del')) {
            this.removeRow(e.target.closest('tr').dataset.id);
          }
        });
      }

      document.addEventListener('change', e => {
        if (e.target.id === 'consent-all') {
          this.syncHiddenFields();  // 同意状態変化時もhidden同期
          this.validateSubmit();
        }
      });
      // 2026-04-23 T220: 備考欄変更で即テストモード判定
      document.addEventListener('input', e => {
        if (e.target && e.target.name === 'note') {
          this.detectTestModeFromNote();
          this.syncHiddenFields();
        }
      });

      // 2026-04-26: 沖縄・離島の住所検出→「お届け不可」警告(北海道は配送可)
      const addressEl = document.querySelector('textarea[name="address"]');
      const addressErrEl = document.getElementById('err-address');
      if (addressEl && addressErrEl) {
        const checkAddress = () => {
          const v = (addressEl.value || '').trim();
          // 沖縄・離島キーワード検出
          const ngPatterns = [
            { re: /沖縄県?/, label: '沖縄県' },
            { re: /(離島|佐渡|奄美|宮古島|石垣島|久米島|与那国|小笠原|伊豆諸島|大東島|父島|母島|青ヶ島|八丈島|三宅島|御蔵島|神津島|新島|式根島|利尻|礼文|焼尻|天売|渡嘉敷|座間味|粟国|渡名喜|南大東|北大東|多良間|来間|池間|伊良部|下地島|与論|沖永良部|徳之島|喜界|請島|加計呂麻|与路|硫黄|口永良部|屋久島|種子島|甑島|平戸|的山大島|宇久|小値賀|生月|福江|奈留|久賀|若松|中通島|頭ヶ島|久賀島|崎戸|池島|大島|江島|平島|度島|高島|軍艦島|端島|香焼|伊王島|沖島|沖の島|見島|蓋井島|青島|出島|玉浦|地島|相島|玄界島|大珠島|姫島|二神島|怒和島|津和地|中島|興居島|睦月|野忽那|怒和|二神|青島|岡村|大下|生名|岩城|赤穂|男木|女木|本島|広島|手島|小手島|高見島|佐柳島|粟島|志々島|伊吹島|豊島|直島|向島|因島|生口島|大三島|伯方島|大島|愛媛|安居島|魚島|高井神島)/, label: '離島' }
          ];
          const hits = [];
          for (const p of ngPatterns) {
            if (p.re.test(v)) hits.push(p.label);
          }
          if (hits.length > 0) {
            addressErrEl.textContent = '※ ' + hits.join('・') + ' は配送不可エリアです。お手数ですが本州・四国・九州本土の住所のみ承っております。';
            addressErrEl.style.color = '#c00';
            addressErrEl.style.fontWeight = 'bold';
          } else {
            addressErrEl.textContent = '';
            addressErrEl.style.color = '';
            addressErrEl.style.fontWeight = '';
          }
        };
        addressEl.addEventListener('input', checkAddress);
        addressEl.addEventListener('blur', checkAddress);
      }

      // 2026-04-26: 顧客情報リアルタイムvalidation(入力時に赤枠+エラー表示)
      const fieldValidators = {
        email: {
          test: v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
          msg: 'メールアドレスの形式が正しくありません(例: example@example.com)'
        },
        tel: {
          test: v => !v || /^\d{10,13}$/.test(v.replace(/[-\s　]/g, '')),
          msg: '電話番号は数字10〜13桁(ハイフンなし・例: 09012345678)'
        },
        zip: {
          test: v => !v || /^\d{7}$/.test(v.replace(/[-\s　]/g, '')),
          msg: '郵便番号は数字7桁(ハイフンなし・例: 5800022)'
        },
        address: {
          test: v => {
            if (!v) return true;
            const ngs = [/沖縄県?/, /(離島|佐渡|奄美|宮古島|石垣島|久米島|与那国|小笠原|伊豆諸島|大東島|父島|母島|青ヶ島|八丈島|三宅島|御蔵島|神津島|新島|式根島|利尻|礼文|焼尻|天売|渡嘉敷|座間味|粟国|渡名喜|南大東|北大東|多良間|来間|池間|伊良部|下地島|与論|沖永良部|徳之島|喜界|請島|加計呂麻|与路|硫黄|口永良部|屋久島|種子島|甑島)/];
            return !ngs.some(re => re.test(v));
          },
          msg: '配送不可エリア(沖縄・離島)です。本州・四国・九州・北海道本土の住所のみ承っております'
        }
      };
      const validateField = (name, el) => {
        const val = (el.value || '').trim();
        const v = fieldValidators[name];
        if (!v) return;
        const ok = v.test(val);
        let errEl = el.parentElement.querySelector('.shop-field-err');
        if (!ok) {
          el.style.borderColor = '#c00';
          el.style.background = '#fff8f8';
          el.style.boxShadow = '0 0 0 2px #f8d7da';
          if (!errEl) {
            errEl = document.createElement('div');
            errEl.className = 'shop-field-err';
            errEl.style.cssText = 'color:#c00; font-size:0.85em; margin-top:4px; font-weight:bold;';
            el.parentElement.appendChild(errEl);
          }
          errEl.textContent = '※ ' + v.msg;
        } else {
          el.style.borderColor = '';
          el.style.background = '';
          el.style.boxShadow = '';
          if (errEl) errEl.remove();
        }
      };
      ['email','tel','zip','address'].forEach(name => {
        const el = document.querySelector('input[name="'+name+'"], textarea[name="'+name+'"]');
        if (!el) return;
        el.addEventListener('input', () => validateField(name, el));
        el.addEventListener('blur', () => validateField(name, el));
      });

      // 送信時最終検証 (A-1対策: CF7のformはid="order-form"ではなくclass="wpcf7-form")
      const form = document.querySelector('.wpcf7-form') || document.getElementById('order-form');
      if (form) {
        form.addEventListener('submit', e => {
          // 送信直前に必ずhidden同期(最後の承諾状態を確実に送る)
          this.syncHiddenFields();
          if (!this.validateSubmit()) {
            e.preventDefault();
            e.stopImmediatePropagation();
            alert('カート内容または承諾事項に不足があります');
            return;
          }
          // 顧客情報validation(電話/郵便/住所/メール/北海道沖縄離島ブロック)
          if (!this.validateCustomerInfo()) {
            e.preventDefault();
            e.stopImmediatePropagation();
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
      // 2026-04-23 HPI-11/11c: raw/normalized + ハイフン無視版 もマッチ対象(健太郎指摘「PS00」で候補消える)
      if (!this.products) return { variants: [], similar: [] };
      const raw = (input || '').normalize('NFKC').toUpperCase().trim().replace(/\s+/g, '');
      const normalized = this.normalizePn(input || '');
      if (raw.length < 2) return { variants: [], similar: [] };
      const products = this.products.products;
      // ハイフン除去版も比較対象に(ユーザー入力「PS00」で品番「PS-001AR」をヒットさせる)
      const normalizedNH = normalized.replace(/-/g, '');
      const rawNH = raw.replace(/-/g, '');
      const matchKeys = [...new Set([normalized, raw, normalizedNH, rawNH])].filter(k => k && k.length >= 2);

      // バリアント: 入力PNで始まる別品番(raw/normalized/ハイフン無視版 全対応)
      const variants = products
        .filter(p => {
          if (matchKeys.includes(p.pn)) return false;
          const pnNH = p.pn.replace(/-/g, '');
          return matchKeys.some(k => p.pn.startsWith(k) || pnNH.startsWith(k));
        })
        .slice(0, 10);

      // 近似候補: 部分一致(includes)+ ハイフン無視版比較(3文字以上のキーのみ発火)
      const similar = [];
      const seen = new Set(variants.map(v => v.pn));
      for (const p of products) {
        if (seen.has(p.pn) || matchKeys.includes(p.pn)) continue;
        const pnNH = p.pn.replace(/-/g, '');
        const hit = matchKeys.some(k => {
          if (k.length < 3) return false;
          return p.pn.includes(k) || pnNH.includes(k);
        });
        if (hit) {
          similar.push(p);
          seen.add(p.pn);
          if (similar.length >= 10) break;
        }
      }
      return { variants, similar };
    },

    // 2026-04-23 HPI-22 再改修: ディープリンク案破棄・Google画像検索統一(アイカのみ現行維持)
    // 理由(健太郎実機検証 2026-04-23): 3Mダイノックサイトは品番検索機能なし(TOP着地)・
    //   サンゲツも品番特定できず検索結果一覧/トップ相当になる。
    //   柄確認=ユーザー目的に対しGoogle画像検索が最も実用的(日本語UI+サムネ一覧)。
    //   他社EC規約: 画像直接掲載NGだがGoogle検索リンクは問題なし(Googleサービス経由)。
    // - 3Mダイノック/ファサラ/スコッチ系: Google画像検索
    // - サンゲツリアテック: Google画像検索(品番特定可能)
    // - アイカオルティノ: 現行公式TOP維持(日本語+柄ギャラリー優秀・品番検索不要)
    // - 他(ベルビアン/クレアス/パロア/タキロン等): Google画像検索
    getOfficialUrl(product) {
      if (!product) return '';
      const brand = (product.brand || '').toString();
      const pn = product.pn || '';
      const g = (kw) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(kw + ' ' + pn)}`;
      // アイカオルティノ → 現行公式TOP(日本語+柄ギャラリーあり・健太郎実機OK確認)
      if (brand.includes('オルティノ') || brand.includes('アイカ')) return 'https://www.aica.co.jp/products/film/altyno/';
      // 3Mダイノック → Google画像検索(公式は品番検索機能なし)
      if (brand.includes('ダイノック')) return g('3Mダイノック');
      // サンゲツリアテック → Google画像検索(公式は品番特定できず)
      if (brand.includes('リアテック')) return g('サンゲツリアテック');
      // 3M ファサラ/スコッチティント/その他3Mフィルム
      if (brand.includes('ファサラ')) return g('3M ファサラ');
      if (brand.includes('スコッチティント')) return g('3M スコッチティント');
      if (brand.includes('3Mフィルム') || brand.includes('3M')) return g('3M');
      // その他(ベルビアン/クレアス/パロア/タキロン)
      if (brand.includes('ベルビアン')) return g('ベルビアン');
      if (brand.includes('クレアス')) return g('サンゲツ クレアス');
      if (brand.includes('パロア')) return g('サンゲツ パロア');
      if (brand.includes('タキロン')) return g('タキロン ベルビアン');
      return g(brand);
    },

    // 2026-04-23 HPI-11b: サジェスト候補をクリッカブルなボタン化(美砂さん指摘・タップで選択できるように)
    makeSuggestBtns(list, maxCount = 8) {
      if (!list || list.length === 0) return '';
      return list.slice(0, maxCount).map(p =>
        `<button type="button" class="pn-suggest-btn" data-pn="${this.escapeHtml(p.pn)}">${this.escapeHtml(p.pn)}</button>`
      ).join(' ');
    },

    // 2026-04-23 HPI-13: brand表示ブロックのHTML生成(公式リンク付)
    // 2026-04-23 追加改修: ソース明確品番(オルティノ/ファサラ/3Mフィルム/スコッチカル)は
    //   商品名を上段に大きく、ブランドを下段に小さく表示(柄イメージ喚起のため)
    //   ダイノック/リアテック(name=品番)は従来通り 1行表示(情報信頼性低いため)
    makeBrandBlockHtml(product) {
      if (!product) return '';
      const brand = product.brand || '';
      const name = product.name || '';
      const url = this.getOfficialUrl(product);
      const linkHtml = url
        ? ` <a href="${url}" target="_blank" rel="noopener noreferrer" class="official-link" title="メーカー公式サイトで柄を確認">柄を見る →</a>`
        : '';
      // ソース明確かつname=品番以外の信頼できる情報を持つブランド
      // オルティノ = アイカ公式カタログ由来で最も信頼性高い
      const nameIsProductCode = !name || name === product.pn || name.replace(/[\s-]/g, '') === product.pn.replace(/[\s-]/g, '');
      const reliable = (brand === 'オルティノ') && !nameIsProductCode;
      if (reliable) {
        return `<div class="pn-product-name">${this.escapeHtml(name)}</div><div class="pn-brand-sub">${this.escapeHtml(brand)}${linkHtml}</div>`;
      }
      // 従来表示(ダイノック/リアテック/その他・name=品番の場合はブランドのみ表示)
      const brandText = nameIsProductCode ? brand : `${brand} ${name}`;
      return `${this.escapeHtml(brandText)}${linkHtml}`;
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
