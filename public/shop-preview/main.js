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
        const modeRes = await fetch('/wp-content/uploads/shop/mode.txt?_=' + Date.now());
        const mode = modeRes.ok ? (await modeRes.text()).trim() : 'live';
        if (mode === 'suspended' || mode === 'maintenance') {
          this.showSuspendedBanner(mode);
          return;
        }

        const verRes = await fetch('/wp-content/uploads/shop/version.txt?_=' + Date.now());
        const ver = verRes.ok ? (await verRes.text()).trim() : String(Date.now());
        const res = await fetch(`/wp-content/uploads/shop/products.json?v=${ver}`);
        if (!res.ok) throw new Error('products.json取得失敗: ' + res.status);
        this.products = await res.json();
        this.restoreCart();
        this.bindEvents();
        this.renderDatalist();
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
      return s;
    },

    lookupProduct(input) {
      const pn = this.normalizePn(input);
      if (!pn || !this.products) return null;
      let hit = this.products.products.find(p => p.pn === pn);
      if (hit) return hit;
      // 前方一致fallbackは入力4文字以上&一意(1件のみヒット)の時のみ許可。
      // 短すぎる入力や複数ヒット時は誤認を避けるため null を返す(A-6対策)。
      if (pn.length < 4) return null;
      const matches = this.products.products.filter(p => p.pn.startsWith(pn));
      return matches.length === 1 ? matches[0] : null;
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
      for (const item of this.cart) {
        const unit = item.product ? this.applyRevision(item.product) : 0;
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
        let m = parseInt(patch.meters, 10);
        if (isNaN(m) || m < 1) m = 1;
        if (m > 100) m = 100;
        row.meters = m;
      }
      this.renderCart();
      this.persistCart();
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
        let nameCell;
        let nameCellClass = 'td-name';
        if (row.product) {
          nameCell = `<strong>${this.escapeHtml(row.product.brand)}</strong> ${this.escapeHtml(row.product.name || '')}`;
        } else if (row.pn) {
          // 前方一致候補をカウント(未登録 vs 複数候補の区別用)
          const normalized = this.normalizePn(row.pn);
          const candidates = this.products
            ? this.products.products.filter(p => p.pn.startsWith(normalized))
            : [];
          if (candidates.length > 1) {
            nameCell = `候補が${candidates.length}件あります。品番を続けて入力してください`;
            nameCellClass += ' pn-multi';
          } else {
            nameCell = 'この品番は登録にありません。品番をご確認のうえ、必要ならお問い合わせください';
            nameCellClass += ' pn-not-found';
          }
        } else {
          nameCell = '<span class="muted">品番を入力(例: PS-134 / 半角/全角どちらでもOK)</span>';
        }
        tr.innerHTML = `
          <td><input class="in-pn" list="pn-suggest" value="${this.escapeHtml(row.pn)}" placeholder="例: PS-134" autocomplete="off"></td>
          <td class="${nameCellClass}">${nameCell}</td>
          <td class="td-unit">${unit > 0 ? '¥' + unit.toLocaleString() : '-'}</td>
          <td><input class="in-m" type="number" min="1" max="100" value="${row.meters}">m</td>
          <td class="td-sub">${sub > 0 ? '¥' + sub.toLocaleString() : '-'}</td>
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

    validateSubmit() {
      const btn = document.getElementById('btn-submit');
      if (!btn) return false;
      const hasItems = this.cart.length > 0 && this.cart.every(r => r.product && r.meters > 0);
      const consent = this.allConsented();
      btn.disabled = !(hasItems && consent);
      const hint = document.getElementById('submit-hint');
      if (hint) {
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
        } else {
          hint.textContent = '';
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

    /* ───────────── datalist サジェスト(先頭一致・最大10件) ─────────────
     * 2026-04-20 追加: 客が入力補助で品番候補を見られるように。
     * shop-page.html に <datalist id="pn-suggest"></datalist> を配置する前提。
     */
    renderDatalist() {
      const dl = document.getElementById('pn-suggest');
      if (!dl || !this.products) return;
      dl.innerHTML = '';
      // 全100品番をdatalistに投入(ブラウザ側がユーザー入力でフィルタ+表示件数制限する)
      for (const p of this.products.products) {
        const opt = document.createElement('option');
        opt.value = p.pn;
        opt.label = `${p.brand} ${p.name || ''}`.trim();
        dl.appendChild(opt);
      }
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
