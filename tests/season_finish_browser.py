"""Result deciders and season finishes; all services intercepted, no production writes."""
import copy
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import BASE, API, data, S, match, new_context, errors, card

F='77777777-7777-4777-8777-777777777779'
NEXT='77777777-7777-4777-8777-777777777780'
final={**copy.deepcopy(match),'id':F,'opponent':'The Long Named Finals FC','round':3,'kickoff':'2026-11-20T01:50:00Z','playoffRound':'finals'}
final['result'].update(home=1,away=1,onFieldHome=1,onFieldAway=1,attendance='unrecorded',scorers='unrecorded',assists='unrecorded',stats=[])
future={**copy.deepcopy(match),'id':NEXT,'opponent':'Future FC','round':4,'kickoff':'2099-01-01T20:00:00Z','status':'scheduled'}
future.pop('result')
data['matches'] += [final,future]
season=data['seasons'][0];season.update(completed=False,completedAt=None,finalPosition=None,revision=0)
data['league']=dict(seasonId=S,teamId='8032635',teamName='Test club',standings=[dict(position=5,teamId='8032635',name='Test club',played=2,wins=2,losses=0,draws=0,goalsFor=8,goalsAgainst=2,difference=6,forfeits=0,points=6)],lastSuccess='2026-11-21T20:00:00Z',state='succeeded')
drafts={};writes=[]

