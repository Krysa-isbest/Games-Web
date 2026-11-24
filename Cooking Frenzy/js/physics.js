'use strict';
// cannon.js world. Only the host (or solo player) simulates; clients just render the host's snapshots.
CF.Phys = (() => {
    const P = { world: null, ready: false };
    const G_STATIC = 1, G_ITEM = 2, G_PLAYER = 4;
    const STEP = 1 / 60;
    let acc = 0, ovenDoorBody = null, floorBody = null;
    const playerBodies = {};
    const removeQueue = [];
    let impactCb = null;

    P.init = (onImpact) => {
        impactCb = onImpact;
        const w = P.world = new CANNON.World();
        w.gravity.set(0, -9.82, 0);
        w.broadphase = new CANNON.SAPBroadphase(w);
        w.solver.iterations = 12;
        w.allowSleep = true;
        w.defaultContactMaterial.friction = 0.45;
        w.defaultContactMaterial.restitution = 0.12;
        w.defaultContactMaterial.contactEquationStiffness = 1e7;
        w.defaultContactMaterial.contactEquationRelaxation = 3;
        for (const c of CF.World.colliders) {
            const he = new CANNON.Vec3((c.max[0] - c.min[0]) / 2, (c.max[1] - c.min[1]) / 2, (c.max[2] - c.min[2]) / 2);
            const b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
            b.addShape(new CANNON.Box(he));
            b.position.set((c.max[0] + c.min[0]) / 2, (c.max[1] + c.min[1]) / 2, (c.max[2] + c.min[2]) / 2);
            b.collisionFilterGroup = G_STATIC; b.collisionFilterMask = G_ITEM;
            b.isFloor = !!c.floor;
            if (c.id === 'ovenDoor') ovenDoorBody = b;
            if (c.floor) floorBody = b;
            w.addBody(b);
        }
        P.ready = true;
    };

    P.reset = () => {
        if (!P.world) return;
        for (const b of P.world.bodies.slice()) if (b.item) P.world.remove(b);
        for (const k in playerBodies) { P.world.remove(playerBodies[k]); delete playerBodies[k]; }
        acc = 0;
    };

    P.makeBody = (item) => {
        const def = item.def, sh = def.shape;
        const b = new CANNON.Body({ mass: def.mass || 0.1 });
        if (sh.t === 'sphere') b.addShape(new CANNON.Sphere(sh.r));
        else b.addShape(new CANNON.Box(new CANNON.Vec3(sh.s[0] / 2, sh.s[1] / 2, sh.s[2] / 2)));
        b.linearDamping = 0.05; b.angularDamping = sh.t === 'sphere' ? 0.5 : 0.25;
        b.sleepSpeedLimit = 0.12; b.sleepTimeLimit = 0.6;
        b.collisionFilterGroup = G_ITEM; b.collisionFilterMask = G_STATIC | G_ITEM | G_PLAYER;
        b.item = item;
        b.addEventListener('collide', e => {
            if (!impactCb || !b.item) return;
            let v = 0;
            try { v = Math.abs(e.contact.getImpactVelocityAlongNormal()); } catch (err) { v = b.velocity.length(); }
            impactCb(item, e.body, v);
        });
        return b;
    };

    P.add = (item, pos, quat, vel) => {
        if (!P.world) return;
        if (item.body) P.remove(item);
        const b = item.body = P.makeBody(item);
        b.position.set(pos.x, pos.y, pos.z);
        if (quat) b.quaternion.set(quat.x, quat.y, quat.z, quat.w);
        if (vel) b.velocity.set(vel.x, vel.y, vel.z);
        P.world.addBody(b);
    };
    // Removal is deferred until after the step so collide callbacks stay safe
    let inStep = false;
    P.remove = (item) => {
        const b = item.body; if (!b) return;
        b.item = null; item.body = null;
        if (inStep) removeQueue.push(b); else try { P.world.remove(b); } catch (e) {}
    };

    P.setHeld = (item, held) => {
        const b = item.body; if (!b) return;
        b.collisionFilterMask = held ? (G_STATIC | G_ITEM) : (G_STATIC | G_ITEM | G_PLAYER);
        b.angularDamping = held ? 0.9 : (item.def.shape.t === 'sphere' ? 0.5 : 0.25);
        b.wakeUp();
    };

    P.setOvenDoor = open => { if (ovenDoorBody) ovenDoorBody.collisionResponse = !open; };
    P.isFloor = body => body === floorBody;

    // Kinematic box per chef, so players shove items around
    P.updatePlayers = (players, dt) => {
        if (!P.world) return;
        const seen = {};
        for (const p of players) {
            seen[p.pid] = true;
            let b = playerBodies[p.pid];
            if (!b) {
                b = playerBodies[p.pid] = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
                b.addShape(new CANNON.Box(new CANNON.Vec3(0.24, 0.85, 0.24)));
                b.collisionFilterGroup = G_PLAYER; b.collisionFilterMask = G_ITEM;
                b.position.set(p.pos.x, 0.85, p.pos.z);
                P.world.addBody(b);
            }
            const tx = p.pos.x, ty = p.pos.y + 0.85, tz = p.pos.z;
            const k = 1 / Math.max(dt, 1e-3);
            b.velocity.set(CF.clamp((tx - b.position.x) * k, -8, 8), CF.clamp((ty - b.position.y) * k, -8, 8), CF.clamp((tz - b.position.z) * k, -8, 8));
        }
        for (const k in playerBodies) if (!seen[k]) { P.world.remove(playerBodies[k]); delete playerBodies[k]; }
    };

    P.step = dt => {
        if (!P.world) return 0;
        acc += Math.min(dt, 0.1);
        let n = 0;
        inStep = true;
        while (acc >= STEP && n < 4) { P.world.step(STEP); acc -= STEP; n++; }
        inStep = false;
        if (n === 4) acc = 0;
        while (removeQueue.length) { const b = removeQueue.pop(); try { P.world.remove(b); } catch (e) {} }
        return n;
    };

    return P;
})();
