# tools/layout-check.py — проверка мобильной вёрстки в настоящем браузере (Playwright + Chromium).
# Запуск: python3 tools/layout-check.py . after   (нужен: pip install playwright && playwright install chromium)
# Рисует типовые блоки (строки тестов, таблицы-карточки, шапку) реальными CSS проекта на 320/360/390/430/768 px
# в тёмной и светлой темах и сообщает: горизонтальную прокрутку страницы, названия по буквам,
# кнопки за краем экрана, налезание логотипа на переключатель режимов. 0 проблем = всё в порядке.
import sys, json, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(sys.argv[1]).resolve()          # корень проекта
TAG = sys.argv[2]                                   # before / after
OUT = pathlib.Path("/tmp/skillbase-layout/shots"); OUT.mkdir(exist_ok=True)
CSS = ["tokens","themes/education","base","components","brand","fonts"]
links = "".join(f'<link rel="stylesheet" href="file://{ROOT}/ui/css/{c}.css">' for c in CSS)

TESTS = [("Вводный инструктаж","10 вопр. · сначала теория"),("Охрана труда на железнодорожном транспорте: специальная оценка условий","25 вопр.")]
def rows_tests():
    out=""
    for t,s in TESTS:
        out+=f'''<div class="list-row"><div class="list-row-main"><div class="list-row-title">{t}</div><div class="list-row-sub">{s}</div></div>
        <div class="list-row-end"><a class="btn primary" href="#">Запустить в Live</a><a class="btn secondary" href="#">История и оценки</a><a class="btn secondary" href="#">Изменить</a></div></div>'''
    return out
NAMES=["Ахметов Бауыржан Серикович","Иванова Анастасия Владимировна","Сулейменова Айгерим","vanakvetko906@gmail.com"]
def table():
    r="".join(f'<tr><td>{n}</td><td>—</td><td>0</td><td>—</td><td><button type="button" class="btn secondary">Отчёт</button></td></tr>' for n in NAMES)
    return f'<div class="analytics-table-wrap"><table class="analytics-table"><thead><tr><th>ФИО</th><th>Средний балл</th><th>Попыток</th><th>Лучший балл</th><th></th></tr></thead><tbody>{r}</tbody></table></div>'
def attempts():
    return "".join(f'''<div class="list-row"><span class="dot ok"></span><div class="list-row-main"><div class="list-row-title">{t}</div><div class="list-row-sub">{e} · 13 нояб. 2026 г.</div></div><span class="badge badge-success">80%</span></div>''' for t,e in [("Тб","vanakvetko906@gmail.com"),("Вводный инструктаж по охране труда","a.very.long.student.email.address.for.testing@example-college.kz")])
topbar='''<header class="topbar"><button id="sidebar-toggle" type="button" aria-label="Меню"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
<button class="back-button" type="button"><span aria-hidden="true">←</span><span class="back-text"> Назад</span></button>
<a class="brand" href="#/"><svg class="brand-mark" viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><path d="M7.5 27 L16 4.5 L24.5 27"/></svg><span class="brand-text"><span class="brand-name">Skillbase</span></span></a><nav id="nav"></nav><div class="mode-toggle mode-toggle-top"><button class="mode-toggle-btn active" type="button">Education</button><button class="mode-toggle-btn" type="button">Workforce</button></div>
<button class="theme-toggle" type="button">◐</button></header>'''
def page(theme):
    return f'''<!doctype html><html lang="ru" data-ui="education" data-theme="{theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">{links}</head>
<body class="has-sidebar"><div class="shell">{topbar}<main id="app"><div class="page">
<section class="panel"><div class="panel-body"><div class="topic-content">
<div class="topic-block"><h3>Теория</h3><div class="list"><div class="list-row"><div class="list-row-main"><div class="list-row-title">Вводный инструктаж</div><div class="list-row-sub">Книга · 20 стр.</div></div><div class="list-row-end"><a class="btn primary" href="#">Читать</a><a class="btn secondary" href="#">Изменить</a></div></div></div></div>
<div class="topic-block"><h3>Тесты</h3><div class="list">{rows_tests()}</div><a class="btn secondary" href="#">Добавить тест</a></div>
</div></div></section>
<section class="panel"><div class="panel-head"><h2>Ученики и оценки</h2></div><div class="panel-body">{table()}</div></section>
<section class="panel panel-flush"><div class="panel-head"><h2>Последние попытки</h2><a href="#" class="muted">Все результаты</a></div><div class="list">{attempts()}</div></section>
</div></main></div><script>__RT__\nlabelAll(document);</script></body></html>'''
RT=open(str(ROOT/'ui/components/responsive-table.js'),encoding='utf-8').read().replace('export ','')
issues=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    for theme in ("dark","light"):
        for w in (320,360,390,430,768):
            fx=pathlib.Path(f'/tmp/skillbase-layout/fx_{TAG}_{theme}.html'); fx.write_text(page(theme).replace('__RT__',RT),encoding='utf-8'); pg=b.new_page(viewport={"width":w,"height":900}); pg.goto('file://'+str(fx)); pg.wait_for_timeout(200)
            res=pg.evaluate('''()=>{const vw=innerWidth, out=[];
              const de=document.documentElement; if(de.scrollWidth>vw+1) out.push("горизонтальная прокрутка страницы: "+de.scrollWidth+">"+vw);
              document.querySelectorAll(".list-row-title").forEach(e=>{const lh=parseFloat(getComputedStyle(e).lineHeight)||20; const lines=Math.round(e.getBoundingClientRect().height/lh); const words=e.textContent.trim().split(/\\s+/).length; if(e.getBoundingClientRect().width<110) out.push("узкое название ("+Math.round(e.getBoundingClientRect().width)+"px): "+e.textContent.slice(0,20)); if(lines>words*3+2) out.push("название по буквам: "+e.textContent.slice(0,20));});
              document.querySelectorAll(".btn,button,.badge").forEach(e=>{const r=e.getBoundingClientRect(); if(r.width===0) return; if(r.right>vw+1||r.left<-1) out.push("выходит за экран: "+e.textContent.trim().slice(0,22)+" right="+Math.round(r.right)); if(r.height>80&&r.width<90) out.push("кнопка вытянута вертикально: "+e.textContent.trim().slice(0,12)+" "+Math.round(r.width)+"x"+Math.round(r.height));});
              document.querySelectorAll(".panel,.list-row,.analytics-table-wrap").forEach(e=>{const r=e.getBoundingClientRect(); if(r.right>vw+1) out.push("блок шире экрана: "+e.className+" right="+Math.round(r.right));});
              const br=document.querySelector(".topbar .brand"), mt=document.querySelector(".topbar .mode-toggle"); if(br&&mt&&br.getBoundingClientRect().right>mt.getBoundingClientRect().left+1) out.push("шапка: логотип налезает на переключатель режимов");
              const bn=document.querySelector(".brand-name"); if(bn&&bn.scrollWidth>bn.clientWidth+1) out.push("название Skillbase обрезано в шапке");
              return [...new Set(out)];}''')
            for r in res: issues.append((theme,w,r))
            if theme=="dark" and w in (360,): pg.screenshot(path=str(OUT/f"{TAG}_{theme}_{w}.png"),full_page=True)
            if theme=="light" and w==360: pg.screenshot(path=str(OUT/f"{TAG}_{theme}_{w}.png"),full_page=True)
            pg.close()
    b.close()
print(f"[{TAG}] проблем: {len(issues)}")
seen=set()
for t,w,r in issues:
    k=(w,r)
    if (t,w,r) in seen: continue
    seen.add((t,w,r)); print(f"  {t:5} {w:4}px  {r}")