def captain_context(browser,width=390):
    context,page,state,respond=new_context(browser,'captain',width)
    def save_result(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        body=route.request.post_data_json;m=next(m for m in data['matches'] if m['id']==body['p_match_id'])
        assert body['p_expected_revision']==m['revision'];payload=body['p_payload'];writes.append(copy.deepcopy(body))
        if payload['published']:
            m['result']=copy.deepcopy(payload);m['status']='completed';m['revision']+=1;drafts.pop(m['id'],None)
        else:drafts[m['id']]=dict(match_id=m['id'],payload=copy.deepcopy(payload),base_revision=m['revision'])
        respond(route,None)
    def season_status(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        body=route.request.post_data_json;assert body['p_season_id']==S and body['p_expected_revision']==season['revision']
        completed=body['p_completed'];assert isinstance(completed,bool)
        season.update(completed=completed,completedAt='2026-11-21T20:00:00Z' if completed else None,finalPosition=data['league']['standings'][0]['position'] if completed else None,revision=season['revision']+1)
        respond(route,None)
    context.route(API+'/rest/v1/rpc/save_match_result',save_result)
    context.route(API+'/rest/v1/rpc/set_season_complete',season_status)
    context.route(API+'/rest/v1/match_drafts*',lambda route:respond(route,list(drafts.values()) if route.request.method!='OPTIONS' else None))
    return context,page

def editor(page):
    page.goto(BASE+'/captain/?match='+F,wait_until='networkidle')
    expect(page.get_by_role('combobox',name='Choose a match',exact=True)).to_have_value(F)

def set_decision(page,decision,home,away,penalty=None):
    page.get_by_role('spinbutton',name='Mauve FC official score',exact=True).fill(str(home))
    page.get_by_role('spinbutton',name='Opponent official score',exact=True).fill(str(away))
    page.get_by_role('combobox',name='Decided in',exact=True).select_option(decision)
    if penalty:page.get_by_role('combobox',name='Penalty result',exact=True).select_option(penalty)

def publish(page):
    page.get_by_role('button',name='Add player details',exact=True).click()
    page.get_by_role('button',name='Preview result',exact=True).click()
    page.get_by_role('button',name='Publish result',exact=True).click()
    expect(page.get_by_role('heading',name='Another chapter, published.')).to_be_visible()

def layout(page,width):
    assert page.evaluate('document.documentElement.scrollWidth')<=width
    for row in page.locator('.match-row').all():
        info=row.locator('.match-information').bounding_box();end=row.locator('.match-row-end').bounding_box()
        assert info['x']+info['width']<=end['x']+1 or info['y']+info['height']<=end['y']+1,(width,info,end)

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context,page=captain_context(browser)
    editor(page);set_decision(page,'penalties',2,1,'W')
    assert page.get_by_role('combobox',name='Penalty result',exact=True).locator('option').count()==2
    page.get_by_role('button',name='Add player details',exact=True).click();expect(page.locator('.form-errors')).to_contain_text('tied match score')
    assert not writes
    set_decision(page,'penalties',1,1,'W');page.screenshot(path='artifacts/decider-captain-390.png',full_page=True)
    page.get_by_role('button',name='Save draft',exact=True).click()
    expect(page.locator('.toast')).to_contain_text('Private draft saved')
    page.reload(wait_until='networkidle');expect(page.get_by_role('combobox',name='Decided in',exact=True)).to_have_value('penalties');expect(page.get_by_role('combobox',name='Penalty result',exact=True)).to_have_value('W')
    publish(page);assert final['result']['home']==1 and final['result']['away']==1 and final['result']['penaltyOutcome']=='W'
    page.goto(BASE+'/captain/season/',wait_until='networkidle')
    page.get_by_role('checkbox',name='Season complete',exact=True).check()
    expect(page.locator('.season-finish-preview')).to_contain_text('LEAGUE CHAMPIONS')
    page.get_by_role('button',name='Save season status',exact=True).click()
    expect(page.locator('.season-status-form .pill')).to_have_text('Complete')
    assert season['completed'] and season['finalPosition']==5
    page.screenshot(path='artifacts/season-captain-390.png',full_page=True)
    context.close()
    for kind in ['captain','player',None]:
        context,page,_,_=new_context(browser,kind,390)
        for width in [1440,390,320]:
            page.set_viewport_size(dict(width=width,height=1000))
            page.goto(BASE+'/',wait_until='networkidle')
            expect(page.locator('.home-champions')).to_contain_text('1–1');expect(page.locator('.home-champions')).to_contain_text('Won on penalties')
            expect(page.locator('.fixture-card')).not_to_contain_text('NEXT UP')
            expect(page.get_by_label('Current club record').locator('strong').first).to_have_text('6')
            layout(page,width);page.screenshot(path=f'artifacts/season-champions-{kind or "public"}-{width}.png',full_page=True)
            page.goto(BASE+'/results/',wait_until='networkidle')
            winner=page.locator('.match-row.championship-result');expect(winner).to_contain_text('Champions!');expect(winner).to_contain_text('Won on penalties');expect(winner.locator('.form-badge')).to_have_text('W')
            layout(page,width);page.screenshot(path=f'artifacts/season-results-{kind or "public"}-{width}.png',full_page=True)
            page.get_by_role('button',name='Draws',exact=True).click();expect(page.locator('.match-row')).to_have_count(0)
            page.get_by_role('button',name='Wins',exact=True).click();expect(page.locator('.match-row')).to_have_count(3)
            winner.get_by_role('button',name='The Long Named Finals FC',exact=True).click();expect(page.get_by_role('dialog')).to_contain_text('Won on penalties');page.get_by_role('button',name='Close match details').click()
            page.goto(BASE+'/stats/',wait_until='networkidle');expect(card(page,'MATCHES PLAYED')).to_have_text('3');expect(card(page,'GOALS SCORED')).to_have_text('9');expect(card(page,'GOAL DIFFERENCE')).to_have_text('+6');expect(card(page,'ASSISTS RECORDED')).to_have_text('5')
        context.close()
    context,page=captain_context(browser)
    for decision,home,away,penalty,label in [('penalties',1,1,'L','Lost on penalties'),('overtime',2,1,None,'Won after overtime'),('overtime',1,2,None,'Lost after overtime'),('overtime',1,1,None,'Drew after overtime')]:
        editor(page);set_decision(page,decision,home,away,penalty);publish(page)
        page.goto(BASE+'/results/',wait_until='networkidle');row=page.locator('.match-row').filter(has_text='The Long Named Finals FC');expect(row).to_contain_text(label)
        page.goto(BASE+'/',wait_until='networkidle')
        expect(page.locator('.home-champions')).to_have_count(1 if home>away else 0)
        if home<=away:expect(page.get_by_label('Season finish')).to_contain_text('Reached the finals.' if home==away and not penalty else 'Runners-up.')
    # A corrected penalty loss removes the trophy and drives the season finish.
    editor(page);set_decision(page,'penalties',1,1,'L');publish(page)
    page.goto(BASE+'/',wait_until='networkidle');expect(page.get_by_label('Season finish')).to_contain_text('Runners-up.');expect(page.get_by_label('Season finish')).to_contain_text('Lost on penalties');expect(page.locator('.championship-confetti')).to_have_count(0)
    for phase,title in [('semifinals','Semifinalists.'),('quarterfinals','Quarterfinalists.')]:
        final['playoffRound']=phase;page.reload(wait_until='networkidle');expect(page.get_by_label('Season finish')).to_contain_text(title)
    final['playoffRound']=None;data['league']['standings'][0]['position']=2
    for width in [1440,390,320]:
        page.set_viewport_size(dict(width=width,height=1000));page.reload(wait_until='networkidle')
        expect(page.get_by_label('Season finish')).to_contain_text('5th place.');layout(page,width);page.screenshot(path=f'artifacts/season-placing-{width}.png',full_page=True)
    page.goto(BASE+'/captain/season/',wait_until='networkidle');page.get_by_role('checkbox',name='Season complete',exact=True).uncheck();page.get_by_role('button',name='Save season status',exact=True).click();expect(page.locator('.season-status-form .pill')).to_have_text('In progress')
    page.goto(BASE+'/',wait_until='networkidle');expect(page.get_by_label('Season finish')).to_have_count(0);expect(page.locator('.fixture-card')).to_contain_text('NEXT UP')
    # Completing again captures the latest league position.
    page.goto(BASE+'/captain/season/',wait_until='networkidle');page.get_by_role('checkbox',name='Season complete',exact=True).check();page.get_by_role('button',name='Save season status',exact=True).click();expect(page.locator('.season-status-form .pill')).to_have_text('Complete');assert season['finalPosition']==2
    context.close()
    for kind in ['player',None]:
        context,page,_,_=new_context(browser,kind,390);page.goto(BASE+'/captain/season/',wait_until='networkidle');expect(page.get_by_role('checkbox',name='Season complete',exact=True)).to_have_count(0);context.close()
    assert not errors,errors
    print('PASS penalty and overtime editing/drafts/publishing, invalid shootout rejection, role-aware result labels, champion/exit/placing finishes, frozen standings, reopen and mobile layouts; no production writes')
    browser.close()
