/* =====================================================================
   OTÁZKY pro stránku Škola. Každá sada = jeden test.
   Typy otázek:
     { t: 'mc',  q: 'otázka', a: ['SPRÁVNÁ', 'špatná', 'špatná', ...], e: 'vysvětlení' }   (správná je vždy první, stránka je zamíchá)
     { t: 'txt', q: 'otázka', a: ['odpověď', 'jiná přijatelná odpověď'], e: '...' }      (nezáleží na velkých písmenech ani na háčcích)
     { t: 'num', gen: () => ({ q, a: číslo, unit: 'N', e }) }                            (příklad, pokaždé s jinými čísly)
   ===================================================================== */
(() => {
  // náhodné číslo od min do max po krocích step
  const r = (min, max, step = 1) => +(min + step * Math.floor(Math.random() * (Math.round((max - min) / step) + 1))).toFixed(6);
  // číslo s desetinnou čárkou
  const cz = n => String(+(+n).toFixed(3)).replace('.', ',');
  const g = 9.8;

  window.SCHOOL_SETS = [
    {
      id: 'fyzika-dynamika',
      subject: 'Fyzika',
      title: 'Dynamika a Newtonovy zákony',
      note: 'Počítej s g = 9,8 m/s². Desetinná čísla piš s čárkou nebo tečkou.',
      questions: [
        /* ---------- 1. Základní pojmy a síla ---------- */
        { t: 'mc', q: 'Co je dynamika?', a: ['Část fyziky, která zkoumá příčiny pohybu těles a síly, které na ně působí', 'Část fyziky, která popisuje jen dráhu a rychlost, bez příčin pohybu', 'Nauka o teple a teplotě', 'Nauka o elektrickém proudu'], e: 'Dynamika se zabývá příčinami pohybu: silami.' },
        { t: 'mc', q: 'Jaká je jednotka síly?', a: ['Newton (N)', 'Joule (J)', 'Watt (W)', 'Kilogram (kg)'], e: 'Síla se měří v newtonech.' },
        { t: 'mc', q: '1 N je rovno:', a: ['1 kg·m/s²', '1 kg·m/s', '1 kg·m²', '1 J/s'], e: 'Z F = m·a: kg · m/s² = N.' },
        { t: 'mc', q: 'Síla je vektorová veličina. Co to znamená?', a: ['Má velikost i směr', 'Má jen velikost', 'Je vždy kladná', 'Nemá jednotku'], e: 'Vektor = velikost + směr (kreslíme ho šipkou).' },
        { t: 'mc', q: 'Která z těchto sil působí jen při vzájemném kontaktu (ne na dálku)?', a: ['Třecí', 'Gravitační', 'Magnetická', 'Elektrická'], e: 'Gravitační, magnetická a elektrická síla působí i na dálku; tření jen při dotyku.' },
        { t: 'mc', q: 'Jakou má partnerská síla velikost a směr?', a: ['Stejnou velikost, opačný směr', 'Stejnou velikost, stejný směr', 'Poloviční velikost, opačný směr', 'Dvojnásobnou velikost, opačný směr'], e: 'Partnerská síla: stejná velikost, opačný směr, prohozený původce a cíl.' },
        { t: 'txt', q: 'Jak se jmenuje těleso, které sílu způsobuje?', a: ['původce', 'puvodce sily', 'původce síly'], e: 'Každá síla má původce (kdo ji způsobuje) a cíl (na koho působí).' },
        { t: 'txt', q: 'Jak se jmenuje těleso, na které síla působí?', a: ['cíl', 'cil sily', 'cíl síly'], e: 'Původce sílu způsobuje, cíl je těleso, na které působí.' },
        { t: 'mc', q: 'Čím se liší síla a její partnerská síla?', a: ['Mají prohozeného původce a cíl', 'Mají jiného původce, ale stejný cíl', 'Působí v jiném čase', 'Jedna je vždy gravitační'], e: 'U partnerské síly se původce a cíl prohodí.' },

        /* ---------- 2. Newtonovy zákony ---------- */
        { t: 'txt', q: 'Jak se jinak říká 1. Newtonovu zákonu? Zákon …', a: ['setrvačnosti', 'zákon setrvačnosti'], e: '1. NZ = zákon setrvačnosti.' },
        { t: 'txt', q: 'Jak se jinak říká 2. Newtonovu zákonu? Zákon …', a: ['síly', 'zákon síly'], e: '2. NZ = zákon síly, F = m·a.' },
        { t: 'txt', q: 'Jak se jinak říká 3. Newtonovu zákonu? Zákon …', a: ['akce a reakce', 'zákon akce a reakce'], e: '3. NZ = zákon akce a reakce.' },
        { t: 'mc', q: 'Na těleso nepůsobí žádné síly (nebo je jejich výslednice nulová). Co těleso dělá?', a: ['Setrvává v klidu nebo v rovnoměrném přímočarém pohybu', 'Vždy se zastaví', 'Zrychluje', 'Pohybuje se po kružnici'], e: '1. NZ: Fv = 0 → klid nebo rovnoměrný přímočarý pohyb.' },
        { t: 'mc', q: 'Auto jede stálou rychlostí po rovné silnici. Jaká je výsledná síla?', a: ['Nulová', 'Ve směru jízdy', 'Proti směru jízdy', 'Rovná tíhové síle auta'], e: 'Stálá rychlost → a = 0 → Fv = 0.' },
        { t: 'mc', q: 'Zrychlení tělesa je podle 2. NZ…', a: ['přímo úměrné síle a nepřímo úměrné hmotnosti', 'nepřímo úměrné síle a přímo úměrné hmotnosti', 'přímo úměrné síle i hmotnosti', 'na síle nezávislé'], e: 'a = F / m.' },
        { t: 'mc', q: 'Síla na těleso se zdvojnásobí, hmotnost zůstane stejná. Zrychlení bude:', a: ['dvojnásobné', 'poloviční', 'stejné', 'čtyřnásobné'], e: 'a = F/m: dvakrát větší F → dvakrát větší a.' },
        { t: 'mc', q: 'Hmotnost tělesa se zdvojnásobí, síla zůstane stejná. Zrychlení bude:', a: ['poloviční', 'dvojnásobné', 'stejné', 'čtvrtinové'], e: 'a = F/m: dvakrát větší m → poloviční a.' },
        { t: 'mc', q: 'Proč se akce a reakce navzájem neruší?', a: ['Každá působí na jiné těleso', 'Nejsou stejně velké', 'Nepůsobí ve stejnou chvíli', 'Ruší se, vždy se vyruší'], e: 'Akce a reakce vznikají i zanikají současně, ale každá působí na jiné těleso.' },
        { t: 'mc', q: 'Jak se zapisuje 3. Newtonův zákon?', a: ['F₁₂ = −F₂₁', 'F = m·a', 'Fv = 0', 'Fg = m·g'], e: 'Akce = −reakce: stejně velké, opačného směru.' },

        /* ---------- 3. Skládání sil ---------- */
        { t: 'txt', q: 'Jak se nazývá jediná síla, která nahradí účinky více sil působících současně?', a: ['výslednice', 'výslednice sil', 'výsledná síla'], e: 'Princip superpozice: Fv = F₁ + F₂ + … (vektorově).' },
        { t: 'mc', q: 'Trojúhelníkové pravidlo (síly „za sebou“):', a: ['Konec první šipky napojíš na začátek druhé; výslednice vede od začátku první ke konci poslední', 'Obě šipky vedeš z jednoho bodu a doplníš rovnoběžník', 'Šipky položíš vedle sebe a sečteš jejich délky vždy', 'Delší šipku zkrátíš o kratší'], e: 'Za sebe = trojúhelník, ze společného bodu = rovnoběžník.' },
        { t: 'mc', q: 'Rovnoběžníkové pravidlo (síly ze společného působiště):', a: ['Doplníš rovnoběžník; úhlopříčka ze společného bodu je výslednice', 'Konec první šipky napojíš na začátek druhé', 'Výslednice je vždy ta delší síla', 'Výslednice je kolmá na obě síly'], e: 'Úhlopříčka rovnoběžníku vycházející ze společného bodu = výslednice.' },
        { t: 'mc', q: 'Dvě síly jsou na sebe kolmé. Jak spočítáš velikost výslednice?', a: ['Pythagorovou větou: Fv = √(F₁² + F₂²)', 'Fv = F₁ + F₂', 'Fv = F₁ − F₂', 'Fv = F₁ · F₂'], e: 'Kolmé síly tvoří pravoúhlý trojúhelník.' },
        { t: 'num', gen: () => { const a = r(5, 60, 5), b = r(5, 40, 5); return { q: `Na těleso působí dvě síly stejným směrem: ${a} N a ${b} N. Jak velká je výslednice?`, a: a + b, unit: 'N', e: `Stejný směr: Fv = F₁ + F₂ = ${a} + ${b} = ${a + b} N.` }; } },
        { t: 'num', gen: () => { const b = r(20, 200, 10), a = b + r(10, 150, 10); return { q: `Bednu táhneš silou ${a} N a tření ji brzdí silou ${b} N. Jak velká je výsledná síla?`, a: a - b, unit: 'N', e: `Opačný směr: Fv = F₁ − F₂ = ${a} − ${b} = ${a - b} N.` }; } },
        { t: 'num', gen: () => { const k = r(1, 8), [p, s, h] = [[3, 4, 5], [6, 8, 10], [5, 12, 13]][r(0, 2)]; return { q: `Dvě síly ${p * k} N a ${s * k} N působí kolmo na sebe. Jak velká je výslednice?`, a: h * k, unit: 'N', e: `Fv = √(${p * k}² + ${s * k}²) = ${h * k} N.` }; } },

        /* ---------- 4. Vzorce a výpočty ---------- */
        { t: 'num', gen: () => { const m = r(2, 60), a = r(0.5, 5, 0.5); return { q: `Těleso o hmotnosti ${m} kg zrychluje se zrychlením ${cz(a)} m/s². Jak velká výsledná síla na něj působí?`, a: m * a, unit: 'N', e: `F = m · a = ${m} · ${cz(a)} = ${cz(m * a)} N.` }; } },
        { t: 'num', gen: () => { const m = r(2, 20), a = r(1, 6, 0.5), F = m * a; return { q: `Na těleso o hmotnosti ${m} kg působí výsledná síla ${cz(F)} N. Jaké má zrychlení?`, a, unit: 'm/s²', e: `a = F / m = ${cz(F)} / ${m} = ${cz(a)} m/s².` }; } },
        { t: 'num', gen: () => { const m = r(0.5, 2.5, 0.1); return { q: `Auto má hmotnost ${cz(m)} t. Jak velká je jeho tíhová síla?`, a: m * 1000 * g, unit: 'N', e: `Nejdřív převod: ${cz(m)} t = ${cz(m * 1000)} kg. Fg = m · g = ${cz(m * 1000)} · 9,8 = ${cz(m * 1000 * g)} N.` }; } },
        { t: 'num', gen: () => { const m = r(100, 900, 50); return { q: `Jablko má hmotnost ${m} g. Jak velká je jeho tíhová síla?`, a: m / 1000 * g, unit: 'N', e: `${m} g = ${cz(m / 1000)} kg. Fg = ${cz(m / 1000)} · 9,8 = ${cz(m / 1000 * g)} N.` }; } },
        { t: 'num', gen: () => { const v = [36, 54, 72, 90, 108][r(0, 4)], t = [2, 4, 5, 10][r(0, 3)]; return { q: `Auto se rozjede z klidu na ${v} km/h za ${t} s. Jaké má zrychlení?`, a: v / 3.6 / t, unit: 'm/s²', e: `${v} km/h : 3,6 = ${cz(v / 3.6)} m/s. a = (v − v₀) / t = ${cz(v / 3.6)} / ${t} = ${cz(v / 3.6 / t)} m/s².` }; } },
        { t: 'num', gen: () => { const a = r(1, 4, 0.5), t = r(2, 10); return { q: `Těleso se rozjíždí z klidu se zrychlením ${cz(a)} m/s². Jakou dráhu urazí za ${t} s?`, a: a * t * t / 2, unit: 'm', e: `s = ½ · a · t² = 0,5 · ${cz(a)} · ${t}² = ${cz(a * t * t / 2)} m.` }; } },
        { t: 'num', gen: () => { const a = r(0.5, 4, 0.5), t = r(2, 12); return { q: `Těleso se rozjíždí z klidu se zrychlením ${cz(a)} m/s². Jakou rychlost má po ${t} s?`, a: a * t, unit: 'm/s', e: `v = a · t = ${cz(a)} · ${t} = ${cz(a * t)} m/s.` }; } },
        { t: 'mc', q: 'Jak převedeš km/h na m/s?', a: ['Vydělíš 3,6', 'Vynásobíš 3,6', 'Vydělíš 1000', 'Vynásobíš 60'], e: '1 m/s = 3,6 km/h, takže km/h : 3,6 = m/s.' },
        { t: 'mc', q: 'Do vzorce a = Fv / m dosazuješ:', a: ['výslednou sílu', 'vždy jen tažnou sílu', 'tíhovou sílu', 'třecí sílu'], e: 'Zrychlení způsobuje výsledná síla, ne jen jedna ze sil.' },
        { t: 'num', gen: () => { const k = r(1, 9); return { q: `Převeď ${k} kN na newtony.`, a: k * 1000, unit: 'N', e: `kN → N: · 1000. ${k} kN = ${k * 1000} N.` }; } },

        /* ---------- 5. Typové úlohy ---------- */
        { t: 'num', gen: () => { const m = r(50, 400, 50), Ft = r(50, 300, 25), F = Ft + m * r(1, 3, 0.5); return { q: `Bednu o hmotnosti ${m} kg táhneme silou ${cz(F)} N, tření ji brzdí silou ${Ft} N. Jaké má bedna zrychlení?`, a: (F - Ft) / m, unit: 'm/s²', e: `Nejdřív výsledná síla: Fv = F − Ft = ${cz(F)} − ${Ft} = ${cz(F - Ft)} N. Pak a = Fv / m = ${cz(F - Ft)} / ${m} = ${cz((F - Ft) / m)} m/s².` }; } },
        { t: 'mc', q: 'Jeřáb zvedá (nebo spouští) břemeno stálou rychlostí. Tažná síla lana je:', a: ['F = m·g', 'F = m·(g + a)', 'F = m·(g − a)', 'F = 0'], e: 'Stálá rychlost → a = 0 → tažná síla se rovná tíhové síle.' },
        { t: 'mc', q: 'Výtah se rozjíždí nahoru (zrychluje). Tažná síla lana je:', a: ['F = m·(g + a)', 'F = m·(g − a)', 'F = m·g', 'F = m·a'], e: 'Musí překonat gravitaci a ještě těleso urychlit: F = Fg + m·a.' },
        { t: 'mc', q: 'Výtah zrychluje směrem dolů. Tažná síla lana je:', a: ['F = m·(g − a)', 'F = m·(g + a)', 'F = m·g', 'F = m·a'], e: 'Gravitace pomáhá: F = Fg − m·a.' },
        { t: 'num', gen: () => { const m = r(200, 1000, 100), a = r(0.5, 2, 0.5); return { q: `Výtah o hmotnosti ${m} kg se rozjíždí nahoru se zrychlením ${cz(a)} m/s². Jak velkou silou táhne lano?`, a: m * (g + a), unit: 'N', e: `F = m · (g + a) = ${m} · (9,8 + ${cz(a)}) = ${cz(m * (g + a))} N.` }; } },
        { t: 'num', gen: () => { const m = r(200, 1000, 100), a = r(0.5, 2, 0.5); return { q: `Výtah o hmotnosti ${m} kg se rozjíždí dolů se zrychlením ${cz(a)} m/s². Jak velkou silou táhne lano?`, a: m * (g - a), unit: 'N', e: `F = m · (g − a) = ${m} · (9,8 − ${cz(a)}) = ${cz(m * (g - a))} N.` }; } },
        { t: 'num', gen: () => { const m = r(1, 5, 0.5) * 100; return { q: `Jeřáb zvedá břemeno o hmotnosti ${m} kg stálou rychlostí. Jak velkou silou táhne lano?`, a: m * g, unit: 'N', e: `Stálá rychlost → F = Fg = m · g = ${m} · 9,8 = ${cz(m * g)} N.` }; } },
        { t: 'mc', q: 'Pevná kladka se dvěma závažími (m₁ > m₂). Jakou hmotnost dosadíš do a = Fv / m?', a: ['m₁ + m₂', 'm₁', 'm₂', 'm₁ − m₂'], e: 'Rozpohybovat se musí obě závaží najednou, proto součet hmotností.' },
        { t: 'mc', q: 'Pevná kladka se dvěma závažími (m₁ > m₂). Výsledná síla, která soustavu roztáčí, je:', a: ['Fg₁ − Fg₂', 'Fg₁ + Fg₂', 'Fg₁', 'm₁ · m₂ · g'], e: 'Fv je rozdíl tíhových sil obou závaží.' },
        { t: 'num', gen: () => { const m2 = r(1, 6), m1 = m2 + r(1, 4); return { q: `Na pevné kladce visí závaží ${m1} kg a ${m2} kg. Jaké je zrychlení soustavy?`, a: (m1 - m2) * g / (m1 + m2), unit: 'm/s²', e: `Fv = Fg₁ − Fg₂ = (${m1} − ${m2}) · 9,8 = ${cz((m1 - m2) * g)} N. Hmotnost obou: ${m1} + ${m2} = ${m1 + m2} kg. a = ${cz((m1 - m2) * g)} / ${m1 + m2} = ${cz((m1 - m2) * g / (m1 + m2))} m/s².` }; } }
      ]
    }
  ];
})();
