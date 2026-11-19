"""Role-aware main Stats page; intercepted synthetic services, no production writes."""
import base64
import copy
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.getenv('MAUVE_BASE_URL', 'http://127.0.0.1:3100')
settings = dict(line.split('=', 1) for line in Path('.env.production.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
API = settings['NEXT_PUBLIC_SUPABASE_URL']
C = settings['NEXT_PUBLIC_MAUVE_CLUB_ID']
S, OLD = '66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666667'
M = '77777777-7777-4777-8777-777777777777'
ids = [f'00000000-0000-4000-8000-{i+1:012}' for i in range(15)]
names = ['Public Player', 'Alexandra Montgomery-Richardson'] + [f'Private Member {i}' for i in range(2, 15)]
players = [dict(id=pid, name=names[i], number=i+1, position='Midfielder', initials='PP' if i==0 else 'XY', hometown='', bio='', isPublic=i==0) for i, pid in enumerate(ids)]
result = dict(home=5, away=2, onFieldHome=5, onFieldAway=2, basis='played', reason='', attendance='partial', scorers='partial', assists='partial', ownGoals=0, published=True,
    stats=[dict(playerId=ids[0], appeared=True, goals=1, assists=1), dict(playerId=ids[1], appeared=True, goals=2, assists=4)])
match = dict(id=M, seasonId=S, opponent='Past United', opponentCode='PU', color='#657293', kickoff='2026-10-01T20:00:00Z', venue='Test pitch', round=1, home=True, status='completed', revision=1, result=result)
data = dict(seasons=[dict(id=S, name='Current season', competition='Test league', format='7v7'), dict(id=OLD, name='Old season', competition='Test league', format='7v7')], players=players,
    roster=[dict(seasonId=s, playerId=pid) for s in [S,OLD] for pid in ids], matches=[match,
        {**copy.deepcopy(match), 'id':'77777777-7777-4777-8777-777777777778', 'round':2, 'opponent':'Forfeit FC', 'result':{**copy.deepcopy(result), 'home':3, 'away':0, 'onFieldHome':0, 'onFieldAway':0, 'basis':'forfeit', 'reason':'Unplayed forfeit', 'attendance':'unrecorded', 'scorers':'unrecorded', 'assists':'unrecorded', 'stats':[]}}])
errors = []

def new_context(browser, kind, width=1440):
    state = dict(kind=kind, all_private=False, zero=False, fail=False, hold=False, pending=[], calls=0)
    context = browser.new_context(viewport=dict(width=width, height=1000))
    user = dict(id='33333333-3333-4333-8333-333333333333', aud='authenticated', role='authenticated', email='member@example.test', app_metadata={}, user_metadata={}, created_at='2026-11-09T00:00:00Z')
    if kind:
        encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
        token = encode(dict(alg='HS256',typ='JWT'))+'.'+encode(dict(sub=user['id'],exp=int(time.time())+3600,aud='authenticated',role='authenticated'))+'.contract-only'
        session = dict(access_token=token, refresh_token='contract-only', expires_in=3600, expires_at=int(time.time())+3600, token_type='bearer', user=user)
        context.add_init_script('localStorage.setItem("mauve-fc-auth",'+json.dumps(json.dumps(session))+')')
    def public():
        value = copy.deepcopy(data)
        value['players'] = [] if state['all_private'] else [players[0]]
        value['roster'] = [r for r in value['roster'] if not state['all_private'] and r['playerId']==ids[0]]
        for m in value['matches']:
            m['result']['stats'] = [s for s in m['result']['stats'] if not state['all_private'] and s['playerId']==ids[0]]
        return value
    def stats(season):
        member = state['kind'] in ['player','captain']
        visible = players if member else ([] if state['all_private'] else players[:1])
        rows = []
        for p in visible:
            i=ids.index(p['id']); known=season==S and i<2
            rows.append({**p, 'appearances':1 if known else 0, 'goals':(1 if i==0 else 2) if known else 0, 'assists':(1 if i==0 else 4) if known and not state['zero'] else 0,
                'appearancesKnown':known,'goalsKnown':known,'assistsKnown':known, 'isPublic':p['isPublic'] and not state['all_private']})
        return dict(teamView=member, privatePlayerCount=0 if member else 15-len(visible), players=rows, assistsTotal=(0 if state['zero'] else 5) if season==S else None, assistsRecordedMatches=1 if season==S else 0, assistsCompleteMatches=0)
    def respond(route, payload, status=200):
        route.fulfill(status=status, content_type='application/json', headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}, body=json.dumps(payload))
    def stub(route):
        req=route.request; path=req.url.split(API)[-1].split('?')[0]; body=req.post_data_json if req.post_data else {}; payload=None
        if req.method=='OPTIONS': pass
        elif path=='/auth/v1/user': payload=user if state['kind'] else None
        elif path=='/auth/v1/logout': state['kind']=None
        elif path.endswith('/get_team_access'): payload=dict(member=state['kind'] in ['player','captain'], role=state['kind'], playerId=ids[1] if state['kind'] else None)
        elif path.endswith('/get_public_club'): payload=public()
        elif path.endswith('/get_captain_club'): assert state['kind']=='captain'; payload=data
        elif path=='/rest/v1/match_drafts': payload=[]
        elif path.endswith('/get_team_club'): assert state['kind'] in ['player','captain']; payload={**data,'lineups':[],'rsvps':[]}
        elif path.endswith('/get_lineup_posts'): payload=[]
        elif path.endswith('/get_season_stats'):
            assert body['p_club_id']==C and isinstance(body['p_season_id'],str)
            state['calls']+=1; payload=stats(body['p_season_id'])
            if state['hold']:
                state['hold']=False; state['pending'].append((route,payload)); return
            if state['fail']: respond(route,dict(message='Contract failure'),503); return
        else: raise AssertionError('Unexpected service request: '+path)
        respond(route,payload)
    context.route(API+'/**',stub)
    page=context.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
    return context,page,state,respond

def card(page,label): return page.locator('.stat-card').filter(has=page.get_by_text(label,exact=True)).locator('strong')
def totals(page):
    expect(card(page,'MATCHES PLAYED')).to_have_text('2')
    expect(card(page,'GOALS SCORED')).to_have_text('8')
    expect(card(page,'GOAL DIFFERENCE')).to_have_text('+6')
    expect(card(page,'ASSISTS RECORDED')).to_have_text('5')

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for kind in [None,'outsider','player','captain']:
        context,page,state,_=new_context(browser,kind)
        page.goto(BASE+'/stats/',wait_until='networkidle')
        expect(page.locator('.leaderboard-table tbody tr')).to_have_count(15)
        totals(page)
        if kind in ['player','captain']:
            expect(page.locator('.private-stats-row')).to_have_count(0)
            expect(page.locator('.leaderboard-table')).to_contain_text(names[1])
            expect(page.locator('.leaderboard-table tbody tr').first).to_contain_text(names[1])
            expect(page.locator('.leaderboard-table a').filter(has_text=names[1])).to_have_count(0)
            expect(page.locator('.stats-visibility-note')).to_contain_text('Team view')
        else:
            expect(page.locator('.private-stats-row')).to_have_count(14)
            for name in names[1:]: assert name not in page.locator('main').inner_text()
            expect(page.locator('.private-stats-row').first.locator('td').nth(3)).to_have_text('—')
            assert not page.locator('.private-stats-row a').count()
        for width in [1440,390,320]:
            page.set_viewport_size(dict(width=width,height=1000))
            page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            page.wait_for_timeout(900) # Let the existing chart resize animation finish before capture.
            page.screenshot(path=f'artifacts/stats-{kind or "public"}-{width}.png',full_page=True)
            assert page.evaluate('document.documentElement.scrollWidth')<=width,(kind,width,page.locator('body').evaluate('(body)=>[...body.querySelectorAll("*")].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,w:e.getBoundingClientRect().width})).slice(0,12)'))
        for metric in ['Assists','Appearances','Goals']:
            page.get_by_role('button',name=metric,exact=True).click(); totals(page)
        page.get_by_role('combobox',name='Season',exact=True).select_option(OLD)
        expect(card(page,'MATCHES PLAYED')).to_have_text('0')
        expect(card(page,'ASSISTS RECORDED')).to_have_text('—')
        page.get_by_role('combobox',name='Season',exact=True).select_option(S)
        totals(page)
        if kind is None:
            state['all_private']=True
            page.get_by_role('button',name='Refresh stats',exact=True).click()
            expect(page.locator('.private-stats-row')).to_have_count(15)
            assert names[0] not in page.locator('.leaderboard-table').inner_text()
            totals(page)
            state['zero']=True
            page.get_by_role('button',name='Refresh stats',exact=True).click()
            expect(card(page,'ASSISTS RECORDED')).to_have_text('0')
            state['fail']=True
            page.get_by_role('button',name='Refresh stats',exact=True).click()
            expect(page.locator('.form-errors[role="alert"]')).to_contain_text('could not be loaded')
            expect(card(page,'GOALS SCORED')).to_have_text('8')
            state['fail']=False
            page.get_by_role('button',name='Try again',exact=True).click()
            expect(page.locator('.private-stats-row')).to_have_count(15)
        context.close()
    # Another tab signs out while a private response is in flight. The old
    # response must not restore private rows after identity changes.
    context,page,state,respond=new_context(browser,'player',390)
    page.goto(BASE+'/stats/',wait_until='networkidle')
    expect(page.locator('.leaderboard-table')).to_contain_text(names[1])
    other=context.new_page();other.goto(BASE+'/team/',wait_until='networkidle')
    state['hold']=True
    page.get_by_role('button',name='Refresh stats',exact=True).click()
    expect(page.get_by_text('Loading player stats…',exact=True)).to_be_visible()
    assert state['pending']
    other.get_by_role('button',name='Sign out',exact=True).click()
    expect(page.locator('.private-stats-row')).to_have_count(14)
    for route,payload in state['pending']:respond(route,payload)
    expect(page.locator('.leaderboard-table')).not_to_contain_text(names[1])
    expect(page.locator('.private-stats-row')).to_have_count(14)
    context.close()
    assert not errors,errors
    print('PASS main Stats public/member/captain views, anonymization, complete team assists, official totals, season changes, unknown/zero, retries and sign-out response races')
    browser.close()
