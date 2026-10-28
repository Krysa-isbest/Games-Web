'use strict';
// Custom music: plays the MP3s from the "Music" folder (shuffled) instead of the built-in music.
// Browsers can't read a folder by themselves, so list the file names here.
// To add a song: put the file into the Music folder and add its exact name to this list.
PB.CustomMusic = (() => {
    const CM = {
        files: [
            'kim jong un ultra phonk.mp3',
            'Psí ruleta (1) (1).mp3',
            '01.Counter-Strike 2.mp3',
            'Kohout funk.mp3'
        ]
    };
    let audio = null, order = [], idx = 0, playing = false, fails = 0;

    function el() {
        if (!audio) {
            audio = new Audio();
            audio.addEventListener('ended', () => { fails = 0; next(); });
            audio.addEventListener('error', () => { if (++fails < CM.files.length) next(); }); // skip broken files
        }
        return audio;
    }
    function next() {
        if (!CM.files.length) return;
        if (idx >= order.length) { order = CM.files.slice().sort(() => Math.random() - 0.5); idx = 0; }
        const a = el();
        a.src = 'Music/' + encodeURIComponent(order[idx++]);
        a.volume = PB.Settings.v.customVol;
        if (playing) a.play().catch(() => {});
    }

    // Start/stop to match the settings and whether music is playing at all (menu = silent, M = off)
    CM.update = () => {
        // the escape ending always has its own soundtrack
        const want = !!(PB.Settings.v.customMusic && PB.Music.on && PB.Music.mode && PB.Music.mode !== 'escape');
        if (want && !playing) {
            playing = true;
            if (!el().src) next(); else el().play().catch(() => {});
        } else if (!want && playing) {
            playing = false;
            el().pause();
        }
        if (audio) audio.volume = PB.clamp(PB.Settings.v.customVol, 0, 1);
    };
    CM.skip = () => { if (playing) next(); };

    return CM;
})();
