// ==UserScript==
// @name         Teremonline - Product Tools
// @namespace    teremtools
// @version      9.5
// @description  Инструменты для teremonline.ru: панель, подборка, каталог-режим, ресайз, экспорт, темы (ООП)
// @match        *://teremonline.ru/*
// @match        *://*.teremonline.ru/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';
    console.log('[TeremTools] v9.5 (OOP) запустился');

    /* ============================================================
     * Store — обёртка над хранилищем (GM / localStorage)
     * ========================================================== */
    class Store {
        get(key, def) {
            try {
                if (typeof GM_getValue === 'function') {
                    const v = GM_getValue(key, null);
                    if (v != null) return typeof v === 'string' ? JSON.parse(v) : v;
                    return def;
                }
            } catch {}
            try {
                const raw = localStorage.getItem('tt_' + key);
                return raw ? JSON.parse(raw) : def;
            } catch { return def; }
        }
        set(key, val) {
            const json = JSON.stringify(val);
            try { if (typeof GM_setValue === 'function') return GM_setValue(key, json); } catch {}
            try { localStorage.setItem('tt_' + key, json); } catch {}
        }
    }

    /* ============================================================
     * Page — извлечение данных со страницы товара/каталога
     * ========================================================== */
        /* ============================================================
     * Page — извлечение данных со страницы товара/каталога
     * ========================================================== */
    class Page {
        static isProduct(doc = document) {
            const path = doc === document ? location.pathname : (doc._ttPath || '');
            return path.includes('/product/');
        }
        static cleanUrl(url = location.href) {
            try { const u = new URL(url); return u.origin + u.pathname; }
            catch { return location.origin + location.pathname; }
        }
        static id(doc = document, url) {
            return Page.article(doc) || (url ? new URL(url).pathname : location.pathname);
        }

                        static article(doc = document) {
            const text = doc.body.innerText;
            // артикул после "Арт:" — может содержать пробелы, /, ", -
            const m = text.match(/Арт[\.\s]*:?\s*([A-Za-z0-9][A-Za-z0-9\-_\/" ]*?)\s*(?:\n|$|копировать|Код товара|Бренд)/i);
            if (m) {
                let art = m[1].trim().replace(/\s{2,}/g, ' ').replace(/копировать$/i, '').trim();
                if (art && art.length <= 40) return art;
            }
            const m2 = text.match(/Арт[\.\s]*:?\s*([A-Za-z0-9][A-Za-z0-9\-_\/"]*)/i);
            return m2 ? m2[1].trim() : null;
        }
        static articleOrAsk() {
            return Page.article() || prompt('Артикул не найден. Введи вручную:', 'product') || 'product';
        }
        static name(doc = document) {
            const h1 = doc.querySelector('h1');
            if (h1 && h1.innerText.trim()) return h1.innerText.trim();
            const title = doc === document ? document.title : (doc._ttTitle || '');
            return (title || '').replace(/\s*[\|\-–—]\s*Teremonline.*$/i, '').trim();
        }

        static normalizeUnit(raw) {
            if (!raw) return null;
            const u = raw.toLowerCase().replace(/\s+/g, '').replace('.', '');
            if (/^м2$|^м²$|^кв\.?м$|^квм$/.test(u)) return 'м²';
            if (/^м3$|^м³$|^куб\.?м$|^кубм$/.test(u)) return 'м³';
            if (/^мп$|^пм$|^пог\.?м$|^погм$|^м$/.test(u)) return 'м';
            if (/^шт$|^штук$|^штука$/.test(u)) return 'шт';
            if (/^кг$|^килограмм/.test(u)) return 'кг';
            if (/^г$|^грамм/.test(u)) return 'г';
            if (/^л$|^литр/.test(u)) return 'л';
            if (/^уп$|^упак/.test(u)) return 'уп';
            return raw.trim();
        }
        static parseNumber(s) {
            if (!s) return NaN;
            const m = s.replace(/\s|&nbsp;/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
            return m ? parseFloat(m[0]) : NaN;
        }
        static priceInfo(doc = document) {
            const t = doc.body.innerText;
            let price = NaN;
            const pm = t.match(/цена\s*:?\s*([\d\s.,]+)\s*руб/i);
            if (pm) price = Page.parseNumber(pm[1]);
            let unitQty = 1, unitRaw = null;
            const um = t.match(/\/\s*за\s+([\d\s.,]+)?\s*([а-яa-zё²³.]+)/i);
            if (um) {
                if (um[1] && um[1].trim()) {
                    const q = Page.parseNumber(um[1]);
                    if (!isNaN(q) && q > 0) unitQty = q;
                }
                unitRaw = um[2];
            }
            const unit = Page.normalizeUnit(unitRaw);
            const pricePerUnit = (!isNaN(price) && unitQty > 0) ? price / unitQty : NaN;
            return { price, unitQty, unit, pricePerUnit };
        }

        static parseProps(doc = document) {
            const cont = doc.querySelector('.catalog-product-detail__props');
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
                static vendorCode(doc = document) {
            const props = Page.parseProps(doc);
            // ищем по типичным названиям характеристики
            const re = /(артикул\s*производ|код\s*производ|артикул\s*бренда|vendor|производ.*артикул)/i;
            for (const p of props) {
                if (re.test(p.name)) {
                    const v = (p.value || '').trim();
                    if (v) return v;
                }
            }
            // запасной вариант — просто "Артикул" в характеристиках
            for (const p of props) {
                if (/^артикул$/i.test(p.name.trim())) {
                    const v = (p.value || '').trim();
                    if (v) return v;
                }
            }
            return null;
        }
        static propsVisible() {
            const cont = document.querySelector('.catalog-product-detail__props');
            return cont ? cont.getBoundingClientRect().height > 50 : false;
        }

        static toAbsolute(url, base = location.href) {
            try { return new URL(url, base).href; } catch { return url; }
        }
        static upscale(url) {
            return url.replace(/(_|\/|-)(\d{2,4})x(\d{2,4})(?=[._\/])/g, (m, s) => `${s}1600x1600`);
        }
        static findMainImage() {
            let best = null;
            for (const img of document.querySelectorAll('img')) {
                const w = img.naturalWidth, h = img.naturalHeight;
                if (!w || !h || w < 300 || h < 300 || Math.abs(w / h - 1) > 0.1) continue;
                if (img.getBoundingClientRect().top + scrollY > 1500) continue;
                if (!best || w > best.naturalWidth) best = img;
            }
            return best;
        }
        static collectPhotos(doc = document, base = location.href) {
            const res = [], seen = new Set();
            const push = (url) => {
                if (!url) return;
                const abs = Page.toAbsolute(url, base);
                let key = abs;
                try { const u = new URL(abs); key = u.origin + u.pathname; } catch {}
                if (seen.has(key)) return;
                seen.add(key); res.push(abs);
            };
            const links = doc.querySelectorAll('a[data-fancybox*="gallery"][data-src]');
            for (const a of links) {
                if (a.closest('.splide__slide--clone')) continue;
                push(a.getAttribute('data-src'));
            }
            if (res.length) return res;

            const mainList = doc.querySelector('#slider-product-main-list, #slider-product-main');
            if (mainList) {
                for (const slide of mainList.querySelectorAll('li.splide__slide:not(.splide__slide--clone)')) {
                    const a = slide.querySelector('a[data-src]');
                    if (a) { push(a.getAttribute('data-src')); continue; }
                    const img = slide.querySelector('img');
                    if (img) push(Page.upscale(img.getAttribute('data-src') || img.src));
                }
                if (res.length) return res;
            }
            // для удалённого документа naturalWidth недоступен — берём первое подходящее фото
            if (doc !== document) {
                const img = doc.querySelector('.catalog-product-detail img, img[itemprop="image"], .product img');
                if (img) push(Page.upscale(img.getAttribute('data-src') || img.getAttribute('src')));
                return res;
            }
            const main = Page.findMainImage();
            if (main) push(Page.upscale(main.currentSrc || main.src));
            return res;
        }
        static mainPhoto(doc = document, base = location.href) {
            return Page.collectPhotos(doc, base)[0] || null;
        }
    }
    /* ============================================================
 * Fetcher — поиск через скрытый iframe (JS-рендеринг DigiSearch)
 * ========================================================== */
class Fetcher {
    static async loadDoc(url) {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc._ttPath = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
        doc._ttTitle = doc.querySelector('title')?.textContent || '';
        return doc;
    }

    // Грузим URL поиска в скрытый iframe и ждём появления карточек товара
    static loadInIframe(url, { timeout = 20000, ready } = {}) {
        return new Promise((resolve, reject) => {
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1200px;height:1400px;opacity:0;pointer-events:none;border:0;';
            let done = false;
            let poll = null;
            const cleanup = () => {
                if (poll) clearInterval(poll);
                if (iframe.parentNode) iframe.remove();
            };
            const finish = (doc) => { if (done) return; done = true; cleanup(); resolve(doc); };
            const fail = (e) => { if (done) return; done = true; cleanup(); reject(e); };

            const to = setTimeout(() => {
                // по таймауту — отдаём что есть (вдруг отрендерилось без сигнала)
                try { finish(iframe.contentDocument); } catch (e) { fail(new Error('timeout')); }
            }, timeout);

            iframe.addEventListener('load', () => {
                let doc;
                try { doc = iframe.contentDocument; }
                catch (e) { clearTimeout(to); return fail(new Error('cross-origin iframe')); }
                if (!doc) { clearTimeout(to); return fail(new Error('no iframe doc')); }

                // ждём, пока JS отрендерит результаты
                poll = setInterval(() => {
                    try {
                        if (ready(doc)) { clearTimeout(to); finish(doc); }
                    } catch (e) { /* still loading */ }
                }, 300);
            });

            iframe.src = url;
            document.body.appendChild(iframe);
        });
    }

    // Ссылка на товар по расширенному артикулу
    static async findProductUrl(query) {
        const q = encodeURIComponent(query.trim());
        const searchUrl = `${location.origin}/?digiSearch=true&term=${q}&params=%7Csort%3DDEFAULT`;

        const doc = await Fetcher.loadInIframe(searchUrl, {
            timeout: 20000,
            ready: (d) => !!Fetcher.extractFromDoc(d)
        });

        const link = Fetcher.extractFromDoc(doc);
        if (!link) throw new Error('Товар не найден в результатах');
        return Page.toAbsolute(link, searchUrl);
    }

    // Достаём ссылку на товар из отрендеренного результата поиска
    static extractFromDoc(doc) {
        const selectors = [
            '.catalog-section .catalog-item a[href*="/product/"]',
            '.catalog-item a[href*="/product/"]',
            '.product-item a[href*="/product/"]',
            '.digi-product a[href*="/product/"]',
            'a.catalog-item__name[href*="/product/"]',
            'a[href*="/product/"]'
        ];
        for (const sel of selectors) {
            const list = doc.querySelectorAll(sel);
            for (const a of list) {
                const href = a.getAttribute('href');
                // отсекаем шапку/футер/рекомендации
                if (href && href.includes('/product/') && !a.closest('header, footer, .header, .footer')) {
                    return href;
                }
            }
        }
        return null;
    }

    // Полный цикл: артикул -> данные товара
    static async getProductByArticle(query) {
        const url = await Fetcher.findProductUrl(query);
        if (!url) throw new Error('Товар не найден');

        const doc = await Fetcher.loadDoc(url);
        const info = Page.priceInfo(doc);
                return {
            id: Page.article(doc) || new URL(url).pathname.split('/').filter(Boolean).pop(),
            name: Page.name(doc),
            article: Page.article(doc) || '',
            vendorCode: Page.vendorCode(doc) || '',
            url: Page.cleanUrl(url),
            photo: Page.mainPhoto(doc, url) || '',
            price: info.price,
            unitQty: info.unitQty,
            unit: info.unit || '',
            props: Page.parseProps(doc),
            addedAt: Date.now()
        };
    }
        // Массовый поиск: принимает строку с артикулами (через пробел/перенос/запятую)
    // onProgress(current, total, article, status) — колбэк для UI
    static async getProductsBatch(rawText, onProgress) {
        const articles = Fetcher.parseArticles(rawText);
        const results = { ok: [], failed: [] };

        for (let i = 0; i < articles.length; i++) {
            const art = articles[i];
            onProgress?.(i + 1, articles.length, art, 'searching');
            try {
                const product = await Fetcher.getProductByArticle(art);
                results.ok.push(product);
                onProgress?.(i + 1, articles.length, art, 'ok');
            } catch (e) {
                results.failed.push({ article: art, error: e.message });
                onProgress?.(i + 1, articles.length, art, 'fail');
            }
        }
        return results;
    }

    // Разбор строки на массив артикулов (пробел, перенос, запятая, табуляция, ;)
    static parseArticles(text) {
        return (text || '')
            .split(/[\s,;]+/)
            .map(s => s.trim())
            .filter(Boolean)
            // убираем дубли, сохраняя порядок
            .filter((v, i, arr) => arr.indexOf(v) === i);
    }
}
    /* ============================================================
     * Utils — общие функции (деньги, toast, clipboard, скачивание)
     * ========================================================== */
    const Utils = {
        money(n) {
            if (isNaN(n)) return '—';
            const f = Math.round(n * 100) / 100;
            const s = Math.abs(f - Math.round(f)) < 0.005 ? Math.round(f).toString() : f.toFixed(2);
            return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
        },
        async copy(text) {
            try { await navigator.clipboard.writeText(text); return true; }
            catch {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
                document.body.appendChild(ta); ta.select();
                const ok = document.execCommand('copy'); ta.remove(); return ok;
            }
        },
        toast(msg, type) {
            const t = document.createElement('div');
            t.className = 'tt-toast ' + (type === 'err' ? 'err' : 'ok');
            t.textContent = msg;
            document.body.appendChild(t);
            requestAnimationFrame(() => t.classList.add('show'));
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
        },
        download(blob, name) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        },
        blobToJpg(blob) {
            return new Promise((resolve, reject) => {
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth; c.height = img.naturalHeight;
                    const ctx = c.getContext('2d');
                    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
                    ctx.drawImage(img, 0, 0);
                    c.toBlob(b => { URL.revokeObjectURL(url); b ? resolve(b) : reject(); }, 'image/jpeg', 0.95);
                };
                img.onerror = () => { URL.revokeObjectURL(url); reject(); };
                img.src = url;
            });
        },
        async blobToU8(blob) { return new Uint8Array(await blob.arrayBuffer()); }
    };

    /* ============================================================
     * Zip — генерация ZIP-архива (store-метод, без сжатия)
     * ========================================================== */
    const Zip = (() => {
        const CRC = (() => {
            const t = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[n] = c >>> 0;
            }
            return t;
        })();
        const crc32 = (u8) => {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
            return (c ^ 0xFFFFFFFF) >>> 0;
        };
        const build = (files) => {
            const enc = new TextEncoder(), local = [], central = [];
            let offset = 0;
            const now = new Date();
            const dt = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
            const dd = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
            for (const f of files) {
                const nb = enc.encode(f.name), data = f.data, crc = crc32(data), size = data.length;
                const lh = new Uint8Array(30 + nb.length), lv = new DataView(lh.buffer);
                lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
                lv.setUint16(10, dt, true); lv.setUint16(12, dd, true);
                lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true);
                lv.setUint16(26, nb.length, true); lh.set(nb, 30);
                local.push(lh, data);
                const ch = new Uint8Array(46 + nb.length), cv = new DataView(ch.buffer);
                cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
                cv.setUint16(12, dt, true); cv.setUint16(14, dd, true);
                cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
                cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true); ch.set(nb, 46);
                central.push(ch);
                offset += lh.length + data.length;
            }
            let cSize = 0; for (const c of central) cSize += c.length;
            const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
            ev.setUint32(0, 0x06054b50, true);
            ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
            ev.setUint32(12, cSize, true); ev.setUint32(16, offset, true);
            return new Blob([...local, ...central, eocd], { type: 'application/zip' });
        };
        return { build };
    })();

    /* ============================================================
     * Actions — действия (скачать ZIP, копировать и т.п.)
     * ========================================================== */
    const Actions = {
        async downloadZip() {
            const article = Page.articleOrAsk();
            const folder = article.replace(/[<>:"/\\|?*]/g, '_');
            const urls = Page.collectPhotos();
            if (!urls.length) return alert('Нет фото в карусели.');
            if (!confirm(`Артикул: ${article}\nФото: ${urls.length}\nСобрать ZIP?`)) return;

            const st = document.createElement('div');
            st.className = 'tt-toast progress';
            st.textContent = `⏳ Загрузка 0/${urls.length}`;
            document.body.appendChild(st);
            st.classList.add('show');

            const files = []; let idx = 1, ok = 0;
            try {
                for (const u of urls) {
                    st.textContent = `⏳ Загрузка ${idx}/${urls.length}`;
                    try {
                        const ctrl = new AbortController();
                        const to = setTimeout(() => ctrl.abort(), 20000);
                        const res = await fetch(u, { credentials: 'include', signal: ctrl.signal });
                        clearTimeout(to);
                        if (!res.ok) throw 0;
                        const src = await res.blob();
                        let out; try { out = await Utils.blobToJpg(src); } catch { out = src; }
                        files.push({ name: `${folder}/${folder}_${idx}.jpg`, data: await Utils.blobToU8(out) });
                        ok++;
                    } catch (e) { console.warn('[TeremTools] фото', idx, e); }
                    idx++;
                }
                if (!files.length) throw new Error('Не удалось скачать фото');
                st.textContent = '📦 Собираю архив...';
                await new Promise(r => setTimeout(r, 50));
                Utils.download(Zip.build(files), `${folder}.zip`);
                st.className = 'tt-toast ok show';
                st.textContent = `✓ Готово: ${ok} фото`;
            } catch (e) {
                st.className = 'tt-toast err show';
                st.textContent = '❌ ' + e.message;
            } finally {
                setTimeout(() => { st.classList.remove('show'); setTimeout(() => st.remove(), 300); }, 3000);
            }
        },
                async downloadSelectionZip(list) {
            if (!list || !list.length) return Utils.toast('Подборка пуста', 'err');

            const st = document.createElement('div');
            st.className = 'tt-toast progress show';
            st.textContent = '⏳ Подготовка...';
            document.body.appendChild(st);

            const files = [];
            const usedNames = {};
            let okItems = 0, totalPhotos = 0;

            try {
                for (let i = 0; i < list.length; i++) {
                    const item = list[i];
                    // имя папки: артикул производителя -> расширенный -> id
                    let folderBase = (item.vendorCode || item.article || item.id || 'product')
                        .replace(/[<>:"/\\|?*]/g, '_').trim();
                    if (!folderBase) folderBase = 'product';
                    // защита от дублей имён папок
                    if (usedNames[folderBase] != null) {
                        usedNames[folderBase]++;
                        folderBase = `${folderBase}_${usedNames[folderBase]}`;
                    } else {
                        usedNames[folderBase] = 0;
                    }

                    st.textContent = `⏳ Товар ${i + 1}/${list.length}: ${folderBase}`;

                    // загружаем страницу товара и собираем фото
                    let urls = [];
                    try {
                        const doc = await Fetcher.loadDoc(item.url);
                        urls = Page.collectPhotos(doc, item.url);
                    } catch (e) {
                        console.warn('[TeremTools] не удалось открыть', item.url, e);
                    }
                    if (!urls.length && item.photo) urls = [item.photo];
                    if (!urls.length) continue;

                    let idx = 1;
                    for (const u of urls) {
                        st.textContent = `⏳ ${i + 1}/${list.length} · ${folderBase} · фото ${idx}/${urls.length}`;
                        try {
                            const ctrl = new AbortController();
                            const to = setTimeout(() => ctrl.abort(), 20000);
                            const res = await fetch(u, { credentials: 'include', signal: ctrl.signal });
                            clearTimeout(to);
                            if (!res.ok) throw 0;
                            const src = await res.blob();
                            let out; try { out = await Utils.blobToJpg(src); } catch { out = src; }
                            files.push({ name: `${folderBase}/${folderBase}_${idx}.jpg`, data: await Utils.blobToU8(out) });
                            totalPhotos++;
                        } catch (e) {
                            console.warn('[TeremTools] фото', u, e);
                        }
                        idx++;
                    }
                    okItems++;
                }

                if (!files.length) throw new Error('Не удалось скачать ни одного фото');
                st.textContent = '📦 Собираю архив...';
                await new Promise(r => setTimeout(r, 50));
                Utils.download(Zip.build(files), `selection_photos_${Date.now()}.zip`);
                st.className = 'tt-toast ok show';
                st.textContent = `✓ Готово: ${totalPhotos} фото из ${okItems} товаров`;
            } catch (e) {
                st.className = 'tt-toast err show';
                st.textContent = '❌ ' + e.message;
            } finally {
                setTimeout(() => { st.classList.remove('show'); setTimeout(() => st.remove(), 300); }, 3500);
            }
        },
        async copyLinks() {
            const urls = Page.collectPhotos();
            if (!urls.length) return alert('Нет фото в карусели.');
            const j = urls.join(';');
            (await Utils.copy(j)) ? Utils.toast(`Скопировано: ${urls.length} ссылок`) : prompt('Вручную:', j);
        },
        async copyName() {
            const n = Page.name();
            if (!n) return Utils.toast('Название не найдено', 'err');
            (await Utils.copy(n)) ? Utils.toast('Скопировано название') : prompt('Вручную:', n);
        },
        async copyArticle() {
            const a = Page.article();
            if (!a) return Utils.toast('Артикул не найден', 'err');
            (await Utils.copy(a)) ? Utils.toast(`Скопировано: ${a}`) : prompt('Вручную:', a);
        }
    };

    /* ============================================================
     * Selection — модель подборки товаров
     * ========================================================== */
    class Selection {
        constructor(store) { this.store = store; this.KEY = 'selection'; this.listeners = []; }
        onChange(fn) { this.listeners.push(fn); }
        emit() { this.listeners.forEach(fn => fn(this.all())); }
        all() { return this.store.get(this.KEY, []) || []; }
        save(arr) { this.store.set(this.KEY, arr); this.emit(); }
        has(id) { return this.all().some(x => x.id === id); }

        addCurrent() {
            const id = Page.id();
            if (this.has(id)) return Utils.toast('Уже в подборке', 'err');
            const info = Page.priceInfo();
            const list = this.all();
                        list.push({
                id, name: Page.name(), article: Page.article() || '',
                vendorCode: Page.vendorCode() || '',
                url: Page.cleanUrl(), photo: Page.mainPhoto() || '',
                price: info.price, unitQty: info.unitQty, unit: info.unit || '', addedAt: Date.now()
            });
            this.save(list);
            Utils.toast('Добавлено в подборку ✓');
        }
        addRaw(item) {
            if (this.has(item.id)) return;
            const list = this.all(); list.push(item); this.save(list);
        }
        remove(id) { this.save(this.all().filter(x => x.id !== id)); }
        clear() {
            if (!this.all().length || !confirm('Очистить всю подборку?')) return;
            this.save([]); Utils.toast('Подборка очищена');
        }
        toggle(item) {
            this.has(item.id) ? this.remove(item.id) : this.addRaw(item);
        }

        formatText() {
            const list = this.all();
            if (!list.length) return '';
            const lines = ['📋 Подборка товаров:', ''];
            list.forEach((it, i) => {
                lines.push(`${i + 1}. ${it.name}`);
                if (!isNaN(it.price)) {
                    const u = it.unit ? ` за ${it.unitQty} ${it.unit}` : '';
                    lines.push(`   💰 ${Utils.money(it.price)}${u}`);
                }
                if (it.article) lines.push(`   🔢 Арт.: ${it.article}`);
                lines.push(`   🔗 ${it.url}`, '');
            });
            lines.push('Точные цены и условия уточню после согласования.');
            return lines.join('\n');
        }
        async copyText() {
            const list = this.all();
            if (!list.length) return Utils.toast('Подборка пуста', 'err');
            const t = this.formatText();
            (await Utils.copy(t)) ? Utils.toast(`Скопировано: ${list.length} товаров`) : prompt('Вручную:', t);
        }
        exportCSV() {
            const list = this.all();
            if (!list.length) return Utils.toast('Подборка пуста', 'err');
            const h = ['№', 'Название', 'Артикул', 'Цена', 'За кол-во', 'Ед.', 'URL'];
            const rows = list.map((it, i) => [i + 1, it.name || '', it.article || '',
                isNaN(it.price) ? '' : it.price, it.unitQty || '', it.unit || '', it.url || '']);
            const esc = v => { const s = String(v).replace(/"/g, '""'); return /[",;\n]/.test(s) ? `"${s}"` : s; };
            const csv = '\uFEFF' + [h, ...rows].map(r => r.map(esc).join(';')).join('\r\n');
            Utils.download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `selection_${Date.now()}.csv`);
            Utils.toast('CSV скачан ✓');
        }
        exportJSON() {
            const list = this.all();
            if (!list.length) return Utils.toast('Подборка пуста', 'err');
            Utils.download(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }), `selection_${Date.now()}.json`);
            Utils.toast('JSON скачан ✓');
        }
        exportTXT() {
            const list = this.all();
            if (!list.length) return Utils.toast('Подборка пуста', 'err');
            Utils.download(new Blob([list.map(it => it.url).join('\n')], { type: 'text/plain;charset=utf-8' }), `selection_links_${Date.now()}.txt`);
            Utils.toast('TXT скачан ✓');
        }
    }

    /* ============================================================
     * Notes — заметки по товарам
     * ========================================================== */
    class Notes {
        constructor(store) { this.store = store; this.KEY = 'notes'; }
        all() { return this.store.get(this.KEY, {}) || {}; }
        get(id) { return this.all()[id] || null; }
        has(id) { const n = this.get(id); return !!(n && n.text && n.text.trim()); }
        save(id, text) {
            const all = this.all();
            if (text && text.trim()) all[id] = { text: text.trim(), updatedAt: Date.now() };
            else delete all[id];
            this.store.set(this.KEY, all);
        }
    }

    /* ============================================================
     * Theme — управление темой (light/dark)
     * ========================================================== */
    class Theme {
        constructor(store) {
            this.store = store;
            this.current = store.get('theme', 'light');
        }
        apply() {
            const root = document.getElementById('tt-panel');
            const rail = document.getElementById('tt-rail');
            [root, rail].forEach(el => el && el.setAttribute('data-tt-theme', this.current));
        }
        toggle() {
            this.current = this.current === 'light' ? 'dark' : 'light';
            this.store.set('theme', this.current);
            this.apply();
            return this.current;
        }
    }

    /* ============================================================
     * Styles — единая система стилей с темами через CSS-переменные
     * ========================================================== */
    class Styles {
        static inject() {
            if (document.getElementById('tt-style')) return;
            const st = document.createElement('style');
            st.id = 'tt-style';
                        st.textContent = `
            /* ===== Темы (CSS-переменные) ===== */
            [data-tt-theme="light"] {
                --bg: #ffffff;          --bg-soft: #f4f6fa;     --bg-soft2: #eef1f6;
                --border: #e3e6ec;      --border-strong: #cfd4dd;
                --text: #1c1f26;        --text-soft: #5a6070;   --text-mute: #9aa0ad;
                --accent: #4a7dff;      --accent-hover: #3a6bef;
                --success: #2eaa54;     --success-hover: #259047;
                --danger: #e0524a;      --danger-soft: #fdeceb;
                --shadow: 0 8px 30px rgba(20,30,60,.12);
                --green: #2eaa54;       --link: #2a5db0;
            }
            [data-tt-theme="dark"] {
                --bg: #1c1f26;          --bg-soft: #262a33;     --bg-soft2: #2f343f;
                --border: #353a45;      --border-strong: #454b58;
                --text: #e8eaef;        --text-soft: #a8aebc;   --text-mute: #6b7280;
                --accent: #5b8bff;      --accent-hover: #6f9bff;
                --success: #3dc06a;     --success-hover: #4cd079;
                --danger: #ff6b62;      --danger-soft: #3a2826;
                --shadow: 0 8px 30px rgba(0,0,0,.5);
                --green: #4cd079;       --link: #7fa9ff;
            }

            /* ===== Сдвиг страницы ===== */
            html.tt-shifted body {
                margin-right: var(--tt-panel-w, 320px) !important;
                transition: margin-right .25s ease;
            }
            html.tt-rail-mode body { margin-right: 56px !important; transition: margin-right .25s ease; }
            html.tt-resizing body { transition: none !important; }
            html.tt-resizing { user-select: none; cursor: ew-resize; }

            /* ===== Базовые ===== */
            #tt-panel, #tt-rail {
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
                color: var(--text);
                box-sizing: border-box;
            }
            #tt-panel *, #tt-rail * { box-sizing: border-box; }
            #tt-panel ::-webkit-scrollbar { width: 8px; }
            #tt-panel ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
            #tt-panel input[type=number]::-webkit-outer-spin-button,
            #tt-panel input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            #tt-panel input[type=number] { -moz-appearance: textfield; }

            /* ===== RAIL ===== */
            #tt-rail {
                position: fixed; top: 0; right: 0; bottom: 0; z-index: 999999;
                width: 56px; display: flex; flex-direction: column; gap: 8px;
                padding: 12px 10px; background: var(--bg);
                border-left: 1px solid var(--border);
                box-shadow: -4px 0 16px rgba(0,0,0,.08); align-items: center;
            }
            .tt-rail-btn {
                width: 36px; height: 36px; display: flex; align-items: center;
                justify-content: center; background: var(--bg-soft);
                border: 1px solid var(--border); border-radius: 10px;
                cursor: pointer; font-size: 17px; position: relative;
                transition: all .15s; padding: 0; color: var(--text);
            }
            .tt-rail-btn:hover { background: var(--accent); border-color: var(--accent); transform: translateY(-1px); }
            .tt-rail-sep { width: 22px; height: 1px; background: var(--border); margin: 4px 0; }
            #tt-rail-badge {
                position: absolute; top: -5px; right: -5px;
                background: var(--success); color: #fff; font-size: 10px;
                font-weight: 700; padding: 2px 5px; border-radius: 10px;
                min-width: 16px; text-align: center; display: none;
                border: 2px solid var(--bg); line-height: 1.2;
            }

            /* ===== ПАНЕЛЬ ===== */
            #tt-panel {
                position: fixed; top: 0; right: 0; bottom: 0; z-index: 999999;
                display: none; flex-direction: column; background: var(--bg);
                border-left: 1px solid var(--border); box-shadow: var(--shadow);
            }
            #tt-resizer {
                position: absolute; top: 0; left: -4px; width: 8px; height: 100%;
                cursor: ew-resize; z-index: 5; background: transparent; transition: background .15s;
            }
            #tt-resizer:hover, #tt-resizer.tt-active { background: rgba(74,125,255,.4); }

            /* ===== Шапка ===== */
            .tt-header {
                padding: 14px 16px 12px; border-bottom: 1px solid var(--border);
                background: var(--bg); position: sticky; top: 0; z-index: 2;
            }
            .tt-header-top {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
            }
            .tt-title {
                font-size: 16px; font-weight: 800; color: var(--text);
                display: flex; align-items: center; gap: 8px; letter-spacing: .3px;
            }
            .tt-title-badge {
                display: none; background: var(--success); color: #fff;
                font-size: 11px; font-weight: 700; padding: 2px 8px;
                border-radius: 10px; min-width: 18px; text-align: center;
            }
            .tt-icon-btn {
                background: var(--bg-soft); border: 1px solid var(--border);
                color: var(--text-soft); font-size: 14px; cursor: pointer;
                border-radius: 8px; padding: 6px 9px; transition: all .15s;
                display: flex; align-items: center; justify-content: center;
            }
            .tt-icon-btn:hover { background: var(--accent); border-color: var(--accent); color: #fff; }

            /* ===== Мини-карточка товара ===== */
            .tt-mini-card {
                padding: 11px 13px; background: var(--bg-soft); border-radius: 12px;
                margin-top: 12px; border-left: 4px solid var(--accent);
            }
            .tt-mini-name {
                font-size: 14px; font-weight: 700; color: var(--text); line-height: 1.35;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                overflow: hidden; margin-bottom: 5px;
            }
            .tt-mini-meta {
                font-size: 12px; color: var(--text-soft); display: flex;
                align-items: center; gap: 7px; flex-wrap: wrap;
            }
            .tt-mini-meta b { color: var(--green); font-size: 13px; }
            .tt-mini-meta .sep { color: var(--text-mute); }

            /* ===== Быстрые кнопки ===== */
            .tt-quick-row { display: flex; gap: 6px; margin-top: 10px; }
            .tt-quick-btn {
                flex: 1; height: 38px; display: flex; align-items: center; justify-content: center;
                background: var(--bg-soft); border: 1px solid var(--border);
                border-radius: 10px; cursor: pointer; font-size: 17px;
                transition: all .15s; color: var(--text); min-width: 0;
            }
            .tt-quick-btn:hover { background: var(--accent); border-color: var(--accent); color: #fff; }

            /* ===== Тело панели ===== */
            .tt-body { flex: 1; overflow-y: auto; padding: 10px 12px 16px; }

            /* ===== Секции (карточки) ===== */
            .tt-section {
                background: var(--bg-soft); border: 1px solid var(--border);
                border-radius: 14px; margin-bottom: 12px; overflow: hidden;
            }
            .tt-sec-head {
                display: flex; align-items: center; justify-content: space-between;
                padding: 13px 15px; cursor: pointer; user-select: none; transition: background .12s;
            }
            .tt-sec-head:hover { background: var(--bg-soft2); }
            .tt-sec-title {
                font-size: 14px; font-weight: 700; color: var(--text);
                display: flex; align-items: center; gap: 9px;
            }
            .tt-sec-arrow { color: var(--text-mute); font-size: 12px; transition: transform .2s; }
            .tt-sec-counter {
                background: var(--success); color: #fff; font-size: 11px; font-weight: 700;
                padding: 2px 8px; border-radius: 10px; min-width: 18px; text-align: center;
            }
            .tt-sec-body { padding: 4px 13px 14px; }

            /* ===== Кнопки ===== */
            .tt-btn {
                padding: 10px 13px; border: 1px solid var(--border); background: var(--bg);
                color: var(--text); border-radius: 10px; cursor: pointer;
                font-size: 13.5px; font-weight: 600; transition: all .15s;
                font-family: inherit;
            }
            .tt-btn:hover { background: var(--bg-soft2); border-color: var(--border-strong); }
            .tt-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
            .tt-btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
            .tt-btn.success { background: var(--success); border-color: var(--success); color: #fff; }
            .tt-btn.success:hover { background: var(--success-hover); border-color: var(--success-hover); }
            .tt-btn.danger { background: var(--bg); border-color: var(--border); color: var(--danger); }
            .tt-btn.danger:hover { background: var(--danger-soft); border-color: var(--danger); }
            .tt-btn.muted { background: var(--bg-soft2); border-color: var(--border); color: var(--text-soft); }

            /* ===== Инпуты ===== */
            .tt-input {
                width: 100%; padding: 10px 12px; border-radius: 10px;
                border: 1px solid var(--border); background: var(--bg);
                color: var(--text); font-size: 13.5px; outline: none;
                font-family: inherit; transition: border-color .15s;
            }
            .tt-input:focus { border-color: var(--accent); }
            .tt-input::placeholder { color: var(--text-mute); }

            /* ===== Список характеристик ===== */
            .tt-props-list { display: flex; flex-direction: column; gap: 3px; max-height: 260px; overflow-y: auto; margin-top: 8px; }
            .tt-prop-row {
                display: flex; align-items: center; gap: 8px; padding: 8px 10px;
                border-radius: 8px; font-size: 13px; cursor: pointer; transition: background .12s;
            }
            .tt-prop-row:hover { background: var(--bg2, var(--bg)); }
            .tt-prop-name { color: var(--text-soft); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .tt-prop-val { color: var(--text); font-weight: 700; max-width: 50%; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

            /* ===== Калькулятор ===== */
            .tt-calc-info {
                color: var(--text-soft); font-size: 13px; line-height: 1.5;
                text-align: center; margin-bottom: 10px;
            }
            .tt-calc-info b { color: var(--text); }
            .tt-calc-info .per { color: var(--green); font-weight: 700; }
            .tt-calc-row {
                display: flex; align-items: center; gap: 9px; padding: 10px;
                background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
            }
            .tt-calc-input {
                width: 80px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
                background: var(--bg-soft); color: var(--text); font-size: 15px;
                font-weight: 700; text-align: right; outline: none;
            }
            .tt-calc-input:focus { border-color: var(--accent); }
            .tt-calc-result { color: var(--green); font-size: 17px; font-weight: 800; flex: 1; text-align: right; }

            /* ===== Список подборки ===== */
            .tt-list { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; }
            .tt-list-row {
                display: flex; align-items: center; gap: 8px; padding: 9px 10px;
                border-radius: 9px; font-size: 13px; transition: background .12s; background: var(--bg);
            }
            .tt-list-row:hover { background: var(--bg-soft2); }
            .tt-list-num { color: var(--text-mute); min-width: 20px; font-size: 12px; }
            .tt-list-info { flex: 1; min-width: 0; overflow: hidden; }
            .tt-list-name {
                color: var(--link); text-decoration: none; display: block; font-weight: 700;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px;
            }
            .tt-list-name:hover { text-decoration: underline; }
            .tt-list-price { color: var(--green); font-size: 12px; margin-top: 2px; }
            .tt-list-del {
                background: transparent; border: none; color: var(--danger);
                cursor: pointer; font-size: 16px; padding: 0 6px; font-weight: 700; border-radius: 6px;
            }
            .tt-list-del:hover { background: var(--danger-soft); }
            .tt-empty { color: var(--text-mute); font-size: 13px; text-align: center; padding: 14px; }

            /* ===== Действия подборки ===== */
            .tt-sel-actions { display: flex; gap: 7px; margin-top: 10px; }
            .tt-export-wrap { position: relative; display: flex; }
            .tt-export-menu {
                position: absolute; bottom: calc(100% + 6px); right: 0;
                background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
                box-shadow: var(--shadow); padding: 5px; display: none; z-index: 100;
                min-width: 170px; flex-direction: column; gap: 3px;
            }
            .tt-export-item {
                background: transparent; border: none; padding: 9px 12px; text-align: left;
                font-size: 13px; cursor: pointer; border-radius: 8px; color: var(--text); font-family: inherit;
            }
            .tt-export-item:hover { background: var(--bg-soft2); }

            /* ===== Заметка ===== */
            .tt-note-area {
                width: 100%; min-height: 80px; max-height: 200px; padding: 11px;
                border-radius: 10px; border: 1px solid var(--border); background: var(--bg);
                color: var(--text); font-size: 13.5px; font-family: inherit;
                resize: vertical; outline: none; line-height: 1.5;
            }
            .tt-note-area:focus { border-color: var(--accent); }
            .tt-note-status { color: var(--text-mute); font-size: 11px; text-align: right; min-height: 14px; margin-top: 4px; transition: color .2s; }
            .tt-note-status.saved { color: var(--green); }

            /* ===== Toast ===== */
            .tt-toast {
                position: fixed; top: 24px; right: 24px; z-index: 1000001;
                padding: 13px 18px; border-radius: 12px; color: #fff;
                font-size: 14px; font-weight: 600; max-width: 380px;
                box-shadow: 0 8px 24px rgba(0,0,0,.25); opacity: 0;
                transform: translateY(-8px); transition: all .25s; font-family: system-ui, sans-serif;
            }
            .tt-toast.show { opacity: 1; transform: translateY(0); }
            .tt-toast.ok { background: #2eaa54; }
            .tt-toast.err { background: #e0524a; }
            .tt-toast.progress { background: #4a7dff; min-width: 220px; }

            /* ===== Каталог-чекбоксы ===== */
            .tt-catalog-cb {
                position: absolute; top: 10px; left: 10px; width: 28px; height: 28px;
                background: rgba(255,255,255,.96); border: 2px solid #c0c0c0; border-radius: 8px;
                display: flex; align-items: center; justify-content: center;
                font-size: 16px; font-weight: 700; color: #fff; cursor: pointer; z-index: 100;
                box-shadow: 0 2px 8px rgba(0,0,0,.18); transition: all .15s; user-select: none;
            }
            .tt-catalog-cb:hover { border-color: #4a7dff; transform: scale(1.12); }
            .tt-catalog-cb.tt-cb-checked { background: #2eaa54; border-color: #2eaa54; }

            /* ===== Каталог-тулбар ===== */
            #tt-cat-toolbar {
                position: fixed; bottom: 24px; left: 24px; z-index: 999998;
                display: none; align-items: center; gap: 10px; background: #fff;
                padding: 11px 16px; border-radius: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.18);
                border: 1px solid #e3e6ec; font-size: 13px; color: #1c1f26;
                font-family: system-ui, sans-serif;
            }
            #tt-cat-toolbar b { color: #2eaa54; }
            `;
            document.head.appendChild(st);
        }
    }

    /* ============================================================
     * Section — переиспользуемая сворачиваемая секция (аккордеон)
     * ========================================================== */
    class Section {
        constructor(id, icon, title, contentBuilder, opts = {}) {
            this.id = id; this.opts = opts; this.built = false;
            this.contentBuilder = contentBuilder;

            const sec = document.createElement('div');
            sec.className = 'tt-section'; sec.dataset.ttSection = id;

            const head = document.createElement('div');
            head.className = 'tt-sec-head';

            const titleEl = document.createElement('div');
            titleEl.className = 'tt-sec-title';
            titleEl.innerHTML = `<span>${icon}</span><span>${title}</span>`;

            if (opts.counter) {
                this.counter = document.createElement('span');
                this.counter.className = 'tt-sec-counter';
                this.counter.id = `tt-counter-${id}`;
                this.counter.style.display = 'none';
                titleEl.appendChild(this.counter);
            }

            this.arrow = document.createElement('span');
            this.arrow.className = 'tt-sec-arrow';
            this.arrow.textContent = '▾';

            head.append(titleEl, this.arrow);

            this.body = document.createElement('div');
            this.body.className = 'tt-sec-body';

            head.onclick = () => this.setOpen(this.body.style.display === 'none');

            sec.append(head, this.body);
            this.el = sec;
        }
        setOpen(open) {
            if (open) {
                if (!this.built) { this.body.appendChild(this.contentBuilder()); this.built = true; }
                this.body.style.display = 'block';
                this.arrow.textContent = '▾';
            } else {
                this.body.style.display = 'none';
                this.arrow.textContent = '▸';
            }
            App.accordion.set(this.id, open);
        }
        init() { this.setOpen(App.accordion.get(this.id, this.opts.defaultOpen !== false)); }
        expand() { if (this.body.style.display === 'none') this.setOpen(true); }
        setCounter(v) {
            if (!this.counter) return;
            this.counter.textContent = v;
            this.counter.style.display = v > 0 ? 'inline-block' : 'none';
        }
    }
        /* ============================================================
     * Accordion — состояние раскрытых секций
     * ========================================================== */
    class Accordion {
        constructor(store) { this.store = store; this.KEY = 'accordionState'; }
        all() { return this.store.get(this.KEY, {}) || {}; }
        set(id, open) { const s = this.all(); s[id] = open; this.store.set(this.KEY, s); }
        get(id, def) { const s = this.all(); return id in s ? s[id] : def; }
    }

    /* ============================================================
     * Panel — главная боковая панель (UI)
     * ========================================================== */
    class Panel {
        constructor(app) {
            this.app = app;
            this.sel = app.selection;
            this.notes = app.notes;
            this.theme = app.theme;
            this.isProduct = Page.isProduct();
            this.sections = {};
            this.WMIN = 280; this.WMAX = 640; this.WDEF = 320;
        }

        /* --- ширина / ресайз --- */
        width() {
            const n = parseInt(this.app.store.get('panelWidth', this.WDEF), 10);
            return isNaN(n) ? this.WDEF : Math.max(this.WMIN, Math.min(this.WMAX, n));
        }
        applyWidth(w) {
            w = Math.max(this.WMIN, Math.min(this.WMAX, w));
            this.panel.style.width = w + 'px';
            document.documentElement.style.setProperty('--tt-panel-w', w + 'px');
            return w;
        }
        setupResizer() {
            const r = document.createElement('div');
            r.id = 'tt-resizer';
            this.panel.appendChild(r);
            let startX = 0, startW = 0, drag = false;
            const move = e => { if (drag) this.applyWidth(startW + (startX - e.clientX)); };
            const up = () => {
                if (!drag) return; drag = false;
                r.classList.remove('tt-active');
                document.documentElement.classList.remove('tt-resizing');
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                const w = parseInt(this.panel.style.width, 10);
                if (!isNaN(w)) this.app.store.set('panelWidth', w);
            };
            r.addEventListener('mousedown', e => {
                e.preventDefault(); drag = true;
                startX = e.clientX; startW = this.panel.offsetWidth;
                r.classList.add('tt-active');
                document.documentElement.classList.add('tt-resizing');
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
            r.addEventListener('dblclick', () => { this.applyWidth(this.WDEF); this.app.store.set('panelWidth', this.WDEF); });
        }

        /* --- сборка DOM --- */
        build() {
            if (document.getElementById('tt-panel') || document.getElementById('tt-rail')) return;
            Styles.inject();
            document.documentElement.style.setProperty('--tt-panel-w', this.width() + 'px');

            this.buildRail();
            this.buildPanel();
            this.theme.apply();

            // переключатели rail / panel
            const expanded = this.app.store.get('panelExpanded', true);
            expanded ? this.show() : this.hide();

            this.refreshAll();
        }

        rb(icon, title, onClick) {
            const b = document.createElement('button');
            b.className = 'tt-rail-btn'; b.textContent = icon; b.title = title; b.onclick = onClick;
            return b;
        }
        buildRail() {
            const rail = document.createElement('div');
            rail.id = 'tt-rail';
            rail.appendChild(this.rb('◀', 'Развернуть панель', () => this.show()));
            const sep = document.createElement('div'); sep.className = 'tt-rail-sep'; rail.appendChild(sep);
            if (this.isProduct) {
                rail.appendChild(this.rb('📦', 'Скачать ZIP фото', () => Actions.downloadZip()));
                rail.appendChild(this.rb('🔗', 'Копировать URL фото', () => Actions.copyLinks()));
                rail.appendChild(this.rb('📋', 'Копировать название', () => Actions.copyName()));
                rail.appendChild(this.rb('🔢', 'Копировать артикул', () => Actions.copyArticle()));
            }
            const selBtn = this.rb('🧺', 'Подборка', () => this.show());
            const badge = document.createElement('span');
            badge.id = 'tt-rail-badge';
            selBtn.appendChild(badge);
            rail.appendChild(selBtn);
            document.body.appendChild(rail);
            this.rail = rail;
        }

        qb(icon, title, onClick) {
            const b = document.createElement('button');
            b.className = 'tt-quick-btn'; b.textContent = icon; b.title = title; b.onclick = onClick;
            return b;
        }
                buildPanel() {
            const panel = document.createElement('div');
            panel.id = 'tt-panel';
            panel.style.width = this.width() + 'px';
            this.panel = panel;
            this.setupResizer();

            /* ---- Шапка ---- */
            const header = document.createElement('div');
            header.className = 'tt-header';

            const top = document.createElement('div');
            top.className = 'tt-header-top';

            const title = document.createElement('div');
            title.className = 'tt-title';
            title.innerHTML = `<span>🛠</span><span>Tools</span>`;
            const titleBadge = document.createElement('span');
            titleBadge.id = 'tt-header-sel-count';
            titleBadge.className = 'tt-title-badge';
            title.appendChild(titleBadge);

            const ctrls = document.createElement('div');
            ctrls.style.cssText = 'display:flex;gap:6px';
            const themeBtn = document.createElement('button');
            themeBtn.className = 'tt-icon-btn';
            themeBtn.title = 'Сменить тему';
            themeBtn.textContent = this.theme.current === 'dark' ? '☀️' : '🌙';
            themeBtn.onclick = () => { const t = this.theme.toggle(); themeBtn.textContent = t === 'dark' ? '☀️' : '🌙'; };
            const closeBtn = document.createElement('button');
            closeBtn.className = 'tt-icon-btn'; closeBtn.title = 'Свернуть'; closeBtn.textContent = '▶';
            closeBtn.onclick = () => this.hide();
            ctrls.append(themeBtn, closeBtn);

            top.append(title, ctrls);
            header.appendChild(top);

            if (this.isProduct) {
                const card = document.createElement('div');
                card.id = 'tt-mini-card';
                card.className = 'tt-mini-card';
                card.innerHTML = `<div class="tt-mini-name"></div><div class="tt-mini-meta"></div>`;
                header.appendChild(card);

                const row = document.createElement('div');
                row.className = 'tt-quick-row';
                row.append(
                    this.qb('📦', 'Скачать ZIP фото', () => Actions.downloadZip()),
                    this.qb('🔗', 'Копировать URL фото', () => Actions.copyLinks()),
                    this.qb('📋', 'Копировать название', () => Actions.copyName()),
                    this.qb('🔢', 'Копировать артикул', () => Actions.copyArticle()),
                    this.qb('➕', 'В подборку', () => this.sel.addCurrent())
                );
                header.appendChild(row);
            }
            panel.appendChild(header);

            /* ---- Тело ---- */
            const body = document.createElement('div');
            body.className = 'tt-body';

            // Секция поиска по артикулу (вверху тела)
            this.sections.lookup = new Section('lookup', '🔍', 'Поиск по артикулу',
                () => this.buildLookup(), { defaultOpen: false });
            body.appendChild(this.sections.lookup.el);

            if (this.isProduct) {
                if (Page.parseProps().length) {
                    this.sections.props = new Section('props', '🔎', 'Характеристики',
                        () => this.buildProps(), { defaultOpen: !Page.propsVisible() });
                    body.appendChild(this.sections.props.el);
                }
                if (!isNaN(Page.priceInfo().price)) {
                    this.sections.calc = new Section('calc', '🧮', 'Калькулятор',
                        () => this.buildCalc(), { defaultOpen: Page.priceInfo().unitQty > 1 });
                    body.appendChild(this.sections.calc.el);
                }
            }

            this.sections.selection = new Section('selection', '🧺', 'Подборка',
                () => this.buildSelection(), { defaultOpen: this.sel.all().length > 0, counter: true });
            body.appendChild(this.sections.selection.el);

            if (this.isProduct) {
                this.sections.notes = new Section('notes', '📒', 'Заметка',
                    () => this.buildNotes(), { defaultOpen: this.notes.has(Page.id()) });
                body.appendChild(this.sections.notes.el);
            }

            panel.appendChild(body);
            document.body.appendChild(panel);

            // инициализация состояния секций
            Object.values(this.sections).forEach(s => s.init());

            // подписка модели подборки на изменения
            this.sel.onChange(() => this.refreshAll());
        }
                /* --- Контент: Поиск по артикулу --- */
                /* --- Контент: Поиск по артикулу --- */
        buildLookup() {
            const wrap = document.createElement('div');

            const hint = document.createElement('div');
            hint.style.cssText = 'color:var(--text-soft);font-size:12px;margin-bottom:8px;line-height:1.4';
            hint.textContent = 'Введите один или несколько артикулов (через пробел, запятую или с новой строки). Скрипт найдёт все товары и добавит в подборку.';
            wrap.appendChild(hint);

            const input = document.createElement('textarea');
            input.className = 'tt-input';
            input.placeholder = 'RG00934TDT2Q1F RG00934TDT309H ...';
            input.style.cssText = 'min-height:60px;resize:vertical;font-family:inherit';
            wrap.appendChild(input);

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:6px;margin-top:8px';

            const findBtn = document.createElement('button');
            findBtn.className = 'tt-btn primary';
            findBtn.style.cssText = 'flex:1;text-align:center';
            findBtn.textContent = '🔍 Найти и добавить';

            btnRow.append(findBtn);
            wrap.appendChild(btnRow);

            const result = document.createElement('div');
            result.style.cssText = 'margin-top:10px;font-size:13px';
            wrap.appendChild(result);

            // Один артикул
            const runOne = async (query) => {
                findBtn.disabled = true;
                result.innerHTML = `<div style="color:var(--text-soft)">⏳ Ищу «${query}»...</div>`;
                try {
                    const item = await Fetcher.getProductByArticle(query);
                    this.sel.addRaw(item);
                    result.innerHTML = `
                        <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:10px">
                            <div style="font-weight:700;color:var(--text);margin-bottom:4px">${item.name || 'Товар'}</div>
                            <div style="color:var(--green);font-size:13px">${!isNaN(item.price) ? Utils.money(item.price) : 'Цена не найдена'}${item.unit ? ' / ' + item.unitQty + ' ' + item.unit : ''}</div>
                            <div style="color:var(--text-soft);font-size:12px;margin-top:3px">Арт.: ${item.article || '—'} · хар-к: ${item.props ? item.props.length : 0}</div>
                            <a href="${item.url}" target="_blank" style="color:var(--link);font-size:12px">Открыть карточку</a>
                        </div>`;
                    Utils.toast('✓ Добавлено: ' + (item.name || query));
                    input.value = '';
                } catch (e) {
                    result.innerHTML = `<div style="color:var(--danger)">❌ ${e.message}</div>`;
                    Utils.toast('Не найдено: ' + query, 'err');
                } finally {
                    findBtn.disabled = false;
                }
            };

            // Несколько артикулов
            const runMany = async (list) => {
                findBtn.disabled = true;
                const ok = [], fail = [];
                for (let i = 0; i < list.length; i++) {
                    result.innerHTML = `<div style="color:var(--text-soft)">⏳ ${i + 1}/${list.length}: ${list[i]}</div>`;
                    try {
                        const item = await Fetcher.getProductByArticle(list[i]);
                        this.sel.addRaw(item);
                        ok.push(list[i]);
                    } catch {
                        fail.push(list[i]);
                    }
                    await new Promise(r => setTimeout(r, 400));
                }
                let html = `<div style="color:var(--green)">✓ Добавлено: <b>${ok.length}</b> из ${list.length}</div>`;
                if (fail.length) {
                    html += `<div style="color:var(--danger);margin-top:6px">❌ Не найдено (${fail.length}):<br>` +
                        fail.map(a => '• ' + a).join('<br>') + '</div>';
                }
                result.innerHTML = html;
                Utils.toast(`Готово: ${ok.length} добавлено${fail.length ? `, ${fail.length} не найдено` : ''}`);
                if (!fail.length) input.value = '';
                findBtn.disabled = false;
            };

            // Главный обработчик: сам решает один это артикул или много
            const run = () => {
                const list = Fetcher.parseArticles(input.value);
                if (!list.length) return Utils.toast('Введите артикул', 'err');
                if (list.length === 1) runOne(list[0]);
                else runMany(list);
            };

            findBtn.onclick = run;
            // Ctrl+Enter или Enter (без Shift) — запуск; Shift+Enter — перенос строки
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
                    e.preventDefault();
                    run();
                }
            });

            return wrap;
        }
        /* --- Контент: Характеристики --- */
        buildProps() {
            const wrap = document.createElement('div');
            const props = Page.parseProps();

            const input = document.createElement('input');
            input.className = 'tt-input';
            input.placeholder = `Поиск среди ${props.length} характеристик...`;

            const list = document.createElement('div');
            list.className = 'tt-props-list';

            const render = (q) => {
                list.innerHTML = '';
                q = (q || '').toLowerCase().trim();
                const arr = q ? props.filter(p =>
                    p.name.toLowerCase().includes(q) || p.value.toLowerCase().includes(q)) : props;
                if (!arr.length) {
                    const e = document.createElement('div');
                    e.className = 'tt-empty'; e.textContent = 'Ничего не найдено';
                    return list.appendChild(e);
                }
                arr.forEach(p => {
                    const row = document.createElement('div');
                    row.className = 'tt-prop-row';
                    row.title = 'Клик — копировать значение\nShift+клик — имя: значение';
                    row.innerHTML = `<div class="tt-prop-name"></div><div class="tt-prop-val"></div>`;
                    row.querySelector('.tt-prop-name').textContent = p.name;
                    row.querySelector('.tt-prop-val').textContent = p.value;
                    row.style.background = 'transparent';
                    row.onmouseenter = () => row.style.background = 'var(--bg-soft2)';
                    row.onmouseleave = () => row.style.background = 'transparent';
                    row.onclick = async e => {
                        const t = e.shiftKey ? `${p.name}: ${p.value}` : p.value;
                        if (await Utils.copy(t)) Utils.toast('Скопировано: ' + t.slice(0, 40));
                    };
                    list.appendChild(row);
                });
            };
            input.addEventListener('input', () => render(input.value));
            input.addEventListener('keydown', async e => {
                if (e.key === 'Escape') { input.value = ''; render(''); }
                else if (e.key === 'Enter') {
                    const q = input.value.toLowerCase().trim(); if (!q) return;
                    const f = props.find(p => p.name.toLowerCase().includes(q) || p.value.toLowerCase().includes(q));
                    if (f && await Utils.copy(f.value)) Utils.toast('Скопировано: ' + f.value);
                }
            });
            render('');
            wrap.append(input, list);
            return wrap;
        }

        /* --- Контент: Калькулятор --- */
        buildCalc() {
            const info = Page.priceInfo();
            const wrap = document.createElement('div');
            const unit = info.unit || 'ед';

            const infoLine = document.createElement('div');
            infoLine.className = 'tt-calc-info';
            infoLine.innerHTML =
                `<b>${Utils.money(info.price)}</b> за <b>${info.unitQty} ${unit}</b>
                 <span class="sep">·</span>
                 <span class="per">${Utils.money(info.pricePerUnit)}</span> / ${unit}`;

            const row = document.createElement('div');
            row.className = 'tt-calc-row';

            const input = document.createElement('input');
            input.type = 'number'; input.min = '0'; input.step = 'any';
            input.className = 'tt-calc-input'; input.value = info.unitQty;

            const lbl = document.createElement('div');
            lbl.textContent = unit;
            lbl.style.cssText = 'color:var(--text-soft);font-size:13px;min-width:24px';

            const eq = document.createElement('div');
            eq.textContent = '='; eq.style.cssText = 'color:var(--text-mute);font-size:15px';

            const result = document.createElement('div');
            result.className = 'tt-calc-result';

            const recalc = () => {
                const q = parseFloat((input.value || '0').replace(',', '.'));
                result.textContent = (isNaN(q) || q < 0) ? '—' : Utils.money(info.pricePerUnit * q);
            };
            input.addEventListener('input', recalc);
            recalc();

            row.append(input, lbl, eq, result);
            wrap.append(infoLine, row);
            return wrap;
        }

        /* --- Контент: Подборка --- */
        buildSelection() {
            const wrap = document.createElement('div');

            if (this.isProduct) {
                this.addBtn = document.createElement('button');
                this.addBtn.id = 'tt-sel-add';
                this.addBtn.style.cssText = 'width:100%;text-align:center;margin-bottom:8px';
                wrap.appendChild(this.addBtn);
            }

            const list = document.createElement('div');
            list.id = 'tt-sel-list'; list.className = 'tt-list';
            wrap.appendChild(list);

            const actions = document.createElement('div');
            actions.className = 'tt-sel-actions';

            const copyBtn = document.createElement('button');
            copyBtn.className = 'tt-btn primary';
            copyBtn.textContent = '📋 Скопировать';
            copyBtn.style.cssText = 'flex:1;text-align:center';
            copyBtn.onclick = () => this.sel.copyText();

            const exportWrap = document.createElement('div');
            exportWrap.className = 'tt-export-wrap';
            const exportBtn = document.createElement('button');
            exportBtn.className = 'tt-btn'; exportBtn.textContent = '📤'; exportBtn.title = 'Экспорт';
            const menu = document.createElement('div');
            menu.className = 'tt-export-menu';
            const mk = (label, fn) => {
                const b = document.createElement('button');
                b.className = 'tt-export-item'; b.textContent = label;
                b.onclick = () => { menu.style.display = 'none'; fn(); };
                return b;
            };
            menu.append(
                mk('📄 CSV (Excel)', () => this.sel.exportCSV()),
                mk('🔧 JSON', () => this.sel.exportJSON()),
                mk('🔗 TXT (ссылки)', () => this.sel.exportTXT())
            );
            exportBtn.onclick = e => {
                e.stopPropagation();
                menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
            };
            document.addEventListener('click', () => menu.style.display = 'none');
            exportWrap.append(exportBtn, menu);

                        const zipBtn = document.createElement('button');
            zipBtn.className = 'tt-btn'; zipBtn.textContent = '📦'; zipBtn.title = 'Скачать фото всех товаров (ZIP)';
            zipBtn.onclick = () => Actions.downloadSelectionZip(this.sel.all());

            const clearBtn = document.createElement('button');
            clearBtn.className = 'tt-btn danger'; clearBtn.textContent = '🗑';
            clearBtn.onclick = () => this.sel.clear();

            actions.append(copyBtn, exportWrap, zipBtn, clearBtn);
            wrap.appendChild(actions);

            // первичная отрисовка
            setTimeout(() => this.renderSelection(), 0);
            return wrap;
        }
        renderSelection() {
            const cont = document.getElementById('tt-sel-list');
            if (!cont) return;
            const list = this.sel.all();
            cont.innerHTML = '';
            if (!list.length) {
                const e = document.createElement('div');
                e.className = 'tt-empty'; e.textContent = 'Подборка пуста';
                cont.appendChild(e);
            } else {
                list.forEach((item, i) => {
                    const row = document.createElement('div');
                    row.className = 'tt-list-row';
                    const num = document.createElement('div');
                    num.className = 'tt-list-num'; num.textContent = (i + 1) + '.';
                    const info = document.createElement('div');
                    info.className = 'tt-list-info';
                    const nm = document.createElement('a');
                    nm.className = 'tt-list-name'; nm.href = item.url; nm.target = '_blank';
                    nm.textContent = item.name || 'Без названия';
                    info.appendChild(nm);
                    if (!isNaN(item.price)) {
                        const pr = document.createElement('div');
                        pr.className = 'tt-list-price';
                        pr.textContent = Utils.money(item.price) + (item.unit ? ` / ${item.unitQty} ${item.unit}` : '');
                        info.appendChild(pr);
                    }
                    const del = document.createElement('button');
                    del.className = 'tt-list-del'; del.textContent = '✕';
                    del.onclick = () => this.sel.remove(item.id);
                    row.append(num, info, del);
                    cont.appendChild(row);
                });
            }
            this.updateAddBtn();
        }
        updateAddBtn() {
            if (!this.addBtn) return;
            const id = Page.id();
            if (this.sel.has(id)) {
                this.addBtn.textContent = '✓ В подборке (убрать)';
                this.addBtn.className = 'tt-btn muted';
                this.addBtn.onclick = () => { this.sel.remove(id); Utils.toast('Убрано из подборки'); };
            } else {
                this.addBtn.textContent = '➕ Добавить в подборку';
                this.addBtn.className = 'tt-btn success';
                this.addBtn.onclick = () => this.sel.addCurrent();
            }
            this.addBtn.style.cssText = 'width:100%;text-align:center;margin-bottom:8px';
        }

        /* --- Контент: Заметка --- */
        buildNotes() {
            const wrap = document.createElement('div');
            const id = Page.id();
            const existing = this.notes.get(id);

            const ta = document.createElement('textarea');
            ta.className = 'tt-note-area';
            ta.value = existing?.text || '';
            ta.placeholder = 'Заметка по этому товару...';

            const status = document.createElement('div');
            status.className = 'tt-note-status';
            const stamp = ts => '✓ ' + new Date(ts).toLocaleString('ru-RU',
                { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            if (existing?.updatedAt) status.textContent = stamp(existing.updatedAt);

            let timer = null;
            ta.addEventListener('input', () => {
                status.textContent = '✏ ...'; status.classList.remove('saved');
                clearTimeout(timer);
                timer = setTimeout(() => {
                    this.notes.save(id, ta.value);
                    status.textContent = stamp(Date.now());
                    status.classList.add('saved');
                    this.updateHeaderCard();
                }, 600);
            });

            wrap.append(ta, status);
            return wrap;
        }

        /* --- Шапка: мини-карточка --- */
        updateHeaderCard() {
            const card = document.getElementById('tt-mini-card');
            if (card) {
                if (!this.isProduct) { card.style.display = 'none'; }
                else {
                    card.style.display = 'block';
                    const info = Page.priceInfo();
                    card.querySelector('.tt-mini-name').textContent = Page.name() || 'Товар';
                    const meta = card.querySelector('.tt-mini-meta');
                    const parts = [];
                    const art = Page.article();
                    if (art) parts.push(`<span>${art}</span>`);
                    if (!isNaN(info.price)) parts.push(`<b>${Utils.money(info.price)}</b>`);
                    if (this.sel.has(Page.id())) parts.push(`<span style="color:var(--green)">✓ в подборке</span>`);
                    if (this.notes.has(Page.id())) parts.push(`<span title="Есть заметка">📒</span>`);
                    meta.innerHTML = parts.join('<span class="sep">·</span>');
                }
            }
            const hc = document.getElementById('tt-header-sel-count');
            if (hc) {
                const n = this.sel.all().length;
                hc.textContent = n;
                hc.style.display = n > 0 ? 'inline-block' : 'none';
            }
        }

        /* --- Бейджи + общий рефреш --- */
        refreshAll() {
            const n = this.sel.all().length;
            const badge = document.getElementById('tt-rail-badge');
            if (badge) { badge.textContent = n; badge.style.display = n > 0 ? 'inline-block' : 'none'; }
            if (this.sections.selection) this.sections.selection.setCounter(n);
            this.renderSelection();
            this.updateHeaderCard();
            this.app.catalog?.refreshCheckboxes();
        }

        /* --- Показ / скрытие --- */
        show() {
            this.rail.style.display = 'none';
            this.panel.style.display = 'flex';
            document.documentElement.classList.remove('tt-rail-mode');
            document.documentElement.classList.add('tt-shifted');
            this.app.store.set('panelExpanded', true);
            if (this.sel.all().length) this.sections.selection?.expand();
            this.refreshAll();
        }
        hide() {
            this.panel.style.display = 'none';
            this.rail.style.display = 'flex';
            document.documentElement.classList.remove('tt-shifted');
            document.documentElement.classList.add('tt-rail-mode');
            this.app.store.set('panelExpanded', false);
        }
    }

    /* ============================================================
     * Catalog — режим каталога (чекбоксы на карточках + тулбар)
     * ========================================================== */
    class Catalog {
        constructor(app) {
            this.app = app; this.sel = app.selection; this.observer = null; this.timer = null;
        }
                        findCards() {
            const links = Array.from(document.querySelectorAll('a[href*="/product/"]'));
            const cards = new Map();
            const seenUrls = new Set();
            for (const a of links) {
                let host = a;
                for (let i = 0; i < 6 && host.parentElement; i++) {
                    if (host.querySelector('img')) break;
                    host = host.parentElement;
                }
                if (!host.querySelector('img')) continue;
                const r = host.getBoundingClientRect();
                if (r.width < 80 || r.height < 80 || cards.has(host)) continue;

                const url = a.href.split('?')[0].split('#')[0];
                if (seenUrls.has(url)) continue;
                seenUrls.add(url);

                                let name = (a.innerText || '').trim();
                if (!name) name = (host.querySelector('img')?.alt || '').trim();

                                // парсим цену прямо из карточки каталога
                let price = NaN;
                {
                    // нормализуем все пробелы (вкл. неразрывный) в обычные
                    const raw = (host.innerText || '').replace(/[\u00A0\u202F\u2009]/g, ' ');
                    // ищем число перед "руб" / "₽" / "р."
                    const m = raw.match(/([\d]{1,3}(?:[ \d]{0,12})?(?:[.,]\d{1,2})?)\s*(?:руб|₽|р\.)/i);
                    if (m) {
                        // убираем пробелы-разделители тысяч, запятую -> точка
                        const num = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
                        if (!isNaN(num)) price = num;
                    }
                }

                cards.set(host, { url, name, price });
            }
            return Array.from(cards.entries()).map(([el, d]) => ({ el, ...d }));
        }
        shouldEnable() { return !Page.isProduct() && this.findCards().length >= 3; }
        makeId(url) {
            try {
                const parts = new URL(url).pathname.split('/').filter(Boolean);
                return parts[parts.length - 1] || url;
            } catch { return url; }
        }

        watch() {
            if (!this.shouldEnable()) return;
            this.buildToolbar();
            this.inject();
            if (this.observer) this.observer.disconnect();
                                    this.observer = new MutationObserver((mutations) => {
                // игнорируем собственные изменения (добавление/удаление чекбоксов)
                const onlyOurs = mutations.every(m =>
                    [...m.addedNodes, ...m.removedNodes].every(n =>
                        n.nodeType === 1 && n.classList?.contains('tt-catalog-cb')));
                if (onlyOurs) return;

                // мгновенно, но через rAF — не блокирует и схлопывает пачку мутаций в один вызов
                if (this._scheduled) return;
                this._scheduled = true;
                requestAnimationFrame(() => {
                    this._scheduled = false;
                    this.inject();
                });
            });
            this.observer.observe(document.body, { childList: true, subtree: true });
        }

                inject() {
            if (!this.shouldEnable()) return;

            // 1. Глобально убираем дубли: один URL — один чекбокс
            const byUrl = {};
            document.querySelectorAll('.tt-catalog-cb').forEach(cb => {
                const u = cb.dataset.ttUrl;
                if (!u) return;
                if (byUrl[u]) { cb.remove(); }   // дубль — удаляем
                else byUrl[u] = cb;
            });

            // 2. Чистим "осиротевшие" чекбоксы (карточка ушла из DOM)
            document.querySelectorAll('.tt-catalog-cb').forEach(cb => {
                if (!cb.isConnected || !cb.parentElement) cb.remove();
            });

            const cards = this.findCards();
            const sel = this.sel.all();

            cards.forEach(card => {
                const url = card.url;
                // если для этого товара уже есть чекбокс где-либо — пропускаем
                if (document.querySelector(`.tt-catalog-cb[data-tt-url="${CSS.escape(url)}"]`)) return;
                if (card.el.querySelector('.tt-catalog-cb')) return;

                const id = this.makeId(url);
                const cb = document.createElement('div');
                cb.className = 'tt-catalog-cb';
                cb.dataset.ttId = id;
                cb.dataset.ttUrl = url;
                cb.dataset.ttName = card.name;
                cb.dataset.ttPrice = isNaN(card.price) ? '' : card.price;
                cb.title = 'Добавить/убрать из подборки';
                if (sel.some(x => x.id === id)) { cb.classList.add('tt-cb-checked'); cb.textContent = '✓'; }
                cb.onclick = e => {
                    e.preventDefault(); e.stopPropagation();
                    this.toggle(cb);
                };
                if (getComputedStyle(card.el).position === 'static') card.el.style.position = 'relative';
                card.el.appendChild(cb);
            });

            this.updateToolbar();
        }

                toggle(cb) {
            const p = cb.dataset.ttPrice;
            const price = (p === '' || p === undefined) ? NaN : parseFloat(p);
            this.sel.toggle({
                id: cb.dataset.ttId, name: cb.dataset.ttName || 'Товар', article: '',
                url: cb.dataset.ttUrl, photo: '', price: price, unitQty: 1, unit: '', addedAt: Date.now()
            });
        }
        selectAll() {
            const cbs = Array.from(document.querySelectorAll('.tt-catalog-cb:not(.tt-cb-checked)'));
            if (!cbs.length) return Utils.toast('Все уже выбраны');
            const list = this.sel.all();
            cbs.forEach(cb => {
                if (list.some(x => x.id === cb.dataset.ttId)) return;
                list.push({
                    id: cb.dataset.ttId, name: cb.dataset.ttName || 'Товар', article: '',
                    url: cb.dataset.ttUrl, photo: '', price: NaN, unitQty: 1, unit: '', addedAt: Date.now()
                });
            });
            this.sel.save(list);
            Utils.toast(`Добавлено: ${cbs.length}`);
        }
        deselectAll() {
            const cbs = Array.from(document.querySelectorAll('.tt-catalog-cb.tt-cb-checked'));
            if (!cbs.length) return;
            const ids = new Set(cbs.map(c => c.dataset.ttId));
            this.sel.save(this.sel.all().filter(x => !ids.has(x.id)));
            Utils.toast(`Снято: ${cbs.length}`);
        }

        refreshCheckboxes() {
            const sel = this.sel.all();
            document.querySelectorAll('.tt-catalog-cb').forEach(cb => {
                const inSel = sel.some(x => x.id === cb.dataset.ttId);
                cb.classList.toggle('tt-cb-checked', inSel);
                cb.textContent = inSel ? '✓' : '';
            });
            this.updateToolbar();
        }

        buildToolbar() {
            if (document.getElementById('tt-cat-toolbar')) return;
            const tb = document.createElement('div');
            tb.id = 'tt-cat-toolbar';
            const label = document.createElement('div');
            label.innerHTML = 'Выбрано: <b class="tt-cat-count">0</b>';
            const selAll = document.createElement('button');
            selAll.className = 'tt-btn primary'; selAll.textContent = '☑ Все';
            selAll.style.cssText = 'padding:7px 12px;font-size:12.5px';
            selAll.onclick = () => this.selectAll();
            const desAll = document.createElement('button');
            desAll.className = 'tt-btn'; desAll.textContent = '☐ Снять';
            desAll.style.cssText = 'padding:7px 12px;font-size:12.5px';
            desAll.onclick = () => this.deselectAll();
            tb.append(label, selAll, desAll);
            document.body.appendChild(tb);
        }
        updateToolbar() {
            const tb = document.getElementById('tt-cat-toolbar');
            if (!tb) return;
            const checked = document.querySelectorAll('.tt-catalog-cb.tt-cb-checked').length;
            const total = document.querySelectorAll('.tt-catalog-cb').length;
            const cnt = tb.querySelector('.tt-cat-count');
            if (cnt) cnt.textContent = checked;
            tb.style.display = total > 0 ? 'flex' : 'none';
        }
    }

    /* ============================================================
     * App — корневой объект приложения (точка входа)
     * ========================================================== */
    class App {
        constructor() {
            App.instance = this;
            this.store = new Store();
            this.selection = new Selection(this.store);
            this.notes = new Notes(this.store);
            this.theme = new Theme(this.store);
            this.accordion = new Accordion(this.store);
            this.panel = new Panel(this);
            this.catalog = new Catalog(this);
        }
                init() {
            this.panel.build();
            this.catalog.watch();
            this.watchUrlChange();   // ← добавить
        }

        watchUrlChange() {
            let last = location.href;
            const check = () => {
                if (location.href !== last) {
                    last = location.href;
                    // даём странице дорендериться
                    setTimeout(() => {
                        this.panel.isProduct = Page.isProduct();
                        this.panel.updateHeaderCard();
                        this.panel.refreshAll();
                        this.catalog.watch();
                    }, 800);
                }
            };
            // ловим pushState / replaceState / popstate
            ['pushState', 'replaceState'].forEach(m => {
                const orig = history[m];
                history[m] = function () { const r = orig.apply(this, arguments); window.dispatchEvent(new Event('tt-urlchange')); return r; };
            });
            window.addEventListener('popstate', check);
            window.addEventListener('tt-urlchange', check);
            setInterval(check, 1000); // запасной поллинг
        }
        static get accordion() { return App.instance.accordion; }
    }

    /* ============================================================
     * Запуск (с повторами для динамической загрузки)
     * ========================================================== */
    let app = null;
    function boot() {
        if (!app) { app = new App(); app.init(); }
        else app.catalog.watch();
    }
    boot();
    setTimeout(boot, 1500);
    setTimeout(boot, 4000);
})();
