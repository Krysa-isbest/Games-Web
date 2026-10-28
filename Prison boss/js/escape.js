'use strict';
// THE ENDING. The fake key turns...
//  1. Cutscene: you run out of the cell block, then through a misty field at dawn while the escape theme builds.
//  2. Playable: a police outpost blocks the road. Find scrap (pipe, duct tape, nails), craft a club at the
//     workbench, knock out the officers (sneak up from behind: one hit; once they've seen you it takes two)
//     and take the car keys from the sergeant. Getting tased sends you back to the last checkpoint.
//  3. Cutscene: you start the police car, smash through the gate and drive into the sunrise.
PB.Escape = (() => {
    const E = { scene: null, interactables: [], colliders: [], bounds: { x0: -15.4, x1: 15.4, z0: -11.4, z1: 11.6 }, active: false, phase: null, cine: null };
    const A = PB.Area, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const $ = id => document.getElementById(id);
    let W, officers = [], scraps = [], keysObj = null, car = null, barrier = null, avatar = null, weaponMesh = null;
    let inv = {}, weapon = null, hasKeys = false, checkpoint = V(0, 0, 10.4), tased = 0, swing = 0, roadLights = [], searchBeams = [];
    let skipT = 0, sky = null;

    // ---------- Start (everyone in co-op plays their own escape) ----------
    E.start = () => {
        if (E.active) return;
        W = PB.World;
        PB.Mini.abort(false);
        PB.UI.closePanel(false);
        PB.Player.stashHeld();
        E.active = true;
        inv = {}; weapon = null; hasKeys = false; tased = 0; swing = 0;
        PB.Music.setMode('escape');
        PB.Audio.setAmbient(false);
        build();
        avatar = makeRunner();
        $('fade').classList.add('on');
        setTimeout(() => { $('fade').classList.remove('on'); runCine(cine1(), startPlay); }, 900);
    };
    E.busy = () => E.active && E.phase === 'play' && !!weapon;
    E.debug = () => ({ officers, car, keysObj }); // for automated tests

    // ---------- Cutscene engine ----------
    function runCine(shots, onDone) {
        E.cine = { shots, i: -1, t: 0, onDone };
        $('cine').classList.remove('hidden');
        $('hud').classList.add('hidden');
        PB.UI.prompt('', false);
        A.hud(null);
        skipT = 0;
        nextShot();
    }
    function nextShot() {
        const c = E.cine;
        c.i++; c.t = 0;
        const s = c.shots[c.i];
        if (!s) { endCine(); return; }
        if (s.enter) s.enter();
        const tx = $('cine-text');
        tx.classList.remove('on');
        if (s.text) setTimeout(() => { if (E.cine === c) { tx.textContent = s.text; tx.classList.add('on'); } }, 400);
    }
    function endCine() {
        const c = E.cine;
        E.cine = null;
        $('cine').classList.add('hidden');
        $('cine-text').classList.remove('on');
        if (c && c.onDone) c.onDone();
    }
    // place the camera (desktop) or the whole rig (VR: your head still looks around freely)
    function camAt(pos, look) {
        if (PB.VR.isOn()) {
            W.rig.position.set(pos.x, pos.y - 1.6, pos.z);
            W.rig.rotation.set(0, Math.atan2(pos.x - look.x, pos.z - look.z), 0);
        } else {
            W.rig.position.set(0, 0, 0); W.rig.rotation.set(0, 0, 0);
            W.camera.position.copy(pos);
            W.camera.lookAt(look);
        }
    }
    function useScene(sc) {
        W.activeScene = sc;
        sc.add(W.rig);
        if (avatar && avatar.root.parent !== sc) sc.add(avatar.root);
    }
    function updateCine(dt) {
        const c = E.cine, s = c.shots[c.i];
        c.t += dt;
        const k = PB.clamp(c.t / s.dur, 0, 1);
        if (s.update) s.update(k, dt);
        const cam = s.cam(k);
        camAt(cam[0], cam[1]);
        // hold Space to skip
        skipT = A.space || (PB.VR.isOn() && PB.VR.pressed('right', 1)) ? skipT + dt : 0;
        if (skipT > 0.6) { skipT = 0; c.i = c.shots.length - 1; c.t = s.dur; nextShot(); return; }
        if (c.t >= s.dur) nextShot();
    }

    // the player's own character, running
    function makeRunner() {
        const sl = PB.Coop.active ? PB.Coop.slot : 0;
        const looks = [{ skin: 0xffd7b5, hair: 0xd9b45a, hat: 'beanie', hatColor: 0x3a5a8a }, { skin: 0xc68642, hair: 0x1a1a1a, hat: 'hair', mustache: true },
            { skin: 0x8d5524, hair: 0x2b1d14, hat: 'beanie', hatColor: 0x8a2a2a, beard: true }, { skin: 0xe0a27a, hair: 0xb5532a, hat: 'hair' }];
        const ch = PB.NPC.makeChar(Object.assign({ shirt: 0xf07a22, pants: 0xe06a12, number: 100 + sl * 111 }, looks[sl] || looks[0]));
        ch.t = 0;
        return ch;
    }
    function run(ch, dt, speed = 1) {
        ch.t += dt * 11 * speed;
        const s = Math.sin(ch.t);
        ch.legL.rotation.x = s * 0.85; ch.legR.rotation.x = -s * 0.85;
        ch.armL.rotation.x = -s * 0.9; ch.armR.rotation.x = s * 0.9;
        ch.body.position.y = Math.abs(Math.cos(ch.t)) * 0.06;
        ch.body.rotation.x = 0.18;
    }

    // ---------- Cutscene 1: out of the block, across the field ----------
    function cine1() {
        const rp = avatar.root;
        return [
            { dur: 5, text: 'The fake key turned. The door clicked open.',
              enter: () => { useScene(W.scene); rp.position.set(0.3, 0, -2.8); rp.rotation.y = Math.PI / 2; PB.Audio.play('door'); },
              update: (k, dt) => { rp.position.x = 0.3 + k * 9; run(avatar, dt); },
              cam: k => [V(rp.position.x + 3.2 - k, 1.55, -2.5), V(rp.position.x, 1.35, -2.9)] },
            { dur: 4.5, text: 'Past the sleeping guard post...',
              update: (k, dt) => { rp.position.x = 9.3 + k * 5; run(avatar, dt); },
              cam: k => [V(0 - k * 2, 3.2 - k * 0.6, -14 + k * 2), V(rp.position.x, 0.8, -2.9)] },
            { dur: 7, text: '...and out into the open. Don\'t look back.',
              enter: () => { useScene(E.scene); rp.position.set(-3, 0, 55); rp.rotation.y = Math.PI; },
              update: (k, dt) => { rp.position.z = 55 - k * 28; rp.position.x = -3 + Math.sin(k * 3) * 1.2; run(avatar, dt, 1.1); },
              cam: k => [V(rp.position.x + 3.2 - k * 1.5, 1.0 + k * 0.4, rp.position.z - 2.5 + k * 1.5), V(rp.position.x, 1.2, rp.position.z)] },
            { dur: 4, update: (k, dt) => { rp.position.z = 27 - k * 9; rp.position.x = -1 + k; run(avatar, dt, 1.1); },
              cam: k => [V(1, 0.6 + k * 2, 8 - k * 2), V(rp.position.x, 1.2, rp.position.z)] },
            { dur: 4.5, text: 'A police outpost blocks the only road. You need a car.',
              update: (k, dt) => { if (k < 0.4) { rp.position.z = 18 - k * 15; run(avatar, dt); } else { avatar.legL.rotation.x = avatar.legR.rotation.x = 0; avatar.body.rotation.x = 0.05; } },
              cam: k => [V(rp.position.x + 0.5, 1.75, rp.position.z + 2.2), V(0, 1.5 - k * 0.3, -8)] }
        ];
    }

    // ---------- Playable part ----------
    function startPlay() {
        E.phase = 'play';
        if (avatar.root.parent) avatar.root.parent.remove(avatar.root);
        W.area = 'escape';
        W.activeScene = E.scene; E.scene.add(W.rig);
        W.rig.position.set(0, 0, 0); W.rig.rotation.set(0, 0, 0);
        respawnAt(checkpoint);
        $('hud').classList.remove('hidden');
        PB.Game.hint('escape', 'Crouch (<b>L-Ctrl</b>) to stay out of the flashlights. Find scrap, craft a club at the workbench, knock the officers out from behind and get the car keys!', 9);
    }
    function respawnAt(p) {
        const P = PB.Player;
        P.pos.set(p.x, 1.6, p.z); P.yaw = 0; P.pitch = -0.05; P.crouch = false;
    }
    E.respawn = () => { if (E.phase === 'play') { respawnAt(checkpoint); PB.UI.toast('🆘 Back to the checkpoint.'); } };

    function getTased(o) {
        tased++;
        PB.Audio.play('hit'); PB.Audio.play('caught');
        A.say('esc', o.ch, PB.choice(['Got you!', 'Down on the ground!', 'Taser, taser, taser!']), 2.2, 'guard');
        $('fade').classList.add('on');
        setTimeout(() => {
            respawnAt(checkpoint);
            officers.forEach(x => { if (x.state !== 'ko') { x.state = 'patrol'; x.ch.root.position.copy(x.home); x.g.w.target = null; x.g.wait = 1; } });
            $('fade').classList.remove('on');
            PB.UI.toast('⚡ You got tased and dragged back. Try sneaking: crouch and stay behind them.', 'bad', 4);
        }, 900);
    }

    function attack() {
        if (!weapon) { PB.UI.toast('Bare hands won\'t do it. Find scrap and craft a weapon at the workbench.', 'bad', 3); return; }
        if (swing > 0) return;
        swing = 1;
        PB.Audio.play('swish');
        const P = PB.Player.pos, f = new THREE.Vector3(-Math.sin(PB.Player.yaw), 0, -Math.cos(PB.Player.yaw));
        const o = officers.filter(x => x.state !== 'ko').map(x => ({ x, d: x.ch.root.position.distanceTo(V(P.x, 0, P.z)) }))
            .filter(({ x, d }) => d < 1.9 && f.dot(x.ch.root.position.clone().sub(V(P.x, 0, P.z)).normalize()) > 0.4)
            .sort((a, b) => a.d - b.d)[0];
        if (!o) return;
        const x = o.x;
        const unaware = x.state === 'patrol' || x.state === 'search';
        x.hp -= unaware || weapon === 'spiked' ? 2 : 1;
        PB.Audio.play('hit');
        x.stun = 0.6;
        x.ch.root.position.addScaledVector(f, 0.35);
        if (x.hp <= 0) knockOut(x);
        else { x.state = 'alert'; A.say('esc', x.ch, 'ARGH! You\'ll pay for that!', 2, 'guard'); }
    }
    function knockOut(x) {
        x.state = 'ko'; x.t = 0;
        x.g.cone.visible = false; x.beam.visible = false;
        PB.Audio.play('thud');
        A.say('esc', x.ch, PB.choice(['Ugh...', 'Mommy...', 'zzz...']), 2);
        if (x.sarge) {
            keysObj.visible = true;
            keysObj.position.set(x.ch.root.position.x, 0.05, x.ch.root.position.z + 0.5);
            PB.UI.toast('🔑 The sergeant dropped the car keys!', 'good', 4);
        }
        if (officers.every(o => o.state === 'ko')) { PB.Music.escalate(); PB.UI.toast('👮 All officers are out cold. Nobody can stop you now.', 'good', 4); }
    }

    function updateOfficers(dt) {
        const P = PB.Player.pos, me = V(P.x, 0, P.z);
        officers.forEach(x => {
            const r = x.ch.root;
            if (x.state === 'ko') {
                x.t += dt;
                r.rotation.x = PB.damp(r.rotation.x, -Math.PI / 2, 6, dt);
                r.position.y = PB.damp(r.position.y, 0.15, 6, dt);
                x.stars.visible = true; x.stars.rotation.y += dt * 3;
                return;
            }
            if (x.stun > 0) { x.stun -= dt; return; }
            const sees = A.sees(x.g) && hasLineOfSight(r.position, me);
            const d = r.position.distanceTo(me);
            if (x.state === 'patrol' || x.state === 'search') {
                A.patrol(x.g, dt);
                if (sees || d < 1.2) {
                    x.state = 'alert'; x.lost = 0;
                    PB.Audio.play('alert');
                    A.say('esc', x.ch, PB.choice(['HEY! STOP RIGHT THERE!', 'We\'ve got a runner!', 'FREEZE!']), 2.2, 'guard');
                    PB.Music.escalate();
                }
            } else if (x.state === 'alert') {
                // chase
                x.g.w.speed = 2.5;
                x.g.w.target = { x: me.x, z: me.z };
                x.g.w.onArrive = null;
                PB.NPC.updWalker(x.g.w, dt);
                x.g.ch.head.rotation.y = 0; x.g.cone.rotation.z = 0;
                x.lost = sees ? 0 : x.lost + dt;
                if (x.lost > 5) { x.state = 'search'; x.g.w.speed = 1.0; x.g.w.target = null; A.say('esc', x.ch, 'Where did he go?', 2, 'guard'); }
                if (d < 1.05) { x.wind = (x.wind || 0) + dt; x.ch.armR.rotation.x = -1.4; if (x.wind > 0.7) { x.wind = 0; getTased(x); } }
                else x.wind = 0;
            }
            x.g.cone.material.opacity = x.state === 'alert' ? 0.32 : sees ? 0.28 : 0.15;
            x.beam.material.opacity = x.state === 'alert' ? 0.16 : 0.1;
        });
    }
    // crates block the view
    function hasLineOfSight(a, b) {
        for (const c of E.colliders) {
            if (c.see === false) continue;
            for (let i = 1; i < 10; i++) {
                const x = PB.lerp(a.x, b.x, i / 10), z = PB.lerp(a.z, b.z, i / 10);
                if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return false;
            }
        }
        return true;
    }

    // ---------- Cutscene 2: the drive out ----------
    function startDrive() {
        E.phase = 'cine2';
        if (weaponMesh) weaponMesh.visible = false;
        PB.Music.escalate();
        PB.Audio.play('engine');
        const cp = car.position;
        let speed = 0;
        const drive = (dt, target) => { speed = PB.damp(speed, target, 1.2, dt); cp.z -= speed * dt; car.userData.wheels.forEach(w => { w.rotation.x -= speed * dt * 3; }); };
        runCine([
            { dur: 3.5, text: 'The engine roars to life.',
              update: (k, dt) => { drive(dt, k > 0.4 ? 2.5 : 0); car.rotation.z = Math.sin(performance.now() / 40) * 0.004; },
              cam: () => [V(cp.x - 2.4, 1.3, cp.z + 2.8), V(cp.x, 0.9, cp.z - 3)] },
            { dur: 2.6,
              update: (k, dt) => {
                  drive(dt, 16);
                  if (!barrier.userData.hit && cp.z < -11.2) { barrier.userData.hit = true; PB.Audio.play('crash'); PB.Audio.play('siren'); }
                  if (barrier.userData.hit) { barrier.rotation.z = PB.damp(barrier.rotation.z, 1.4, 8, dt); barrier.position.y = PB.damp(barrier.position.y, 2.2, 4, dt); }
              },
              cam: () => [V(6, 1.4, -13), V(cp.x, 0.8, cp.z)] },
            { dur: 7, text: 'Sirens wail behind you. They\'ll never catch up.',
              update: (k, dt) => { drive(dt, 22); sunrise(k * 0.6); },
              cam: () => [V(cp.x + 1.5, 2.6, cp.z + 7), V(cp.x, 1, cp.z - 6)] },
            { dur: 6, text: 'FREE.',
              update: (k, dt) => { drive(dt, 20); sunrise(0.6 + k * 0.4); },
              cam: () => [V(0, 2.2, -150), V(cp.x, 1, cp.z)] }
        ], finale);
    }
    function sunrise(k) {
        sky.setHex(0x1a2440).lerp(new THREE.Color(0xffa060), k); // sky = the scene's background colour
        E.scene.fog.color.copy(sky);
        E.sun.intensity = 0.1 + k * 0.9;
        E.hemi.intensity = 0.25 + k * 0.5;
    }

    function finale() {
        E.phase = 'end';
        const s = PB.state || { day: 0, stats: { earned: 0, made: 0, caught: 0 }, rep: 0 };
        PB.UI.panel('YOU ESCAPED!', () => `<div class="help" style="text-align:center">
            <div style="font-size:70px">🚓💨🌅</div>
            <h3>Block C will tell stories about you for years.</h3>
            <p>${PB.Coop.active ? 'Somewhere out there, your crew is free too.' : 'The road is long, the tank is full, and nobody is chasing you anymore.'}</p>
            <p>Days served: <b>${s.day}</b> · Money earned: <b>$${Math.round(s.stats.earned)}</b> · Goods made: <b>${s.stats.made}</b> · Times caught: <b>${s.stats.caught}</b> · Tased on the way out: <b>${tased}</b> · Rank: <b>${PB.RANKS[PB.rankOf(s.rep)].name}</b></p>
            <p class="req">PRISON BOSS · PC EDITION — thanks for playing!</p>
            <div class="center"><button class="btn small orange" data-act="escapeBack">Keep playing (sneak back in for your stuff)</button> <button class="btn small" data-act="escapeMenu">Main menu</button></div></div>`,
            { closable: false, wide: true });
    }

    // back to the cell world (or to the menu)
    E.finish = toMenu => {
        if (!E.active) return;
        E.active = false; E.phase = null; E.cine = null;
        $('cine').classList.add('hidden');
        $('hud').classList.remove('hidden');
        A.hud(null);
        if (avatar && avatar.root.parent) avatar.root.parent.remove(avatar.root);
        if (weaponMesh && weaponMesh.parent) weaponMesh.parent.remove(weaponMesh);
        W.rig.position.set(0, 0, 0); W.rig.rotation.set(0, 0, 0);
        W.area = 'cell'; W.activeScene = W.scene; W.scene.add(W.rig);
        A.dispose(E.scene);
        E.scene = null; officers = []; scraps = []; car = null; barrier = null; keysObj = null; weaponMesh = null; avatar = null;
        E.interactables = []; E.colliders = [];
        PB.UI.closePanel(false);
        if (toMenu) { PB.Game.toMenu(); return; }
        PB.Player.spawnIn(PB.Coop.homeCell());
        PB.Music.setMode(PB.state.phase === 'night' ? 'night' : 'day');
        PB.Audio.setAmbient(PB.state.phase === 'night');
        PB.Player.lock();
    };

    // ---------- Building the outpost, the field and the road ----------
    function build() {
        const sc = E.scene = new THREE.Scene();
        sky = sc.background = new THREE.Color(0x1a2440);
        sc.fog = new THREE.Fog(0x1a2440, 25, 140);
        E.interactables = []; E.colliders = []; officers = []; scraps = []; roadLights = []; searchBeams = [];
        const gfx = PB.Settings.v.gfx;
        E.hemi = new THREE.HemisphereLight(0x8090c0, 0x202830, 0.35); sc.add(E.hemi);
        const sun = E.sun = new THREE.DirectionalLight(0xffd0a0, 0.12);
        sun.position.set(-20, 30, -60); sun.castShadow = gfx !== 'low';
        Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 16, bottom: -16, near: 1, far: 120 });
        sun.shadow.mapSize.set(1024, 1024);
        sc.add(sun);
        W.sph(4, new THREE.MeshBasicMaterial({ color: 0xf4f0d8 }), 40, 60, -180, sc, 16); // moon

        // ground: field, compound and the road north
        W.box(400, 0.1, 400, 0x2f4a2a, 0, -0.06, -60, sc);
        W.box(32, 0.04, 24, 0x3a3d44, 0, 0, 0, sc);
        W.box(7, 0.04, 300, 0x2a2c32, 0, 0.005, -162, sc);
        for (let z = -14; z > -310; z -= 6) W.box(0.18, 0.02, 2.5, 0xe8e2c8, 0, 0.03, z, sc);
        // tall grass in the field (instanced)
        const blades = 1600, gm = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.9, 4), W.mat(0x5a7a3a), blades);
        const d = new THREE.Object3D();
        for (let i = 0; i < blades; i++) {
            d.position.set(PB.rand(-24, 24), 0.4, PB.rand(13, 70)); d.rotation.set(PB.rand(-0.3, 0.3), 0, PB.rand(-0.3, 0.3));
            d.scale.setScalar(PB.rand(0.6, 1.4)); d.updateMatrix(); gm.setMatrixAt(i, d.matrix);
        }
        sc.add(gm);
        // the prison behind you, with sweeping searchlights
        W.box(80, 10, 4, 0x6a6a70, 0, 5, 80, sc);
        [-20, 20].forEach(x => {
            W.box(3, 18, 3, 0x5a5a62, x, 9, 76, sc);
            const beam = new THREE.Mesh(new THREE.ConeGeometry(4, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
            beam.geometry.translate(0, -20, 0);
            const piv = new THREE.Group(); piv.position.set(x, 18, 76); piv.add(beam); sc.add(piv);
            beam.rotation.x = 1.2;
            searchBeams.push(piv);
        });
        // trees along the road (instanced)
        const nT = 90, trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 2, 6), W.mat(0x4a3220), nT);
        const tops = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 3.5, 7), W.mat(0x24402a), nT);
        for (let i = 0; i < nT; i++) {
            const side = i % 2 ? 1 : -1, x = side * PB.rand(6, 16), z = -16 - i * 3.2;
            d.rotation.set(0, 0, 0); d.scale.setScalar(PB.rand(0.8, 1.3));
            d.position.set(x, 1, z); d.updateMatrix(); trunks.setMatrixAt(i, d.matrix);
            d.position.set(x, 3.6 * d.scale.y, z); d.updateMatrix(); tops.setMatrixAt(i, d.matrix);
        }
        sc.add(trunks, tops);
        for (let z = -20; z > -300; z -= 28) { // streetlights (glowing heads only)
            W.box(0.12, 5, 0.12, 0x3a3f4a, 4, 2.5, z, sc);
            W.box(1.2, 0.1, 0.25, 0x3a3f4a, 3.5, 5, z, sc);
            W.box(0.5, 0.08, 0.2, new THREE.MeshBasicMaterial({ color: 0xffe2a0 }), 3.1, 4.95, z, sc);
        }

        // compound fence (north side has the gate)
        const fence = (x0, z0, x1, z1) => {
            const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 2.5);
            for (let i = 0; i <= n; i++) W.cyl(0.05, 0.05, 2.6, 0x8a8f9a, PB.lerp(x0, x1, i / n), 1.3, PB.lerp(z0, z1, i / n), sc, 6);
            const m = W.box(len, 2.4, 0.02, new THREE.MeshBasicMaterial({ color: 0x9aa0aa, transparent: true, opacity: 0.25, depthWrite: false }), (x0 + x1) / 2, 1.2, (z0 + z1) / 2, sc);
            m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        };
        fence(-16, -12, -3.5, -12); fence(3.5, -12, 16, -12); fence(-16, -12, -16, 12); fence(16, -12, 16, 12);
        // the gate barrier
        W.box(0.4, 1.2, 0.4, 0x3a3f4a, -3.6, 0.6, -12, sc);
        barrier = new THREE.Group(); barrier.position.set(-3.6, 1.1, -12); sc.add(barrier);
        for (let i = 0; i < 7; i++) W.box(1.0, 0.12, 0.12, i % 2 ? 0xffffff : 0xe84a3a, 0.5 + i, 0, 0, barrier);
        barrier.userData.hit = false;
        const sign = A.sign('POLICE CHECKPOINT', 3, 0.75, '#dfe8ff'); sign.position.set(-7, 2.6, -12.05); sc.add(sign);

        // cabin, floodlights, cover
        const cab = new THREE.Group(); cab.position.set(-9.5, 0, -7); sc.add(cab);
        W.box(4, 2.8, 3, 0x6a7a8a, 0, 1.4, 0, cab); W.box(4.4, 0.2, 3.4, 0x3a3f4a, 0, 2.9, 0, cab);
        W.box(1.6, 0.8, 0.05, new THREE.MeshBasicMaterial({ color: 0xffe2a0 }), 0, 1.6, 1.53, cab);
        coll(-11.6, -7.4, -8.6, -5.4);
        [[-12, 8], [12, 8], [0, -3], [12, -10]].forEach(([x, z]) => {
            W.cyl(0.08, 0.1, 6, 0x3a3f4a, x, 3, z, sc, 8);
            W.box(0.7, 0.3, 0.4, new THREE.MeshBasicMaterial({ color: 0xfff4d0 }), x, 6, z, sc);
            const l = new THREE.PointLight(0xfff0d0, 0.7, 16, 1.6); l.position.set(x, 5.6, z); sc.add(l);
        });
        const crate = (x, z, s = 1) => { W.box(1.1 * s, 1.1 * s, 1.1 * s, 0x8a6a3a, x, 0.55 * s, z, sc); coll(x - 0.6 * s, x + 0.6 * s, z - 0.6 * s, z + 0.6 * s); };
        const barrel = (x, z) => { W.cyl(0.35, 0.35, 1.0, 0x3a5a8a, x, 0.5, z, sc, 12); coll(x - 0.4, x + 0.4, z - 0.4, z + 0.4); };
        crate(-4, 6); crate(-3, 6.2, 0.8); crate(5, 4); crate(6.1, 4.3, 0.9); crate(-7, -1); crate(9, 1); crate(-12, -1.5, 1.2);
        barrel(2, 1); barrel(-1, -4); barrel(11, 5.5); barrel(-10, 3); barrel(3.5, -9.5);

        // police cars: three parked + the one by the gate
        [[5, -5.5, 0.1], [8.5, -5.5, -0.05], [12, -5.5, 0.08]].forEach(([x, z, r]) => { const c = makeCar(); c.position.set(x, 0, z); c.rotation.y = r; sc.add(c); coll(x - 1.0, x + 1.0, z - 2.2, z + 2.2); });
        car = makeCar(); car.position.set(0, 0, -8.6); sc.add(car);
        coll(-1.0, 1.0, -10.8, -6.4);
        A.inter(E, car, {
            prompt: () => E.phase !== 'play' ? null : hasKeys ? `${PB.key('E')} Start the car and get out of here! 🚓` : 'Police car (locked: the sergeant has the keys)',
            use: () => { if (E.phase === 'play' && hasKeys) startDrive(); }
        });

        // the workbench and the scrap lying around
        const bench = new THREE.Group(); bench.position.set(-13, 0, 6); sc.add(bench);
        W.box(1.6, 0.9, 0.8, 0x7b4a28, 0, 0.45, 0, bench);
        W.box(0.3, 0.15, 0.2, 0x5a5f6a, -0.4, 0.97, 0, bench); W.box(0.4, 0.05, 0.1, 0xc8ccd6, 0.3, 0.93, 0.1, bench);
        coll(-13.8, -12.2, 5.6, 6.4);
        A.inter(E, bench, { prompt: () => E.phase === 'play' ? craftPrompt() : null, use: () => craft() });
        const scrap = (type, x, z, build) => {
            const g = new THREE.Group(); g.position.set(x, 0, z); sc.add(g); build(g);
            const glow = W.sph(0.35, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.18, depthWrite: false }), 0, 0.2, 0, g, 10);
            const s = { type, g, glow, taken: false };
            scraps.push(s);
            A.inter(E, g, { prompt: () => s.taken || E.phase !== 'play' ? null : `${PB.key('E')} Take the ${{ pipe: 'metal pipe', tape: 'duct tape', nails: 'box of nails' }[type]}`, use: () => takeScrap(s) });
        };
        scrap('pipe', 13, 9, g => { const p = W.cyl(0.03, 0.03, 0.9, 0x8a8f9a, 0, 0.05, 0, g, 8); p.rotation.z = Math.PI / 2; for (let i = 0; i < 6; i++) W.box(0.3, 0.1, 0.2, 0x6a5040, PB.rand(-0.6, 0.6), 0.05, PB.rand(-0.5, 0.5), g); });
        scrap('tape', -10, -3.5, g => { const t = W.cyl(0.07, 0.07, 0.05, 0x9aa0aa, 0, 1.03, 0, g, 12); W.cyl(0.35, 0.35, 1.0, 0x3a5a8a, 0, 0.5, 0, g, 12); t.position.y = 1.03; });
        scrap('nails', 7, -9.8, g => { W.box(0.2, 0.1, 0.12, 0xb33a3a, 0, 0.05, 0, g); });

        // the keys (dropped by the sergeant)
        keysObj = new THREE.Group(); keysObj.visible = false; sc.add(keysObj);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14), W.mat(0xd4af37)); ring.rotation.x = Math.PI / 2; keysObj.add(ring);
        W.box(0.08, 0.012, 0.02, 0xc8ccd6, 0.08, 0, 0, keysObj);
        W.sph(0.3, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.25, depthWrite: false }), 0, 0.1, 0, keysObj, 10);
        A.inter(E, keysObj, {
            prompt: () => keysObj.visible ? `${PB.key('E')} Take the car keys 🔑` : null,
            use: () => { if (!keysObj.visible) return; keysObj.visible = false; hasKeys = true; PB.Audio.play('success'); PB.UI.toast('🔑 Got the keys! Get to the police car by the gate!', 'good', 4); }
        });

        // officers: two patrolling, the sergeant (with the keys) around the cars
        const off = (x, z, route, sarge) => {
            const g = A.guard(sc, x, z, 7.5, 0.5, sarge ? 0.8 : 1.0);
            g.route = route;
            const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
            beam.geometry.translate(0, -2.5, 0); beam.rotation.x = Math.PI / 2 + 0.25; beam.position.set(0.25, 1.3, 0.2);
            g.ch.root.add(beam);
            const stars = new THREE.Group(); stars.position.set(0, 0.6, 0.3); stars.visible = false; g.ch.root.add(stars);
            for (let i = 0; i < 3; i++) W.sph(0.05, new THREE.MeshBasicMaterial({ color: 0xffe066 }), Math.cos(i * 2.1) * 0.22, 0, Math.sin(i * 2.1) * 0.22, stars, 6);
            if (sarge) W.box(0.12, 0.08, 0.02, 0xd4af37, -0.12, 1.3, 0.16, g.ch.root); // the key ring on his belt
            officers.push({ ch: g.ch, g, beam, stars, state: 'patrol', hp: 2, sarge, home: V(x, 0, z), stun: 0 });
        };
        off(-6, 3, [[-6, 3, null, 2], [6, 3, null, 2], [6, 8, null, 1], [-6, 8, null, 2]], false);
        off(-12, -9, [[-12, -9, null, 3], [-5, -9, null, 1], [-5, -2, null, 2], [-12, -3, null, 1]], false);
        off(10, -2, [[10, -2, null, 2], [3, -2, null, 2], [3, -9.5, null, 2], [13, -9.5, null, 2]], true);

        // the weapon in your hand
        weaponMesh = new THREE.Group();
        W.cyl(0.025, 0.03, 0.75, 0x8a8f9a, 0, 0.3, 0, weaponMesh, 8);
        W.cyl(0.032, 0.032, 0.2, 0x5a5f6a, 0, 0.05, 0, weaponMesh, 8);
        E.spikes = new THREE.Group(); weaponMesh.add(E.spikes); E.spikes.visible = false;
        for (let i = 0; i < 8; i++) { const s = W.cyl(0.004, 0.004, 0.09, 0xc8ccd6, Math.cos(i) * 0.03, 0.45 + i * 0.03, Math.sin(i) * 0.03, E.spikes, 4); s.rotation.z = Math.PI / 2; s.rotation.y = i; }
        weaponMesh.position.set(0.32, -0.42, -0.6); weaponMesh.rotation.set(-0.5, 0, -0.3); weaponMesh.scale.setScalar(0.8);
        weaponMesh.visible = false;
        W.camera.add(weaponMesh);
        A.shadows(sc);
    }
    function coll(x0, x1, z0, z1) { E.colliders.push({ x0, x1, z0, z1 }); }

    function makeCar() {
        const g = new THREE.Group();
        W.box(1.9, 0.6, 4.2, 0x1a1f2e, 0, 0.55, 0, g);                 // body
        W.box(1.92, 0.25, 1.5, 0xf2f2f2, 0, 0.6, 0.2, g);                // white door stripe
        W.box(1.7, 0.55, 2.0, 0x1a1f2e, 0, 1.1, 0.25, g);                // cabin
        W.box(1.72, 0.4, 1.9, 0x223344, 0, 1.12, 0.25, g);               // windows
        W.box(0.5, 0.12, 0.25, 0xe83a3a, -0.3, 1.45, 0.25, g);           // light bar
        W.box(0.5, 0.12, 0.25, 0x3a6ae8, 0.3, 1.45, 0.25, g);
        W.box(0.3, 0.15, 0.05, new THREE.MeshBasicMaterial({ color: 0xfff6d0 }), -0.6, 0.6, -2.11, g);
        W.box(0.3, 0.15, 0.05, new THREE.MeshBasicMaterial({ color: 0xfff6d0 }), 0.6, 0.6, -2.11, g);
        g.userData.wheels = [[-0.95, -1.3], [0.95, -1.3], [-0.95, 1.3], [0.95, 1.3]].map(([x, z]) => { const w = W.cyl(0.33, 0.33, 0.25, 0x111111, x, 0.33, z, g, 12); w.rotation.z = Math.PI / 2; return w; });
        return g;
    }

    // ---------- Scrap and crafting ----------
    function takeScrap(s) {
        if (s.taken || E.phase !== 'play') return;
        s.taken = true; s.g.visible = false;
        inv[s.type] = true;
        PB.Audio.play('pickupScrap');
        PB.UI.toast(`Picked up the ${{ pipe: 'metal pipe', tape: 'duct tape', nails: 'nails' }[s.type]}.`, 'good', 2.5);
    }
    function craftPrompt() {
        if (weapon === 'spiked') return 'Workbench (your club is as good as it gets)';
        if (!weapon) return inv.pipe && inv.tape ? `${PB.key('E')} Craft a pipe club 🔧` : 'Workbench (you need a pipe and duct tape)';
        return inv.nails ? `${PB.key('E')} Hammer nails into the club (knock out in one hit)` : 'Workbench (nails would make the club nastier)';
    }
    function craft() {
        if (E.phase !== 'play') return;
        if (!weapon && inv.pipe && inv.tape) {
            weapon = 'club'; weaponMesh.visible = true;
            checkpoint = V(-12, 0, 4.6);
            PB.Audio.play('success');
            PB.UI.toast('🔧 Pipe club ready! Sneak up behind an officer and hit him (LMB). Checkpoint saved.', 'good', 5);
        } else if (weapon === 'club' && inv.nails) {
            weapon = 'spiked'; E.spikes.visible = true;
            PB.Audio.play('success');
            PB.UI.toast('🔨 Spiked club! One hit knocks anyone out.', 'good', 4);
        }
    }

    // ---------- Per frame ----------
    E.update = dt => {
        if (!E.active || !E.scene) return;
        if (PB.UI.blocking() && E.phase !== 'end') return;
        A.poll();
        searchBeams.forEach((b, i) => { b.rotation.y = Math.sin(performance.now() / 2200 + i * 2) * 0.9; });
        if (E.cine) { updateCine(dt); return; }
        if (E.phase !== 'play') return;
        if (A.justPressed && !PB.UI.blocking()) attack();
        swing = Math.max(0, swing - dt * 3.5);
        if (weaponMesh) { weaponMesh.rotation.x = -0.5 - Math.sin(swing * Math.PI) * 1.4; weaponMesh.rotation.z = -0.3 + Math.sin(swing * Math.PI) * 0.5; }
        updateOfficers(dt);
        scraps.forEach(s => { if (!s.taken) s.glow.material.opacity = 0.12 + Math.sin(performance.now() / 300) * 0.08; });
        if (keysObj.visible) keysObj.rotation.y += dt * 2;
        const ko = officers.filter(o => o.state === 'ko').length;
        const step = (done, txt) => `<div class="chip" style="${done ? 'opacity:.55;text-decoration:line-through' : ''}">${done ? '✔' : '▫️'} ${txt}</div>`;
        A.hud(step(inv.pipe && inv.tape, `Find scrap: ${inv.pipe ? '✔' : '✘'} pipe ${inv.tape ? '✔' : '✘'} tape ${inv.nails ? '✔' : '·'} nails`)
            + step(!!weapon, 'Craft a weapon at the workbench (west)')
            + step(ko === officers.length || hasKeys, `Knock out the officers (${ko}/${officers.length})`)
            + step(hasKeys, 'Take the sergeant\'s car keys')
            + step(false, 'Drive out through the gate')
            + (officers.some(o => o.state === 'alert') ? '<div class="chip eye">🚨 SPOTTED!</div>' : ''));
    };

    return E;
})();
