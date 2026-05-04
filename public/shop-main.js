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

    /* ───────────── 数量割引(2026-04-29 改訂) ─────────────
     * 健太郎指示 2026-04-29 朝: 5m以上=3%OFF / 10m以上=5%OFF / 5m未満=なし
     * 既存顧客は1mから送料無料運用 → shopは送料 ¥1,500 取るので住み分け担保
     * 安全装置: 既存顧客の通常価格を下回らないように品番ごと上限率を設定
     * 通常価格基準は 掛率マスター.md の出し値「通常」列
     *
     * 判定キー: brand + series 単位で getMaxDiscountRate(product) -> 0|2|5
     * 通常HPの差が小さい(=値下げ余地が小さい)品番は上限を下げる
     *   <2.5% → 0% (割引対象外)
     *   2.5%〜<4% → 2%上限(=AR/リアテック)
     *   ≥4% → 5%上限(=10m数量ルールまで適用可)
     */
    QTY_DISCOUNT_RULE: {
      threshold_5m: 0.03,    // 5m以上で3%
      threshold_10m: 0.05,   // 10m以上で5%
      min_meters_for_discount: 5,
    },

    // brand + series → 割引上限%(0/2/5)
    // 掛率マスター.md 2026-04-08版に基づく
    // ダイノック AR(値下げ余地2.04%)/リアテック(値下げ余地2.38%) → 2%まで
    // 3Mフィルムのスコッチカル系(化粧フィルム)は粗利20%固定運用 → 0%
    // ガラスフィルム(ファサラ全体・3Mフィルムのスコッチティント系) → 5%
    //   (健太郎指示 2026-04-29: 粗利15%下限まで値下げOK・5%引き=粗利15.79%確保)
    getMaxDiscountRate(product) {
      if (!product) return 0;
      const brand = product.brand || '';
      // series は判定上 ToUpperCase せずそのまま使用
      // (J不透過/XL透過 等の日本語含むため大小区別なしで前方一致でOK)
      const series = product.series || '';

      // ファサラ: 全品ガラスフィルム → 5%上限
      // (粗利20%基準・5%引き後 粗利15.79% で下限15%を確保)
      if (brand === 'ファサラ') return 5;

      // 3Mフィルム: シリーズで化粧フィルム vs ガラスフィルムを分岐
      //   スコッチカル(化粧フィルム) = series が「J不透過/J透過/XL不透過/XL透過/XL非在庫」
      //     → 粗利20%固定運用継続 → 0%
      //   それ以外(スコッチティント=ガラスフィルム: 遮熱Nano/日射調整/飛散防止/防犯/
      //     フロスト/外貼/外貼Nano/特殊/ティント他 等)
      //     → ガラスフィルム値下げOK → 5%上限
      if (brand === '3Mフィルム') {
        if (series.startsWith('J') || series.startsWith('XL')) return 0;
        return 5;
      }

      // ダイノック: シリーズ別判定
      if (brand === 'ダイノック') {
        // AR シリーズ = 値下げ余地2.04% → 2%上限
        if (series.toUpperCase() === 'AR') return 2;
        // それ以外(通常品/EX/EXR/NEO/WD/WG等)= 値下げ余地5%以上 → 5%
        return 5;
      }

      // リアテック: 値下げ余地2.38% → 2%上限
      if (brand === 'リアテック') return 2;

      // オルティノ: 通常HP vs 通常価格 = 値下げ余地5%以上 → 5%
      // VEX屋外も値下げ余地6%以上 → 5%
      if (brand === 'オルティノ') return 5;

      // その他(ベルビアン/クレアス/パロア/ネオックス/WB系/タキロン等が将来加わる場合)
      // 安全側で2%固定。万一値下げ余地が小さい品番が混じってもセーフ。
      return 2;
    },

    // 数量と品番から実適用割引率(%)を返す。
    // 数量ベースルール と 品番上限 の小さい方。
    getEffectiveDiscountRate(product, meters) {
      if (!product || meters < this.QTY_DISCOUNT_RULE.min_meters_for_discount) return 0;
      const baseRatePct = meters >= 10
        ? Math.round(this.QTY_DISCOUNT_RULE.threshold_10m * 100)
        : Math.round(this.QTY_DISCOUNT_RULE.threshold_5m * 100);
      const maxRatePct = this.getMaxDiscountRate(product);
      return Math.min(baseRatePct, maxRatePct);
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
      let discount = 0;  // 2026-04-28: 数量割引合計
      const brandMeters = {};  // 2026-04-22 HPI-8: ブランド別m数集計
      const discountBreakdown = [];  // 2026-04-28: 品番別割引内訳
      for (const item of this.cart) {
        const unit = item.product ? this.applyRevision(item.product, new Date(), item.width_mm) : 0;
        const sub = unit * item.meters;
        // 2026-04-28: 数量割引(品番ごと判定・端数切捨で計算)
        const ratePct = item.product ? this.getEffectiveDiscountRate(item.product, item.meters) : 0;
        const itemDiscount = Math.floor(sub * ratePct / 100);
        item.unit_price = unit;
        item.subtotal = sub;
        item.discount_rate_pct = ratePct;
        item.discount_amount = itemDiscount;
        subtotal += sub;
        discount += itemDiscount;
        totalMeters += item.meters;
        if (ratePct > 0 && item.product) {
          discountBreakdown.push({
            pn: item.product.pn,
            brand: item.product.brand,
            meters: item.meters,
            rate_pct: ratePct,
            amount: itemDiscount,
          });
        }
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
      // 2026-04-28: 割引適用後の小計 → 課税対象 → 税
      const subtotalAfterDiscount = subtotal - discount;
      const taxable = subtotalAfterDiscount + shipping;
      const tax = Math.floor(taxable * this.TAX_RATE);
      const total = taxable + tax;
      return {
        subtotal, discount, subtotalAfterDiscount,
        shipping, tax, total, totalMeters,
        brandMeters, shippingBreakdown, discountBreakdown,
      };
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
      // 2026-04-28: 数量割引行(割引額>0の時のみ表示)
      const discountRow = document.getElementById('row-qty-discount');
      const discountBadge = document.getElementById('qty-discount-badge');
      if (discountRow) {
        if (t.discount > 0) {
          discountRow.style.display = '';
          // 内訳の最大率をラベルに(複数品番混在時の主たる適用率)
          const maxRate = t.discountBreakdown.reduce((m, x) => Math.max(m, x.rate_pct), 0);
          const labelEl = document.getElementById('qty-discount-label');
          if (labelEl) labelEl.textContent = `量割引(${maxRate}%):`;
          set('sum-discount', '-¥' + t.discount.toLocaleString());
          if (discountBadge) {
            discountBadge.style.display = '';
            discountBadge.textContent = `${maxRate}% OFF適用中`;
          }
        } else {
          discountRow.style.display = 'none';
          set('sum-discount', '¥0');
          if (discountBadge) discountBadge.style.display = 'none';
        }
      }
      // 2026-04-28: 割引後小計(割引額>0時のみ別行で表示・割引なし時は非表示)
      const subAfterRow = document.getElementById('row-subtotal-after');
      if (subAfterRow) {
        if (t.discount > 0) {
          subAfterRow.style.display = '';
          set('sum-subtotal-after', '¥' + t.subtotalAfterDiscount.toLocaleString());
        } else {
          subAfterRow.style.display = 'none';
        }
      }
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

    /* ───────────── 確認モーダル(2026-04-29 美砂さん指示・2ステップ化) ─────────────
     * 入力内容を確認する → モーダル全項目表示 → 「修正に戻る」or「この内容で注文を確定する」
     */
    showConfirmModal() {
      // 既存モーダル除去(再表示時)
      const old = document.getElementById('shop-confirm-modal');
      if (old) old.remove();

      const totals = this.calcTotals();
      const items = this.cart.filter(r => r.product);

      // 顧客情報取得
      const v = (sel) => (document.querySelector(sel)?.value || '').trim();
      const name = v('input[name="customer_name"]');
      const company = v('input[name="company"]');
      const email = v('input[name="email"]');
      const tel = v('input[name="tel"]');
      const zip = v('input[name="zip"]');
      const addr = v('input[name="address"]') || v('textarea[name="address"]');
      const note = v('input[name="note"]') || v('textarea[name="note"]');
      const consent = this.getConsentState();
      const eh = (s) => this.escapeHtml(s);

      // 商品行
      const itemRows = items.length === 0
        ? '<tr><td colspan="4" style="text-align:center;color:#fbbf24;padding:14px;">(品番未指定)</td></tr>'
        : items.map(r => {
            const w = r.width_mm ? `<br><span style="color:#bfdbfe;font-size:0.85em;">幅 ${r.width_mm}mm</span>` : '';
            const nm = r.product.name && r.product.name !== r.product.pn ? `<br><span style="color:#bfdbfe;font-size:0.85em;">${eh(r.product.name)}</span>` : '';
            let priceCell = `¥${(r.unit_price || 0).toLocaleString()} / m`;
            if (r.discount_rate_pct > 0) {
              priceCell += `<br><span style="color:#fbbf24;font-size:0.85em;">量割引 ${r.discount_rate_pct}% OFF (-¥${(r.discount_amount || 0).toLocaleString()})</span>`;
            }
            return `<tr>
              <td style="padding:8px 10px;border-bottom:1px solid #1e3a5f;">[${eh(r.product.brand)}]<br><strong>${eh(r.product.pn)}</strong>${nm}${w}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #1e3a5f;text-align:right;">${r.meters} m</td>
              <td style="padding:8px 10px;border-bottom:1px solid #1e3a5f;text-align:right;">${priceCell}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #1e3a5f;text-align:right;font-weight:bold;">¥${(r.subtotal || 0).toLocaleString()}</td>
            </tr>`;
          }).join('');

      // 送料内訳
      let shipText;
      if (totals.shipping === 0) {
        shipText = '無料 (各メーカー3m以上)';
      } else if (totals.shippingBreakdown && totals.shippingBreakdown.length > 0) {
        const parts = totals.shippingBreakdown.map(x => `${eh(x.brand)} ${x.meters}m → ${x.fee === 0 ? '無料' : '¥' + x.fee.toLocaleString()}`);
        shipText = `¥${totals.shipping.toLocaleString()}<br><span style="color:#bfdbfe;font-size:0.85em;">${parts.join(' / ')}</span>`;
      } else {
        shipText = `¥${totals.shipping.toLocaleString()}`;
      }

      // 量割引行(あれば)
      let discountRow = '';
      if (totals.discount > 0) {
        const maxRate = (totals.discountBreakdown || []).reduce((m, x) => Math.max(m, x.rate_pct), 0);
        discountRow = `
          <tr><td style="padding:6px 10px;color:#fbbf24;">量割引 (${maxRate}%)</td><td style="padding:6px 10px;text-align:right;color:#fbbf24;font-weight:bold;">-¥${totals.discount.toLocaleString()}</td></tr>
          <tr><td style="padding:6px 10px;">税別合計 (割引後)</td><td style="padding:6px 10px;text-align:right;font-weight:bold;">¥${totals.subtotalAfterDiscount.toLocaleString()}</td></tr>`;
      }

      // モーダルHTML(ダーク青背景・既存shopページ調)
      const consentText = (consent.all && consent.scroll_read)
        ? '<span style="color:#86efac;font-weight:bold;">✓ 同意済</span>'
        : '<span style="color:#fca5a5;font-weight:bold;">未同意</span>';

      const html = `
        <div id="shop-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" style="
          position:fixed;inset:0;z-index:99999;
          background:rgba(0,0,0,0.78);
          display:flex;align-items:flex-start;justify-content:center;
          padding:20px 12px;overflow-y:auto;
          font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',sans-serif;
        ">
          <div style="
            width:100%;max-width:720px;
            background:#0a2545;color:#fff;
            border:1px solid #1e3a5f;border-radius:10px;
            box-shadow:0 10px 40px rgba(0,0,0,0.5);
            margin:auto 0;
          ">
            <div style="padding:18px 22px;border-bottom:1px solid #1e3a5f;">
              <h2 id="confirm-title" style="margin:0;font-size:1.25em;color:#fff;">ご注文内容のご確認</h2>
              <p style="margin:6px 0 0;font-size:0.9em;color:#bfdbfe;">下記内容でよろしければ「この内容で注文を確定する」を押してください。</p>
            </div>

            <div style="padding:18px 22px;">
              <h3 style="margin:0 0 8px;font-size:1.05em;color:#fbbf24;border-left:3px solid #fbbf24;padding-left:8px;">注文内容</h3>
              <table style="width:100%;border-collapse:collapse;color:#fff;font-size:0.92em;margin-bottom:14px;">
                <thead>
                  <tr style="background:#1e3a5f;">
                    <th style="padding:8px 10px;text-align:left;border-bottom:1px solid #2563eb;">品番</th>
                    <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #2563eb;">数量</th>
                    <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #2563eb;">単価</th>
                    <th style="padding:8px 10px;text-align:right;border-bottom:1px solid #2563eb;">小計</th>
                  </tr>
                </thead>
                <tbody>${itemRows}</tbody>
              </table>

              <table style="width:100%;border-collapse:collapse;color:#fff;font-size:0.95em;margin-bottom:18px;background:#0d2c52;border-radius:6px;overflow:hidden;">
                <tbody>
                  <tr><td style="padding:6px 10px;">合計m数</td><td style="padding:6px 10px;text-align:right;">${totals.totalMeters} m</td></tr>
                  <tr><td style="padding:6px 10px;">小計 (税別)</td><td style="padding:6px 10px;text-align:right;">¥${totals.subtotal.toLocaleString()}</td></tr>
                  ${discountRow}
                  <tr><td style="padding:6px 10px;">送料 (税別)</td><td style="padding:6px 10px;text-align:right;">${shipText}</td></tr>
                  <tr><td style="padding:6px 10px;">消費税 (10%)</td><td style="padding:6px 10px;text-align:right;">¥${totals.tax.toLocaleString()}</td></tr>
                  <tr style="background:#1e3a5f;"><td style="padding:10px;font-weight:bold;font-size:1.05em;">合計 (税込)</td><td style="padding:10px;text-align:right;font-weight:bold;font-size:1.15em;color:#fbbf24;">¥${totals.total.toLocaleString()}</td></tr>
                </tbody>
              </table>

              <h3 style="margin:0 0 8px;font-size:1.05em;color:#fbbf24;border-left:3px solid #fbbf24;padding-left:8px;">お客様情報</h3>
              <table style="width:100%;border-collapse:collapse;color:#fff;font-size:0.92em;margin-bottom:14px;">
                <tbody>
                  <tr><th style="padding:6px 10px;text-align:left;width:32%;color:#bfdbfe;font-weight:normal;border-bottom:1px solid #1e3a5f;">お名前</th><td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;">${eh(name) || '<span style="color:#fca5a5;">未入力</span>'}</td></tr>
                  <tr><th style="padding:6px 10px;text-align:left;color:#bfdbfe;font-weight:normal;border-bottom:1px solid #1e3a5f;">会社名・屋号</th><td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;">${eh(company) || '<span style="color:#9ca3af;">(任意・未入力)</span>'}</td></tr>
                  <tr><th style="padding:6px 10px;text-align:left;color:#bfdbfe;font-weight:normal;border-bottom:1px solid #1e3a5f;">メールアドレス</th><td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;">${eh(email) || '<span style="color:#fca5a5;">未入力</span>'}</td></tr>
                  <tr><th style="padding:6px 10px;text-align:left;color:#bfdbfe;font-weight:normal;border-bottom:1px solid #1e3a5f;">電話番号</th><td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;">${eh(tel) || '<span style="color:#fca5a5;">未入力</span>'}</td></tr>
                  <tr><th style="padding:6px 10px;text-align:left;color:#bfdbfe;font-weight:normal;border-bottom:1px solid #1e3a5f;">郵便番号</th><td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;">${eh(zip) || '<span style="color:#fca5a5;">未入力</span>'}</td></tr>
                  <tr><th style="padding:6px 10px;text-align:left;color:#bfdbfe;font-weight:normal;border-bottom:1px solid #1e3a5f;">配送先住所</th><td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;">${eh(addr) || '<span style="color:#fca5a5;">未入力</span>'}</td></tr>
                  <tr><th style="padding:6px 10px;text-align:left;color:#bfdbfe;font-weight:normal;border-bottom:1px solid #1e3a5f;">備考</th><td style="padding:6px 10px;border-bottom:1px solid #1e3a5f;white-space:pre-wrap;">${eh(note) || '<span style="color:#9ca3af;">(なし)</span>'}</td></tr>
                  <tr><th style="padding:6px 10px;text-align:left;color:#bfdbfe;font-weight:normal;">ご確認事項への同意</th><td style="padding:6px 10px;">${consentText}</td></tr>
                </tbody>
              </table>
            </div>

            <div style="padding:14px 22px 20px;border-top:1px solid #1e3a5f;display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;">
              <button type="button" id="confirm-back-btn" style="
                flex:1 1 200px;min-height:48px;
                background:#374151;color:#fff;border:1px solid #6b7280;border-radius:6px;
                font-size:1em;font-weight:bold;cursor:pointer;padding:10px 18px;
              ">修正に戻る</button>
              <button type="button" id="confirm-submit-btn" style="
                flex:1 1 240px;min-height:48px;
                background:#f08300;color:#fff;border:none;border-radius:6px;
                font-size:1.05em;font-weight:bold;cursor:pointer;padding:10px 18px;
                box-shadow:0 2px 6px rgba(240,131,0,0.4);
              ">この内容で注文を確定する</button>
            </div>
          </div>
        </div>`;

      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      const modal = wrap.firstElementChild;
      document.body.appendChild(modal);
      // bodyスクロールロック
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const closeModal = () => {
        modal.remove();
        document.body.style.overflow = prevOverflow;
      };
      modal.querySelector('#confirm-back-btn').addEventListener('click', () => {
        closeModal();
      });
      modal.querySelector('#confirm-submit-btn').addEventListener('click', () => {
        // フラグセット → 確認画面閉じて → 実送信
        this._confirmedSubmit = true;
        closeModal();
        // CF7本来のsubmit経路を再起動: btn-submitクリック相当
        const btn = document.getElementById('btn-submit');
        const form = document.querySelector('.wpcf7-form') || document.getElementById('order-form');
        if (btn) {
          btn.click();
        } else if (form) {
          form.requestSubmit ? form.requestSubmit() : form.submit();
        }
      });
      // ESCで「修正に戻る」
      const onKey = (ev) => {
        if (ev.key === 'Escape') {
          closeModal();
          document.removeEventListener('keydown', onKey);
        }
      };
      document.addEventListener('keydown', onKey);
      // 背景クリックで閉じる
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal();
      });
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
      // 2026-04-28: 割引情報も併記(品番ごとの量割引率/額)
      const cartReadable = cartSlim.length === 0
        ? '(品番未指定)'
        : this.cart
            .filter(r => r.product)
            .map(r => {
              const it = {
                pn: r.product.pn, name: r.product.name || '', brand: r.product.brand,
                width_mm: r.width_mm || r.product.width_mm || null,
                meters: r.meters, unit_price: r.unit_price || 0, subtotal: r.subtotal || 0,
                discount_rate_pct: r.discount_rate_pct || 0, discount_amount: r.discount_amount || 0,
              };
              // 2026-05-04 N187類: name==pn(ダイノック/3Mフィルム等 大半1071/2805品番)では「PS-999 PS-999」と重複表示になるためnm抑止
              //   products.json側で name に商品名(柄名等・主にオルティノ系)が入っているケースのみ併記
              //   ロジックは L1523 makeBrandBlockHtml の nameIsProductCode と同等(空白/ハイフン除去後比較)
              const nameIsProductCode = !it.name
                || it.name === it.pn
                || it.name.replace(/[\s-]/g, '') === it.pn.replace(/[\s-]/g, '');
              const nm = nameIsProductCode ? '' : ' ' + it.name;
              const w = it.width_mm ? ` 幅${it.width_mm}mm` : '';
              const baseLine = `[${it.brand}] ${it.pn}${nm}${w}\n`
                + `  m単価: ¥${it.unit_price.toLocaleString()} × ${it.meters}m = ¥${it.subtotal.toLocaleString()}`;
              if (it.discount_rate_pct > 0) {
                return baseLine + `\n  量割引(${it.discount_rate_pct}%): -¥${it.discount_amount.toLocaleString()}`;
              }
              return baseLine;
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
      // 2026-04-28: 割引行を含む可読版
      let discountLine = '';
      if (totals.discount > 0) {
        const maxRate = (totals.discountBreakdown || []).reduce((m, x) => Math.max(m, x.rate_pct), 0);
        discountLine = `量割引(${maxRate}%): -¥${totals.discount.toLocaleString()}\n`
          + `税別合計: ¥${totals.subtotalAfterDiscount.toLocaleString()}\n`;
      }
      const totalsReadable =
        `合計m数: ${totals.totalMeters}m\n`
        + `小計(税別): ¥${totals.subtotal.toLocaleString()}\n`
        + discountLine
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

      // 2026-04-29 健太郎指示: 〒→住所自動入力 + 〒検索リンク + 弊社情報placeholder→3M本社例 置換
      // (CF7のform contentはWP管理画面でしか書き換えられないので、JS側でDOM上書きする)
      this.initZipcodeAutocomplete();

      // 送信時最終検証 (A-1対策: CF7のformはid="order-form"ではなくclass="wpcf7-form")
      // 2026-04-29 美砂さん指示: 2ステップ化(入力→確認モーダル→確定)
      //   1段階目: validation通過 → 確認モーダル表示 → submit抑止
      //   2段階目: モーダル「この内容で注文を確定する」 → _confirmedSubmit=true → form再submit
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
          // 2026-04-29 2ステップ確認: 確認モーダル経由でなければ抑止して表示
          if (!this._confirmedSubmit) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.showConfirmModal();
            return;
          }
          // 確認済(2回目通過)→ フラグリセット・CF7本来の送信処理へ流す
          this._confirmedSubmit = false;
        }, true);  // capture=true で他のハンドラより先に走らせる
      }

      // 送信ボタン文言を「入力内容を確認する」に上書き
      // (CF7のformはWP管理画面でしか書き換え不能なので、レンダ後にJS側でvalue上書き)
      const overrideBtnLabel = () => {
        const btn = document.getElementById('btn-submit');
        if (btn && btn.value !== '入力内容を確認する') {
          btn.value = '入力内容を確認する';
        }
      };
      overrideBtnLabel();
      // CF7再描画後も文言を維持するため定期チェック(失敗時のCF7リセット対応)
      const btnObserver = new MutationObserver(overrideBtnLabel);
      const btnTarget = document.querySelector('.wpcf7-form') || document.body;
      if (btnTarget) {
        btnObserver.observe(btnTarget, { subtree: true, attributes: true, childList: true, attributeFilter: ['value'] });
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

    /* ───────────── 2026-04-29 〒→住所自動入力 / 〒検索リンク / 例の3M本社置換 ─────────────
     * 健太郎指示3点:
     *  A. 〒7桁入力で都道府県/市区町村/町域を自動入力(zipcloud API・無料)
     *  B. 〒フィールド横に「郵便番号がわからない場合」リンク(日本郵便)を追加
     *  C. 弊社情報(580-0022/松原)のplaceholder→3M Japan本社(141-8645/東京都品川区北品川6-7-29)
     * CF7のform本体はWP管理画面でしか書き換え不能なので、レンダ後にJSで上書き。
     */
    initZipcodeAutocomplete() {
      const zipEl = document.querySelector('input[name="zip"]');
      const addrEl = document.querySelector('input[name="address"], textarea[name="address"]');
      if (!zipEl || !addrEl) return;

      // C. placeholder書き換え(弊社情報→3M本社の例)
      try {
        zipEl.setAttribute('placeholder', '例: 1418645');
        addrEl.setAttribute('placeholder', '例: 東京都品川区北品川6-7-29');
      } catch (_e) {}

      // B. 〒検索リンクを zipEl の直後に挿入(既に入っていれば重複させない)
      if (!document.getElementById('zipcode-search-link')) {
        const link = document.createElement('a');
        link.id = 'zipcode-search-link';
        link.href = 'https://www.post.japanpost.jp/zipcode/';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = '郵便番号がわからない場合';
        link.style.cssText = 'display:inline-block; margin-left:10px; padding:4px 10px; font-size:0.85em; color:#1d4ed8; background:#eff6ff; border:1px solid #bfdbfe; border-radius:4px; text-decoration:none; font-weight:500; vertical-align:middle;';
        link.addEventListener('mouseover', () => { link.style.background = '#dbeafe'; });
        link.addEventListener('mouseout', () => { link.style.background = '#eff6ff'; });
        zipEl.insertAdjacentElement('afterend', link);
      }

      // A. 〒7桁入力 → zipcloud APIで住所取得 → addrElに自動入力
      // ※ 既に住所が入力済みの場合は上書きしない(顧客が手で書いた途中の値を破壊しない)
      const fillFromZipcloud = async () => {
        const raw = (zipEl.value || '').trim().replace(/[-\s　]/g, '');
        if (!/^\d{7}$/.test(raw)) return;  // 7桁になっていなければ何もしない
        try {
          const url = 'https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + encodeURIComponent(raw);
          const res = await fetch(url);
          if (!res.ok) return;
          const data = await res.json();
          if (!data || data.status !== 200 || !data.results || !data.results.length) return;
          const r = data.results[0];
          const filled = (r.address1 || '') + (r.address2 || '') + (r.address3 || '');
          if (!filled) return;
          // 既存値が「自動入力された都道府県/市区町村のprefix」かを判定。
          // 空 or filledで始まらない場合のみ全置換、filledで始まる場合は番地以降を保持。
          const cur = (addrEl.value || '').trim();
          if (!cur) {
            addrEl.value = filled;
          } else if (cur === filled) {
            return;  // 何もしない
          } else if (cur.startsWith(filled)) {
            return;  // 既に番地まで書かれている
          } else {
            // 別の自動入力値が入っている可能性 → prefix付け替え
            // 安全のため空欄時のみ自動入力に絞る(顧客の手入力を保護)
            return;
          }
          // 反応をブラウザに伝える(CF7やリアルタイム検証のため)
          addrEl.dispatchEvent(new Event('input', { bubbles: true }));
          addrEl.dispatchEvent(new Event('blur', { bubbles: true }));
        } catch (_e) {
          // API失敗は無音(顧客には影響なし・手入力で続行可能)
        }
      };
      zipEl.addEventListener('blur', fillFromZipcloud);
      zipEl.addEventListener('input', () => {
        const raw = (zipEl.value || '').trim().replace(/[-\s　]/g, '');
        if (/^\d{7}$/.test(raw)) fillFromZipcloud();
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
        ? ` <a href="${url}" target="_blank" rel="noopener noreferrer" class="official-link" title="WEB検索で柄を確認">柄を確認する（WEB検索）</a>`
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
