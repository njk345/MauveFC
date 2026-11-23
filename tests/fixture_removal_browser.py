"""Fixture removal/restore contracts with synthetic services; no production writes."""
import copy
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import BASE, API, data, S, OLD, ids, players, match, new_context, errors, card

Q,SF,F='77777777-7777-4777-8777-777777777779','77777777-7777-4777-8777-777777777780','77777777-7777-4777-8777-777777777781'
for m in data['matches']:m.update(source='leagueapps',fixtureOverride=False)
for mid,opponent,round,phase,home,away in [(Q,'Quarterfinal FC',3,'quarterfinals',2,1),(SF,'Semifinal FC',4,'semifinals',1,0),(F,'The Long Named Finals FC',5,'finals',1,1)]:
    m={**copy.deepcopy(match),'id':mid,'opponent':opponent,'round':round,'kickoff':f'2026-11-{10+round:02}T20:00:00Z','playoffRound':phase,'source':'leagueapps','fixtureOverride':False}
    m['result'].update(home=home,away=away,onFieldHome=home,onFieldAway=away,stats=[dict(playerId=ids[0],appeared=True,goals=1,assists=1)])
    if mid==F:m['result'].update(decision='penalties',penaltyOutcome='W')
    data['matches'].append(m)
data['seasons'][0].update(completed=True,revision=1,finalPosition=5)
data['removedFixtures']=[]
data['league']=dict(seasonId=S,teamId='8032635',teamName='Test club',standings=[dict(position=i,teamId='8032635' if i==5 else str(1000+i),name='Test club' if i==5 else f'League team {i}',played=2,wins=2,losses=0,draws=0,goalsFor=8,goalsAgainst=2,difference=6,forfeits=0,points=6) for i in range(1,10)],lastSuccess='2026-11-23T03:00:00Z',state='succeeded')
original=copy.deepcopy(data);writes=[]

