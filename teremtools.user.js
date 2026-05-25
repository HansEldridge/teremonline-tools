// ==UserScript==
// @name         Teremonline - Product Tools
// @namespace    teremtools
// @version      6.0
// @description  Инструменты для страниц товаров teremonline.ru: фото, данные, калькулятор, подборка, заметки
// @match        *://teremonline.ru/*
// @match        *://*.teremonline.ru/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @updateURL    https://raw.githubusercontent.com/HansEldridge/teremonline-tools/main/teremtools.user.js
// @downloadURL  https://raw.githubusercontent.com/HansEldridge/teremonline-tools/main/teremtools.user.js
// @run-at       document-end
// ==/UserScript==

console.log('[TeremTools] v6.0 запустился');

(function () {
    'use strict';

    // ===== ХРАНИЛИЩЕ (GM_* с fallback на localStorage) =====
    const storage = {
        get(key, def) {
            try {
                if (typeof GM_getValue === 'function') {
                    const v = GM_getValue(key, null);
                    if (v !== null && v !== undefined) {
                        return typeof v === 'string' ? JSON.parse(v) : v;
                    }
                    return def;
                }
            } catch (e) { console.warn('[TeremTools] GM_getValue fail', e); }
            try {
                const raw = localStorage.getItem('tt_' + key);
                return raw ? JSON.parse(raw) : def;
            } catch { return def; }
        },
        set(key, val) {
            const json = JSON.stringify(val);
            try {
                if (typeof GM_setValue === 'function') { GM_setValue(key, json); return; }
            } catch (e) { console.warn('[TeremTools] GM_setValue fail', e); }
            try { localStorage.setItem('tt_' + key, json); }
            catch (e) { console.warn('[TeremTools] localStorage fail', e); }
        }
    };

    // ===== ОБЩИЕ ФУНКЦИИ =====
    function getArticle() {
        const m = document.body.innerText.match(/Арт[\.\s]*:?\s*([A-Za-z0-9][A-Za-z0-9\-_]*)/i);
        return m ? m[1].trim() : null;
    }
    function getArticleOrAsk() {
        const a = getArticle();
        if (a) return a;
        const manual = prompt('Артикул не найден. Введи вручную:', 'product');
        return manual || 'product';
    }
    function getProductName() {
        const h1 = document.querySelector('h1');
        if (h1 && h1.innerText.trim()) return h1.innerText.trim();
        let title = document.title || '';
        return title.replace(/\s*[\|\-–—]\s*Teremonline.*$/i, '').trim();
    }
    function getProductId() { return getArticle() || location.pathname; }
    function getCleanUrl()  { return location.origin + location.pathname; }

    function normalizeUnit(raw) {
        if (!raw) return null;
        let u = raw.toLowerCase().replace(/\s+/g, '').replace('.', '');
        if (/^м2$|^м²$|^кв\.?м$|^квм$/.test(u)) return 'м²';
        if (/^м3$|^м³$|^куб\.?м$|^кубм$/.test(u)) return 'м³';
        if (/^мп$|^пм$|^пог\.?м$|^погм$/.test(u)) return 'м';
        if (/^м$/.test(u)) return 'м';
        if (/^шт$|^штук$|^штука$/.test(u)) return 'шт';
        if (/^кг$|^килограмм/.test(u)) return 'кг';
        if (/^г$|^грамм/.test(u)) return 'г';
        if (/^л$|^литр/.test(u)) return 'л';
        if (/^уп$|^упак/.test(u)) return 'уп';
        return raw.trim();
    }
    function parseNumber(s) {
        if (!s) return NaN;
        s = s.replace(/\s|&nbsp;/g, '').replace(',', '.');
        const m = s.match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
    }
    function getPriceInfo() {
        const bodyText = document.body.innerText;
        let price = NaN;
        const pm = bodyText.match(/цена\s*:?\s*([\d\s.,]+)\s*руб/i);
        if (pm) price = parseNumber(pm[1]);
        let unitQty = 1, unitRaw = null;
        const um = bodyText.match(/\/\s*за\s+([\d\s.,]+)?\s*([а-яa-zё²³.]+)/i);
        if (um) {
            if (um[1] && um[1].trim()) {
                const q = parseNumber(um[1]);
                if (!isNaN(q) && q > 0) unitQty = q;
            }
            unitRaw = um[2];
        }
        const unit = normalizeUnit(unitRaw);
        let pricePerUnit = NaN;
        if (!isNaN(price) && unitQty > 0) pricePerUnit = price / unitQty;
        return { price, unitQty, unit, pricePerUnit };
    }
    function formatMoney(n) {
        if (isNaN(n)) return '—';
        const fixed = Math.round(n * 100) / 100;
        const s = (Math.abs(fixed - Math.round(fixed)) < 0.005)
            ? Math.round(fixed).toString() : fixed.toFixed(2);
        return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
    }

    function findMainImage() {
        const imgs = Array.from(document.querySelectorAll('img'));
        let best = null;
        for (const img of imgs) {
            const w = img.naturalWidth, h = img.naturalHeight;
            if (!w || !h) continue;
            if (w < 300 || h < 300) continue;
            if (Math.abs(w / h - 1) > 0.1) continue;
            const rect = img.getBoundingClientRect();
            if (rect.top + window.scrollY > 1500) continue;
            if (!best || w > best.naturalWidth) best = img;
        }
        return best;
    }
    function findCarouselContainer(mainImg) {
        if (!mainImg) return null;
        let node = mainImg.parentElement;
        for (let i = 0; i < 8 && node; i++) {
            const imgs = node.querySelectorAll('img');
            const squares = Array.from(imgs).filter(img => {
                const w = img.naturalWidth, h = img.naturalHeight;
                return w >= 200 && h >= 200 && Math.abs(w / h - 1) < 0.1;
            });
            if (squares.length >= 2) return node;
            node = node.parentElement;
        }
        return mainImg.parentElement;
    }
    function upscaleUrl(url) {
        return url.replace(/(_|\/|-)(\d{2,4})x(\d{2,4})(?=[._\/])/g,
            (m, sep) => `${sep}1600x1600`);
    }
    function toAbsolute(url) {
        try { return new URL(url, location.href).href; } catch { return url; }
    }
    function collectPhotoUrls() {
        const mainImg = findMainImage();
        if (!mainImg) return [];
        const container = findCarouselContainer(mainImg);
        const imgs = Array.from(container.querySelectorAll('img'));
        return [...new Set(
            imgs.filter(img => {
                const w = img.naturalWidth, h = img.naturalHeight;
                return w >= 200 && h >= 200 && Math.abs(w / h - 1) < 0.1;
            })
            .map(img => img.currentSrc || img.src)
            .filter(Boolean)
            .map(u => toAbsolute(upscaleUrl(u)))
        )];
    }
    function getMainPhotoUrl() {
        const urls = collectPhotoUrls();
        return urls[0] || null;
    }
    function blobToJpg(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0);
                c.toBlob(b => {
                    URL.revokeObjectURL(url);
                    b ? resolve(b) : reject(new Error('toBlob failed'));
                }, 'image/jpeg', 0.95);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img load failed')); };
            img.src = url;
        });
    }
    async function copyToClipboard(text) {
        try { await navigator.clipboard.writeText(text); return true; }
        catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed'; ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        }
    }
    function toast(msg, type) {
        const t = document.createElement('div');
        t.textContent = msg;
        Object.assign(t.style, {
            position: 'fixed', top: '20px', right: '20px', zIndex: 1000000,
            padding: '12px 18px', borderRadius: '8px', color: '#fff',
            fontSize: '14px', fontWeight: 'bold', maxWidth: '380px',
            background: type === 'err' ? '#c33' : '#2a7',
            boxShadow: '0 4px 12px rgba(0,0,0,.35)',
            opacity: '0', transition: 'opacity .2s'
        });
        document.body.appendChild(t);
        requestAnimationFrame(() => t.style.opacity = '1');
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2200);
    }

    // ===== ДЕЙСТВИЯ: ФОТО / ТЕКСТ =====
    async function actionDownloadZip() {
        if (typeof JSZip === 'undefined') { alert('JSZip не загрузился.'); return; }
        const article = getArticleOrAsk();
        const folder = article.replace(/[<>:"/\\|?*]/g, '_');
        const urls = collectPhotoUrls();
        if (!urls.length) { alert('Нет фото в карусели.'); return; }
        if (!confirm(`Артикул: ${article}\nФото: ${urls.length}\nСобрать ZIP?`)) return;

        const btn = document.getElementById('tt-zip-btn');
        const oldText = btn.textContent;
        btn.disabled = true;
        const zip = new JSZip();
        const zipFolder = zip.folder(folder);
        let idx = 1, ok = 0, fail = 0;
        for (const u of urls) {
            btn.textContent = `⏳ ${idx}/${urls.length}`;
            try {
                let res = await fetch(u, { credentials: 'include' });
                if (!res.ok) throw new Error('http ' + res.status);
                const srcBlob = await res.blob();
                let outBlob;
                try { outBlob = await blobToJpg(srcBlob); } catch { outBlob = srcBlob; }
                zipFolder.file(`${folder}_${idx}.jpg`, outBlob);
                ok++;
            } catch (e) { console.warn('Ошибка', u, e); fail++; }
            idx++;
        }
        btn.textContent = '📦 Архивирую...';
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zipBlob);
        a.download = `${folder}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        btn.textContent = oldText; btn.disabled = false;
        alert(`Готово!\nВ архиве: ${ok}\nОшибок: ${fail}\nФайл: ${folder}.zip`);
    }
    async function actionCopyLinks() {
        const urls = collectPhotoUrls();
        if (!urls.length) { alert('Нет фото в карусели.'); return; }
        const joined = urls.join(';');
        const ok = await copyToClipboard(joined);
        if (ok) alert(`Скопировано: ${urls.length} ссылок\n\n${joined}`);
        else prompt('Скопируйте вручную (Ctrl+C):', joined);
    }
    async function actionCopyName() {
        const name = getProductName();
        if (!name) { toast('Название не найдено', 'err'); return; }
        const ok = await copyToClipboard(name);
        if (ok) toast(`Скопировано: ${name}`, 'ok');
        else prompt('Скопируйте вручную (Ctrl+C):', name);
    }
    async function actionCopyArticle() {
        const article = getArticle();
        if (!article) { toast('Артикул не найден', 'err'); return; }
        const ok = await copyToClipboard(article);
        if (ok) toast(`Скопировано: ${article}`, 'ok');
        else prompt('Скопируйте вручную (Ctrl+C):', article);
    }
        // ===== ПОДБОРКА =====
    const SELECTION_KEY = 'selection';

    function getSelection() { return storage.get(SELECTION_KEY, []) || []; }
    function saveSelection(arr) {
        storage.set(SELECTION_KEY, arr);
        updateSelectionBadge();
    }
    function isInSelection(id) { return getSelection().some(x => x.id === id); }

    function addToSelection() {
        const id = getProductId();
        const list = getSelection();
        if (list.some(x => x.id === id)) { toast('Уже в подборке', 'err'); return; }
        const info = getPriceInfo();
        list.push({
            id,
            name: getProductName(),
            article: getArticle() || '',
            url: getCleanUrl(),
            photo: getMainPhotoUrl() || '',
            price: info.price,
            unitQty: info.unitQty,
            unit: info.unit || '',
            addedAt: Date.now()
        });
        saveSelection(list);
        toast('Добавлено в подборку ✓', 'ok');
        updateSelectionButton();
        renderSelectionList();
    }
    function removeFromSelection(id) {
        const list = getSelection().filter(x => x.id !== id);
        saveSelection(list);
        updateSelectionButton();
        renderSelectionList();
    }
    function clearSelection() {
        if (!confirm('Очистить всю подборку?')) return;
        saveSelection([]);
        renderSelectionList();
        updateSelectionButton();
        toast('Подборка очищена', 'ok');
    }
    function formatSelectionForClipboard(list) {
        if (!list.length) return '';
        const lines = ['📋 Подборка товаров:', ''];
        list.forEach((item, i) => {
            lines.push(`${i + 1}. ${item.name}`);
            if (!isNaN(item.price)) {
                const unitTxt = item.unit ? ` за ${item.unitQty} ${item.unit}` : '';
                lines.push(`   💰 ${formatMoney(item.price)}${unitTxt}`);
            }
            if (item.article) lines.push(`   🔢 Арт.: ${item.article}`);
            lines.push(`   🔗 ${item.url}`);
            lines.push('');
        });
        lines.push('Точные цены и условия уточню после согласования.');
        return lines.join('\n');
    }
    async function actionCopySelection() {
        const list = getSelection();
        if (!list.length) { toast('Подборка пуста', 'err'); return; }
        const text = formatSelectionForClipboard(list);
        const ok = await copyToClipboard(text);
        if (ok) toast(`Скопировано: ${list.length} товаров`, 'ok');
        else prompt('Скопируйте вручную (Ctrl+C):', text);
    }

    function updateSelectionBadge() {
        const badge = document.getElementById('tt-sel-badge');
        if (!badge) return;
        const n = getSelection().length;
        badge.textContent = n;
        badge.style.display = n > 0 ? 'inline-block' : 'none';
    }
    function updateSelectionButton() {
        const btn = document.getElementById('tt-sel-add-btn');
        if (!btn) return;
        const id = getProductId();
        if (isInSelection(id)) {
            btn.textContent = '✓ В подборке (убрать)';
            btn.style.background = '#666';
            btn.onclick = () => {
                removeFromSelection(id);
                toast('Убрано из подборки', 'ok');
            };
        } else {
            btn.textContent = '➕ Добавить в подборку';
            btn.style.background = '#5a3';
            btn.onclick = addToSelection;
        }
    }
    function renderSelectionList() {
        const cont = document.getElementById('tt-sel-list');
        if (!cont) return;
        const list = getSelection();
        cont.innerHTML = '';
        if (!list.length) {
            const empty = document.createElement('div');
            empty.textContent = 'Подборка пуста';
            Object.assign(empty.style, { color: '#aaa', fontSize: '12px', textAlign: 'center', padding: '8px' });
            cont.appendChild(empty);
            return;
        }
        list.forEach((item, i) => {
            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px', background: 'rgba(255,255,255,.05)',
                borderRadius: '6px', fontSize: '12px', color: '#eee'
            });
            const num = document.createElement('div');
            num.textContent = (i + 1) + '.';
            Object.assign(num.style, { color: '#888', minWidth: '18px' });

            const info = document.createElement('div');
            Object.assign(info.style, { flex: '1', minWidth: 0, overflow: 'hidden' });

            const nm = document.createElement('a');
            nm.href = item.url; nm.target = '_blank';
            nm.textContent = item.name || 'Без названия';
            Object.assign(nm.style, {
                color: '#fff', textDecoration: 'none', display: 'block',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            });
            const pr = document.createElement('div');
            if (!isNaN(item.price)) {
                pr.textContent = formatMoney(item.price) +
                    (item.unit ? ` / ${item.unitQty} ${item.unit}` : '');
            }
            Object.assign(pr.style, { color: '#7fd1a8', fontSize: '11px' });
            info.appendChild(nm);
            if (pr.textContent) info.appendChild(pr);

            const del = document.createElement('button');
            del.textContent = '✕';
            Object.assign(del.style, {
                background: 'transparent', border: 'none', color: '#e88',
                cursor: 'pointer', fontSize: '14px', padding: '0 4px'
            });
            del.onclick = () => removeFromSelection(item.id);

            row.appendChild(num);
            row.appendChild(info);
            row.appendChild(del);
            cont.appendChild(row);
        });
    }
    function buildSelectionSection() {
        const wrap = document.createElement('div');
        Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '8px' });

        const addBtn = document.createElement('button');
        addBtn.id = 'tt-sel-add-btn';
        Object.assign(addBtn.style, {
            padding: '11px 16px', background: '#5a3', color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontSize: '14px', fontWeight: 'bold'
        });
        wrap.appendChild(addBtn);

        const list = document.createElement('div');
        list.id = 'tt-sel-list';
        Object.assign(list.style, {
            display: 'flex', flexDirection: 'column', gap: '4px',
            maxHeight: '220px', overflowY: 'auto',
            padding: '4px', background: 'rgba(0,0,0,.2)', borderRadius: '6px'
        });
        wrap.appendChild(list);

        const actions = document.createElement('div');
        Object.assign(actions.style, { display: 'flex', gap: '6px' });

        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋 Скопировать';
        Object.assign(copyBtn.style, {
            flex: '1', padding: '9px', background: '#27a', color: '#fff',
            border: 'none', borderRadius: '6px', cursor: 'pointer',
            fontSize: '13px', fontWeight: 'bold'
        });
        copyBtn.onclick = actionCopySelection;

        const clearBtn = document.createElement('button');
        clearBtn.textContent = '🗑';
        Object.assign(clearBtn.style, {
            padding: '9px 12px', background: '#933', color: '#fff',
            border: 'none', borderRadius: '6px', cursor: 'pointer',
            fontSize: '13px', fontWeight: 'bold'
        });
        clearBtn.onclick = clearSelection;

        actions.appendChild(copyBtn);
        actions.appendChild(clearBtn);
        wrap.appendChild(actions);

        return wrap;
    }

    // ===== ЗАМЕТКИ =====
    const NOTES_KEY = 'notes';

    function getAllNotes() { return storage.get(NOTES_KEY, {}) || {}; }
    function getNote(id) { return getAllNotes()[id] || ''; }
    function saveNote(id, text) {
        const all = getAllNotes();
        if (text && text.trim()) {
            all[id] = { text: text.trim(), updatedAt: Date.now() };
        } else {
            delete all[id];
        }
        storage.set(NOTES_KEY, all);
    }

    function buildNotesSection() {
        const wrap = document.createElement('div');
        Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '6px' });

        const id = getProductId();
        const existing = getNote(id);
        const initialText = existing && existing.text ? existing.text : '';

        const ta = document.createElement('textarea');
        ta.id = 'tt-note-area';
        ta.value = initialText;
        ta.placeholder = 'Заметка по этому товару...\n(автосохранение)';
        Object.assign(ta.style, {
            width: '100%', minHeight: '70px', maxHeight: '180px',
            padding: '8px', borderRadius: '6px',
            border: '1px solid rgba(255,255,255,.25)',
            background: 'rgba(0,0,0,.35)', color: '#fff',
            fontSize: '13px', fontFamily: 'inherit', resize: 'vertical',
            outline: 'none', boxSizing: 'border-box'
        });

        const status = document.createElement('div');
        Object.assign(status.style, {
            color: '#999', fontSize: '11px', textAlign: 'right',
            minHeight: '14px', transition: 'color .2s'
        });
        if (existing && existing.updatedAt) {
            const d = new Date(existing.updatedAt);
            status.textContent = 'Сохранено: ' + d.toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        }

        let saveTimer = null;
        ta.addEventListener('input', () => {
            status.textContent = '✏ Печатаю...';
            status.style.color = '#999';
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveNote(id, ta.value);
                const now = new Date();
                status.textContent = '✓ Сохранено: ' + now.toLocaleString('ru-RU', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                });
                status.style.color = '#7fd1a8';
            }, 600);
        });

        wrap.appendChild(ta);
        wrap.appendChild(status);
        return wrap;
    }
        // ===== ИНТЕРФЕЙС =====
    function injectGlobalStyles() {
        if (document.getElementById('tt-style-no-spin')) return;
        const st = document.createElement('style');
        st.id = 'tt-style-no-spin';
        st.textContent = `
            #tt-panel input[type=number]::-webkit-outer-spin-button,
            #tt-panel input[type=number]::-webkit-inner-spin-button {
                -webkit-appearance: none; margin: 0;
            }
            #tt-panel input[type=number] {
                -moz-appearance: textfield; appearance: textfield;
            }
            #tt-panel ::-webkit-scrollbar { width: 6px; }
            #tt-panel ::-webkit-scrollbar-thumb {
                background: rgba(255,255,255,.2); border-radius: 3px;
            }
        `;
        document.head.appendChild(st);
    }

    function buildCalcSection() {
        const info = getPriceInfo();
        const wrap = document.createElement('div');

        if (isNaN(info.price)) {
            const msg = document.createElement('div');
            msg.textContent = 'Цена не распознана';
            Object.assign(msg.style, { color: '#ddd', fontSize: '13px', textAlign: 'center', padding: '6px' });
            wrap.appendChild(msg);
            return wrap;
        }

        const unit = info.unit || 'ед';
        const perUnit = info.pricePerUnit;

        const infoLine = document.createElement('div');
        infoLine.innerHTML =
            `<div style="color:#ddd;font-size:14px;line-height:1.5;text-align:center;margin-bottom:10px;">
                На странице: <b style="color:#fff;font-size:15px;">${formatMoney(info.price)}</b>
                за <b style="color:#fff;font-size:15px;">${info.unitQty} ${unit}</b><br>
                = <b style="color:#7fd1a8;font-size:16px;">${formatMoney(perUnit)}</b>
                <span style="color:#bbb;">за 1 ${unit}</span>
             </div>`;
        wrap.appendChild(infoLine);

        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });

        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.step = 'any';
        input.value = info.unitQty.toString();
        Object.assign(input.style, {
            width: '90px', padding: '8px 10px', borderRadius: '6px',
            border: '1px solid rgba(255,255,255,.25)', background: 'rgba(0,0,0,.35)',
            color: '#fff', fontSize: '15px', fontWeight: 'bold', textAlign: 'right',
            outline: 'none'
        });

        const unitLbl = document.createElement('div');
        unitLbl.textContent = unit;
        Object.assign(unitLbl.style, { color: '#fff', fontSize: '14px', minWidth: '24px' });

        const eq = document.createElement('div');
        eq.textContent = '=';
        Object.assign(eq.style, { color: '#aaa', fontSize: '15px' });

        const result = document.createElement('div');
        Object.assign(result.style, {
            color: '#7fd1a8', fontSize: '16px', fontWeight: 'bold',
            flex: '1', textAlign: 'right'
        });

        const recalc = () => {
            const qty = parseFloat((input.value || '0').replace(',', '.'));
            if (isNaN(qty) || qty < 0) { result.textContent = '—'; return; }
            result.textContent = formatMoney(perUnit * qty);
        };
        input.addEventListener('input', recalc);
        recalc();

        row.appendChild(input); row.appendChild(unitLbl);
        row.appendChild(eq); row.appendChild(result);
        wrap.appendChild(row);
        return wrap;
    }

    function createPanel() {
        if (document.getElementById('tt-panel')) return;
        injectGlobalStyles();

        const panel = document.createElement('div');
        panel.id = 'tt-panel';
        Object.assign(panel.style, {
            position: 'fixed', top: '120px', right: '20px', zIndex: 999999,
            display: 'flex', flexDirection: 'column', gap: '10px',
            padding: '12px', background: 'rgba(30,30,30,.88)',
            borderRadius: '12px', backdropFilter: 'blur(6px)',
            boxShadow: '0 6px 20px rgba(0,0,0,.4)',
            fontFamily: 'system-ui, sans-serif',
            minWidth: '270px', maxWidth: '330px',
            maxHeight: 'calc(100vh - 140px)', overflowY: 'auto'
        });

        // Шапка с бейджем подборки
        const mainHeader = document.createElement('div');
        Object.assign(mainHeader.style, {
            color: '#fff', fontSize: '13px', fontWeight: 'bold',
            textAlign: 'center', cursor: 'pointer', userSelect: 'none',
            paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
        });
        const headerTxt = document.createElement('span');
        headerTxt.textContent = '🛠 Инструменты товара ▾';
        const badge = document.createElement('span');
        badge.id = 'tt-sel-badge';
        Object.assign(badge.style, {
            display: 'none', background: '#5a3', color: '#fff',
            fontSize: '11px', fontWeight: 'bold',
            padding: '1px 7px', borderRadius: '10px', minWidth: '18px', textAlign: 'center'
        });
        mainHeader.appendChild(headerTxt);
        mainHeader.appendChild(badge);

        const body = document.createElement('div');
        Object.assign(body.style, { display: 'flex', flexDirection: 'column', gap: '12px' });

        let collapsed = false;
        mainHeader.onclick = () => {
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : 'flex';
            headerTxt.textContent = collapsed
                ? '🛠 Инструменты товара ▸'
                : '🛠 Инструменты товара ▾';
        };

        const mkSection = (title, color) => {
            const section = document.createElement('div');
            Object.assign(section.style, {
                background: 'rgba(0,0,0,.25)',
                border: '1px solid rgba(255,255,255,.08)',
                borderRadius: '10px', padding: '10px 10px 12px'
            });
            const head = document.createElement('div');
            head.textContent = title;
            Object.assign(head.style, {
                color: color, fontSize: '11px', fontWeight: '700',
                letterSpacing: '.5px', textTransform: 'uppercase',
                textAlign: 'center', marginBottom: '8px', userSelect: 'none'
            });
            section.appendChild(head);
            const list = document.createElement('div');
            Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '8px' });
            section.appendChild(list);
            return { section, list };
        };

        const mkBtn = (id, text, color, onClick) => {
            const b = document.createElement('button');
            b.id = id; b.textContent = text;
            Object.assign(b.style, {
                padding: '11px 16px', background: color, color: '#fff',
                border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontSize: '14px', fontWeight: 'bold', minWidth: '210px',
                transition: 'transform .1s, filter .1s'
            });
            b.onmouseenter = () => { b.style.transform = 'scale(1.03)'; b.style.filter = 'brightness(1.1)'; };
            b.onmouseleave = () => { b.style.transform = 'scale(1)'; b.style.filter = 'none'; };
            b.onclick = onClick;
            return b;
        };

        // Секции
        const photo = mkSection('📸 Фото', '#7fd1a8');
        photo.list.appendChild(mkBtn('tt-zip-btn',  '📦 Скачать ZIP-архивом', '#2a7', actionDownloadZip));
        photo.list.appendChild(mkBtn('tt-copy-btn', '🔗 Копировать URL фото', '#27a', actionCopyLinks));

        const text = mkSection('📝 Данные товара', '#d8a3c5');
        text.list.appendChild(mkBtn('tt-name-btn', '📋 Копировать название', '#a37', actionCopyName));
        text.list.appendChild(mkBtn('tt-art-btn',  '🔢 Копировать артикул',  '#a63', actionCopyArticle));

        const calc = mkSection('🧮 Калькулятор цены', '#f0c674');
        calc.list.appendChild(buildCalcSection());

        const selection = mkSection('🧺 Подборка для клиента', '#9ed27f');
        selection.list.appendChild(buildSelectionSection());

        const notes = mkSection('📒 Заметка по товару', '#c2b3f0');
        notes.list.appendChild(buildNotesSection());

        body.appendChild(photo.section);
        body.appendChild(text.section);
        body.appendChild(calc.section);
        body.appendChild(selection.section);
        body.appendChild(notes.section);

        panel.appendChild(mainHeader);
        panel.appendChild(body);
        document.body.appendChild(panel);

        // Инициализация состояния
        updateSelectionButton();
        renderSelectionList();
        updateSelectionBadge();
    }

    function tryInit() {
        if (location.pathname.includes('/product/')) createPanel();
    }
    tryInit();
    setTimeout(tryInit, 1500);
    setTimeout(tryInit, 4000);
})();
