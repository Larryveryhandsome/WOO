// Meme Swipe — fetches Blogger feed via JSONP, lets you swipe Tinder-style.
// All preferences live in localStorage; nothing is uploaded.

const FEED_HOST = 'https://hornydragon.blogspot.com';
const FIRST_BATCH = 25;       // small first request so the UI shows up fast
const BATCH = 150;            // posts per subsequent JSONP request
const MAX_POSTS = 50000;      // effectively unlimited for this blog
const PRELOAD_AHEAD = 4;      // how many upcoming images to preload
const STACK_VISIBLE = 3;      // how many cards rendered at once
const IMG_SIZE = 's1200';     // big enough for retina, smaller than s1600

const LS_LIKED  = 'meme_liked_v1';
const LS_PASSED = 'meme_passed_v1';

// ----- storage -----
const store = {
    load(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
        catch { return fallback; }
    },
    save(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

let liked  = store.load(LS_LIKED,  []);              // [{id, img, post, title, ts}]
let passed = store.load(LS_PASSED, []);              // [id, ...]
const seen = new Set([...liked.map(x => x.id), ...passed]);

// ----- feed fetching (JSONP — Blogger supports alt=json-in-script&callback=) -----
function jsonp(url) {
    return new Promise((resolve, reject) => {
        const cb = '_jsonp_' + Math.random().toString(36).slice(2);
        const sep = url.includes('?') ? '&' : '?';
        const script = document.createElement('script');
        const cleanup = () => { delete window[cb]; script.remove(); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, 25000);
        window[cb] = (data) => { clearTimeout(timer); cleanup(); resolve(data); };
        script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('JSONP load error')); };
        script.src = url + sep + 'callback=' + cb;
        document.head.appendChild(script);
    });
}

async function fetchBatch(startIndex, max) {
    const url = `${FEED_HOST}/feeds/posts/default?alt=json-in-script&max-results=${max}&start-index=${startIndex}`;
    // One retry with a small backoff — Blogger occasionally 500s on big pages
    try {
        const data = await jsonp(url);
        return data?.feed?.entry ?? [];
    } catch (err) {
        console.warn('JSONP failed, retrying', startIndex, err);
        await new Promise(r => setTimeout(r, 1500));
        const data = await jsonp(url);
        return data?.feed?.entry ?? [];
    }
}

// Pull image URLs out of an HTML blob. Accepts Blogger's own CDN plus
// a few external hosts that appear frequently in older posts (imgur etc.).
const IMG_HOST_RE = /(blogspot\.com|googleusercontent\.com|imgur\.com|pbs\.twimg\.com|media\.tenor\.com|redd\.it|reddit\.com)/i;
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp)(\?|$)/i;

function extractImages(html) {
    if (!html) return [];
    const urls = new Set();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const img of doc.querySelectorAll('img')) {
        const src = img.getAttribute('src');
        if (!src) continue;
        if (!IMG_HOST_RE.test(src)) continue;
        urls.add(upscale(src));
    }
    for (const a of doc.querySelectorAll('a')) {
        const href = a.getAttribute('href') || '';
        if (IMG_HOST_RE.test(href) && IMG_EXT_RE.test(href)) {
            urls.add(upscale(href));
        }
    }
    return [...urls];
}

