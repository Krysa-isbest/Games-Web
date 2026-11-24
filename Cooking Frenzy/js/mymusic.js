'use strict';
// Your own music: plays the songs in the "music" folder (shuffled, one after another) instead of the built-in tunes.
// Settings → Audio: Music = "My music", with its own volume and a Next song button.
// Browsers can't look into a folder on a website, so the songs are listed in music/list.json:
//   ["My song.mp3", "Another one.ogg"]
// When the game runs from VS Code's Live Server the folder itself is readable, so there the list is optional.
CF.MyMusic = (() => {
    const M = { files: [], loaded: false, now: '', status: 'Looking for songs…' };
    const EXT = /\.(mp3|ogg|oga|m4a|aac|wav|webm|opus|flac)$/i;
    let el = null, order = [], idx = 0, fails = 0, playing = false, loading = null;

    async function fromList() {
        const r = await fetch('music/list.json', { cache: 'no-cache' });
        if (!r.ok) return [];
        const j = await r.json();
        const list = Array.isArray(j) ? j : (j && (j.songs || j.files)) || [];
        return list.filter(n => typeof n === 'string' && EXT.test(n));
    }
    // a server's folder page (Live Server, python -m http.server...) links every file in it
    async function fromFolder() {
        const r = await fetch('music/', { cache: 'no-cache' });
        if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) return [];
        const html = await r.text(), out = new Set();
        for (const m of html.matchAll(/href\s*=\s*["']([^"'?#]+)["']/gi)) {
            let name = m[1].split('/').filter(Boolean).pop() || '';
            try { name = decodeURIComponent(name); } catch (e) {}
            if (EXT.test(name)) out.add(name);
        }
        return [...out];
    }
    M.load = () => {
        if (loading) return loading;
        loading = (async () => {
            let files = [];
            try { files = await fromList(); } catch (e) {}
            if (!files.length) { try { files = await fromFolder(); } catch (e) {} }
            M.files = files;
            M.loaded = true;
            M.status = files.length ? `${files.length} song${files.length === 1 ? '' : 's'} in the music folder`
                : 'No songs found. Put MP3s into the "music" folder and list them in music/list.json.';
            CF.Music.refresh();
            if (CF.UI && CF.UI.refreshMusic) CF.UI.refreshMusic();
        })();
        return loading;
    };
    M.reload = () => { loading = null; M.loaded = false; order = []; M.status = 'Looking for songs…'; return M.load(); };
    M.ready = () => M.files.length > 0;

    function audio() {
        if (!el) {
            el = new Audio();
            el.preload = 'auto';
            el.addEventListener('ended', () => { fails = 0; next(); });
            // a missing or broken file: skip it (give up when none of them play)
            el.addEventListener('error', () => { if (playing && ++fails < M.files.length) next(); else if (playing) { M.status = 'Could not play the songs in the music folder.'; stopNow(); } });
        }
        return el;
    }
    // every song once in a shuffled order before any repeats, never the same one twice in a row
    function next() {
        if (!M.files.length) return;
        if (idx >= order.length) {
            const last = order[order.length - 1];
            order = M.files.slice().sort(() => Math.random() - 0.5);
            if (order.length > 1 && order[0] === last) order.push(order.shift());
            idx = 0;
        }
        const a = audio(), name = order[idx++];
        M.now = name;
        a.src = 'music/' + name.split('/').map(encodeURIComponent).join('/');
        a.volume = CF.clamp(CF.settings.myMusic, 0, 1);
        if (playing) a.play().catch(() => {});
        if (CF.UI && CF.UI.refreshMusic) CF.UI.refreshMusic();
    }
    function stopNow() { playing = false; if (el) el.pause(); }

    M.start = () => {
        if (!M.ready()) return;
        audio().volume = CF.clamp(CF.settings.myMusic, 0, 1);
        if (playing) return;
        playing = true;
        if (!el.src) next(); else el.play().catch(() => {});
    };
    M.stop = () => { if (playing) stopNow(); };
    M.skip = () => { if (playing) { fails = 0; next(); } };
    M.setVolume = v => { if (el) el.volume = CF.clamp(v, 0, 1); };
    M.playing = () => playing;

    M.load();
    return M;
})();