def context_for(browser,kind='captain',width=390):
    context,page,state,respond=new_context(browser,kind,width)
    state.update(fail_remove=False,fail_restore=False,refreshes=0)
    def public(route):
        value=copy.deepcopy(data);value.pop('removedFixtures',None);value['players']=players[:1];value['roster']=[r for r in value['roster'] if r['playerId']==ids[0]]
        for m in value['matches']:
            if m.get('result'):m['result']['stats']=[s for s in m['result']['stats'] if s['playerId']==ids[0]]
        respond(route,value if route.request.method!='OPTIONS' else None)
    def team(route):
        assert kind in ['captain','player'];value=copy.deepcopy(data);value.pop('removedFixtures',None);value.update(rsvps=[],lineups=[])
        respond(route,value if route.request.method!='OPTIONS' else None)
    def stats(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        body=route.request.post_data_json;season=body['p_season_id'];games=[m for m in data['matches'] if m['seasonId']==season and m.get('result',{}).get('published') and m['status']=='completed']
        rows=[];member=kind in ['captain','player'];visible=players if member else players[:1]
        for p in visible:
            entries=[s for m in games for s in m['result']['stats'] if s['playerId']==p['id']]
            rows.append({**p,'appearances':sum(s['appeared'] for s in entries),'goals':sum(s['goals'] for s in entries),'assists':sum(s['assists'] or 0 for s in entries),'appearancesKnown':bool(entries),'goalsKnown':bool(entries),'assistsKnown':bool(entries)})
        known=[m for m in games if m['result']['assists']!='unrecorded']
        respond(route,dict(teamView=member,privatePlayerCount=0 if member else 14,players=rows,assistsTotal=sum(s['assists'] or 0 for m in known for s in m['result']['stats']) if known else None,assistsRecordedMatches=len(known),assistsCompleteMatches=0))
    def toggle(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        assert kind=='captain';body=route.request.post_data_json;removed=body['p_removed'];collection=data['matches'] if removed else data['removedFixtures'];m=next(m for m in collection if m['id']==body['p_match_id']);assert m['revision']==body['p_expected_revision']
        if state['fail_remove' if removed else 'fail_restore']:
            state['fail_remove' if removed else 'fail_restore']=False;respond(route,dict(message='Fixture changed; reload before removing or restoring',code='40001'),409);return
        writes.append(copy.deepcopy(body));collection.remove(m);m['revision']+=1
        if removed:
            if m.get('source'):m.update(removedAt='2026-11-23T04:00:00Z',feedAvailable=True);data['removedFixtures'].append(m)
        else:
            m.pop('removedAt',None);m.pop('feedAvailable',None);data['matches'].append(m);data['matches'].sort(key=lambda m:m['round'])
        respond(route,None)
    def refresh(route):
        if route.request.method!='OPTIONS':
            state['refreshes']+=1
            for m in data['removedFixtures']:m['venue']='Updated feed pitch'
        respond(route,None)
    context.route(API+'/rest/v1/rpc/get_public_club',public)
    context.route(API+'/rest/v1/rpc/get_team_club',team)
    context.route(API+'/rest/v1/rpc/get_season_stats',stats)
    context.route(API+'/rest/v1/rpc/set_fixture_removed',toggle)
    context.route(API+'/rest/v1/rpc/request_league_sync',refresh)
    return context,page,state

def fixtures(page):page.goto(BASE+'/captain/fixtures/',wait_until='networkidle')
def choose(page,name):page.locator('.management-list button').filter(has_text=name).click()
def ask_remove(page,name):
    choose(page,name);page.get_by_role('button',name='Remove fixture',exact=True).click();return page.get_by_role('dialog',name='Remove this fixture?',exact=True)
def remove(page,name):
    dialog=ask_remove(page,name);dialog.get_by_role('button',name='Remove fixture',exact=True).click();expect(dialog).to_have_count(0)
    expect(page.locator('.management-list')).not_to_contain_text(name)
def layout(page,width):assert page.evaluate('document.documentElement.scrollWidth')<=width

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context,page,state=context_for(browser)
    fixtures(page);dialog=ask_remove(page,'The Long Named Finals FC');expect(dialog).to_contain_text('league standings stay unchanged');page.screenshot(path='artifacts/remove-confirm-390.png',full_page=True)
    page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0);assert not writes
    state['fail_remove']=True;dialog=ask_remove(page,'The Long Named Finals FC');dialog.get_by_role('button',name='Remove fixture',exact=True).click();expect(dialog.get_by_role('alert')).to_contain_text('Fixture changed');assert not data['removedFixtures'];dialog.get_by_role('button',name='Keep fixture',exact=True).click()
    remove(page,'The Long Named Finals FC');queue=page.get_by_role('region',name='Removed feed fixtures',exact=True);expect(queue).to_contain_text('The Long Named Finals FC');expect(queue).to_contain_text('Won on penalties')
    page.get_by_role('button',name='Refresh now',exact=True).click();expect(page.locator('.management-list')).not_to_contain_text('The Long Named Finals FC');expect(queue).to_contain_text('The Long Named Finals FC');assert state['refreshes']==1 and data['removedFixtures'][0]['venue']=='Updated feed pitch'
    page.screenshot(path='artifacts/removed-queue-390.png',full_page=True)
    page.get_by_role('combobox',name='Season',exact=True).select_option(OLD);expect(queue).not_to_contain_text('The Long Named Finals FC');page.get_by_role('combobox',name='Season',exact=True).select_option(S);expect(queue).to_contain_text('The Long Named Finals FC')
    page.goto(BASE+'/',wait_until='networkidle');expect(page.locator('.home-champions')).to_have_count(0);expect(page.get_by_label('Season finish')).to_contain_text('Playoff finish · Semifinals');expect(page.locator('.home-standings .mauve-standing td').first).to_have_text('5');page.screenshot(path='artifacts/removed-final-home-390.png',full_page=True)
    page.goto(BASE+'/stats/',wait_until='networkidle');expect(card(page,'MATCHES PLAYED')).to_have_text('4');expect(card(page,'GOALS SCORED')).to_have_text('11');expect(card(page,'ASSISTS RECORDED')).to_have_text('7')
    fixtures(page);state['fail_restore']=True;queue=page.get_by_role('region',name='Removed feed fixtures',exact=True);button=queue.get_by_role('button',name='Add back fixture against The Long Named Finals FC',exact=True);button.click();expect(queue.get_by_role('alert')).to_contain_text('Fixture changed');expect(queue).to_contain_text('The Long Named Finals FC');button.click();expect(queue).not_to_contain_text('The Long Named Finals FC');expect(page.locator('.management-list')).to_contain_text('The Long Named Finals FC')
    page.goto(BASE+'/',wait_until='networkidle');expect(page.locator('.home-champions')).to_be_visible();expect(page.locator('.home-champions')).to_contain_text('Won on penalties')
    fixtures(page);remove(page,'The Long Named Finals FC');remove(page,'Semifinal FC');page.goto(BASE+'/',wait_until='networkidle');expect(page.get_by_label('Season finish')).to_contain_text('Playoff finish · Quarterfinals')
    fixtures(page);remove(page,'Quarterfinal FC');page.goto(BASE+'/',wait_until='networkidle');expect(page.get_by_label('Season finish')).to_contain_text('5th place.');expect(page.locator('.home-champions')).to_have_count(0)
    fixtures(page)
    for width in [1440,390,320]:
        page.set_viewport_size(dict(width=width,height=1000));layout(page,width);page.screenshot(path=f'artifacts/removed-queue-{width}.png',full_page=True)
    context.close()
    for kind in [None,'player','captain']:
        context,page,_=context_for(browser,kind)
        for width in [1440,390,320]:
            page.set_viewport_size(dict(width=width,height=1000));page.goto(BASE+'/',wait_until='networkidle');expect(page.get_by_label('Season finish')).to_contain_text('5th place.');expect(page.locator('.mauve-standing td').first).to_have_text('5');layout(page,width)
            page.goto(BASE+'/results/',wait_until='networkidle');expect(page.locator('.match-row')).to_have_count(2);expect(page.locator('.match-row')).not_to_contain_text(['The Long Named Finals FC','Semifinal FC']);layout(page,width)
            page.goto(BASE+'/schedule/',wait_until='networkidle');page.get_by_role('button',name='All matches (2)',exact=True).click();expect(page.locator('.match-row')).to_have_count(2)
            page.goto(BASE+'/stats/',wait_until='networkidle');expect(card(page,'MATCHES PLAYED')).to_have_text('2');expect(card(page,'GOALS SCORED')).to_have_text('8');expect(card(page,'ASSISTS RECORDED')).to_have_text('5')
        if kind!='captain':
            page.goto(BASE+'/captain/fixtures/',wait_until='networkidle');expect(page.get_by_role('button',name='Remove fixture',exact=True)).to_have_count(0);expect(page.get_by_role('region',name='Removed feed fixtures')).to_have_count(0)
        context.close()
    # Regular-season deletion updates Home record and Stats while the imported table stays fixed.
    context,page,_=context_for(browser);fixtures(page);remove(page,'Past United')
    page.goto(BASE+'/',wait_until='networkidle');expect(page.get_by_label('Current club record').locator('strong').first).to_have_text('3');expect(page.locator('.mauve-standing td').first).to_have_text('5');expect(page.locator('.mauve-standing td').last).to_have_text('6')
    page.goto(BASE+'/stats/',wait_until='networkidle');expect(card(page,'MATCHES PLAYED')).to_have_text('1');expect(card(page,'GOALS SCORED')).to_have_text('3');expect(card(page,'ASSISTS RECORDED')).to_have_text('—')
    fixtures(page);page.get_by_role('button',name='Add back fixture against Past United',exact=True).click();page.goto(BASE+'/stats/',wait_until='networkidle');expect(card(page,'GOALS SCORED')).to_have_text('8')
    context.close();assert not errors,errors
    print('PASS captain removal/cancel/errors, private feed queue, refresh suppression, restore, closed-season fallback, stats/record changes, unchanged league standings and 320/390/1440px layouts; no production writes')
    browser.close()
