// ==UserScript==
// @name         Teremonline - Product Tools
// @namespace    teremtools
// @version      5.5
// @description  Инструменты для страниц товаров teremonline.ru: фото, данные, калькулятор цены
// @match        *://teremonline.ru/*
// @match        *://*.teremonline.ru/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @updateURL    https://raw.githubusercontent.com/HansEldridge/teremonline-tools/main/teremtools.user.js
// @downloadURL  https://raw.githubusercontent.com/HansEldridge/teremonline-tools/main/teremtools.user.js
// @run-at       document-end
// ==/UserScript==

console.log('[TeremTools] v5.5 запустился');

(function () {
    'use strict';

    // ===== ОБЩИЕ ФУНКЦИИ =====

    function getArticle() {
        const bodyText = document.body.innerText;
        const m = bodyText.match(/Арт[\.\s]*:?\s*([A-Za-z0-9][A-Za-z0-9\-_]*)/i);
        if (m) return m[1].trim();
        return null;
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
        title = title.replace(/\s*[\|\-–—]\s*Teremonline.*$/i, '').trim();
        return title || '';
    }

    // ---- Парсинг цены и единицы ----

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
        const priceMatch = bodyText.match(/цена\s*:?\s*([\d\s.,]+)\s*руб/i);
        if (priceMatch) price = parseNumber(priceMatch[1]);

        let unitQty = 1;
        let unitRaw = null;
        const unitMatch = bodyText.match(/\/\s*за\s+([\d\s.,]+)?\s*([а-яa-zё²³.]+)/i);
        if (unitMatch) {
            if (unitMatch[1] && unitMatch[1].trim()) {
                const q = parseNumber(unitMatch[1]);
                if (!isNaN(q) && q > 0) unitQty = q;
            }
            unitRaw = unitMatch[2];
        }

        const unit = normalizeUnit(unitRaw);

        let pricePerUnit = NaN;
        if (!isNaN(price) && unitQty > 0) {
            pricePerUnit = price / unitQty;
        }

        return { price, unitQty, unit, pricePerUnit };
    }

    function formatMoney(n) {
        if (isNaN(n)) return '—';
        const fixed = (Math.round(n * 100) / 100);
        const s = (Math.abs(fixed - Math.round(fixed)) < 0.005)
            ? Math.round(fixed).toString()
            : fixed.toFixed(2);
        return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
    }

    // ---- Фото ----

    function findMainImage() {
        const imgs = Array.from(document.querySelectorAll('img'));
        let best = null;
        for (const img of imgs) {
            const w = img.naturalWidth, h = img.naturalHeight;
            if (!w || !h) continue;
            if (w < 300 || h < 300) continue;
            if (Math.abs(w / h - 1) > 0.1) continue;
            const rect = img.getBoundingClientRect();
            const top = rect.top + window.scrollY;
            if (top > 1500) continue;
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
        try { return new URL(url, location.href).href; }
        catch { return url; }
    }
    function collectPhotoUrls() {
        const mainImg = findMainImage();
        if (!mainImg) return [];
        const container = findCarouselContainer(mainImg);
        const imgs = Array.from(container.querySelectorAll('img'));
        return [...new Set(
            imgs
                .filter(img => {
                    const w = img.naturalWidth, h = img.naturalHeight;
                    return w >= 200 && h >= 200 && Math.abs(w / h - 1) < 0.1;
                })
                .map(img => img.currentSrc || img.src)
                .filter(Boolean)
                .map(u => toAbsolute(upscaleUrl(u)))
        )];
    }
    function blobToJpg(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
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
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
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

    // ===== ДЕЙСТВИЯ =====

    async function actionDownloadZip() {
        if (typeof JSZip === 'undefined') {
            alert('JSZip не загрузился. Проверь интернет/настройки Tampermonkey.');
            return;
        }
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
                try { outBlob = await blobToJpg(srcBlob); }
                catch (e) { outBlob = srcBlob; }
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
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);

        btn.textContent = oldText;
        btn.disabled = false;
        alert(`Готово!\nВ архиве: ${ok}\nОшибок: ${fail}\nФайл: ${folder}.zip`);
    }

    async function actionCopyLinks() {
        const urls = collectPhotoUrls();
        if (!urls.length) { alert('Нет фото в карусели.'); return; }
        const joined = urls.join(';');
        const ok = await copyToClipboard(joined);
        if (ok) alert(`Скопировано в буфер: ${urls.length} ссылок\n\n${joined}`);
        else prompt('Не удалось скопировать автоматически. Скопируйте вручную (Ctrl+C):', joined);
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

    // ===== ИНТЕРФЕЙС =====

    function injectGlobalStyles() {
        if (document.getElementById('tt-style-no-spin')) return;
        const st = document.createElement('style');
        st.id = 'tt-style-no-spin';
        st.textContent = `
            #tt-panel input[type=number]::-webkit-outer-spin-button,
            #tt-panel input[type=number]::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
            #tt-panel input[type=number] {
                -moz-appearance: textfield;
                appearance: textfield;
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

        // Информационная строка (увеличенная)
        const infoLine = document.createElement('div');
        infoLine.innerHTML =
            `<div style="color:#ddd;font-size:14px;line-height:1.5;text-align:center;margin-bottom:10px;">
                На странице: <b style="color:#fff;font-size:15px;">${formatMoney(info.price)}</b>
                за <b style="color:#fff;font-size:15px;">${info.unitQty} ${unit}</b><br>
                = <b style="color:#7fd1a8;font-size:16px;">${formatMoney(perUnit)}</b>
                <span style="color:#bbb;">за 1 ${unit}</span>
             </div>`;
        wrap.appendChild(infoLine);

        // Поле ввода + результат
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = 'any';
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

        row.appendChild(input);
        row.appendChild(unitLbl);
        row.appendChild(eq);
        row.appendChild(result);

        wrap.appendChild(row);
        return wrap;
    }

    function createPanel() {
        if (document.getElementById('tt-panel')) return;
        injectGlobalStyles();

        const panel = document.createElement('div');
        panel.id = 'tt-panel';
        Object.assign(panel.style, {
            position: 'fixed', top: '160px', right: '20px', zIndex: 999999,
            display: 'flex', flexDirection: 'column', gap: '10px',
            padding: '12px', background: 'rgba(30,30,30,.85)',
            borderRadius: '12px', backdropFilter: 'blur(6px)',
            boxShadow: '0 6px 20px rgba(0,0,0,.4)',
            fontFamily: 'system-ui, sans-serif', minWidth: '260px', maxWidth: '320px'
        });

        const mainHeader = document.createElement('div');
        mainHeader.textContent = '🛠 Инструменты товара ▾';
        Object.assign(mainHeader.style, {
            color: '#fff', fontSize: '13px', fontWeight: 'bold',
            textAlign: 'center', cursor: 'pointer', userSelect: 'none',
            paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,.2)'
        });

        const body = document.createElement('div');
        Object.assign(body.style, { display: 'flex', flexDirection: 'column', gap: '12px' });

        let collapsed = false;
        mainHeader.onclick = () => {
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : 'flex';
            mainHeader.textContent = collapsed ? '🛠 Инструменты товара ▸' : '🛠 Инструменты товара ▾';
        };

        const mkSection = (title, color) => {
            const section = document.createElement('div');
            Object.assign(section.style, {
                background: 'rgba(0,0,0,.25)',
                border: '1px solid rgba(255,255,255,.08)',
                borderRadius: '10px',
                padding: '10px 10px 12px'
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
            b.id = id;
            b.textContent = text;
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

        // Секция: Фото
        const photo = mkSection('📸 Фото', '#7fd1a8');
        photo.list.appendChild(mkBtn('tt-zip-btn',  '📦 Скачать ZIP-архивом', '#2a7', actionDownloadZip));
        photo.list.appendChild(mkBtn('tt-copy-btn', '🔗 Копировать URL фото',  '#27a', actionCopyLinks));

        // Секция: Данные товара
        const text = mkSection('📝 Данные товара', '#d8a3c5');
        text.list.appendChild(mkBtn('tt-name-btn', '📋 Копировать название', '#a37', actionCopyName));
        text.list.appendChild(mkBtn('tt-art-btn',  '🔢 Копировать артикул',  '#a63', actionCopyArticle));

        // Секция: Калькулятор
        const calc = mkSection('🧮 Калькулятор цены', '#f0c674');
        calc.list.appendChild(buildCalcSection());

        body.appendChild(photo.section);
        body.appendChild(text.section);
        body.appendChild(calc.section);

        panel.appendChild(mainHeader);
        panel.appendChild(body);
        document.body.appendChild(panel);
    }

    function tryInit() {
        if (location.pathname.includes('/product/')) createPanel();
    }
    tryInit();
    setTimeout(tryInit, 1500);
    setTimeout(tryInit, 4000);
})();