function upscale(url) {
    return url
        .replace(/\/s\d+(-c)?\//, `/${IMG_SIZE}/`)
        .replace(/=s\d+(-c)?(-[a-z]+)?$/, `=${IMG_SIZE}`)
        .replace(/\/w\d+-h\d+(-[a-z-]+)?\//, `/${IMG_SIZE}/`);
}

function entryToCards(entry) {
    const id = entry.id?.$t || entry.link?.find(l => l.rel === 'alternate')?.href || '';
    const post = entry.link?.find(l => l.rel === 'alternate')?.href || '';
    const title = entry.title?.$t || '';
    const html = entry.content?.$t || entry.summary?.$t || '';
    const imgs = extractImages(html);
    return imgs.map((img, i) => ({
        id: `${id}#${i}`,
        img,
        post,
        title,
    }));
}

// ----- queue -----
const queue = [];          // upcoming cards (FIFO)
let exhausted = false;     // no more posts to fetch
let nextStart = 1;         // Blogger feeds are 1-indexed
let totalLoaded = 0;

async function loadMore() {
    if (exhausted) return;
    const want = totalLoaded === 0 ? FIRST_BATCH : BATCH;
    try {
        const entries = await fetchBatch(nextStart, want);
        if (!entries.length) { exhausted = true; return; }
        nextStart += entries.length;
        totalLoaded += entries.length;
        for (const e of entries) {
            for (const card of entryToCards(e)) {
                if (!seen.has(card.id)) queue.push(card);
            }
        }
        if (entries.length < want || nextStart > MAX_POSTS) exhausted = true;
        updateLoadedInfo();
    } catch (err) {
        console.error('loadMore failed', err);
        exhausted = true;
    }
}

// Ensure we have enough cards to render & preload, fetching batches as needed.
async function ensureQueue(min = STACK_VISIBLE + PRELOAD_AHEAD) {
    while (queue.length < min && !exhausted) {
        await loadMore();
    }
}

// ----- DOM refs -----
const $ = (sel) => document.querySelector(sel);
const stack = $('#card-stack');
const statusEl = $('#status');
const loadedInfo = $('#loaded-info');
const progressEl = $('#progress');
const countLikedEl  = $('#count-liked');
const countPassedEl = $('#count-passed');

function updateCounters() {
    countLikedEl.textContent  = liked.length;
    countLikedEl.dataset.empty = liked.length === 0;
    countPassedEl.textContent = passed.length;
}
function updateLoadedInfo() {
    const line = `已從部落格載入 ${totalLoaded} 篇文章` +
        (exhausted ? '（全部完成）' : '（仍在繼續抓取…）') +
        ` ・ 待看 ${queue.length} 張`;
    loadedInfo.textContent = line;
    if (progressEl) {
        if (exhausted && queue.length === 0) {
            progressEl.hidden = true;
        } else if (exhausted) {
            progressEl.textContent = `🎉 已全部抓完 ${totalLoaded} 篇`;
            progressEl.hidden = false;
        } else {
            progressEl.textContent = `📥 已抓 ${totalLoaded} 篇・待看 ${queue.length}`;
            progressEl.hidden = false;
        }
    }
}

// ----- card rendering -----
function renderStack() {
    stack.innerHTML = '';
    const slice = queue.slice(0, STACK_VISIBLE);
    if (slice.length === 0) {
        if (exhausted) {
            statusEl.textContent = '🎉 沒有更多迷因了！可以打開 ❤️ 看看你的收藏。';
            statusEl.hidden = false;
        } else {
            statusEl.textContent = '正在載入更多迷因…';
            statusEl.hidden = false;
        }
        return;
    }
    statusEl.hidden = true;
    // Render back-to-front so the top card is last in DOM (highest z-index)
    for (let i = slice.length - 1; i >= 0; i--) {
        const card = slice[i];
        const el = makeCardEl(card, i);
        stack.appendChild(el);
    }
    bindTopCard();
    preloadAhead();
}

function makeCardEl(card, depth) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.depth = depth;
    div.style.setProperty('--depth', depth);
    div.dataset.id = card.id;
    div.innerHTML = `
        <img class="card-img" src="${card.img}" alt="" draggable="false">
        <div class="img-fallback">圖片載入失敗，自動跳過…</div>
        <a class="card-open" href="${card.post}" target="_blank" rel="noopener"
           title="${escapeHtml(card.title || '(無標題)')}"
           aria-label="開啟原文"
           onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 17L17 7M9 7h8v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        </a>
        <div class="stamp stamp-like">LIKE</div>
        <div class="stamp stamp-pass">NOPE</div>
    `;
    const img = div.querySelector('.card-img');
    img.addEventListener('error', () => {
        div.classList.add('img-failed');
        // Only auto-skip if this is the top card the user is currently viewing
        if (depth === 0) setTimeout(() => commitSwipe('pass'), 250);
    });
    return div;
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function preloadAhead() {
    for (let i = STACK_VISIBLE; i < STACK_VISIBLE + PRELOAD_AHEAD; i++) {
        const c = queue[i];
        if (c) { const im = new Image(); im.src = c.img; }
    }
}

// ----- swipe interaction on the top card -----
let drag = null;
function bindTopCard() {
    const top = stack.lastElementChild;
    if (!top) return;
    top.addEventListener('pointerdown', onPointerDown);
}

function onPointerDown(e) {
    const top = stack.lastElementChild;
    if (!top || e.target.closest('a')) return;
    top.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, el: top };
    top.classList.add('dragging');
    top.addEventListener('pointermove', onPointerMove);
    top.addEventListener('pointerup', onPointerUp);
    top.addEventListener('pointercancel', onPointerUp);
}
function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x0;
    drag.dy = e.clientY - drag.y0;
    const rot = drag.dx / 18;
    drag.el.style.transform = `translate(${drag.dx}px, ${drag.dy}px) rotate(${rot}deg)`;
    const intent = Math.max(-1, Math.min(1, drag.dx / 140));
    drag.el.style.setProperty('--like-opacity', Math.max(0, intent));
    drag.el.style.setProperty('--pass-opacity', Math.max(0, -intent));
}
function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { dx, el } = drag;
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.classList.remove('dragging');
    const threshold = Math.min(160, window.innerWidth * 0.28);
    if (dx > threshold)        commitSwipe('like');
    else if (dx < -threshold)  commitSwipe('pass');
    else {
        el.style.transform = '';
        el.style.setProperty('--like-opacity', 0);
        el.style.setProperty('--pass-opacity', 0);
    }
    drag = null;
}

