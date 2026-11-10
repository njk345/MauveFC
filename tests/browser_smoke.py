"""Run against a production export: MAUVE_BASE_URL=http://127.0.0.1:3000 python tests/browser_smoke.py.
Requires Python Playwright and a Chromium executable (CHROMIUM_PATH).
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE = os.getenv('MAUVE_BASE_URL', 'http://127.0.0.1:3000')
ARTIFACTS = Path(__file__).resolve().parents[1] / 'artifacts'
ARTIFACTS.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    for width in [390, 1440]:
        page.set_viewport_size({'width':width,'height':900})
        for route in ['/', '/schedule/', '/results/', '/players/', '/stats/', '/captain/', '/players/alex/']:
            response=page.goto(BASE+route, wait_until='networkidle')
            assert response.status==200,(route,response.status)
            assert page.evaluate('document.documentElement.scrollWidth') <= width, ('overflow',route,width)
            assert page.locator('h1').count()==1,route
        print('PASS routes, headings, and no horizontal overflow at',width)
    page.set_viewport_size({'width':390,'height':844})
    page.goto(BASE+'/schedule/',wait_until='networkidle')
    page.get_by_role('button',name='East River FC',exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    with page.expect_download() as download:
        page.get_by_role('button',name='Add to calendar',exact=True).click()
    calendar=Path(download.value.path()).read_text()
    assert 'DTSTART:20261113T000000Z' in calendar
    assert '[SAMPLE]' in calendar
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    print('PASS mobile fixture details, Escape, and timezone-correct calendar')
    page.goto(BASE+'/captain/',wait_until='networkidle')
    expect(page.locator('.fixture-select select')).to_have_value('fall-7')
    page.get_by_role('spinbutton',name='Mauve FC official score',exact=True).fill('2')
    page.get_by_role('spinbutton',name='Opponent official score',exact=True).fill('1')
    page.get_by_role('button',name='Save draft',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Draft saved')
    page.reload(wait_until='networkidle')
    expect(page.get_by_role('spinbutton',name='Mauve FC official score',exact=True)).to_have_value('2')
    data=json.loads(page.evaluate("localStorage.getItem('mauve-fc-prototype-v1')"))
    assert next(m for m in data['matches'] if m['id']=='fall-7').get('result') is None
    page.get_by_role('button',name='Add player details',exact=True).click()
    page.get_by_role('checkbox',name='Alex Morgan played',exact=True).check()
    page.get_by_role('spinbutton',name='Alex Morgan goals',exact=True).fill('2')
    page.get_by_role('checkbox',name='Sam Rivera played',exact=True).check()
    page.get_by_label('Assists',exact=True).select_option('complete')
    page.get_by_role('spinbutton',name='Sam Rivera assists',exact=True).fill('1')
    page.get_by_label('Scorers',exact=True).select_option('complete')
    page.get_by_label('Attendance',exact=True).select_option('complete')
    page.get_by_role('button',name='Preview result',exact=True).click()
    page.screenshot(path=str(ARTIFACTS/'captain-mobile.png'),full_page=True)
    page.get_by_role('button',name='Publish sample result',exact=True).click()
    expect(page.locator('.publish-success')).to_be_visible()
    data=json.loads(page.evaluate("localStorage.getItem('mauve-fc-prototype-v1')"))
    published=next(m for m in data['matches'] if m['id']=='fall-7')
    assert published['result']['published'] is True
    assert 'fall-7' not in data['drafts']
    assert published['result']['stats'][0]['goals']==2
    page.goto(BASE+'/stats/',wait_until='networkidle')
    expect(page.locator('.stat-card').nth(0).locator('strong')).to_have_text('7')
    expect(page.locator('.stat-card').nth(1).locator('strong')).to_have_text('17')
    alex=page.locator('tbody tr').filter(has=page.get_by_role('link',name='AM Alex Morgan'))
    expect(alex.locator('td').nth(3)).to_have_text('8')
    print('PASS draft persistence, mobile publish, and public stats refresh')
    page.goto(BASE+'/captain/?match=fall-7',wait_until='networkidle')
    page.get_by_role('spinbutton',name='Mauve FC official score',exact=True).fill('1')
    page.get_by_role('button',name='Save draft',exact=True).click()
    data=json.loads(page.evaluate("localStorage.getItem('mauve-fc-prototype-v1')"))
    assert next(m for m in data['matches'] if m['id']=='fall-7')['result']['home']==2
    page.reload(wait_until='networkidle')
    expect(page.get_by_role('spinbutton',name='Mauve FC official score',exact=True)).to_have_value('1')
    page.get_by_role('button',name='Add player details',exact=True).click()
    page.get_by_role('spinbutton',name='Alex Morgan goals',exact=True).fill('1')
    page.get_by_role('button',name='Preview result',exact=True).click()
    page.get_by_role('button',name='Publish sample result',exact=True).click()
    expect(page.locator('.publish-success')).to_be_visible()
    page.goto(BASE+'/stats/',wait_until='networkidle')
    expect(page.locator('.stat-card').nth(0).locator('strong')).to_have_text('7')
    expect(page.locator('.stat-card').nth(1).locator('strong')).to_have_text('16')
    page.goto(BASE+'/players/alex/',wait_until='networkidle')
    expect(page.locator('.profile-totals>div').nth(1).locator('strong')).to_have_text('7')
    print('PASS saved correction draft leaves public score intact; republish replaces totals')
    page.goto(BASE+'/players/',wait_until='networkidle')
    page.get_by_role('textbox',name='Search players').fill('Jordan')
    expect(page.locator('.player-card')).to_have_count(1)
    page.locator('.player-card').click()
    expect(page.locator('h1')).to_have_text('Jordan Lee')
    page.get_by_role('combobox',name='Season',exact=True).select_option('summer-2026')
    expect(page.locator('.profile-totals>div').nth(0).locator('strong')).to_have_text('4')
    page.get_by_role('button',name='Open navigation',exact=True).click()
    page.get_by_role('navigation',name='Mobile navigation').get_by_role('link',name='Results',exact=True).click()
    page.get_by_role('button',name='Wins',exact=True).click()
    expect(page.locator('.match-row')).to_have_count(2)
    print('PASS roster search, profile, season switching, mobile menu and result filters')
    page.get_by_role('button',name='Reset demo',exact=True).click()
    page.get_by_role('dialog').get_by_role('button',name='Reset demo',exact=True).click()
    page.goto(BASE+'/stats/',wait_until='networkidle')
    expect(page.locator('.stat-card').nth(1).locator('strong')).to_have_text('15')
    print('PASS demo reset')
    for width,name in [(390,'mobile'),(1440,'desktop')]:
        page.set_viewport_size({'width':width,'height':1000})
        for route,slug in [('/','home'),('/stats/','stats'),('/players/','players')]:
            page.goto(BASE+route,wait_until='networkidle')
            page.screenshot(path=str(ARTIFACTS/f'{slug}-{name}.png'),full_page=True)
    assert not errors, errors
    print('PASS zero uncaught browser errors')
    browser.close()
