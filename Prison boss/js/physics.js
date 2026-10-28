'use strict';
// "Physics in the air, grid when landed": a dropped or thrown item falls with gravity, bounces off
// walls and surfaces, tumbles a bit, and when it comes to rest it snaps to the nearest free grid cell
// of the surface it landed on (desk, shelf, open drawer, trade slot, tunnel, floor...).
// The host decides where things land; a co-op guest only plays the flight as a visual ("ghost").
PB.Phys = (() => {
    const F = { list: [] };
    const G = 9.8, C = PB.C, W = () => PB.World;
    const v3 = new THREE.Vector3();

    // world x -> which cell the point is in
    const cellAt = x => PB.World.cellAtX(x);

    // it: item (already detached from surfaces/hands), pos/vel: world Vector3s, quat: world rotation
    F.launch = (it, pos, vel, quat, o = {}) => {
        F.cancel(it);
        const m = it.mesh;
        if (m.parent) m.parent.remove(m);
        W().scene.add(m); // items always live in the cell world, even if you're looking at the canteen
        m.position.copy(pos);
        if (quat) m.quaternion.copy(quat);
        m.scale.setScalar(1);
        it.flying = true;
        F.list.push({ it, vel: vel.clone(), spin: new THREE.Vector3(PB.rand(-4, 4), PB.rand(-4, 4), PB.rand(-4, 4)).multiplyScalar(0.3 + vel.length() * 0.4), ghost: !!o.ghost, t: 0, bounces: 0, ball: it.type === 'ball', hits: 0 });
        PB.Audio.play('pickup', { vol: 0.3 });
    };
    F.cancel = it => { F.list = F.list.filter(f => f.it !== it); it.flying = false; };
    F.isFlying = it => F.list.some(f => f.it === it);
    F.info = it => F.list.find(f => f.it === it) || null;

    // Highest landing surface under a point that the item passed on its way down this frame
    // (checking from where it WAS stops fast items from falling straight through the desk)
    function surfaceBelow(p, cell, fromY = p.y) {
        let best = null, bestY = -Infinity;
        for (const s of Object.values(W().surfaces)) {
            const sc = W().cellOf(s.id);
            if (sc !== cell && sc !== 'hole') continue;
            if (!s.accessible() && !s.id.endsWith('floor')) continue;
            s.group.updateMatrixWorld();
            const l = s.group.worldToLocal(v3.copy(p));
            if (l.x < 0 || l.z < 0 || l.x > s.cols * C || l.z > s.rows * C) continue;
            const y = s.group.getWorldPosition(new THREE.Vector3()).y;
            if (y <= fromY + 0.02 && y > bestY) { bestY = y; best = { s, local: l.clone(), y }; }
        }
        return best;
    }

    // Spiral out from the landing cell until the item fits (either rotation)
    F.nearestFree = (it, sid, gx0, gy0, rot0) => {
        const s = W().surfaces[sid], I = PB.Items;
        for (let r = 0; r <= Math.max(s.cols, s.rows); r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                for (const rot of [rot0, 1 - rot0]) {
                    const gx = gx0 + dx, gy = gy0 + dy;
                    if (I.canPlace(it, sid, gx, gy, rot)) return { gx, gy, rot };
                }
            }
        }
        return null;
    };

    function land(f, hit, cell) {
        const it = f.it, I = PB.Items;
        F.cancel(it);
        if (f.ghost) return; // the host will tell us where it really ended up
        if (f.ball) PB.Ball.dropped();
        // which way it lies: whichever grid rotation is closest to how it fell
        const yaw = new THREE.Euler().setFromQuaternion(it.mesh.quaternion, 'YXZ').y;
        const rot0 = Math.abs(Math.sin(yaw)) > 0.7 ? 1 : 0;
        let spot = null, sid = null;
        if (hit) {
            const fp = I.fp(it, rot0);
            const gx = PB.clamp(Math.round(hit.local.x / C - fp.w / 2), 0, Math.max(0, hit.s.cols - fp.w));
            const gy = PB.clamp(Math.round(hit.local.z / C - fp.h / 2), 0, Math.max(0, hit.s.rows - fp.h));
            spot = F.nearestFree(it, hit.s.id, gx, gy, rot0); sid = hit.s.id;
        }
        if (!spot) { // nothing fits there: it rolls onto the floor
            sid = cell + 'floor';
            const s = W().surfaces[sid], l = s.group.worldToLocal(it.mesh.getWorldPosition(new THREE.Vector3()));
            spot = F.nearestFree(it, sid, PB.clamp(Math.round(l.x / C), 0, s.cols - 1), PB.clamp(Math.round(l.z / C), 0, s.rows - 1), rot0);
        }
        if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
        if (spot) I.place(it, sid, spot.gx, spot.gy, spot.rot);
        else if (!I.placeFree(it, [cell + 'floor', cell + 'desk', cell + 'shelf'])) { I.destroy(it); PB.UI.toast('It rolled away somewhere… lost.', 'bad'); }
        PB.Audio.play('place', { vol: 0.5 });
    }

    F.update = dt => {
        for (const f of F.list.slice()) {
            const it = f.it, m = it.mesh;
            if (it.surface || !PB.Items.list.includes(it)) { F.cancel(it); continue; } // placed/destroyed meanwhile
            f.t += dt;
            const prevY = m.position.y;
            f.vel.y -= G * dt;
            m.position.addScaledVector(f.vel, dt);
            m.rotation.x += f.spin.x * dt; m.rotation.y += f.spin.y * dt; m.rotation.z += f.spin.z * dt;
            const cell = cellAt(m.position.x), b = W().cells[cell].bounds;
            // bounce off the cell walls (a little wider than the walking bounds); the ball is extra bouncy
            const x0 = b.x0 - 0.2, x1 = b.x1 + 0.2, z0 = -1.95, z1 = 1.95, k = f.ball ? 0.85 : 0.4;
            let wall = false;
            if (m.position.x < x0) { m.position.x = x0; f.vel.x = Math.abs(f.vel.x) * k; wall = true; }
            if (m.position.x > x1) { m.position.x = x1; f.vel.x = -Math.abs(f.vel.x) * k; wall = true; }
            if (m.position.z < z0) { m.position.z = z0; f.vel.z = Math.abs(f.vel.z) * k; wall = true; }
            if (m.position.z > z1) { m.position.z = z1; f.vel.z = -Math.abs(f.vel.z) * k; wall = true; }
            if (f.ball && m.position.y > 2.6) { m.position.y = 2.6; f.vel.y = -Math.abs(f.vel.y) * 0.8; wall = true; }
            if (wall && f.ball) { f.hits++; PB.Audio.play('place', { vol: 0.35 }); }
            // basketball hoop: falling through the rim scores, clipping the rim bounces it out
            if (f.ball && !f.ghost && f.vel.y < 0) {
                const hp = W().cells[cell].hoop;
                if (hp && prevY > hp.y && m.position.y <= hp.y) {
                    const dx = m.position.x - hp.x, dz = m.position.z - hp.z, d = Math.hypot(dx, dz);
                    if (d < 0.095) { PB.Ball.hoop(); f.vel.x *= 0.3; f.vel.z *= 0.3; }
                    else if (d < 0.14) {
                        m.position.y = hp.y + 0.002;
                        f.vel.y = Math.abs(f.vel.y) * 0.4;
                        f.vel.x += dx / d * 0.7; f.vel.z += dz / d * 0.7;
                        PB.Audio.play('click');
                    }
                }
            }
            if (f.vel.y > 0) continue;
            const hit = surfaceBelow(m.position, cell, prevY);
            const groundY = hit ? hit.y : 0;
            if (m.position.y <= groundY + 0.005) {
                m.position.y = groundY + 0.005;
                if (f.ball && Math.abs(f.vel.y) > 0.9) { // the ball keeps bouncing
                    f.vel.y = -f.vel.y * 0.75; f.vel.x *= 0.92; f.vel.z *= 0.92;
                    PB.Audio.play('place', { vol: 0.3 });
                } else if (!f.ball && Math.abs(f.vel.y) > 1.3 && f.bounces < 2) { // bounce
                    f.bounces++;
                    f.vel.y = -f.vel.y * 0.3; f.vel.x *= 0.5; f.vel.z *= 0.5; f.spin.multiplyScalar(0.5);
                    PB.Audio.play('place', { vol: 0.3 });
                } else { land(f, hit, cell); continue; }
            }
            if (f.t > (f.ball ? 15 : 4)) land(f, hit, cell); // never fly forever
        }
    };

    F.clear = () => { F.list.forEach(f => { f.it.flying = false; }); F.list = []; };
    return F;
})();

// Wall-ball: throw the rubber ball at the walls and catch it again. Something to do while you wait.
PB.Ball = (() => {
    const B = { streak: 0 };
    // called when you grab a ball out of the air; hits = how many walls it bounced off
    B.caught = hits => {
        if (hits < 1) return;
        B.streak++;
        const s = PB.state;
        if (s && B.streak > (s.stats.ballBest || 0)) { s.stats.ballBest = B.streak; if (B.streak > 2) PB.UI.toast(`🎾 New best streak: ${B.streak}!`, 'good'); }
        else PB.UI.toast(`🎾 Catch! Streak ${B.streak}`);
        PB.Audio.play('pop');
    };
    // nothing but net
    B.hoop = () => {
        const s = PB.state;
        if (s) { s.stats.hoops = (s.stats.hoops || 0) + 1; }
        PB.Audio.play('success');
        PB.UI.toast(`🏀 SWISH! Baskets: ${s ? s.stats.hoops : 1}`, 'good');
    };
    B.dropped = () => {
        if (B.streak > 0) PB.UI.toast(`🎾 Dropped it. Streak was ${B.streak}.`);
        B.streak = 0;
    };
    return B;
})();
