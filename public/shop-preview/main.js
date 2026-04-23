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
        // 2026-04-22 HPI-Vercel対応: basePath自動判定
        // 本番(tecnest.biz/shop/) = /wp-content/uploads/shop/
        // Vercel preview(/shop-preview/) = /shop-preview
        const basePath = window.location.pathname.startsWith('/shop-preview')
          ? '/shop-preview'
          : '/wp-content/uploads/shop';

        // BCPくろ提言: 緊急停止チェック(最優先・AI障害時の受注停止用)
        const modeRes = await fetch(`${basePath}/mode.txt?_=` + Date.now());
        const mode = modeRes.ok ? (await modeRes.text()).trim() : 'live';
        if (mode === 'suspended' || mode === 'maintenance') {
          this.showSuspendedBanner(mode);
          return;
        }

        const verRes = await fetch(`${basePath}/version.txt?_=` + Date.now());
        const ver = verRes.ok ? (await verRes.text()).trim() : String(Date.now());
        const res = await fetch(`${basePath}/products.json?v=${ver}`);
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

    /* ───────────── 価格計算 ───────────── */
    applyRevision(product, shipDate = new Date()) {
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
      return Math.ceil(product.hp_price_m * mult / 10) * 10;
    },

    calcTotals() {
      let subtotal = 0;
      let totalMeters = 0;
      const brandMeters = {};  // 2026-04-22 HPI-8: ブランド別m数集計
      for (const item of this.cart) {
        const unit = item.product ? this.applyRevision(item.product) : 0;
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
    addRow(pn = '', meters = 1) {
      const product = pn ? this.lookupProduct(pn) : null;
      this.cart.push({
        id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
        pn, product, meters,
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
      }
      if ('meters' in patch) {
        // 2026-04-23 HPI-12: 小数点(0.5m刻み等)対応・parseFloatに変更
        let m = parseFloat(patch.meters);
        if (isNaN(m) || m < 0.1) m = 1;
        if (m > 200) m = 200; // 2026-04-20 上限200m(健太郎指示)・超はフォーム備考or問合せ
        // 0.1刻みに丸める(浮動小数誤差対策)
        m = Math.round(m * 10) / 10;
        row.meters = m;
        // 2026-04-20 バグ修正: clamp後の値をinput.valueにも反映(表示と実値乖離防止)
        const inMcell = document.querySelector(`#cart-rows tr[data-id="${id}"] .in-m`);
        if (inMcell && String(m) !== inMcell.value) inMcell.value = String(m);
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
      const unit = row.product ? this.applyRevision(row.product) : 0;
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
        const unit = row.product ? this.applyRevision(row.product) : 0;
        const sub = unit * row.meters;
        // 2026-04-20 変更: 商品名列廃止、品番セル内に集約(ブランド名 上/ヒント 下)
        let brandTop = '';
        let pnSuggestSlot = '';
        if (row.product) {
          brandTop = `<div class="pn-brand">${this.makeBrandBlockHtml(row.product)}</div>`;
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
          <td data-label="上代(円/㎡)" class="td-joutai">${joutaiText}</td>
          <td data-label="掛率" class="td-ppt">${pptText}</td>
          <td data-label="m単価(税別)" class="td-unit">${unitText}</td>
          <td data-label="数量"><input class="in-m" type="number" min="0.1" max="200" step="0.1" value="${row.meters}" inputmode="decimal" aria-label="数量(メートル)" onfocus="this.select()">m</td>
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
      const cartSlim = this.cart
        .filter(r => r.product)
        .map(r => ({
          pn: r.product.pn,
          name: r.product.name || '',
          brand: r.product.brand,
          meters: r.meters,
          unit_price: this.applyRevision(r.product),
          subtotal: this.applyRevision(r.product) * r.meters,
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
    },

    /* ───────────── 状態保持 ───────────── */
    persistCart() {
      try {
        const slim = this.cart.map(r => ({ pn: r.pn, meters: r.meters }));
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
        this.cart = items.map(i => ({
          id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
          pn: i.pn,
          product: this.lookupProduct(i.pn),
          meters: i.meters,
        }));
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
      }

      document.addEventListener('change', e => {
        if (e.target.id === 'consent-all') {
          this.syncHiddenFields();  // 同意状態変化時もhidden同期
          this.validateSubmit();
        }
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
      // 2026-04-23 HPI-11: 部分一致対応・raw/normalized 両方で検索
      if (!this.products) return { variants: [], similar: [] };
      const raw = (input || '').normalize('NFKC').toUpperCase().trim().replace(/\s+/g, '');
      const normalized = this.normalizePn(input || '');
      if (raw.length < 2) return { variants: [], similar: [] };
      const products = this.products.products;
      const matchKeys = [normalized, raw].filter(k => k && k.length >= 2);

      // バリアント: 入力PNで始まる別品番(raw/normalized両対応で完全一致を除く)
      const variants = products
        .filter(p => {
          if (matchKeys.includes(p.pn)) return false;
          return matchKeys.some(k => p.pn.startsWith(k));
        })
        .slice(0, 10);

      // 近似候補: 部分一致(includes)+ prefix 3-4文字一致(3文字以上のみ発火)
      const similar = [];
      const seen = new Set(variants.map(v => v.pn));
      for (const p of products) {
        if (seen.has(p.pn) || matchKeys.includes(p.pn)) continue;
        const hit = matchKeys.some(k => {
          if (k.length < 3) return false;
          return p.pn.includes(k);
        });
        if (hit) {
          similar.push(p);
          seen.add(p.pn);
          if (similar.length >= 10) break;
        }
      }
      return { variants, similar };
    },

    // 2026-04-23 HPI-13: メーカー公式サイトURL(品番別の画像URL提供は不可のため、メーカーTOPへ)
    getOfficialUrl(product) {
      if (!product) return '';
      const brand = (product.brand || '').toString();
      // 3M系
      if (brand.includes('ダイノック')) return 'https://www.mmm.co.jp/dinoc/';
      if (brand.includes('ファサラ')) return 'https://www.mmm.co.jp/ggf/fasara/';
      if (brand.includes('スコッチティント')) return 'https://www.mmm.co.jp/ggf/';
      if (brand.includes('3Mフィルム') || brand.includes('3M')) return 'https://www.mmm.co.jp/ggf/';
      // サンゲツ
      if (brand.includes('リアテック')) return 'https://www.sangetsu.co.jp/';
      // アイカ
      if (brand.includes('オルティノ') || brand.includes('アイカ')) return 'https://www.aica.co.jp/products/film/altyno/';
      // シーアイ化成
      if (brand.includes('ベルビアン')) return 'https://www.c-i.co.jp/belbien/';
      // 岡本化成
      if (brand.includes('クレアス')) return 'https://www.okamoto-g.com/kress/';
      if (brand.includes('パロア')) return 'https://www.okamoto-g.com/paroa/';
      return '';
    },

    // 2026-04-23 HPI-13: brand表示ブロックのHTML生成(公式リンク付)
    makeBrandBlockHtml(product) {
      if (!product) return '';
      const brandText = `${product.brand}${product.name ? ' ' + product.name : ''}`;
      const url = this.getOfficialUrl(product);
      const linkHtml = url
        ? ` <a href="${url}" target="_blank" rel="noopener noreferrer" class="official-link" title="メーカー公式サイトで柄を確認">柄を見る →</a>`
        : '';
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