// ----- commit a decision -----
let lastAction = null; // for undo

function commitSwipe(decision) {
    const card = queue.shift();
    if (!card) return;
    const top = stack.lastElementChild;
    if (top) {
        top.classList.add('flying-' + decision);
        // Force final transform so transition runs
        const dir = decision === 'like' ? 1 : -1;
        top.style.transform = `translate(${dir * (window.innerWidth + 200)}px, 80px) rotate(${dir * 30}deg)`;
        top.style.opacity = '0';
        top.addEventListener('transitionend', () => { /* removed by re-render */ }, { once: true });
    }
    if (decision === 'like') {
        liked.unshift({ ...card, ts: Date.now() });
        store.save(LS_LIKED, liked);
    } else {
        passed.unshift(card.id);
        // Cap passed list to avoid bloat
        if (passed.length > 5000) passed.length = 5000;
        store.save(LS_PASSED, passed);
    }
    seen.add(card.id);
    lastAction = { card, decision };
    updateCounters();

    setTimeout(async () => {
        await ensureQueue();
        renderStack();
        updateLoadedInfo();
    }, 180);
}

function undo() {
    if (!lastAction) return;
    const { card, decision } = lastAction;
    if (decision === 'like') {
        liked = liked.filter(c => c.id !== card.id);
        store.save(LS_LIKED, liked);
    } else {
        passed = passed.filter(id => id !== card.id);
        store.save(LS_PASSED, passed);
    }
    seen.delete(card.id);
    queue.unshift(card);
    lastAction = null;
    updateCounters();
    renderStack();
    refreshGallery();
}

// ----- buttons -----
$('#btn-pass').addEventListener('click', () => commitSwipe('pass'));
$('#btn-like').addEventListener('click', () => commitSwipe('like'));
$('#btn-undo').addEventListener('click', undo);

document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft')      { e.preventDefault(); commitSwipe('pass'); }
    else if (e.key === 'ArrowRight'){ e.preventDefault(); commitSwipe('like'); }
    else if (e.key === 'ArrowUp')   {
        e.preventDefault();
        const c = queue[0]; if (c) window.open(c.post, '_blank', 'noopener');
    }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
});

