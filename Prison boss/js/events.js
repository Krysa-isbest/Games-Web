'use strict';
// Random daily events: every morning there's a chance something changes the rules for one day.
// Other systems ask PB.Events.mult('key') for a multiplier (1 = normal) or PB.Events.val('key', default) for a value.
PB.Events = (() => {
    const E = {};
    E.LIST = {
        sick:        { icon: '🤒', name: 'Guards have the flu',   desc: 'Fewer patrols tonight. Great night to craft or dig!', good: true, m: { patrol: 1.8 } },
        crackdown:   { icon: '🚨', name: 'Crackdown',             desc: 'The warden is angry: patrols every few seconds and getting caught gives more heat.', m: { patrol: 0.6, heat: 1.5 } },
        payday:      { icon: '💸', name: 'Payday in the block',   desc: 'Everyone got paid. Customers pay 50% more today.', good: true, m: { custPay: 1.5 } },
        sale:        { icon: '🏷️', name: 'Vinnie\'s clearance',   desc: 'Vinnie sells everything 30% cheaper today.', good: true, m: { buy: 0.7 } },
        shortage:    { icon: '📦', name: 'Supply shortage',       desc: 'Deliveries got stuck. Vinnie has less stock and it costs 30% more.', m: { buy: 1.3, stock: 0.5 } },
        feast:       { icon: '🍗', name: 'Feast day',             desc: 'Lunch lasts much longer and the canteen guards are busy eating.', good: true, m: { lunch: 1.7, cone: 0.7 } },
        blackout:    { icon: '🔦', name: 'Power cut',             desc: 'The lights are out tonight. Guards walk slower in the dark.', good: true, m: { guardSpeed: 0.7 } },
        gossip:      { icon: '🗣️', name: 'Word gets around',      desc: 'Your name is on everyone\'s lips: reputation gains +50% today.', good: true, m: { rep: 1.5 } },
        snitch:      { icon: '🐀', name: 'A snitch is talking',   desc: 'Somebody squealed. Heat starts higher and drops slower.', m: { heatDecay: 0.4 } },
        inspection:  { icon: '📋', name: 'Warden inspection',     desc: 'The warden tours the block. Guards walk faster and look closer.', m: { guardSpeed: 1.3, patrol: 0.8 } },
        // ----- newer events -----
        gym:         { icon: '🏀', name: 'Gym day',               desc: 'The yard and the gym are open 14:00 – 16:00! Shoot hoops, lift weights, do yard work. Workouts give buffs.', good: true, m: { gym: 1 } },
        kitchen:     { icon: '🍳', name: 'Kitchen duty',          desc: 'The cook is sick. Work the kitchen 09:00 – 11:00: cook for the block and get paid in cash and respect.', good: true, m: { kitchen: 1 } },
        visiting:    { icon: '👪', name: 'Visiting day',          desc: 'Families smuggled in cash. Customers come twice as often today.', good: true, m: { custRate: 0.5 } },
        k9:          { icon: '🐕', name: 'K9 unit',               desc: 'Sniffer dogs tonight! Contraband in drawers or under the mattress can be found. Safes and loose bricks are sealed.', m: { sniff: 0.35 } },
        lockdown:    { icon: '🔒', name: 'Lockdown',              desc: 'A fight in D-block. No lunch and no workshop today. Everyone stays in their cell.', m: { noLunch: 1 } },
        cardnight:   { icon: '🃏', name: 'Card tournament',       desc: 'Big poker night! Marked cards and cigarettes sell for 50% more today.', good: true, m: { sell_cards: 1.5, sell_cigarette: 1.5, sell_cigar: 1.3 } },
        heatwave:    { icon: '🌡️', name: 'Heat wave',             desc: 'It\'s boiling. Hooch and wine sell for 60% more, cigarettes for 20% less.', m: { sell_hooch: 1.6, sell_wine: 1.6, sell_cigarette: 0.8 } },
        blackmarket: { icon: '🕶️', name: 'Black market',          desc: 'Vinnie got a big shipment: double stock, and he sells you things above your rank today.', good: true, m: { stock: 2, anyRank: 1 } },
        rookie:      { icon: '🧢', name: 'Rookie guard',          desc: 'A new guard on the night shift. He\'s slow and overlooks half of what he sees.', good: true, m: { guardSpeed: 0.85, sloppy: 0.5 } },
        tax:         { icon: '💼', name: 'Protection tax',        desc: 'The Kingpin of D-block wants his cut: Vinnie charges 20% more and customers pay 10% less.', m: { buy: 1.2, custPay: 0.9 } },
        vibes:       { icon: '🎶', name: 'Good vibes',            desc: 'Someone\'s radio plays all your favourite songs. +8 quality on everything you craft today.', good: true, m: { craftQ: 8 } },
        rain:        { icon: '🌧️', name: 'Rainy day',             desc: 'Nobody wants to go outside: customers come more often but lunch is shorter.', m: { custRate: 0.7, lunch: 0.7 } }
    };

    E.current = () => (PB.state && PB.state.event && E.LIST[PB.state.event]) || null;
    E.mult = key => { const e = E.current(); return e && e.m[key] != null ? e.m[key] : 1; };
    E.val = (key, def = 0) => { const e = E.current(); return e && e.m[key] != null ? e.m[key] : def; };
    E.is = id => !!PB.state && PB.state.event === id;

    // Called every morning (not on day 1)
    E.roll = () => {
        const s = PB.state;
        s.event = null;
        if (s.day < 2 || Math.random() < 0.3) return null;
        const ids = Object.keys(E.LIST);
        // gym and kitchen days come around more often: they're the most fun
        s.event = Math.random() < 0.3 ? PB.choice(['gym', 'kitchen']) : PB.choice(ids);
        if (s.event === 'snitch') s.heat = Math.min(100, s.heat + 20);
        return E.LIST[s.event];
    };

    E.announce = () => {
        const e = E.current();
        if (!e) return;
        PB.Audio.play(e.good ? 'success' : 'alert');
        PB.UI.toast(`${e.icon} <b>${e.name}</b>: ${e.desc}`, e.good ? 'good' : 'bad', 8);
    };

    return E;
})();
