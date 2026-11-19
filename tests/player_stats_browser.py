"""Captain stats workflow against synthetic intercepted services; no production writes."""
import base64
import copy
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.getenv('MAUVE_BASE_URL', 'http://127.0.0.1:3000')
settings = dict(line.split('=', 1) for line in Path('.env.production.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
API = settings['NEXT_PUBLIC_SUPABASE_URL']
S = '66666666-6666-4666-8666-666666666666'
OLD = '66666666-6666-4666-8666-666666666667'
M = '77777777-7777-4777-8777-777777777777'
HIST = '77777777-7777-4777-8777-777777777778'
NEXT = '77777777-7777-4777-8777-777777777779'
CAP = '33333333-3333-4333-8333-333333333333'
ids = [f'00000000-0000-4000-8000-{i+1:012}' for i in range(15)]
names = ['Alexandra Montgomery-Richardson', 'Avery Blake'] + [f'Private Member {i}' for i in range(2, 15)]
players = [dict(id=pid, name=names[i], number=i+1, position='Midfielder', initials='PM', hometown='', bio='', isPublic=False) for i, pid in enumerate(ids)]
unknown = dict(home=3, away=1, onFieldHome=3, onFieldAway=1, basis='played', reason='', attendance='unrecorded', scorers='unrecorded', assists='unrecorded', ownGoals=0, stats=[], published=True)
fixture = dict(id=M, seasonId=S, opponent='Past United', opponentCode='PU', color='#657293', kickoff='2026-10-01T20:00:00Z', venue='Test pitch', round=1, home=True, status='completed', source='leagueapps', resultSource='leagueapps', revision=4, result=copy.deepcopy(unknown))
data = dict(seasons=[dict(id=S, name='Current season', competition='Test league', format='7v7'), dict(id=OLD, name='Historical season', competition='Test league', format='7v7')], players=players,
    roster=[dict(seasonId=s, playerId=pid) for s in [S, OLD] for pid in ids], matches=[fixture,
        {**copy.deepcopy(fixture), 'id':HIST, 'seasonId':OLD, 'opponent':'Historic FC', 'kickoff':'2025-06-01T20:00:00Z', 'revision':0},
        {k:v for k,v in {**copy.deepcopy(fixture), 'id':NEXT, 'opponent':'Next FC', 'kickoff':'2099-01-01T20:00:00Z', 'status':'scheduled', 'revision':0}.items() if k!='result'}])
writes = []
errors = []
drafts = []

def public():
    result = copy.deepcopy(data)
    result['players'] = []
    result['roster'] = []
    for match in result['matches']:
        if match.get('result'): match['result']['stats'] = []
    return result

def context_for(browser, kind='captain', width=1440):
    context = browser.new_context(viewport=dict(width=width, height=1000))
    user = dict(id=CAP, aud='authenticated', role='authenticated', email='captain@example.test', app_metadata={}, user_metadata={}, created_at='2026-11-09T00:00:00Z')
    if kind:
        enc = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
        token = enc(dict(alg='HS256',typ='JWT'))+'.'+enc(dict(sub=CAP,exp=int(time.time())+3600,aud='authenticated',role='authenticated'))+'.contract-only'
        session = dict(access_token=token, refresh_token='contract-only', expires_in=3600, expires_at=int(time.time())+3600, token_type='bearer', user=user)
        context.add_init_script('localStorage.setItem("mauve-fc-auth",'+json.dumps(json.dumps(session))+')')
    def stub(route):
        req = route.request
        path = req.url.split(API)[-1].split('?')[0]
        body = req.post_data_json if req.post_data else {}
        status, payload = 200, None
        if req.method == 'OPTIONS': pass
        elif path == '/auth/v1/user': payload = user if kind else None
        elif path.endswith('/get_team_access'): payload = dict(member=bool(kind), role=kind, playerId=ids[0] if kind else None)
        elif path.endswith('/get_public_club'): payload = public()
        elif path.endswith('/get_season_stats'):
            member = kind in ['captain', 'player']
            payload = dict(teamView=member, privatePlayerCount=0 if member else len(players), assistsTotal=None, assistsRecordedMatches=0, assistsCompleteMatches=0,
                players=[{**p, 'goals':0, 'assists':0, 'appearances':0, 'goalsKnown':False, 'assistsKnown':False, 'appearancesKnown':False} for p in players] if member else [])
        elif path.endswith('/get_captain_club'):
            assert kind == 'captain'
            payload = data
        elif path == '/rest/v1/match_drafts': payload = drafts
        elif path.endswith('/save_match_result'):
            assert kind == 'captain'
            match = next(m for m in data['matches'] if m['id']==body['p_match_id'])
            if match['revision'] != body['p_expected_revision']:
                status, payload = 409, dict(code='40001',message='Match changed')
            else:
                for key in ['home','away','onFieldHome','onFieldAway','basis','reason']:
                    assert body['p_payload'][key] == match['result'][key], key
                writes.append(copy.deepcopy(body))
                match['result'] = copy.deepcopy(body['p_payload'])
                match['revision'] += 1
                match['resultSource'] = 'captain'
        else: raise AssertionError('Unexpected service request: '+path)
        route.fulfill(status=status, content_type='application/json', headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}, body=json.dumps(payload))
    context.route(API+'/**', stub)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    return context, page

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context, page = context_for(browser)
    page.goto(BASE+'/captain/stats/', wait_until='networkidle')
    expect(page.get_by_role('heading', name='Every contribution counts.')).to_be_visible()
    expect(page.get_by_role('combobox', name='Choose a game')).to_have_value(M)
    expect(page.get_by_role('spinbutton', name=names[0]+' goals')).to_be_disabled()
    page.get_by_role('checkbox', name=names[0]+' played').check()
    page.get_by_role('checkbox', name=names[1]+' played').check()
    page.get_by_role('spinbutton', name=names[0]+' goals').fill('2')
    page.get_by_role('spinbutton', name=names[1]+' goals').fill('1')
    page.get_by_role('combobox', name='Attendance recording').select_option('complete')
    page.get_by_role('combobox', name='Goals recording').select_option('complete')
    page.get_by_role('combobox', name='Assists recording').select_option('partial')
    expect(page.get_by_role('spinbutton', name=names[0]+' assists')).to_have_value('')
    page.get_by_role('spinbutton', name=names[1]+' assists').fill('1')
    for width in [1440, 390, 320]:
        page.set_viewport_size(dict(width=width, height=1000))
        assert page.evaluate('document.documentElement.scrollWidth') <= width
        assert page.locator('.match-player-editor .roster-entry strong').first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)') >= 16
        inputs = page.locator('.match-player-editor .roster-entry').first.locator('input').evaluate_all('(items)=>items.map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height}})')
        assert all(i['width']>=44 and i['height']>=44 for i in inputs), inputs
        page.screenshot(path=f'artifacts/player-stats-{width}.png', full_page=True)
    page.get_by_role('button', name='Save player stats', exact=True).click()
    expect(page.get_by_text('Player stats saved. You can make corrections here anytime.')).to_be_visible()
    assert len(writes)==1 and writes[0]['p_expected_revision']==4
    rows = writes[-1]['p_payload']['stats']
    assert rows[0]['assists'] is None and rows[1]['assists']==1 and not rows[2]['appeared']
    page.reload(wait_until='networkidle')
    expect(page.get_by_role('spinbutton', name=names[0]+' goals')).to_have_value('2')
    expect(page.get_by_role('spinbutton', name=names[0]+' assists')).to_have_value('')
    page.get_by_role('spinbutton', name=names[0]+' goals').fill('1')
    page.get_by_role('button', name='Save player stats', exact=True).click()
    expect(page.locator('.form-errors[role="alert"]')).to_contain_text('all on-field goals')
    assert len(writes)==1
    page.get_by_role('spinbutton', name=names[1]+' goals').fill('2')
    page.get_by_role('combobox', name='Assists recording').select_option('complete')
    expect(page.get_by_role('spinbutton', name=names[0]+' assists')).to_have_value('0')
    page.get_by_role('spinbutton', name=names[0]+' assists').fill('')
    page.get_by_role('button', name='Save player stats', exact=True).click()
    expect(page.locator('.form-errors[role="alert"]')).to_contain_text('known total')
    assert len(writes)==1
    page.get_by_role('spinbutton', name=names[0]+' assists').fill('0')
    page.get_by_role('button', name='Save player stats', exact=True).click()
    expect(page.get_by_text('Player stats saved. You can make corrections here anytime.')).to_be_visible()
    assert len(writes)==2 and writes[-1]['p_expected_revision']==5
    assert sum(s['goals'] for s in data['matches'][0]['result']['stats'])==3
    page.get_by_role('combobox', name='Choose a game').select_option(NEXT)
    expect(page.get_by_role('link', name='Record result & stats')).to_have_attribute('href','/captain/?match='+NEXT)
    expect(page.get_by_role('button', name='Save player stats', exact=True)).to_have_count(0)
    page.get_by_role('combobox', name='Season', exact=True).select_option(OLD)
    expect(page.get_by_role('combobox', name='Choose a game')).to_have_value(HIST)
    page.get_by_role('checkbox', name=names[0]+' played').check()
    page.get_by_role('spinbutton', name=names[0]+' goals').fill('1')
    page.get_by_role('button', name='Save player stats', exact=True).click()
    expect(page.get_by_text('Player stats saved. You can make corrections here anytime.')).to_be_visible()
    assert writes[-1]['p_match_id']==HIST and writes[-1]['p_payload']['scorers']=='partial'
    page.get_by_role('spinbutton', name=names[0]+' goals').fill('2')
    data['matches'][1]['revision'] += 1
    page.get_by_role('button', name='Save player stats', exact=True).click()
    expect(page.locator('.form-errors[role="alert"]')).to_contain_text('changed since')
    expect(page.get_by_role('spinbutton', name=names[0]+' goals')).to_have_value('2')
    expect(page.get_by_role('button', name='Save player stats', exact=True)).to_be_disabled()
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='Reload latest record').click()
    expect(page.get_by_role('combobox', name='Choose a game')).to_have_value(HIST)
    expect(page.get_by_role('spinbutton', name=names[0]+' goals')).to_have_value('1')
    # A result draft cannot be silently discarded by the stats shortcut.
    drafts.append(dict(match_id=HIST, payload=copy.deepcopy(unknown), base_revision=data['matches'][1]['revision']))
    page.reload(wait_until='networkidle')
    page.get_by_role('combobox', name='Season', exact=True).select_option(OLD)
    expect(page.get_by_role('link', name='Open result draft')).to_be_visible()
    expect(page.get_by_role('button', name='Save player stats', exact=True)).to_have_count(0)
    context.close()
    # Shared match editor remains usable through Results.
    context, page = context_for(browser)
    page.goto(BASE+'/captain/?match='+M, wait_until='networkidle')
    page.get_by_role('button', name='Add player details', exact=True).click()
    expect(page.get_by_role('spinbutton', name=names[0]+' goals')).to_have_value('1')
    page.get_by_role('button', name='Preview result', exact=True).click()
    expect(page.get_by_role('button', name='Publish result', exact=True)).to_be_visible()
    context.close()
    for kind in [None, 'player']:
        context, page = context_for(browser, kind, 390)
        page.goto(BASE+'/captain/stats/', wait_until='networkidle')
        expect(page.get_by_role('button', name='Save player stats', exact=True)).to_have_count(0)
        expect(page.get_by_role('checkbox', name=names[0]+' played')).to_have_count(0)
        for path in ['/players/', '/stats/', '/results/']:
            page.goto(BASE+path, wait_until='networkidle')
            if path=='/stats/' and kind=='player':
                expect(page.locator('.leaderboard-table')).to_contain_text(names[0])
            else:
                for name in names: assert name not in page.locator('main').inner_text()
        context.close()
    assert not errors, errors
    print('PASS responsive captain stats, historical season, corrections, partial/unknown records, validation, concurrency, draft protection, Results integration and private access')
    browser.close()
