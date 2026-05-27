// ==UserScript==
// @name         Teremonline - Product Tools
// @namespace    teremtools
// @version      7.0
// @description  Инструменты для teremonline.ru: чистый UI, аккордеон, быстрые действия, мини-карточка
// @match        *://teremonline.ru/*
// @match        *://*.teremonline.ru/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @updateURL    https://raw.githubusercontent.com/HansEldridge/teremonline-tools/main/teremtools.user.js
// @downloadURL  https://raw.githubusercontent.com/HansEldridge/teremonline-tools/main/teremtools.user.js
// @run-at       document-end
// ==/UserScript==

console.log('[TeremTools] v7.0 запустился');

(function () {
    'use strict';

    // ===== ХРАНИЛИЩЕ =====
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

    // ===== УТИЛИТЫ =====
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
            padding: '10px 16px', borderRadius: '8px', color: '#fff',
            fontSize: '13px', fontWeight: '600', maxWidth: '360px',
            background: type === 'err' ? '#d9534f' : '#5cb85c',
            boxShadow: '0 4px 12px rgba(0,0,0,.2)',
            opacity: '0', transition: 'opacity .2s'
        });
        document.body.appendChild(t);
        requestAnimationFrame(() => t.style.opacity = '1');
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2200);
    }

    // ===== CRC32 + ZIP =====
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(uint8) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < uint8.length; i++) {
            c = CRC_TABLE[(c ^ uint8[i]) & 0xFF] ^ (c >>> 8);
        }
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function buildZip(files) {
        const enc = new TextEncoder();
        const localParts = [];
        const centralParts = [];
        let offset = 0;
        const now = new Date();
        const dosTime = ((now.getHours() & 0x1F) << 11) |
                        ((now.getMinutes() & 0x3F) << 5) |
                        ((now.getSeconds() / 2) & 0x1F);
        const dosDate = (((now.getFullYear() - 1980) & 0x7F) << 9) |
                        (((now.getMonth() + 1) & 0x0F) << 5) |
                        (now.getDate() & 0x1F);

        for (const f of files) {
            const nameBytes = enc.encode(f.name);
            const data = f.data;
            const crc = crc32(data);
            const size = data.length;
            const localHeader = new Uint8Array(30 + nameBytes.length);
            const lh = new DataView(localHeader.buffer);
            lh.setUint32(0,  0x04034b50, true);
            lh.setUint16(4,  20, true);
            lh.setUint16(6,  0, true);
            lh.setUint16(8,  0, true);
            lh.setUint16(10, dosTime, true);
            lh.setUint16(12, dosDate, true);
            lh.setUint32(14, crc, true);
            lh.setUint32(18, size, true);
            lh.setUint32(22, size, true);
            lh.setUint16(26, nameBytes.length, true);
            lh.setUint16(28, 0, true);
            localHeader.set(nameBytes, 30);
            localParts.push(localHeader);
            localParts.push(data);

            const central = new Uint8Array(46 + nameBytes.length);
            const cd = new DataView(central.buffer);
            cd.setUint32(0,  0x02014b50, true);
            cd.setUint16(4,  20, true);
            cd.setUint16(6,  20, true);
            cd.setUint16(8,  0, true);
            cd.setUint16(10, 0, true);
            cd.setUint16(12, dosTime, true);
            cd.setUint16(14, dosDate, true);
            cd.setUint32(16, crc, true);
            cd.setUint32(20, size, true);
            cd.setUint32(24, size, true);
            cd.setUint16(28, nameBytes.length, true);
            cd.setUint16(30, 0, true);
            cd.setUint16(32, 0, true);
            cd.setUint16(34, 0, true);
            cd.setUint16(36, 0, true);
            cd.setUint32(38, 0, true);
            cd.setUint32(42, offset, true);
            central.set(nameBytes, 46);
            centralParts.push(central);
            offset += localHeader.length + data.length;
        }

        const centralStart = offset;
        let centralSize = 0;
        for (const c of centralParts) centralSize += c.length;
        const eocd = new Uint8Array(22);
        const ev = new DataView(eocd.buffer);
        ev.setUint32(0,  0x06054b50, true);
        ev.setUint16(4,  0, true);
        ev.setUint16(6,  0, true);
        ev.setUint16(8,  files.length, true);
        ev.setUint16(10, files.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, centralStart, true);
        ev.setUint16(20, 0, true);
        return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
    }
    async function blobToUint8(blob) {
        const buf = await blob.arrayBuffer();
        return new Uint8Array(buf);
    }

    // ===== ДЕЙСТВИЯ =====
    async function actionDownloadZip() {
        const article = getArticleOrAsk();
        const folder = article.replace(/[<>:"/\\|?*]/g, '_');
        const urls = collectPhotoUrls();
        if (!urls.length) { alert('Нет фото в карусели.'); return; }
        if (!confirm(`Артикул: ${article}\nФото: ${urls.length}\nСобрать ZIP?`)) return;

        const statusToast = document.createElement('div');
        Object.assign(statusToast.style, {
            position: 'fixed', top: '20px', right: '20px', zIndex: 1000001,
            padding: '12px 18px', borderRadius: '8px',
            background: '#4a90e2', color: '#fff',
            fontSize: '13px', fontWeight: '600',
            boxShadow: '0 4px 12px rgba(0,0,0,.2)', minWidth: '200px'
        });
        statusToast.textContent = '⏳ Загрузка 0/' + urls.length;
        document.body.appendChild(statusToast);

        const files = [];
        let idx = 1, ok = 0;
        try {
            for (const u of urls) {
                statusToast.textContent = `⏳ Загрузка ${idx}/${urls.length}`;
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 20000);
                    const res = await fetch(u, { credentials: 'include', signal: controller.signal });
                    clearTimeout(timeout);
                    if (!res.ok) throw new Error('http ' + res.status);
                    const srcBlob = await res.blob();
                    let outBlob;
                    try { outBlob = await blobToJpg(srcBlob); }
                    catch (e) { outBlob = srcBlob; }
                    const u8 = await blobToUint8(outBlob);
                    files.push({ name: `${folder}/${folder}_${idx}.jpg`, data: u8 });
                    ok++;
                } catch (e) {
                    console.warn('[TeremTools] ZIP: ошибка фото', idx, u, e);
                }
                idx++;
            }
            if (!files.length) throw new Error('Не удалось скачать ни одного фото');

            statusToast.textContent = '📦 Собираю архив...';
            await new Promise(r => setTimeout(r, 50));
            const zipBlob = buildZip(files);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(zipBlob);
            a.download = `${folder}.zip`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            statusToast.style.background = '#5cb85c';
            statusToast.textContent = `✓ Готово: ${ok} фото`;
        } catch (e) {
            statusToast.style.background = '#d9534f';
            statusToast.textContent = '❌ ' + e.message;
            alert('Ошибка: ' + e.message);
        } finally {
            setTimeout(() => {
                statusToast.style.transition = 'opacity .3s';
                statusToast.style.opacity = '0';
                setTimeout(() => statusToast.remove(), 300);
            }, 3000);
        }
    }
    async function actionCopyLinks() {
        const urls = collectPhotoUrls();
        if (!urls.length) { alert('Нет фото в карусели.'); return; }
        const joined = urls.join(';');
        const ok = await copyToClipboard(joined);
        if (ok) toast(`Скопировано: ${urls.length} ссылок`, 'ok');
        else prompt('Скопируйте вручную:', joined);
    }
    async function actionCopyName() {
        const name = getProductName();
        if (!name) { toast('Название не найдено', 'err'); return; }
        const ok = await copyToClipboard(name);
        if (ok) toast(`Скопировано название`, 'ok');
        else prompt('Скопируйте вручную:', name);
    }
    async function actionCopyArticle() {
        const article = getArticle();
        if (!article) { toast('Артикул не найден', 'err'); return; }
        const ok = await copyToClipboard(article);
        if (ok) toast(`Скопировано: ${article}`, 'ok');
        else prompt('Скопируйте вручную:', article);
    }

    // ===== ПОДБОРКА =====
    const SELECTION_KEY = 'selection';
    function getSelection() { return storage.get(SELECTION_KEY, []) || []; }
    function saveSelection(arr) {
    storage.set(SELECTION_KEY, arr);
    updateAllBadges();
    if (typeof window._ttUpdateCounter === 'function') {
        window._ttUpdateCounter();
    }
}
    function isInSelection(id) { return getSelection().some(x => x.id === id); }
    function addToSelection() {
        const id = getProductId();
        const list = getSelection();
        if (list.some(x => x.id === id)) { toast('Уже в подборке', 'err'); return; }
        const info = getPriceInfo();
        list.push({
            id, name: getProductName(), article: getArticle() || '',
            url: getCleanUrl(), photo: getMainPhotoUrl() || '',
            price: info.price, unitQty: info.unitQty, unit: info.unit || '',
            addedAt: Date.now()
        });
        saveSelection(list);
        toast('Добавлено в подборку ✓', 'ok');
        renderSelectionList();
        updateHeaderCard();
        // авто-раскрыть подборку при первом добавлении
        if (list.length === 1) expandSection('selection');
    }
    function removeFromSelection(id) {
        saveSelection(getSelection().filter(x => x.id !== id));
        renderSelectionList();
        updateHeaderCard();
    }
    function clearSelection() {
        if (!confirm('Очистить всю подборку?')) return;
        saveSelection([]);
        renderSelectionList();
        updateHeaderCard();
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
        else prompt('Скопируйте вручную:', text);
    }

    // ===== ЗАМЕТКИ =====
    const NOTES_KEY = 'notes';
    function getAllNotes() { return storage.get(NOTES_KEY, {}) || {}; }
    function getNote(id) { return getAllNotes()[id] || ''; }
    function hasNote(id) {
        const n = getNote(id);
        return !!(n && n.text && n.text.trim());
    }
    function saveNote(id, text) {
        const all = getAllNotes();
        if (text && text.trim()) {
            all[id] = { text: text.trim(), updatedAt: Date.now() };
        } else { delete all[id]; }
        storage.set(NOTES_KEY, all);
    }

    // ===== ХАРАКТЕРИСТИКИ =====
    function parseProps() {
        const cont = document.querySelector('.catalog-product-detail__props');
        if (!cont) return [];
        const dts = cont.querySelectorAll('dt');
        const dds = cont.querySelectorAll('dd');
        const out = [];
        for (let i = 0; i < dts.length; i++) {
            const name = (dts[i].innerText || '').trim();
            const value = (dds[i]?.innerText || '').trim();
            if (name && value) out.push({ name, value });
        }
        return out;
    }
    // Видны ли характеристики прямо в карточке товара (вкладка активна)
    function arePropsVisibleOnPage() {
        const cont = document.querySelector('.catalog-product-detail__props');
        if (!cont) return false;
        const rect = cont.getBoundingClientRect();
        // Считаем "видны", если контейнер существует и имеет высоту
        return rect.height > 50;
    }

    // ===== СЕКЦИИ КОНТЕНТА =====

    function buildPropsContent() {
        const wrap = document.createElement('div');
        const props = parseProps();
        if (!props.length) {
            const msg = document.createElement('div');
            msg.textContent = 'Нет характеристик';
            Object.assign(msg.style, {
                color: '#999', fontSize: '11.5px', textAlign: 'center', padding: '4px'
            });
            wrap.appendChild(msg);
            return wrap;
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = `Поиск среди ${props.length} характеристик...`;
        Object.assign(input.style, {
            width: '100%', padding: '6px 8px', borderRadius: '5px',
            border: '1px solid #d8d8d8', background: '#fff',
            color: '#222', fontSize: '12px', outline: 'none',
            boxSizing: 'border-box', marginBottom: '6px'
        });

        const results = document.createElement('div');
        Object.assign(results.style, {
            display: 'flex', flexDirection: 'column', gap: '2px',
            maxHeight: '220px', overflowY: 'auto'
        });

        function render(filter) {
            results.innerHTML = '';
            const q = (filter || '').toLowerCase().trim();
            const list = q ? props.filter(p =>
                p.name.toLowerCase().includes(q) || p.value.toLowerCase().includes(q)) : props;
            if (!list.length) {
                const empty = document.createElement('div');
                empty.textContent = 'Ничего не найдено';
                Object.assign(empty.style, {
                    color: '#aaa', fontSize: '11px', textAlign: 'center', padding: '6px'
                });
                results.appendChild(empty);
                return;
            }
            list.forEach(p => {
                const row = document.createElement('div');
                Object.assign(row.style, {
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '5px 7px', borderRadius: '4px',
                    fontSize: '11.5px', cursor: 'pointer',
                    transition: 'background .12s'
                });
                row.onmouseenter = () => row.style.background = '#f0f5fb';
                row.onmouseleave = () => row.style.background = 'transparent';
                const nm = document.createElement('div');
                nm.textContent = p.name;
                Object.assign(nm.style, {
                    color: '#666', flex: '1', minWidth: 0,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                });
                const vl = document.createElement('div');
                vl.textContent = p.value;
                Object.assign(vl.style, {
                    color: '#222', fontWeight: '600',
                    maxWidth: '50%', textAlign: 'right',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                });
                row.title = `Клик — копировать значение\nShift+клик — копировать имя: значение`;
                row.onclick = async (e) => {
                    const text = e.shiftKey ? `${p.name}: ${p.value}` : p.value;
                    const ok = await copyToClipboard(text);
                    if (ok) toast('Скопировано: ' + text.substring(0, 40), 'ok');
                };
                row.appendChild(nm);
                row.appendChild(vl);
                results.appendChild(row);
            });
        }
        input.addEventListener('input', () => render(input.value));
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Escape') { input.value = ''; render(''); }
            else if (e.key === 'Enter') {
                const q = input.value.toLowerCase().trim();
                if (!q) return;
                const found = props.find(p =>
                    p.name.toLowerCase().includes(q) || p.value.toLowerCase().includes(q));
                if (found) {
                    const ok = await copyToClipboard(found.value);
                    if (ok) toast('Скопировано: ' + found.value, 'ok');
                }
            }
        });
        render('');
        wrap.appendChild(input);
        wrap.appendChild(results);
        return wrap;
    }

    function buildCalcContent() {
        const info = getPriceInfo();
        const wrap = document.createElement('div');
        if (isNaN(info.price)) {
            const msg = document.createElement('div');
            msg.textContent = 'Цена не распознана';
            Object.assign(msg.style, {
                color: '#999', fontSize: '12px', textAlign: 'center', padding: '4px'
            });
            wrap.appendChild(msg);
            return wrap;
        }
        const unit = info.unit || 'ед';
        const perUnit = info.pricePerUnit;
        const infoLine = document.createElement('div');
        infoLine.innerHTML =
            `<div style="color:#666;font-size:11.5px;line-height:1.5;text-align:center;margin-bottom:8px;">
                <b style="color:#222;">${formatMoney(info.price)}</b> за <b style="color:#222;">${info.unitQty} ${unit}</b>
                <span style="color:#bbb;">·</span>
                <b style="color:#2a8a2a;">${formatMoney(perUnit)}</b><span style="color:#999;"> / ${unit}</span>
             </div>`;
        wrap.appendChild(infoLine);

        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '6px', background: '#f7f9fc', borderRadius: '6px'
        });
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.step = 'any';
        input.value = info.unitQty.toString();
        Object.assign(input.style, {
            width: '70px', padding: '5px 7px', borderRadius: '5px',
            border: '1px solid #d8d8d8', background: '#fff',
            color: '#222', fontSize: '13px', fontWeight: '600', textAlign: 'right',
            outline: 'none'
        });
        const unitLbl = document.createElement('div');
        unitLbl.textContent = unit;
        Object.assign(unitLbl.style, { color: '#666', fontSize: '12px', minWidth: '22px' });
        const eq = document.createElement('div');
        eq.textContent = '=';
        Object.assign(eq.style, { color: '#bbb', fontSize: '13px' });
        const result = document.createElement('div');
        Object.assign(result.style, {
            color: '#2a8a2a', fontSize: '14px', fontWeight: 'bold',
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

    function buildSelectionContent() {
        const wrap = document.createElement('div');
        Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '6px' });

        const addBtn = document.createElement('button');
        addBtn.id = 'tt-sel-add-btn';
        addBtn.className = 'tt-btn success';
        Object.assign(addBtn.style, { textAlign: 'center' });
        wrap.appendChild(addBtn);

        const list = document.createElement('div');
        list.id = 'tt-sel-list';
        Object.assign(list.style, {
            display: 'flex', flexDirection: 'column', gap: '2px',
            maxHeight: '220px', overflowY: 'auto'
        });
        wrap.appendChild(list);

        const actions = document.createElement('div');
        Object.assign(actions.style, { display: 'flex', gap: '6px' });
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋 Скопировать список';
        copyBtn.className = 'tt-btn primary';
        copyBtn.style.flex = '1';
        copyBtn.style.textAlign = 'center';
        copyBtn.onclick = actionCopySelection;
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '🗑';
        clearBtn.className = 'tt-btn danger';
        clearBtn.style.textAlign = 'center';
        clearBtn.onclick = clearSelection;
        actions.appendChild(copyBtn);
        actions.appendChild(clearBtn);
        wrap.appendChild(actions);
        return wrap;
    }

    function renderSelectionList() {
        const cont = document.getElementById('tt-sel-list');
        if (!cont) return;
        const list = getSelection();
        cont.innerHTML = '';
        if (!list.length) {
            const empty = document.createElement('div');
            empty.textContent = 'Подборка пуста';
            Object.assign(empty.style, {
                color: '#aaa', fontSize: '11px',
                textAlign: 'center', padding: '8px'
            });
            cont.appendChild(empty);
            updateSelectionButton();
            return;
        }
        list.forEach((item, i) => {
            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 6px', borderRadius: '4px',
                fontSize: '11.5px', color: '#222',
                transition: 'background .12s'
            });
            row.onmouseenter = () => row.style.background = '#f5f5f5';
            row.onmouseleave = () => row.style.background = 'transparent';
            const num = document.createElement('div');
            num.textContent = (i + 1) + '.';
            Object.assign(num.style, { color: '#aaa', minWidth: '16px', fontSize: '11px' });
            const info = document.createElement('div');
            Object.assign(info.style, { flex: '1', minWidth: 0, overflow: 'hidden' });
            const nm = document.createElement('a');
            nm.href = item.url; nm.target = '_blank';
            nm.textContent = item.name || 'Без названия';
            Object.assign(nm.style, {
                color: '#2a5db0', textDecoration: 'none', display: 'block',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontWeight: '600'
            });
            const pr = document.createElement('div');
            if (!isNaN(item.price)) {
                pr.textContent = formatMoney(item.price) +
                    (item.unit ? ` / ${item.unitQty} ${item.unit}` : '');
            }
            Object.assign(pr.style, { color: '#2a8a2a', fontSize: '10.5px' });
            info.appendChild(nm);
            if (pr.textContent) info.appendChild(pr);
            const del = document.createElement('button');
            del.textContent = '✕';
            Object.assign(del.style, {
                background: 'transparent', border: 'none', color: '#c44',
                cursor: 'pointer', fontSize: '13px', padding: '0 4px',
                fontWeight: 'bold'
            });
            del.onclick = () => removeFromSelection(item.id);
            row.appendChild(num);
            row.appendChild(info);
            row.appendChild(del);
            cont.appendChild(row);
        });
        updateSelectionButton();
    }

    function updateSelectionButton() {
        const btn = document.getElementById('tt-sel-add-btn');
        if (!btn) return;
        const id = getProductId();
        if (isInSelection(id)) {
            btn.textContent = '✓ В подборке (убрать)';
            btn.className = 'tt-btn muted';
            btn.style.textAlign = 'center';
            btn.onclick = () => { removeFromSelection(id); toast('Убрано из подборки', 'ok'); };
        } else {
            btn.textContent = '➕ Добавить в подборку';
            btn.className = 'tt-btn success';
            btn.style.textAlign = 'center';
            btn.onclick = addToSelection;
        }
    }

    function buildNotesContent() {
        const wrap = document.createElement('div');
        Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '4px' });
        const id = getProductId();
        const existing = getNote(id);
        const initialText = existing && existing.text ? existing.text : '';
        const ta = document.createElement('textarea');
        ta.id = 'tt-note-area';
        ta.value = initialText;
        ta.placeholder = 'Заметка по этому товару...';
        Object.assign(ta.style, {
            width: '100%', minHeight: '60px', maxHeight: '180px',
            padding: '7px', borderRadius: '5px',
            border: '1px solid #d8d8d8',
            background: '#fff', color: '#222',
            fontSize: '12px', fontFamily: 'inherit', resize: 'vertical',
            outline: 'none', boxSizing: 'border-box'
        });
        const status = document.createElement('div');
        Object.assign(status.style, {
            color: '#aaa', fontSize: '10px', textAlign: 'right',
            minHeight: '12px', transition: 'color .2s'
        });
        if (existing && existing.updatedAt) {
            const d = new Date(existing.updatedAt);
            status.textContent = '✓ ' + d.toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });
        }
        let saveTimer = null;
        ta.addEventListener('input', () => {
            status.textContent = '✏ ...';
            status.style.color = '#aaa';
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveNote(id, ta.value);
                const now = new Date();
                status.textContent = '✓ ' + now.toLocaleString('ru-RU', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                });
                status.style.color = '#2a8a2a';
                updateHeaderCard();
            }, 600);
        });
        wrap.appendChild(ta);
        wrap.appendChild(status);
        return wrap;
    }

    // ===== СОСТОЯНИЕ АККОРДЕОНА =====
    const ACCORDION_KEY = 'accordionState';
    function getAccordionState() {
        return storage.get(ACCORDION_KEY, {}) || {};
    }
    function setSectionOpen(id, open) {
        const s = getAccordionState();
        s[id] = open;
        storage.set(ACCORDION_KEY, s);
    }
    function isSectionOpen(id, defaultOpen) {
        const s = getAccordionState();
        if (id in s) return s[id];
        return defaultOpen;
    }
    function expandSection(id) {
        const section = document.querySelector(`[data-tt-section="${id}"]`);
        if (!section) return;
        const body = section.querySelector('.tt-sec-body');
        const arrow = section.querySelector('.tt-sec-arrow');
        if (body && body.style.display === 'none') {
            body.style.display = 'block';
            if (arrow) arrow.textContent = '▾';
            setSectionOpen(id, true);
        }
    }

    // ===== СТИЛИ =====
    function injectGlobalStyles() {
        if (document.getElementById('tt-style-main')) return;
        const st = document.createElement('style');
        st.id = 'tt-style-main';
        st.textContent = `
            html.tt-shifted body {
                margin-right: 260px !important;
                transition: margin-right .2s ease;
            }
            html.tt-rail-mode body {
                margin-right: 48px !important;
                transition: margin-right .2s ease;
            }
            #tt-panel, #tt-rail {
                font-family: system-ui, -apple-system, sans-serif;
                color: #2b2b2b;
            }
            #tt-panel input[type=number]::-webkit-outer-spin-button,
            #tt-panel input[type=number]::-webkit-inner-spin-button {
                -webkit-appearance: none; margin: 0;
            }
            #tt-panel input[type=number] {
                -moz-appearance: textfield; appearance: textfield;
            }
            #tt-panel ::-webkit-scrollbar { width: 6px; }
            #tt-panel ::-webkit-scrollbar-thumb {
                background: #d0d0d0; border-radius: 3px;
            }
            #tt-panel ::-webkit-scrollbar-thumb:hover { background: #b0b0b0; }

            .tt-btn {
                padding: 7px 10px; border: 1px solid #d8d8d8;
                background: #fff; color: #2b2b2b;
                border-radius: 5px; cursor: pointer;
                font-size: 12.5px; font-weight: 600;
                transition: background .12s, border-color .12s;
                text-align: left; font-family: inherit;
            }
            .tt-btn:hover { background: #f5f5f5; border-color: #c0c0c0; }
            .tt-btn.primary { background: #4a90e2; border-color: #4a90e2; color: #fff; }
            .tt-btn.primary:hover { background: #3d7fcc; border-color: #3d7fcc; }
            .tt-btn.success { background: #5cb85c; border-color: #5cb85c; color: #fff; }
            .tt-btn.success:hover { background: #4ca64c; border-color: #4ca64c; }
            .tt-btn.danger { background: #fff; border-color: #e0a0a0; color: #c44; }
            .tt-btn.danger:hover { background: #fff0f0; }
            .tt-btn.muted { background: #ededed; border-color: #d8d8d8; color: #666; }

            .tt-rail-btn {
                width: 32px; height: 32px;
                display: flex; align-items: center; justify-content: center;
                background: #fff; border: 1px solid #e0e0e0;
                border-radius: 6px; cursor: pointer;
                font-size: 15px; position: relative;
                transition: background .12s, border-color .12s;
                font-family: inherit; padding: 0;
            }
            .tt-rail-btn:hover {
                background: #f0f5fb; border-color: #4a90e2;
            }

            /* Быстрые действия — иконки в шапке */
            .tt-quick-btn {
                width: 32px; height: 32px;
                display: flex; align-items: center; justify-content: center;
                background: #fff; border: 1px solid #e0e0e0;
                border-radius: 5px; cursor: pointer;
                font-size: 14px; transition: background .12s, border-color .12s;
                padding: 0; font-family: inherit;
                flex: 1; min-width: 0;
            }
            .tt-quick-btn:hover {
                background: #f0f5fb; border-color: #4a90e2;
            }
            .tt-quick-btn:disabled {
                opacity: .4; cursor: not-allowed;
            }

            /* Секции аккордеона */
            .tt-section {
                border-bottom: 1px solid #eee;
            }
            .tt-section:last-child { border-bottom: none; }
            .tt-sec-head {
                display: flex; align-items: center; justify-content: space-between;
                padding: 8px 4px; cursor: pointer; user-select: none;
                transition: background .12s;
            }
            .tt-sec-head:hover { background: #fafafa; }
            .tt-sec-title {
                font-size: 12px; font-weight: 600; color: #333;
                display: flex; align-items: center; gap: 6px;
            }
            .tt-sec-arrow {
                color: #aaa; font-size: 10px; transition: transform .15s;
            }
            .tt-sec-counter {
                background: #5cb85c; color: #fff;
                font-size: 10px; font-weight: bold;
                padding: 1px 6px; border-radius: 8px;
                min-width: 16px; text-align: center; line-height: 1.3;
            }
            .tt-sec-body {
                padding: 4px 4px 10px 4px;
            }

            /* Мини-карточка товара */
            .tt-mini-card {
                padding: 8px 10px;
                background: #f7f9fc;
                border-radius: 6px;
                margin-bottom: 8px;
                border-left: 3px solid #4a90e2;
            }
            .tt-mini-name {
                font-size: 11.5px; font-weight: 600; color: #222;
                line-height: 1.3;
                display: -webkit-box; -webkit-line-clamp: 2;
                -webkit-box-orient: vertical; overflow: hidden;
                margin-bottom: 3px;
            }
            .tt-mini-meta {
                font-size: 10.5px; color: #777;
                display: flex; align-items: center; gap: 6px;
                flex-wrap: wrap;
            }
            .tt-mini-meta b { color: #2a8a2a; font-size: 11px; }
        `;
        document.head.appendChild(st);
    }

    // ===== ШАПКА: мини-карточка =====
    function updateHeaderCard() {
        const card = document.getElementById('tt-mini-card');
        if (!card) return;
        const isProduct = location.pathname.includes('/product/');
        if (!isProduct) {
            card.style.display = 'none';
            return;
        }
        card.style.display = 'block';
        const name = getProductName();
        const article = getArticle();
        const info = getPriceInfo();
        const selCount = getSelection().length;
        const noteFlag = hasNote(getProductId()) ? '📒' : '';
        const inSel = isInSelection(getProductId()) ? '✓' : '';

        const nameEl = card.querySelector('.tt-mini-name');
        const metaEl = card.querySelector('.tt-mini-meta');
        if (nameEl) nameEl.textContent = name || 'Товар';
        if (metaEl) {
            const parts = [];
            if (article) parts.push(`<span>${article}</span>`);
            if (!isNaN(info.price)) parts.push(`<b>${formatMoney(info.price)}</b>`);
            if (inSel) parts.push(`<span style="color:#5cb85c;">${inSel} в подборке</span>`);
                        if (noteFlag) parts.push(`<span title="Есть заметка">${noteFlag}</span>`);
            metaEl.innerHTML = parts.join('<span style="color:#ccc;">·</span>');
        }

        // Обновляем счётчик подборки в шапке
        const headerCounter = document.getElementById('tt-header-sel-count');
        if (headerCounter) {
            headerCounter.textContent = selCount;
            headerCounter.style.display = selCount > 0 ? 'inline-block' : 'none';
        }
    }

    function updateAllBadges() {
        // Rail-режим: значок на иконке подборки
        const railBadge = document.getElementById('tt-rail-badge');
        if (railBadge) {
            const n = getSelection().length;
            railBadge.textContent = n;
            railBadge.style.display = n > 0 ? 'inline-block' : 'none';
        }
        updateHeaderCard();
    }

    // ===== ПОСТРОЕНИЕ СЕКЦИИ АККОРДЕОНА =====
    function buildSection(id, icon, title, contentBuilder, opts = {}) {
        const section = document.createElement('div');
        section.className = 'tt-section';
        section.dataset.ttSection = id;

        const head = document.createElement('div');
        head.className = 'tt-sec-head';

        const titleEl = document.createElement('div');
        titleEl.className = 'tt-sec-title';
        const titleText = document.createElement('span');
        titleText.textContent = `${icon} ${title}`;
        titleEl.appendChild(titleText);

        // Опциональный счётчик (для подборки)
        if (opts.counter) {
            const counter = document.createElement('span');
            counter.className = 'tt-sec-counter';
            counter.id = `tt-sec-counter-${id}`;
            counter.style.display = 'none';
            titleEl.appendChild(counter);
        }

        const arrow = document.createElement('span');
        arrow.className = 'tt-sec-arrow';
        arrow.textContent = '▾';

        head.appendChild(titleEl);
        head.appendChild(arrow);

        const body = document.createElement('div');
        body.className = 'tt-sec-body';

        // Ленивая инициализация контента
        let contentBuilt = false;
        const buildContent = () => {
            if (contentBuilt) return;
            const content = contentBuilder();
            body.appendChild(content);
            contentBuilt = true;
        };

        const setOpen = (open) => {
            if (open) {
                buildContent();
                body.style.display = 'block';
                arrow.textContent = '▾';
            } else {
                body.style.display = 'none';
                arrow.textContent = '▸';
            }
            setSectionOpen(id, open);
        };

        const defaultOpen = opts.defaultOpen !== false;
        const initialOpen = isSectionOpen(id, defaultOpen);
        setOpen(initialOpen);

        head.onclick = () => {
            const isOpen = body.style.display !== 'none';
            setOpen(!isOpen);
        };

        section.appendChild(head);
        section.appendChild(body);
        return section;
    }

    function updateSectionCounter(id, value) {
        const counter = document.getElementById(`tt-sec-counter-${id}`);
        if (!counter) return;
        if (value > 0) {
            counter.textContent = value;
            counter.style.display = 'inline-block';
        } else {
            counter.style.display = 'none';
        }
    }

    // ===== ПАНЕЛЬ =====
    let showPanel, hidePanel;

    function createPanel() {
        if (document.getElementById('tt-panel') || document.getElementById('tt-rail')) return;
        injectGlobalStyles();

        const isProduct = location.pathname.includes('/product/');

        // ----- RAIL -----
        const rail = document.createElement('div');
        rail.id = 'tt-rail';
        Object.assign(rail.style, {
            position: 'fixed', top: '0', right: '0', bottom: '0',
            zIndex: 999999, width: '48px',
            display: 'flex', flexDirection: 'column', gap: '6px',
            padding: '10px 8px', background: '#fff',
            boxShadow: '-2px 0 8px rgba(0,0,0,.06)',
            borderLeft: '1px solid #e8e8e8',
            alignItems: 'center'
        });

        const mkRailBtn = (icon, title, onClick) => {
            const b = document.createElement('button');
            b.className = 'tt-rail-btn';
            b.textContent = icon;
            b.title = title;
            b.onclick = onClick;
            return b;
        };

        const expandBtn = mkRailBtn('◀', 'Развернуть панель', () => showPanel());
        rail.appendChild(expandBtn);

        const sep = document.createElement('div');
        Object.assign(sep.style, {
            width: '20px', height: '1px', background: '#e0e0e0', margin: '3px 0'
        });
        rail.appendChild(sep);

        if (isProduct) {
            rail.appendChild(mkRailBtn('📦', 'Скачать ZIP фото', actionDownloadZip));
            rail.appendChild(mkRailBtn('🔗', 'Копировать URL фото', actionCopyLinks));
            rail.appendChild(mkRailBtn('📋', 'Копировать название', actionCopyName));
            rail.appendChild(mkRailBtn('🔢', 'Копировать артикул', actionCopyArticle));
        }

        const selBtn = mkRailBtn('🧺', 'Подборка', () => showPanel());
        const railBadge = document.createElement('span');
        railBadge.id = 'tt-rail-badge';
        Object.assign(railBadge.style, {
            position: 'absolute', top: '-3px', right: '-3px',
            background: '#5cb85c', color: '#fff',
            fontSize: '9px', fontWeight: 'bold',
            padding: '1px 4px', borderRadius: '8px',
            minWidth: '14px', textAlign: 'center', display: 'none',
            border: '2px solid #fff', lineHeight: '1.2'
        });
        selBtn.appendChild(railBadge);
        rail.appendChild(selBtn);

        document.body.appendChild(rail);

        // ----- ПАНЕЛЬ -----
        const panel = document.createElement('div');
        panel.id = 'tt-panel';
        Object.assign(panel.style, {
            position: 'fixed', top: '0', right: '0', bottom: '0',
            zIndex: 999999, width: '260px',
            display: 'none', flexDirection: 'column',
            background: '#fff',
            boxShadow: '-2px 0 12px rgba(0,0,0,.08)',
            borderLeft: '1px solid #e8e8e8'
        });

        // ----- Шапка -----
        const header = document.createElement('div');
        Object.assign(header.style, {
            padding: '10px 12px 8px',
            borderBottom: '1px solid #eee',
            background: '#fff',
            position: 'sticky', top: '0', zIndex: 2
        });

        const headerTop = document.createElement('div');
        Object.assign(headerTop.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: isProduct ? '8px' : '0'
        });

        const headerTitle = document.createElement('div');
        Object.assign(headerTitle.style, {
            fontSize: '12.5px', fontWeight: '700', color: '#333',
            display: 'flex', alignItems: 'center', gap: '6px'
        });
        const titleSpan = document.createElement('span');
        titleSpan.textContent = '🛠 Tools';
        headerTitle.appendChild(titleSpan);

        const headerSelCount = document.createElement('span');
        headerSelCount.id = 'tt-header-sel-count';
        Object.assign(headerSelCount.style, {
            display: 'none', background: '#5cb85c', color: '#fff',
            fontSize: '10px', fontWeight: 'bold',
            padding: '1px 6px', borderRadius: '8px',
            minWidth: '14px', textAlign: 'center'
        });
        headerTitle.appendChild(headerSelCount);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '▶';
        closeBtn.title = 'Свернуть';
        Object.assign(closeBtn.style, {
            background: 'transparent', border: '1px solid #e0e0e0',
            color: '#888', fontSize: '10px', cursor: 'pointer',
            borderRadius: '4px', padding: '3px 8px',
            fontWeight: 'bold', fontFamily: 'inherit'
        });
        closeBtn.onmouseenter = () => closeBtn.style.background = '#f5f5f5';
        closeBtn.onmouseleave = () => closeBtn.style.background = 'transparent';
        closeBtn.onclick = () => hidePanel();

        headerTop.appendChild(headerTitle);
        headerTop.appendChild(closeBtn);
        header.appendChild(headerTop);

        // Мини-карточка товара (только на страницах товара)
        if (isProduct) {
            const miniCard = document.createElement('div');
            miniCard.id = 'tt-mini-card';
            miniCard.className = 'tt-mini-card';
            const miniName = document.createElement('div');
            miniName.className = 'tt-mini-name';
            const miniMeta = document.createElement('div');
            miniMeta.className = 'tt-mini-meta';
            miniCard.appendChild(miniName);
            miniCard.appendChild(miniMeta);
            header.appendChild(miniCard);

            // Быстрые действия — иконки в строку
            const quickRow = document.createElement('div');
            Object.assign(quickRow.style, {
                display: 'flex', gap: '4px', marginTop: '8px'
            });
            const mkQuickBtn = (icon, title, onClick) => {
                const b = document.createElement('button');
                b.className = 'tt-quick-btn';
                b.textContent = icon;
                b.title = title;
                b.onclick = onClick;
                return b;
            };
            quickRow.appendChild(mkQuickBtn('📦', 'Скачать ZIP фото', actionDownloadZip));
            quickRow.appendChild(mkQuickBtn('🔗', 'Копировать URL фото', actionCopyLinks));
            quickRow.appendChild(mkQuickBtn('📋', 'Копировать название', actionCopyName));
            quickRow.appendChild(mkQuickBtn('🔢', 'Копировать артикул', actionCopyArticle));
            quickRow.appendChild(mkQuickBtn('➕', 'В подборку', addToSelection));
            header.appendChild(quickRow);
        }

        panel.appendChild(header);

        // ----- Контейнер секций -----
        const body = document.createElement('div');
        Object.assign(body.style, {
            flex: '1', overflowY: 'auto', padding: '4px 10px 12px'
        });

        if (isProduct) {
            // 🔎 Характеристики — свёрнуты, если уже видны на странице
            const propsAvailable = parseProps().length > 0;
            if (propsAvailable) {
                body.appendChild(buildSection(
                    'props', '🔎', 'Характеристики',
                    buildPropsContent,
                    { defaultOpen: !arePropsVisibleOnPage() }
                ));
            }

            // 🧮 Калькулятор — открыт, если цена за >1 единицы
            const info = getPriceInfo();
            const calcAvailable = !isNaN(info.price);
            if (calcAvailable) {
                body.appendChild(buildSection(
                    'calc', '🧮', 'Калькулятор',
                    buildCalcContent,
                    { defaultOpen: info.unitQty > 1 }
                ));
            }
        }

        // 🧺 Подборка — всегда есть, открыта если не пуста
        const selList = getSelection();
        body.appendChild(buildSection(
            'selection', '🧺', 'Подборка',
            buildSelectionContent,
            { defaultOpen: selList.length > 0, counter: true }
        ));

        // 📒 Заметка — только на товаре
        if (isProduct) {
            const noteOpen = hasNote(getProductId());
            body.appendChild(buildSection(
                'notes', '📒', 'Заметка',
                buildNotesContent,
                { defaultOpen: noteOpen }
            ));
        }

        panel.appendChild(body);
        document.body.appendChild(panel);

        // ----- Переключение rail / panel -----
        showPanel = function () {
            rail.style.display = 'none';
            panel.style.display = 'flex';
            document.documentElement.classList.remove('tt-rail-mode');
            document.documentElement.classList.add('tt-shifted');
            storage.set('panelExpanded', true);
            updateHeaderCard();
            renderSelectionList();
            updateSelectionCounter('selection', getSelection().length);
        };
        hidePanel = function () {
            panel.style.display = 'none';
            rail.style.display = 'flex';
            document.documentElement.classList.remove('tt-shifted');
            document.documentElement.classList.add('tt-rail-mode');
            storage.set('panelExpanded', false);
        };

        // Восстановление состояния
        const wasExpanded = storage.get('panelExpanded', true);
        if (wasExpanded) showPanel();
        else hidePanel();

        // Подписки на обновления счётчика подборки
        const origUpdateAllBadges = updateAllBadges;
        // Перехват, чтобы обновлять и счётчик в секции
        window._ttUpdateCounter = () => {
            updateSectionCounter('selection', getSelection().length);
        };

        updateHeaderCard();
        renderSelectionList();
        updateAllBadges();
        updateSectionCounter('selection', getSelection().length);
    }

        // Расширяем updateAllBadges, чтобы он обновлял и счётчик в секции
    const _origUpdateAllBadges = updateAllBadges;
    // переопределяем через свойство объекта, чтобы обойти strict mode
    // (function declaration нельзя переприсваивать в strict)
    const updateAllBadgesWrapper = function () {
        _origUpdateAllBadges();
        if (typeof window._ttUpdateCounter === 'function') {
            window._ttUpdateCounter();
        }
    };
    // Подменяем все вызовы через прокси
    window._ttUpdateAllBadges = updateAllBadgesWrapper;

    // ===== ЗАПУСК =====
    function tryInit() {
        createPanel();
    }
    tryInit();
    setTimeout(tryInit, 1500);
    setTimeout(tryInit, 4000);
})();