// ----- gallery -----
const gallery = $('#gallery');
const grid = $('#gallery-grid');
const galleryEmpty = $('#gallery-empty');

function openGallery(filter = 'liked') {
    refreshGallery(filter);
    gallery.hidden = false;
}
function refreshGallery(filter) {
    if (gallery.hidden && !filter) return;
    const list = liked;
    grid.innerHTML = '';
    galleryEmpty.hidden = list.length > 0;
    for (const c of list) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.innerHTML = `
            <img src="${c.img}" alt="" loading="lazy">
            <div class="tile-overlay">
                <button class="tile-btn" data-act="open" title="開啟原文">↗</button>
                <button class="tile-btn" data-act="zoom" title="放大">🔍</button>
                <button class="tile-btn danger" data-act="remove" title="移出收藏">✕</button>
            </div>
        `;
        tile.querySelector('[data-act="open"]').onclick = () => window.open(c.post, '_blank', 'noopener');
        tile.querySelector('[data-act="zoom"]').onclick = () => openLightbox(c);
        tile.querySelector('[data-act="remove"]').onclick = () => {
            liked = liked.filter(x => x.id !== c.id);
            store.save(LS_LIKED, liked);
            seen.delete(c.id);
            updateCounters();
            refreshGallery();
        };
        tile.querySelector('img').onclick = () => openLightbox(c);
        grid.appendChild(tile);
    }
}

$('#btn-liked').onclick = () => openGallery();
$('#btn-close-gallery').onclick = () => gallery.hidden = true;

$('#btn-export').onclick = () => {
    const blob = new Blob([JSON.stringify(liked, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `liked-memes-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#btn-clear').onclick = () => {
    if (!confirm('確定要清空所有「喜歡」嗎？這個動作不能復原。')) return;
    for (const c of liked) seen.delete(c.id);
    liked = [];
    store.save(LS_LIKED, liked);
    updateCounters();
    refreshGallery();
};

// ----- menu -----
const menu = $('#menu');
$('#btn-menu').onclick = () => { updateLoadedInfo(); menu.hidden = false; };
$('#btn-close-menu').onclick = () => menu.hidden = true;
$('#menu-reset-passed').onclick = () => {
    if (!confirm('要把所有跳過的迷因再放回隊列嗎？')) return;
    for (const id of passed) seen.delete(id);
    passed = [];
    store.save(LS_PASSED, passed);
    // Restart fetching from scratch so we re-collect them
    queue.length = 0;
    nextStart = 1;
    exhausted = false;
    totalLoaded = 0;
    for (const c of liked) seen.add(c.id); // keep liked filtered out
    updateCounters();
    boot();
};
$('#menu-reset-all').onclick = () => {
    if (!confirm('確定要清空所有紀錄（喜歡 + 跳過）嗎？')) return;
    liked = []; passed = []; seen.clear();
    localStorage.removeItem(LS_LIKED);
    localStorage.removeItem(LS_PASSED);
    queue.length = 0;
    nextStart = 1;
    exhausted = false;
    totalLoaded = 0;
    updateCounters();
    refreshGallery();
    boot();
};

// ----- lightbox -----
const lightbox = $('#lightbox');
const lbImg = $('#lightbox-img');
const lbLink = $('#lightbox-link');
function openLightbox(card) {
    lbImg.src = card.img;
    lbLink.href = card.post;
    lightbox.hidden = false;
}
$('#lightbox-close').onclick = () => lightbox.hidden = true;
lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.hidden = true; };

// ----- boot -----
async function boot() {
    updateCounters();
    statusEl.hidden = false;
    statusEl.textContent = '正在從部落格抓取迷因…';
    await ensureQueue();
    renderStack();
    updateLoadedInfo();
    // Keep filling in the background
    (async function backgroundFill() {
        while (!exhausted) {
            await new Promise(r => setTimeout(r, 200));
            await loadMore();
            if (queue.length && stack.children.length === 0) renderStack();
            updateLoadedInfo();
        }
    })();
}

boot();
